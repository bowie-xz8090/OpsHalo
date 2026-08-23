const test = require('node:test')
const assert = require('node:assert/strict')
const { AgentStartRequestSchema } = require('../../src/app/agent/schemas/session-schema')
const { ToolDefinitionSchema } = require('../../src/app/agent/schemas/tool-schema')
const { canTransition, reduceSession } = require('../../src/app/agent/session/state-machine')
const { TaskMailbox } = require('../../src/app/agent/session/session-manager')
const { validateEventSequence } = require('../../src/app/agent/schemas/event-schema')

test('Agent start contract is strict and bounded', () => {
  const request = {
    schemaVersion: 1,
    clientRequestId: 'client_request_123',
    tabId: 'tab-1',
    prompt: '检查 nginx 502',
    mode: 'diagnose',
    uiLocale: 'zh-CN'
  }
  assert.equal(AgentStartRequestSchema.parse(request).prompt, request.prompt)
  assert.throws(() => AgentStartRequestSchema.parse({ ...request, trusted: true }))
  assert.throws(() => AgentStartRequestSchema.parse({ ...request, prompt: 'x'.repeat(8001) }))
})

test('Tool definition rejects missing security metadata', () => {
  assert.throws(() => ToolDefinitionSchema.parse({ schemaVersion: 1, name: 'bad.tool' }))
})

test('Agent state machine rejects illegal transitions and emits effects', () => {
  assert.equal(canTransition('planning', 'policy_check'), true)
  assert.equal(canTransition('planning', 'executing'), false)
  const state = { status: 'intake', snapshotVersion: 1, updatedAt: new Date().toISOString() }
  const result = reduceSession(state, { type: 'OBJECTIVE_READY', effectId: 'effect_12345678' })
  assert.equal(result.state.status, 'planning')
  assert.equal(result.effects[0].type, 'RUN_HARNESS')
  assert.throws(() => reduceSession(result.state, { type: 'EXECUTION_FINISHED', result: {} }), /invalid in planning/)
})

test('ordinary need_user ends the round without opening an embedded text input', () => {
  const now = new Date().toISOString()
  const state = {
    status: 'planning',
    snapshotVersion: 2,
    updatedAt: now,
    memory: {
      planSummary: '',
      reasonSummary: '',
      missingInformation: [],
      completionCriteria: []
    }
  }
  const finalResult = {
    status: 'inconclusive',
    conclusion: '需要确认要检查哪个服务。',
    confirmedFacts: [],
    inferences: [],
    operations: [],
    unresolvedItems: ['服务名称'],
    evidenceRefs: [],
    completedAt: now
  }
  const result = reduceSession(state, {
    type: 'PLANNER_DECISION',
    decision: {
      goalStatus: 'need_user',
      planSummary: '确认范围',
      reasonSummary: '当前目标存在多种解释。',
      missingInformation: ['服务名称'],
      completionCriteria: [],
      userQuestion: '要检查哪个服务？'
    },
    userInputKind: 'text',
    reason: { code: 'needs_user_decision', safeMessage: '本轮已停止。', recoverable: true },
    finalResult
  })
  assert.equal(result.state.status, 'inconclusive')
  assert.equal(result.state.finalResult.conclusion, finalResult.conclusion)
  assert.equal(result.events.some(event => event.type === 'user_input.requested'), false)
})

test('evaluated evidence can propose the next reviewed command without completing the task', () => {
  const now = new Date().toISOString()
  const state = {
    status: 'evaluating',
    snapshotVersion: 4,
    updatedAt: now,
    memory: { completionCriteria: [] }
  }
  const intent = {
    invocationId: 'invocation_follow_up_12345',
    toolName: 'shell.review_exec',
    target: { display: '/etc/nginx/conf.d' },
    purpose: '查看 Nginx conf.d 中可能遗漏的站点配置',
    expectedObservation: 'Nginx 站点配置目录内容'
  }
  const result = reduceSession(state, {
    type: 'FOLLOW_UP_PROPOSED',
    intent,
    reason: { code: 'follow_up_ready', safeMessage: '已准备下一项检查。', recoverable: true },
    effectId: 'effect_follow_up_12345'
  })
  assert.equal(result.state.status, 'policy_check')
  assert.equal(result.events[0].type, 'action.proposed')
  assert.equal(result.events[0].payload.purpose, intent.purpose)
  assert.equal(result.effects[0].type, 'EVALUATE_INTENT')
  assert.equal(result.effects[0].intent, intent)
})

test('read probe bundles stay ordered through policy, execution and observation states', () => {
  const now = new Date().toISOString()
  const action = index => ({
    schemaVersion: 1,
    invocationId: `invocation_bundle_state_${index}`,
    taskId: 'task_bundle_state_12345',
    toolName: `probe.read_${index}`,
    toolVersion: '1',
    arguments: {},
    target: { kind: 'host', canonicalId: 'example.test', display: `probe ${index}` },
    purpose: `probe ${index}`,
    expectedObservation: `result ${index}`
  })
  const planning = {
    status: 'planning',
    snapshotVersion: 2,
    updatedAt: now,
    memory: { planSummary: '', reasonSummary: '', missingInformation: [], completionCriteria: [] }
  }
  const decision = {
    goalStatus: 'continue',
    planSummary: 'parallel reads',
    reasonSummary: 'independent reads',
    missingInformation: ['service and port state'],
    completionCriteria: [],
    readProbeBundle: {
      schemaVersion: 1,
      bundleId: 'bundle_state_12345',
      actions: [0, 1].map(index => ({ intent: action(index), dependsOn: [] }))
    }
  }
  const proposed = reduceSession(planning, { type: 'PLANNER_DECISION', decision, effectId: 'effect_bundle_plan_12345' })
  assert.equal(proposed.state.status, 'policy_check')
  assert.deepEqual(proposed.events.filter(event => event.type === 'action.proposed').map(event => event.correlationId), ['invocation_bundle_state_0', 'invocation_bundle_state_1'])
  assert.equal(proposed.effects[0].type, 'EVALUATE_READ_BUNDLE')

  const preparedBundle = {
    mode: 'parallel',
    bundle: decision.readProbeBundle,
    prepared: [0, 1].map(index => ({
      prepared: {
        intent: { ...action(index), normalizedArguments: {}, redactedDisplay: '{}', intentDigest: 'a'.repeat(64) },
        decision: { outcome: 'allow' },
        timeoutMs: 1000,
        capability: `capability-${index}`
      }
    }))
  }
  const authorized = reduceSession(proposed.state, { type: 'BUNDLE_POLICY_DECIDED', preparedBundle, effectId: 'effect_bundle_policy_12345' })
  assert.equal(authorized.state.status, 'executing')
  assert.deepEqual(authorized.events.filter(event => event.type === 'policy.evaluated').map(event => event.correlationId), ['invocation_bundle_state_0', 'invocation_bundle_state_1'])
  assert.deepEqual(authorized.events.filter(event => event.type === 'execution.started').map(event => event.correlationId), ['invocation_bundle_state_0', 'invocation_bundle_state_1'])
  assert.equal(authorized.effects[0].type, 'EXECUTE_READ_BUNDLE')
})

test('event replay accepts duplicate delivery and detects a sequence gap', () => {
  const now = new Date().toISOString()
  const event = (sequence, eventId = `event_sequence_${sequence}`) => ({
    schemaVersion: 1,
    eventId,
    taskId: 'task_sequence_12345',
    sequence,
    snapshotVersion: sequence,
    type: 'budget.updated',
    occurredAt: now,
    payload: {}
  })
  assert.deepEqual(validateEventSequence([event(1), event(1, 'event_sequence_1'), event(2)]), { valid: true, lastSequence: 2 })
  assert.deepEqual(validateEventSequence([event(1), event(3)], 0), { valid: false, expected: 2, actual: 3 })
})

test('Task mailbox serializes concurrent commands', async () => {
  const order = []
  const mailbox = new TaskMailbox(async command => {
    order.push(`start-${command.id}`)
    await new Promise(resolve => setTimeout(resolve, command.delay))
    order.push(`end-${command.id}`)
  })
  await Promise.all([
    mailbox.push({ id: 1, delay: 10 }),
    mailbox.push({ id: 2, delay: 0 })
  ])
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2'])
})
