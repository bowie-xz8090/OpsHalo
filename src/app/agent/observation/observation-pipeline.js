const crypto = require('crypto')
const { ObservationSchema } = require('../schemas/observation-schema')
const { defaults } = require('../config')
const { boundedCapture } = require('./stream-capture')
const { cleanTerminalText } = require('./ansi-cleaner')
const { SecretRedactor } = require('./secret-redactor')
const { sampleOutput } = require('./output-sampler')
const { classifyExecutionError } = require('./error-classifier')
const { parseStructuredFacts, parseGenericFacts, parseResultView } = require('./parsers')

class ObservationPipeline {
  constructor (options) {
    this.evidenceStore = options.evidenceStore
    this.audit = options.audit
    this.redactor = options.redactor || new SecretRedactor(options.customSensitivePatterns)
    this.summarizer = options.summarizer
  }

  async process (session, result, streams = {}, signal) {
    const streamEvidence = result._streamEvidence
    const sourceStreams = streamEvidence?.content || streams
    const stdoutCapture = boundedCapture(sourceStreams.stdout, { maxBytes: defaults.maxRawCaptureBytes })
    const stderrCapture = boundedCapture(sourceStreams.stderr, { maxBytes: defaults.maxRawCaptureBytes })
    const stdoutClean = cleanTerminalText(stdoutCapture.text)
    const stderrClean = cleanTerminalText(stderrCapture.text)
    const stdoutRedacted = this.redactor.redact(stdoutClean)
    const stderrRedacted = this.redactor.redact(stderrClean)
    const redactionFailed = stdoutRedacted.failed || stderrRedacted.failed
    const stdout = stdoutCapture.binary ? `[binary output: ${stdoutCapture.totalBytes} bytes, sha256=${stdoutCapture.sha256}]` : stdoutRedacted.text
    const stderr = stderrCapture.binary ? `[binary output: ${stderrCapture.totalBytes} bytes, sha256=${stderrCapture.sha256}]` : stderrRedacted.text
    const pipelineRedactionSummary = {
      count: stdoutRedacted.summary.count + stderrRedacted.summary.count,
      types: [...new Set([...stdoutRedacted.summary.types, ...stderrRedacted.summary.types])],
      failedClosedChunks: stdoutRedacted.summary.failedClosedChunks + stderrRedacted.summary.failedClosedChunks
    }
    const redactionSummary = streamEvidence?.redactionSummary || pipelineRedactionSummary
    const evidence = streamEvidence?.evidence || this.evidenceStore.write({
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
    const structuredFacts = parseStructuredFacts(toolName, stdout, evidence.evidenceRef)
    const facts = structuredFacts.length ? structuredFacts : parseGenericFacts(stdout, evidence.evidenceRef)
    const factCandidates = toFactCandidates(facts, evidence.evidenceRef, `${stdout}\n${stderr}`)
    const resultView = parseResultView(toolName, stdout)
    const summary = await this.buildSummary(result, sample, errors, stdout, stderr, factCandidates, evidence.evidenceRef, signal, session)
    const omittedBytes = stdoutCapture.omittedBytes + stderrCapture.omittedBytes +
      (result.stdoutCapture?.omittedBytes || 0) + (result.stderrCapture?.omittedBytes || 0) +
      (streamEvidence?.omittedBytes?.stdout || 0) + (streamEvidence?.omittedBytes?.stderr || 0)
    const adaptationHints = adaptationHintsFor(errors, omittedBytes)
    const observation = ObservationSchema.parse({
      schemaVersion: 1,
      observationId: `observation_${crypto.randomBytes(18).toString('base64url')}`,
      invocationId: result.invocationId,
      status: result.status,
      exitCode: result.exitCode,
      summary,
      facts,
      factCandidates,
      resultView,
      ...(['shell.exec', 'shell.review_exec'].includes(toolName)
        ? { terminalTranscript: boundedTerminalTranscript(stdout, stderr, result.exitCode) }
        : {}),
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

  async buildSummary (result, sample, errors, stdout, stderr, factCandidates = [], evidenceRef, signal, session) {
    if (this.summarizer && Buffer.byteLength(stdout + stderr, 'utf8') > 32 * 1024) {
      try {
        const draft = await this.summarizer.summarize({
          status: result.status,
          exitCode: result.exitCode,
          sample: sample.slice(0, 20),
          facts: factCandidates.slice(0, 50),
          evidenceRefs: evidenceRef ? [evidenceRef] : []
        }, signal, { session })
        const summary = validateObservationSummary(draft, factCandidates, evidenceRef)
        if (summary) return summary
      } catch (_) {}
    }
    if (errors.length) return `${errors[0].safeMessage} exitCode=${result.exitCode === null ? 'unknown' : result.exitCode}`.slice(0, 1200)
    const first = sample.find(item => item.priority === 'error') || sample[0]
    return `${result.status === 'success' ? '动作执行完成' : `动作状态：${result.status}`}${first ? `；关键输出：${first.text}` : ''}`.slice(0, 1200)
  }
}

function toFactCandidates (facts, evidenceRef, sourceText = '', observedAt = new Date().toISOString()) {
  const sourceBytes = Buffer.byteLength(String(sourceText || ''), 'utf8')
  return (facts || []).filter(item => item?.statement && item?.evidenceRef).slice(0, 100).map(item => {
    const range = item.evidenceRange || { start: 0, end: sourceBytes }
    const parserId = String(item.parserId || 'generic.unknown.v1').slice(0, 120)
    const statement = String(item.statement).trim().replace(/\s+/g, ' ').slice(0, 2000)
    return {
      id: `candidate_${crypto.createHash('sha256').update(`${statement}:${item.evidenceRef}:${range.start}:${range.end}`).digest('hex').slice(0, 20)}`,
      statement,
      kind: factKind(statement, item.confidence),
      confidence: item.confidence === 'inferred' ? 'heuristic' : parserId.startsWith('generic.') ? 'parsed' : 'exact',
      evidence: [{ evidenceId: item.evidenceRef || evidenceRef, start: range.start, end: range.end }],
      parserId,
      observedAt
    }
  })
}

function factKind (statement, confidence) {
  if (confidence === 'inferred' || /错误|失败|拒绝|超时|\berror\b|\bfailed\b/i.test(statement)) return 'error'
  if (/不存在|未发现|没有|\bnot found\b|\babsent\b/i.test(statement)) return 'absence'
  if (/用户|主机|会话|identity|username|hostname/i.test(statement)) return 'identity'
  if (/\b\d+(?:\.\d+)?\s*(?:%|ms|s|bytes?|kb|mb|gb)\b/i.test(statement)) return 'metric'
  return 'state'
}

function validateObservationSummary (value, candidates = [], evidenceRef) {
  let draft = value
  if (typeof draft === 'string') {
    try { draft = JSON.parse(draft) } catch (_) { return '' }
  }
  if (!draft || typeof draft !== 'object' || typeof draft.summary !== 'string') return ''
  const factIds = new Set(candidates.map(item => item.id))
  const referencedFacts = Array.isArray(draft.factIds) ? draft.factIds : []
  if (referencedFacts.some(id => !factIds.has(id))) return ''
  const ranges = Array.isArray(draft.evidenceRanges) ? draft.evidenceRanges : []
  if (ranges.some(range => range?.evidenceId !== evidenceRef || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start)) return ''
  if (!referencedFacts.length && !ranges.length) return ''
  return draft.summary.trim().slice(0, 1200)
}

function boundedTerminalTranscript (stdout, stderr, exitCode) {
  const maxBytes = 64 * 1024
  const stdoutBuffer = Buffer.from(String(stdout || ''), 'utf8')
  const boundedStdout = stdoutBuffer.subarray(0, maxBytes).toString('utf8')
  const remaining = Math.max(0, maxBytes - Buffer.byteLength(boundedStdout, 'utf8'))
  return {
    stdout: boundedStdout,
    stderr: Buffer.from(String(stderr || ''), 'utf8').subarray(0, remaining).toString('utf8'),
    exitCode: Number.isInteger(exitCode) ? exitCode : null
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

module.exports = { ObservationPipeline, adaptationHintsFor, trimObservation, toFactCandidates, validateObservationSummary }
