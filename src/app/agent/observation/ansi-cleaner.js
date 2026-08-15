function cleanTerminalText (value) {
  /* eslint-disable no-control-regex */
  return String(value || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001bP[\s\S]*?\u001b\\/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[^\S\r\n]+\r/g, '\r')
  /* eslint-enable no-control-regex */
}

module.exports = { cleanTerminalText }
