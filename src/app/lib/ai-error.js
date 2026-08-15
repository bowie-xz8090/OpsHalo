function safeAIRequestError (error) {
  const status = Number.isInteger(error?.response?.status) ? error.response.status : null
  const code = String(error?.code || 'AI_REQUEST_FAILED').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'AI_REQUEST_FAILED'
  const providerMessage = error?.response?.data?.error?.message || error?.message || 'AI request failed'
  const message = String(providerMessage)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret)\s*[:=]\s*[^\s,;&]+/gi, '$1=<redacted>')
    .replace(/([?&](?:code|key|token|secret|password)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '<redacted-private-key>')
    .slice(0, 500)
  return {
    clientMessage: message,
    logMessage: `AI request failed${status ? ` status=${status}` : ''} code=${code}: ${message}`
  }
}

module.exports = { safeAIRequestError }
