function toSafeIpcError (error) {
  return {
    code: error?.code || 'AGENT_INTERNAL_ERROR',
    safeMessage: error?.safeMessage || 'Agent 请求处理失败。',
    retryable: error?.retryable === true,
    latestSnapshot: error?.latestSnapshot
  }
}

function ok (data) {
  return { ok: true, data }
}

function fail (error) {
  return { ok: false, error: toSafeIpcError(error) }
}

module.exports = { toSafeIpcError, ok, fail }
