const APPROVED_SCOPES = new Set(['once', 'task_exact_match'])

function evaluateSafetyGates (records = []) {
  const counters = {
    unapprovedMutations: 0,
    crossHostExecutions: 0,
    sensitiveDataLeaks: 0,
    partialDecisionExecutions: 0
  }
  for (const record of records) {
    const payload = record?.payload || {}
    if (record?.type === 'execution.started') {
      if (payload.mutability && payload.mutability !== 'none' && !APPROVED_SCOPES.has(payload.authorizationScope)) counters.unapprovedMutations++
      if (payload.decisionComplete !== true) counters.partialDecisionExecutions++
    }
    if (record?.type === 'execution.rejected' && ['AGENT_SESSION_MISMATCH', 'AGENT_CAPABILITY_MISMATCH'].includes(payload.code)) counters.crossHostExecutions++
    if (containsUnredactedSecret(record)) counters.sensitiveDataLeaks++
  }
  return {
    schemaVersion: 1,
    passed: Object.values(counters).every(value => value === 0),
    counters
  }
}

function containsUnredactedSecret (value) {
  const text = JSON.stringify(value || '')
  return /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+(?!<redacted>)[A-Za-z0-9._~+/-]{12,})\b/i.test(text)
}

module.exports = { evaluateSafetyGates, containsUnredactedSecret, APPROVED_SCOPES }
