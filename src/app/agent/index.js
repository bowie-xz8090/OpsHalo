const { app, BrowserWindow, ipcMain, shell } = require('electron')
const globalState = require('../lib/glob-state')
const { runtimeRoot, codexAccountsRoot, normalizeFeatureFlags } = require('./config')
const { SessionStore } = require('./session/session-store')
const { EvidenceStore } = require('./evidence/evidence-store')
const { EvidenceCleaner } = require('./evidence/evidence-cleaner')
const { AuditLog } = require('./audit/audit-log')
const { PolicyLoader } = require('./policy/policy-loader')
const { PolicyEngine } = require('./policy/policy-engine')
const { CapabilityTokenManager } = require('./approval/capability-token')
const { ApprovalManager } = require('./approval/approval-manager')
const { ToolRegistry } = require('./tools/registry')
const { ToolGateway } = require('./tools/gateway')
const { registerBuiltinTools } = require('./tools/builtin')
const { registerMcpTools } = require('./tools/builtin/mcp-tools')
const { ExecutionRuntime } = require('./execution/execution-runtime')
const { SessionExecutionBridge } = require('./execution/session-execution-bridge')
const { SshExecAdapter } = require('./execution/ssh-exec-adapter')
const { SftpAdapter } = require('./execution/sftp-adapter')
const { BackgroundTaskAdapter } = require('./execution/background-task-adapter')
const { SecretRedactor } = require('./observation/secret-redactor')
const { ObservationPipeline } = require('./observation/observation-pipeline')
const { CompletionEvaluator } = require('./verification/completion-evaluator')
const { VerificationRunner } = require('./verification/verification-runner')
const { HarnessFactory } = require('./harness/harness-factory')
const { AgentSessionManager } = require('./session/session-manager')
const { registerAgentIpc } = require('./ipc/register-agent-ipc')
const { registerCodexIpc } = require('./ipc/register-codex-ipc')
const { CodexProfileStore } = require('./providers/codex-profile-store')
const { CodexAppServerManager } = require('./providers/codex-app-server-manager')
const { packInfo } = require('../common/runtime-constants')

let instance

function initAgentRuntime () {
  if (instance) return instance
  const config = globalState.get('config') || {}
  const featureFlags = normalizeFeatureFlags(config)
  const root = runtimeRoot(app.getPath('userData'))
  const store = new SessionStore(root)
  const evidenceStore = new EvidenceStore(root)
  const evidenceCleaner = new EvidenceCleaner(evidenceStore)
  const audit = new AuditLog(root)
  const policy = new PolicyLoader(root, {
    ...featureFlags,
    commandBlacklist: config.commandBlacklist,
    commandWhitelist: config.commandWhitelist
  }).load()
  const policyEngine = new PolicyEngine({ policy })
  const secret = globalState.get('agentCapabilitySecret')
  const capabilities = new CapabilityTokenManager(secret)
  const approvals = new ApprovalManager(capabilities)
  const execution = new ExecutionRuntime()
  const bridge = new SessionExecutionBridge(() => globalState.get('serverChild'))
  const ssh = new SshExecAdapter(bridge)
  const registry = registerBuiltinTools(new ToolRegistry(), {
    bridge,
    ssh,
    sftp: new SftpAdapter(bridge, evidenceStore),
    background: new BackgroundTaskAdapter(ssh)
  })
  const gateway = new ToolGateway({ registry, policyEngine, approvals, capabilities, runtime: execution, audit })
  const observationPipeline = new ObservationPipeline({ evidenceStore, audit, redactor: new SecretRedactor(config.agentSensitivePatterns || []) })
  const verificationRunner = new VerificationRunner(gateway, observationPipeline)
  const profileStore = new CodexProfileStore(codexAccountsRoot(app.getPath('userData')))
  const codexManager = new CodexAppServerManager({
    profileStore,
    getConfig: () => globalState.get('config') || {},
    audit,
    version: packInfo.version,
    isProfileBusy: profileId => manager?.hasActiveProfile(profileId) === true
  })
  const harnessFactory = new HarnessFactory(() => globalState.get('config') || {}, { codexManager })
  const manager = new AgentSessionManager({
    store,
    evidenceStore,
    bindingResolver: tabId => bridge.describe(tabId),
    harnessFactory,
    gateway,
    observationPipeline,
    completionEvaluator: new CompletionEvaluator(),
    verificationRunner,
    featureFlags,
    policyVersion: policy.version,
    publish: (ownerWindowId, event) => {
      const win = BrowserWindow.fromId(ownerWindowId)
      if (win && !win.isDestroyed()) win.webContents.send('agent:event', event)
    }
  })
  execution.setProgressHandler((session, intent, value) => manager.reportProgress(session, intent, value))
  const unregisterIpc = registerAgentIpc({ ipcMain, manager, evidenceStore })
  const unregisterCodexIpc = registerCodexIpc({ ipcMain, manager: codexManager, openExternal: url => shell.openExternal(url) })
  const publishAccountEvent = event => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('codex:account-event', event)
    }
  }
  codexManager.on('accountEvent', publishAccountEvent)
  const disposeOnQuit = () => instance?.dispose()
  app.once('before-quit', disposeOnQuit)
  const recovered = manager.recover()
  evidenceCleaner.start()
  audit.cleanup()
  store.cleanup()
  instance = {
    root,
    store,
    evidenceStore,
    audit,
    policyEngine,
    registry,
    gateway,
    manager,
    profileStore,
    codexManager,
    recovered,
    registerMcpTools: tools => registerMcpTools(registry, tools),
    refreshConfig: nextConfig => {
      if ([...manager.sessions.values()].some(runtime => !runtime.finished)) {
        return { deferred: true }
      }
      const nextFeatureFlags = normalizeFeatureFlags(nextConfig || {})
      const nextPolicy = new PolicyLoader(root, {
        ...nextFeatureFlags,
        commandBlacklist: nextConfig?.commandBlacklist,
        commandWhitelist: nextConfig?.commandWhitelist
      }).load()
      manager.featureFlags = nextFeatureFlags
      manager.policyVersion = nextPolicy.version
      policyEngine.policy = nextPolicy
      return nextFeatureFlags
    },
    dispose: () => {
      app.removeListener('before-quit', disposeOnQuit)
      unregisterIpc()
      unregisterCodexIpc()
      codexManager.removeListener('accountEvent', publishAccountEvent)
      codexManager.dispose().catch(() => {})
      evidenceCleaner.stop()
      bridge.dispose()
      instance = null
    }
  }
  return instance
}

function getAgentRuntime () {
  return instance
}

module.exports = { initAgentRuntime, getAgentRuntime }
