const test = require('node:test')
const assert = require('node:assert/strict')
const { AgentEventSchema } = require('../../src/app/agent/schemas/event-schema')

const viewModule = import('../../src/client/store/agent-session-view.mjs')

test('internal Agent protocol events do not become visible timeline rows', async () => {
  const { projectTimeline } = await viewModule
  const internalTypes = ['session.created', 'session.state_changed', 'budget.updated', 'harness.progress', 'evidence.available']
  let timeline = []
  for (const type of internalTypes) timeline = projectTimeline(timeline, { type, payload: {} })
  assert.deepEqual(timeline, [])
})

test('one invocation is projected as one readable step across its lifecycle', async () => {
  const { projectTimeline } = await viewModule
  const invocationId = 'invocation_ui_projection_12345'
  const events = [
    { type: 'action.proposed', correlationId: invocationId, payload: { invocationId, purpose: '检查 Nginx 配置', toolName: 'shell.exec', targetDisplay: '/etc/nginx/nginx.conf', expectedObservation: '确认生效配置路径' } },
    { type: 'policy.evaluated', payload: { invocationId, outcome: 'allow', risk: 'R1', sensitivity: 'S1', cost: 'C1' } },
    { type: 'execution.started', correlationId: invocationId, payload: { invocationId, toolName: 'shell.exec', startedAt: new Date().toISOString() } },
    { type: 'execution.progress', correlationId: invocationId, payload: { invocationId, elapsedMs: 900, bytesReceived: 120, message: 'syntax is ok' } },
    { type: 'observation.ready', correlationId: invocationId, payload: { invocationId, status: 'success', summary: 'Nginx 配置语法正常', facts: [], evidenceRefs: [] } }
  ]
  const timeline = events.reduce(projectTimeline, [])
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].title, '检查 Nginx 配置')
  assert.equal(timeline[0].observationSummary, 'Nginx 配置语法正常')
  assert.equal(timeline[0].risk.r, 'R1')
})

test('optimistic Agent session provides immediate activity and can become an inline failure', async () => {
  const { createOptimisticAgentSession, currentAgentActivity, failOptimisticAgentSession } = await viewModule
  const pending = createOptimisticAgentSession({
    clientRequestId: 'client_ui_pending_12345',
    tabId: 'tab-ui-pending',
    prompt: '查询 Nginx 配置'
  })
  assert.equal(pending.status, 'intake')
  assert.match(currentAgentActivity(pending), /准备 AI/)
  const failed = failOptimisticAgentSession(pending, { code: 'AGENT_CONFIG', safeMessage: 'AI 配置不可用。' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.finalResult.conclusion, 'AI 配置不可用。')
})

test('harness progress is a versioned Agent event', () => {
  const event = AgentEventSchema.parse({
    schemaVersion: 1,
    eventId: 'event_harness_progress_12345',
    taskId: 'task_harness_progress_12345',
    sequence: 1,
    snapshotVersion: 2,
    type: 'harness.progress',
    occurredAt: new Date().toISOString(),
    payload: { phase: 'thinking', message: 'AI 正在思考…' }
  })
  assert.equal(event.type, 'harness.progress')
})
