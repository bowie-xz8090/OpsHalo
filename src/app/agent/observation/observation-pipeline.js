const crypto = require('crypto')
const { ObservationSchema } = require('../schemas/observation-schema')
const { defaults } = require('../config')
const { boundedCapture } = require('./stream-capture')
const { cleanTerminalText } = require('./ansi-cleaner')
const { SecretRedactor } = require('./secret-redactor')
const { sampleOutput } = require('./output-sampler')
const { classifyExecutionError } = require('./error-classifier')
const { parseStructuredFacts, parseResultView } = require('./parsers')

class ObservationPipeline {
  constructor (options) {
    this.evidenceStore = options.evidenceStore
    this.audit = options.audit
    this.redactor = options.redactor || new SecretRedactor(options.customSensitivePatterns)
    this.summarizer = options.summarizer
  }

  async process (session, result, streams = {}) {
    const stdoutCapture = boundedCapture(streams.stdout, { maxBytes: defaults.maxRawCaptureBytes })
    const stderrCapture = boundedCapture(streams.stderr, { maxBytes: defaults.maxRawCaptureBytes })
    const stdoutClean = cleanTerminalText(stdoutCapture.text)
    const stderrClean = cleanTerminalText(stderrCapture.text)
    const stdoutRedacted = this.redactor.redact(stdoutClean)
    const stderrRedacted = this.redactor.redact(stderrClean)
    const redactionFailed = stdoutRedacted.failed || stderrRedacted.failed
    const stdout = stdoutCapture.binary ? `[binary output: ${stdoutCapture.totalBytes} bytes, sha256=${stdoutCapture.sha256}]` : stdoutRedacted.text
    const stderr = stderrCapture.binary ? `[binary output: ${stderrCapture.totalBytes} bytes, sha256=${stderrCapture.sha256}]` : stderrRedacted.text
    const redactionSummary = {
      count: stdoutRedacted.summary.count + stderrRedacted.summary.count,
      types: [...new Set([...stdoutRedacted.summary.types, ...stderrRedacted.summary.types])],
      failedClosedChunks: stdoutRedacted.summary.failedClosedChunks + stderrRedacted.summary.failedClosedChunks
    }
    const evidence = this.evidenceStore.write({
      taskId: session.taskId,
      invocationId: result.invocationId,
      kind: session.currentInvocation?.isVerification ? 'verification' : 'command_output',
      mediaType: 'application/json',
      redactedContent: { stdout, stderr, exitCode: result.exitCode, status: result.status },
      redactionSummary,
      critical: session.currentInvocation?.isVerification === true || session.memory.verificationObligations.some(item => item.invocationId === result.invocationId)
    })
    const errors = classifyExecutionError(result, stderr)
    this.audit?.append('evidence.available', {
      taskId: session.taskId,
      invocationId: result.invocationId,
      evidenceRef: evidence.evidenceRef,
      sha256: evidence.record.sha256,
      byteLength: evidence.record.byteLength,
      redactionSummary
    })
    if (redactionFailed) {
      errors.push({
        schemaVersion: 1,
        code: 'AGENT_REDACTION_FAILED',
        category: 'internal_error',
        source: 'observation',
        retryable: false,
        safeMessage: '部分输出因脱敏失败已封闭丢弃。',
        evidenceRef: evidence.evidenceRef,
        occurredAt: new Date().toISOString()
      })
    }
    const sample = sampleOutput(stdout, stderr, defaults.modelObservationBytes - 2600).map(item => ({ ...item, text: item.text.slice(0, 2048) }))
    const toolName = session.currentInvocation?.toolName || ''
    const facts = parseStructuredFacts(toolName, stdout, evidence.evidenceRef)
    const resultView = parseResultView(toolName, stdout)
    const summary = await this.buildSummary(result, sample, errors, stdout, stderr)
    const omittedBytes = stdoutCapture.omittedBytes + stderrCapture.omittedBytes +
      (result.stdoutCapture?.omittedBytes || 0) + (result.stderrCapture?.omittedBytes || 0)
    const adaptationHints = adaptationHintsFor(errors, omittedBytes)
    const observation = ObservationSchema.parse({
      schemaVersion: 1,
      observationId: `observation_${crypto.randomBytes(18).toString('base64url')}`,
      invocationId: result.invocationId,
      status: result.status,
      exitCode: result.exitCode,
      summary,
      facts,
      resultView,
      errors,
      sample,
      truncated: stdoutCapture.truncated || stderrCapture.truncated,
      omittedBytes,
      untrustedContent: true,
      evidenceRefs: [evidence.evidenceRef],
      adaptationHints
    })
    return trimObservation(observation)
  }

  async buildSummary (result, sample, errors, stdout, stderr) {
    if (this.summarizer && Buffer.byteLength(stdout + stderr, 'utf8') > 32 * 1024) {
      try {
        const summary = await this.summarizer.summarize({ status: result.status, exitCode: result.exitCode, sample })
        if (summary) return summary.slice(0, 1200)
      } catch (_) {}
    }
    if (errors.length) return `${errors[0].safeMessage} exitCode=${result.exitCode === null ? 'unknown' : result.exitCode}`.slice(0, 1200)
    const first = sample.find(item => item.priority === 'error') || sample[0]
    return `${result.status === 'success' ? '动作执行完成' : `动作状态：${result.status}`}${first ? `；关键输出：${first.text}` : ''}`.slice(0, 1200)
  }
}

function adaptationHintsFor (errors, omittedBytes) {
  const hints = []
  for (const error of errors) {
    if (error.category === 'command_not_found') hints.push({ code: 'use_registered_alternative', message: '选择已注册的结构化替代工具，禁止自动安装软件。' })
    if (error.category === 'permission_denied') hints.push({ code: 'inspect_current_permissions', suggestedTool: 'session.describe', message: '先确认当前用户权限；需要提权时转交用户。' })
    if (error.category === 'unsupported_option') hints.push({ code: 'probe_compatible_version', suggestedArgumentChanges: { narrow: true }, message: '使用有界版本探针或兼容参数。' })
    if (error.category === 'timeout') hints.push({ code: 'narrow_scope', suggestedArgumentChanges: { narrow: true }, message: '缩小对象、时间或采样范围。' })
    if (error.category === 'transport_error') hints.push({ code: 'pause_and_revalidate_session', message: '暂停并重新校验会话身份。' })
    if (error.category === 'interactive_required') hints.push({ code: 'terminal_handoff', message: '暂停自动循环并请求用户接管。' })
  }
  if (omittedBytes > 0) hints.push({ code: 'output_truncated', suggestedArgumentChanges: { narrow: true }, message: '输出已截断，应增加过滤条件而非重复宽泛查询。' })
  return hints.slice(0, 20)
}

function trimObservation (observation) {
  let current = observation
  while (Buffer.byteLength(JSON.stringify(current), 'utf8') > defaults.modelObservationHardMaxBytes && current.sample.length) {
    current = { ...current, sample: current.sample.slice(0, -1), truncated: true }
  }
  if (Buffer.byteLength(JSON.stringify(current), 'utf8') > defaults.modelObservationHardMaxBytes) {
    current = { ...current, summary: current.summary.slice(0, 500), facts: current.facts.slice(0, 10), adaptationHints: current.adaptationHints.slice(0, 5), truncated: true }
  }
  while (Buffer.byteLength(JSON.stringify(current), 'utf8') > defaults.modelObservationHardMaxBytes && current.resultView?.rows.length > 1) {
    current = {
      ...current,
      resultView: {
        ...current.resultView,
        rows: current.resultView.rows.slice(0, Math.max(1, Math.floor(current.resultView.rows.length / 2))),
        displayTruncated: true
      },
      truncated: true
    }
  }
  return ObservationSchema.parse(current)
}

module.exports = { ObservationPipeline, adaptationHintsFor, trimObservation }
