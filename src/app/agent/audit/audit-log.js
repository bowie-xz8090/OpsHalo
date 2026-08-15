const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ensurePrivateDirectory } = require('../session/session-store')
const { defaults } = require('../config')

function redactAuditValue (value) {
  if (typeof value === 'string') {
    return value
      .replace(/(bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/ig, '$1 <redacted>')
      .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/ig, '$1<redacted>')
      .slice(0, 2000)
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(redactAuditValue)
  if (value && typeof value === 'object') {
    return Object.keys(value).slice(0, 100).reduce((result, key) => {
      result[key] = /password|passwd|secret|token|api.?key|private.?key/i.test(key) ? '<redacted>' : redactAuditValue(value[key])
      return result
    }, {})
  }
  return value
}

class AuditLog {
  constructor (rootPath) {
    this.path = path.join(rootPath, 'audit')
    ensurePrivateDirectory(this.path)
  }

  append (type, payload) {
    const now = new Date()
    const record = {
      schemaVersion: 1,
      auditId: `audit_${crypto.randomBytes(16).toString('base64url')}`,
      type,
      occurredAt: now.toISOString(),
      payload: redactAuditValue(payload)
    }
    let line = JSON.stringify(record)
    if (Buffer.byteLength(line, 'utf8') > 16 * 1024) {
      record.payload = { truncated: true, sha256: crypto.createHash('sha256').update(line).digest('hex') }
      line = JSON.stringify(record)
    }
    const file = path.join(this.path, `${now.toISOString().slice(0, 10)}.ndjson`)
    fs.appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    return record
  }

  cleanup (now = Date.now()) {
    const files = fs.readdirSync(this.path).filter(name => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)).map(name => {
      const file = path.join(this.path, name)
      const stat = fs.statSync(file)
      return { file, mtime: stat.mtimeMs, size: stat.size }
    }).sort((a, b) => a.mtime - b.mtime)
    let total = files.reduce((sum, item) => sum + item.size, 0)
    const cutoff = now - defaults.auditRetentionDays * 24 * 60 * 60 * 1000
    for (const item of files) {
      if (item.mtime < cutoff || total > defaults.auditQuotaBytes) {
        try { fs.unlinkSync(item.file) } catch (_) {}
        total -= item.size
      }
    }
  }
}

module.exports = { AuditLog, redactAuditValue }
