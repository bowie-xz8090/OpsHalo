const terminalStatuses = new Set(['complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'partial'])

const timelineEventTypes = new Set([
  'action.proposed',
  'policy.evaluated',
  'approval.requested',
  'approval.resolved',
  'execution.started',
  'execution.progress',
  'execution.finished',
  'observation.ready',
  'verification.started',
  'verification.finished'
])

export function isTerminalAgentStatus (status) {
  return terminalStatuses.has(status)
}

export function createOptimisticAgentSession ({ clientRequestId, tabId, prompt }) {
  const now = Date.now()
  return {
    schemaVersion: 1,
    taskId: `pending_${clientRequestId}`,
    status: 'intake',
    prompt,
    snapshotVersion: 0,
    lastEventSequence: 0,
    binding: { tabId },
    budget: {
      reactSteps: { used: 0, max: 12 },
      autoReadActions: { used: 0, max: 8 },
      consecutiveErrors: { used: 0, max: 3 },
      elapsedMs: 0,
      remainingMs: 300000
    },
    timeline: [],
    availableControls: ['cancel'],
    _optimistic: true,
    _startedAt: now,
    _projectedAt: now,
    _activity: {
      phase: 'submitting',
      message: '正在连接当前终端并准备 AI…'
    }
  }
}

export function failOptimisticAgentSession (session, error) {
  const conclusion = String(error?.safeMessage || error?.message || error || 'Agent 启动失败。')
  return {
    ...session,
    status: 'failed',
    statusReason: { code: error?.code || 'agent_start_failed', message: conclusion },
    finalResult: {
      status: 'failed',
      conclusion,
      confirmedFacts: [],
      inferences: [],
      operations: [],
      unresolvedItems: ['请检查当前终端连接和 AI 配置后重试。'],
      evidenceRefs: [],
      completedAt: new Date().toISOString()
    },
    availableControls: [],
    _optimistic: false,
    _projectedAt: Date.now()
  }
}

export function projectTimeline (timeline = [], event = {}) {
  if (!timelineEventTypes.has(event.type)) return timeline
  const payload = event.payload || {}
  let correlationId = event.correlationId || payload.invocationId || payload.planId
  let index = correlationId ? timeline.findIndex(item => item.stepId === correlationId) : -1
  if (index < 0 && event.type === 'approval.resolved') {
    index = findLastIndex(timeline, item => item.status === 'awaiting')
    correlationId = index >= 0 ? timeline[index].stepId : null
  }
  if (!correlationId && !['verification.started', 'verification.finished'].includes(event.type)) return timeline
  correlationId = correlationId || event.eventId
  const current = index >= 0
    ? timeline[index]
    : {
        stepId: correlationId,
        reactStep: nextReactStep(timeline),
        kind: event.type.startsWith('verification.') ? 'verification' : 'tool',
        status: 'pending',
        title: humanEventTitle(event),
        evidenceRefs: [],
        expandedByDefault: false
      }
  const item = { ...current }

  if (event.type === 'action.proposed') {
    Object.assign(item, {
      kind: 'tool',
      status: 'pending',
      title: payload.purpose || payload.toolName || '准备探查服务器',
      reasonSummary: payload.expectedObservation,
      toolName: payload.toolName,
      targetDisplay: payload.targetDisplay
    })
  }
  if (event.type === 'policy.evaluated') {
    Object.assign(item, {
      risk: { r: payload.risk, s: payload.sensitivity, c: payload.cost },
      status: payload.outcome === 'deny'
        ? 'error'
        : payload.outcome === 'require_approval'
          ? 'awaiting'
          : item.status
    })
  }
  if (event.type === 'approval.requested') {
    Object.assign(item, { kind: 'approval', status: 'awaiting', expandedByDefault: true })
  }
  if (event.type === 'approval.resolved') {
    const rejected = ['reject', 'expired', 'cancel_task'].includes(payload.choice)
    Object.assign(item, { status: rejected ? 'cancelled' : 'pending', expandedByDefault: false })
  }
  if (event.type === 'execution.started') {
    Object.assign(item, {
      kind: 'tool',
      status: 'running',
      startedAt: payload.startedAt,
      toolName: payload.toolName || item.toolName,
      targetDisplay: payload.targetDisplay || item.targetDisplay
    })
  }
  if (event.type === 'execution.progress') {
    Object.assign(item, {
      status: 'running',
      progress: {
        elapsedMs: payload.elapsedMs || 0,
        capturedBytes: payload.bytesReceived || 0,
        safeLastLine: payload.message
      }
    })
  }
  if (event.type === 'execution.finished') {
    Object.assign(item, {
      status: payload.status === 'success'
        ? 'success'
        : payload.status === 'cancelled'
          ? 'cancelled'
          : 'error',
      durationMs: payload.durationMs,
      finishedAt: event.occurredAt
    })
  }
  if (event.type === 'observation.ready') {
    Object.assign(item, {
      kind: 'observation',
      observationSummary: payload.summary,
      factViews: payload.facts,
      evidenceRefs: payload.evidenceRefs || [],
      status: payload.status === 'success' ? 'success' : payload.status === 'cancelled' ? 'cancelled' : 'warning'
    })
  }
  if (event.type === 'verification.started') {
    Object.assign(item, { kind: 'verification', status: 'running', title: payload.phase === 'precheck' ? '执行变更前置检查' : '验证执行结果' })
  }
  if (event.type === 'verification.finished') {
    Object.assign(item, {
      kind: 'verification',
      status: payload.status === 'passed' ? 'success' : 'warning',
      evidenceRefs: payload.evidenceRefs || item.evidenceRefs || []
    })
  }

  const result = [...timeline]
  if (index >= 0) result[index] = item
  else result.push(item)
  return result.slice(-100)
}

export function currentAgentActivity (session) {
  if (!session) return ''
  const latest = [...(session.timeline || [])].reverse().find(item => item.status !== 'cancelled')
  if (session._activity?.message && ['intake', 'planning'].includes(session.status)) return session._activity.message
  if (session.status === 'awaiting_approval') {
    return session.plan?.reasonSummary || session.plan?.planSummary || latest?.title || '需要你确认下一步操作。'
  }
  if (session.status === 'awaiting_user') return session.pendingUserInput?.question || 'AI 需要你补充信息。'
  if (session.status === 'policy_check') return latest?.title ? `正在检查“${latest.title}”是否可以安全执行…` : '正在检查下一步操作的安全性…'
  if (session.status === 'executing') return latest?.title || session.plan?.planSummary || '正在服务器上执行有界探查…'
  if (['observing', 'reducing', 'evaluating'].includes(session.status)) return latest?.title ? `正在分析“${latest.title}”的结果…` : 'AI 正在分析服务器返回结果…'
  if (session.status === 'verifying') return '正在验证证据与最终结论…'
  if (session.status === 'paused') return session.statusReason?.message || '任务已暂停。'
  if (isTerminalAgentStatus(session.status)) return session.finalResult?.conclusion || session.statusReason?.message || ''
  return session.plan?.planSummary || session._activity?.message || 'AI 正在思考并判断需要哪些信息…'
}

function nextReactStep (timeline) {
  return timeline.reduce((maximum, item) => Math.max(maximum, Number(item.reactStep) || 0), 0) + 1
}

function humanEventTitle (event) {
  const payload = event.payload || {}
  if (event.type.startsWith('verification.')) return '验证执行结果'
  return payload.purpose || payload.toolName || '服务器探查'
}

function findLastIndex (items, predicate) {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}
