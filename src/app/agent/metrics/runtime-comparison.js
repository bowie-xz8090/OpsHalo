const { distribution } = require('./task-latency-recorder')

const COUNT_METRICS = Object.freeze([
  'modelTurns',
  'repeatedInitializations',
  'inputTokens',
  'outputTokens',
  'toolInvocations',
  'evidenceCount',
  'verificationCount'
])

const LATENCY_METRICS = Object.freeze([
  'submitAck',
  'firstLifecycle',
  'providerTtft',
  'executionFirstOutput',
  'finalSynthesis',
  'total'
])

function buildRuntimeComparison (v1Records = [], v2Records = []) {
  const v1 = aggregateRuntimeRecords(v1Records)
  const v2 = aggregateRuntimeRecords(v2Records)
  return {
    schemaVersion: 1,
    v1,
    v2,
    delta: {
      completionRate: difference(v2.completionRate, v1.completionRate),
      evidenceCitationRate: difference(v2.evidenceCitationRate, v1.evidenceCitationRate),
      cancellationRate: difference(v2.cancellationRate, v1.cancellationRate),
      modelTurnsP50: difference(v2.counts.modelTurns.p50, v1.counts.modelTurns.p50),
      repeatedInitializationsP50: difference(v2.counts.repeatedInitializations.p50, v1.counts.repeatedInitializations.p50),
      inputTokensP50: difference(v2.counts.inputTokens.p50, v1.counts.inputTokens.p50),
      outputTokensP50: difference(v2.counts.outputTokens.p50, v1.counts.outputTokens.p50),
      totalLatencyP50Ms: difference(v2.latencyMs.total.p50, v1.latencyMs.total.p50),
      totalLatencyP95Ms: difference(v2.latencyMs.total.p95, v1.latencyMs.total.p95)
    }
  }
}

function aggregateRuntimeRecords (records = []) {
  const safeRecords = records.map(sanitizeRuntimeRecord)
  const completed = safeRecords.filter(record => record.status === 'complete').length
  const cancelled = safeRecords.filter(record => record.status === 'cancelled').length
  const evidenceEligible = safeRecords.filter(record => record.evidenceCount > 0)
  const cited = evidenceEligible.filter(record => record.citedEvidenceCount > 0).length
  return {
    sampleSize: safeRecords.length,
    completionRate: ratio(completed, safeRecords.length),
    evidenceCitationRate: ratio(cited, evidenceEligible.length),
    cancellationRate: ratio(cancelled, safeRecords.length),
    verificationCoverageRate: ratio(safeRecords.filter(record => record.verificationCount > 0).length, safeRecords.length),
    counts: Object.fromEntries(COUNT_METRICS.map(metric => [metric, distribution(safeRecords.map(record => record[metric]))])),
    latencyMs: Object.fromEntries(LATENCY_METRICS.map(metric => [metric, distribution(safeRecords.map(record => record.durationsMs[metric]))]))
  }
}

function evaluateRuntimeComparisonGates (report) {
  const v1 = report?.v1 || {}
  const v2 = report?.v2 || {}
  const checks = {
    hasComparableSamples: Number(v1.sampleSize) > 0 && Number(v2.sampleSize) > 0,
    completionNotRegressed: comparableRate(v2.completionRate, v1.completionRate),
    evidenceCitationNotRegressed: comparableRate(v2.evidenceCitationRate, v1.evidenceCitationRate),
    verificationCoverageNotRegressed: comparableRate(v2.verificationCoverageRate, v1.verificationCoverageRate)
  }
  return {
    schemaVersion: 1,
    passed: Object.values(checks).every(Boolean),
    affectedFlags: [],
    checks
  }
}

function sanitizeRuntimeRecord (record = {}) {
  return {
    status: ['complete', 'inconclusive', 'blocked', 'failed', 'cancelled'].includes(record.status) ? record.status : 'failed',
    ...Object.fromEntries(COUNT_METRICS.map(metric => [metric, nonnegativeInteger(record[metric])])),
    citedEvidenceCount: nonnegativeInteger(record.citedEvidenceCount),
    durationsMs: Object.fromEntries(LATENCY_METRICS.map(metric => [metric, nonnegativeNumber(record?.durationsMs?.[metric])]))
  }
}

function difference (next, previous) {
  return Number.isFinite(next) && Number.isFinite(previous) ? Number((next - previous).toFixed(6)) : undefined
}

function ratio (value, total) {
  return total > 0 ? Number((value / total).toFixed(6)) : undefined
}

function comparableRate (next, previous) {
  return Number.isFinite(next) && Number.isFinite(previous) && next >= previous
}

function nonnegativeInteger (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function nonnegativeNumber (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
}

module.exports = {
  COUNT_METRICS,
  LATENCY_METRICS,
  buildRuntimeComparison,
  aggregateRuntimeRecords,
  evaluateRuntimeComparisonGates,
  sanitizeRuntimeRecord,
  ratio,
  difference,
  comparableRate
}
