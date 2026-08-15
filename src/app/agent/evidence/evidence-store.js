const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { EvidenceRecordSchema } = require('../schemas/observation-schema')
const { EvidenceManifest } = require('./evidence-manifest')
const { defaults } = require('../config')

class EvidenceStore {
  constructor (rootPath, options = {}) {
    this.rootPath = rootPath
    this.quotaBytes = options.quotaBytes || defaults.evidenceQuotaBytes
    this.retentionHours = options.retentionHours || defaults.evidenceRetentionHours
  }

  manifest (taskId) {
    return new EvidenceManifest(this.rootPath, taskId)
  }

  write ({ taskId, invocationId, kind, mediaType = 'text/plain', redactedContent, redactionSummary, critical = false }) {
    const evidenceId = `evidence_${crypto.randomBytes(18).toString('base64url')}`
    const createdAt = new Date()
    const payloadContent = typeof redactedContent === 'string' ? redactedContent : JSON.stringify(redactedContent, null, 2)
    const contentBuffer = Buffer.from(payloadContent, 'utf8')
    const body = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      metadata: { evidenceId, taskId, invocationId, kind, mediaType, critical },
      redactedContent: payloadContent
    }), 'utf8')
    const compressed = zlib.gzipSync(body, { level: zlib.constants.Z_BEST_SPEED })
    const relativePath = path.join('evidence', taskId, `${evidenceId}.json.gz`).replace(/\\/g, '/')
    const record = EvidenceRecordSchema.parse({
      schemaVersion: 1,
      evidenceId,
      taskId,
      invocationId,
      kind,
      mediaType,
      redactionSummary: redactionSummary || { count: 0, types: [], failedClosedChunks: 0 },
      sha256: crypto.createHash('sha256').update(contentBuffer).digest('hex'),
      byteLength: contentBuffer.length,
      compressedByteLength: compressed.length,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.retentionHours * 60 * 60 * 1000).toISOString(),
      relativePath
    })
    const manifestStore = this.manifest(taskId)
    const manifest = manifestStore.load()
    this.evict(manifest, compressed.length, critical)
    const absolutePath = path.join(this.rootPath, relativePath)
    fs.writeFileSync(absolutePath, compressed, { mode: 0o600 })
    manifest.records.push({ ...record, critical, lastAccessedAt: createdAt.toISOString() })
    manifestStore.save(manifest)
    return { record, evidenceRef: `evidence://${taskId}/${evidenceId}` }
  }

  parseRef (taskId, evidenceRef) {
    const match = /^evidence:\/\/([A-Za-z0-9_-]{8,160})\/([A-Za-z0-9_-]{8,160})$/.exec(evidenceRef)
    if (!match || match[1] !== taskId) throw evidenceError('AGENT_EVIDENCE_INVALID', '证据引用无效。')
    return match[2]
  }

  read (taskId, evidenceRef, offset = 0, limit = defaults.evidenceChunkMaxBytes) {
    const evidenceId = this.parseRef(taskId, evidenceRef)
    const store = this.manifest(taskId)
    const manifest = store.load()
    const record = manifest.records.find(item => item.evidenceId === evidenceId)
    if (!record) throw evidenceError('AGENT_EVIDENCE_NOT_FOUND', '证据已删除或过期。')
    const filePath = path.join(this.rootPath, record.relativePath)
    if (!fs.existsSync(filePath)) throw evidenceError('AGENT_EVIDENCE_NOT_FOUND', '证据内容不可用。')
    let parsed
    try { parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8')) } catch (_) { throw evidenceError('AGENT_EVIDENCE_CORRUPT', '证据文件损坏。') }
    const buffer = Buffer.from(parsed.redactedContent, 'utf8')
    const safeLimit = Math.min(limit, defaults.evidenceChunkMaxBytes)
    const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + safeLimit))
    record.lastAccessedAt = new Date().toISOString()
    store.save(manifest)
    return {
      schemaVersion: 1,
      evidenceRef,
      offset,
      nextOffset: offset + chunk.length < buffer.length ? offset + chunk.length : null,
      totalBytes: buffer.length,
      content: chunk.toString('utf8'),
      metadata: {
        kind: record.kind,
        mediaType: record.mediaType,
        sha256: record.sha256,
        redactionSummary: record.redactionSummary,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt
      }
    }
  }

  delete (taskId, evidenceRef) {
    const store = this.manifest(taskId)
    const manifest = store.load()
    const targetId = evidenceRef ? this.parseRef(taskId, evidenceRef) : null
    const removed = []
    manifest.records = manifest.records.filter(record => {
      if (targetId && record.evidenceId !== targetId) return true
      try { fs.unlinkSync(path.join(this.rootPath, record.relativePath)) } catch (_) {}
      removed.push(`evidence://${taskId}/${record.evidenceId}`)
      return false
    })
    store.save(manifest)
    return { deleted: removed }
  }

  evict (manifest, incomingBytes, incomingCritical) {
    let total = manifest.records.reduce((sum, item) => sum + item.compressedByteLength, 0)
    const candidates = [...manifest.records].sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? 1 : -1
      return Date.parse(a.lastAccessedAt || a.createdAt) - Date.parse(b.lastAccessedAt || b.createdAt)
    })
    while (total + incomingBytes > this.quotaBytes && candidates.length) {
      const item = candidates.shift()
      if (item.critical && incomingCritical && total === 0) break
      try { fs.unlinkSync(path.join(this.rootPath, item.relativePath)) } catch (_) {}
      manifest.records = manifest.records.filter(record => record.evidenceId !== item.evidenceId)
      total -= item.compressedByteLength
    }
    if (total + incomingBytes > this.quotaBytes) throw evidenceError('AGENT_EVIDENCE_QUOTA', '证据配额不足。')
  }

  cleanup (now = Date.now()) {
    const root = path.join(this.rootPath, 'evidence')
    if (!fs.existsSync(root)) return []
    const removed = []
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const store = this.manifest(entry.name)
      const manifest = store.load()
      manifest.records = manifest.records.filter(record => {
        if (Date.parse(record.expiresAt) > now) return true
        try { fs.unlinkSync(path.join(this.rootPath, record.relativePath)) } catch (_) {}
        removed.push(`evidence://${entry.name}/${record.evidenceId}`)
        return false
      })
      store.save(manifest)
    }
    return removed
  }
}

function evidenceError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  return error
}

module.exports = { EvidenceStore, evidenceError }
