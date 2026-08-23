const MILESTONES = Object.freeze([
  'accepted',
  'submitAck',
  'firstStatus',
  'firstLifecycle',
  'firstModelResponse',
  'providerTtft',
  'firstExecutionResult',
  'executionFirstOutput',
  'finalSynthesis',
  'total'
])

class TaskLatencyRecorder {
  constructor (options = {}) {
    this.now = options.now || Date.now
    this.maxRecords = Math.max(10, Math.min(Number(options.maxRecords) || 500, 5000))
    this.active = new Map()
    this.records = []
  }

  start (taskId, acceptedAt = this.now(), metadata = {}) {
    const startedAt = numericTime(acceptedAt, this.now())
    this.active.set(taskId, {
      taskId,
      startedAt,
      adapter: safeAdapter(metadata.adapter),
      milestones: { accepted: 0 },
      modelTurns: 0,
      repeatedInitializations: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolInvocations: 0,
      evidenceCount: 0,
      citedEvidenceCount: 0,
      verificationCount: 0
    })
  }

  mark (taskId, milestone, occurredAt = this.now()) {
    if (!MILESTONES.includes(milestone)) return
    const active = this.active.get(taskId)
    if (!active || active.milestones[milestone] !== undefined) return
    active.milestones[milestone] = Math.max(0, numericTime(occurredAt, this.now()) - active.startedAt)
  }

  incrementModelTurns (taskId) {
    const active = this.active.get(taskId)
    if (active) active.modelTurns++
  }

  incrementRepeatedInitializations (taskId) {
    const active = this.active.get(taskId)
    if (active) active.repeatedInitializations++
  }

  incrementToolInvocations (taskId, count = 1) {
    const active = this.active.get(taskId)
    if (active) active.toolInvocations += nonnegativeInteger(count)
  }

  addUsage (taskId, inputTokens = 0, outputTokens = 0) {
    const active = this.active.get(taskId)
    if (!active) return
    active.inputTokens += nonnegativeInteger(inputTokens)
    active.outputTokens += nonnegativeInteger(outputTokens)
  }

  setEvidenceCounts (taskId, evidenceCount = 0, citedEvidenceCount = 0) {
    const active = this.active.get(taskId)
    if (!active) return
    active.evidenceCount = Math.max(active.evidenceCount, nonnegativeInteger(evidenceCount))
    active.citedEvidenceCount = Math.max(active.citedEvidenceCount, nonnegativeInteger(citedEvidenceCount))
  }

  setVerificationCount (taskId, count = 0) {
    const active = this.active.get(taskId)
    if (active) active.verificationCount = Math.max(active.verificationCount, nonnegativeInteger(count))
  }

  finish (taskId, status, occurredAt = this.now()) {
    const active = this.active.get(taskId)
    if (!active) return undefined
    this.mark(taskId, 'total', occurredAt)
    const record = Object.freeze({
      schemaVersion: 1,
      taskId,
      adapter: active.adapter,
      status: safeStatus(status),
      modelTurns: active.modelTurns,
      repeatedInitializations: active.repeatedInitializations,
      inputTokens: active.inputTokens,
      outputTokens: active.outputTokens,
      toolInvocations: active.toolInvocations,
      evidenceCount: active.evidenceCount,
      citedEvidenceCount: active.citedEvidenceCount,
      verificationCount: active.verificationCount,
      durationsMs: Object.fromEntries(MILESTONES.filter(name => active.milestones[name] !== undefined).map(name => [name, active.milestones[name]]))
    })
    this.active.delete(taskId)
    this.records.push(record)
    this.records = this.records.slice(-this.maxRecords)
    return record
  }

  snapshot () {
    return this.records.map(record => ({ ...record, durationsMs: { ...record.durationsMs } }))
  }

  report (gates = DEFAULT_LATENCY_GATES) {
    return evaluateLatencyGates(this.records, gates)
  }

  baselineReport () {
    return buildProviderBaseline(this.records)
  }
}

const DEFAULT_LATENCY_GATES = Object.freeze({
  submitAck: 100,
  firstLifecycle: 300,
  providerTtft: 5000,
  executionFirstOutput: 500,
  finalSynthesis: 20000,
  total: 300000
})

function evaluateLatencyGates (records, gates = DEFAULT_LATENCY_GATES) {
  const metrics = {}
  for (const [milestone, limitMs] of Object.entries(gates)) {
    const values = (records || []).map(record => record?.durationsMs?.[milestone]).filter(Number.isFinite).sort((a, b) => a - b)
    const p50 = percentile(values, 0.5)
    const p95 = percentile(values, 0.95)
    metrics[milestone] = {
      count: values.length,
      p50,
      p95,
      max: values.length ? values[values.length - 1] : undefined,
      limitMs,
      passed: values.length > 0 && p95 <= limitMs
    }
  }
  return {
    schemaVersion: 1,
    sampleSize: (records || []).length,
    passed: Object.values(metrics).every(item => item.passed),
    metrics
  }
}

function buildProviderBaseline (records = []) {
  const metrics = ['firstStatus', 'firstModelResponse', 'firstExecutionResult', 'total']
  const adapters = {}
  for (const adapter of ['openai_compatible', 'codex_subscription', 'strands']) {
    const selected = records.filter(record => record.adapter === adapter)
    adapters[adapter] = {
      sampleSize: selected.length,
      modelTurns: distribution(selected.map(record => record.modelTurns)),
      durationsMs: Object.fromEntries(metrics.map(metric => [metric, distribution(selected.map(record => record.durationsMs?.[metric]))]))
    }
  }
  return { schemaVersion: 1, adapters }
}

function distribution (rawValues) {
  const values = rawValues.filter(Number.isFinite).sort((a, b) => a - b)
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? values[values.length - 1] : undefined
  }
}

function percentile (sortedValues, ratio) {
  if (!sortedValues.length) return undefined
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1))
  return sortedValues[index]
}

function numericTime (value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeStatus (value) {
  return ['complete', 'inconclusive', 'blocked', 'failed', 'cancelled'].includes(value) ? value : 'failed'
}

function safeAdapter (value) {
  if (value === 'codex_app_server' || value === 'codex_subscription') return 'codex_subscription'
  if (value === 'strands') return 'strands'
  return 'openai_compatible'
}

function nonnegativeInteger (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

module.exports = { TaskLatencyRecorder, MILESTONES, DEFAULT_LATENCY_GATES, evaluateLatencyGates, buildProviderBaseline, distribution, percentile, numericTime, safeStatus, safeAdapter, nonnegativeInteger }
