const delay = require('./wait')
const { expect } = require('./expect')

exports.basicTerminalTest = async (client, cmd) => {
  await client.click('.session-current .term-wrap')
  await delay(1010)
  await client.keyboard.type(cmd)
  await client.keyboard.press('Enter')
  await delay(1011)
  const terminalText = await client.evaluate(() => {
    const tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
    const terminal = tab && window.refs.get(`term-${tab.id}`)?.term
    if (!terminal) return ''
    return Array.from(
      { length: terminal.buffer.active.length },
      (_, index) => terminal.buffer.active.getLine(index)?.translateToString(true) || ''
    ).join('\n')
  })
  expect(terminalText).includes(cmd)
}

exports.getTerminalContent = async function (client) {
  await client.click('.session-current .term-wrap')
  await delay(300)
  await client.keyboard.press('Meta+A')
  await delay(300)
  await client.keyboard.press('Meta+C')
  await delay(300)
  const clipboardText = await client.readClipboard()
  await client.keyboard.press('Escape')
  await delay(300)
  return clipboardText
}
