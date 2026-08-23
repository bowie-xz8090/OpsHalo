const { AgentHarness } = require('./agent-harness')
const { buildPrompt } = require('./prompt-builder')
const { ActionSelectionJsonSchema } = require('./planner-protocol')
const { suggestionModeDecision } = require('./strict-json-adapter')
const { parseMessage } = require('./decision-parser')
const { classifyHarnessError } = require('./harness-errors')
const { AIchatWithTools, AIchatWithToolsStream, createAIClient } = require('../../lib/ai')
const crypto = require('crypto')

const PLANNER_SYSTEM_INSTRUCTION = [
  'Call submit_agent_decision exactly once and do not answer outside the function.',
  'Choose only a tool from PUBLIC_TOOL_CATALOG.',
  'For every remote read choose shell.review_exec and put exactly one minimal bounded command in argumentsJson as {"command":"..."}.',
  'Use readProbeBundleJson only for 2-3 independent internal structured reads marked parallelSafe; never bundle a user-visible Shell command.',
  'For a requested change choose shell.exec and provide a complete read-only verificationPlanJson.',
  'Preserve the exact user scope: path/location requests output only a path and must not add content, syntax, include, status, log, or port checks.',
  'For path/location, query metadata or options that directly contain the path; never use a validator, test, status, or diagnostic command whose incidental output happens to mention it.',
  'Use outcome=answer only when no server evidence is needed or the latest observation already satisfies the objective.'
].join(' ')

class OpenAICompatibleHarnessAdapter extends AgentHarness {
  constructor (config) {
    super()
    this.config = config
    this.client = createAIClient(config.baseURLAI, config.apiKeyAI, config.proxyAI, config.authHeaderNameAI)
  }

  getCapabilities () {
    return { nativeTools: true, structuredOutput: true, streaming: this.config.agentStreamingEnabled !== false, usage: true, cancellation: true, maxContextTokens: this.config.agentMaxContextTokens || 32000 }
  }

  async * runTurn (input, signal) {
    yield { type: 'phase', phase: 'thinking', safeMessage: 'AI 正在规划下一步…' }
    // The function schema already carries the complete decision contract. Repeating it
    // in the prompt roughly doubles the request and is particularly slow on Qwen.
    const prompt = buildPrompt(input, { includeOutputSchema: false })
    const tools = [{
      type: 'function',
      function: {
        name: 'submit_agent_decision',
        description: 'Choose one next action, direct answer, question, or block. This function does not execute a server tool.',
        parameters: ActionSelectionJsonSchema
      }
    }]
    let message
    if (this.config.agentStreamingEnabled === false) {
      const response = await AIchatWithTools(
        [{ role: 'system', content: PLANNER_SYSTEM_INSTRUCTION }, { role: 'user', content: prompt }],
        this.config.agentPlannerModel || this.config.modelAI,
        this.config.baseURLAI,
        this.config.apiPathAI,
        this.config.apiKeyAI,
        this.config.proxyAI,
        tools,
        this.config.authHeaderNameAI,
        plannerRequestOptions(this.config, input, signal, this.client)
      )
      if (response.error) throw classifyHarnessError(new Error(response.error))
      message = response.message
    } else {
      let reasoningStarted = false
      try {
        for await (const event of AIchatWithToolsStream(
          [{ role: 'system', content: PLANNER_SYSTEM_INSTRUCTION }, { role: 'user', content: prompt }],
          this.config.agentPlannerModel || this.config.modelAI,
          this.config.baseURLAI,
          this.config.apiPathAI,
          this.config.apiKeyAI,
          this.config.proxyAI,
          tools,
          this.config.authHeaderNameAI,
          plannerRequestOptions(this.config, input, signal, this.client)
        )) {
          if (event.type === 'message') message = event.message
          if (event.type === 'usage') yield event
          if (event.type === 'text_delta') yield { type: 'text.delta', delta: event.delta }
          if (event.type === 'reasoning_delta' && !reasoningStarted) {
            reasoningStarted = true
            yield { type: 'phase', phase: 'thinking', safeMessage: '模型已响应，正在整理下一步…' }
          }
        }
      } catch (streamError) {
        if (signal?.aborted) throw streamError
        yield { type: 'phase', phase: 'degraded', code: 'stream_fallback', safeMessage: '流式工具调用不可用，正在切换同模型兼容模式…' }
        const fallback = await AIchatWithTools(
          [{ role: 'system', content: PLANNER_SYSTEM_INSTRUCTION }, { role: 'user', content: prompt }],
          this.config.agentPlannerModel || this.config.modelAI,
          this.config.baseURLAI,
          this.config.apiPathAI,
          this.config.apiKeyAI,
          this.config.proxyAI,
          tools,
          this.config.authHeaderNameAI,
          plannerRequestOptions(this.config, input, signal, this.client, 15000)
        )
        if (fallback.error) throw classifyHarnessError(new Error(fallback.error))
        message = fallback.message
      }
    }
    if (!message) throw new Error('AI stream ended without a message')
    let decision
    try { decision = parseMessage(message, input) } catch (firstError) {
      const repair = await AIchatWithTools(
        [{ role: 'system', content: `${PLANNER_SYSTEM_INSTRUCTION} Repair every missing or malformed field. argumentsJson and verificationPlanJson are JSON-encoded strings, not nested objects.` }, { role: 'user', content: `${prompt}\n\nThe previous response failed validation: ${String(firstError.message || firstError).slice(0, 1000)}\nPrevious invalid response:\n${JSON.stringify(message).slice(0, 6000)}` }],
        this.config.agentPlannerModel || this.config.modelAI,
        this.config.baseURLAI,
        this.config.apiPathAI,
        this.config.apiKeyAI,
        this.config.proxyAI,
        tools,
        this.config.authHeaderNameAI,
        plannerRequestOptions(this.config, input, signal, this.client, 15000)
      )
      if (repair.error) throw classifyHarnessError(new Error(repair.error))
      try {
        decision = parseMessage(repair.message, input)
        yield { type: 'phase', phase: 'degraded', code: 'structure_repaired', safeMessage: '模型输出结构已在同一 Provider 内自动修复。' }
      } catch (_) {
        const fallback = await requestCommandFallback(this.config, this.client, input, prompt, signal)
        if (fallback) {
          yield { type: 'phase', phase: 'degraded', code: 'command_fallback_used', safeMessage: '模型结构化协议不稳定，已将同模型生成的最小命令转换为可确认操作。' }
          decision = fallback
        } else {
          yield { type: 'phase', phase: 'degraded', code: 'suggestion_mode_required', safeMessage: '当前 AI 配置无法生成可确认命令，本次未执行任何操作。' }
          decision = suggestionModeDecision(firstError, input, visibleMessageText(repair.message) || visibleMessageText(message))
        }
      }
    }
    yield { type: 'phase', phase: 'responding', safeMessage: 'AI 已形成可验证的下一步。' }
    yield { type: 'decision.completed', decision }
  }

  async dispose () {
    this.client = null
  }
}

function plannerRequestOptions (config, input, signal, client, timeoutMs) {
  return {
    signal,
    timeoutMs: timeoutMs || boundedTimeout(config.agentModelTimeoutMs, 30000),
    maxOutputTokens: config.agentMaxOutputTokens || 2048,
    forceToolName: 'submit_agent_decision',
    temperature: config.agentTemperature,
    promptCacheKey: config.agentPromptCacheEnabled === false ? undefined : `opshalo-${input.taskId}`,
    client
  }
}

function visibleMessageText (message) {
  if (typeof message?.content === 'string' && message.content.trim()) return message.content
  return message?.tool_calls?.map(item => item.function?.arguments).filter(Boolean).join('\n') || ''
}

async function requestCommandFallback (config, client, input, prompt, signal) {
  const response = await AIchatWithTools(
    [{
      role: 'system',
      content: 'Return one JSON object only: {"kind":"read|change","command":"one shell command","verificationCommand":"read-only command or null","summary":"short user-visible purpose","expectedObservation":"what output proves"}. Generate the smallest command that exactly satisfies the current objective. A path/location request must query metadata or options that directly contain the path and output only that path; never use a validator, test, status, or diagnostic command whose incidental output happens to mention it. Do not add adjacent diagnostics.'
    }, { role: 'user', content: prompt }],
    config.agentPlannerModel || config.modelAI,
    config.baseURLAI,
    config.apiPathAI,
    config.apiKeyAI,
    config.proxyAI,
    [],
    config.authHeaderNameAI,
    {
      signal,
      timeoutMs: 15000,
      maxOutputTokens: Math.min(config.agentMaxOutputTokens || 2048, 1024),
      temperature: config.agentTemperature,
      promptCacheKey: config.agentPromptCacheEnabled === false ? undefined : `opshalo-${input.taskId}`,
      client
    }
  )
  if (response.error || !response.message?.content) return null
  try { return decodeCommandFallback(response.message.content, input) } catch (_) { return null }
}

function decodeCommandFallback (raw, input = {}) {
  const text = String(raw || '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const payload = JSON.parse(fenced ? fenced[1] : start >= 0 && end >= start ? text.slice(start, end + 1) : text)
  const kind = payload.kind === 'change' ? 'change' : payload.kind === 'read' ? 'read' : null
  const command = typeof payload.command === 'string' ? payload.command.trim() : ''
  const verificationCommand = typeof payload.verificationCommand === 'string' ? payload.verificationCommand.trim() : ''
  const available = new Set((input.availableTools || []).map(item => item.name))
  if (!kind || !command || command.length > 8000) throw new Error('invalid command fallback')
  const toolName = kind === 'change' ? 'shell.exec' : 'shell.review_exec'
  if (!available.has(toolName) || (kind === 'change' && (!verificationCommand || !available.has('shell.review_exec')))) throw new Error('fallback tool is unavailable')
  const summary = String(payload.summary || input.objective || '执行请求').slice(0, 500)
  const expectedObservation = String(payload.expectedObservation || '命令输出满足当前目标').slice(0, 1000)
  const fingerprint = crypto.createHash('sha256').update(`${input.taskId}:${command}`).digest('hex').slice(0, 20)
  const action = {
    schemaVersion: 1,
    invocationId: `invocation_${fingerprint}`,
    taskId: input.taskId,
    toolName,
    toolVersion: '1',
    arguments: { command },
    target: { kind: 'host', canonicalId: 'current-host', display: '当前主机' },
    purpose: summary,
    expectedObservation
  }
  if (kind === 'change') {
    action.verificationPlan = {
      planId: `plan_${fingerprint}`,
      preconditions: [],
      postconditions: [{
        checkId: `check_${fingerprint}`,
        description: '验证请求的变更已生效',
        intent: {
          toolName: 'shell.review_exec',
          arguments: { command: verificationCommand },
          target: action.target,
          purpose: '验证变更结果'
        },
        predicate: { operator: 'exists', path: 'stdout' },
        critical: true
      }],
      successExpression: '只读验证命令成功并返回结果'
    }
  }
  return {
    schemaVersion: 1,
    goalStatus: 'continue',
    planSummary: summary,
    reasonSummary: summary,
    knownFactIds: [],
    missingInformation: [expectedObservation],
    expectedObservation,
    completionCriteria: [{
      criterionId: `criterion_${fingerprint}`,
      statement: expectedObservation,
      critical: true,
      status: 'pending',
      evidenceRefs: []
    }],
    action
  }
}

function boundedTimeout (value, maximum) {
  return Math.max(5000, Math.min(Number(value) || 30000, maximum))
}

module.exports = { OpenAICompatibleHarnessAdapter, parseMessage, boundedTimeout, PLANNER_SYSTEM_INSTRUCTION, decodeCommandFallback, requestCommandFallback, visibleMessageText, plannerRequestOptions }
