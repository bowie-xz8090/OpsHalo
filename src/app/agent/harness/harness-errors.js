function classifyHarnessError (error) {
  const details = providerErrorDetails(error)
  const message = details.message
  const category = error?.category || categoryFromProvider(details) || 'internal_error'
  let retryable = error?.retryable === true
  if (category === 'rate_limited' || category === 'transport_error') retryable = true
  const result = new Error(message)
  result.code = `AGENT_${category.toUpperCase()}`
  result.category = category
  result.source = 'harness'
  result.retryable = retryable
  result.safeMessage = safeMessage(category)
  result.providerCode = details.code
  result.providerType = details.type
  result.httpStatus = details.status
  result.safeDetails = Object.fromEntries(Object.entries({ providerCode: details.code, providerType: details.type, httpStatus: details.status }).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return result
}

function categoryFromProvider (details) {
  const code = `${details.code || ''} ${details.type || ''}`.toLowerCase()
  const message = details.message
  const status = Number(details.status || 0)
  if (/abort|cancel|interrupted/.test(code) || /\b(?:abort(?:ed)?|cancel(?:led|ed)?)\b/i.test(message)) return 'cancelled'
  if (status === 429 || /rate.?limit|throttl|too_many_requests/.test(code) || /\b429\b|rate.?limit|throttl/i.test(message)) return 'rate_limited'
  if (/invalid_json_schema|invalid_schema|response_format|structured_output|schema_validation/.test(code) ||
      /invalid\s+schema|response_format|structured output|propertyNames|ZodError|invalid.*(?:output|json)|(?:json|schema).*parse/i.test(message)) return 'invalid_model_output'
  if (/context_length_exceeded|prompt_too_long|input_too_long|token_limit_exceeded/.test(code) ||
      /maximum context length|context window (?:was |is )?(?:exceeded|too small)|input.{0,40}tokens?.{0,30}(?:exceed|too (?:many|long))|token limit.{0,20}(?:exceed|reached)|prompt.{0,20}too long/i.test(message)) return 'context_exhausted'
  if (status >= 500 || /timeout|network|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch failed|service_unavailable|gateway_timeout/i.test(`${code} ${message}`)) return 'transport_error'
  if (details.name === 'ZodError' || details.name === 'SyntaxError') return 'invalid_model_output'
}

function providerErrorDetails (error) {
  const chain = []
  let current = error
  for (let depth = 0; current && depth < 4; depth++) {
    chain.push(current)
    current = current.cause
  }
  const message = chain.map(item => String(item?.message || item || '')).filter(Boolean).join(' | ') || 'Model request failed'
  const responseData = chain.map(item => item?.response?.data).find(Boolean)
  const payload = responseData?.error || responseData || parseErrorPayload(message)?.error || parseErrorPayload(message)
  return {
    message,
    code: firstValue(chain.map(item => item?.code), payload?.code),
    type: firstValue(chain.map(item => item?.type), payload?.type),
    status: firstValue(chain.map(item => item?.status || item?.response?.status), payload?.status),
    name: firstValue(chain.map(item => item?.name))
  }
}

function parseErrorPayload (message) {
  const start = message.indexOf('{')
  const end = message.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try { return JSON.parse(message.slice(start, end + 1)) } catch (_) { return null }
}

function firstValue (values, fallback) {
  return values.find(value => value !== undefined && value !== null && value !== '') ?? fallback
}

function safeMessage (category) {
  return {
    rate_limited: '模型服务繁忙，请稍后重试。',
    context_exhausted: '模型上下文预算不足，任务无法继续自动规划。',
    invalid_model_output: '模型未返回有效的结构化动作。',
    transport_error: '模型服务在限定时间内未返回可用结果；没有执行服务器命令。',
    cancelled: '模型生成已取消。',
    internal_error: '模型适配器返回未识别错误；没有执行服务器命令。请检查 Harness 与供应商兼容性。'
  }[category]
}

async function retryTransient (operation, signal, retries = [0, 500, 1500]) {
  let last
  for (let index = 0; index < retries.length; index++) {
    if (signal?.aborted) throw classifyHarnessError(signal.reason || new Error('cancelled'))
    if (retries[index]) await abortableDelay(retries[index], signal)
    try { return await operation(index) } catch (error) {
      last = classifyHarnessError(error)
      if (!last.retryable || index === retries.length - 1) throw last
    }
  }
  throw last
}

function abortableDelay (ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(classifyHarnessError(signal.reason || new Error('cancelled')))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

module.exports = { classifyHarnessError, categoryFromProvider, providerErrorDetails, retryTransient, abortableDelay }
