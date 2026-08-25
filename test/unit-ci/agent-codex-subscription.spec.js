const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough, Writable } = require('node:stream')
const { normalizeAiBackendSelection, normalizeLegacyAgentConfig } = require('../../src/app/agent/config')
const { CodexProfileStore } = require('../../src/app/agent/providers/codex-profile-store')
const { CodexJsonRpcClient, buildLaunchSpec, minimalEnvironment, sanitizeErrorText } = require('../../src/app/agent/providers/codex-jsonrpc-client')
const { handleCodexServerRequest } = require('../../src/app/agent/providers/codex-tool-bridge')
const {
  CodexAppServerManager,
  PLANNING_ONLY_CONFIG,
  safeAuthUrl
} = require('../../src/app/agent/providers/codex-app-server-manager')
const { findLocalCodexExecutable } = require('../../src/app/agent/providers/codex-runtime-manager')
const { CodexAppServerHarnessAdapter } = require('../../src/app/agent/harness/codex-app-server-adapter')
const {
  CodexPlannerOutputSchema,
  decodeCodexPlannerDecision
} = require('../../src/app/agent/providers/codex-planner-protocol')
process.env.NODE_ENV = process.env.NODE_ENV || 'development'
const { HarnessFactory } = require('../../src/app/agent/harness/harness-factory')

function temporaryStore (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-codex-profiles-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, store: new CodexProfileStore(root) }
}

test('AI backend selection is exclusive and preserves legacy defaults', () => {
  assert.deepEqual(normalizeAiBackendSelection({}), {
    schemaVersion: 1,
    type: 'openai_compatible',
    codexProfileId: undefined
  })
  assert.deepEqual(normalizeAiBackendSelection({
    aiBackendType: 'codex_subscription',
    codexProfileId: 'codex_profile_12345',
    apiKeyAI: 'preserved-but-inactive'
  }), {
    schemaVersion: 1,
    type: 'codex_subscription',
    codexProfileId: 'codex_profile_12345'
  })
})

test('blank AI defaults recover the newest protected API configuration without overwriting valid current state', async () => {
  const { recoverAiConfigFromHistory } = await import('../../src/client/components/ai/ai-config-recovery.mjs')
  const newest = {
    aiBackendType: 'openai_compatible',
    baseURLAI: 'https://api.example.test/v1',
    apiPathAI: '/chat/completions',
    modelAI: 'newest-model',
    roleAI: 'terminal expert',
    apiKeyAI: 'recoverable-secret',
    authHeaderNameAI: 'Authorization: Bearer',
    languageAI: 'Chinese',
    agentModeEnabled: true,
    agentMutationEnabled: false
  }
  const recovered = recoverAiConfigFromHistory({
    baseURLAI: 'https://api.atlascloud.ai/v1',
    modelAI: 'deepseek-chat',
    apiKeyAI: '',
    codexProfileId: '',
    agentModeEnabled: false
  }, [newest, { ...newest, modelAI: 'older-model' }])
  assert.equal(recovered.recovered, true)
  assert.equal(recovered.patch.modelAI, 'newest-model')
  assert.equal(recovered.patch.apiKeyAI, 'recoverable-secret')
  assert.equal(recovered.patch.agentModeEnabled, true)
  assert.equal(recovered.patch.aiBackendType, 'openai_compatible')

  assert.equal(recoverAiConfigFromHistory({ ...newest }, [{ ...newest, modelAI: 'must-not-win' }]).recovered, false)
  assert.equal(recoverAiConfigFromHistory({ codexProfileId: 'codex_profile_12345', agentModeEnabled: false }, [newest]).recovered, false)
  assert.equal(recoverAiConfigFromHistory({}, [{ baseURLAI: 'https://api.example.test/v1', modelAI: 'missing-key' }]).recovered, false)
})

test('AI settings submission removes legacy harness fields and refreshes live Agent flags', () => {
  const formSource = fs.readFileSync(path.join(__dirname, '../../src/client/components/ai/ai-config.jsx'), 'utf8')
  const modalSource = fs.readFileSync(path.join(__dirname, '../../src/client/components/ai/ai-config-modal.jsx'), 'utf8')
  const runtimeSource = fs.readFileSync(path.join(__dirname, '../../src/app/agent/index.js'), 'utf8')
  const refreshSource = fs.readFileSync(path.join(__dirname, '../../src/app/agent/runtime-config-refresh.js'), 'utf8')
  const persistenceSource = fs.readFileSync(path.join(__dirname, '../../src/app/lib/user-config-controller.js'), 'utf8')
  assert.match(formSource, /delete safeInitialValues\.agentHarnessAdapter/)
  assert.match(formSource, /delete safeInitialValues\.agentCompatibleFallbackEnabled/)
  assert.doesNotMatch(formSource, /name='agentHarnessAdapter'/)
  assert.match(formSource, /await onSubmit\(normalized\)/)
  assert.match(modalSource, /await window\.pre\.runGlobalAsync\('saveUserConfig', nextConfig\)/)
  assert.ok(modalSource.indexOf("await window.pre.runGlobalAsync('saveUserConfig', nextConfig)") < modalSource.indexOf('message.success'))
  assert.match(runtimeSource, /refreshConfig: nextConfig => configRefresher\.refresh\(nextConfig\)/)
  assert.match(refreshSource, /status !== 'paused'/)
  assert.match(refreshSource, /pendingConfig = config/)
  assert.match(persistenceSource, /getAgentRuntime\(\)\?\.refreshConfig\(userConfig\)/)
})

test('Electron E2E data is isolated from the real OpsHalo user database', () => {
  const appOptionsSource = fs.readFileSync(path.join(__dirname, '../e2e/common/app-options.js'), 'utf8')
  assert.match(appOptionsSource, /DATA_PATH:\s*e2eDataPath/)
  assert.match(appOptionsSource, /\.opshalo-e2e-data/)
})

test('legacy Strands config migrates without changing accounts or Agent state', async () => {
  const config = {
    aiBackendType: 'codex_subscription',
    codexProfileId: 'codex_profile_12345',
    agentHarnessAdapter: 'strands',
    agentCompatibleFallbackEnabled: true,
    agentModeEnabled: true,
    baseURLAI: 'https://api.example.test/v1',
    modelAI: 'inactive-api-model'
  }
  const migrated = normalizeLegacyAgentConfig(config)
  assert.equal(migrated.agentHarnessAdapter, undefined)
  assert.equal(migrated.agentCompatibleFallbackEnabled, undefined)
  assert.equal(migrated.codexProfileId, config.codexProfileId)
  assert.equal(migrated.agentModeEnabled, config.agentModeEnabled)
  const factory = new HarnessFactory(() => config, { codexManager: {} })
  const selection = factory.selection()
  assert.equal(selection.adapter, 'codex_app_server')
  assert.equal(selection.profileId, 'codex_profile_12345')
  const adapter = await factory.create({ harness: selection })
  assert.ok(adapter instanceof CodexAppServerHarnessAdapter)
  config.aiBackendType = 'openai_compatible'
  assert.equal(factory.selection().adapter, 'openai_compatible')
  const legacyTaskAdapter = await factory.create({
    harness: {
      adapter: 'strands',
      modelId: 'legacy-model',
      providerId: 'legacy-provider',
      supportsNativeTools: false,
      supportsStructuredOutput: true,
      maxContextTokens: 32000
    }
  })
  assert.equal(legacyTaskAdapter.constructor.name, 'OpenAICompatibleHarnessAdapter')
  assert.equal(selection.adapter, 'codex_app_server')
})

test('profile store persists only sanitized metadata in isolated account homes', t => {
  const { root, store } = temporaryStore(t)
  const first = store.create('Primary Plus')
  const second = store.create('Secondary Plus')
  const updated = store.update(first.profileId, {
    email: 'person@example.com',
    planType: 'plus',
    authState: 'authenticated',
    rateLimits: { primary: { usedPercent: 23.6, resetsAt: 2000000000 } },
    access_token: 'must-never-be-stored',
    refresh_token: 'must-never-be-stored'
  })
  assert.equal(updated.maskedEmail, 'pe***@example.com')
  assert.equal(updated.rateLimits.primary.usedPercent, 24)
  store.select(second.profileId)
  assert.equal(store.list().currentProfileId, second.profileId)
  for (const profile of store.list().profiles) {
    const paths = store.paths(profile.profileId)
    assert.ok(fs.statSync(paths.codexHome).isDirectory())
    assert.ok(fs.statSync(paths.runtime).isDirectory())
  }
  const raw = fs.readFileSync(path.join(root, 'profiles.json'), 'utf8')
  assert.doesNotMatch(raw, /person@example\.com|must-never-be-stored|access_token|refresh_token/)
  assert.match(raw, /pe\*\*\*@example\.com/)
  store.delete(second.profileId)
  assert.equal(store.get(second.profileId), undefined)
  assert.equal(fs.existsSync(store.paths(second.profileId).profileRoot), false)
  assert.equal(store.list().currentProfileId, first.profileId)
})

test('profile store quarantines corrupt metadata and fails closed on permission errors', t => {
  const { root, store } = temporaryStore(t)
  store.create('Will be quarantined')
  fs.writeFileSync(path.join(root, 'profiles.json'), '{broken-json')
  const recovered = new CodexProfileStore(root)
  assert.equal(recovered.list().profiles.length, 0)
  assert.ok(fs.readdirSync(root).some(name => name.includes('.corrupt')))

  const deniedRoot = path.join(root, 'permission-denied')
  const deniedFs = {
    ...fs,
    chmodSync () {
      const error = new Error('permission denied')
      error.code = 'EACCES'
      throw error
    }
  }
  assert.throws(() => new CodexProfileStore(deniedRoot, { fs: deniedFs }), error => error.code === 'EACCES')
})

test('App Server environment excludes inherited credentials and sanitizes diagnostics', () => {
  const env = minimalEnvironment({
    PATH: 'test-path',
    HOME: '/home/test',
    OPENAI_API_KEY: 'sk-secret',
    CODEX_API_KEY: 'codex-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret'
  }, '/isolated/codex-home')
  assert.equal(env.PATH, 'test-path')
  assert.equal(env.CODEX_HOME, '/isolated/codex-home')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.CODEX_API_KEY, undefined)
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
  assert.doesNotMatch(sanitizeErrorText('Authorization: Bearer abcdef token=secret-value'), /abcdef|secret-value/)
  const launch = buildLaunchSpec('C:\\Program Files\\Codex\\codex.cmd', ['app-server', '--listen', 'stdio://'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
  assert.equal(launch.executable, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.match(launch.args[3], /^""C:\\Program Files/)
})

test('an existing local Codex CLI is discovered before a download', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-local-codex-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const executable = path.join(root, process.platform === 'win32' ? 'codex.exe' : 'codex')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(executable, 'test')
  assert.equal(findLocalCodexExecutable({ platform: process.platform, pathValue: root, home: root }), executable)
  assert.equal(findLocalCodexExecutable({ platform: process.platform, pathValue: '', home: path.join(root, 'empty'), includeCommon: false }), undefined)
})

test('planning boundary disables local tools and rejects App Server execution requests', async () => {
  assert.equal(PLANNING_ONLY_CONFIG.features.shell_tool, false)
  assert.equal(PLANNING_ONLY_CONFIG.features.unified_exec, false)
  assert.equal(PLANNING_ONLY_CONFIG.features.apps, false)
  assert.equal(PLANNING_ONLY_CONFIG.features.multi_agent, false)
  assert.equal(Object.hasOwn(PLANNING_ONLY_CONFIG, 'agents'), false)
  assert.equal(PLANNING_ONLY_CONFIG.web_search, 'disabled')
  const events = []
  assert.deepEqual(handleCodexServerRequest({ method: 'item/commandExecution/requestApproval' }, event => events.push(event)), { decision: 'cancel' })
  assert.deepEqual(handleCodexServerRequest({ method: 'item/fileChange/requestApproval' }, event => events.push(event)), { decision: 'cancel' })
  assert.deepEqual(handleCodexServerRequest({ method: 'item/permissions/requestApproval' }, event => events.push(event)), { permissions: {}, scope: 'turn' })
  assert.deepEqual(handleCodexServerRequest({ method: 'item/tool/requestUserInput' }, event => events.push(event)), { answers: {} })
  assert.deepEqual(handleCodexServerRequest({ method: 'item/tool/requestOptionPicker' }, event => events.push(event)), { action: 'dismiss', selectedOptions: [], freeformAnswer: null })
  assert.deepEqual(handleCodexServerRequest({ method: 'item/tool/requestSetupCodexContextPicker' }, event => events.push(event)), { action: 'dismiss', selectedSources: [] })
  assert.deepEqual(handleCodexServerRequest({ method: 'mcpServer/elicitation/request' }, event => events.push(event)), { action: 'decline' })
  assert.equal(typeof handleCodexServerRequest({ method: 'currentTime/read' }).currentTimeAt, 'number')
  assert.deepEqual(handleCodexServerRequest({ method: 'item/plan/requestImplementation' }, event => events.push(event)), { decision: 'cancel' })
  const dynamic = handleCodexServerRequest({ method: 'item/tool/call' }, event => events.push(event))
  assert.equal(dynamic.success, false)
  assert.deepEqual(events.map(event => event.type), [
    'codex_local_execution_denied',
    'codex_local_execution_denied',
    'codex_permission_request_denied',
    'codex_user_input_request_denied',
    'codex_option_picker_denied',
    'codex_context_picker_denied',
    'codex_mcp_elicitation_denied',
    'codex_legacy_or_plan_request_denied',
    'codex_dynamic_tool_denied'
  ])
  assert.throws(() => handleCodexServerRequest({ method: 'unknown/request' }), error => error.code === -32601)
})

test('JSON-RPC client performs initialize handshake and safely resolves App Server requests', async t => {
  const transcript = []
  let child
  const spawnImpl = () => {
    child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdin = new Writable({
      write (chunk, _encoding, callback) {
        for (const line of String(chunk).trim().split(/\r?\n/).filter(Boolean)) {
          const message = JSON.parse(line)
          transcript.push(message)
          if (message.method === 'initialize') {
            queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'fake' } })}\n`))
          } else if (message.method === 'account/read') {
            queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: { account: null, requiresOpenaiAuth: true } })}\n`))
          }
        }
        callback()
      },
      final (callback) {
        queueMicrotask(() => child.emit('exit', 0, null))
        callback()
      }
    })
    child.kill = () => {
      queueMicrotask(() => child.emit('exit', 0, null))
      return true
    }
    return child
  }
  const client = new CodexJsonRpcClient({
    executable: 'fake-codex',
    cwd: os.tmpdir(),
    codexHome: path.join(os.tmpdir(), 'fake-codex-home'),
    spawnImpl,
    requestHandler: request => handleCodexServerRequest(request)
  })
  t.after(() => client.dispose())
  await client.start()
  const account = await client.request('account/read', { refreshToken: false })
  assert.equal(account.requiresOpenaiAuth, true)
  const serverErrors = []
  client.on('codex/server-error', params => serverErrors.push(params))
  child.stdout.write(`${JSON.stringify({ method: 'error', params: { error: { message: 'temporary failure' }, willRetry: true } })}\n`)
  child.stdout.write(`${JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: { command: 'whoami' } })}\n`)
  child.stdout.write(`${JSON.stringify({ id: 100, method: 'item/permissions/requestApproval', params: { permissions: { shell: true } } })}\n`)
  child.stdout.write(`${JSON.stringify({ id: 101, method: 'item/tool/requestUserInput', params: { questions: [] } })}\n`)
  child.stdout.write(`${JSON.stringify({ id: 102, method: 'item/tool/requestOptionPicker', params: { options: [] } })}\n`)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(transcript[0].method, 'initialize')
  assert.equal(transcript[1].method, 'initialized')
  assert.ok(transcript.some(message => message.id === 99 && message.result?.decision === 'cancel'))
  assert.ok(transcript.some(message => message.id === 100 && message.result?.scope === 'turn' && Object.keys(message.result.permissions || {}).length === 0))
  assert.ok(transcript.some(message => message.id === 101 && Object.keys(message.result?.answers || {}).length === 0))
  assert.ok(transcript.some(message => message.id === 102 && message.result?.action === 'dismiss'))
  assert.equal(serverErrors.length, 1)
  assert.equal(serverErrors[0].willRetry, true)
  await assert.rejects(
    client.request('never/responds', {}, { timeoutMs: 5 }),
    error => error.code === 'CODEX_APP_SERVER_TIMEOUT'
  )

  const waiting = client.waitForNotification('turn/completed', () => true, { timeoutMs: 10000 })
  child.emit('exit', 1, null)
  await assert.rejects(waiting, error => error.code === 'CODEX_APP_SERVER_EXITED')
})

test('official login can be cancelled and timeout state is sanitized', async t => {
  const { store } = temporaryStore(t)
  let shouldTimeout = false
  const client = new EventEmitter()
  client.start = async () => client
  client.request = async method => {
    if (method === 'account/login/start') {
      if (shouldTimeout) throw Object.assign(new Error('raw token=secret-value timeout'), { code: 'CODEX_APP_SERVER_TIMEOUT' })
      return { type: 'chatgpt', loginId: 'login_test_12345', authUrl: 'https://auth.openai.com/oauth/authorize' }
    }
    if (method === 'account/login/cancel') return {}
    throw new Error(`unexpected request: ${method}`)
  }
  client.dispose = async () => {}
  const manager = new CodexAppServerManager({
    profileStore: store,
    clientFactory: () => client,
    getConfig: () => ({ codexAppServerExecutable: process.execPath })
  })
  const login = await manager.startLogin({ displayName: 'Login test', method: 'browser' })
  assert.equal(store.get(login.profileId).authState, 'authorizing')
  await manager.cancelLogin({ profileId: login.profileId, loginId: login.loginId })
  assert.equal(store.get(login.profileId).authState, 'unauthenticated')

  shouldTimeout = true
  await assert.rejects(
    manager.startLogin({ profileId: login.profileId, method: 'browser' }),
    error => error.code === 'CODEX_APP_SERVER_TIMEOUT'
  )
  const failed = store.get(login.profileId)
  assert.equal(failed.authState, 'error')
  assert.doesNotMatch(failed.error, /secret-value/)
  await manager.dispose()
})

test('manager sends a tool-free planning turn and returns only a structured PlannerDecision', async t => {
  const { store } = temporaryStore(t)
  const profile = store.create('Planner')
  store.update(profile.profileId, { authState: 'authenticated', planType: 'plus', email: 'test@example.com' })
  const calls = []
  const client = new EventEmitter()
  client.start = async () => client
  client.request = async (method, params) => {
    calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'test@example.com', planType: 'plus' }, requiresOpenaiAuth: true }
    if (method === 'thread/start') return { thread: { id: 'thread_test_12345' } }
    if (method === 'turn/start') return { turn: { id: 'turn_test_12345' } }
    throw new Error(`unexpected request: ${method}`)
  }
  client.waitForNotification = async () => ({
    threadId: 'thread_test_12345',
    turn: {
      id: 'turn_test_12345',
      status: 'completed',
      items: [{
        type: 'agentMessage',
        text: JSON.stringify({
          schemaVersion: 1,
          goalStatus: 'need_user',
          planSummary: 'need target',
          reasonSummary: 'target is missing',
          knownFactIds: [],
          missingInformation: ['target service'],
          expectedObservation: null,
          action: null,
          completionCriteria: [],
          userQuestion: '需要检查哪个服务？'
        })
      }]
    }
  })
  client.interrupt = async () => {}
  client.dispose = async () => {}
  const manager = new CodexAppServerManager({
    profileStore: store,
    clientFactory: () => client,
    getConfig: () => ({ codexAppServerExecutable: process.execPath })
  })
  const progress = []
  const result = await manager.runPlannerTurn(profile.profileId, {
    schemaVersion: 1,
    taskId: 'task_codex_12345',
    objective: '诊断服务异常',
    mode: 'diagnose',
    sessionSummary: { host: 'example.test', username: 'root', cwd: '/root', shell: '/bin/bash', platform: 'linux' },
    workingMemory: {},
    budgetRemaining: { reactSteps: 10 },
    availableTools: [{ name: 'service.status' }]
  }, undefined, status => progress.push(status))
  assert.equal(result.decision.goalStatus, 'need_user')
  assert.deepEqual(progress.map(item => item.phase), ['connecting', 'authenticating', 'preparing', 'thinking'])
  const threadStart = calls.find(call => call.method === 'thread/start').params
  assert.equal(threadStart.config.features.shell_tool, false)
  assert.equal(threadStart.config.apps._default.enabled, false)
  assert.equal(Object.hasOwn(threadStart.config, 'agents'), false)
  const turnStart = calls.find(call => call.method === 'turn/start').params
  assert.deepEqual(turnStart.sandboxPolicy, { type: 'readOnly', networkAccess: false })
  assert.equal(turnStart.outputSchema.type, 'object')
  assert.ok(turnStart.outputSchema.required.includes('goalStatus'))
  assert.ok(turnStart.outputSchema.required.includes('action'))
  assertNoSchemaKeyword(turnStart.outputSchema, 'propertyNames')
  assertNoSchemaKeyword(turnStart.outputSchema, 'allOf')
  assert.doesNotMatch(turnStart.input[0].text, /<REQUIRED_OUTPUT_SCHEMA>/)
  assert.match(turnStart.input[0].text, /argumentsJson/)
  await manager.dispose()
})

test('Codex structured output uses the supported strict subset and decodes trusted envelope fields', () => {
  assertNoSchemaKeyword(CodexPlannerOutputSchema, 'propertyNames')
  assertNoSchemaKeyword(CodexPlannerOutputSchema, 'allOf')
  assertAllObjectPropertiesRequired(CodexPlannerOutputSchema)
  const decision = decodeCodexPlannerDecision({
    schemaVersion: 1,
    goalStatus: 'continue',
    planSummary: 'inspect host',
    reasonSummary: 'need bounded host facts',
    knownFactIds: [],
    missingInformation: ['host profile'],
    expectedObservation: 'host facts',
    action: {
      toolName: 'host.profile',
      toolVersion: '1.0.0',
      argumentsJson: '{}',
      target: { kind: 'host', canonicalId: 'example.test', display: 'example.test' },
      requestedTimeoutMs: 10000,
      purpose: 'inspect host',
      expectedObservation: 'host facts',
      verificationPlanJson: null
    },
    completionCriteria: [],
    userQuestion: null
  }, { taskId: 'task_codex_decode_12345' })
  assert.equal(decision.action.taskId, 'task_codex_decode_12345')
  assert.match(decision.action.invocationId, /^invocation_/)
  assert.deepEqual(decision.action.arguments, {})
  assert.equal(decision.userQuestion, undefined)
})

test('Codex adapter streams safe lifecycle progress before the structured decision', async () => {
  const decision = {
    schemaVersion: 1,
    goalStatus: 'need_user',
    planSummary: 'need target',
    reasonSummary: 'target is missing',
    knownFactIds: [],
    missingInformation: ['target service'],
    completionCriteria: [],
    userQuestion: '需要检查哪个服务？'
  }
  const manager = {
    async runPlannerTurn (_profileId, _input, _signal, onProgress) {
      onProgress({ phase: 'connecting', message: '正在连接 Codex App Server…' })
      onProgress({ phase: 'thinking', message: 'AI 正在结合服务器上下文思考下一步…' })
      return { decision }
    },
    interruptTask: async () => {}
  }
  const adapter = new CodexAppServerHarnessAdapter({ manager, profileId: 'codex_profile_12345' })
  const events = []
  for await (const event of adapter.runTurn({ taskId: 'task_progress_12345' })) events.push(event)
  assert.deepEqual(events.map(event => event.type), ['phase', 'phase', 'decision.completed'])
  assert.equal(events[0].phase, 'connecting')
  assert.equal(events[2].decision.goalStatus, 'need_user')
})

test('account refresh remains authenticated when limits fail and active profiles cannot switch', async t => {
  const { store } = temporaryStore(t)
  const profile = store.create('Busy profile')
  const client = new EventEmitter()
  client.start = async () => client
  client.request = async method => {
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'person@example.com', planType: 'plus' }, requiresOpenaiAuth: true }
    if (method === 'account/rateLimits/read') throw Object.assign(new Error('rate limit service unavailable'), { code: 'CODEX_APP_SERVER_TIMEOUT' })
    throw new Error(`unexpected request: ${method}`)
  }
  client.dispose = async () => {}
  const manager = new CodexAppServerManager({
    profileStore: store,
    clientFactory: () => client,
    getConfig: () => ({ codexAppServerExecutable: process.execPath }),
    isProfileBusy: profileId => profileId === profile.profileId
  })
  const refreshed = await manager.refreshAccount(profile.profileId)
  assert.equal(refreshed.authState, 'authenticated')
  assert.match(refreshed.error, /rate limit service unavailable/)
  assert.throws(() => manager.selectProfile(profile.profileId), error => error.code === 'CODEX_PROFILE_BUSY')
  await assert.rejects(manager.removeProfile(profile.profileId), error => error.code === 'CODEX_PROFILE_BUSY')
  client.emit('exit', Object.assign(new Error('server crashed'), { safeMessage: 'App Server 已退出' }))
  assert.equal(store.get(profile.profileId).authState, 'error')
  await manager.dispose()
})

test('adapter maps Ctrl+C cancellation to App Server turn interruption', async () => {
  let interrupted
  const manager = {
    runPlannerTurn: () => new Promise(() => {}),
    interruptTask: async taskId => { interrupted = taskId }
  }
  const adapter = new CodexAppServerHarnessAdapter({ manager, profileId: 'codex_profile_12345' })
  const iterator = adapter.runTurn({ taskId: 'task_interrupt_12345' })
  const pending = iterator.next()
  await new Promise(resolve => setImmediate(resolve))
  await adapter.dispose()
  assert.equal(interrupted, 'task_interrupt_12345')
  pending.catch(() => {})
})

test('OAuth callback URLs are restricted to HTTPS or localhost HTTP', () => {
  assert.match(safeAuthUrl('https://auth.openai.com/oauth/authorize'), /^https:/)
  assert.match(safeAuthUrl('http://127.0.0.1:1455/auth/callback'), /^http:/)
  assert.throws(() => safeAuthUrl('http://attacker.example/auth'), error => error.code === 'CODEX_LOGIN_URL_INVALID')
  assert.throws(() => safeAuthUrl('file:///tmp/token'), error => error.code === 'CODEX_LOGIN_URL_INVALID')
})

function assertNoSchemaKeyword (value, keyword) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.hasOwn(value, keyword), false)
  for (const child of Object.values(value)) assertNoSchemaKeyword(child, keyword)
}

function assertAllObjectPropertiesRequired (value) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) return value.forEach(assertAllObjectPropertiesRequired)
  if (value.type === 'object' && value.properties) {
    assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort())
    assert.equal(value.additionalProperties, false)
  }
  for (const child of Object.values(value)) assertAllObjectPropertiesRequired(child)
}
