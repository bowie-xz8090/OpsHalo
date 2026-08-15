const crypto = require('crypto')
const { ApprovalRequestSchema } = require('../schemas/session-schema')
const { defaults } = require('../config')
const { sessionFingerprint } = require('../tools/intent-normalizer')
const { ApprovalScopeStore } = require('./approval-scope')

class ApprovalManager {
  constructor (capabilities, options = {}) {
    this.capabilities = capabilities
    this.requests = new Map()
    this.scopes = options.scopes || new ApprovalScopeStore()
  }

  hasTaskGrant (session, intent, policy) {
    return this.scopes.get(session.taskId, intent.intentDigest, sessionFingerprint(session.sessionBinding), policy.policyVersion)
  }

  create (session, definition, intent, policy, timeoutMs) {
    const approvalRequestId = `approval_${crypto.randomBytes(18).toString('base64url')}`
    const fingerprint = sessionFingerprint(session.sessionBinding)
    const expiry = Math.min(Date.now() + defaults.approvalTtlMs, Date.parse(session.budget.approvedLongDeadlineAt || session.budget.taskDeadlineAt))
    const allowedDecisions = ['reject', 'cancel_task']
    if (policy.risk !== 'R5') allowedDecisions.push('approve_once')
    if (definition.category !== 'interactive' && policy.allowedApprovalScopes.includes('task_exact_match') && policy.risk !== 'R4') allowedDecisions.push('approve_task_exact_match')
    const expiresAt = new Date(expiry).toISOString()
    const display = {
      approvalRequestId,
      risk: policy.risk,
      sensitivity: policy.sensitivity,
      cost: policy.cost,
      host: session.sessionBinding.host,
      port: session.sessionBinding.port,
      username: session.sessionBinding.username,
      cwd: session.sessionBinding.cwd,
      toolName: intent.toolName,
      fullCommandOrArguments: intent.redactedDisplay,
      affectedResources: [intent.target.display],
      privilegeAndInteraction: intent.commandAnalysis ? [...intent.commandAnalysis.privilegeSignals, ...intent.commandAnalysis.interactiveSignals] : [],
      timeoutMs: timeoutMs || Math.min(intent.requestedTimeoutMs || definition.defaultTimeoutMs, definition.maxTimeoutMs),
      expectedEffect: intent.purpose,
      riskReasons: policy.reasons.map(reason => reason.message),
      prechecks: (intent.verificationPlan?.preconditions || []).map(check => check.description),
      verificationChecks: (intent.verificationPlan?.postconditions || []).map(check => check.description),
      rollbackSummary: intent.verificationPlan?.rollbackIntentTemplate?.purpose,
      expiresAt
    }
    const request = ApprovalRequestSchema.parse({
      schemaVersion: 1,
      approvalRequestId,
      taskId: session.taskId,
      invocationId: intent.invocationId,
      intentDigest: intent.intentDigest,
      policyDecisionId: policy.decisionId,
      sessionFingerprint: fingerprint,
      display,
      allowedDecisions,
      expiresAt
    })
    this.requests.set(approvalRequestId, { request, intent, policy, definition, timeoutMs: display.timeoutMs, resolved: false })
    return request
  }

  resolve (session, decision) {
    const entry = this.requests.get(decision.approvalRequestId)
    if (!entry || entry.resolved) throw approvalError('AGENT_APPROVAL_STALE', '审批请求不存在或已处理。')
    const request = entry.request
    if (request.taskId !== session.taskId || decision.intentDigest !== request.intentDigest) throw approvalError('AGENT_APPROVAL_MISMATCH', '审批内容与待执行动作不一致。')
    if (request.sessionFingerprint !== sessionFingerprint(session.sessionBinding) || request.policyDecisionId !== entry.policy.decisionId) {
      throw approvalError('AGENT_APPROVAL_STALE', '会话或策略已经变化，需要重新审批。')
    }
    if (Date.now() >= Date.parse(request.expiresAt)) {
      entry.resolved = true
      return { choice: 'expired', reason: { code: 'approval_expired', safeMessage: '审批已过期。', recoverable: true }, payload: { approvalRequestId: request.approvalRequestId, choice: 'expired', decidedAt: new Date().toISOString() } }
    }
    if (!request.allowedDecisions.includes(decision.choice)) throw approvalError('AGENT_APPROVAL_CHOICE_DENIED', '当前风险等级不允许该审批范围。')
    entry.resolved = true
    if (decision.choice === 'reject' || decision.choice === 'cancel_task') {
      return {
        choice: decision.choice,
        reason: { code: decision.choice, safeMessage: decision.choice === 'reject' ? '用户拒绝了该动作。' : '用户取消了任务。', recoverable: decision.choice === 'reject' },
        payload: { approvalRequestId: request.approvalRequestId, choice: decision.choice, decidedAt: decision.decidedAt }
      }
    }
    if (entry.definition.category === 'interactive') {
      return {
        choice: decision.choice,
        handoff: true,
        intent: entry.intent,
        payload: { approvalRequestId: request.approvalRequestId, choice: decision.choice, decidedAt: decision.decidedAt }
      }
    }
    const scope = decision.choice === 'approve_task_exact_match' ? 'task_exact_match' : 'once'
    if (scope === 'task_exact_match') this.scopes.grant(session.taskId, request.intentDigest, request.sessionFingerprint, entry.policy.policyVersion, request.approvalRequestId)
    const capability = this.capabilities.issue({
      taskId: session.taskId,
      invocationId: request.invocationId,
      intentDigest: request.intentDigest,
      sessionFingerprint: request.sessionFingerprint,
      policyVersion: entry.policy.policyVersion,
      scope
    })
    return {
      choice: decision.choice,
      payload: { approvalRequestId: request.approvalRequestId, choice: decision.choice, decidedAt: decision.decidedAt },
      intent: entry.intent,
      capability,
      timeoutMs: Math.max(1, Math.min(entry.timeoutMs, Date.parse(session.budget.approvedLongDeadlineAt || session.budget.taskDeadlineAt) - Date.now()))
    }
  }

  expire (session, approvalRequestId) {
    const entry = this.requests.get(approvalRequestId)
    if (!entry || entry.resolved || entry.request.taskId !== session.taskId) return null
    entry.resolved = true
    return {
      choice: 'expired',
      reason: { code: 'approval_expired', safeMessage: '审批已过期。', recoverable: true },
      payload: { approvalRequestId, choice: 'expired', decidedAt: new Date().toISOString() }
    }
  }

  supersede (session, approvalRequestId, intentDigest) {
    const entry = this.requests.get(approvalRequestId)
    if (!entry || entry.resolved || entry.request.taskId !== session.taskId || entry.request.intentDigest !== intentDigest) {
      throw approvalError('AGENT_APPROVAL_STALE', '待修改的审批已经失效。')
    }
    entry.resolved = true
  }

  revokeTask (taskId) {
    this.capabilities.revokeTask(taskId)
    this.scopes.revokeTask(taskId)
    for (const entry of this.requests.values()) {
      if (entry.request.taskId === taskId) entry.resolved = true
    }
  }
}

function approvalError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  return error
}

module.exports = { ApprovalManager, approvalError }
