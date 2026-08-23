const { TERMINAL_STATUSES, SESSION_STATUSES } = require('../schemas/enums')

const allowedTransitions = Object.freeze({
  intake: ['planning', 'cancelled', 'failed', 'paused'],
  planning: ['policy_check', 'awaiting_user', 'verifying', 'inconclusive', 'failed', 'cancelled', 'paused'],
  policy_check: ['executing', 'awaiting_approval', 'evaluating', 'blocked', 'cancelled', 'paused'],
  awaiting_approval: ['policy_check', 'executing', 'evaluating', 'cancelled', 'paused'],
  executing: ['observing', 'cancelled', 'paused', 'failed'],
  observing: ['reducing', 'cancelled', 'failed', 'paused'],
  reducing: ['evaluating', 'cancelled', 'failed', 'paused'],
  evaluating: ['planning', 'policy_check', 'awaiting_user', 'verifying', 'complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'paused'],
  awaiting_user: ['planning', 'cancelled', 'paused'],
  verifying: ['planning', 'awaiting_approval', 'complete', 'inconclusive', 'failed', 'cancelled', 'paused'],
  paused: ['planning', 'verifying', 'cancelled', 'blocked'],
  complete: [],
  inconclusive: [],
  blocked: [],
  failed: [],
  cancelled: []
})

function isTerminalStatus (status) {
  return TERMINAL_STATUSES.includes(status)
}

function canTransition (from, to) {
  if (!SESSION_STATUSES.includes(from) || !SESSION_STATUSES.includes(to)) return false
  return allowedTransitions[from].includes(to)
}

function assertTransition (from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Illegal Agent session transition: ${from} -> ${to}`)
    error.code = 'AGENT_ILLEGAL_TRANSITION'
    throw error
  }
}

function transition (state, to, reason, eventType = 'session.state_changed', payload = {}) {
  assertTransition(state.status, to)
  const now = new Date().toISOString()
  const next = {
    ...state,
    status: to,
    statusReason: reason,
    updatedAt: now,
    snapshotVersion: state.snapshotVersion + 1
  }
  if (isTerminalStatus(to)) {
    const finalResult = payload?.finalResult || (payload?.status && payload?.completedAt ? payload : undefined)
    if (finalResult) next.finalResult = finalResult
  }
  const events = [{
    type: 'session.state_changed',
    payload: { from: state.status, to, reason }
  }]
  if (eventType !== 'session.state_changed') {
    events.push({ type: eventType, payload })
  }
  return {
    state: next,
    events,
    effects: []
  }
}

function reduceSession (state, command) {
  if (!state || !command || !command.type) {
    throw new Error('State and command are required')
  }
  if (command.type === 'EVIDENCE_DELETED') {
    return {
      state: { ...state, snapshotVersion: state.snapshotVersion + 1, updatedAt: new Date().toISOString() },
      events: [{ type: 'evidence.deleted', payload: command.payload }],
      effects: []
    }
  }
  if (isTerminalStatus(state.status)) {
    return { state, events: [], effects: [] }
  }

  switch (command.type) {
    case 'OBJECTIVE_READY': {
      const result = transition(state, 'planning', undefined)
      result.effects.push({ type: 'RUN_HARNESS', effectId: command.effectId })
      return result
    }
    case 'PLANNER_DECISION': {
      const decision = command.decision
      if (state.status !== 'planning') throwInvalidCommand(state, command)
      const plannedState = {
        ...state,
        memory: {
          ...state.memory,
          planSummary: decision.planSummary,
          reasonSummary: decision.reasonSummary,
          missingInformation: decision.missingInformation,
          completionCriteria: decision.completionCriteria
        }
      }
      if (decision.goalStatus === 'continue') {
        const next = {
          ...plannedState,
          snapshotVersion: state.snapshotVersion + 1,
          updatedAt: new Date().toISOString()
        }
        assertTransition(state.status, 'policy_check')
        next.status = 'policy_check'
        const actions = decision.readProbeBundle?.actions?.map(item => item.intent) || [decision.action]
        return {
          state: next,
          events: [
            { type: 'plan.updated', payload: decision },
            ...actions.map(action => ({
              type: 'action.proposed',
              correlationId: action.invocationId,
              payload: {
                invocationId: action.invocationId,
                toolName: action.toolName,
                targetDisplay: action.target.display,
                purpose: action.purpose,
                expectedObservation: action.expectedObservation,
                bundleId: decision.readProbeBundle?.bundleId
              }
            })),
            { type: 'session.state_changed', payload: { from: state.status, to: 'policy_check' } }
          ],
          effects: [decision.readProbeBundle
            ? { type: 'EVALUATE_READ_BUNDLE', bundle: decision.readProbeBundle, effectId: command.effectId }
            : { type: 'EVALUATE_INTENT', intent: decision.action, effectId: command.effectId }]
        }
      }
      if (decision.goalStatus === 'need_user') {
        if ((command.userInputKind || 'text') !== 'terminal_handoff') {
          const result = transition(plannedState, 'inconclusive', command.reason, 'session.completed', command.finalResult || {})
          result.events.unshift({ type: 'plan.updated', payload: decision })
          return result
        }
        const result = transition(plannedState, 'awaiting_user', undefined, 'user_input.requested', {
          requestId: command.requestId,
          question: decision.userQuestion,
          safeContext: decision.reasonSummary,
          maxLength: 4000,
          kind: command.userInputKind || 'text'
        })
        result.events.unshift({ type: 'plan.updated', payload: decision })
        result.state.pendingUserInput = result.events[result.events.length - 1].payload
        return result
      }
      if (decision.goalStatus === 'verify' || decision.goalStatus === 'complete') {
        const result = transition(plannedState, 'verifying', undefined, 'verification.started', command.verification || {})
        result.events.unshift({ type: 'plan.updated', payload: decision })
        result.effects.push({ type: 'VERIFY_COMPLETION', effectId: command.effectId })
        return result
      }
      const result = transition(plannedState, 'blocked', command.reason, 'session.completed', command.finalResult || {})
      result.events.unshift({ type: 'plan.updated', payload: decision })
      return result
    }
    case 'POLICY_DECIDED': {
      if (state.status !== 'policy_check') throwInvalidCommand(state, command)
      const invocationState = {
        ...state,
        currentInvocation: {
          invocationId: command.intent.invocationId,
          intentDigest: command.intent.intentDigest,
          toolName: command.intent.toolName,
          toolVersion: command.intent.toolVersion,
          mutability: command.mutability || 'none',
          approvalRequestId: command.approval?.approvalRequestId || command.approvalRequestId,
          phase: 'authorized',
          executionAttempt: 0,
          verificationPlan: command.intent.verificationPlan,
          target: command.intent.target,
          purpose: command.intent.purpose,
          expectedObservation: command.intent.expectedObservation,
          normalizedArguments: command.intent.normalizedArguments
        }
      }
      if (command.decision.outcome === 'allow') {
        const result = transition(invocationState, 'executing', undefined)
        result.events.unshift({ type: 'policy.evaluated', payload: command.decision })
        result.events.push({
          type: 'execution.started',
          correlationId: command.intent.invocationId,
          payload: {
            invocationId: command.intent.invocationId,
            toolName: command.intent.toolName,
            targetDisplay: command.intent.target.display,
            mode: command.intent.toolName.startsWith('mcp.') ? 'mcp' : command.intent.toolName.startsWith('sftp.') ? 'sftp' : 'exec',
            timeoutMs: command.timeoutMs,
            startedAt: new Date().toISOString()
          }
        })
        result.effects.push({ type: 'EXECUTE_INTENT', intent: command.intent, capability: command.capability, timeoutMs: command.timeoutMs, effectId: command.effectId })
        return result
      }
      if (command.decision.outcome === 'require_approval') {
        const result = transition(invocationState, 'awaiting_approval', undefined, 'approval.requested', command.approval)
        result.state.pendingApproval = command.approval
        return result
      }
      if (command.fatal) {
        return transition(invocationState, 'blocked', command.reason, 'session.completed', command.finalResult || {})
      }
      const result = transition(invocationState, 'evaluating', command.reason)
      result.events.unshift({ type: 'policy.evaluated', payload: command.decision })
      result.effects.push({ type: 'EVALUATE_PROGRESS', effectId: command.effectId })
      return result
    }
    case 'BUNDLE_POLICY_DECIDED': {
      if (state.status !== 'policy_check') throwInvalidCommand(state, command)
      const actions = command.preparedBundle.prepared.map(item => item.prepared)
      const bundleState = {
        ...state,
        currentInvocation: {
          bundleId: command.preparedBundle.bundle.bundleId,
          phase: 'authorized',
          mutability: 'none',
          invocationIds: actions.map(item => item.intent.invocationId)
        }
      }
      const result = transition(bundleState, 'executing', undefined)
      result.events = [
        ...actions.map(action => ({ type: 'policy.evaluated', correlationId: action.intent.invocationId, payload: action.decision })),
        ...result.events
      ]
      for (const action of actions) {
        result.events.push({
          type: 'execution.started',
          correlationId: action.intent.invocationId,
          payload: {
            invocationId: action.intent.invocationId,
            toolName: action.intent.toolName,
            targetDisplay: action.intent.target.display,
            mode: 'exec',
            timeoutMs: action.timeoutMs,
            bundleId: command.preparedBundle.bundle.bundleId,
            startedAt: new Date().toISOString()
          }
        })
      }
      result.effects.push({ type: 'EXECUTE_READ_BUNDLE', preparedBundle: command.preparedBundle, effectId: command.effectId })
      return result
    }
    case 'APPROVAL_RESOLVED': {
      if (state.status !== 'awaiting_approval') throwInvalidCommand(state, command)
      if (command.choice === 'cancel_task') return transition(state, 'cancelled', command.reason, 'session.cancelled', command.finalResult || {})
      if (command.choice === 'reject' || command.choice === 'expired') {
        const result = transition(state, 'evaluating', command.reason, 'approval.resolved', command.payload || {})
        result.state.pendingApproval = undefined
        result.effects.push({ type: 'EVALUATE_PROGRESS', effectId: command.effectId })
        return result
      }
      const result = transition({
        ...state,
        currentInvocation: {
          ...state.currentInvocation,
          approvalRequestId: command.payload?.approvalRequestId || state.currentInvocation?.approvalRequestId
        }
      }, 'executing', undefined, 'approval.resolved', command.payload || {})
      result.state.pendingApproval = undefined
      result.events.push({
        type: 'execution.started',
        correlationId: command.intent.invocationId,
        payload: {
          invocationId: command.intent.invocationId,
          toolName: command.intent.toolName,
          targetDisplay: command.intent.target.display,
          mode: command.intent.toolName.startsWith('mcp.') ? 'mcp' : command.intent.toolName.startsWith('sftp.') ? 'sftp' : 'exec',
          timeoutMs: command.timeoutMs,
          startedAt: new Date().toISOString()
        }
      })
      result.effects.push({ type: 'EXECUTE_INTENT', intent: command.intent, capability: command.capability, timeoutMs: command.timeoutMs, effectId: command.effectId })
      return result
    }
    case 'APPROVAL_REVISED': {
      if (state.status !== 'awaiting_approval') throwInvalidCommand(state, command)
      const result = transition({ ...state, pendingApproval: undefined }, 'policy_check', command.reason, 'approval.resolved', command.payload)
      result.events.push({
        type: 'action.proposed',
        correlationId: command.intent.invocationId,
        payload: {
          invocationId: command.intent.invocationId,
          toolName: command.intent.toolName,
          targetDisplay: command.intent.target.display,
          purpose: command.intent.purpose,
          expectedObservation: command.intent.expectedObservation
        }
      })
      result.effects.push({ type: 'EVALUATE_INTENT', intent: command.intent, effectId: command.effectId })
      return result
    }
    case 'HANDOFF_APPROVED': {
      if (state.status !== 'awaiting_approval') throwInvalidCommand(state, command)
      const request = command.request
      const result = transition({ ...state, pendingApproval: undefined }, 'awaiting_user', command.reason, 'approval.resolved', command.payload)
      result.events.push({ type: 'user_input.requested', correlationId: command.intent.invocationId, payload: request })
      result.state.pendingUserInput = request
      return result
    }
    case 'EXECUTION_PROGRESS': {
      if (state.status !== 'executing') return { state, events: [], effects: [] }
      return {
        state,
        events: [{
          type: command.payload.source === 'output' ? 'execution.output_progress' : 'execution.progress',
          correlationId: command.invocationId,
          payload: command.payload
        }],
        effects: []
      }
    }
    case 'EXECUTION_FINISHED': {
      if (state.status !== 'executing') throwInvalidCommand(state, command)
      const result = transition({
        ...state,
        currentInvocation: {
          ...state.currentInvocation,
          phase: 'finished',
          executionAttempt: (state.currentInvocation?.executionAttempt || 0) + 1,
          executionReceiptId: command.result.receiptId,
          actualResultStatus: command.result.status,
          startedAt: command.result.startedAt,
          finishedAt: command.result.finishedAt
        }
      }, 'observing', undefined, 'execution.finished', command.result)
      result.effects.push({ type: 'BUILD_OBSERVATION', result: command.result, streams: command.streams, effectId: command.effectId })
      return result
    }
    case 'BUNDLE_EXECUTION_FINISHED': {
      if (state.status !== 'executing') throwInvalidCommand(state, command)
      const result = transition({
        ...state,
        currentInvocation: { ...state.currentInvocation, phase: 'finished' }
      }, 'observing', undefined)
      for (const item of command.execution.results) {
        result.events.push({
          type: 'execution.finished',
          correlationId: item.intent.invocationId,
          payload: item.result || {
            invocationId: item.intent.invocationId,
            status: item.notStarted ? 'cancelled' : 'error',
            error: item.error,
            bundleId: command.execution.bundle.bundleId
          }
        })
      }
      result.effects.push({ type: 'BUILD_BUNDLE_OBSERVATIONS', execution: command.execution, effectId: command.effectId })
      return result
    }
    case 'OBSERVATION_READY': {
      if (state.status !== 'observing') throwInvalidCommand(state, command)
      const result = transition(state, 'reducing', undefined, 'observation.ready', command.observation)
      for (const evidenceRef of command.observation.evidenceRefs || []) {
        result.events.push({ type: 'evidence.available', correlationId: command.observation.invocationId, payload: { evidenceRef, invocationId: command.observation.invocationId } })
      }
      result.effects.push({ type: 'REDUCE_CONTEXT', observation: command.observation, effectId: command.effectId })
      return result
    }
    case 'BUNDLE_OBSERVATIONS_READY': {
      if (state.status !== 'observing') throwInvalidCommand(state, command)
      const result = transition(state, 'reducing', undefined)
      for (const observation of command.observations) {
        result.events.push({ type: 'observation.ready', correlationId: observation.invocationId, payload: observation })
        for (const evidenceRef of observation.evidenceRefs || []) {
          result.events.push({ type: 'evidence.available', correlationId: observation.invocationId, payload: { evidenceRef, invocationId: observation.invocationId } })
        }
      }
      result.effects.push({ type: 'REDUCE_BUNDLE_CONTEXT', observations: command.observations, invocations: command.invocations, effectId: command.effectId })
      return result
    }
    case 'CONTEXT_REDUCED': {
      if (state.status !== 'reducing') throwInvalidCommand(state, command)
      const result = transition({ ...state, memory: command.memory }, 'evaluating', undefined)
      result.effects.push({ type: 'EVALUATE_PROGRESS', effectId: command.effectId })
      return result
    }
    case 'CONTINUE_PLANNING': {
      const result = transition(state, 'planning', command.reason)
      result.effects.push({ type: 'RUN_HARNESS', effectId: command.effectId })
      return result
    }
    case 'FOLLOW_UP_PROPOSED': {
      if (state.status !== 'evaluating') throwInvalidCommand(state, command)
      const next = {
        ...state,
        status: 'policy_check',
        snapshotVersion: state.snapshotVersion + 1,
        updatedAt: new Date().toISOString()
      }
      return {
        state: next,
        events: [
          {
            type: 'action.proposed',
            correlationId: command.intent.invocationId,
            payload: {
              invocationId: command.intent.invocationId,
              toolName: command.intent.toolName,
              targetDisplay: command.intent.target.display,
              purpose: command.intent.purpose,
              expectedObservation: command.intent.expectedObservation
            }
          },
          { type: 'session.state_changed', payload: { from: state.status, to: 'policy_check', reason: command.reason } }
        ],
        effects: [{ type: 'EVALUATE_INTENT', intent: command.intent, effectId: command.effectId }]
      }
    }
    case 'VERIFY_COMPLETION': {
      const result = transition(state, 'verifying', command.reason, 'verification.started', command.payload || {})
      result.effects.push({ type: 'VERIFY_COMPLETION', effectId: command.effectId })
      return result
    }
    case 'VERIFY_MUTATION': {
      if (state.status !== 'evaluating') throwInvalidCommand(state, command)
      const result = transition(state, 'verifying', command.reason, 'verification.started', command.payload || {})
      result.effects.push({ type: 'RUN_MUTATION_VERIFICATION', obligation: command.obligation, effectId: command.effectId })
      return result
    }
    case 'MUTATION_VERIFIED': {
      if (state.status !== 'verifying') throwInvalidCommand(state, command)
      const outcome = command.outcome
      const changeRecords = state.memory.changeRecords.map(record => record.invocationId === command.invocationId
        ? { ...record, verificationStatus: outcome.status, evidenceRefs: [...new Set([...record.evidenceRefs, ...outcome.evidenceRefs])] }
        : record)
      const updated = {
        ...state,
        memory: {
          ...state.memory,
          changeRecords,
          verificationObligations: state.memory.verificationObligations.filter(item => item.invocationId !== command.invocationId)
        },
        verification: { outcomes: [...(state.verification?.outcomes || []), outcome].slice(-100) },
        evidenceRefs: [...new Set([...state.evidenceRefs, ...outcome.evidenceRefs])]
      }
      if (outcome.status === 'passed') {
        const result = transition(updated, 'planning', command.reason, 'verification.finished', outcome)
        result.effects.push({ type: 'RUN_HARNESS', effectId: command.effectId })
        return result
      }
      const terminal = outcome.status === 'failed' ? 'failed' : 'inconclusive'
      const result = transition(updated, terminal, command.reason, terminal === 'failed' ? 'session.failed' : 'session.completed', command.finalResult || {})
      result.events.unshift({ type: 'verification.finished', correlationId: command.invocationId, payload: outcome })
      return result
    }
    case 'COMPLETE':
      return transition(state, 'complete', command.reason, 'session.completed', command.finalResult)
    case 'INCONCLUSIVE':
      return transition(state, 'inconclusive', command.reason, 'session.completed', command.finalResult)
    case 'BLOCK':
      return transition(state, 'blocked', command.reason, 'session.completed', command.finalResult)
    case 'FAIL':
      return transition(state, 'failed', command.reason, 'session.failed', command.payload || {})
    case 'PAUSE': {
      const result = transition(state, 'paused', command.reason, 'session.paused', { reason: command.reason, canResume: true })
      result.effects.push({ type: 'ABORT_ACTIVE', reason: command.reason, effectId: command.effectId })
      return result
    }
    case 'RESUME': {
      if (state.status !== 'paused') throwInvalidCommand(state, command)
      const obligation = state.memory.verificationObligations[0]
      if (obligation) {
        const result = transition(state, 'verifying', command.reason, 'session.resumed', { ...(command.payload || {}), recoveringVerification: true })
        result.state.pendingApproval = undefined
        result.state.pendingUserInput = undefined
        result.effects.push({ type: 'RUN_MUTATION_VERIFICATION', obligation, effectId: command.effectId })
        return result
      }
      const result = transition(state, 'planning', command.reason, 'session.resumed', command.payload || {})
      result.state.pendingApproval = undefined
      result.state.pendingUserInput = undefined
      result.effects.push({ type: 'RUN_HARNESS', effectId: command.effectId })
      return result
    }
    case 'CANCEL': {
      const result = transition(state, 'cancelled', command.reason, 'session.cancelled', command.payload || {})
      result.effects.push({ type: 'ABORT_ACTIVE', reason: command.reason, effectId: command.effectId })
      return result
    }
    default:
      throwInvalidCommand(state, command)
  }
}

function throwInvalidCommand (state, command) {
  const error = new Error(`Command ${command.type} is invalid in ${state.status}`)
  error.code = 'AGENT_INVALID_COMMAND'
  throw error
}

module.exports = {
  allowedTransitions,
  isTerminalStatus,
  canTransition,
  assertTransition,
  reduceSession
}
