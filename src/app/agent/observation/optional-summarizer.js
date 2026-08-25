const { SecretRedactor } = require('./secret-redactor')
const { normalizeAiBackendSelection } = require('../config')

const MAX_SUMMARIZER_INPUT_BYTES = 24 * 1024

class OptionalSummarizer {
  constructor (handler) {
    this.handler = handler
  }

  async summarize (input, signal, context = {}) {
    if (!this.handler) return null
    const data = boundedSummarizerInput(input)
    const result = await this.handler({
      instruction: 'Return one JSON object with summary, factIds, and evidenceRanges. Use only supplied redacted facts and evidence references. Do not add facts or request tools.',
      data,
      tools: [],
      modelProfile: context.session?.harness?.modelProfiles?.summarizer
    }, signal)
    if (result && typeof result === 'object') return result
    return typeof result === 'string' ? result.slice(0, 4096) : null
  }
}

class OpenAIObservationSummarizer extends OptionalSummarizer {
  constructor (getConfig, options = {}) {
    super(null)
    this.getConfig = typeof getConfig === 'function' ? getConfig : () => getConfig || {}
    this.completion = options.completion
    this.redactor = options.redactor || new SecretRedactor()
  }

  async summarize (input, signal, context = {}) {
    const config = this.getConfig()
    const taskAdapter = context.session?.harness?.adapter
    if (config.agentObservationSummarizerEnabled === false || normalizeAiBackendSelection(config).type !== 'openai_compatible' || taskAdapter === 'codex_app_server') return null
    const request = {
      instruction: 'Return exactly one JSON object: {"summary":"string","factIds":["candidate_id"],"evidenceRanges":[{"evidenceId":"evidence://...","start":0,"end":1}]}. Cite only supplied ids and ranges. No Markdown, tools, commands, or hidden reasoning.',
      data: boundedSummarizerInput(input),
      tools: []
    }
    let content
    if (this.completion) {
      content = await this.completion(request, signal, context)
    } else {
      const { AIchatWithTools, createAIClient } = require('../../lib/ai')
      const profile = context.session?.harness?.modelProfiles?.summarizer
      const baseURL = profile?.baseURL || config.baseURLAI
      const model = profile?.modelId || config.agentSummarizerModel || config.agentPlannerModel || config.modelAI
      const client = createAIClient(baseURL, config.apiKeyAI, config.proxyAI, config.authHeaderNameAI)
      const result = await AIchatWithTools(
        [{ role: 'system', content: request.instruction }, { role: 'user', content: JSON.stringify(request.data) }],
        model,
        baseURL,
        config.apiPathAI,
        config.apiKeyAI,
        config.proxyAI,
        [],
        config.authHeaderNameAI,
        {
          client,
          signal,
          timeoutMs: Math.min(profile?.turnTimeoutMs || config.agentModelTimeoutMs || 20000, 20000),
          maxOutputTokens: Math.min(profile?.maxOutputTokens || config.agentMaxOutputTokens || 1024, 1024),
          temperature: 0,
          promptCacheKey: (profile?.promptCache ?? config.agentPromptCacheEnabled !== false) ? `opshalo-observation-${context.session?.taskId || 'task'}` : undefined
        }
      )
      if (result.error) throw new Error(result.error)
      content = result.message?.content
    }
    const redacted = this.redactor.redact(String(content || ''))
    return redacted.failed ? null : redacted.text.slice(0, 4096)
  }
}

function boundedSummarizerInput (input = {}) {
  const value = {
    status: String(input.status || '').slice(0, 40),
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
    facts: (input.facts || []).slice(0, 50).map(boundedFact),
    evidenceRefs: (input.evidenceRefs || []).slice(0, 20).map(item => String(item || '').slice(0, 300)),
    sample: (input.sample || []).slice(0, 20).map(item => ({
      stream: item.stream,
      priority: item.priority,
      text: String(item.text || '').slice(0, 2048)
    }))
  }
  while (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SUMMARIZER_INPUT_BYTES && value.sample.length) value.sample.pop()
  while (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SUMMARIZER_INPUT_BYTES && value.facts.length > 1) value.facts.pop()
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SUMMARIZER_INPUT_BYTES) value.facts = []
  while (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_SUMMARIZER_INPUT_BYTES && value.evidenceRefs.length) value.evidenceRefs.pop()
  return value
}

function boundedFact (fact = {}) {
  return {
    id: String(fact.id || '').slice(0, 160),
    statement: String(fact.statement || '').slice(0, 2048),
    kind: String(fact.kind || '').slice(0, 40),
    confidence: String(fact.confidence || '').slice(0, 40),
    evidence: (fact.evidence || []).slice(0, 4).map(item => ({
      evidenceId: String(item?.evidenceId || '').slice(0, 300),
      start: Number.isInteger(item?.start) ? item.start : 0,
      end: Number.isInteger(item?.end) ? item.end : 0
    }))
  }
}

module.exports = { OptionalSummarizer, OpenAIObservationSummarizer, boundedSummarizerInput, MAX_SUMMARIZER_INPUT_BYTES }
