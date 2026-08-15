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
