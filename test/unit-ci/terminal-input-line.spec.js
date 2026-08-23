const test = require('node:test')
const assert = require('node:assert/strict')

const inputLineModule = import('../../src/client/common/terminal-input-line.mjs')

function line (text, isWrapped = false) {
  return {
    isWrapped,
    translateToString: trimRight => trimRight ? text.trimEnd() : text
  }
}

test('Agent Enter reads the complete input when the cursor is in the middle', async () => {
  const { readTerminalInput, readTerminalPrompt } = await inputLineModule
  const text = '[root@example ~]# 创建文件 test.txt，写入 hello world'
  const buffer = {
    baseY: 0,
    cursorY: 0,
    cursorX: text.indexOf('world') + 2,
    getLine: row => row === 0 ? line(text) : undefined
  }
  assert.equal(readTerminalInput(buffer), '创建文件 test.txt，写入 hello world')
  assert.equal(readTerminalPrompt(buffer), '[root@example ~]# ')
})

test('Agent Enter joins terminal wrapped rows into one complete input', async () => {
  const { readTerminalInput } = await inputLineModule
  const rows = [
    line('[root@example ~]# 创建文件 test.txt，写入 hello '),
    line('world', true)
  ]
  const buffer = {
    baseY: 0,
    cursorY: 1,
    cursorX: 2,
    getLine: row => rows[row]
  }
  assert.equal(readTerminalInput(buffer), '创建文件 test.txt，写入 hello world')
})
