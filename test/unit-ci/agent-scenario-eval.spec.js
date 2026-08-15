const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const scenarios = require('../fixtures/agent-scenarios.json')
const { SessionStore } = require('../../src/app/agent/session/session-store')
const { EvidenceStore } = require('../../src/app/agent/evidence/evidence-store')
const { AuditLog } = require('../../src/app/agent/audit/audit-log')
const { ToolRegistry } = require('../../src/app/agent/tools/registry')
const { registerSessionTools } = require('../../src/app/agent/tools/builtin/session-tools')
const { registerShellTools } = require('../../src/app/agent/tools/builtin/shell-tools')
const { registerServiceTools } = require('../../src/app/agent/tools/builtin/service-tools')
const { registerDockerTools } = require('../../src/app/agent/tools/builtin/docker-tools')
const { ToolGateway } = require('../../src/app/agent/tools/gateway')
const { PolicyEngine } = require('../../src/app/agent/policy/policy-engine')
const { CapabilityTokenManager } = require('../../src/app/agent/approval/capability-token')
const { ApprovalManager } = require('../../src/app/agent/approval/approval-manager')
const { ExecutionRuntime } = require('../../src/app/agent/execution/execution-runtime')
const { SshExecAdapter } = require('../../src/app/agent/execution/ssh-exec-adapter')
const { ObservationPipeline } = require('../../src/app/agent/observation/observation-pipeline')
const { CompletionEvaluator } = require('../../src/app/agent/verification/completion-evaluator')
const { VerificationRunner } = require('../../src/app/agent/verification/verification-runner')
const { AgentSessionManager } = require('../../src/app/agent/session/session-manager')

test('deterministic scenario dataset measures evidence-led completion and safety stops', async t => {
  const results = []
  for (const scenario of scenarios) results.push(await runScenario(t, scenario))
  assert.deepEqual(results.map(item => item.status), scenarios.map(item => item.expectedStatus), JSON.stringify(results))
  assert.equal(results.filter(item => item.expectedMatched).length, scenarios.length)
  assert.equal(results.find(item => item.id === 'bounded-session-profile').evidenceRefs > 0, true)
  assert.match(results.find(item => item.id === 'bounded-docker-list-after-settings-refresh').conclusion, /nginx-lb/)
  assert.equal(results.find(item => item.id === 'bounded-docker-list-after-settings-refresh').harnessCalls, 0)
  assert.match(results.find(item => item.id === 'bounded-docker-nginx-config').conclusion, /worker_processes auto/)
  assert.equal(results.find(item => item.id === 'bounded-docker-nginx-config').harnessCalls, 0)
  assert.equal(results.find(item => item.id === 'destructive-command-blocked').approvalRequests, 0)
  assert.equal(results.find(item => item.id === 'repeated-probe-no-progress').reason, 'no_progress_loop')
  assert.equal(results.find(item => item.id === 'exit-zero-verification-failed').verificationFailures, 1)
})

async function runScenario (t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `electerm-agent-eval-${scenario.id}-`))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const sessionBinding = binding()
  const store = new SessionStore(root)
  const evidenceStore = new EvidenceStore(root)
  const audit = new AuditLog(root)
  const registry = new ToolRegistry()
  const secret = crypto.randomBytes(32)
  const capabilities = new CapabilityTokenManager(secret)
  const childCapabilities = new CapabilityTokenManager(secret)
  const bridge = {
    describe: async () => sessionBinding,
    exec: async payload => {
      assert.equal(payload.expected.policyVersion, 'scenario-policy')
      childCapabilities.verifyExternal(payload.capability, payload.expected, { consume: true })
      if (scenario.kind === 'docker_nginx_config') {
        assert.match(payload.command, /docker exec -- 'nginx-lb' nginx -T/)
        return {
          stdout: 'nginx: configuration file /etc/nginx/nginx.conf test is successful\nworker_processes auto;\nevents {}\nhttp { server { listen 80; } }',
          stderr: '',
          exitCode: 0
        }
      }
      assert.match(payload.command, /docker ps -a/)
      return {
        stdout: [
          'abc123\tnginx-lb\tnginx:1.27\trunning\tUp 2 hours\t0.0.0.0:80->80/tcp',
          'def456\tnginx-sidecar\tnginx:1.27\texited\tExited (0) 1 hour ago\t'
        ].join('\n'),
        stderr: '',
        exitCode: 0
      }
    }
  }
  registerSessionTools(registry, bridge)
  registerShellTools(registry, { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) })
  registerServiceTools(registry, { execute: async () => ({ stdout: 'Id=nginx\nActiveState=inactive\nSubState=dead', stderr: '', exitCode: 0 }) })
  registerDockerTools(registry, new SshExecAdapter(bridge, 'policy-before-settings-save'))
  const gateway = new ToolGateway({
    registry,
    policyEngine: new PolicyEngine({ policy: { version: 'scenario-policy', mutationEnabled: true, externalMcpEnabled: false, r4ApprovalEnabled: true, userRules: [] } }),
    approvals: new ApprovalManager(capabilities),
    capabilities,
    runtime: new ExecutionRuntime(),
    audit
  })
  const observationPipeline = new ObservationPipeline({ evidenceStore, audit })
  let turn = 0
  const harness = {
    getCapabilities: () => ({ maxContextTokens: 32000 }),
    runTurn: async function * (input) {
      turn++
      yield { type: 'decision', decision: decisionFor(scenario, input, turn) }
    },
    dispose: async () => {}
  }
  const harnessFactory = {
    selection: () => ({ adapter: 'strict_json', modelId: 'deterministic-model', providerId: 'local-test', supportsNativeTools: false, supportsStructuredOutput: false, maxContextTokens: 32000 }),
    create: async () => harness
  }
  let terminalResolve
  const terminalEvent = new Promise(resolve => { terminalResolve = resolve })
  let approvalRequests = 0
  let approvalError
  const manager = new AgentSessionManager({
    store,
    evidenceStore,
    bindingResolver: async () => sessionBinding,
    harnessFactory,
    gateway,
    observationPipeline,
    completionEvaluator: new CompletionEvaluator(),
    verificationRunner: new VerificationRunner(gateway, observationPipeline),
    featureFlags: { agentModeEnabled: true },
    policyVersion: 'scenario-policy',
    publish: (_owner, event) => {
      if (event.type === 'approval.requested') approvalRequests++
      if (event.type === 'approval.requested' && scenario.kind === 'verification_failure') {
        Promise.resolve().then(async () => {
          const snapshot = manager.getSnapshot(event.taskId, 1).snapshot
          await manager.control({
            schemaVersion: 1,
            taskId: event.taskId,
            expectedSnapshotVersion: snapshot.snapshotVersion,
            action: 'resolve_approval',
            decision: {
              approvalRequestId: event.payload.approvalRequestId,
              choice: 'approve_once',
              intentDigest: event.payload.intentDigest,
              decidedAt: new Date().toISOString()
            }
          }, 1)
        }).catch(error => {
          approvalError = error
          terminalResolve(event)
        })
      }
      if (['session.completed', 'session.failed', 'session.cancelled'].includes(event.type)) terminalResolve(event)
    }
  })
  const response = await manager.start({
    schemaVersion: 1,
    clientRequestId: `client_${scenario.id}`,
    tabId: sessionBinding.tabId,
    prompt: scenario.objective,
    mode: scenario.kind === 'r5_blocked' ? 'operate' : 'diagnose',
    uiLocale: 'zh-CN'
  }, 1)
  try {
    await withTimeout(terminalEvent, 3000, scenario.id)
  } catch (error) {
    const current = manager.getSnapshot(response.taskId, 1).snapshot
    error.message += ` (status=${current.status}, reason=${current.statusReason?.code || 'none'})`
    throw error
  }
  if (approvalError) throw approvalError
  const snapshot = manager.getSnapshot(response.taskId, 1).snapshot
  return {
    id: scenario.id,
    status: snapshot.status,
    reason: snapshot.statusReason?.code,
    expectedMatched: snapshot.status === scenario.expectedStatus,
    evidenceRefs: snapshot.evidenceRefs.length,
    approvalRequests,
    verificationFailures: snapshot.finalResult?.operations?.filter(item => item.verificationStatus === 'failed').length || 0,
    harnessCalls: turn,
    conclusion: snapshot.finalResult?.conclusion || ''
  }
}

function decisionFor (scenario, input, turn) {
  const base = {
    schemaVersion: 1,
    planSummary: scenario.objective,
    reasonSummary: 'deterministic scenario decision',
    knownFactIds: [],
    missingInformation: [],
    completionCriteria: []
  }
  if (scenario.kind === 'invalid_model') return { ...base, goalStatus: 'continue' }
  if (scenario.kind === 'insufficient') return { ...base, goalStatus: 'complete' }
  if (scenario.kind === 'r5_blocked') {
    return {
      ...base,
      goalStatus: 'continue',
      expectedObservation: 'command must be blocked',
      action: {
        schemaVersion: 1,
        taskId: input.taskId,
        invocationId: 'invocation_model_placeholder',
        toolName: 'shell.exec',
        toolVersion: '1',
        arguments: { command: 'rm -rf /' },
        target: { kind: 'file', canonicalId: '/', display: '/' },
        purpose: 'delete root filesystem',
        expectedObservation: 'operation is blocked'
      }
    }
  }
  if (scenario.kind === 'no_progress') return sessionProbeDecision(base, input)
  if (scenario.kind === 'docker_read') {
    if (turn === 1) {
      return {
        ...base,
        goalStatus: 'continue',
        missingInformation: ['当前主机上的 Docker 容器列表'],
        completionCriteria: [{
          criterionId: 'criterion_docker_list',
          statement: '匹配的 nginx 容器列表已有执行证据',
          critical: true,
          status: 'pending',
          evidenceRefs: []
        }],
        expectedObservation: 'bounded Docker container list',
        action: {
          schemaVersion: 1,
          taskId: input.taskId,
          invocationId: 'invocation_model_placeholder',
          toolName: 'docker.list',
          toolVersion: '1',
          arguments: { state: 'all', limit: 100 },
          target: { kind: 'container', canonicalId: 'nginx', display: 'nginx containers' },
          purpose: 'list Docker containers and identify nginx matches',
          expectedObservation: 'container names, images and states'
        }
      }
    }
    const fact = input.workingMemory.facts[0]
    return {
      ...base,
      goalStatus: 'complete',
      knownFactIds: fact ? [fact.factId] : [],
      completionCriteria: [{
        criterionId: 'criterion_docker_list',
        statement: '匹配的 nginx 容器列表已有执行证据',
        critical: true,
        status: fact ? 'passed' : 'inconclusive',
        evidenceRefs: fact?.evidenceRefs || []
      }]
    }
  }
  if (scenario.kind === 'verification_failure') {
    return {
      ...base,
      goalStatus: 'continue',
      expectedObservation: 'restart command returns, then service status is verified',
      action: {
        schemaVersion: 1,
        taskId: input.taskId,
        invocationId: 'invocation_model_placeholder',
        toolName: 'shell.exec',
        toolVersion: '1',
        arguments: { command: 'systemctl restart nginx' },
        target: { kind: 'service', canonicalId: 'nginx', display: 'nginx' },
        purpose: 'restart nginx',
        expectedObservation: 'command exits successfully',
        verificationPlan: {
          planId: 'plan_verification_failure',
          preconditions: [],
          postconditions: [{
            checkId: 'check_nginx_active',
            description: 'nginx must be active',
            intent: {
              toolName: 'service.status',
              arguments: { service: 'nginx' },
              target: { kind: 'service', canonicalId: 'nginx', display: 'nginx' },
              purpose: 'verify nginx state'
            },
            predicate: { operator: 'match', path: 'stdout', expected: 'ActiveState=active' },
            critical: true
          }],
          successExpression: 'all critical checks pass'
        }
      }
    }
  }
  if (turn === 1) {
    return sessionProbeDecision(base, input)
  }
  const fact = input.workingMemory.facts[0]
  return {
    ...base,
    goalStatus: 'complete',
    knownFactIds: fact ? [fact.factId] : [],
    completionCriteria: [{
      criterionId: 'criterion_session_identity',
      statement: 'current session identity is evidenced',
      critical: true,
      status: fact ? 'passed' : 'inconclusive',
      evidenceRefs: fact?.evidenceRefs || []
    }]
  }
}

function sessionProbeDecision (base, input) {
  return {
    ...base,
    goalStatus: 'continue',
    expectedObservation: 'bound session identity',
    action: {
      schemaVersion: 1,
      taskId: input.taskId,
      invocationId: 'invocation_model_placeholder',
      toolName: 'session.describe',
      toolVersion: '1',
      arguments: {},
      target: { kind: 'session', canonicalId: input.taskId, display: 'current terminal session' },
      purpose: 'read the bound session identity',
      expectedObservation: 'host, user and cwd'
    }
  }
}

function binding () {
  return {
    tabId: 'tab_scenario_12345',
    connectionId: 'connection_scenario_12345',
    sessionPid: 'session_scenario_12345',
    host: 'scenario.example.test',
    port: 22,
    username: 'tester',
    cwd: '/srv/app',
    shell: '/bin/bash',
    platform: 'linux',
    bindingConfidence: 'strong',
    capturedAt: new Date().toISOString()
  }
}

function withTimeout (promise, timeoutMs, label) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`scenario timed out: ${label}`)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
