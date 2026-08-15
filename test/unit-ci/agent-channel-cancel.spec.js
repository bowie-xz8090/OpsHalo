const test = require('node:test')
const assert = require('node:assert/strict')
const { commonExtends } = require('../../src/app/server/session-common')

test('Agent cancellation signals and closes only the matching SSH exec channel', async () => {
  class FakeSession {}
  commonExtends(FakeSession)
  const session = new FakeSession()
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
