const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { SecretRedactor } = require('../../src/app/agent/observation/secret-redactor')
const { boundedCapture } = require('../../src/app/agent/observation/stream-capture')
const { EvidenceStore } = require('../../src/app/agent/evidence/evidence-store')
const { ObservationPipeline } = require('../../src/app/agent/observation/observation-pipeline')
const { cleanTerminalText } = require('../../src/app/agent/observation/ansi-cleaner')
const { classifyExecutionError } = require('../../src/app/agent/observation/error-classifier')
const { adaptationHintsFor } = require('../../src/app/agent/observation/observation-pipeline')
const { buildPrompt } = require('../../src/app/agent/harness/prompt-builder')
const { AuditLog } = require('../../src/app/agent/audit/audit-log')
const { safeAIRequestError } = require('../../src/app/lib/ai-error')
const { OptionalSummarizer } = require('../../src/app/agent/observation/optional-summarizer')

test('Secret redactor removes authorization, key-value and private key material', () => {
  const input = 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=hello\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
  const result = new SecretRedactor().redact(input)
  assert.equal(result.failed, false)
  assert.equal(result.text.includes('abcdefghijklmnopqrstuvwxyz'), false)
  assert.equal(result.text.includes('password=hello'), false)
  assert.equal(result.text.includes('BEGIN PRIVATE KEY'), false)
  assert.ok(result.summary.count >= 3)
})

test('legacy AI request errors never return or log credentials and stacks', () => {
  const secret = 'sk-this-must-never-appear'
  const result = safeAIRequestError(Object.assign(new Error(`request failed Authorization: Bearer ${secret}`), {
    code: 'ERR_BAD_REQUEST',
    stack: `stack contains ${secret}`,
    config: { headers: { Authorization: `Bearer ${secret}` } },
    response: { status: 400, data: { error: { message: `api_key=${secret} is invalid` } } }
  }))
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.match(result.clientMessage, /<redacted>/)
  assert.equal('stack' in result, false)
})

test('Stream capture keeps bounded head and tail and detects binary', () => {
  const result = boundedCapture('A'.repeat(1000) + 'TAIL', { maxBytes: 100, headBytes: 30, tailBytes: 40 })
  assert.equal(result.truncated, true)
  assert.equal(result.text.startsWith('A'.repeat(30)), true)
  assert.equal(result.text.endsWith('TAIL'), true)
  assert.equal(boundedCapture(Buffer.from([0, 1, 2, 3])).binary, true)
  assert.equal(cleanTerminalText('\u001b[31merror\u001b[0m\u0007'), 'error')
})

test('missing distro facilities produce bounded adaptation without auto-install guidance', () => {
  const missing = classifyExecutionError({ status: 'error', transportError: undefined }, 'sh: systemctl: command not found')
  assert.equal(missing[0].category, 'command_not_found')
  assert.equal(adaptationHintsFor(missing, 0)[0].code, 'use_registered_alternative')
  const unsupported = classifyExecutionError({ status: 'error', transportError: undefined }, 'ps: unrecognized option: --sort')
  assert.equal(unsupported[0].category, 'unsupported_option')
  const prompt = buildPrompt({ objective: 'inspect', mode: 'diagnose', sessionSummary: {}, workingMemory: {}, budgetRemaining: {}, availableTools: [] })
  assert.match(prompt, /without installing software/)
})

test('internal capability failures are not misreported as terminal transport errors', () => {
  const errors = classifyExecutionError({
    status: 'error',
    transportError: {
      code: 'AGENT_CAPABILITY_POLICY_MISMATCH',
      category: 'internal_error',
      retryable: false,
      safeMessage: '内部执行授权校验失败，命令未发送到服务器。'
    }
  })
  assert.equal(errors[0].code, 'AGENT_CAPABILITY_POLICY_MISMATCH')
  assert.equal(errors[0].category, 'internal_error')
  assert.equal(errors[0].retryable, false)
  assert.doesNotMatch(errors[0].safeMessage, /终端连接|执行通道/)
})

test('Observation stores only redacted gzip evidence and supports paging/deletion', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-agent-evidence-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const evidenceStore = new EvidenceStore(root)
  const pipeline = new ObservationPipeline({ evidenceStore })
  const session = {
    taskId: 'task_observation_123',
    currentInvocation: { toolName: 'shell.exec' },
    memory: { verificationObligations: [] }
  }
  const result = {
    invocationId: 'invocation_observation_123',
    status: 'success',
    exitCode: 0,
    transportError: undefined
  }
  const observation = await pipeline.process(session, result, { stdout: 'ok token=supersecretvalue', stderr: '' })
  assert.equal(observation.untrustedContent, true)
  assert.equal(observation.evidenceRefs.length, 1)
  const page = evidenceStore.read(session.taskId, observation.evidenceRefs[0], 0, 64 * 1024)
  assert.equal(page.content.includes('supersecretvalue'), false)
  assert.match(page.content, /<redacted:/)
  assert.equal(evidenceStore.delete(session.taskId, observation.evidenceRefs[0]).deleted.length, 1)
  assert.throws(() => evidenceStore.read(session.taskId, observation.evidenceRefs[0], 0, 100), /不可用|已删除/)
})

test('large observations use only citation-valid optional summaries and propagate cancellation context', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-agent-summary-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const evidenceStore = new EvidenceStore(root)
  const controller = new AbortController()
  let request
  let receivedSignal
  const pipeline = new ObservationPipeline({
    evidenceStore,
    summarizer: new OptionalSummarizer(async (value, signal) => {
      request = value
      receivedSignal = signal
      return {
        summary: '服务输出已压缩并确认。',
        factIds: [value.data.facts[0].id],
        evidenceRanges: []
      }
    })
  })
  const session = {
    taskId: 'task_large_summary_12345',
    harness: { adapter: 'openai_compatible', modelProfiles: { summarizer: { modelId: 'summary-model' } } },
    currentInvocation: { toolName: 'shell.review_exec' },
    memory: { verificationObligations: [] }
  }
  const observation = await pipeline.process(session, {
    invocationId: 'invocation_large_summary_12345',
    status: 'success',
    exitCode: 0
  }, { stdout: `ActiveState=active\n${'detail=value\n'.repeat(4000)}`, stderr: '' }, controller.signal)
  assert.equal(observation.summary, '服务输出已压缩并确认。')
  assert.deepEqual(request.tools, [])
  assert.equal(request.modelProfile.modelId, 'summary-model')
  assert.equal(receivedSignal, controller.signal)
})

test('Evidence quota and TTL fail closed and remove expired gzip content', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-agent-evidence-limits-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const expiredStore = new EvidenceStore(root, { retentionHours: -1, quotaBytes: 1024 * 1024 })
  const written = expiredStore.write({
    taskId: 'task_expired_12345',
    invocationId: 'invocation_expired_12345',
    kind: 'command_output',
    redactedContent: 'already redacted'
  })
  assert.deepEqual(expiredStore.cleanup(), [written.evidenceRef])
  assert.throws(() => expiredStore.read('task_expired_12345', written.evidenceRef, 0, 100), /不可用|已删除/)

  const quotaStore = new EvidenceStore(root, { quotaBytes: 64, retentionHours: 1 })
  assert.throws(() => quotaStore.write({
    taskId: 'task_quota_12345',
    invocationId: 'invocation_quota_12345',
    kind: 'command_output',
    redactedContent: cryptoRandomText(4096)
  }), error => error.code === 'AGENT_EVIDENCE_QUOTA')
})

test('audit NDJSON stores hashes and redacted metadata, never supplied secret values', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-agent-audit-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const audit = new AuditLog(root)
  audit.append('execution.finished', {
    taskId: 'task_audit_12345',
    intentDigest: 'a'.repeat(64),
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
    command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" https://example.test',
    password: 'do-not-store'
  })
  const file = path.join(root, 'audit', `${new Date().toISOString().slice(0, 10)}.ndjson`)
  const content = fs.readFileSync(file, 'utf8')
  assert.equal(content.includes('abcdefghijklmnopqrstuvwxyz'), false)
  assert.equal(content.includes('do-not-store'), false)
  assert.match(content, /<redacted>/)
  assert.match(content, /"intentDigest":"a{64}"/)
})

function cryptoRandomText (length) {
  let value = ''
  for (let index = 0; index < length; index++) value += String.fromCharCode(33 + ((index * 67) % 90))
  return value
}
