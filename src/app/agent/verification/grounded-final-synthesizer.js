const { AIchatWithTools, AIchatWithToolsStream, createAIClient } = require('../../lib/ai')
const { SecretRedactor } = require('../observation/secret-redactor')
const { normalizeAiBackendSelection } = require('../config')
const { FinalResponseDraftSchema } = require('../schemas/verification-schema')
const { isDirectLookupObjective } = require('./direct-answer')

class GroundedFinalSynthesizer {
  constructor (getConfig, options = {}) {
    this.getConfig = typeof getConfig === 'function' ? getConfig : () => getConfig || {}
    this.redactor = options.redactor || new SecretRedactor()
    this.completion = options.completion
  }

  async synthesize (session, outcome, signal) {
    const config = this.getConfig()
    const backend = normalizeAiBackendSelection(config)
    const fallback = outcome.finalResult
    if (fallback.status === 'complete' && isDirectLookupObjective(session.prompt || session.memory?.objective)) return synthesisResult(fallback, false)
    if (config.agentGroundedSynthesisEnabled === false || backend.type !== 'openai_compatible') return synthesisResult(fallback, false)
    const facts = (fallback.confirmedFacts || []).slice(0, 30)
    if (!facts.length || outcome.decision?.maySynthesize === false || ['cancelled', 'blocked'].includes(fallback.status)) return synthesisResult(fallback, false)
    const allowed = new Set(facts.map(item => item.factId))
    const basePrompt = buildSynthesisPrompt(session, fallback, facts, outcome.decision)
    let previousFailure = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      let content
      try {
        content = await this.requestDraft(session, config, attempt
          ? `${basePrompt}\n\n<STRUCTURE_REPAIR>${previousFailure}</STRUCTURE_REPAIR>`
          : basePrompt, signal, attempt)
      } catch (_) {
        return synthesisResult(fallback, false)
      }
      const redacted = this.redactor.redact(content.trim())
      if (redacted.failed) return synthesisResult(fallback, false)
      try {
        const draft = FinalResponseDraftSchema.parse(parseJsonObject(redacted.text))
        const validation = validateFinalResponseDraft(draft, allowed, fallback.status)
        if (!validation.valid) throw new Error(validation.reason)
        const responseText = renderFinalResponseDraft(draft)
        return synthesisResult({ ...fallback, conclusion: responseText }, true, draft)
      } catch (error) {
        previousFailure = String(error.message || error).slice(0, 500)
      }
    }
    return synthesisResult(fallback, false)
  }

  async requestDraft (session, config, prompt, signal, attempt) {
    if (this.completion) return String(await this.completion(prompt, signal, attempt))
    const profile = session.harness?.modelProfiles?.summarizer
    const baseURL = profile?.baseURL || config.baseURLAI
    const model = profile?.modelId || config.agentSummarizerModel || config.agentPlannerModel || config.modelAI
    const streaming = profile?.streaming ?? config.agentStreamingEnabled !== false
    const options = {
      signal,
      timeoutMs: config.agentSynthesisTimeoutMs || profile?.turnTimeoutMs || 20000,
      maxOutputTokens: profile?.maxOutputTokens || config.agentMaxOutputTokens || 2048,
      temperature: profile?.temperature ?? config.agentTemperature,
      promptCacheKey: (profile?.promptCache ?? config.agentPromptCacheEnabled !== false) ? `opshalo-final-${session.taskId}` : undefined
    }
    const messages = [
      { role: 'system', content: 'Return exactly one JSON FinalResponseDraft. Use only supplied facts and fact ids. Do not output hidden reasoning.' },
      { role: 'user', content: prompt }
    ]
    const client = createAIClient(baseURL, config.apiKeyAI, config.proxyAI, config.authHeaderNameAI)
    if (!streaming) {
      const result = await AIchatWithTools(messages, model, baseURL, config.apiPathAI, config.apiKeyAI, config.proxyAI, [], config.authHeaderNameAI, { ...options, client })
      if (result.error) throw new Error(result.error)
      return String(result.message?.content || '')
    }
    let content = ''
    for await (const event of AIchatWithToolsStream(messages, model, baseURL, config.apiPathAI, config.apiKeyAI, config.proxyAI, [], config.authHeaderNameAI, { ...options, client })) {
      if (event.type === 'text_delta') content += event.delta
      if (event.type === 'message' && !content) content = String(event.message?.content || '')
    }
    return content
  }
}

function buildSynthesisPrompt (session, result, facts, decision) {
  return [
    '<USER_OBJECTIVE>',
    String(session.prompt || session.memory?.objective || '').slice(0, 4000),
    '</USER_OBJECTIVE>',
    '<DETERMINISTIC_STATUS>',
    JSON.stringify({ status: result.status, completionDecision: decision, unresolvedItems: result.unresolvedItems || [], operations: result.operations || [], verificationOutcomes: result.verificationOutcomes || [] }),
    '</DETERMINISTIC_STATUS>',
    '<ALLOWED_FACTS>',
    facts.map(item => `${item.factId}: ${item.statement}`).join('\n'),
    '</ALLOWED_FACTS>',
    '<KNOWLEDGE_CITATIONS>',
    JSON.stringify(result.knowledgeCitations || []),
    '</KNOWLEDGE_CITATIONS>',
    '<FINAL_RESPONSE_DRAFT_SCHEMA>',
    '{"headline":"string","answer":"string","evidenceLinks":[{"claim":"string","factIds":["fact_id"]}],"uncertainty":["string"],"nextActions":[{"label":"string","kind":"follow-up|manual|new-agent-task"}]}',
    '</FINAL_RESPONSE_DRAFT_SCHEMA>',
    'Respond in the user language. Answer USER_OBJECTIVE directly in the first sentence and include only facts needed for that answer. For a direct lookup such as where, path, version, user, port, or current value, return only the requested value with a short label; omit unrelated checks, uncertainty, and next actions when the deterministic status is complete. Do not change the deterministic status. Every factual claim about the current host must appear in evidenceLinks with supporting realtime factIds. Knowledge citations are documentation references only and must never be described as observed current state. Do not add commands unless framed as an optional next action.'
  ].join('\n')
}

function validateGroundedText (text, allowedFactIds) {
  if (!text || text.length > 5000) return false
  const references = [...text.matchAll(/\[(fact_[A-Za-z0-9_-]+)\]/g)].map(match => match[1])
  if (!references.length) return false
  return references.every(reference => allowedFactIds.has(reference))
}

function validateFinalResponseDraft (draft, allowedFactIds, deterministicStatus) {
  if (!draft.evidenceLinks.length) return { valid: false, reason: 'at least one evidence link is required' }
  for (const link of draft.evidenceLinks) {
    if (!link.factIds.every(factId => allowedFactIds.has(factId))) return { valid: false, reason: 'draft cites an unknown fact' }
  }
  if (deterministicStatus !== 'complete' && /(?:已完成|目标已达成|completed successfully|objective satisfied)/i.test(`${draft.headline}\n${draft.answer}`)) {
    return { valid: false, reason: 'draft overstates the deterministic status' }
  }
  return { valid: true }
}

function renderFinalResponseDraft (draft) {
  const parts = [draft.headline, draft.answer]
  if (draft.uncertainty.length) parts.push(draft.uncertainty.join('\n'))
  if (draft.nextActions.length) parts.push(draft.nextActions.map(item => item.label).join('\n'))
  return parts.filter(Boolean).join('\n\n').slice(0, 5000)
}

function parseJsonObject (value) {
  const text = String(value || '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fenced) return JSON.parse(fenced[1])
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return JSON.parse(start >= 0 && end >= start ? text.slice(start, end + 1) : text)
}

function synthesisResult (finalResult, synthesized, draft) {
  return { finalResult, synthesized, responseText: finalResult.conclusion, draft }
}

module.exports = { GroundedFinalSynthesizer, buildSynthesisPrompt, validateGroundedText, validateFinalResponseDraft, renderFinalResponseDraft, parseJsonObject }
