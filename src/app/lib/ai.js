const axios = require('axios')
const crypto = require('crypto')
const { StringDecoder } = require('string_decoder')
const log = require('../common/log')
const defaultSettings = require('../common/config-default')
const { createProxyAgent } = require('./proxy-agent')
const { safeAIRequestError } = require('./ai-error')

// Store for ongoing streaming sessions
const streamingSessions = new Map()
const ongoingRequests = new Map()

// Stop an ongoing streaming session
exports.stopStream = (sessionId) => {
  const controller = ongoingRequests.get(sessionId)
  if (controller) {
    controller.abort()
    ongoingRequests.delete(sessionId)
    return { stopped: true }
  }
  const session = streamingSessions.get(sessionId)
  if (!session) {
    return { error: 'Session not found' }
  }

  // Destroy the stream to stop receiving data
  if (session.stream && !session.stream.destroyed) {
    session.stream.destroy()
  }

  // Mark as completed (not an error, just stopped by user)
  session.completed = true
  session.stopped = true

  // Clean up
  streamingSessions.delete(sessionId)

  return { stopped: true }
}

const createAIClient = (baseURL, apiKey, proxy, authHeaderName) => {
  const headerStr = authHeaderName || 'Authorization: Bearer'
  const parts = headerStr.split(': ')
  const headerKey = parts[0]
  const headerPrefix = parts.length > 1 ? parts[1] : ''
  const headerValue = headerPrefix
    ? `${headerPrefix} ${apiKey}`
    : apiKey
  const config = {
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      [headerKey]: headerValue
    }
  }

  // Add proxy agent if proxy is provided
  const agent = proxy ? createProxyAgent(proxy) : null
  if (agent) {
    config.httpsAgent = agent
    config.proxy = false // Disable default proxy behavior when using agent
  }

  return axios.create(config)
}

exports.AIchatWithTools = async (messages, model, baseURL, path, apiKey, proxy, tools, authHeaderName, options = {}) => {
  const requestController = options.requestId && !options.signal ? new AbortController() : null
  if (options.requestId && requestController) ongoingRequests.set(options.requestId, requestController)
  try {
    const client = options.client || createAIClient(baseURL, apiKey, proxy, authHeaderName)
    const requestData = {
      model,
      messages,
      stream: false
    }
    if (tools && tools.length) {
      requestData.tools = tools
    }
    applyAgentRequestOptions(requestData, baseURL, options)
    const response = await client.post(path, requestData, {
      signal: options.signal || requestController?.signal,
      timeout: Math.max(1000, Math.min(Number(options.timeoutMs) || 45000, 60000))
    })
    const choice = response.data.choices[0]
    return {
      message: choice.message
    }
  } catch (e) {
    const safeError = safeAIRequestError(e)
    log.error(safeError.logMessage)
    return { error: safeError.clientMessage }
  } finally {
    if (options.requestId && requestController) ongoingRequests.delete(options.requestId)
  }
}

exports.AIchatWithToolsStream = async function * (messages, model, baseURL, path, apiKey, proxy, tools, authHeaderName, options = {}) {
  const client = options.client || createAIClient(baseURL, apiKey, proxy, authHeaderName)
  const requestData = {
    model,
    messages,
    stream: true
  }
  if (tools?.length) requestData.tools = tools
  if (options.includeUsage !== false) requestData.stream_options = { include_usage: true }
  applyAgentRequestOptions(requestData, baseURL, options)
  const message = { role: 'assistant', content: '' }
  const toolCalls = new Map()
  try {
    const response = await client.post(path, requestData, {
      responseType: 'stream',
      signal: options.signal,
      timeout: Math.max(1000, Math.min(Number(options.timeoutMs) || 45000, 60000))
    })
    const payloads = withFirstEventTimeout(
      parseSseJson(response.data, { requireDone: true }),
      Math.max(1000, Math.min(Number(options.firstDeltaTimeoutMs) || 10000, Number(options.timeoutMs) || 45000))
    )
    for await (const payload of payloads) {
      if (payload.usage) {
        yield {
          type: 'usage',
          inputTokens: safeTokenCount(payload.usage.prompt_tokens || payload.usage.input_tokens),
          outputTokens: safeTokenCount(payload.usage.completion_tokens || payload.usage.output_tokens),
          cachedTokens: safeTokenCount(payload.usage.prompt_tokens_details?.cached_tokens || payload.usage.input_tokens_details?.cached_tokens)
        }
      }
      const choice = payload.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}
      const reasoning = textDelta(delta.reasoning_content)
      if (reasoning) yield { type: 'reasoning_delta', charCount: reasoning.length }
      const content = textDelta(delta.content)
      if (content) {
        message.content += content
        yield { type: 'text_delta', delta: content }
      }
      for (const callDelta of delta.tool_calls || []) {
        mergeToolCallDelta(toolCalls, callDelta)
        yield { type: 'tool_delta' }
      }
    }
    if (toolCalls.size) message.tool_calls = [...toolCalls.values()].sort((a, b) => a.index - b.index).map(({ index, ...call }) => call)
    yield { type: 'message', message }
  } catch (error) {
    const safeError = safeAIRequestError(error)
    log.error(safeError.logMessage)
    const exposed = new Error(safeError.clientMessage)
    exposed.code = error?.code || 'AI_STREAM_FAILED'
    exposed.status = error?.response?.status
    exposed.safeMessage = safeError.clientMessage
    throw exposed
  }
}

exports.createAIClient = createAIClient

exports.AIchat = async (
  prompt,
  model = defaultSettings.modelAI,
  role = defaultSettings.roleAI,
  baseURL = defaultSettings.baseURLAI,
  path = defaultSettings.apiPathAI,
  apiKey,
  proxy = defaultSettings.proxyAI,
  stream = true,
  authHeaderName = defaultSettings.authHeaderNameAI,
  messages = null,
  requestId = null
) => {
  const controller = requestId ? new AbortController() : null
  if (requestId) ongoingRequests.set(requestId, controller)
  try {
    const client = createAIClient(baseURL, apiKey, proxy, authHeaderName)

    // Determine if we should use streaming based on the prompt content
    // Command suggestions should not use streaming for quick response
    const isCommandSuggestion = prompt.includes('give me max 5 command suggestions')
    const useStream = stream && !isCommandSuggestion

    // Use provided conversation messages if available, otherwise build from prompt and role
    const requestMessages = messages || [
      {
        role: 'system',
        content: role
      },
      {
        role: 'user',
        content: prompt
      }
    ]

    const requestData = {
      model,
      messages: requestMessages,
      stream: useStream
    }

    if (useStream) {
      // For streaming responses, initiate streaming and return session info
      const response = await client.post(path, requestData, {
        responseType: 'stream',
        signal: controller?.signal
      })

      const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
      const sessionData = {
        stream: response.data,
        content: '',
        completed: false,
        error: null
      }

      streamingSessions.set(sessionId, sessionData)

      // Start processing the stream
      processStream(sessionId, sessionData)

      return {
        sessionId,
        isStream: true,
        hasMore: true,
        content: ''
      }
    } else {
      // For non-streaming responses (command suggestions and when stream=false)
      const response = await client.post(path, requestData, {
        signal: controller?.signal
      })

      return {
        response: response.data.choices[0].message.content,
        isStream: false
      }
    }
  } catch (e) {
    const safeError = safeAIRequestError(e)
    log.error(safeError.logMessage)
    return { error: safeError.clientMessage }
  } finally {
    if (requestId) ongoingRequests.delete(requestId)
  }
}

// Function to get the current state of a streaming session
exports.getStreamContent = (sessionId) => {
  const session = streamingSessions.get(sessionId)
  if (!session) {
    return {
      error: 'Session not found'
    }
  }

  const result = {
    content: session.content,
    hasMore: !session.completed,
    isStream: true
  }

  if (session.error) {
    result.error = session.error
  }

  // Clean up completed sessions
  if (session.completed || session.error) {
    streamingSessions.delete(sessionId)
  }

  return result
}

// Process streaming data
function processStream (sessionId, sessionData) {
  let buffer = ''
  const decoder = new StringDecoder('utf8')

  const processLines = (shouldFlush = false) => {
    const lines = buffer.split('\n')
    buffer = shouldFlush ? '' : lines.pop()
    const linesToProcess = shouldFlush ? lines.filter(Boolean).concat(buffer ? [buffer] : []) : lines

    for (const line of linesToProcess) {
      if (line.trim() === '') continue
      if (line.trim() === 'data: [DONE]') {
        sessionData.completed = true
        return
      }

      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
            sessionData.content += data.choices[0].delta.content
          }
        } catch (e) {
          log.error('Error parsing stream data:', e)
        }
      }
    }
  }

  sessionData.stream.on('data', (chunk) => {
    buffer += decoder.write(chunk)
    processLines()
  })

  sessionData.stream.on('end', () => {
    buffer += decoder.end()
    processLines(true)
    sessionData.completed = true
  })

  sessionData.stream.on('error', (error) => {
    sessionData.error = error.message
    sessionData.completed = true
  })
}

async function * parseSseJson (stream, options = {}) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let dataLines = []
  let sawPayload = false
  const flush = () => {
    if (!dataLines.length) return { done: false }
    const value = dataLines.join('\n').trim()
    dataLines = []
    if (!value) return { done: false }
    if (value === '[DONE]') return { done: true }
    let payload
    try {
      payload = JSON.parse(value)
    } catch (_) {
      throw streamProtocolError('AI_STREAM_INVALID_JSON', 'AI 流返回了无效的数据帧。')
    }
    if (payload?.error) throw providerStreamError(payload.error)
    sawPayload = true
    return { done: false, payload }
  }
  for await (const chunk of stream) {
    buffer += decoder.write(chunk)
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line) {
        const value = flush()
        if (value.done) return
        if (value.payload) yield value.payload
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
  }
  buffer += decoder.end()
  if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart())
  const value = flush()
  if (value.done) return
  if (value.payload) yield value.payload
  if (options.requireDone === true && sawPayload) {
    throw streamProtocolError('AI_STREAM_INTERRUPTED', 'AI 流在完成标记前中断。')
  }
}

function providerStreamError (value) {
  const safe = safeAIRequestError({
    code: value?.code || value?.type || 'AI_PROVIDER_STREAM_ERROR',
    message: value?.message || 'AI Provider 返回流式错误。'
  })
  const error = streamProtocolError(
    String(value?.code || value?.type || 'AI_PROVIDER_STREAM_ERROR').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'AI_PROVIDER_STREAM_ERROR',
    safe.clientMessage
  )
  if (Number.isInteger(value?.status)) error.status = value.status
  return error
}

function streamProtocolError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  return error
}

async function * withFirstEventTimeout (iterable, timeoutMs) {
  const iterator = iterable[Symbol.asyncIterator]()
  let timer
  let first
  try {
    first = await Promise.race([
      iterator.next(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(streamProtocolError('AI_STREAM_FIRST_EVENT_TIMEOUT', 'AI 流在限定时间内没有返回首个事件。')), Math.max(1, Number(timeoutMs) || 10000))
      })
    ])
  } catch (error) {
    Promise.resolve(iterator.return?.()).catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (first.done) return
  yield first.value
  while (true) {
    const next = await iterator.next()
    if (next.done) return
    yield next.value
  }
}

function applyAgentRequestOptions (requestData, baseURL, options = {}) {
  const maxTokens = Number(options.maxOutputTokens)
  if (Number.isFinite(maxTokens)) requestData.max_tokens = Math.max(128, Math.min(Math.round(maxTokens), 32768))
  if (options.forceToolName) {
    requestData.tool_choice = {
      type: 'function',
      function: { name: String(options.forceToolName) }
    }
  }
  if (options.responseFormat) requestData.response_format = options.responseFormat
  const temperature = Number(options.temperature)
  if (Number.isFinite(temperature)) requestData.temperature = Math.max(0, Math.min(temperature, 2))
  if (options.promptCacheKey && isOfficialOpenAIEndpoint(baseURL)) requestData.prompt_cache_key = String(options.promptCacheKey).slice(0, 64)
  if (isDashScopeEndpoint(baseURL) && options.enableThinking !== true) requestData.enable_thinking = false
}

function isDashScopeEndpoint (value) {
  try {
    return /(?:^|\.)dashscope\.aliyuncs\.com$/i.test(new URL(String(value || '')).hostname)
  } catch (_) {
    return false
  }
}

function isOfficialOpenAIEndpoint (value) {
  try { return new URL(String(value || '')).hostname.toLowerCase() === 'api.openai.com' } catch (_) { return false }
}

function mergeToolCallDelta (calls, delta = {}) {
  const index = Number.isInteger(delta.index) ? delta.index : 0
  const current = calls.get(index) || {
    index,
    id: delta.id || `tool_call_${index}`,
    type: delta.type || 'function',
    function: { name: '', arguments: '' }
  }
  if (delta.id) current.id = delta.id
  if (delta.type) current.type = delta.type
  if (delta.function?.name) current.function.name += delta.function.name
  if (delta.function?.arguments) current.function.arguments += delta.function.arguments
  calls.set(index, current)
}

function textDelta (value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(item => typeof item === 'string' ? item : item?.text || '').join('')
}

function safeTokenCount (value) {
  const count = Number(value || 0)
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0
}

exports.parseSseJson = parseSseJson
exports.providerStreamError = providerStreamError
exports.withFirstEventTimeout = withFirstEventTimeout
exports.mergeToolCallDelta = mergeToolCallDelta
exports.applyAgentRequestOptions = applyAgentRequestOptions
exports.isDashScopeEndpoint = isDashScopeEndpoint
exports.isOfficialOpenAIEndpoint = isOfficialOpenAIEndpoint

exports.probeAgentModel = async (config = {}) => {
  const startedAt = Date.now()
  const nonce = crypto.randomBytes(8).toString('hex')
  const controller = new AbortController()
  const timeoutMs = Math.max(3000, Math.min(Number(config.agentModelTimeoutMs) || 20000, 30000))
  const timer = setTimeout(() => controller.abort(new Error('capability probe timed out')), timeoutMs)
  let firstDeltaMs
  let message
  let usage
  let streamEvents = 0
  try {
    const tools = [{
      type: 'function',
      function: {
        name: 'submit_agent_probe',
        description: 'Return the Agent capability probe result. This does not execute any tool.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            nonce: { type: 'string' }
          },
          required: ['ok', 'nonce']
        }
      }
    }]
    for await (const event of exports.AIchatWithToolsStream(
      [{ role: 'system', content: 'Call submit_agent_probe exactly once with ok=true and the supplied nonce. Do not execute any external action.' }, { role: 'user', content: `nonce=${nonce}` }],
      config.agentPlannerModel || config.modelAI,
      config.baseURLAI,
      config.apiPathAI,
      config.apiKeyAI,
      config.proxyAI,
      tools,
      config.authHeaderNameAI,
      {
        signal: controller.signal,
        timeoutMs,
        maxOutputTokens: Math.min(Number(config.agentMaxOutputTokens) || 1024, 2048),
        forceToolName: 'submit_agent_probe',
        temperature: config.agentTemperature,
        promptCacheKey: config.agentPromptCacheEnabled === false ? undefined : `opshalo-probe-${nonce}`
      }
    )) {
      if (['text_delta', 'tool_delta', 'message'].includes(event.type)) streamEvents++
      if (firstDeltaMs === undefined && ['text_delta', 'tool_delta', 'message'].includes(event.type)) firstDeltaMs = Date.now() - startedAt
      if (event.type === 'message') message = event.message
      if (event.type === 'usage') usage = event
    }
    const structured = parseProbeMessage(message)
    const streamComplete = streamEvents > 0 && !!message
    const structuredOutput = structured?.ok === true && structured.nonce === nonce
    const cancellation = await verifyProbeCancellation()
    const declaredLimits = inspectProbeLimits(config)
    const automatic = streamComplete && structuredOutput && cancellation && declaredLimits.valid
    const checkedAt = new Date()
    const failures = []
    if (!streamComplete) failures.push('流式响应未正常完成。')
    if (!structuredOutput) failures.push('结构化动作契约未通过。')
    if (!cancellation) failures.push('本地取消契约未通过。')
    failures.push(...declaredLimits.failures)
    return {
      schemaVersion: 1,
      level: automatic ? 'automatic' : 'limited',
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(checkedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      profileHash: capabilityProfileHash(config),
      model: String(config.agentPlannerModel || config.modelAI || '').slice(0, 200),
      endpointReachable: true,
      authenticated: true,
      streaming: streamComplete,
      structuredOutput,
      cancellation,
      normalStreamEnd: streamComplete,
      usageSupported: !!usage,
      errorCategory: structuredOutput ? undefined : 'invalid_model_output',
      declaredLimits: declaredLimits.value,
      checks: {
        authentication: probeCheck(true, '模型端点可达且认证成功。'),
        streaming: probeCheck(streamComplete, streamComplete ? '收到首个流事件并正常结束。' : '未收到完整流式响应。'),
        schema: probeCheck(structuredOutput, structuredOutput ? '最小 Planner wire schema 有效。' : '返回内容不符合最小 Planner wire schema。'),
        errorClassification: probeCheck(true, structuredOutput ? '错误分类器可用。' : '无效结构已归类为 invalid_model_output。'),
        cancellation: probeCheck(cancellation, cancellation ? 'AbortSignal 可停止本地等待。' : 'AbortSignal 未能停止本地等待。'),
        declaredLimits: probeCheck(declaredLimits.valid, declaredLimits.message)
      },
      firstDeltaMs,
      durationMs: Date.now() - startedAt,
      usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
      failures,
      recommendations: automatic ? [] : probeRecommendations({ streamComplete, structuredOutput, cancellation, declaredLimits }),
      message: automatic ? '流式、结构化动作、取消和模型限制契约验证通过。' : '模型可以响应，但部分 Agent 契约未通过；仅建议模式可用。'
    }
  } catch (error) {
    const safe = safeAIRequestError(error)
    const errorCategory = classifyProbeError(error)
    const cancellation = await verifyProbeCancellation()
    const declaredLimits = inspectProbeLimits(config)
    const checkedAt = new Date()
    return {
      schemaVersion: 1,
      level: 'unavailable',
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(checkedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      profileHash: capabilityProfileHash(config),
      model: String(config.agentPlannerModel || config.modelAI || '').slice(0, 200),
      endpointReachable: !['transport_error', 'timeout'].includes(errorCategory),
      authenticated: ['rate_limited', 'invalid_model_output'].includes(errorCategory),
      streaming: false,
      structuredOutput: false,
      cancellation,
      normalStreamEnd: false,
      usageSupported: false,
      errorCategory,
      declaredLimits: declaredLimits.value,
      checks: {
        authentication: probeCheck(['rate_limited', 'invalid_model_output'].includes(errorCategory), errorCategory === 'authentication' ? '模型认证失败。' : '模型请求未完成，无法确认认证状态。'),
        streaming: probeCheck(false, '未获得完整流式响应。'),
        schema: probeCheck(false, '未获得可验证的 Planner wire 输出。'),
        errorClassification: probeCheck(errorCategory !== 'internal_error', `请求失败已归类为 ${errorCategory}。`),
        cancellation: probeCheck(cancellation, cancellation ? 'AbortSignal 可停止本地等待。' : 'AbortSignal 未能停止本地等待。'),
        declaredLimits: probeCheck(declaredLimits.valid, declaredLimits.message)
      },
      durationMs: Date.now() - startedAt,
      failures: [safe.clientMessage],
      recommendations: probeFailureRecommendations(errorCategory),
      message: safe.clientMessage
    }
  } finally {
    clearTimeout(timer)
  }
}

async function verifyProbeCancellation () {
  const controller = new AbortController()
  const wait = new Promise((resolve, reject) => {
    const onAbort = () => reject(controller.signal.reason || new Error('cancelled'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  controller.abort(new Error('probe cancellation'))
  try {
    await wait
    return false
  } catch (_) {
    return controller.signal.aborted
  }
}

function inspectProbeLimits (config = {}) {
  const contextLimit = Number(config.agentMaxContextTokens ?? 32000)
  const maxOutputTokens = Number(config.agentMaxOutputTokens ?? 2048)
  const turnTimeoutMs = Number(config.agentModelTimeoutMs ?? 20000)
  const failures = []
  if (!Number.isInteger(contextLimit) || contextLimit < 4096 || contextLimit > 1000000) failures.push('上下文限制必须在 4096 到 1000000 tokens 之间。')
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 32768) failures.push('最大输出必须在 128 到 32768 tokens 之间。')
  if (Number.isFinite(contextLimit) && Number.isFinite(maxOutputTokens) && maxOutputTokens > contextLimit) failures.push('最大输出不能超过上下文限制。')
  if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 5000 || turnTimeoutMs > 60000) failures.push('单回合超时必须在 5 到 60 秒之间。')
  return {
    valid: failures.length === 0,
    failures,
    message: failures.length ? failures.join(' ') : '声明的上下文、输出和超时限制与本地预算一致。',
    value: {
      contextTokens: Number.isFinite(contextLimit) ? Math.trunc(contextLimit) : null,
      maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.trunc(maxOutputTokens) : null,
      turnTimeoutMs: Number.isFinite(turnTimeoutMs) ? Math.trunc(turnTimeoutMs) : null,
      source: ['agentMaxContextTokens', 'agentMaxOutputTokens', 'agentModelTimeoutMs'].some(key => config[key] !== undefined) ? 'configured' : 'default'
    }
  }
}

function classifyProbeError (error) {
  const status = Number(error?.status || error?.response?.status || 0)
  const value = `${error?.code || ''} ${error?.message || ''}`
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid.{0,20}(?:api.?key|token)|authentication/i.test(value)) return 'authentication'
  if (/abort|cancel/i.test(value)) return 'cancelled'
  if (/timeout|first.event|ETIMEDOUT/i.test(value)) return 'timeout'
  if (status === 429 || /rate.?limit|throttl/i.test(value)) return 'rate_limited'
  if (/schema|invalid.{0,20}(?:json|output)|parse/i.test(value)) return 'invalid_model_output'
  if (status >= 500 || /network|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch|stream/i.test(value)) return 'transport_error'
  return 'internal_error'
}

function probeCheck (passed, message) {
  return { status: passed ? 'passed' : 'failed', message }
}

function probeRecommendations ({ streamComplete, structuredOutput, cancellation, declaredLimits }) {
  const result = []
  if (!streamComplete) result.push('选择支持标准 SSE 流式完成的模型端点。')
  if (!structuredOutput) result.push('切换到支持原生工具调用或稳定 JSON Schema 的模型。')
  if (!cancellation) result.push('检查 Provider SDK 的 AbortSignal 支持。')
  if (!declaredLimits.valid) result.push('按模型官方限制调整 context、max output 和 timeout。')
  return result
}

function probeFailureRecommendations (category) {
  if (category === 'authentication') return ['检查 API Key、认证头格式和账号权限后重新探测。']
  if (category === 'rate_limited') return ['等待 Provider 限流恢复后重新探测。']
  if (category === 'timeout') return ['检查接口地址、代理和超时设置后重新探测。']
  return ['检查接口地址、模型名称、认证信息和代理设置后重新探测。']
}

function parseProbeMessage (message) {
  const call = message?.tool_calls?.find(item => item?.function?.name === 'submit_agent_probe')
  const raw = call?.function?.arguments || message?.content
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch (_) { return undefined }
}

function capabilityProfileHash (config) {
  const value = [
    config.aiBackendType,
    config.baseURLAI,
    config.apiPathAI,
    config.codexProfileId,
    config.agentFastModel,
    config.agentPlannerModel || config.modelAI,
    config.agentSummarizerModel,
    config.agentStructuredMode,
    config.agentMaxContextTokens,
    config.agentMaxOutputTokens,
    config.agentModelTimeoutMs,
    config.agentStreamingEnabled !== false,
    config.agentReasoningEffort,
    config.agentTemperature,
    config.agentPromptCacheEnabled !== false
  ].join('|')
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 20)
}

exports.parseProbeMessage = parseProbeMessage
exports.capabilityProfileHash = capabilityProfileHash
exports.verifyProbeCancellation = verifyProbeCancellation
exports.inspectProbeLimits = inspectProbeLimits
exports.classifyProbeError = classifyProbeError
