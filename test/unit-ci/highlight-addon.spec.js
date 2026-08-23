const test = require('node:test')
const assert = require('node:assert/strict')

const addonModule = import('../../src/client/components/terminal/highlight-addon.js')

test('keyword highlighter preserves xterm write callbacks', async () => {
  const { KeywordHighlighterAddon } = await addonModule
  const writes = []
  const terminal = {
    displayRaw: false,
    write (data, callback) {
      writes.push(data)
      callback?.()
    }
  }
  const addon = new KeywordHighlighterAddon([{ keyword: 'nginx', color: 'green' }])
  addon.activate(terminal)

  let callbackCount = 0
  terminal.write('nginx is running', () => { callbackCount++ })
  terminal.write(new Uint8Array([1, 2]), () => { callbackCount++ })
  terminal.write('\u001bPpassthrough', () => { callbackCount++ })
  terminal.write('x'.repeat(addon.maxHighlightLength + 1), () => { callbackCount++ })

  assert.equal(callbackCount, 4)
  assert.equal(writes[0], '\u001b[32mnginx\u001b[0m is running')
  assert.deepEqual(writes[1], new Uint8Array([1, 2]))
  assert.equal(writes[2], '\u001bPpassthrough')
  assert.equal(writes[3].length, addon.maxHighlightLength + 1)
})
