const crypto = require('crypto')
const { AgentProviderSessionMetadataSchema } = require('../schemas/provider-schema')

class AgentProviderSession {
  constructor (harness, metadata, now = Date.now) {
    this.harness = harness
    this.metadata = AgentProviderSessionMetadataSchema.parse(metadata)
    this.now = now
  }

  getCapabilities () {
    return this.harness.getCapabilities()
  }

  async * runTurn (input, signal) {
    this.assertOpen()
    if (this.metadata.activeTurns > 0) {
      throw providerSessionError('PROVIDER_TURN_ALREADY_ACTIVE', '当前任务已有一个 AI 规划回合正在运行。')
    }
    this.metadata = AgentProviderSessionMetadataSchema.parse({
      ...this.metadata,
      activeTurns: 1,
      lastUsedAt: new Date(this.now()).toISOString()
    })
    try {
      for await (const event of this.harness.runTurn(input, signal)) yield event
    } finally {
      if (!this.metadata.closedAt) {
        this.metadata = AgentProviderSessionMetadataSchema.parse({
          ...this.metadata,
          activeTurns: 0,
          lastUsedAt: new Date(this.now()).toISOString()
        })
      }
    }
  }

  async close (reason) {
    if (this.metadata.closedAt) return
    this.metadata = AgentProviderSessionMetadataSchema.parse({
      ...this.metadata,
      activeTurns: 0,
      lastUsedAt: new Date(this.now()).toISOString(),
      closedAt: new Date(this.now()).toISOString(),
      closeReason: reason
    })
    const harness = this.harness
    this.harness = null
    await harness?.dispose?.()
  }

  assertOpen () {
    if (!this.harness || this.metadata.closedAt) {
      throw providerSessionError('PROVIDER_SESSION_CLOSED', '当前任务的 AI Provider 会话已经关闭。')
    }
  }
}

class ProviderSessionManager {
  constructor (harnessFactory, options = {}) {
    this.harnessFactory = harnessFactory
    this.idleTtlMs = Math.max(1000, Number(options.idleTtlMs) || 5 * 60 * 1000)
    this.now = options.now || Date.now
    this.sessions = new Map()
    this.rebuildCounts = new Map()
    if (options.autoSweep !== false) {
      this.sweepTimer = setInterval(() => this.expireIdle().catch(() => {}), Math.min(this.idleTtlMs, 60000))
      this.sweepTimer.unref?.()
    }
  }

  async acquire (record) {
    await this.expireIdle()
    const existing = this.sessions.get(record.taskId)
    if (existing) return existing
    return this.create(record, this.rebuildCounts.get(record.taskId) || 0)
  }

  async rebuild (record) {
    const count = this.rebuildCounts.get(record.taskId) || 0
    if (count >= 1) throw providerSessionError('PROVIDER_SESSION_REBUILD_EXHAUSTED', '当前任务的 AI Provider 会话已重建过一次，不能继续重试。')
    const existing = this.sessions.get(record.taskId)
    if (existing && providerType(record.harness.adapter) !== existing.metadata.providerType) {
      throw providerSessionError('PROVIDER_BACKEND_SWITCH_DENIED', '任务运行中不能切换到其他 AI 后端。')
    }
    if (existing) await this.close(record.taskId, 'failed')
    this.rebuildCounts.set(record.taskId, 1)
    return this.create(record, 1)
  }

  async create (record, rebuildCount) {
    const harness = await this.harnessFactory.create(record)
    const timestamp = new Date(this.now()).toISOString()
    const session = new AgentProviderSession(harness, {
      sessionId: randomId('provider_session'),
      taskId: record.taskId,
      providerType: providerType(record.harness.adapter),
      capabilitySnapshotId: capabilitySnapshotId(record.harness),
      createdAt: timestamp,
      lastUsedAt: timestamp,
      activeTurns: 0,
      rebuildCount
    }, this.now)
    this.sessions.set(record.taskId, session)
    return session
  }

  async close (taskId, reason) {
    const session = this.sessions.get(taskId)
    if (!session) return
    this.sessions.delete(taskId)
    await session.close(reason)
  }

  async expireIdle () {
    const expired = [...this.sessions.entries()]
      .filter(([, session]) => session.metadata.activeTurns === 0 && this.now() - Date.parse(session.metadata.lastUsedAt) >= this.idleTtlMs)
    await Promise.allSettled(expired.map(([taskId]) => this.close(taskId, 'expired')))
    return expired.map(([taskId]) => taskId)
  }

  async dispose () {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
    const taskIds = [...this.sessions.keys()]
    await Promise.allSettled(taskIds.map(taskId => this.close(taskId, 'shutdown')))
    this.rebuildCounts.clear()
  }
}

function providerType (adapter) {
  if (adapter === 'codex_app_server') return 'codex-subscription'
  if (adapter === 'strands') return 'strands'
  return 'openai-compatible'
}

function capabilitySnapshotId (selection) {
  const safeSelection = {
    adapter: selection.adapter,
    modelId: selection.modelId,
    providerId: selection.providerId,
    profileId: selection.profileId,
    supportsNativeTools: selection.supportsNativeTools,
    supportsStructuredOutput: selection.supportsStructuredOutput,
    maxContextTokens: selection.maxContextTokens,
    modelProfiles: selection.modelProfiles,
    capabilityReport: selection.capabilityReport
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(safeSelection)).digest('hex').slice(0, 32)
  return `capability_${digest}`
}

function randomId (prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`
}

function providerSessionError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.category = 'transport_error'
  error.source = 'harness'
  return error
}

module.exports = { AgentProviderSession, ProviderSessionManager, providerType, capabilitySnapshotId, providerSessionError }
