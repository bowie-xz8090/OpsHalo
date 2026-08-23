const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { ToolRegistry } = require('../../src/app/agent/tools/registry')
const { definition, objectSchema } = require('../../src/app/agent/tools/builtin/common')
const { ToolGateway } = require('../../src/app/agent/tools/gateway')
const { PolicyEngine } = require('../../src/app/agent/policy/policy-engine')
const { CapabilityTokenManager } = require('../../src/app/agent/approval/capability-token')
const { ApprovalManager } = require('../../src/app/agent/approval/approval-manager')
const { ExecutionRuntime } = require('../../src/app/agent/execution/execution-runtime')
const { ReadProbeBundleScheduler } = require('../../src/app/agent/execution/read-probe-bundle')

function session () {
  return {
    taskId: 'task_bundle_12345',
    featurePolicyVersion: 'bundle-policy',
    sessionBinding: {
      tabId: 'tab_bundle_12345',
      connectionId: 'connection_bundle_12345',
      sessionPid: 'session_bundle_12345',
      host: 'example.test',
      port: 22,
      username: 'tester',
      cwd: '/srv/app',
      shell: '/bin/bash',
      platform: 'linux',
      bindingConfidence: 'strong',
      capturedAt: new Date().toISOString()
    },
    budget: {
      maxReactSteps: 12,
      hardMaxReactSteps: 20,
      usedReactSteps: 0,
      maxAutoReadActions: 8,
      usedAutoReadActions: 0,
      maxEquivalentActionRepeats: 2,
      maxConsecutiveErrors: 3,
      consecutiveErrors: 0,
      taskDeadlineAt: new Date(Date.now() + 300000).toISOString(),
      capturedOutputBytes: 0
    }
  }
}

function intent (index, toolName = `probe.read_${index}`) {
  return {
    schemaVersion: 1,
    invocationId: `invocation_bundle_${index}`,
    taskId: 'task_bundle_12345',
    toolName,
    toolVersion: '1',
    arguments: {},
    target: { kind: 'host', canonicalId: 'example.test', display: 'example.test' },
    purpose: `read probe ${index}`,
    expectedObservation: `probe ${index} result`
  }
}

function bundle (toolNames = ['probe.read_0', 'probe.read_1', 'probe.read_2']) {
  return {
    schemaVersion: 1,
    bundleId: 'bundle_parallel_12345',
    actions: toolNames.map((toolName, index) => ({ intent: intent(index, toolName), dependsOn: [] }))
  }
}

function buildGateway (executorFor, auditRecords = []) {
  const registry = new ToolRegistry()
  for (let index = 0; index < 3; index++) {
    registry.register(definition({ name: `probe.read_${index}`, description: `probe ${index}`, inputSchema: objectSchema({}, []) }), context => executorFor(index, context))
  }
  registry.register(definition({
    name: 'probe.change',
    description: 'unsafe change',
    category: 'change',
    mutability: 'reversible',
    approval: 'always',
    parallelSafe: false,
    inputSchema: objectSchema({}, [])
  }), context => executorFor(9, context))
  const capabilities = new CapabilityTokenManager(crypto.randomBytes(32))
  return new ToolGateway({
    registry,
    policyEngine: new PolicyEngine({ policy: { version: 'bundle-policy', mutationEnabled: true, externalMcpEnabled: false, r4ApprovalEnabled: false, userRules: [] } }),
    approvals: new ApprovalManager(capabilities),
    capabilities,
    runtime: new ExecutionRuntime(),
    audit: { append: (type, payload) => auditRecords.push({ type, payload }) }
  })
}

function structuredResult (index) {
  return {
    stdout: JSON.stringify({ ok: true, data: { index }, warnings: [], meta: { source: `probe.read_${index}` } }),
    stderr: '',
    exitCode: 0,
    status: 'success'
  }
}

test('parallel read bundle enforces policy and budget per action, then merges in planned order', async () => {
  let active = 0
  let maxActive = 0
  const audit = []
  const delays = [30, 5, 1]
  const gateway = buildGateway(async index => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, delays[index]))
    active--
    return structuredResult(index)
  }, audit)
  const current = session()
  const result = await new ReadProbeBundleScheduler(gateway, { concurrency: 2 }).run(current, bundle())
  assert.equal(result.mode, 'parallel')
  assert.equal(maxActive, 2)
  assert.deepEqual(result.results.map(item => item.intent.invocationId), ['invocation_bundle_0', 'invocation_bundle_1', 'invocation_bundle_2'])
  assert.equal(current.budget.usedAutoReadActions, 3)
  assert.equal(audit.filter(item => item.type === 'policy.evaluated').length, 3)
  assert.equal(audit.filter(item => item.type === 'execution.started').length, 3)
  assert.equal(audit.filter(item => item.type === 'execution.finished').length, 3)
})

test('unsafe, dependent and unknown bundle actions fall back before parallel execution', async () => {
  const gateway = buildGateway(async index => structuredResult(index))
  const scheduler = new ReadProbeBundleScheduler(gateway)
  const unsafe = await scheduler.prepare(session(), bundle(['probe.read_0', 'probe.change']))
  assert.equal(unsafe.mode, 'serial')
  assert.equal(unsafe.reason, 'tool_not_parallel_safe')

  const dependentBundle = bundle(['probe.read_0', 'probe.read_1'])
  dependentBundle.actions[1].dependsOn = ['invocation_bundle_0']
  const dependent = await scheduler.prepare(session(), dependentBundle)
  assert.equal(dependent.reason, 'dependent_action_requires_serial_execution')

  const unknown = await scheduler.prepare(session(), bundle(['probe.read_0', 'probe.unknown']))
  assert.equal(unknown.mode, 'serial')
  assert.equal(unknown.reason, 'unknown_tool')
  assert.equal(unknown.error.code, 'AGENT_UNKNOWN_TOOL')
})

test('binding change stops bundle actions that have not been sent', async () => {
  let calls = 0
  const gateway = buildGateway(async index => {
    calls++
    return structuredResult(index)
  })
  const scheduler = new ReadProbeBundleScheduler(gateway, { concurrency: 2 })
  const current = session()
  const prepared = await scheduler.prepare(current, bundle())
  current.sessionBinding.cwd = '/different'
  const result = await scheduler.executePrepared(current, prepared)
  assert.equal(result.stoppedBy.code, 'AGENT_CAPABILITY_MISMATCH')
  assert.equal(result.results[2].notStarted, true)
  assert.equal(calls, 0)
})

test('ordinary bundle action failure is isolated and later reads still run', async () => {
  const calls = []
  const gateway = buildGateway(async index => {
    calls.push(index)
    if (index === 1) throw new Error('probe unavailable')
    return structuredResult(index)
  })
  const result = await new ReadProbeBundleScheduler(gateway, { concurrency: 1 }).run(session(), bundle())
  assert.deepEqual(calls, [0, 1, 2])
  assert.equal(result.results[0].result.status, 'success')
  assert.equal(result.results[1].result.status, 'error')
  assert.equal(result.results[2].result.status, 'success')
  assert.equal(result.stoppedBy, undefined)
})

test('bundle cancellation and unknown remote state stop actions not yet sent', async () => {
  const cancelController = new AbortController()
  const cancelCalls = []
  const cancelGateway = buildGateway(async (index, context) => {
    cancelCalls.push(index)
    if (index === 0) {
      cancelController.abort(new Error('stop bundle'))
      assert.equal(context.signal.aborted, true)
    }
    return structuredResult(index)
  })
  const cancelled = await new ReadProbeBundleScheduler(cancelGateway, { concurrency: 1 }).run(session(), bundle(), cancelController.signal)
  assert.deepEqual(cancelCalls, [0])
  assert.equal(cancelled.results[0].result.status, 'cancelled')
  assert.equal(cancelled.results[1].notStarted, true)
  assert.equal(cancelled.results[2].notStarted, true)

  const unknownGateway = buildGateway(async index => index === 0
    ? { ...structuredResult(index), status: 'unknown', remoteTermination: 'unconfirmed' }
    : structuredResult(index))
  const unknown = await new ReadProbeBundleScheduler(unknownGateway, { concurrency: 1 }).run(session(), bundle())
  assert.equal(unknown.stoppedBy.code, 'AGENT_REMOTE_STATE_UNKNOWN')
  assert.equal(unknown.results[1].notStarted, true)
  assert.equal(unknown.results[2].notStarted, true)
})
