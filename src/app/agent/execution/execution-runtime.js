const crypto = require('crypto')
const { StringDecoder } = require('string_decoder')
const { ExecutionResultSchema } = require('../schemas/tool-schema')
const { cleanTerminalText } = require('../observation/ansi-cleaner')
const { SecretRedactor, StreamingSecretRedactor } = require('../observation/secret-redactor')

class ExecutionRuntime {
  constructor (options = {}) {
    this.active = new Map()
    this.ledger = new Map()
    this.onProgress = options.onProgress || (() => {})
    this.redactor = options.redactor || new SecretRedactor()
    this.evidenceStore = options.evidenceStore
  }

  setProgressHandler (handler) {
    this.onProgress = handler || (() => {})
  }

  async execute (session, definition, intent, executor, signal, capability, authorizedTimeoutMs) {
    const previous = this.ledger.get(intent.invocationId)
    if (previous) {
      if (previous.intentDigest !== intent.intentDigest) throw executionError('AGENT_INVOCATION_MISMATCH', '调用标识与动作内容不一致。')
      if (previous.result) return previous.result
      if (previous.started) throw executionError('AGENT_INVOCATION_IN_PROGRESS', '该动作已经开始执行。')
    }
    const timeoutMs = Math.min(authorizedTimeoutMs || intent.requestedTimeoutMs || definition.defaultTimeoutMs, definition.maxTimeoutMs)
    const receiptId = `receipt_${crypto.randomBytes(18).toString('base64url')}`
    const ledger = { intentDigest: intent.intentDigest, started: true, mutability: definition.mutability, receiptId }
    this.ledger.set(intent.invocationId, ledger)
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason || new Error('cancelled'))
    if (signal) {
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('timeout'))
    }, timeoutMs)
    const startedAt = new Date()
    this.active.set(intent.invocationId, { controller, sessionId: session.sessionBinding.sessionPid, definition, intent })
    const evidenceWriter = this.evidenceStore?.createStreamingWriter({
      taskId: session.taskId,
      invocationId: intent.invocationId,
      kind: definition.mutability === 'none' ? 'command_output' : 'verification',
      maxBytes: definition.maxRawCaptureBytes,
      critical: definition.mutability !== 'none'
    })
    const streamProgress = createStreamProgress(this.redactor, {
      expectedInvocationId: intent.invocationId,
      onSafeChunk: (stream, text, summary) => evidenceWriter?.append(stream, text, summary)
    })
    const progressTimer = setInterval(() => {
      this.onProgress(session, intent, { source: 'timer', message: '命令仍在运行', elapsedMs: Date.now() - startedAt.getTime(), silentForMs: Date.now() - streamProgress.lastOutputAt })
    }, 1000)
    progressTimer.unref?.()
    let raw
    let caught
    let transferAttempts = 0
    try {
      while (transferAttempts < 2) {
        transferAttempts++
        try {
          raw = await executor({
            session,
            arguments: intent.normalizedArguments,
            intent,
            timeoutMs,
            signal: controller.signal,
            receiptId,
            capability,
            progress: value => {
              const safe = streamProgress.consume(value, Date.now() - startedAt.getTime())
              if (safe) this.onProgress(session, intent, safe)
            }
          })
          break
        } catch (error) {
          const mayRetryUnstartedRead = definition.mutability === 'none' && transferAttempts === 1 && error.beforeStarted === true && !controller.signal.aborted
          if (mayRetryUnstartedRead) continue
          caught = error
          break
        }
      }
    } finally {
      try { streamProgress.flush() } catch (_) {}
      clearTimeout(timer)
      clearInterval(progressTimer)
      if (signal) signal.removeEventListener('abort', abort)
      this.active.delete(intent.invocationId)
    }
    const finishedAt = new Date()
    const cancelled = controller.signal.aborted && !timedOut
    const status = timedOut ? 'timeout' : cancelled ? 'cancelled' : caught ? (/disconnect|transport|socket|channel/i.test(caught.message) && definition.mutability !== 'none' ? 'unknown' : 'error') : raw?.status || ((raw?.exitCode === 0 || raw?.exitCode === null || raw?.exitCode === undefined) ? 'success' : 'error')
    const result = ExecutionResultSchema.parse({
      schemaVersion: 1,
      invocationId: intent.invocationId,
      receiptId,
      status,
      mode: raw?.mode || modeFor(definition),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - startedAt,
      exitCode: Number.isInteger(raw?.exitCode) ? raw.exitCode : null,
      signal: raw?.signal || null,
      stdoutCapture: captureRef(raw?.stdout, raw?.stdoutTotalBytes, raw?.stdoutOmittedBytes),
      stderrCapture: captureRef(raw?.stderr, raw?.stderrTotalBytes, raw?.stderrOmittedBytes),
      stderrMerged: raw?.stderrMerged === true,
      timedOut,
      cancelRequested: cancelled || timedOut,
      remoteTermination: raw?.remoteTermination || (definition.mutability === 'none' ? 'not_applicable' : ['success', 'error', 'partial'].includes(status) ? 'confirmed' : 'unconfirmed'),
      transportError: caught ? safeTransportError(caught, status) : undefined
    })
    let streamEvidence
    if (evidenceWriter && streamProgress.hasOutput() && !streamProgress.evidenceFailed()) {
      try {
        streamEvidence = evidenceWriter.finalize({ exitCode: result.exitCode, status: result.status })
      } catch (_) {
        evidenceWriter.abort()
      }
    } else {
      evidenceWriter?.abort()
    }
    if (transferAttempts > 1) Object.defineProperty(result, '_transferAttempts', { value: transferAttempts, enumerable: false })
    Object.defineProperty(result, '_rawStreams', { value: { stdout: raw?.stdout || '', stderr: raw?.stderr || '' }, enumerable: false })
    if (streamEvidence) Object.defineProperty(result, '_streamEvidence', { value: streamEvidence, enumerable: false })
    ledger.result = result
    return result
  }

  async cancelTask (taskId) {
    for (const active of this.active.values()) {
      if (active.intent.taskId === taskId && !active.controller.signal.aborted) active.controller.abort(new Error('task_cancelled'))
    }
  }
}

function createStreamProgress (redactor, options = {}) {
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  const terminalCleaners = { stdout: new StreamingTerminalCleaner(), stderr: new StreamingTerminalCleaner() }
  const evidenceRedactors = {
    stdout: new StreamingSecretRedactor(redactor),
    stderr: new StreamingSecretRedactor(redactor)
  }
  const bytes = { stdout: 0, stderr: 0 }
  const tails = { stdout: '', stderr: '' }
  const privateKeyOpen = { stdout: false, stderr: false }
  const truncated = { stdout: false, stderr: false }
  let outputChunks = 0
  let lastSequence = 0
  let evidenceWriteFailed = false
  const emitSafeChunk = (stream, value) => {
    if ((!value.text && !value.failed) || evidenceWriteFailed) return
    try { options.onSafeChunk?.(stream, value.text, value.summary) } catch (_) { evidenceWriteFailed = true }
  }
  const writeSafeEvidence = (stream, decoded, final = false) => {
    const cleaned = terminalCleaners[stream].push(decoded, final)
    const redacted = evidenceRedactors[stream].push(cleaned)
    emitSafeChunk(stream, redacted)
    if (final) {
      const flushed = evidenceRedactors[stream].flush()
      emitSafeChunk(stream, flushed)
    }
  }
  return {
    lastOutputAt: Date.now(),
    consume (value, elapsedMs) {
      if (!value || !['stdout', 'stderr'].includes(value.stream) || typeof value.data !== 'string') {
        const message = redactor.redact(cleanTerminalText(String(value?.message || value || '执行中')))
        if (message.failed) return undefined
        return { source: value?.source || 'adapter', message: message.text.slice(0, 500), elapsedMs }
      }
      if ((options.expectedInvocationId && value.invocationId && value.invocationId !== options.expectedInvocationId) ||
        (Number.isInteger(value.sequence) && value.sequence !== lastSequence + 1) || !isStrictBase64(value.data)) {
        return { source: 'output', stream: value.stream, message: '收到无法验证的远端输出分片，已忽略', elapsedMs, invalidChunk: true }
      }
      let chunk
      try { chunk = Buffer.from(value.data, 'base64') } catch (_) { return undefined }
      if (Number.isInteger(value.byteLength) && value.byteLength !== chunk.length) {
        return { source: 'output', stream: value.stream, message: '收到长度不一致的远端输出分片，已忽略', elapsedMs, invalidChunk: true }
      }
      if (Number.isInteger(value.sequence)) lastSequence = value.sequence
      bytes[value.stream] += chunk.length
      outputChunks++
      this.lastOutputAt = Date.now()
      const decoded = decoders[value.stream].write(chunk)
      const cleanedChunk = terminalCleaners[value.stream].preview(decoded)
      writeSafeEvidence(value.stream, decoded)
      const visible = consumePrivateKeySafeText(tails[value.stream] + cleanedChunk, privateKeyOpen[value.stream])
      privateKeyOpen[value.stream] = visible.privateKeyOpen
      if (visible.blocked) {
        tails[value.stream] = visible.text.slice(-4096)
        return {
          source: 'output',
          stream: value.stream,
          message: '收到远端输出',
          stdoutBytes: bytes.stdout,
          stderrBytes: bytes.stderr,
          bytesReceived: bytes.stdout + bytes.stderr,
          elapsedMs,
          silentForMs: 0,
          truncated: truncated[value.stream]
        }
      }
      if (visible.text.length > 4096) truncated[value.stream] = true
      tails[value.stream] = visible.text.slice(-4096)
      const cleaned = cleanTerminalText(tails[value.stream])
      const redacted = redactor.redact(cleaned)
      if (redacted.failed) return undefined
      const safeText = redactPotentialSecretFragments(redacted.text)
      const lines = safeText.split(/\r?\n/).filter(Boolean)
      const safeLastLine = String(lines[lines.length - 1] || '').slice(-512)
      return {
        source: 'output',
        stream: value.stream,
        message: safeLastLine || '收到远端输出',
        safeLastLine,
        stdoutBytes: bytes.stdout,
        stderrBytes: bytes.stderr,
        bytesReceived: bytes.stdout + bytes.stderr,
        elapsedMs,
        silentForMs: 0,
        truncated: truncated[value.stream]
      }
    },
    flush () {
      for (const stream of ['stdout', 'stderr']) {
        writeSafeEvidence(stream, decoders[stream].end(), true)
      }
    },
    hasOutput () {
      return outputChunks > 0
    },
    evidenceFailed () {
      return evidenceWriteFailed
    }
  }
}

class StreamingTerminalCleaner {
  constructor () {
    this.state = 'text'
  }

  preview (value) {
    const clone = new StreamingTerminalCleaner()
    clone.state = this.state
    return clone.push(value)
  }

  push (value, final = false) {
    let output = ''
    for (const char of String(value || '')) {
      if (this.state === 'text') {
        if (char === '\u001b') this.state = 'escape'
        else if (char === '\n' || char === '\r' || char === '\t' || (char >= ' ' && char !== '\u007f')) output += char
      } else if (this.state === 'escape') {
        if (char === '[') this.state = 'csi'
        else if (char === ']') this.state = 'osc'
        else if (char === 'P') this.state = 'dcs'
        else this.state = 'text'
      } else if (this.state === 'csi') {
        if (char >= '@' && char <= '~') this.state = 'text'
      } else if (this.state === 'osc') {
        if (char === '\u0007') this.state = 'text'
        else if (char === '\u001b') this.state = 'osc_escape'
      } else if (this.state === 'osc_escape') {
        this.state = char === '\\' ? 'text' : char === '\u001b' ? 'osc_escape' : 'osc'
      } else if (this.state === 'dcs') {
        if (char === '\u001b') this.state = 'dcs_escape'
      } else if (this.state === 'dcs_escape') {
        this.state = char === '\\' ? 'text' : char === '\u001b' ? 'dcs_escape' : 'dcs'
      }
    }
    if (final) this.state = 'text'
    return output
  }
}

function isStrictBase64 (value) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  try { return Buffer.from(value, 'base64').toString('base64') === value } catch (_) { return false }
}

function consumePrivateKeySafeText (value, wasOpen) {
  let text = String(value || '')
  if (wasOpen) {
    const end = text.search(/-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/)
    if (end < 0) return { text: '', privateKeyOpen: true, blocked: true }
    const marker = text.slice(end).match(/^-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/)[0]
    text = text.slice(end + marker.length)
  }
  const begin = text.search(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/)
  if (begin >= 0 || /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE(?: KEY)?(?:-----)?\s*$/i.test(text)) {
    return { text: text.slice(0, Math.max(0, begin)), privateKeyOpen: true, blocked: true }
  }
  return { text, privateKeyOpen: false, blocked: false }
}

function redactPotentialSecretFragments (value) {
  return String(value || '').replace(/\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|AKIA|eyJ)[A-Za-z0-9_.-]*$/g, '<redacted:secret-fragment>')
}

function modeFor (definition) {
  if (definition.category === 'interactive') return 'pty_handoff'
  if (definition.name.startsWith('sftp.')) return 'sftp'
  if (definition.name.startsWith('mcp.')) return 'mcp'
  if (definition.name.startsWith('background.')) return 'background'
  return 'exec'
}

function captureRef (content, reportedTotalBytes, reportedOmittedBytes) {
  const buffer = Buffer.from(String(content || ''), 'utf8')
  const totalBytes = Number.isFinite(reportedTotalBytes) ? Math.max(buffer.length, Math.trunc(reportedTotalBytes)) : buffer.length
  const omittedBytes = Number.isFinite(reportedOmittedBytes) ? Math.max(0, Math.trunc(reportedOmittedBytes)) : Math.max(0, totalBytes - buffer.length)
  return {
    captureId: `capture_${crypto.randomBytes(12).toString('base64url')}`,
    totalBytes,
    capturedBytes: buffer.length,
    omittedBytes,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  }
}

function safeTransportError (error, status) {
  const code = typeof error.code === 'string' && error.code.startsWith('AGENT_')
    ? error.code
    : status === 'unknown' ? 'AGENT_REMOTE_STATE_UNKNOWN' : 'AGENT_EXECUTION_ERROR'
  const category = typeof error.category === 'string'
    ? error.category
    : code.startsWith('AGENT_CAPABILITY_') || code === 'AGENT_EXECUTION_FORBIDDEN'
      ? 'internal_error'
      : /permission denied/i.test(error.message)
        ? 'permission_denied'
        : /not found|command not found/i.test(error.message)
          ? 'command_not_found'
          : /timeout/i.test(error.message)
            ? 'timeout'
            : /interactive|tty|password/i.test(error.message)
              ? 'interactive_required'
              : 'transport_error'
  return {
    schemaVersion: 1,
    code,
    category,
    source: 'executor',
    retryable: typeof error.retryable === 'boolean'
      ? error.retryable
      : !code.startsWith('AGENT_CAPABILITY_') && status !== 'unknown',
    safeMessage: code.startsWith('AGENT_CAPABILITY_')
      ? '内部执行授权校验失败，命令未发送到服务器。'
      : String(error.safeMessage || error.message || '执行失败').slice(0, 2000),
    occurredAt: new Date().toISOString()
  }
}

function executionError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  return error
}

module.exports = { ExecutionRuntime, executionError, createStreamProgress, consumePrivateKeySafeText, redactPotentialSecretFragments, StreamingTerminalCleaner, isStrictBase64 }
