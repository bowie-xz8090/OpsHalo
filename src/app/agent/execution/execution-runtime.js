const crypto = require('crypto')
const { ExecutionResultSchema } = require('../schemas/tool-schema')

class ExecutionRuntime {
  constructor (options = {}) {
    this.active = new Map()
    this.ledger = new Map()
    this.onProgress = options.onProgress || (() => {})
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
    const progressTimer = setInterval(() => {
      this.onProgress(session, intent, { message: '命令仍在运行', elapsedMs: Date.now() - startedAt.getTime() })
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
            progress: value => this.onProgress(session, intent, value)
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
    if (transferAttempts > 1) Object.defineProperty(result, '_transferAttempts', { value: transferAttempts, enumerable: false })
    Object.defineProperty(result, '_rawStreams', { value: { stdout: raw?.stdout || '', stderr: raw?.stderr || '' }, enumerable: false })
    ledger.result = result
    return result
  }

  async cancelTask (taskId) {
    for (const active of this.active.values()) {
      if (active.intent.taskId === taskId && !active.controller.signal.aborted) active.controller.abort(new Error('task_cancelled'))
    }
  }
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

module.exports = { ExecutionRuntime, executionError }
