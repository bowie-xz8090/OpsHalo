import { projectTimeline } from './agent-session-view.mjs'

const terminalStatuses = new Set(['complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'partial'])

export class AgentSessionProjection {
  constructor (api = window.api?.agent) {
    this.api = api
    this.sessions = new Map()
    this.activeByTab = new Map()
    this.listeners = new Map()
    this.waiters = new Map()
    this.unsubscribeApi = this.api?.onEvent?.(event => this.applyEvent(event))
  }

  async start (request) {
    const response = await this.api.start(request)
    const data = await this.api.getSnapshot({ schemaVersion: 1, taskId: response.taskId, afterSequence: 0 })
    this.replaceSnapshotWithTimeline(data.snapshot, data.deltaEvents || [], { activate: true })
    return response
  }

  subscribeTab (tabId, listener) {
    const listeners = this.listeners.get(tabId) || new Set()
    listeners.add(listener)
    this.listeners.set(tabId, listeners)
    const taskId = this.activeByTab.get(tabId)
    if (taskId && this.sessions.has(taskId) && !isIncompleteTerminalSession(this.sessions.get(taskId))) {
      listener(this.sessions.get(taskId))
    }
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(tabId)
    }
  }

  replaceSnapshot (snapshot, { activate = false } = {}) {
    const previous = this.sessions.get(snapshot.taskId)
    const latestTranscript = snapshot.latestObservation?.terminalTranscript
    const value = {
      ...snapshot,
      timeline: snapshot.timeline?.length ? snapshot.timeline : (previous?.timeline || []),
      _ui: previous?._ui || { expandedSteps: {}, selectedEvidence: null },
      _activity: snapshot.activity || previous?._activity,
      _terminalTranscript: latestTranscript
        ? { invocationId: snapshot.latestObservation.invocationId, ...latestTranscript }
        : previous?._terminalTranscript,
      _startedAt: previous?._startedAt || Date.now() - (snapshot.budget?.elapsedMs || 0),
      _projectedAt: Date.now()
    }
    this.sessions.set(value.taskId, value)
    const activeTaskId = this.activeByTab.get(value.binding.tabId)
    if (activate || !activeTaskId || activeTaskId === value.taskId) {
      this.activeByTab.set(value.binding.tabId, value.taskId)
    }
    if (!isIncompleteTerminalSession(value)) this.notify(value)
    return value
  }

  replaceSnapshotWithTimeline (snapshot, events, options) {
    const previous = this.sessions.get(snapshot.taskId)
    const timeline = (events || []).reduce((items, event) => projectTimeline(items, event), previous?.timeline || [])
    return this.replaceSnapshot({ ...snapshot, timeline }, options)
  }

  async applyEvent (event) {
    let session = this.sessions.get(event.taskId)
    if (!session) {
      const data = await this.api.getSnapshot({ schemaVersion: 1, taskId: event.taskId, afterSequence: 0 })
      session = this.replaceSnapshot(data.snapshot)
    }
    if (event.sequence <= session.lastEventSequence) return
    if (event.sequence > session.lastEventSequence + 1) {
      const data = await this.api.getSnapshot({ schemaVersion: 1, taskId: event.taskId, afterSequence: session.lastEventSequence })
      session = this.replaceSnapshotWithTimeline(data.snapshot, data.deltaEvents || [])
      return
    }
    session = this.project(session, event)
    this.sessions.set(session.taskId, session)
    if (!isIncompleteTerminalSession(session)) this.notify(session)
  }

  project (session, event) {
    let next = { ...session, lastEventSequence: event.sequence, snapshotVersion: event.snapshotVersion, _projectedAt: Date.now() }
    if (event.type === 'session.state_changed') {
      next.status = event.payload.to
      if (event.payload.reason?.safeMessage) next.statusReason = { code: event.payload.reason.code, message: event.payload.reason.safeMessage }
    }
    if (event.type === 'session.paused') next = { ...next, status: 'paused', statusReason: { code: event.payload.reason?.code, message: event.payload.reason?.safeMessage } }
    if (event.type === 'session.resumed') next.status = 'planning'
    if (event.type === 'harness.progress' || event.type === 'provider.phase') next._activity = event.payload
    if (event.type === 'provider.session_started') next.providerSession = event.payload
    if (event.type === 'usage.updated') next.usage = event.payload
    if (event.type === 'knowledge.retrieved') {
      const citations = [...(next.knowledgeCitations || []), ...(event.payload.citations || [])]
      next.knowledgeCitations = [...new Map(citations.map(item => [`${item.sourceId}:${item.chunkId}:${item.sourceVersion}`, item])).values()].slice(-100)
    }
    if (event.type === 'assistant.delta') {
      const current = next.assistantResponse?.responseId === event.payload.responseId ? next.assistantResponse : { responseId: event.payload.responseId, text: '', status: 'streaming' }
      next.assistantResponse = { ...current, text: `${current.text || ''}${event.payload.delta || ''}`, status: 'streaming' }
    }
    if (event.type === 'assistant.completed') {
      next.assistantResponse = { responseId: event.payload.responseId, text: event.payload.text || next.assistantResponse?.text || '', status: 'completed' }
    }
    if (event.type === 'observation.ready' && event.payload.terminalTranscript) {
      next._terminalTranscript = {
        invocationId: event.payload.invocationId,
        ...event.payload.terminalTranscript
      }
    }
    if (event.type === 'plan.updated') next.plan = event.payload
    if (event.type === 'budget.updated') next.budget = event.payload
    if (event.type === 'approval.requested') {
      next.pendingApproval = {
        ...event.payload.display,
        intentDigest: event.payload.intentDigest,
        allowedDecisions: event.payload.allowedDecisions
      }
    }
    if (event.type === 'approval.resolved') next.pendingApproval = undefined
    if (event.type === 'user_input.requested') next.pendingUserInput = event.payload
    if (event.type === 'user_input.resolved') next.pendingUserInput = undefined
    if (event.type === 'session.completed' || event.type === 'session.cancelled') {
      if (event.type === 'session.cancelled') next.status = 'cancelled'
      next.finalResult = event.payload.finalResult || event.payload
    }
    if (event.type === 'session.failed') {
      next.status = 'failed'
      next.finalResult = event.payload.finalResult || {
        status: 'failed',
        conclusion: event.payload.error?.safeMessage || 'Agent 运行失败。',
        confirmedFacts: [],
        inferences: [],
        operations: [],
        unresolvedItems: [],
        evidenceRefs: []
      }
    }
    next.timeline = projectTimeline(next.timeline || [], event)
    return next
  }

  async control (taskId, action, extra = {}) {
    const session = this.sessions.get(taskId)
    if (!session) throw new Error('Agent task not found')
    const result = await this.api.control({
      schemaVersion: 1,
      taskId,
      expectedSnapshotVersion: session.snapshotVersion,
      action,
      ...extra
    })
    if (result.pendingSafePause) {
      await this.waitForTaskStatus(taskId, status => status === 'paused' || terminalStatuses.has(status), 125000)
    }
    if (result.pendingSafeCancellation) {
      await this.waitForTaskStatus(taskId, status => terminalStatuses.has(status), 125000)
    }
    const data = await this.api.getSnapshot({ schemaVersion: 1, taskId, afterSequence: session.lastEventSequence })
    const snapshot = this.replaceSnapshotWithTimeline(data.snapshot, data.deltaEvents || [])
    return { ...result, snapshot }
  }

  getEvidence (request) {
    return this.api.getEvidence({ schemaVersion: 1, ...request })
  }

  deleteEvidence (request) {
    return this.api.deleteEvidence({ schemaVersion: 1, ...request })
  }

  notify (session) {
    const projected = {
      ...session,
      _tabActive: this.activeByTab.get(session.binding.tabId) === session.taskId
    }
    for (const listener of this.listeners.get(session.binding.tabId) || []) listener(projected)
    const waiters = this.waiters.get(session.taskId)
    if (!waiters) return
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(session.status)) continue
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(session)
    }
    if (!waiters.size) this.waiters.delete(session.taskId)
  }

  waitForTaskStatus (taskId, predicate, timeoutMs) {
    const current = this.sessions.get(taskId)
    if (current && predicate(current.status)) return Promise.resolve(current)
    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(taskId) || new Set()
      const waiter = { predicate, resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter)
        if (!waiters.size) this.waiters.delete(taskId)
        reject(new Error('Timed out while waiting for Agent to reach a safe pause point'))
      }, timeoutMs)
      waiters.add(waiter)
      this.waiters.set(taskId, waiters)
    })
  }

  dispose () {
    this.unsubscribeApi?.()
    this.listeners.clear()
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error('Agent session projection disposed'))
      }
    }
    this.waiters.clear()
  }
}

function isIncompleteTerminalSession (session) {
  return terminalStatuses.has(session?.status) && !session.finalResult
}

let projection

export default Store => {
  projection = projection || new AgentSessionProjection()
  Store.prototype.startAgentSession = request => projection.start(request)
  Store.prototype.subscribeAgentSession = (tabId, listener) => projection.subscribeTab(tabId, listener)
  Store.prototype.controlAgentSession = (taskId, action, extra) => projection.control(taskId, action, extra)
  Store.prototype.getAgentEvidence = request => projection.getEvidence(request)
  Store.prototype.deleteAgentEvidence = request => projection.deleteEvidence(request)
  Store.prototype.isAgentActive = tabId => {
    const taskId = projection.activeByTab.get(tabId)
    const status = taskId && projection.sessions.get(taskId)?.status
    return !!status && !terminalStatuses.has(status)
  }
}
