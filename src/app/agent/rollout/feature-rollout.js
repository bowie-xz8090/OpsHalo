const RUNTIME_V2_FLAGS = Object.freeze([
  'agentProviderStreamingV2',
  'agentExecutionOutputProgressV2',
  'agentPersistentProviderSessionV2',
  'agentGroundedFinalSynthesisV2',
  'agentReadProbeBundleV2',
  'agentModelProfilesV2',
  'agentSkillsV2',
  'agentKnowledgeBaseV2'
])

const ALWAYS_ON_SAFETY_CONTROLS = Object.freeze([
  'toolGateway',
  'policy',
  'approval',
  'redaction',
  'evidence',
  'verification',
  'capabilityProbe'
])

function normalizeRuntimeV2Flags (config = {}) {
  const requestedStage = boundedStage(config.agentRuntimeV2RolloutStage)
  let predecessorEnabled = true
  return Object.fromEntries(RUNTIME_V2_FLAGS.map((flag, index) => {
    const enabled = predecessorEnabled && index < requestedStage && config[flag] !== false
    predecessorEnabled = enabled
    return [flag, enabled]
  }))
}

function evaluateRuntimeV2Rollout (config = {}, reports = {}) {
  const requestedFlags = normalizeRuntimeV2Flags(config)
  const flags = { ...requestedFlags }
  const failures = collectGateFailures(reports)
  const disabledFlags = new Set()

  for (const failure of failures) {
    const affected = failure.affectedFlags.length ? failure.affectedFlags : RUNTIME_V2_FLAGS
    const firstIndex = Math.min(...affected.map(flag => RUNTIME_V2_FLAGS.indexOf(flag)).filter(index => index >= 0))
    if (!Number.isFinite(firstIndex)) continue
    for (const flag of RUNTIME_V2_FLAGS.slice(firstIndex)) {
      if (flags[flag]) disabledFlags.add(flag)
      flags[flag] = false
    }
  }

  return {
    schemaVersion: 1,
    passed: failures.length === 0,
    requestedFlags,
    flags,
    alwaysOnSafetyControls: [...ALWAYS_ON_SAFETY_CONTROLS],
    rollback: failures.length
      ? {
          verified: RUNTIME_V2_FLAGS.every((flag, index) => !disabledFlags.has(flag) || flags[flag] === false),
          disabledFlags: [...disabledFlags],
          reasons: failures.map(failure => failure.reason)
        }
      : undefined
  }
}

function collectGateFailures (reports = {}) {
  const failures = []
  for (const [name, report] of Object.entries(reports)) {
    if (!report || report.passed !== false) continue
    const declaredFlags = Array.isArray(report.affectedFlags)
      ? report.affectedFlags.filter(flag => RUNTIME_V2_FLAGS.includes(flag))
      : []
    failures.push({
      reason: safeReason(name, report.reason),
      affectedFlags: name === 'safety' && !declaredFlags.length ? [...RUNTIME_V2_FLAGS] : declaredFlags
    })
  }
  return failures
}

function safeReason (name, reason) {
  const gate = String(name || 'gate').replace(/[^a-z0-9_.-]/gi, '').slice(0, 80) || 'gate'
  const code = String(reason || 'failed').replace(/[^a-z0-9_.-]/gi, '').slice(0, 80) || 'failed'
  return `${gate}:${code}`
}

function boundedStage (value) {
  if (value === undefined || value === null || value === '') return RUNTIME_V2_FLAGS.length
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(0, Math.min(parsed, RUNTIME_V2_FLAGS.length)) : 0
}

module.exports = {
  RUNTIME_V2_FLAGS,
  ALWAYS_ON_SAFETY_CONTROLS,
  normalizeRuntimeV2Flags,
  evaluateRuntimeV2Rollout,
  collectGateFailures,
  boundedStage
}
