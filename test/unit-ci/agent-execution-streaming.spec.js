const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { ExecutionRuntime } = require('../../src/app/agent/execution/execution-runtime')
const { EvidenceStore } = require('../../src/app/agent/evidence/evidence-store')
const { AgentSessionManager } = require('../../src/app/agent/session/session-manager')

function currentSession () {
  return {
    taskId: 'task_streaming_12345',
    sessionBinding: { sessionPid: 'session_streaming_12345' }
  }
}

function definition () {
  return {
    name: 'process.list',
    category: 'read',
    mutability: 'none',
    defaultTimeoutMs: 5000,
    maxTimeoutMs: 5000,
    maxRawCaptureBytes: 1024
  }
}

function intent () {
  return {
    taskId: 'task_streaming_12345',
    invocationId: 'invocation_streaming_12345',
    intentDigest: crypto.createHash('sha256').update('streaming').digest('hex'),
    normalizedArguments: {}
  }
}

test('execution streams sanitized evidence incrementally with bounded capture', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-stream-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const evidenceStore = new EvidenceStore(root, { quotaBytes: 1024 * 1024 })
  const progressEvents = []
  const runtime = new ExecutionRuntime({ evidenceStore, onProgress: (_session, _intent, value) => progressEvents.push(value) })
  const utf8 = Buffer.from('中文')
  const chunks = [
    { stream: 'stdout', data: utf8.subarray(0, 2) },
    { stream: 'stdout', data: utf8.subarray(2) },
    { stream: 'stdout', data: Buffer.from('\u001b]0;hidden-title') },
    { stream: 'stdout', data: Buffer.from('\u0007\u001b[31mvisible\u001b[0m\n') },
    { stream: 'stderr', data: Buffer.from('api_key=sk-proj-abcdefghijkl') },
    { stream: 'stderr', data: Buffer.from('mnopqrstuvwxyz0123456789\n') },
    { stream: 'stderr', data: Buffer.from([0xff, 0xfe, 0x0a]) },
    { stream: 'stdout', data: Buffer.from(`large=${'x'.repeat(2200)}`) }
  ]
  const result = await runtime.execute(currentSession(), definition(), intent(), async ({ progress }) => {
    chunks.forEach((item, index) => progress({
      invocationId: 'invocation_streaming_12345',
      sequence: index + 1,
      stream: item.stream,
      data: item.data.toString('base64'),
      byteLength: item.data.length
    }))
    progress({
      invocationId: 'invocation_streaming_12345',
      sequence: 99,
      stream: 'stdout',
      data: Buffer.from('out-of-order-secret').toString('base64'),
      byteLength: 19
    })
    return { stdout: 'bounded final stdout', stderr: '', exitCode: 0, status: 'success' }
  })

  assert.equal(result.status, 'success')
  assert.ok(result._streamEvidence?.evidence?.evidenceRef)
  const stored = evidenceStore.read(currentSession().taskId, result._streamEvidence.evidence.evidenceRef, 0, 64 * 1024)
  const payload = JSON.parse(stored.content)
  assert.match(payload.stdout, /中文/)
  assert.match(payload.stdout, /visible/)
  assert.doesNotMatch(payload.stdout, /hidden-title/)
  assert.equal(payload.stdout.includes('\u001b'), false)
  assert.doesNotMatch(payload.stderr, /abcdefghijklmnopqrstuvwxyz0123456789/)
  assert.match(payload.stderr, /redacted/)
  assert.equal(payload.omittedBytes.stdout > 0, true)
  assert.equal(progressEvents.some(item => item.invalidChunk), true)
  assert.equal(progressEvents.some(item => item.stdoutBytes > 0 && item.stderrBytes >= 0), true)
  const streamRoot = path.join(root, 'evidence', '.streams', currentSession().taskId)
  assert.deepEqual(fs.readdirSync(streamRoot), [])
})

test('stream evidence failure never masks the completed remote result', async () => {
  let aborted = false
  const evidenceStore = {
    createStreamingWriter: () => ({
      append: () => { throw new Error('disk unavailable') },
      finalize: () => { throw new Error('must not finalize') },
      abort: () => { aborted = true }
    })
  }
  const runtime = new ExecutionRuntime({ evidenceStore })
  const result = await runtime.execute(currentSession(), definition(), intent(), async ({ progress }) => {
    progress({ stream: 'stdout', data: Buffer.from('completed\n').toString('base64') })
    return { stdout: 'completed\n', stderr: '', exitCode: 0, status: 'success' }
  })
  assert.equal(result.status, 'success')
  assert.equal(result._streamEvidence, undefined)
  assert.equal(aborted, true)
})

test('execution cancellation and uncertain mutation transport state remain distinct', async () => {
  const controller = new AbortController()
  const runtime = new ExecutionRuntime()
  const pending = runtime.execute(currentSession(), definition(), intent(), async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    throw new Error('cancelled by signal')
  }, controller.signal)
  controller.abort(new Error('user cancelled'))
  const cancelled = await pending
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.cancelRequested, true)
  assert.equal(cancelled.remoteTermination, 'not_applicable')

  const mutationDefinition = { ...definition(), name: 'shell.exec', category: 'change', mutability: 'reversible' }
  const mutationIntent = { ...intent(), invocationId: 'invocation_unknown_12345', intentDigest: crypto.createHash('sha256').update('unknown').digest('hex') }
  const unknown = await runtime.execute(currentSession(), mutationDefinition, mutationIntent, async () => {
    throw new Error('SSH channel disconnected after command dispatch')
  })
  assert.equal(unknown.status, 'unknown')
  assert.equal(unknown.remoteTermination, 'unconfirmed')
  assert.equal(unknown.transportError.code, 'AGENT_REMOTE_STATE_UNKNOWN')
})

test('session progress publication applies bounded renderer backpressure', () => {
  const published = []
  const manager = Object.create(AgentSessionManager.prototype)
  manager.sessions = new Map()
  manager.latencyRecorder = { mark: () => {} }
  manager.enqueue = (_runtime, command) => published.push(command)
  manager.sessions.set('task_streaming_12345', {
    record: { taskId: 'task_streaming_12345', status: 'executing' },
    lastProgressEventAt: new Map()
  })
  for (let index = 0; index < 1000; index++) {
    manager.reportProgress(currentSession(), intent(), { source: 'output', bytesReceived: index + 1, message: `chunk ${index}` })
  }
  assert.equal(published.length, 1)
  assert.equal(published[0].type, 'EXECUTION_PROGRESS')
})
