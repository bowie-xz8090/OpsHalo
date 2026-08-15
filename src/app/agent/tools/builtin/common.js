function objectSchema (properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const resultSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    data: {},
    warnings: { type: 'array', items: { type: 'string' } },
    meta: { type: 'object' }
  },
  required: ['ok', 'warnings', 'meta']
}

function definition (options) {
  return {
    schemaVersion: 1,
    version: '1',
    category: 'read',
    mutability: 'none',
    riskFloor: 'R1',
    sensitivityFloor: 'S1',
    costFloor: 'C1',
    approval: 'auto_if_bounded',
    defaultTimeoutMs: 10000,
    maxTimeoutMs: 20000,
    maxRawCaptureBytes: 2 * 1024 * 1024,
    maxModelOutputBytes: 6144,
    supportsCancel: true,
    supportsDryRun: false,
    parserId: 'generic',
    resultSchema,
    ...options
  }
}

function shellQuote (value) {
  return `'${String(value).replace(/'/g, '\'"\'"\'')}'`
}

function envelope (data, source, warnings = [], partial = false, durationMs = 0) {
  return { ok: true, data, warnings, meta: { durationMs, source, capturedAt: new Date().toISOString(), partial } }
}

async function runStructured (adapter, context, command, parser = parseLines) {
  const started = Date.now()
  const raw = await adapter.execute({ ...context, arguments: { command } })
  let data
  const warnings = []
  try { data = parser(raw.stdout || '') } catch (error) {
    data = { text: String(raw.stdout || '').slice(0, 256 * 1024) }
    warnings.push(`parse_failed:${error.message}`)
  }
  const structured = envelope(data, context.intent.toolName, warnings, raw.timedOut || raw.exitCode !== 0, Date.now() - started)
  return { ...raw, stdout: JSON.stringify(structured), stderr: raw.stderr || '', exitCode: raw.exitCode }
}

function parseLines (text) {
  return { lines: String(text).split(/\r?\n/).filter(Boolean).slice(0, 2000) }
}

function parseTabular (text, keys, separator = /\s+/) {
  return String(text).split(/\r?\n/).filter(Boolean).slice(0, 2000).map(line => {
    const parts = line.trim().split(separator)
    return keys.reduce((item, key, index) => {
      item[key] = index === keys.length - 1 ? parts.slice(index).join(' ') : parts[index]
      return item
    }, {})
  })
}

module.exports = { objectSchema, resultSchema, definition, shellQuote, envelope, runStructured, parseLines, parseTabular }
