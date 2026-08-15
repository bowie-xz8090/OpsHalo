const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { AgentSessionRecordSchema } = require('../schemas/session-schema')
const { AgentEventSchema } = require('../schemas/event-schema')
const { isTerminalStatus } = require('./state-machine')
const { defaults } = require('../config')

function ensurePrivateDirectory (directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(directory, 0o700) } catch (_) {}
}

function atomicWriteJson (filePath, value) {
  atomicWriteText(filePath, JSON.stringify(value, null, 2))
}

function atomicWriteText (filePath, content) {
  ensurePrivateDirectory(path.dirname(filePath))
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  const fd = fs.openSync(temp, 'w', 0o600)
  try {
    fs.writeFileSync(fd, content, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temp, filePath)
  try {
    const dirFd = fs.openSync(path.dirname(filePath), 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
  } catch (_) {}
}

function fileSha256 (filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

class SessionStore {
  constructor (rootPath, options = {}) {
    this.rootPath = rootPath
    this.sessionsPath = path.join(rootPath, 'sessions')
    this.replayLimit = options.replayLimit || defaults.eventReplayLimit
    this.quotaBytes = options.quotaBytes || defaults.sessionQuotaBytes
    ensurePrivateDirectory(this.sessionsPath)
  }

  sessionPath (taskId) {
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(taskId)) throw new Error('Invalid task id')
    return path.join(this.sessionsPath, taskId)
  }

  saveSnapshot (record) {
    const parsed = AgentSessionRecordSchema.parse(record)
    const directory = this.sessionPath(parsed.taskId)
    ensurePrivateDirectory(directory)
    const snapshotPath = path.join(directory, 'snapshot.json')
    atomicWriteJson(snapshotPath, parsed)
    atomicWriteJson(path.join(directory, 'manifest.json'), {
      schemaVersion: 1,
      taskId: parsed.taskId,
      snapshotVersion: parsed.snapshotVersion,
      sha256: fileSha256(snapshotPath),
      updatedAt: parsed.updatedAt
    })
    this.enforceQuota(parsed.taskId)
    return parsed
  }

  appendEvent (event) {
    const parsed = AgentEventSchema.parse(event)
    const directory = this.sessionPath(parsed.taskId)
    ensurePrivateDirectory(directory)
    const filePath = path.join(directory, 'events.ndjson')
    const fd = fs.openSync(filePath, 'a', 0o600)
    try {
      fs.writeFileSync(fd, `${JSON.stringify(parsed)}\n`, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    this.enforceQuota(parsed.taskId)
    return parsed
  }

  enforceQuota (taskId) {
    const directory = this.sessionPath(taskId)
    if (directoryBytes(directory) <= this.quotaBytes) return
    const eventPath = path.join(directory, 'events.ndjson')
    if (fs.existsSync(eventPath)) {
      let lines = fs.readFileSync(eventPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-this.replayLimit)
      while (lines.length > 1 && directoryBytes(directory) > this.quotaBytes) {
        lines = lines.slice(Math.ceil(lines.length / 2))
        atomicWriteText(eventPath, `${lines.join('\n')}\n`)
      }
    }
    if (directoryBytes(directory) > this.quotaBytes) {
      const error = new Error('Agent session metadata quota exceeded')
      error.code = 'AGENT_SESSION_QUOTA'
      error.safeMessage = 'Agent 任务元数据超过本地配额，已停止继续记录。'
      throw error
    }
  }

  commit (record, events) {
    const parsed = this.saveSnapshot(record)
    for (const event of events) this.appendEvent(event)
    return parsed
  }

  load (taskId) {
    const directory = this.sessionPath(taskId)
    const snapshotPath = path.join(directory, 'snapshot.json')
    if (!fs.existsSync(snapshotPath)) return null
    const manifestPath = path.join(directory, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (manifest.sha256 !== fileSha256(snapshotPath)) {
        const error = new Error('Agent snapshot integrity check failed')
        error.code = 'AGENT_CORRUPT_SNAPSHOT'
        throw error
      }
    }
    return AgentSessionRecordSchema.parse(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')))
  }

  readEvents (taskId, afterSequence = 0) {
    const filePath = path.join(this.sessionPath(taskId), 'events.ndjson')
    if (!fs.existsSync(filePath)) return []
    const events = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => AgentEventSchema.parse(JSON.parse(line)))
    const delta = events.filter(event => event.sequence > afterSequence)
    return delta.length <= this.replayLimit ? delta : null
  }

  readRecentEvents (taskId, limit = this.replayLimit) {
    const filePath = path.join(this.sessionPath(taskId), 'events.ndjson')
    if (!fs.existsSync(filePath)) return []
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map(line => AgentEventSchema.parse(JSON.parse(line)))
  }

  list () {
    if (!fs.existsSync(this.sessionsPath)) return []
    return fs.readdirSync(this.sessionsPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        try { return this.load(entry.name) } catch (_) { return null }
      })
      .filter(Boolean)
  }

  recoverInterrupted () {
    const recovered = []
    for (const record of this.list()) {
      if (isTerminalStatus(record.status)) continue
      const now = new Date().toISOString()
      const memory = retainUncertainMutation(record)
      const paused = {
        ...record,
        memory,
        status: 'paused',
        statusReason: { code: 'app_restarted', safeMessage: '应用已重启，需要重新确认会话后继续。', recoverable: true },
        pendingApproval: undefined,
        updatedAt: now,
        snapshotVersion: record.snapshotVersion + 1
      }
      this.saveSnapshot(paused)
      recovered.push(paused)
    }
    return recovered
  }

  cleanup (now = Date.now()) {
    const cutoff = now - defaults.sessionRetentionDays * 24 * 60 * 60 * 1000
    for (const record of this.list()) {
      if (!isTerminalStatus(record.status) || Date.parse(record.updatedAt) >= cutoff) continue
      const directory = this.sessionPath(record.taskId)
      try { fs.rmSync(directory, { recursive: true, force: true }) } catch (_) {}
    }
  }
}

function retainUncertainMutation (record) {
  const invocation = record.currentInvocation
  const uncertainState = ['executing', 'observing', 'reducing', 'evaluating', 'verifying'].includes(record.status)
  if (!uncertainState || !invocation || invocation.mutability === 'none' || !invocation.verificationPlan) return record.memory
  const changeRecords = [...record.memory.changeRecords]
  if (!changeRecords.some(item => item.invocationId === invocation.invocationId)) {
    changeRecords.push({
      invocationId: invocation.invocationId,
      intentDigest: invocation.intentDigest,
      resource: invocation.target,
      expectedEffect: invocation.purpose || '恢复后确认变更的实际状态',
      actualStatus: invocation.actualResultStatus || 'unknown',
      approvalRequestId: invocation.approvalRequestId || 'approval_recovered_unknown',
      verificationPlanId: invocation.verificationPlan.planId,
      verificationStatus: 'pending',
      evidenceRefs: []
    })
  }
  const verificationObligations = [...record.memory.verificationObligations]
  if (!verificationObligations.some(item => item.invocationId === invocation.invocationId)) {
    verificationObligations.push({ invocationId: invocation.invocationId, verificationPlan: invocation.verificationPlan })
  }
  return { ...record.memory, changeRecords: changeRecords.slice(-100), verificationObligations: verificationObligations.slice(-100) }
}

function directoryBytes (directory) {
  if (!fs.existsSync(directory)) return 0
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const item = path.join(directory, entry.name)
    return total + (entry.isDirectory() ? directoryBytes(item) : fs.statSync(item).size)
  }, 0)
}

module.exports = { SessionStore, atomicWriteJson, atomicWriteText, ensurePrivateDirectory, directoryBytes, retainUncertainMutation }
