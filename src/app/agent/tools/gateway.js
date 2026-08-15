const { normalizeIntent, sessionFingerprint } = require('./intent-normalizer')
const { consumeAutoRead } = require('../session/budget-controller')

class ToolGateway {
  constructor (options) {
    this.registry = options.registry
    this.policyEngine = options.policyEngine
    this.approvals = options.approvals
    this.capabilities = options.capabilities
    this.runtime = options.runtime
    this.audit = options.audit
  }

  publicTools (context) {
    return this.registry.publicDescriptors(context)
  }

  async prepare (session, rawIntent) {
    if (rawIntent.taskId !== session.taskId) throw gatewayError('AGENT_TASK_MISMATCH', '动作不属于当前任务。')
    const item = this.registry.get(rawIntent.toolName)
    if (rawIntent.toolVersion !== item.definition.version) throw gatewayError('AGENT_TOOL_VERSION_MISMATCH', '工具版本不匹配。')
    const validatedArguments = this.registry.validateInput(rawIntent.toolName, rawIntent.arguments)
    const intent = normalizeIntent(rawIntent, item.definition, validatedArguments)
    const mutability = effectiveMutability(item.definition, intent)
    const interactive = item.definition.name === 'shell.exec' && !!intent.commandAnalysis?.interactiveSignals?.length
    const effectiveDefinition = mutability === item.definition.mutability && !interactive
      ? item.definition
      : { ...item.definition, mutability, category: interactive ? 'interactive' : 'change', approval: 'always' }
    let decision = this.policyEngine.evaluate(session, effectiveDefinition, intent)
    const timeoutMs = timeoutFor(effectiveDefinition, intent, session)
    if (mutability !== 'none' && effectiveDefinition.category !== 'interactive' && (!intent.verificationPlan || !intent.verificationPlan.postconditions.length)) {
      decision = {
        ...decision,
        outcome: 'deny',
        reasons: [...decision.reasons, {
          code: 'verification_plan_required',
          message: '变更动作必须在审批前提供至少一个只读后置验证检查。',
          source: 'builtin_rule'
        }],
        matchedRuleIds: [...decision.matchedRuleIds, 'verification_plan_required'],
        allowedApprovalScopes: []
      }
    }
    this.audit.append('policy.evaluated', {
      taskId: session.taskId,
      invocationId: intent.invocationId,
      toolName: intent.toolName,
      intentDigest: intent.intentDigest,
      policyVersion: decision.policyVersion,
      outcome: decision.outcome,
      risk: decision.risk,
      sensitivity: decision.sensitivity,
      cost: decision.cost,
      reasons: decision.reasons
    })
    if (decision.outcome === 'allow') {
      session.budget = consumeAutoRead(session.budget)
      return { decision, intent, mutability, timeoutMs, capability: this.issueCapability(session, intent, decision) }
    }
    const taskGrant = decision.outcome === 'require_approval' && this.approvals.hasTaskGrant(session, intent, decision)
    if (taskGrant) {
      return { decision: { ...decision, outcome: 'allow' }, intent, mutability, approvalRequestId: taskGrant.approvalRequestId, timeoutMs, capability: this.issueCapability(session, intent, decision, 'task_exact_match') }
    }
    if (decision.outcome === 'require_approval') {
      const approval = this.approvals.create(session, effectiveDefinition, intent, decision, timeoutMs)
      this.audit.append('approval.requested', {
        taskId: session.taskId,
        invocationId: intent.invocationId,
        approvalRequestId: approval.approvalRequestId,
        intentDigest: intent.intentDigest,
        risk: decision.risk,
        sensitivity: decision.sensitivity,
        cost: decision.cost,
        expiresAt: approval.expiresAt
      })
      return { decision, intent, mutability, timeoutMs, approval }
    }
    return {
      decision,
      intent,
      mutability,
      fatal: decision.risk === 'R5',
      reason: { code: decision.matchedRuleIds[0] || 'policy_denied', safeMessage: decision.reasons.map(reason => reason.message).join(' '), recoverable: decision.risk !== 'R5' },
      finalResult: decision.risk === 'R5' ? blockedResult(session, decision) : undefined
    }
  }

  async execute (session, intent, capability, signal, authorizedTimeoutMs) {
    const item = this.registry.get(intent.toolName)
    const mutability = effectiveMutability(item.definition, intent)
    const definition = mutability === item.definition.mutability
      ? item.definition
      : { ...item.definition, mutability, category: 'change', approval: 'always' }
    const expected = {
      taskId: session.taskId,
      invocationId: intent.invocationId,
      intentDigest: intent.intentDigest,
      sessionFingerprint: sessionFingerprint(session.sessionBinding),
      policyVersion: this.policyEngine.policy.version
    }
    this.capabilities.verify(capability, expected, { consume: true })
    this.audit.append('execution.started', { ...expected, toolName: intent.toolName, target: intent.target, argumentsHash: intent.intentDigest })
    const result = await this.runtime.execute(session, definition, intent, item.executor, signal, capability, authorizedTimeoutMs)
    this.audit.append('execution.finished', {
      taskId: session.taskId,
      invocationId: intent.invocationId,
      receiptId: result.receiptId,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      remoteTermination: result.remoteTermination
    })
    if (result.status === 'success' && definition.parserId !== 'shell') {
      try {
        this.registry.validateResult(intent.toolName, JSON.parse(result._rawStreams?.stdout || '{}'))
      } catch (error) {
        this.audit.append('execution.result_invalid', { taskId: session.taskId, invocationId: intent.invocationId, receiptId: result.receiptId, toolName: intent.toolName })
        throw gatewayError('AGENT_TOOL_RESULT_INVALID', `工具 ${intent.toolName} 返回了不符合契约的结构。`)
      }
    }
    return { result, streams: result._rawStreams }
  }

  issueCapability (session, intent, decision, scope = 'once') {
    return this.capabilities.issue({
      taskId: session.taskId,
      invocationId: intent.invocationId,
      intentDigest: intent.intentDigest,
      sessionFingerprint: sessionFingerprint(session.sessionBinding),
      policyVersion: decision.policyVersion,
      scope
    })
  }

  resolveApproval (session, decision) {
    const result = this.approvals.resolve(session, decision)
    this.audit.append('approval.resolved', { taskId: session.taskId, approvalRequestId: decision.approvalRequestId, choice: decision.choice, intentDigest: decision.intentDigest })
    return result
  }

  expireApproval (session, approvalRequestId) {
    const result = this.approvals.expire(session, approvalRequestId)
    if (result) {
      this.audit.append('approval.resolved', {
        taskId: session.taskId,
        approvalRequestId,
        choice: 'expired',
        intentDigest: session.pendingApproval?.intentDigest
      })
    }
    return result
  }

  supersedeApproval (session, approvalRequestId, intentDigest) {
    const result = this.approvals.supersede(session, approvalRequestId, intentDigest)
    this.audit.append('approval.resolved', { taskId: session.taskId, approvalRequestId, choice: 'revised', intentDigest })
    return result
  }

  revokeTask (taskId) {
    this.approvals.revokeTask(taskId)
  }

  cancel (taskId) {
    return this.runtime.cancelTask(taskId)
  }
}

function effectiveMutability (definition, intent) {
  if (definition.mutability !== 'none') return definition.mutability
  if (definition.name !== 'shell.exec') return 'none'
  const signals = intent.commandAnalysis?.riskSignals || []
  const mutates = signals.some(item => ['mutation_signal', 'unknown_command', 'complex_shell'].includes(item.code))
  return mutates ? 'reversible' : 'none'
}

function timeoutFor (definition, intent, session) {
  const toolTimeout = Math.min(intent.requestedTimeoutMs || definition.defaultTimeoutMs, definition.maxTimeoutMs)
  if (!session) return toolTimeout
  const deadline = Date.parse(session.budget.approvedLongDeadlineAt || session.budget.taskDeadlineAt)
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) throw gatewayError('AGENT_TASK_TIMEOUT', '任务总超时已到，不能启动新动作。')
  return Math.max(1, Math.min(toolTimeout, remainingMs))
}

function gatewayError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  error.source = 'gateway'
  return error
}

function blockedResult (session, decision) {
  return {
    status: 'blocked',
    conclusion: decision.reasons.map(reason => reason.message).join(' '),
    confirmedFacts: session.memory.facts.filter(f => f.confidence !== 'inferred'),
    inferences: session.memory.facts.filter(f => f.confidence === 'inferred'),
    unresolvedItems: session.memory.missingInformation,
    operations: session.memory.changeRecords,
    verificationOutcomes: session.verification?.outcomes || [],
    evidenceRefs: session.evidenceRefs,
    completedAt: new Date().toISOString()
  }
}

module.exports = { ToolGateway, gatewayError, effectiveMutability }
