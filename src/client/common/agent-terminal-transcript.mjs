export function parseAgentEvidenceTranscript (content) {
  let value
  try {
    value = JSON.parse(String(content || ''))
  } catch (_) {
    return null
  }
  if (!value || typeof value !== 'object') return null
  return {
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : '',
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null
  }
}

export function formatAgentTerminalTranscript (transcript) {
  if (!transcript) return ''
  const chunks = [transcript.stdout, transcript.stderr].filter(Boolean)
  if (transcript.exitCode !== null && transcript.exitCode !== 0) chunks.push(`[exit ${transcript.exitCode}]`)
  return chunks.join(chunks.length > 1 ? '\n' : '').replace(/\r?\n/g, '\r\n')
}
