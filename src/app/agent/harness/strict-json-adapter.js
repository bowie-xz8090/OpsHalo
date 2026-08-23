const { AgentHarness } = require('./agent-harness')
const { PlannerDecisionSchema } = require('../schemas/harness-schema')
const { buildPrompt } = require('./prompt-builder')
const { retryTransient } = require('./harness-errors')
const { parsePlannerDecision } = require('./planner-protocol')
const { SecretRedactor } = require('../observation/secret-redactor')

class StrictJsonHarnessAdapter extends AgentHarness {
  constructor (completion, options = {}) {
    super()
    this.completion = completion
    this.maxContextTokens = options.maxContextTokens || 32000
  }

  getCapabilities () {
    return { nativeTools: false, structuredOutput: false, streaming: false, usage: false, cancellation: true, maxContextTokens: this.maxContextTokens }
  }

  async * runTurn (input, signal) {
    yield { type: 'phase', phase: 'thinking', safeMessage: 'AI 正在规划下一步…' }
    const prompt = buildPrompt(input)
    let raw = await retryTransient(() => this.completion(prompt, signal), signal)
    let decision
    try { decision = parseDecision(raw, input) } catch (firstError) {
      const repairPrompt = `${prompt}\n\n<STRUCTURE_REPAIR>Repair only the JSON structure of this response. Do not change the intended action:\n${String(raw).slice(0, 12000)}</STRUCTURE_REPAIR>`
      raw = await this.completion(repairPrompt, signal)
      try {
        decision = parseDecision(raw, input)
      } catch (_) {
        yield { type: 'phase', phase: 'degraded', code: 'suggestion_mode_required', safeMessage: '模型连续两次未返回可验证结构，已关闭自动动作并降级为人工建议入口。' }
        decision = suggestionModeDecision(firstError, input, raw)
      }
    }
    yield { type: 'phase', phase: 'responding', safeMessage: 'AI 已形成可验证的下一步。' }
    yield { type: 'decision.completed', decision }
  }

  async dispose () {}
}

function suggestionModeDecision (_error, input = {}, modelResponse = '') {
  const facts = Array.isArray(input.workingMemory?.facts) ? input.workingMemory.facts : []
  const knownFactIds = facts.map(fact => fact.factId).filter(Boolean).slice(0, 100)
  const existingGaps = Array.isArray(input.workingMemory?.missingInformation) ? input.workingMemory.missingInformation : []
  const visibleResponse = safeVisibleModelResponse(modelResponse)
  return PlannerDecisionSchema.parse({
    schemaVersion: 1,
    goalStatus: 'blocked',
    planSummary: '当前 AI 配置无法生成可确认命令',
    reasonSummary: visibleResponse || '当前 AI 配置连续返回无效的动作格式，本次未执行任何命令。请检查模型能力或切换支持工具调用的模型后重试。',
    knownFactIds,
    missingInformation: [...new Set([...existingGaps, '当前模型未能生成可验证的下一步结构化决策。'])].slice(0, 10),
    completionCriteria: Array.isArray(input.workingMemory?.completionCriteria) ? input.workingMemory.completionCriteria : []
  })
}

function safeVisibleModelResponse (value) {
  const source = typeof value === 'string' ? value : value?.content || ''
  const cleaned = Array.from(String(source))
    .filter(character => character === '\n' || character === '\r' || character === '\t' || (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127))
    .join('')
    .trim()
  if (!cleaned) return ''
  return new SecretRedactor().redact(cleaned).text.slice(0, 300)
}

function parseDecision (raw, input = {}) {
  return parsePlannerDecision(raw, input)
}

module.exports = { StrictJsonHarnessAdapter, parseDecision, suggestionModeDecision, safeVisibleModelResponse }
