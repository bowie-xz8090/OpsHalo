const crypto = require('crypto')
const { AgentStartRequestSchema, AgentControlRequestSchema, AgentSessionRecordSchema } = require('../schemas/session-schema')
const { AgentEventSchema } = require('../schemas/event-schema')
const { PlannerDecisionSchema } = require('../schemas/harness-schema')
const { createBudget, checkBudget, consumeTurn, remaining } = require('./budget-controller')
const { recordResult } = require('./budget-controller')
const { createWorkingMemory, reconcileObservation, prepareTurnInput } = require('./context-manager')
const { ProgressDetector } = require('./progress-detector')
const { reduceSession, isTerminalStatus } = require('./state-machine')
const { SCHEMA_VERSION, POLICY_VERSION, defaults } = require('../config')
const { createRollbackIntent } = require('../verification/rollback-planner')
const { summarizeDirectLookup, objectiveKeywords } = require('../verification/direct-answer')
const { evaluatePredicate } = require('../verification/verification-runner')
const { StreamingSecretRedactor } = require('../observation/secret-redactor')
const { ProviderSessionManager } = require('../providers/provider-session-manager')
const { TaskLatencyRecorder } = require('../metrics/task-latency-recorder')
const { ReadProbeBundleScheduler } = require('../execution/read-probe-bundle')
const { ObservationSchema } = require('../schemas/observation-schema')

function id (prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`
}

class TaskMailbox {
  constructor (handler) {
    this.handler = handler
    this.queue = []
    this.running = false
  }

  push (command) {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject })
      this.drain()
    })
  }

  async drain () {
    if (this.running) return
    this.running = true
    while (this.queue.length) {
      const item = this.queue.shift()
      try { item.resolve(await this.handler(item.command)) } catch (error) { item.reject(error) }
    }
    this.running = false
  }
}

class AgentSessionManager {
  constructor (options) {
    this.store = options.store
    this.evidenceStore = options.evidenceStore
    this.bindingResolver = options.bindingResolver
    this.harnessFactory = options.harnessFactory
    this.providerSessions = options.providerSessionManager || new ProviderSessionManager(this.harnessFactory)
    this.gateway = options.gateway
    this.readProbeBundles = options.readProbeBundleScheduler || new ReadProbeBundleScheduler(this.gateway)
    this.observationPipeline = options.observationPipeline
    this.completionEvaluator = options.completionEvaluator
    this.finalSynthesizer = options.finalSynthesizer
    this.verificationRunner = options.verificationRunner
    this.skillRegistry = options.skillRegistry
    this.knowledgeBase = options.knowledgeBase
    this.featureFlags = options.featureFlags || {}
    this.configRefreshPending = false
    this.onRuntimeSettled = options.onRuntimeSettled || (() => {})
    this.latencyRecorder = options.latencyRecorder || new TaskLatencyRecorder()
    this.policyVersion = options.policyVersion || POLICY_VERSION
    this.publish = options.publish || (() => {})
    this.sessions = new Map()
    this.clientRequests = new Map()
  }

  recover () {
    const records = this.store.recoverInterrupted()
    for (const record of records) this.attach(record)
    return records.map(record => this.toViewModel(record))
  }

  attach (record) {
    const runtime = {
      record,
      mailbox: null,
      abortController: null,
      harness: null,
      finished: isTerminalStatus(record.status),
      resourcesRevoked: isTerminalStatus(record.status),
      cancelAfterSafePoint: null,
      pauseAfterSafePoint: null,
      approvalTimer: null,
      completedEffects: new Set(),
      progressDetector: new ProgressDetector(record.budget.maxEquivalentActionRepeats),
      lastProgress: null,
      lastProgressEventAt: new Map(),
      lastKnowledgeFingerprint: '',
      pendingVerificationFollowUps: new Map(),
      pendingTerminalVerification: null
    }
    runtime.mailbox = new TaskMailbox(command => this.process(runtime, command))
    this.sessions.set(record.taskId, runtime)
    if (!runtime.finished) this.latencyRecorder.start(record.taskId, record.createdAt, { adapter: record.harness?.adapter })
    return runtime
  }

  async start (request, ownerWindowId) {
    const requestStartedAt = Date.now()
    const parsed = AgentStartRequestSchema.parse(request)
    if (!this.featureFlags.agentModeEnabled) throw agentError('AGENT_DISABLED', 'Agent 模式尚未启用。')
    if (this.configRefreshPending) throw agentError('AGENT_CONFIG_REFRESH_PENDING', 'Agent 配置已保存，将在当前运行任务暂停或结束后生效。')
    if (containsSensitiveMaterial(parsed.prompt)) throw agentError('AGENT_SENSITIVE_INPUT_REJECTED', '问题中可能包含密码、令牌或私钥，请移除敏感值后重试。')
    const cached = this.clientRequests.get(`${ownerWindowId}:${parsed.clientRequestId}`)
    if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) return cached.response
    const sessionBinding = await this.bindingResolver(parsed.tabId)
    if (!sessionBinding) throw agentError('AGENT_SESSION_NOT_FOUND', '当前终端会话不可用。')
    if (String(sessionBinding.tabId) !== String(parsed.tabId) && String(sessionBinding.sessionPid) !== String(parsed.tabId)) {
      throw agentError('AGENT_SESSION_MISMATCH', '终端标签与会话服务返回的身份不一致。')
    }
    sessionBinding.tabId = parsed.tabId
    const parent = parsed.parentTaskId ? this.store.load(parsed.parentTaskId) : null
    const now = new Date().toISOString()
    const taskId = id('task')
    const record = AgentSessionRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      taskId,
      ownerWindowId,
      parentTaskId: parsed.parentTaskId,
      conversationId: parsed.conversationId,
      createdAt: now,
      updatedAt: now,
      status: 'intake',
      snapshotVersion: 1,
      lastEventSequence: 0,
      featurePolicyVersion: this.policyVersion,
      sessionBinding,
      mode: parsed.mode,
      prompt: parsed.prompt,
      uiLocale: parsed.uiLocale,
      harness: this.harnessFactory.selection(),
      budget: createBudget(),
      memory: createWorkingMemory(parsed.prompt, parent),
      evidenceRefs: parent?.evidenceRefs || [],
      knowledgeCitations: parent?.knowledgeCitations || [],
      recentErrors: []
    })
    const runtime = this.attach(record)
    this.latencyRecorder.start(taskId, requestStartedAt, { adapter: record.harness.adapter })
    this.commit(runtime, [
      {
        type: 'session.created',
        payload: {
          status: record.status,
          binding: this.toViewModel(record).binding,
          budget: this.toViewModel(record).budget,
          mode: record.mode
        }
      },
      {
        type: 'session.accepted',
        payload: { acceptedAt: now }
      }
    ])
    const response = {
      schemaVersion: 1,
      taskId,
      status: 'intake',
      snapshotVersion: runtime.record.snapshotVersion,
      eventCursor: runtime.record.lastEventSequence
    }
    this.latencyRecorder.mark(taskId, 'submitAck')
    this.clientRequests.set(`${ownerWindowId}:${parsed.clientRequestId}`, { createdAt: Date.now(), response })
    runtime.mailbox.push({ type: 'OBJECTIVE_READY', effectId: id('effect') }).catch(error => this.failRuntime(runtime, error))
    return response
  }

  async control (request, ownerWindowId) {
    const parsed = AgentControlRequestSchema.parse(request)
    const runtime = this.ownedRuntime(parsed.taskId, ownerWindowId)
    const mutationNeedsVerification = ['pause', 'cancel'].includes(parsed.action) && ['executing', 'observing', 'reducing', 'evaluating', 'verifying'].includes(runtime.record.status) && runtime.record.currentInvocation?.mutability && runtime.record.currentInvocation.mutability !== 'none'
    if (mutationNeedsVerification) {
      const pending = {
        reason: parsed.reason || (parsed.action === 'cancel' ? 'user_cancelled' : 'user_paused'),
        requestedAt: new Date().toISOString()
      }
      if (parsed.action === 'cancel') {
        runtime.cancelAfterSafePoint = pending
        runtime.pauseAfterSafePoint = null
        this.preemptActive(runtime, pending.reason)
      } else {
        runtime.pauseAfterSafePoint = pending
      }
      return { accepted: true, pendingSafeCancellation: parsed.action === 'cancel', pendingSafePause: parsed.action === 'pause', snapshotVersion: runtime.record.snapshotVersion }
    }
    if (parsed.action === 'pause' || parsed.action === 'cancel') {
      this.preemptActive(runtime, parsed.reason || parsed.action)
    }
    if (runtime.record.snapshotVersion !== parsed.expectedSnapshotVersion && !['pause', 'cancel'].includes(parsed.action)) {
      const error = agentError('AGENT_STALE_SNAPSHOT', '任务状态已更新，请基于最新状态重试。')
      error.latestSnapshot = this.toViewModel(runtime.record)
      throw error
    }
    if (parsed.action === 'pause') {
      await runtime.mailbox.push({ type: 'PAUSE', reason: statusReason('user_paused', '用户已暂停任务。', true), effectId: id('effect') })
    } else if (parsed.action === 'resume') {
      const binding = await this.bindingResolver(runtime.record.sessionBinding.tabId)
      if (!binding || !sameBinding(binding, runtime.record.sessionBinding)) throw agentError('AGENT_SESSION_MISMATCH', '终端会话身份已变化，不能恢复原任务。')
      runtime.record.sessionBinding = binding
      this.gateway.revokeTask?.(parsed.taskId)
      runtime.resourcesRevoked = false
      await runtime.mailbox.push({
        type: 'RESUME',
        reason: statusReason('user_resumed', '用户已恢复任务。', true),
        payload: { bindingRevalidated: true, taskDeadlineAt: runtime.record.budget.taskDeadlineAt },
        effectId: id('effect')
      })
    } else if (parsed.action === 'cancel') {
      await runtime.mailbox.push({
        type: 'CANCEL',
        reason: statusReason('user_cancelled', parsed.reason || '用户已中断任务。', false),
        payload: { reason: parsed.reason || 'user_cancelled', remoteTerminationWarnings: [], finalResult: cancelledResult(runtime.record) },
        effectId: id('effect')
      })
    } else if (parsed.action === 'submit_user_input') {
      if (runtime.record.status !== 'awaiting_user' || runtime.record.pendingUserInput?.requestId !== parsed.requestId) {
        throw agentError('AGENT_INPUT_NOT_EXPECTED', '当前任务不在等待该补充信息。')
      }
      if (containsSensitiveMaterial(parsed.value)) throw agentError('AGENT_SENSITIVE_INPUT_REJECTED', '检测到可能的密码、令牌或私钥，请使用终端人工接管，不要提交给 Agent。')
      runtime.record.memory.scope = [...runtime.record.memory.scope, parsed.value].slice(-100)
      runtime.record.pendingUserInput = undefined
      await runtime.mailbox.push({ type: 'CONTINUE_PLANNING', reason: statusReason('user_input_received', '已收到补充信息。', true), effectId: id('effect') })
    } else if (parsed.action === 'revise_approval') {
      const current = runtime.record.currentInvocation
      if (runtime.record.status !== 'awaiting_approval' || !['shell.exec', 'shell.review_exec'].includes(current?.toolName) || runtime.record.pendingApproval?.approvalRequestId !== parsed.approvalRequestId || current.intentDigest !== parsed.intentDigest) {
        throw agentError('AGENT_APPROVAL_STALE', '当前 Shell 审批已经失效或不可修改。')
      }
      this.gateway.supersedeApproval(runtime.record, parsed.approvalRequestId, parsed.intentDigest)
      await runtime.mailbox.push({
        type: 'APPROVAL_REVISED',
        reason: statusReason('approval_revised', '命令已修改，正在重新进行参数校验和风险评估。', true),
        payload: { approvalRequestId: parsed.approvalRequestId, choice: 'revised', decidedAt: new Date().toISOString() },
        intent: {
          schemaVersion: 1,
          taskId: runtime.record.taskId,
          invocationId: id('invocation'),
          toolName: current.toolName,
          toolVersion: current.toolVersion,
          arguments: { command: parsed.revisedCommand },
          target: current.target,
          purpose: current.purpose,
          expectedObservation: current.expectedObservation || current.purpose,
          verificationPlan: current.verificationPlan
        },
        effectId: id('effect')
      })
    } else if (parsed.action === 'resolve_approval') {
      const resolution = await this.gateway.resolveApproval(runtime.record, parsed.decision)
      if (resolution.intent?.toolName === 'background.start' && !resolution.handoff && !['reject', 'cancel_task', 'expired'].includes(resolution.choice)) {
        const hardDeadline = Date.parse(runtime.record.createdAt) + defaults.approvedLongTaskMaxMs
        runtime.record.budget.approvedLongDeadlineAt = new Date(Math.max(Date.parse(runtime.record.budget.taskDeadlineAt), hardDeadline)).toISOString()
        this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      }
      if (resolution.handoff) {
        await runtime.mailbox.push({
          type: 'HANDOFF_APPROVED',
          ...resolution,
          request: {
            requestId: id('input'),
            question: `请在当前终端手工执行或控制：${resolution.intent.redactedDisplay}`,
            safeContext: 'Agent 已暂停自动操作，不会自动输入或读取凭据。完成后请恢复任务以重新探查。',
            maxLength: 0,
            kind: 'terminal_handoff'
          },
          reason: statusReason('terminal_handoff', '交互动作已转交用户控制。', true),
          effectId: id('effect')
        })
      } else {
        await runtime.mailbox.push({ type: 'APPROVAL_RESOLVED', ...resolution, effectId: id('effect') })
      }
    }
    return { accepted: true, snapshotVersion: runtime.record.snapshotVersion }
  }

  getSnapshot (taskId, ownerWindowId, afterSequence) {
    const runtime = this.ownedRuntime(taskId, ownerWindowId)
    const events = typeof afterSequence === 'number' ? this.store.readEvents(taskId, afterSequence) : null
    return {
      schemaVersion: 1,
      snapshot: this.toViewModel(runtime.record),
      deltaEvents: events === null ? this.store.readRecentEvents(taskId) : events,
      requiresSnapshot: events === null
    }
  }

  async deleteEvidence (taskId, ownerWindowId, evidenceRef) {
    const runtime = this.ownedRuntime(taskId, ownerWindowId)
    const result = this.evidenceStore.delete(taskId, evidenceRef)
    await runtime.mailbox.push({ type: 'EVIDENCE_DELETED', payload: { deleted: result.deleted, evidenceRef } })
    return result
  }

  ownedRuntime (taskId, ownerWindowId) {
    let runtime = this.sessions.get(taskId)
    if (!runtime) {
      const record = this.store.load(taskId)
      if (record) runtime = this.attach(record)
    }
    if (!runtime || runtime.record.ownerWindowId !== ownerWindowId) throw agentError('AGENT_NOT_OWNER', '无权访问该任务。')
    return runtime
  }

  hasActiveProfile (profileId) {
    return [...this.sessions.values()].some(runtime => !isTerminalStatus(runtime.record.status) && runtime.record.harness?.profileId === profileId)
  }

  async process (runtime, command) {
    if (command.effectId && runtime.completedEffects.has(command.effectId)) return runtime.record
    const reduced = reduceSession(runtime.record, command)
    runtime.record = reduced.state
    this.commit(runtime, reduced.events)
    this.syncApprovalTimer(runtime)
    if (command.effectId) runtime.completedEffects.add(command.effectId)
    if (runtime.cancelAfterSafePoint && command.type === 'MUTATION_VERIFIED') {
      const pending = runtime.cancelAfterSafePoint
      runtime.cancelAfterSafePoint = null
      if (!isTerminalStatus(runtime.record.status)) {
        return this.process(runtime, {
          type: 'CANCEL',
          reason: statusReason('user_cancelled_after_verification', pending.reason || '用户已中断任务。', false),
          payload: { reason: pending.reason, remoteTerminationWarnings: [], finalResult: cancelledResult(runtime.record) },
          effectId: id('effect')
        })
      }
    }
    if (runtime.pauseAfterSafePoint && command.type === 'MUTATION_VERIFIED') {
      const pending = runtime.pauseAfterSafePoint
      runtime.pauseAfterSafePoint = null
      if (!isTerminalStatus(runtime.record.status)) {
        return this.process(runtime, {
          type: 'PAUSE',
          reason: statusReason('user_paused_after_verification', pending.reason || '用户已暂停任务。', true),
          effectId: id('effect')
        })
      }
    }
    for (const effect of reduced.effects) {
      await this.runEffect(runtime, effect)
    }
    if (isTerminalStatus(runtime.record.status)) {
      await this.finishRuntime(runtime)
    } else if (runtime.record.status === 'paused') {
      this.notifyRuntimeSettled()
    }
    return runtime.record
  }

  commit (runtime, draftEvents) {
    const events = draftEvents.map(draft => {
      runtime.record.lastEventSequence++
      return AgentEventSchema.parse({
        schemaVersion: 2,
        eventId: id('event'),
        taskId: runtime.record.taskId,
        sequence: runtime.record.lastEventSequence,
        snapshotVersion: runtime.record.snapshotVersion,
        type: draft.type,
        occurredAt: new Date().toISOString(),
        correlationId: draft.correlationId,
        causationEventId: draft.causationEventId,
        payload: draft.payload || {}
      })
    })
    this.store.commit(runtime.record, events)
    for (const event of events) this.publish(runtime.record.ownerWindowId, event)
  }

  updateRuntime (runtime, draftEvents) {
    runtime.record.snapshotVersion++
    runtime.record.updatedAt = new Date().toISOString()
    this.commit(runtime, draftEvents)
  }

  syncApprovalTimer (runtime) {
    if (runtime.record.status !== 'awaiting_approval' || !runtime.record.pendingApproval) {
      if (runtime.approvalTimer) clearTimeout(runtime.approvalTimer)
      runtime.approvalTimer = null
      return
    }
    if (runtime.approvalTimer) return
    const approvalRequestId = runtime.record.pendingApproval.approvalRequestId
    const delay = Math.max(0, Date.parse(runtime.record.pendingApproval.expiresAt) - Date.now())
    runtime.approvalTimer = setTimeout(() => {
      runtime.approvalTimer = null
      const resolution = this.gateway.expireApproval(runtime.record, approvalRequestId)
      if (resolution) this.enqueue(runtime, { type: 'APPROVAL_RESOLVED', ...resolution, effectId: id('effect') })
    }, delay)
  }

  reportProgress (session, intent, value) {
    const runtime = this.sessions.get(session.taskId)
    if (!runtime || runtime.record.status !== 'executing') return
    const now = Date.now()
    const previous = runtime.lastProgressEventAt.get(intent.invocationId) || 0
    if (now - previous < 250) return
    runtime.lastProgressEventAt.set(intent.invocationId, now)
    const payload = {
      invocationId: intent.invocationId,
      message: String(value?.message || value || '执行中').slice(0, 500),
      bytesReceived: Number.isFinite(value?.bytesReceived) ? Math.max(0, Math.trunc(value.bytesReceived)) : undefined,
      stdoutBytes: Number.isFinite(value?.stdoutBytes) ? Math.max(0, Math.trunc(value.stdoutBytes)) : undefined,
      stderrBytes: Number.isFinite(value?.stderrBytes) ? Math.max(0, Math.trunc(value.stderrBytes)) : undefined,
      elapsedMs: Number.isFinite(value?.elapsedMs) ? Math.max(0, Math.trunc(value.elapsedMs)) : undefined,
      silentForMs: Number.isFinite(value?.silentForMs) ? Math.max(0, Math.trunc(value.silentForMs)) : undefined,
      safeLastLine: value?.safeLastLine ? String(value.safeLastLine).slice(0, 512) : undefined,
      truncated: value?.truncated === true,
      source: value?.source || 'timer',
      stream: value?.stream
    }
    if (payload.source === 'output') {
      this.latencyRecorder.mark(runtime.record.taskId, 'executionFirstOutput')
      if (this.featureFlags?.agentExecutionOutputProgressV2 === false) {
        payload.source = 'adapter'
        payload.message = payload.bytesReceived > 0 ? `已接收 ${payload.bytesReceived} 字节命令输出。` : '命令正在执行。'
        delete payload.safeLastLine
        delete payload.stream
      }
    }
    this.enqueue(runtime, { type: 'EXECUTION_PROGRESS', invocationId: intent.invocationId, payload })
  }

  async runEffect (runtime, effect) {
    if (isTerminalStatus(runtime.record.status) && effect.type !== 'ABORT_ACTIVE') return
    if (effect.type === 'ABORT_ACTIVE') {
      await this.abortActive(runtime, effect.reason)
      return
    }
    if (effect.type === 'RUN_HARNESS') {
      const allowed = checkBudget(runtime.record.budget)
      if (!allowed.allowed) {
        this.enqueue(runtime, { type: 'INCONCLUSIVE', reason: statusReason(allowed.code, '任务预算已用尽。', false), finalResult: inconclusiveResult(runtime.record, allowed.code), effectId: id('effect') })
        return
      }
      runtime.record.budget = consumeTurn(runtime.record.budget)
      this.latencyRecorder.incrementModelTurns(runtime.record.taskId)
      this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      runtime.abortController = new AbortController()
      if (!runtime.harness) {
        if (runtime.record.budget.usedReactSteps > 1) this.latencyRecorder.incrementRepeatedInitializations(runtime.record.taskId)
        runtime.harness = await this.providerSessions.acquire(runtime.record)
        const capabilities = runtime.harness.getCapabilities()
        const metadata = runtime.harness.metadata
        this.updateRuntime(runtime, [{
          type: 'provider.session_started',
          payload: {
            sessionId: metadata.sessionId,
            adapter: runtime.record.harness.adapter,
            providerId: runtime.record.harness.providerId,
            modelId: runtime.record.harness.modelId,
            capabilitySnapshotId: metadata.capabilitySnapshotId,
            streaming: capabilities.streaming === true,
            structuredOutput: capabilities.structuredOutput === true
          }
        }])
      }
      let decision
      const preparedContext = this.toTurnInput(runtime.record)
      const knowledgeFingerprint = preparedContext.input.knowledge.map(item => `${item.chunkId}@${item.sourceVersion}`).join(':')
      if (knowledgeFingerprint && knowledgeFingerprint !== runtime.lastKnowledgeFingerprint) {
        runtime.lastKnowledgeFingerprint = knowledgeFingerprint
        const retrievedCitations = preparedContext.input.knowledge.map(toKnowledgeCitation)
        runtime.record.knowledgeCitations = mergeKnowledgeCitations(
          this.knowledgeBase?.annotateCitations([...(runtime.record.knowledgeCitations || []), ...retrievedCitations]) || retrievedCitations
        )
        this.updateRuntime(runtime, [{
          type: 'knowledge.retrieved',
          payload: {
            count: preparedContext.input.knowledge.length,
            citations: retrievedCitations
          }
        }])
      }
      if (preparedContext.exhausted) {
        this.enqueue(runtime, { type: 'INCONCLUSIVE', reason: statusReason('context_exhausted', '上下文预算不足，已停止继续探查。', false), finalResult: inconclusiveResult(runtime.record, 'context_exhausted'), effectId: id('effect') })
        return
      }
      const providerDraft = createProviderDraft()
      let providerFailure
      try {
        for await (const event of runtime.harness.runTurn(preparedContext.input, runtime.abortController.signal)) {
          if ((event.type === 'status' || event.type === 'phase') && !isTerminalStatus(runtime.record.status)) {
            this.latencyRecorder.mark(runtime.record.taskId, 'firstLifecycle')
            this.latencyRecorder.mark(runtime.record.taskId, 'firstStatus')
            runtime.record.harnessActivity = {
              phase: normalizeProviderPhase(event.phase),
              message: String(event.safeMessage || event.message || 'AI 正在处理请求。').slice(0, 200),
              updatedAt: new Date().toISOString()
            }
            this.updateRuntime(runtime, [
              { type: 'harness.progress', payload: runtime.record.harnessActivity },
              { type: 'provider.phase', payload: { ...runtime.record.harnessActivity, code: event.code } }
            ])
          }
          if (event.type === 'provider_warning' && !isTerminalStatus(runtime.record.status)) {
            runtime.record.harnessActivity = {
              phase: 'responding',
              message: String(event.safeMessage || event.message || '模型输出正在安全降级处理。').slice(0, 200),
              updatedAt: new Date().toISOString()
            }
            this.updateRuntime(runtime, [{
              type: 'harness.progress',
              payload: runtime.record.harnessActivity
            }])
          }
          if (event.type === 'text.delta') {
            this.latencyRecorder.mark(runtime.record.taskId, 'providerTtft')
            this.latencyRecorder.mark(runtime.record.taskId, 'firstModelResponse')
            this.consumeProviderText(runtime, providerDraft, event.delta)
          }
          if (event.type === 'decision' || event.type === 'decision.completed') {
            this.latencyRecorder.mark(runtime.record.taskId, 'firstModelResponse')
            decision = event.decision
          }
          if (event.type === 'usage') {
            const inputTokens = nonnegativeInteger(event.inputTokens)
            const outputTokens = nonnegativeInteger(event.outputTokens)
            runtime.record.budget.modelInputTokens = (runtime.record.budget.modelInputTokens || 0) + inputTokens
            runtime.record.budget.modelOutputTokens = (runtime.record.budget.modelOutputTokens || 0) + outputTokens
            this.latencyRecorder.addUsage(runtime.record.taskId, inputTokens, outputTokens)
            this.updateRuntime(runtime, [{
              type: 'usage.updated',
              payload: {
                inputTokens: runtime.record.budget.modelInputTokens,
                outputTokens: runtime.record.budget.modelOutputTokens,
                cachedTokens: nonnegativeInteger(event.cachedTokens)
              }
            }])
          }
          if (event.type === 'error') throw providerEventError(event.error)
        }
      } catch (error) {
        providerFailure = error
      } finally {
        this.completeProviderText(runtime, providerDraft, providerFailure ? 'interrupted' : 'completed')
      }
      if (this.featureFlags.agentPersistentProviderSessionV2 === false) {
        await this.providerSessions.close(runtime.record.taskId, providerFailure ? 'failed' : 'completed')
        runtime.harness = null
      }
      if (providerFailure) throw providerFailure
      if (!decision) throw agentError('AGENT_INVALID_MODEL_OUTPUT', '模型未返回有效的结构化决策。')
      decision = sanitizeDecision(runtime.record, PlannerDecisionSchema.parse(decision))
      const sensitiveQuestion = decision.goalStatus === 'need_user' && looksSensitiveInput(decision.userQuestion)
      if (sensitiveQuestion) {
        decision.reasonSummary = '当前已认证的 SSH 会话不需要再次提供登录凭据，Agent 也不会在分析窗口收集密码、私钥或令牌。'
        decision.userQuestion = '如果目标操作本身需要 sudo、TTY 或其他交互，请在下一轮明确该操作；系统会先展示具体命令和风险，得到批准后再转交当前终端。'
        decision.missingInformation = [...new Set([...decision.missingInformation, '是否确实需要执行会触发 sudo、TTY 或凭据交互的操作'])].slice(0, 10)
      }
      decision.action = decision.action
        ? {
            ...decision.action,
            taskId: runtime.record.taskId,
            invocationId: id('invocation')
          }
        : undefined
      decision.readProbeBundle = decision.readProbeBundle
        ? {
            ...decision.readProbeBundle,
            bundleId: id('bundle'),
            actions: decision.readProbeBundle.actions.map(item => ({
              ...item,
              dependsOn: [],
              intent: {
                ...item.intent,
                taskId: runtime.record.taskId,
                invocationId: id('invocation')
              }
            }))
          }
        : undefined
      this.enqueue(runtime, {
        type: 'PLANNER_DECISION',
        decision,
        requestId: id('input'),
        userInputKind: 'text',
        reason: decision.goalStatus === 'blocked'
          ? statusReason('planner_blocked', decision.reasonSummary || '当前策略或环境阻止继续。', false)
          : decision.goalStatus === 'need_user'
            ? statusReason('needs_user_decision', '当前信息不足以安全选择下一步，本轮已停止。', true)
            : undefined,
        finalResult: decision.goalStatus === 'blocked'
          ? baseResult(runtime.record, 'blocked', decision.reasonSummary || '当前策略或环境阻止继续。')
          : decision.goalStatus === 'need_user'
            ? needUserResult(runtime.record, decision)
            : undefined,
        effectId: id('effect')
      })
      return
    }
    if (effect.type === 'EVALUATE_INTENT') {
      const beforeAutoReads = runtime.record.budget.usedAutoReadActions
      const prepared = await this.gateway.prepare(runtime.record, effect.intent)
      if (runtime.record.budget.usedAutoReadActions !== beforeAutoReads) {
        this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      }
      if (prepared.intent.toolName !== 'shell.exec' && prepared.mutability !== 'none' && prepared.decision.outcome !== 'deny' && prepared.intent.verificationPlan?.preconditions.length) {
        const beforeVerificationReads = runtime.record.budget.usedAutoReadActions
        this.updateRuntime(runtime, [{
          type: 'verification.started',
          correlationId: prepared.intent.invocationId,
          payload: { planId: prepared.intent.verificationPlan.planId, phase: 'precheck' }
        }])
        const outcome = await this.verificationRunner.runChecks(runtime.record, prepared.intent.verificationPlan, 'precheck', runtime.abortController?.signal)
        runtime.record.verification = { outcomes: [...(runtime.record.verification?.outcomes || []), outcome].slice(-100) }
        runtime.record.evidenceRefs = [...new Set([...runtime.record.evidenceRefs, ...outcome.evidenceRefs])]
        const events = [{ type: 'verification.finished', correlationId: prepared.intent.invocationId, payload: { ...outcome, phase: 'precheck' } }]
        if (runtime.record.budget.usedAutoReadActions !== beforeVerificationReads) events.push({ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget })
        this.updateRuntime(runtime, events)
        if (outcome.status !== 'passed') {
          prepared.decision = {
            ...prepared.decision,
            outcome: 'deny',
            reasons: [...prepared.decision.reasons, {
              code: 'precheck_not_passed',
              message: '变更前置检查未通过，动作未进入审批或执行。',
              source: 'builtin_rule'
            }],
            matchedRuleIds: [...prepared.decision.matchedRuleIds, 'precheck_not_passed'],
            allowedApprovalScopes: []
          }
          prepared.reason = statusReason('precheck_not_passed', '变更前置检查未通过，需调整动作或补充信息。', true)
          delete prepared.approval
          delete prepared.capability
        }
      }
      this.enqueue(runtime, { type: 'POLICY_DECIDED', ...prepared, effectId: id('effect') })
      return
    }
    if (effect.type === 'EVALUATE_READ_BUNDLE') {
      if (this.featureFlags.agentReadProbeBundleV2 === false) {
        const prepared = await this.gateway.prepare(runtime.record, effect.bundle.actions[0].intent)
        this.enqueue(runtime, { type: 'POLICY_DECIDED', ...prepared, effectId: id('effect') })
        return
      }
      const beforeAutoReads = runtime.record.budget.usedAutoReadActions
      const preparedBundle = await this.readProbeBundles.prepare(runtime.record, effect.bundle)
      if (runtime.record.budget.usedAutoReadActions !== beforeAutoReads) {
        this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      }
      if (preparedBundle.mode === 'serial') {
        const candidate = [...preparedBundle.prepared].reverse().find(item => item.prepared)?.prepared
        if (candidate) {
          this.enqueue(runtime, { type: 'POLICY_DECIDED', ...candidate, effectId: id('effect') })
          return
        }
        const unsafe = preparedBundle.prepared.find(item => item.reasons?.length)?.action?.intent || preparedBundle.bundle.actions[0].intent
        const prepared = await this.gateway.prepare(runtime.record, unsafe)
        this.enqueue(runtime, { type: 'POLICY_DECIDED', ...prepared, effectId: id('effect') })
        return
      }
      this.enqueue(runtime, { type: 'BUNDLE_POLICY_DECIDED', preparedBundle, effectId: id('effect') })
      return
    }
    if (effect.type === 'EXECUTE_INTENT') {
      this.latencyRecorder.incrementToolInvocations(runtime.record.taskId)
      const executed = await this.gateway.execute(runtime.record, effect.intent, effect.capability, runtime.abortController?.signal, effect.timeoutMs)
      this.latencyRecorder.mark(runtime.record.taskId, 'firstExecutionResult')
      this.enqueue(runtime, { type: 'EXECUTION_FINISHED', result: executed.result, streams: executed.streams, effectId: id('effect') })
      return
    }
    if (effect.type === 'EXECUTE_READ_BUNDLE') {
      this.latencyRecorder.incrementToolInvocations(runtime.record.taskId, effect.preparedBundle.prepared.length)
      const execution = await this.readProbeBundles.executePrepared(runtime.record, effect.preparedBundle, runtime.abortController?.signal)
      this.latencyRecorder.mark(runtime.record.taskId, 'firstExecutionResult')
      this.enqueue(runtime, { type: 'BUNDLE_EXECUTION_FINISHED', execution, effectId: id('effect') })
      return
    }
    if (effect.type === 'BUILD_OBSERVATION') {
      const observation = await this.observationPipeline.process(runtime.record, effect.result, effect.streams, runtime.abortController?.signal)
      const followUp = runtime.pendingVerificationFollowUps.get(effect.result.invocationId)
      if (followUp) {
        runtime.pendingVerificationFollowUps.delete(effect.result.invocationId)
        const passed = effect.result.status === 'success' && evaluatePredicate(followUp.check.predicate, observation, effect.streams)
        const checkStatus = passed ? 'passed' : effect.result.status === 'success' ? 'failed' : 'inconclusive'
        const checkResult = {
          checkId: followUp.check.checkId,
          status: checkStatus,
          actualSummary: observation.summary,
          evidenceRefs: observation.evidenceRefs
        }
        const checkResults = [...(followUp.obligation.checkResults || []), checkResult]
        const evidenceRefs = [...new Set([...(followUp.obligation.evidenceRefs || []), ...observation.evidenceRefs])]
        const remainingChecks = followUp.obligation.verificationPlan.postconditions.slice(1)
        const status = checkResults.some(item => item.status === 'failed')
          ? 'failed'
          : checkResults.some(item => item.status === 'inconclusive')
            ? 'inconclusive'
            : remainingChecks.length ? 'partial' : 'passed'
        const outcome = {
          planId: followUp.obligation.verificationPlan.planId,
          status,
          checkResults,
          evidenceRefs,
          verifiedAt: new Date().toISOString()
        }
        runtime.record = remainingChecks.length
          ? recordWithPendingVerification(runtime.record, followUp.obligation, remainingChecks, checkResults, evidenceRefs, outcome)
          : recordWithVerification(runtime.record, followUp.obligation.invocationId, outcome)
        if (!remainingChecks.length && outcome.status !== 'passed') {
          runtime.pendingTerminalVerification = { obligation: followUp.obligation, outcome }
        }
        this.updateRuntime(runtime, [{
          type: 'verification.finished',
          correlationId: effect.result.invocationId,
          payload: { ...outcome, phase: 'postcheck' }
        }])
      }
      this.enqueue(runtime, { type: 'OBSERVATION_READY', observation, effectId: id('effect') })
      return
    }
    if (effect.type === 'BUILD_BUNDLE_OBSERVATIONS') {
      const observations = []
      const invocations = []
      for (const item of effect.execution.results) {
        const invocation = bundleInvocation(item.intent)
        invocations.push(invocation)
        runtime.record.currentInvocation = invocation
        const observation = item.result
          ? await this.observationPipeline.process(runtime.record, item.result, item.streams, runtime.abortController?.signal)
          : bundleFailureObservation(item)
        observations.push(observation)
      }
      this.enqueue(runtime, { type: 'BUNDLE_OBSERVATIONS_READY', observations, invocations, effectId: id('effect') })
      return
    }
    if (effect.type === 'REDUCE_CONTEXT') {
      const memory = reconcileObservation(runtime.record.memory, effect.observation)
      runtime.record.latestObservation = effect.observation
      runtime.record.recentErrors = [...runtime.record.recentErrors, ...effect.observation.errors].slice(-20)
      runtime.record.budget = recordResult(runtime.record.budget, {
        error: effect.observation.status !== 'success',
        capturedBytes: effect.observation.sample.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0)
      })
      runtime.lastProgress = runtime.progressDetector.record(memory, runtime.record.currentInvocation || { toolName: 'unknown', arguments: {}, target: {} }, effect.observation.errors[0]?.category)
      runtime.record.evidenceRefs = [...new Set([...runtime.record.evidenceRefs, ...effect.observation.evidenceRefs])]
      const invocation = runtime.record.currentInvocation
      if (invocation?.mutability !== 'none' && invocation.verificationPlan) {
        const existing = memory.changeRecords.find(item => item.invocationId === invocation.invocationId)
        if (!existing) {
          memory.changeRecords.push({
            invocationId: invocation.invocationId,
            intentDigest: invocation.intentDigest,
            resource: invocation.target,
            expectedEffect: invocation.purpose,
            actualStatus: invocation.actualResultStatus,
            approvalRequestId: invocation.approvalRequestId,
            verificationPlanId: invocation.verificationPlan.planId,
            verificationStatus: 'pending',
            evidenceRefs: effect.observation.evidenceRefs
          })
          memory.verificationObligations.push({
            invocationId: invocation.invocationId,
            verificationPlan: invocation.verificationPlan,
            executionStatus: invocation.actualResultStatus
          })
        }
      }
      this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      this.enqueue(runtime, { type: 'CONTEXT_REDUCED', memory, effectId: id('effect') })
      return
    }
    if (effect.type === 'REDUCE_BUNDLE_CONTEXT') {
      let memory = runtime.record.memory
      for (const [index, observation] of effect.observations.entries()) {
        const invocation = effect.invocations[index]
        memory = reconcileObservation(memory, observation)
        runtime.record.currentInvocation = invocation
        runtime.record.latestObservation = observation
        runtime.record.recentErrors = [...runtime.record.recentErrors, ...observation.errors].slice(-20)
        runtime.record.budget = recordResult(runtime.record.budget, {
          error: observation.status !== 'success',
          capturedBytes: observation.sample.reduce((sum, item) => sum + Buffer.byteLength(item.text, 'utf8'), 0)
        })
        runtime.lastProgress = runtime.progressDetector.record(memory, invocation, observation.errors[0]?.category)
        runtime.record.evidenceRefs = [...new Set([...runtime.record.evidenceRefs, ...observation.evidenceRefs])]
      }
      this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      this.enqueue(runtime, { type: 'CONTEXT_REDUCED', memory, effectId: id('effect') })
      return
    }
    if (effect.type === 'EVALUATE_PROGRESS') {
      if (runtime.pendingTerminalVerification) {
        const { obligation, outcome } = runtime.pendingTerminalVerification
        runtime.pendingTerminalVerification = null
        const finalResult = mutationVerificationResult(runtime.record, outcome, createRollbackIntent(runtime.record, obligation.verificationPlan))
        this.enqueue(runtime, {
          type: outcome.status === 'failed' ? 'FAIL' : 'INCONCLUSIVE',
          reason: statusReason('mutation_verification_failed', outcome.status === 'failed' ? '操作已执行，但结果检查未通过。' : '操作已执行，但结果检查未能完成。', false),
          ...(outcome.status === 'failed' ? { payload: finalResult } : { finalResult }),
          effectId: id('effect')
        })
        return
      }
      const obligation = runtime.record.memory.verificationObligations[0]
      if (obligation) {
        const followUp = buildVerificationFollowUp(this.gateway, runtime.record, obligation)
        if (!followUp) {
          this.enqueue(runtime, { type: 'CONTINUE_PLANNING', effectId: id('effect') })
          return
        }
        runtime.pendingVerificationFollowUps.set(followUp.intent.invocationId, {
          obligation,
          check: followUp.check
        })
        this.enqueue(runtime, {
          type: 'FOLLOW_UP_PROPOSED',
          intent: followUp.intent,
          reason: statusReason('verification_confirmation_required', '已完成当前命令；下面是可选的结果验证，执行前仍需你的确认。', true),
          effectId: id('effect')
        })
        return
      }
      if (runtime.lastProgress?.blocked) {
        this.enqueue(runtime, { type: 'INCONCLUSIVE', reason: statusReason('no_progress_loop', '重复动作没有产生新事实，已停止自动循环。', false), finalResult: inconclusiveResult(runtime.record, 'no_progress_loop'), effectId: id('effect') })
        return
      }
      const allowed = checkBudget(runtime.record.budget)
      if (!allowed.allowed) {
        this.enqueue(runtime, { type: 'INCONCLUSIVE', reason: statusReason(allowed.code, '任务已停止继续探查。', false), finalResult: inconclusiveResult(runtime.record, allowed.code), effectId: id('effect') })
      } else {
        this.enqueue(runtime, { type: 'CONTINUE_PLANNING', effectId: id('effect') })
      }
      return
    }
    if (effect.type === 'RUN_MUTATION_VERIFICATION') {
      const obligation = effect.obligation
      if (runtime.cancelAfterSafePoint && runtime.abortController?.signal.aborted) runtime.abortController = new AbortController()
      const beforeVerificationReads = runtime.record.budget.usedAutoReadActions
      const outcome = await this.verificationRunner.runChecks(runtime.record, obligation.verificationPlan, 'postcheck', runtime.abortController?.signal)
      if (runtime.record.budget.usedAutoReadActions !== beforeVerificationReads) {
        this.updateRuntime(runtime, [{ type: 'budget.updated', payload: this.toViewModel(runtime.record).budget }])
      }
      const rollbackIntent = outcome.status === 'passed' ? null : createRollbackIntent(runtime.record, obligation.verificationPlan)
      const preview = recordWithVerification(runtime.record, obligation.invocationId, outcome)
      const finalResult = outcome.status === 'passed' ? undefined : mutationVerificationResult(preview, outcome, rollbackIntent)
      this.enqueue(runtime, {
        type: 'MUTATION_VERIFIED',
        invocationId: obligation.invocationId,
        outcome,
        reason: statusReason(outcome.status === 'passed' ? 'mutation_verified' : 'mutation_verification_failed', outcome.status === 'passed' ? '变更已通过只读后置验证。' : '变更后置验证未通过，不能宣称操作完成。', outcome.status !== 'failed'),
        finalResult,
        effectId: id('effect')
      })
      return
    }
    if (effect.type === 'VERIFY_COMPLETION') {
      const decision = await this.completionEvaluator.evaluate(runtime.record)
      const outcome = completionOutcome(runtime.record, decision)
      if (this.finalSynthesizer && this.featureFlags.agentGroundedSynthesisEnabled) {
        try {
          const synthesis = await this.finalSynthesizer.synthesize(runtime.record, outcome, runtime.abortController?.signal)
          this.latencyRecorder.mark(runtime.record.taskId, 'finalSynthesis')
          outcome.finalResult = synthesis.finalResult
          this.publishAssistantResponse(runtime, synthesis.responseText, synthesis.synthesized)
        } catch (_) {
          this.latencyRecorder.mark(runtime.record.taskId, 'finalSynthesis')
          this.publishAssistantResponse(runtime, outcome.finalResult.conclusion, false)
        }
      }
      const type = outcome.status === 'complete' ? 'COMPLETE' : outcome.status === 'blocked' ? 'BLOCK' : outcome.status === 'failed' ? 'FAIL' : 'INCONCLUSIVE'
      this.enqueue(runtime, { type, reason: outcome.reason, finalResult: outcome.finalResult, payload: { finalResult: outcome.finalResult }, effectId: id('effect') })
    }
  }

  enqueue (runtime, command) {
    runtime.mailbox.push(command).catch(error => this.failRuntime(runtime, error))
  }

  publishAssistantResponse (runtime, text, synthesized) {
    const value = String(text || '').trim().slice(0, 5000)
    if (!value) return
    const responseId = id('response')
    const chunks = chunkText(value, 180)
    runtime.record.assistantResponse = {
      responseId,
      text: value,
      status: 'completed',
      updatedAt: new Date().toISOString()
    }
    runtime.record.snapshotVersion++
    runtime.record.updatedAt = new Date().toISOString()
    this.commit(runtime, [
      ...chunks.map((delta, index) => ({
        type: 'assistant.delta',
        correlationId: responseId,
        payload: { responseId, sequence: index + 1, delta }
      })),
      {
        type: 'assistant.completed',
        correlationId: responseId,
        payload: { responseId, text: value, synthesized: synthesized === true }
      }
    ])
  }

  consumeProviderText (runtime, draft, value) {
    const redacted = draft.redactor.push(value)
    if (redacted.failed || !redacted.text) return
    const remaining = 5000 - draft.text.length - draft.pending.length
    if (remaining <= 0) return
    draft.pending += redacted.text.slice(0, remaining)
    if (Date.now() - draft.lastPublishedAt >= 50) this.flushProviderText(runtime, draft)
  }

  flushProviderText (runtime, draft) {
    if (!draft.pending || isTerminalStatus(runtime.record.status)) return
    const delta = draft.pending
    draft.pending = ''
    draft.text += delta
    draft.lastPublishedAt = Date.now()
    runtime.record.assistantResponse = {
      responseId: draft.responseId,
      text: draft.text,
      status: 'streaming',
      updatedAt: new Date().toISOString()
    }
    this.updateRuntime(runtime, [{
      type: 'assistant.delta',
      correlationId: draft.responseId,
      payload: { responseId: draft.responseId, sequence: ++draft.sequence, delta }
    }])
  }

  completeProviderText (runtime, draft, status) {
    const redacted = draft.redactor.flush()
    if (!redacted.failed && redacted.text) {
      const remaining = 5000 - draft.text.length - draft.pending.length
      if (remaining > 0) draft.pending += redacted.text.slice(0, remaining)
    }
    this.flushProviderText(runtime, draft)
    if (!draft.text || isTerminalStatus(runtime.record.status)) return
    runtime.record.assistantResponse = {
      responseId: draft.responseId,
      text: draft.text,
      status,
      updatedAt: new Date().toISOString()
    }
    if (status === 'completed') {
      this.updateRuntime(runtime, [{
        type: 'assistant.completed',
        correlationId: draft.responseId,
        payload: { responseId: draft.responseId, text: draft.text, synthesized: false }
      }])
    } else {
      this.updateRuntime(runtime, [])
    }
  }

  preemptActive (runtime, reason) {
    if (runtime.abortController && !runtime.abortController.signal.aborted) runtime.abortController.abort(reason)
    this.gateway.cancel?.(runtime.record.taskId).catch(() => {})
  }

  async abortActive (runtime, reason) {
    if (runtime.abortController && !runtime.abortController.signal.aborted) runtime.abortController.abort(reason)
    this.revokeRuntimeResources(runtime)
    await this.gateway.cancel?.(runtime.record.taskId)
  }

  revokeRuntimeResources (runtime) {
    if (runtime.resourcesRevoked) return
    runtime.resourcesRevoked = true
    this.gateway.revokeTask?.(runtime.record.taskId)
  }

  async finishRuntime (runtime) {
    if (runtime.finished) return
    runtime.finished = true
    if (runtime.approvalTimer) clearTimeout(runtime.approvalTimer)
    runtime.approvalTimer = null
    this.revokeRuntimeResources(runtime)
    const harness = runtime.harness
    runtime.harness = null
    runtime.abortController = null
    runtime.cancelAfterSafePoint = null
    runtime.pauseAfterSafePoint = null
    try { await this.providerSessions.close(runtime.record.taskId, providerCloseReason(runtime.record.status)) } catch (_) {}
    try { await harness?.dispose?.() } catch (_) {}
    this.latencyRecorder.setEvidenceCounts(runtime.record.taskId, runtime.record.evidenceRefs.length, citedEvidenceCount(runtime.record))
    this.latencyRecorder.setVerificationCount(runtime.record.taskId, runtime.record.verification?.outcomes?.length || 0)
    this.latencyRecorder.finish(runtime.record.taskId, runtime.record.status)
    this.notifyRuntimeSettled()
  }

  notifyRuntimeSettled () {
    try { this.onRuntimeSettled() } catch (_) {}
  }

  async dispose () {
    for (const runtime of this.sessions.values()) {
      if (runtime.approvalTimer) clearTimeout(runtime.approvalTimer)
      runtime.approvalTimer = null
      this.preemptActive(runtime, 'shutdown')
      this.revokeRuntimeResources(runtime)
    }
    await this.providerSessions.dispose()
  }

  async failRuntime (runtime, error) {
    if (isTerminalStatus(runtime.record.status)) return
    try {
      await runtime.mailbox.push({
        type: 'FAIL',
        reason: statusReason(error.code || 'internal_error', error.safeMessage || 'Agent 运行时发生错误。', false),
        payload: { error: safeError(error), finalResult: failedResult(runtime.record, error) },
        effectId: id('effect')
      })
    } catch (_) {}
  }

  toTurnInput (record) {
    const skillCandidates = this.featureFlags.agentSkillsEnabled ? this.skillRegistry?.routeMetadata(record.prompt, 8) || [] : []
    const skills = this.skillRegistry?.loadSelected(skillCandidates.map(item => item.id), { limit: 2, tokenBudget: 3000 }) || []
    const knowledge = this.featureFlags.agentKnowledgeEnabled
      ? this.knowledgeBase?.search(`${record.prompt}\n${record.memory.missingInformation.join('\n')}`, 6) || []
      : []
    const input = {
      schemaVersion: 1,
      taskId: record.taskId,
      objective: record.prompt,
      mode: record.mode,
      uiLocale: record.uiLocale || 'zh-CN',
      sessionSummary: {
        host: record.sessionBinding.host,
        username: record.sessionBinding.username,
        cwd: record.sessionBinding.cwd,
        shell: record.sessionBinding.shell,
        platform: record.sessionBinding.platform
      },
      workingMemory: record.memory,
      budgetRemaining: remaining(record.budget),
      availableTools: this.gateway.publicTools({
        objective: record.prompt,
        missingInformation: record.memory.missingInformation,
        latestError: record.recentErrors[record.recentErrors.length - 1],
        adaptationHints: record.latestObservation?.adaptationHints
      }),
      skills,
      knowledge,
      latestObservation: record.latestObservation
    }
    const prepared = prepareTurnInput(input, record.harness.maxContextTokens)
    return { input: prepared.input, exhausted: prepared.exhausted, contextMetrics: prepared.metrics }
  }

  toViewModel (record) {
    const now = Date.now()
    const knowledgeCitations = this.knowledgeBase?.annotateCitations(record.knowledgeCitations || []) || record.knowledgeCitations || []
    return {
      schemaVersion: 1,
      taskId: record.taskId,
      parentTaskId: record.parentTaskId,
      status: record.status,
      statusReason: record.statusReason && { code: record.statusReason.code, message: record.statusReason.safeMessage },
      snapshotVersion: record.snapshotVersion,
      lastEventSequence: record.lastEventSequence,
      mode: record.mode,
      prompt: record.prompt,
      binding: {
        tabId: record.sessionBinding.tabId,
        host: record.sessionBinding.host,
        port: record.sessionBinding.port,
        username: record.sessionBinding.username,
        cwd: record.sessionBinding.cwd,
        bindingConfidence: record.sessionBinding.bindingConfidence
      },
      budget: {
        reactSteps: { used: record.budget.usedReactSteps, max: record.budget.maxReactSteps },
        autoReadActions: { used: record.budget.usedAutoReadActions, max: record.budget.maxAutoReadActions },
        consecutiveErrors: { used: record.budget.consecutiveErrors, max: record.budget.maxConsecutiveErrors },
        elapsedMs: Math.max(0, now - Date.parse(record.createdAt)),
        remainingMs: Math.max(0, Date.parse(record.budget.approvedLongDeadlineAt || record.budget.taskDeadlineAt) - now)
      },
      plan: record.memory.planSummary
        ? {
            planSummary: record.memory.planSummary,
            reasonSummary: record.memory.reasonSummary || '',
            missingInformation: record.memory.missingInformation,
            completionCriteria: record.memory.completionCriteria
          }
        : undefined,
      activity: record.harnessActivity,
      assistantResponse: record.assistantResponse,
      timeline: [],
      pendingApproval: record.pendingApproval
        ? {
            ...record.pendingApproval.display,
            intentDigest: record.pendingApproval.intentDigest,
            allowedDecisions: record.pendingApproval.allowedDecisions
          }
        : undefined,
      pendingUserInput: record.pendingUserInput,
      latestObservation: record.latestObservation,
      finalResult: record.finalResult
        ? { ...record.finalResult, knowledgeCitations: this.knowledgeBase?.annotateCitations(record.finalResult.knowledgeCitations || knowledgeCitations) || record.finalResult.knowledgeCitations || knowledgeCitations }
        : undefined,
      knowledgeCitations,
      evidenceRefs: record.evidenceRefs,
      availableControls: controlsFor(record.status)
    }
  }
}

function statusReason (code, safeMessage, recoverable) {
  return { code, safeMessage, recoverable }
}

function sameBinding (a, b) {
  return a.tabId === b.tabId && a.connectionId === b.connectionId && a.sessionPid === b.sessionPid && a.host === b.host && a.port === b.port && a.username === b.username && a.cwd === b.cwd && (!a.hostKeyFingerprint || !b.hostKeyFingerprint || a.hostKeyFingerprint === b.hostKeyFingerprint)
}

function controlsFor (status) {
  if (isTerminalStatus(status)) return ['clear_evidence']
  if (status === 'paused') return ['resume', 'cancel', 'clear_evidence']
  return ['pause', 'cancel', 'clear_evidence']
}

function baseResult (record, status, conclusion) {
  return {
    status,
    conclusion,
    confirmedFacts: record.memory.facts.filter(f => f.confidence !== 'inferred'),
    inferences: record.memory.facts.filter(f => f.confidence === 'inferred'),
    unresolvedItems: record.memory.missingInformation,
    operations: record.memory.changeRecords,
    verificationOutcomes: record.verification?.outcomes || [],
    evidenceRefs: record.evidenceRefs,
    knowledgeCitations: record.knowledgeCitations || [],
    ...(record.latestObservation?.terminalTranscript
      ? { terminalTranscript: { invocationId: record.latestObservation.invocationId, ...record.latestObservation.terminalTranscript } }
      : {}),
    completedAt: new Date().toISOString()
  }
}

function sanitizeDecision (record, decision) {
  const factsById = new Map(record.memory.facts.map(fact => [fact.factId, fact]))
  const factIds = new Set(factsById.keys())
  const evidenceRefs = new Set(record.evidenceRefs)
  const knownFactIds = decision.knownFactIds.filter(factId => factIds.has(factId))
  const completionEvidenceRefs = [...new Set(knownFactIds.flatMap(factId => factsById.get(factId)?.evidenceRefs || []))]
    .filter(ref => evidenceRefs.has(ref))
  const canConfirmCompletion = decision.goalStatus === 'complete' &&
    decision.missingInformation.length === 0 &&
    knownFactIds.length > 0 &&
    completionEvidenceRefs.length > 0
  return {
    ...decision,
    knownFactIds,
    completionCriteria: decision.completionCriteria.map(criterion => {
      let validRefs = criterion.evidenceRefs.filter(ref => evidenceRefs.has(ref))
      let status = criterion.status
      if (canConfirmCompletion && status !== 'passed' && !validRefs.length) {
        status = 'passed'
        validRefs = completionEvidenceRefs
      } else if (status === 'passed' && !validRefs.length) {
        status = 'inconclusive'
      }
      return { ...criterion, status, evidenceRefs: validRefs }
    })
  }
}

function recordWithVerification (record, invocationId, outcome) {
  return {
    ...record,
    memory: {
      ...record.memory,
      changeRecords: record.memory.changeRecords.map(change => change.invocationId === invocationId
        ? { ...change, verificationStatus: outcome.status, evidenceRefs: [...new Set([...change.evidenceRefs, ...outcome.evidenceRefs])] }
        : change),
      verificationObligations: record.memory.verificationObligations.filter(item => item.invocationId !== invocationId)
    },
    verification: { outcomes: [...(record.verification?.outcomes || []), outcome].slice(-100) },
    evidenceRefs: [...new Set([...record.evidenceRefs, ...outcome.evidenceRefs])]
  }
}

function mutationVerificationResult (record, outcome, rollbackIntent) {
  const status = outcome.status === 'failed' ? 'failed' : 'inconclusive'
  return {
    ...baseResult(record, status, outcome.status === 'failed'
      ? '变更已执行，但只读后置验证失败，不能确认目标状态。'
      : '变更已执行，但后置结果检查未能完成，远端状态仍需确认。'),
    nextSuggestedProbe: rollbackIntent
      ? {
          toolName: rollbackIntent.toolName,
          arguments: rollbackIntent.arguments,
          target: rollbackIntent.target,
          purpose: `${rollbackIntent.purpose}；执行前必须重新评估、审批并声明回滚后验证。`
        }
      : undefined
  }
}

function cancelledResult (record) { return baseResult(record, 'cancelled', '任务已由用户中断。') }

function citedEvidenceCount (record) {
  const cited = new Set()
  for (const fact of record.finalResult?.confirmedFacts || []) {
    for (const ref of fact.evidenceRefs || []) cited.add(ref)
  }
  for (const outcome of record.finalResult?.verificationOutcomes || []) {
    for (const ref of outcome.evidenceRefs || []) cited.add(ref)
  }
  return cited.size
}
function inconclusiveResult (record, code) {
  const message = code === 'react_steps_exhausted'
    ? 'AI 未能在本轮生成有效的下一步，任务已停止，未继续执行命令。'
    : 'AI 未能完成当前请求，任务已停止，未继续执行命令。'
  return baseResult(record, 'inconclusive', message)
}
function needUserResult (record, decision) {
  const question = String(decision.userQuestion || '').trim()
  const reason = String(decision.reasonSummary || '').trim()
  return {
    ...baseResult(record, 'inconclusive', [reason, question].filter(Boolean).join(' ')),
    unresolvedItems: [...new Set([...(decision.missingInformation || []), question].filter(Boolean))]
  }
}
function failedResult (record, error) { return baseResult(record, 'failed', error.safeMessage || '任务执行失败。') }

function completionOutcome (record, decision) {
  const knownEvidenceRefs = new Set(record.evidenceRefs)
  const directAnswer = summarizeDirectLookup(
    record.memory.facts.filter(fact => fact.evidenceRefs?.some(ref => knownEvidenceRefs.has(ref))),
    record.prompt
  )
  const status = directAnswer ? 'complete' : decision.status === 'satisfied' ? 'complete' : decision.status
  const effectiveDecision = directAnswer
    ? { ...decision, status: 'satisfied', unresolved: [], warnings: [] }
    : decision
  const conclusion = status === 'complete'
    ? directAnswer || summarizeVerifiedFacts(record.memory.facts, record.prompt)
    : decision.warnings[0] || 'AI 尚未完成全部关键目标，本轮已停止。'
  return {
    status,
    decision: effectiveDecision,
    reason: status === 'complete'
      ? undefined
      : statusReason(status === 'failed' ? 'unverified_change' : 'insufficient_evidence', conclusion, status !== 'failed'),
    finalResult: {
      ...baseResult(record, status, conclusion),
      unresolvedItems: effectiveDecision.unresolved
    }
  }
}

function summarizeVerifiedFacts (facts, objective = '') {
  const verified = facts.filter(item => item.confidence !== 'inferred')
  const directAnswer = summarizeDirectLookup(verified, objective)
  if (directAnswer) return directAnswer
  const keywords = objectiveKeywords(objective)
  const relevant = keywords.length
    ? verified.filter(item => keywords.some(keyword => String(item.statement || '').toLowerCase().includes(keyword)))
    : verified
  const value = (relevant.length ? relevant : verified).slice(0, 2).map(item => item.statement).join('；')
  return value.slice(0, 5000) || '已完成当前目标的证据检查。'
}

function toKnowledgeCitation (item) {
  return {
    sourceId: item.sourceId,
    sourcePath: item.sourcePath,
    sourceVersion: item.sourceVersion,
    chunkId: item.chunkId,
    startLine: item.startLine,
    endLine: item.endLine,
    score: item.score,
    retrievedAt: item.retrievedAt,
    retrievalMode: item.retrievalMode || 'fts',
    stale: item.stale === true
  }
}

function mergeKnowledgeCitations (citations) {
  const byChunk = new Map()
  for (const citation of citations) byChunk.set(`${citation.sourceId}:${citation.chunkId}:${citation.sourceVersion}`, citation)
  return [...byChunk.values()].slice(-100)
}

function buildVerificationFollowUp (gateway, record, obligation) {
  const check = obligation?.verificationPlan?.postconditions?.[0]
  if (!check?.intent) return null
  const descriptor = gateway.publicTools().find(tool => tool.name === check.intent.toolName)
  if (!descriptor) return null
  return {
    check,
    intent: {
      schemaVersion: 1,
      taskId: record.taskId,
      invocationId: id('invocation'),
      toolName: descriptor.name,
      toolVersion: descriptor.version,
      arguments: check.intent.arguments,
      target: check.intent.target,
      purpose: check.intent.purpose || check.description,
      expectedObservation: check.description
    }
  }
}

function recordWithPendingVerification (record, obligation, remainingChecks, checkResults, evidenceRefs, outcome) {
  return {
    ...record,
    memory: {
      ...record.memory,
      verificationObligations: record.memory.verificationObligations.map(item => item.invocationId === obligation.invocationId
        ? {
            ...item,
            verificationPlan: { ...item.verificationPlan, postconditions: remainingChecks },
            checkResults,
            evidenceRefs
          }
        : item)
    },
    verification: { outcomes: [...(record.verification?.outcomes || []), outcome].slice(-100) },
    evidenceRefs: [...new Set([...record.evidenceRefs, ...evidenceRefs])]
  }
}

function safeError (error) {
  return {
    schemaVersion: 1,
    code: error.code || 'AGENT_INTERNAL_ERROR',
    category: error.category || 'internal_error',
    source: error.source || 'gateway',
    retryable: error.retryable === true,
    safeMessage: error.safeMessage || 'Agent 运行时发生错误。',
    safeDetails: error.safeDetails && Object.keys(error.safeDetails).length ? error.safeDetails : undefined,
    occurredAt: new Date().toISOString()
  }
}

function bundleInvocation (intent) {
  return {
    invocationId: intent.invocationId,
    intentDigest: intent.intentDigest,
    toolName: intent.toolName,
    toolVersion: intent.toolVersion,
    mutability: 'none',
    phase: 'finished',
    target: intent.target,
    purpose: intent.purpose,
    expectedObservation: intent.expectedObservation,
    normalizedArguments: intent.normalizedArguments
  }
}

function bundleFailureObservation (item) {
  const error = safeError({
    code: item.error?.code || 'AGENT_BUNDLE_ACTION_FAILED',
    category: item.notStarted ? 'cancelled' : 'internal_error',
    source: 'gateway',
    retryable: !item.notStarted,
    safeMessage: item.error?.safeMessage || '并行只读探查未能返回结果。'
  })
  return ObservationSchema.parse({
    schemaVersion: 1,
    observationId: id('observation'),
    invocationId: item.intent.invocationId,
    status: item.notStarted ? 'cancelled' : 'error',
    exitCode: null,
    summary: error.safeMessage,
    facts: [],
    factCandidates: [],
    errors: [error],
    sample: [],
    truncated: false,
    omittedBytes: 0,
    untrustedContent: true,
    evidenceRefs: [],
    adaptationHints: []
  })
}

function agentError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  return error
}

function looksSensitiveInput (value) {
  return /(?:password|passwd|口令|密码|api[_ -]?key|access[_ -]?token|secret|私钥|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/i.test(String(value || ''))
}

function containsSensitiveMaterial (value) {
  return /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+|(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,})/i.test(String(value || ''))
}

function chunkText (value, maxLength) {
  const chunks = []
  let remaining = String(value || '')
  while (remaining) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }
    let boundary = remaining.lastIndexOf(' ', maxLength)
    if (boundary < Math.floor(maxLength / 2)) boundary = maxLength
    chunks.push(remaining.slice(0, boundary))
    remaining = remaining.slice(boundary)
  }
  return chunks
}

function createProviderDraft () {
  return {
    responseId: id('response'),
    redactor: new StreamingSecretRedactor(),
    pending: '',
    text: '',
    sequence: 0,
    lastPublishedAt: 0
  }
}

function normalizeProviderPhase (phase) {
  return ['connecting', 'authenticating', 'preparing', 'thinking', 'responding'].includes(phase)
    ? phase
    : 'responding'
}

function nonnegativeInteger (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function providerEventError (value = {}) {
  const error = new Error(value.safeMessage || 'AI Provider 返回了安全错误。')
  error.code = value.code || 'AGENT_PROVIDER_ERROR'
  error.category = value.category || 'transport_error'
  error.retryable = value.retryable === true
  error.safeMessage = value.safeMessage || 'AI Provider 返回了安全错误。'
  error.source = 'harness'
  return error
}

function providerCloseReason (status) {
  if (status === 'complete' || status === 'inconclusive' || status === 'blocked') return 'completed'
  if (status === 'cancelled') return 'cancelled'
  return 'failed'
}

module.exports = { AgentSessionManager, TaskMailbox, id, sameBinding, statusReason, safeError, looksSensitiveInput, containsSensitiveMaterial, mutationVerificationResult, buildVerificationFollowUp, recordWithPendingVerification, sanitizeDecision, chunkText, createProviderDraft, normalizeProviderPhase, nonnegativeInteger, providerEventError, providerCloseReason, completionOutcome, summarizeVerifiedFacts, summarizeDirectLookup, bundleInvocation, bundleFailureObservation }
