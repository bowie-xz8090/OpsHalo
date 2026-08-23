const { AgentHarness } = require('./agent-harness')
const { PlannerDecisionWireSchema, decodePlannerDecision } = require('./planner-protocol')
const { buildPrompt } = require('./prompt-builder')
const { parseDecision, suggestionModeDecision } = require('./strict-json-adapter')
const { classifyHarnessError, retryTransient } = require('./harness-errors')

class StrandsHarnessAdapter extends AgentHarness {
  constructor (config, options = {}) {
    super()
    this.config = config
    this.agentFactory = options.agentFactory
    this.compatibleFallback = options.compatibleFallback
    this.agent = null
    this.disposed = false
  }

  getCapabilities () {
    return { nativeTools: false, structuredOutput: true, streaming: true, usage: true, cancellation: true, maxContextTokens: this.config.agentMaxContextTokens || 32000 }
  }

  async createAgent () {
    if (this.agentFactory) {
      return this.agentFactory({ structuredOutputSchema: PlannerDecisionWireSchema, tools: [] })
    }
    const [{ Agent }, { OpenAIModel }] = await Promise.all([
      import('@strands-agents/sdk'),
      import('@strands-agents/sdk/models/openai')
    ])
    const headers = {}
    const header = String(this.config.authHeaderNameAI || 'Authorization: Bearer').split(':')
    if (header[0].trim().toLowerCase() !== 'authorization' && header[0].trim()) {
      headers[header[0].trim()] = `${header.slice(1).join(':').trim()} ${this.config.apiKeyAI || ''}`.trim()
    }
    const model = new OpenAIModel({
      api: 'chat',
      modelId: this.config.agentPlannerModel || this.config.modelAI,
      apiKey: this.config.apiKeyAI || 'not-configured',
      maxTokens: this.config.agentMaxOutputTokens || 2048,
      clientConfig: {
        baseURL: this.config.baseURLAI,
        defaultHeaders: headers
      }
    })
    return new Agent({
      model,
      tools: [],
      structuredOutputSchema: PlannerDecisionWireSchema,
      systemPrompt: 'Produce one structured OpsHalo operations planning decision. Never execute tools.',
      retryStrategy: null,
      printer: false,
      name: 'OpsHalo-planner'
    })
  }

  async * runTurn (input, signal) {
    if (this.disposed) throw new Error('Strands harness has been disposed')
    const agent = this.agent || await this.createAgent()
    this.agent = agent
    const abort = () => agent.cancel?.()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    try {
      let result
      let decision
      try {
        yield { type: 'phase', phase: 'thinking', safeMessage: 'AI 正在规划下一步…' }
        result = await retryTransient(() => invokeAgentWithTimeout(agent, buildPrompt(input), signal, this.config.agentModelTimeoutMs || 45000), signal, [0])
        decision = parseStrandsResult(result, input)
      } catch (firstError) {
        if (isSdkCompatibilityError(firstError)) throw firstError
        const classified = classifyHarnessError(firstError)
        if (classified.category !== 'invalid_model_output') throw classified
        try {
          result = await retryTransient(() => invokeAgentWithTimeout(agent, structureRepairPrompt(), signal, this.config.agentModelTimeoutMs || 45000), signal, [0])
          decision = parseStrandsResult(result, input)
          yield { type: 'phase', phase: 'degraded', code: 'structure_repaired', safeMessage: '模型输出结构已在同一 Provider 内自动修复。' }
        } catch (repairError) {
          if (isSdkCompatibilityError(repairError)) throw repairError
          const repairClassified = classifyHarnessError(repairError)
          if (repairClassified.category !== 'invalid_model_output') throw repairClassified
          yield { type: 'phase', phase: 'degraded', code: 'suggestion_mode_required', safeMessage: '模型连续两次未返回可验证结构，已停止自动动作。' }
          yield { type: 'decision.completed', decision: suggestionModeDecision(firstError, input, result?.toString?.() || '') }
          return
        }
      }
      const usage = result.metrics?.accumulatedUsage || result.metrics?.usage
      if (usage) {
        yield { type: 'usage', inputTokens: usage.inputTokens || usage.input_tokens || 0, outputTokens: usage.outputTokens || usage.output_tokens || 0 }
      }
      yield { type: 'phase', phase: 'responding', safeMessage: 'AI 已形成可验证的下一步。' }
      yield { type: 'decision.completed', decision }
    } catch (error) {
      if (this.compatibleFallback && isSdkCompatibilityError(error)) {
        yield { type: 'phase', phase: 'degraded', code: 'strands_compatibility_fallback', safeMessage: 'Strands SDK 当前环境不兼容，已使用用户显式启用的同 Provider 兼容适配器。' }
        for await (const event of this.compatibleFallback.runTurn(input, signal)) yield event
        return
      }
      throw classifyHarnessError(error)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  async dispose () {
    this.disposed = true
    this.agent?.cancel?.()
    this.agent = null
  }
}

function parseStrandsResult (result, input = {}) {
  if (result?.structuredOutput !== undefined) return decodePlannerDecision(result.structuredOutput, input)
  if (typeof result?.toString === 'function') return parseDecision(result.toString(), input)
  throw new Error('invalid structured output: decision is missing')
}

function structureRepairPrompt () {
  return 'The previous response did not match PlannerDecision. Repair only its structure and return exactly one valid structured decision. Preserve the same objective and intended next action. Do not execute tools and do not add commentary.'
}

function isSdkCompatibilityError (error) {
  return /ERR_MODULE_NOT_FOUND|cannot find (?:package|module)|is not a constructor|unsupported.*structured|structuredOutputSchema/i.test(String(error?.code || '') + ' ' + String(error?.message || error || ''))
}

function invokeAgentWithTimeout (agent, prompt, signal, timeoutMs) {
  const bounded = Math.max(1000, Math.min(Number(timeoutMs) || 45000, 60000))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => {
      agent.cancel?.()
      const error = signal?.reason instanceof Error ? signal.reason : new Error('model planning cancelled')
      finish(reject, error)
    }
    const timer = setTimeout(() => {
      agent.cancel?.()
      const error = new Error(`model planner timed out after ${bounded}ms`)
      error.code = 'ETIMEDOUT'
      error.category = 'transport_error'
      finish(reject, error)
    }, bounded)
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => agent.invoke(prompt)).then(value => finish(resolve, value), error => finish(reject, error))
  })
}

module.exports = { StrandsHarnessAdapter, isSdkCompatibilityError, parseStrandsResult, invokeAgentWithTimeout }
