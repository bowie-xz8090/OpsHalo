const { defaults } = require('../config')

function sampleOutput (stdout, stderr, limitBytes = defaults.modelObservationBytes) {
  const important = []
  const seen = new Map()
  const collect = (text, stream) => {
    const lines = String(text || '').split(/\r?\n/)
    lines.forEach((line, index) => {
      const clean = line.trim()
      if (!clean) return
      const count = (seen.get(clean) || 0) + 1
      seen.set(clean, count)
      if (count > 1) return
      const isError = /\b(?:error|fatal|failed|denied|refused|timeout|exception|traceback|not found)\b/i.test(clean)
      const boundary = index < 4 || index >= lines.length - 4
      important.push({ stream, text: clean, priority: isError ? 'error' : boundary ? 'boundary' : 'ordinary' })
    })
  }
  collect(stderr, 'stderr')
  collect(stdout, 'stdout')
  important.sort((a, b) => priority(a.priority) - priority(b.priority))
  const result = []
  let bytes = 0
  for (const item of important) {
    const suffix = seen.get(item.text) > 1 ? ` (repeated ${seen.get(item.text)} times)` : ''
    const next = { ...item, text: `${item.text}${suffix}`.slice(0, 2048) }
    const size = Buffer.byteLength(next.text, 'utf8')
    if (bytes + size > limitBytes) continue
    result.push(next)
    bytes += size
  }
  return result
}

function priority (value) {
  return { error: 0, verification: 1, boundary: 2, ordinary: 3 }[value] ?? 4
}

module.exports = { sampleOutput }
