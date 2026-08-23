const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ensurePrivateDirectory } = require('../session/session-store')

class StreamingEvidenceWriter {
  constructor (evidenceStore, options) {
    this.evidenceStore = evidenceStore
    this.options = options
    this.maxBytes = Math.max(1024, Number(options.maxBytes) || 2 * 1024 * 1024)
    this.totalBytes = { stdout: 0, stderr: 0 }
    this.capturedBytes = { stdout: 0, stderr: 0 }
    this.redactionSummary = { count: 0, types: [], failedClosedChunks: 0 }
    this.closed = false
    const directory = path.join(evidenceStore.rootPath, 'evidence', '.streams', options.taskId)
    ensurePrivateDirectory(directory)
    const suffix = crypto.randomBytes(12).toString('base64url')
    this.paths = {
      stdout: path.join(directory, `${options.invocationId}-${suffix}.stdout.tmp`),
      stderr: path.join(directory, `${options.invocationId}-${suffix}.stderr.tmp`)
    }
    this.fds = {
      stdout: fs.openSync(this.paths.stdout, 'wx', 0o600),
      stderr: fs.openSync(this.paths.stderr, 'wx', 0o600)
    }
  }

  append (stream, text, redactionSummary) {
    if (this.closed || !['stdout', 'stderr'].includes(stream)) return
    const value = Buffer.from(String(text || ''), 'utf8')
    this.totalBytes[stream] += value.length
    const remaining = Math.max(0, this.maxBytes - this.capturedBytes[stream])
    const chunk = value.subarray(0, remaining)
    if (chunk.length) fs.writeSync(this.fds[stream], chunk)
    this.capturedBytes[stream] += chunk.length
    this.mergeRedactionSummary(redactionSummary)
  }

  mergeRedactionSummary (summary = {}) {
    this.redactionSummary.count += Number(summary.count) || 0
    this.redactionSummary.failedClosedChunks += Number(summary.failedClosedChunks) || 0
    this.redactionSummary.types = [...new Set([...this.redactionSummary.types, ...(summary.types || [])])]
  }

  finalize ({ exitCode, status }) {
    this.closeFiles()
    try {
      const stdout = fs.readFileSync(this.paths.stdout, 'utf8')
      const stderr = fs.readFileSync(this.paths.stderr, 'utf8')
      const omittedBytes = {
        stdout: Math.max(0, this.totalBytes.stdout - this.capturedBytes.stdout),
        stderr: Math.max(0, this.totalBytes.stderr - this.capturedBytes.stderr)
      }
      const evidence = this.evidenceStore.write({
        taskId: this.options.taskId,
        invocationId: this.options.invocationId,
        kind: this.options.kind || 'command_output',
        mediaType: 'application/json',
        redactedContent: { stdout, stderr, exitCode, status, streamed: true, omittedBytes },
        redactionSummary: this.redactionSummary,
        critical: this.options.critical === true
      })
      return { evidence, content: { stdout, stderr }, omittedBytes, redactionSummary: this.redactionSummary }
    } finally {
      this.removeFiles()
    }
  }

  abort () {
    this.closeFiles()
    this.removeFiles()
  }

  closeFiles () {
    if (this.closed) return
    this.closed = true
    for (const fd of Object.values(this.fds)) {
      try { fs.closeSync(fd) } catch (_) {}
    }
  }

  removeFiles () {
    for (const filePath of Object.values(this.paths)) {
      try { fs.unlinkSync(filePath) } catch (_) {}
    }
  }
}

module.exports = { StreamingEvidenceWriter }
