const { AgentHarness } = require('./agent-harness')
const { buildPrompt } = require('./prompt-builder')
const { PlannerOutputJsonSchema } = require('./planner-protocol')
const { parseDecision, suggestionModeDecision } = require('./strict-json-adapter')
const { parseMessage } = require('./decision-parser')
const { classifyHarnessError, retryTransient } = require('./harness-errors')
const { AIchatWithTools } = require('../../lib/ai')

class OpenAICompatibleHarnessAdapter extends AgentHarness {
  constructor (config) {
    super()
    this.config = config
  }

  getCapabilities () {
    return { nativeTools: true, structuredOutput: true, streaming: false, usage: false, cancellation: true, maxContextTokens: this.config.maxContextTokens || 32000 }
  }

  async * runTurn (input, signal) {
    yield { type: 'status', phase: 'thinking', message: 'AI 正在规划下一步…' }
    const prompt = buildPrompt(input)
    const tools = [{
      type: 'function',
      function: {
        name: 'submit_agent_decision',
        description: 'Submit exactly one OpsHalo planner decision. This function does not execute a server tool.',
        parameters: PlannerOutputJsonSchema
      }
    }]
    const request = async () => {
      const response = await AIchatWithTools(
        [{ role: 'system', content: 'Return a structured operations planning decision only.' }, { role: 'user', content: prompt }],
        this.config.modelAI,
        this.config.baseURLAI,
        this.config.apiPathAI,
        this.config.apiKeyAI,
        this.config.proxyAI,
        tools,
        this.config.authHeaderNameAI,
        { signal, timeoutMs: this.config.agentModelTimeoutMs || 45000 }
      )
      if (response.error) throw new Error(response.error)
      return response.message
    }
    const message = await retryTransient(request, signal, [0])
    let decision
    try { decision = parseMessage(message, input) } catch (firstError) {
      const repair = await AIchatWithTools(
        [{ role: 'system', content: 'Repair the supplied decision into valid JSON only. Do not add actions.' }, { role: 'user', content: JSON.stringify(message).slice(0, 12000) }],
        this.config.modelAI,
        this.config.baseURLAI,
        this.config.apiPathAI,
        this.config.apiKeyAI,
        this.config.proxyAI,
        [],
        this.config.authHeaderNameAI,
        { signal, timeoutMs: this.config.agentModelTimeoutMs || 45000 }
      )
      if (repair.error) throw classifyHarnessError(new Error(repair.error))
      try {
        decision = parseDecision(repair.message?.content, input)
        yield { type: 'provider_warning', code: 'structure_repaired', message: '模型输出结构已在同一 Provider 内自动修复。' }
      } catch (_) {
        yield { type: 'provider_warning', code: 'suggestion_mode_required', message: '模型连续两次未返回可验证结构，已停止自动动作。' }
        decision = suggestionModeDecision(firstError, input)
      }
    }
    yield { type: 'status', phase: 'responding', message: 'AI 已形成可验证的下一步。' }
    yield { type: 'decision', decision }
  }

  async dispose () {}
}

module.exports = { OpenAICompatibleHarnessAdapter, parseMessage }
