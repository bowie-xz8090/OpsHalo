const { BrowserWindow } = require('electron')
const { z } = require('zod')
const { AgentStartRequestSchema, AgentControlRequestSchema } = require('../schemas/session-schema')
const { IdSchema, VersionSchema } = require('../schemas/shared')
const { defaults } = require('../config')
const { ok, fail } = require('./ipc-errors')

const SnapshotRequestSchema = z.strictObject({
  schemaVersion: VersionSchema.optional(),
  taskId: IdSchema,
  afterSequence: z.number().int().nonnegative().optional()
})
const EvidenceRequestSchema = z.strictObject({
  schemaVersion: VersionSchema.optional(),
  taskId: IdSchema,
  evidenceRef: z.string().min(1).max(1000),
  offset: z.number().int().nonnegative().max(64 * 1024 * 1024),
  limit: z.number().int().positive().max(defaults.evidenceChunkMaxBytes)
})
const EvidenceDeleteRequestSchema = z.strictObject({
  schemaVersion: VersionSchema.optional(),
  taskId: IdSchema,
  evidenceRef: z.string().min(1).max(1000).optional()
})

class SlidingWindowRateLimiter {
  constructor () {
    this.calls = new Map()
  }

  check (key, limit, intervalMs) {
    const now = Date.now()
    const recent = (this.calls.get(key) || []).filter(time => now - time < intervalMs)
    if (recent.length >= limit) {
      const error = new Error('Rate limit exceeded')
      error.code = 'AGENT_RATE_LIMITED'
      error.safeMessage = '请求过于频繁，请稍后重试。'
      error.retryable = true
      throw error
    }
    recent.push(now)
    this.calls.set(key, recent)
  }
}

function registerAgentIpc ({ ipcMain, manager, evidenceStore }) {
  const limiter = new SlidingWindowRateLimiter()
  const handlers = []
  const register = (channel, schema, rate, handler) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, request) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win || win.isDestroyed()) {
          const error = new Error('Untrusted sender')
          error.code = 'AGENT_UNTRUSTED_SENDER'
          error.safeMessage = '无法确认请求窗口身份。'
          throw error
        }
        limiter.check(`${win.id}:${channel}`, rate.limit, rate.intervalMs)
        const serializedSize = Buffer.byteLength(JSON.stringify(request || {}), 'utf8')
        if (serializedSize > rate.maxBytes) {
          const error = new Error('Request too large')
          error.code = 'AGENT_REQUEST_TOO_LARGE'
          error.safeMessage = '请求内容超过大小限制。'
          throw error
        }
        return ok(await handler(schema.parse(request), win.id))
      } catch (error) {
        return fail(error)
      }
    })
    handlers.push(channel)
  }

  register('agent:start', AgentStartRequestSchema, { limit: 3, intervalMs: 10000, maxBytes: 24 * 1024 }, (request, owner) => manager.start(request, owner))
  register('agent:control', AgentControlRequestSchema, { limit: 10, intervalMs: 1000, maxBytes: 16 * 1024 }, (request, owner) => manager.control(request, owner))
  register('agent:get-snapshot', SnapshotRequestSchema, { limit: 10, intervalMs: 1000, maxBytes: 4 * 1024 }, (request, owner) => manager.getSnapshot(request.taskId, owner, request.afterSequence))
  register('agent:get-evidence', EvidenceRequestSchema, { limit: 4, intervalMs: 1000, maxBytes: 8 * 1024 }, (request, owner) => {
    manager.ownedRuntime(request.taskId, owner)
    return evidenceStore.read(request.taskId, request.evidenceRef, request.offset, request.limit)
  })
  register('agent:delete-evidence', EvidenceDeleteRequestSchema, { limit: 4, intervalMs: 1000, maxBytes: 8 * 1024 }, (request, owner) => {
    return manager.deleteEvidence(request.taskId, owner, request.evidenceRef)
  })

  return () => handlers.forEach(channel => ipcMain.removeHandler(channel))
}

module.exports = { registerAgentIpc, SlidingWindowRateLimiter }
