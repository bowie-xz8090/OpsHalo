const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SessionStore, directoryBytes } = require('../../src/app/agent/session/session-store')
const { createBudget } = require('../../src/app/agent/session/budget-controller')
const { createWorkingMemory } = require('../../src/app/agent/session/context-manager')
const { reduceSession } = require('../../src/app/agent/session/state-machine')

test('Session store atomically persists and recovers non-terminal tasks as paused', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-agent-session-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new SessionStore(root)
  const now = new Date().toISOString()
  const record = {
    schemaVersion: 1,
    taskId: 'task_persist_12345',
    ownerWindowId: 1,
    createdAt: now,
    updatedAt: now,
    status: 'planning',
    snapshotVersion: 1,
    lastEventSequence: 0,
    featurePolicyVersion: 'agent-policy-v1',
    sessionBinding: {
      tabId: 'tab-1',
      connectionId: 'connection-1',
      sessionPid: 'tab-1',
      host: 'localhost',
      port: 22,
      username: 'tester',
      cwd: '/home/tester',
      shell: '/bin/bash',
      platform: 'linux',
      bindingConfidence: 'reduced',
      capturedAt: now
    },
    mode: 'diagnose',
    prompt: 'test objective',
    harness: { adapter: 'openai_compatible', modelId: 'test-model', providerId: 'test-provider', supportsNativeTools: true, supportsStructuredOutput: true, maxContextTokens: 32000 },
    budget: createBudget(),
    memory: createWorkingMemory('test objective'),
    evidenceRefs: [],
    recentErrors: []
  }
  store.saveSnapshot(record)
  assert.equal(store.load(record.taskId).status, 'planning')
  store.quotaBytes = directoryBytes(store.sessionPath(record.taskId)) + 4096
  for (let sequence = 1; sequence <= 20; sequence++) {
    store.appendEvent({
      schemaVersion: 1,
      eventId: `event_quota_${String(sequence).padStart(5, '0')}`,
      taskId: record.taskId,
      sequence,
      snapshotVersion: 1,
      type: 'execution.progress',
      occurredAt: now,
      payload: { message: 'x'.repeat(1024) }
    })
  }
  assert.ok(directoryBytes(store.sessionPath(record.taskId)) <= store.quotaBytes)
  assert.equal(store.readRecentEvents(record.taskId).at(-1).sequence, 20)
  const recovered = store.recoverInterrupted()
  assert.equal(recovered[0].status, 'paused')
  assert.equal(store.load(record.taskId).statusReason.code, 'app_restarted')
  assert.equal(fs.readdirSync(store.sessionPath(record.taskId)).some(name => name.endsWith('.tmp')), false)

  const verificationPlan = {
    planId: 'plan_recovery_12345',
    preconditions: [],
    postconditions: [{
      checkId: 'check_recovery_12345',
      description: 'service is active after recovery',
      intent: {
        toolName: 'service.status',
        arguments: { service: 'nginx' },
        target: { kind: 'service', canonicalId: 'nginx', display: 'nginx' },
        purpose: 'verify recovered mutation'
      },
      predicate: { operator: 'match', path: 'stdout', expected: 'active' },
      critical: true
    }],
    successExpression: 'all critical checks pass'
  }
  store.saveSnapshot({
    ...record,
    taskId: 'task_recovery_mutation_12345',
    status: 'executing',
    currentInvocation: {
      invocationId: 'invocation_recovery_12345',
      intentDigest: 'e'.repeat(64),
      mutability: 'reversible',
      approvalRequestId: 'approval_recovery_12345',
      target: { kind: 'service', canonicalId: 'nginx', display: 'nginx' },
      purpose: 'restart nginx',
      verificationPlan
    }
  })
  const recoveredMutation = store.recoverInterrupted().find(item => item.taskId === 'task_recovery_mutation_12345')
  assert.equal(recoveredMutation.memory.changeRecords[0].actualStatus, 'unknown')
  assert.equal(recoveredMutation.memory.verificationObligations[0].verificationPlan.planId, verificationPlan.planId)
  const resumed = reduceSession(recoveredMutation, { type: 'RESUME', effectId: 'effect_recovery_12345' })
  assert.equal(resumed.state.status, 'verifying')
  assert.equal(resumed.effects[0].type, 'RUN_MUTATION_VERIFICATION')
})

test('Ctrl+C arbitration uses fixed priority', async () => {
  const { resolveCtrlCAction } = await import('../../src/client/components/shortcuts/ctrl-c-action.mjs')
  assert.equal(resolveCtrlCAction({ hasSelection: true, terminalHandoff: true, aiActive: true }), 'copy_selection')
  assert.equal(resolveCtrlCAction({ hasSelection: false, terminalHandoff: true, aiActive: true }), 'send_terminal_sigint')
  assert.equal(resolveCtrlCAction({ hasSelection: false, terminalHandoff: false, aiActive: true }), 'cancel_ai')
  assert.equal(resolveCtrlCAction({ hasSelection: false, terminalHandoff: false, aiActive: false }), 'pass_through')
})
