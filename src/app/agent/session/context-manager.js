const crypto = require('crypto')
const { buildPrompt } = require('../harness/prompt-builder')

const DEFAULT_CONTEXT_WINDOW = 32000
const SEGMENTS = Object.freeze({
  system: 0.25,
  objective: 0.10,
  memory: 0.25,
  observations: 0.25,
  reserve: 0.15
})

function estimateTokens (value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '')
  let ascii = 0
  let nonAscii = 0
  for (const character of text) {
    if (character.codePointAt(0) <= 0x7f) ascii++
    else nonAscii++
  }
  return Math.ceil((ascii / 4) + (nonAscii * 1.1))
}

function createWorkingMemory (objective, parent) {
  const inheritedFacts = parent?.memory?.facts || []
  const inheritedEvidence = new Set(parent?.evidenceRefs || [])
  return {
    objective,
    scope: [],
    completionCriteria: [],
    planSummary: '',
    reasonSummary: '',
    facts: inheritedFacts.filter(f => (f.evidenceRefs || []).some(ref => inheritedEvidence.has(ref))),
    hypotheses: [],
    missingInformation: [],
    recentObservationIds: [],
    changeRecords: [],
    verificationObligations: [],
    contradictions: []
  }
}

function reconcileObservation (memory, observation) {
  const now = new Date().toISOString()
  const facts = [...memory.facts]
  for (const extracted of observation.facts || []) {
    if (!extracted.evidenceRef) continue
    const normalized = extracted.statement.trim().replace(/\s+/g, ' ')
    const factId = `fact_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20)}`
    const existing = facts.find(item => item.factId === factId)
    if (existing) {
      if (!existing.evidenceRefs.includes(extracted.evidenceRef)) existing.evidenceRefs = [...existing.evidenceRefs, extracted.evidenceRef].slice(-50)
      if (!existing.sourceInvocationIds.includes(observation.invocationId)) existing.sourceInvocationIds = [...existing.sourceInvocationIds, observation.invocationId].slice(-50)
      existing.lastConfirmedAt = now
      existing.confidence = existing.evidenceRefs.length > 1 ? 'corroborated' : existing.confidence
      continue
    }
    facts.push({
      factId,
      statement: normalized,
      confidence: extracted.confidence,
      evidenceRefs: [extracted.evidenceRef],
      sourceInvocationIds: [observation.invocationId],
      firstObservedAt: now,
      lastConfirmedAt: now
    })
  }
  const boundedFacts = facts.slice(-500)
  return {
    ...memory,
    facts: boundedFacts,
    missingInformation: resolveMissingInformation(memory.missingInformation, boundedFacts),
    contradictions: detectContradictions(boundedFacts, memory.contradictions),
    recentObservationIds: [...memory.recentObservationIds, observation.observationId].slice(-4)
  }
}

function resolveMissingInformation (items = [], facts = []) {
  return items.filter(item => !facts.some(fact => statementSatisfiesGap(fact.statement, item)))
}

function statementSatisfiesGap (statement, gap) {
  const normalizedStatement = normalizeComparableText(statement)
  const normalizedGap = normalizeComparableText(gap)
  if (!normalizedGap || !normalizedStatement) return false
  if (normalizedStatement.includes(normalizedGap)) return true
  const gapTokens = comparableTokens(normalizedGap)
  if (!gapTokens.length) return false
  const statementTokens = new Set(comparableTokens(normalizedStatement))
  const matched = gapTokens.filter(token => statementTokens.has(token))
  return matched.length >= 2 && matched.length / gapTokens.length >= 0.6
}

function normalizeComparableText (value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim()
}

function comparableTokens (value) {
  const words = String(value || '').match(/[a-z0-9_.-]{3,}|[\u3400-\u9fff]{2,}/g) || []
  const result = []
  for (const word of words) {
    if (/[\u3400-\u9fff]/.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1; index++) result.push(word.slice(index, index + 2))
    } else {
      result.push(word)
    }
  }
  return [...new Set(result)]
}

function detectContradictions (facts, previous = []) {
  const values = new Map()
  const result = [...previous]
  for (const fact of facts) {
    const match = /^(.{1,160}?)(?:为|：|=)\s*(.{1,500}?)[。.]?$/.exec(fact.statement)
    if (!match) continue
    const key = match[1].trim().toLowerCase()
    const value = match[2].trim().toLowerCase()
    const existing = values.get(key)
    if (!existing) {
      values.set(key, { value, fact })
      continue
    }
    if (existing.value === value) continue
    const contradictionId = `contradiction_${crypto.createHash('sha256').update(`${key}:${existing.value}:${value}`).digest('hex').slice(0, 20)}`
    if (!result.some(item => item.contradictionId === contradictionId)) {
      result.push({
        contradictionId,
        key,
        statements: [existing.fact.statement, fact.statement],
        evidenceRefs: [...new Set([...existing.fact.evidenceRefs, ...fact.evidenceRefs])],
        impact: 'critical',
        status: 'open'
      })
    }
  }
  return result.slice(-100)
}

function contextUsage (segments, maxContextTokens = DEFAULT_CONTEXT_WINDOW) {
  const usage = Object.entries(segments).reduce((result, [name, value]) => {
    result[name] = estimateTokens(value)
    return result
  }, {})
  const total = Object.values(usage).reduce((sum, value) => sum + value, 0)
  return { usage, total, ratio: total / maxContextTokens }
}

function compactMemory (memory) {
  const factMap = new Map()
  for (const fact of memory.facts || []) {
    const key = fact.statement.trim().toLowerCase()
    const previous = factMap.get(key)
    if (!previous) {
      factMap.set(key, { ...fact })
      continue
    }
    previous.evidenceRefs = [...new Set([...previous.evidenceRefs, ...fact.evidenceRefs])]
    previous.sourceInvocationIds = [...new Set([...previous.sourceInvocationIds, ...fact.sourceInvocationIds])]
    if (previous.evidenceRefs.length > 1) previous.confidence = 'corroborated'
  }
  return {
    ...memory,
    facts: [...factMap.values()],
    hypotheses: (memory.hypotheses || []).filter(h => h.status === 'open'),
    recentObservationIds: (memory.recentObservationIds || []).slice(-2)
  }
}

function prepareContext (segments, maxContextTokens = DEFAULT_CONTEXT_WINDOW) {
  const current = { ...segments }
  let metrics = contextUsage(current, maxContextTokens)
  if (metrics.ratio >= 0.8 && current.memory) {
    current.memory = compactMemory(current.memory)
    if (Array.isArray(current.observations)) current.observations = current.observations.slice(-2)
    metrics = contextUsage(current, maxContextTokens)
  }
  return {
    segments: current,
    metrics,
    requiresReduce: metrics.ratio >= 0.9,
    exhausted: metrics.ratio >= 0.9
  }
}

function prepareTurnInput (input, maxContextTokens = DEFAULT_CONTEXT_WINDOW) {
  const outputReserveTokens = Math.min(8192, Math.max(2048, Math.ceil(maxContextTokens * 0.1)))
  const safetyTokens = Math.max(512, Math.ceil(maxContextTokens * 0.05))
  const maxInputTokens = Math.max(1024, maxContextTokens - outputReserveTokens - safetyTokens)
  let current = { ...input }
  let metrics = measureTurn(current, maxContextTokens, maxInputTokens, outputReserveTokens, safetyTokens)
  if (metrics.inputRatio >= 0.7) {
    current = {
      ...current,
      workingMemory: compactMemory(current.workingMemory),
      skills: (current.skills || []).slice(0, 1),
      knowledge: (current.knowledge || []).slice(0, 3),
      latestObservation: compactObservation(current.latestObservation, false)
    }
    metrics = measureTurn(current, maxContextTokens, maxInputTokens, outputReserveTokens, safetyTokens)
  }
  if (metrics.inputRatio >= 0.85) {
    current = {
      ...current,
      availableTools: (current.availableTools || []).slice(0, 4),
      skills: [],
      knowledge: [],
      workingMemory: minimalMemory(current.workingMemory),
      latestObservation: compactObservation(current.latestObservation, true)
    }
    metrics = measureTurn(current, maxContextTokens, maxInputTokens, outputReserveTokens, safetyTokens)
  }
  return {
    input: current,
    metrics,
    requiresReduce: metrics.inputRatio >= 0.85,
    exhausted: metrics.promptTokens > maxInputTokens
  }
}

function measureTurn (input, maxContextTokens, maxInputTokens, outputReserveTokens, safetyTokens) {
  const prompt = buildPrompt(input)
  const promptBytes = Buffer.byteLength(prompt, 'utf8')
  const promptTokens = estimateTokens(prompt)
  return {
    promptBytes,
    promptTokens,
    maxContextTokens,
    maxInputTokens,
    outputReserveTokens,
    safetyTokens,
    inputRatio: promptTokens / maxInputTokens,
    windowRatio: (promptTokens + outputReserveTokens + safetyTokens) / maxContextTokens
  }
}

function compactObservation (observation, minimal) {
  if (!observation) return observation
  return {
    ...observation,
    summary: String(observation.summary || '').slice(0, minimal ? 300 : 600),
    facts: (observation.facts || []).slice(0, minimal ? 8 : 20),
    errors: (observation.errors || []).slice(0, minimal ? 3 : 8),
    sample: minimal
      ? []
      : (observation.sample || []).filter(item => item.priority !== 'ordinary').slice(0, 3).map(item => ({ ...item, text: item.text.slice(0, 512) })),
    adaptationHints: (observation.adaptationHints || []).slice(0, minimal ? 3 : 8),
    truncated: observation.truncated || (observation.sample || []).length > 0
  }
}

function minimalMemory (memory = {}) {
  return {
    ...compactMemory(memory),
    scope: (memory.scope || []).slice(-10),
    completionCriteria: (memory.completionCriteria || []).slice(-20),
    facts: (memory.facts || []).slice(-20),
    hypotheses: (memory.hypotheses || []).filter(item => item.status === 'open').slice(-10),
    missingInformation: (memory.missingInformation || []).slice(-10),
    recentObservationIds: (memory.recentObservationIds || []).slice(-1),
    contradictions: (memory.contradictions || []).filter(item => item.status !== 'resolved').slice(-10)
  }
}

module.exports = {
  DEFAULT_CONTEXT_WINDOW,
  SEGMENTS,
  estimateTokens,
  createWorkingMemory,
  reconcileObservation,
  detectContradictions,
  contextUsage,
  compactMemory,
  prepareContext,
  prepareTurnInput,
  measureTurn,
  compactObservation,
  minimalMemory,
  resolveMissingInformation,
  statementSatisfiesGap
}
