const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const {
  parseQuickConnect,
  getDefaultPort,
  getSupportedProtocols
} = require('../../src/app/common/parse-quick-connect')

describe('Mini quick connect', () => {
  test('parses SSH URLs and shortcuts', () => {
    assert.deepEqual(
      {
        ...parseQuickConnect('ssh://root:secret@example.test:2222'),
        enableSsh: undefined,
        enableSftp: undefined,
        useSshAgent: undefined,
        authType: undefined,
        term: undefined,
        encode: undefined,
        envLang: undefined
      },
      {
        type: 'ssh',
        host: 'example.test',
        port: 2222,
        username: 'root',
        password: 'secret',
        enableSsh: undefined,
        enableSftp: undefined,
        useSshAgent: undefined,
        authType: undefined,
        term: undefined,
        encode: undefined,
        envLang: undefined
      }
    )
    assert.equal(parseQuickConnect('ops@example.test').host, 'example.test')
  })

  test('keeps electerm links as SSH-only compatibility links', () => {
    assert.equal(parseQuickConnect('electerm://example.test?type=ssh').type, 'ssh')
    assert.equal(parseQuickConnect('electerm://example.test?type=telnet'), null)
  })

  test('rejects removed protocols', () => {
    for (const protocol of ['telnet', 'serial', 'ftp', 'rdp', 'vnc', 'spice', 'http', 'https']) {
      assert.equal(parseQuickConnect(`${protocol}://example.test`), null)
    }
  })

  test('publishes only SSH-compatible protocols', () => {
    assert.deepEqual(getSupportedProtocols(), ['ssh', 'electerm'])
    assert.equal(getDefaultPort('ssh'), 22)
    assert.equal(getDefaultPort('telnet'), undefined)
  })
})
