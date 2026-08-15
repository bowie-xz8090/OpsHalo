const { AgentHarness } = require('./agent-harness')
const { PlannerDecisionSchema } = require('../schemas/harness-schema')
const { buildPrompt } = require('./prompt-builder')
const { retryTransient } = require('./harness-errors')
const { parsePlannerDecision } = require('./planner-protocol')

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
    yield { type: 'status', phase: 'thinking', message: 'AI 正在规划下一步…' }
    const prompt = buildPrompt(input)
    let raw = await retryTransient(() => this.completion(prompt, signal), signal)
    let decision
    try { decision = parseDecision(raw, input) } catch (firstError) {
      const repairPrompt = `${prompt}\n\n<STRUCTURE_REPAIR>Repair only the JSON structure of this response. Do not change the intended action:\n${String(raw).slice(0, 12000)}</STRUCTURE_REPAIR>`
      raw = await this.completion(repairPrompt, signal)
      try {
        decision = parseDecision(raw, input)
      } catch (_) {
        yield { type: 'provider_warning', code: 'suggestion_mode_required', message: '模型连续两次未返回可验证结构，已关闭自动动作并降级为人工建议入口。' }
        decision = suggestionModeDecision(firstError, input)
      }
    }
    yield { type: 'status', phase: 'responding', message: 'AI 已形成可验证的下一步。' }
    yield { type: 'decision', decision }
  }

  async dispose () {}
}

function suggestionModeDecision (_error, input = {}) {
  const facts = Array.isArray(input.workingMemory?.facts) ? input.workingMemory.facts : []
  const knownFactIds = facts.map(fact => fact.factId).filter(Boolean).slice(0, 100)
  const existingGaps = Array.isArray(input.workingMemory?.missingInformation) ? input.workingMemory.missingInformation : []
  return PlannerDecisionSchema.parse({
    schemaVersion: 1,
    goalStatus: 'need_user',
    planSummary: '结构化动作不可用，已降级为建议模式',
    reasonSummary: '模型连续两次未返回可验证的结构化决策，因此不会执行任何命令或工具。',
    knownFactIds,
    missingInformation: [...new Set([...existingGaps, '当前模型未能生成可验证的下一步结构化决策。'])].slice(0, 10),
    completionCriteria: Array.isArray(input.workingMemory?.completionCriteria) ? input.workingMemory.completionCriteria : [],
    userQuestion: '本轮已安全停止自动探查；可以直接从 Shell 光标重新提交原问题，或切换模型后重试。'
  })
}

function parseDecision (raw, input = {}) {
  return parsePlannerDecision(raw, input)
}

module.exports = { StrictJsonHarnessAdapter, parseDecision, suggestionModeDecision }
