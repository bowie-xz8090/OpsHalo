const RECOVERABLE_API_FIELDS = [
  'nameAI',
  'baseURLAI',
  'modelAI',
  'roleAI',
  'apiKeyAI',
  'authHeaderNameAI',
  'apiPathAI',
  'languageAI',
  'proxyAI',
  'agentModeEnabled',
  'agentMutationEnabled',
  'agentExternalMcpEnabled'
]

function text (value) {
  return String(value || '').trim()
}

function looksLikeBlankAiDefaults (config = {}) {
  return !text(config.apiKeyAI) &&
    !text(config.codexProfileId) &&
    config.agentModeEnabled !== true
}

function isValidHistoryItem (item) {
  return item && typeof item === 'object' &&
    text(item.apiKeyAI) &&
    text(item.baseURLAI) &&
    text(item.modelAI)
}

export function recoverAiConfigFromHistory (config = {}, history = []) {
  if (!looksLikeBlankAiDefaults(config) || !Array.isArray(history)) {
    return { recovered: false, patch: {} }
  }
  const latest = history.find(isValidHistoryItem)
  if (!latest) return { recovered: false, patch: {} }
  const patch = {}
  for (const field of RECOVERABLE_API_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(latest, field) && latest[field] !== undefined) {
      patch[field] = latest[field]
    }
  }
  patch.aiBackendType = 'openai_compatible'
  return { recovered: true, patch, source: 'protected_ai_history' }
}

export { looksLikeBlankAiDefaults }
