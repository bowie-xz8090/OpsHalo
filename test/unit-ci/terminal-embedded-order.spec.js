const test = require('node:test')
const assert = require('node:assert/strict')

global.window = global.window || { xtermAddons: {} }

const attachModule = import('../../src/client/components/terminal/attach-addon-custom.js')
const trackerModule = import('../../src/client/components/terminal/command-tracker-addon.js')

test('terminal output notification runs after xterm parses the flushed chunk', async () => {
  const { default: AttachAddonCustom } = await attachModule
  const events = []
  let parsedCallback
  const term = {
    parent: {
      notifyOnData: () => events.push('notify'),
      onTerminalWrite: data => events.push(`write:${data}`)
    },
    write (data, callback) {
      events.push(`queued:${data}`)
      parsedCallback = callback
    }
  }
  const addon = new AttachAddonCustom(term, {}, false)
  addon._writeBuffer = ['command output']
  addon._bufferBytes = 14

  addon._flushWrites()
  assert.deepEqual(events, ['queued:command output'])
  parsedCallback()
  assert.deepEqual(events, ['queued:command output', 'notify', 'write:command output'])
})

test('shell integration reports command completion with its exit code', async () => {
  const { CommandTrackerAddon } = await trackerModule
  let oscHandler
  const addon = new CommandTrackerAddon()
  const terminal = {
    parser: {
      registerOscHandler (code, handler) {
        assert.equal(code, 633)
        oscHandler = handler
        return { dispose () {} }
      }
    }
  }
  let completed
  addon.onCommandFinished((command, exitCode) => {
    completed = { command, exitCode }
  })
  addon.activate(terminal)

  oscHandler('E;nginx -T 2>&1')
  oscHandler('D;0')
  assert.deepEqual(completed, { command: 'nginx -T 2>&1', exitCode: 0 })
})
