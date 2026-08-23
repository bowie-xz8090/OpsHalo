const crypto = require('crypto')
const { ToolIntentSchema, NormalizedIntentSchema } = require('../schemas/tool-schema')
const { analyzeShell } = require('../policy/shell-analyzer')
const { stable } = require('../session/progress-detector')

function normalizePath (value) {
  if (typeof value !== 'string') return value
  const normalized = value.replace(/\/+/g, '/')
  const parts = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('Path escapes allowed root')
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return `${normalized.startsWith('/') ? '/' : ''}${parts.join('/')}` || '/'
}

function normalizeArguments (argumentsValue) {
  return Object.keys(argumentsValue).sort().reduce((result, key) => {
    const value = argumentsValue[key]
    if (key.toLowerCase().includes('path') && typeof value === 'string') result[key] = normalizePath(value)
    else if (Array.isArray(value)) result[key] = value.map(item => typeof item === 'object' && item ? normalizeArguments(item) : item)
    else if (value && typeof value === 'object') result[key] = normalizeArguments(value)
    else result[key] = value
    return result
  }, {})
}

function normalizeIntent (intent, definition, validatedArguments) {
  const parsed = ToolIntentSchema.parse(intent)
  const normalizedArguments = normalizeArguments(validatedArguments)
  const commandAnalysis = definition.name === 'shell.exec' || definition.parserId === 'shell' || definition.parserId === 'shell_review'
    ? analyzeShell(normalizedArguments.command)
    : undefined
  const digestValue = {
    toolName: parsed.toolName,
    toolVersion: parsed.toolVersion,
    arguments: normalizedArguments,
    target: parsed.target,
    requestedTimeoutMs: parsed.requestedTimeoutMs,
    purpose: parsed.purpose,
    expectedObservation: parsed.expectedObservation,
    verificationPlan: parsed.verificationPlan
  }
  const intentDigest = crypto.createHash('sha256').update(JSON.stringify(stable(digestValue))).digest('hex')
  const redactedDisplay = definition.name === 'shell.exec' || definition.parserId === 'shell_review'
    ? String(normalizedArguments.command)
    : JSON.stringify(normalizedArguments, null, 2)
  return NormalizedIntentSchema.parse({
    ...parsed,
    normalizedArguments,
    redactedDisplay,
    intentDigest,
    commandAnalysis
  })
}

function sessionFingerprint (binding) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({
    tabId: binding.tabId,
    connectionId: binding.connectionId,
    sessionPid: binding.sessionPid,
    host: binding.host,
    port: binding.port,
    hostKeyFingerprint: binding.hostKeyFingerprint || null,
    username: binding.username,
    cwd: binding.cwd
  }))).digest('hex')
}

module.exports = { normalizePath, normalizeArguments, normalizeIntent, sessionFingerprint }
