const test = require('node:test')
const assert = require('node:assert/strict')
const { commonExtends } = require('../../src/app/server/session-common')
const { EventEmitter } = require('events')

test('Agent cancellation signals and closes only the matching SSH exec channel', async () => {
  class FakeSession {}
  commonExtends(FakeSession)
  const session = new FakeSession()
  session.initOptions = {}
  const calls = []
  const matching = {
    signal: value => calls.push(`matching:${value}`),
    close: () => calls.push('matching:close')
  }
  const unrelated = {
    signal: value => calls.push(`unrelated:${value}`),
    close: () => calls.push('unrelated:close')
  }
  session._agentExecStreams = new Map([
    ['invocation_matching_12345', matching],
    ['invocation_unrelated_12345', unrelated]
  ])
  const originalSetTimeout = global.setTimeout
  global.setTimeout = callback => {
    queueMicrotask(callback)
    return { unref: () => {} }
  }
  try {
    const result = session.cancelExecCommand('invocation_matching_12345')
    assert.deepEqual(result, { cancelRequested: true, remoteTermination: 'unconfirmed' })
    assert.deepEqual(calls, ['matching:INT'])
    await Promise.resolve()
    assert.deepEqual(calls, ['matching:INT', 'matching:TERM', 'matching:close'])
    assert.equal(session._agentExecStreams.has('invocation_matching_12345'), false)
    assert.equal(session._agentExecStreams.has('invocation_unrelated_12345'), true)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('structured SSH execution reports real stdout and stderr chunks', async () => {
  class FakeSession {
    getExecOpts () { return {} }
  }
  commonExtends(FakeSession)
  const session = new FakeSession()
  session.initOptions = {}
  const stream = new EventEmitter()
  stream.stderr = new EventEmitter()
  const chunks = []
  const client = {
    exec (_command, _options, callback) {
      callback(null, stream)
      queueMicrotask(() => {
        stream.emit('data', Buffer.from('ready\n'))
        stream.stderr.emit('data', Buffer.from('warning\n'))
        stream.emit('exit', 0)
        stream.emit('close')
      })
    }
  }
  const result = await session.execCommand('status', { invocationId: 'invocation_chunk_12345', onChunk: value => chunks.push(value) }, client)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(chunks.map(item => item.stream), ['stdout', 'stderr'])
  assert.equal(Buffer.from(chunks[0].data, 'base64').toString('utf8'), 'ready\n')
})
