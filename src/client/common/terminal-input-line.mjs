const promptEndings = ['$ ', '# ', '> ', '% ', '] ', ') ']

export function readTerminalLogicalLine (buffer) {
  if (!buffer) return ''
  const currentRow = buffer.baseY + buffer.cursorY
  let startRow = currentRow
  let endRow = currentRow

  while (startRow > 0 && buffer.getLine(startRow)?.isWrapped) startRow--
  while (buffer.getLine(endRow + 1)?.isWrapped) endRow++

  const parts = []
  for (let row = startRow; row <= endRow; row++) {
    const line = buffer.getLine(row)
    if (!line) continue
    parts.push(line.translateToString(row === endRow))
  }
  return parts.join('')
}

export function splitTerminalPrompt (lineText) {
  const value = String(lineText || '')
  let commandStart = 0
  for (const ending of promptEndings) {
    const index = value.lastIndexOf(ending)
    if (index !== -1 && index + ending.length > commandStart) {
      commandStart = index + ending.length
    }
  }
  return {
    prompt: commandStart ? value.slice(0, commandStart) : '',
    input: value.slice(commandStart)
  }
}

export function readTerminalInput (buffer) {
  return splitTerminalPrompt(readTerminalLogicalLine(buffer)).input
}

export function readTerminalPrompt (buffer) {
  return splitTerminalPrompt(readTerminalLogicalLine(buffer)).prompt
}
