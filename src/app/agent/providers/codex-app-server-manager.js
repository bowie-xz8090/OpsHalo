const { EventEmitter } = require('events')
const { CodexJsonRpcClient, rpcError, sanitizeErrorText } = require('./codex-jsonrpc-client')
const { PLANNING_ONLY_INSTRUCTIONS, handleCodexServerRequest } = require('./codex-tool-bridge')
const { buildPrompt } = require('../harness/prompt-builder')
const {
  CodexPlannerOutputSchema,
  CODEX_OUTPUT_MAPPING_INSTRUCTIONS,
  decodeCodexPlannerDecision
} = require('./codex-planner-protocol')

const PLANNING_ONLY_CONFIG = Object.freeze({
  features: {
    shell_tool: false,
    unified_exec: false,
    apps: false,
    multi_agent: false,
    remote_plugin: false,
    goals: false,
    hooks: false,
    memories: false
  },
  apps: { _default: { enabled: false } },
  web_search: 'disabled',
  file_opener: 'none',
  check_for_update_on_startup: false,
  analytics: { enabled: false },
  feedback: { enabled: false }
})

class CodexAppServerManager extends EventEmitter {
  constructor (options) {
    super()
    this.profileStore = options.profileStore
    this.runtimeManager = options.runtimeManager
    this.getConfig = options.getConfig || (() => ({}))
    this.audit = options.audit
    this.version = options.version || '0.0.0'
    this.clientFactory = options.clientFactory || (clientOptions => new CodexJsonRpcClient(clientOptions))
    this.isProfileBusy = options.isProfileBusy || (() => false)
    this.clients = new Map()
    this.clientBindings = new Map()
    this.pendingLogins = new Map()
    this.activeTurns = new Map()
    this.taskThreads = new Map()
    this.accountCache = new Map()
  }

  listAccounts () {
    return this.profileStore.list()
  }

  async clientFor (profileId, options = {}) {
    const profile = this.profileStore.get(profileId)
    if (!profile) throw managerError('CODEX_PROFILE_NOT_FOUND', 'Codex 账号不存在。')
    let client = this.clients.get(profileId)
    if (client) {
      await client.start()
      return client
    }
    const paths = this.profileStore.ensureProfileDirectories(profileId)
    const executable = options.executable || await this.resolveExecutable(options.allowDownload === true)
    client = this.clientFactory({
      executable,
      cwd: paths.runtime,
      codexHome: paths.codexHome,
      version: this.version,
      requestHandler: request => handleCodexServerRequest(request, event => this.recordSecurityEvent(profileId, event))
    })
    this.bindClient(profileId, client)
    this.clients.set(profileId, client)
    try {
      await client.start()
    } catch (error) {
      this.clients.delete(profileId)
      this.unbindClient(profileId)
      await client.dispose().catch(() => {})
      this.profileStore.update(profileId, { authState: 'error', error: safeManagerMessage(error) })
      this.publishProfile(profileId, 'process_error')
      throw normalizeManagerError(error)
    }
    return client
  }

  bindClient (profileId, client) {
    const onLoginCompleted = params => this.onLoginCompleted(profileId, params)
    const onAccountUpdated = params => {
      if (!this.profileStore.get(profileId)) return
      const patch = params?.authMode === 'chatgpt'
        ? { authState: 'authenticated', planType: params.planType, error: null }
        : { authState: 'unauthenticated', planType: params?.planType, error: null }
      this.profileStore.update(profileId, patch)
      this.publishProfile(profileId, 'account_updated')
    }
    const onRateLimitsUpdated = params => {
      if (!this.profileStore.get(profileId)) return
      const rateLimits = params?.rateLimits || params
      this.profileStore.update(profileId, { rateLimits })
      this.publishProfile(profileId, 'rate_limits_updated')
    }
    const onExit = error => {
      this.clients.delete(profileId)
      for (const [loginId, pendingProfileId] of this.pendingLogins) {
        if (pendingProfileId === profileId) this.pendingLogins.delete(loginId)
      }
      const profile = this.profileStore.get(profileId)
      if (profile && profile.authState !== 'unauthenticated') {
        this.profileStore.update(profileId, { authState: 'error', error: safeManagerMessage(error) })
        this.publishProfile(profileId, 'process_exited')
      }
      this.unbindClient(profileId)
    }
    const bindings = [
      ['account/login/completed', onLoginCompleted],
      ['account/updated', onAccountUpdated],
      ['account/rateLimits/updated', onRateLimitsUpdated],
      ['exit', onExit]
    ]
    bindings.forEach(([event, handler]) => client.on(event, handler))
    this.clientBindings.set(profileId, { client, bindings })
  }

  unbindClient (profileId) {
    const binding = this.clientBindings.get(profileId)
    if (!binding) return
    binding.bindings.forEach(([event, handler]) => binding.client.removeListener(event, handler))
    this.clientBindings.delete(profileId)
  }

  async startLogin ({ profileId, displayName, method }) {
    let profile = profileId ? this.profileStore.get(profileId) : null
    const executable = await this.resolveExecutable(true)
    if (!profile) profile = this.profileStore.create(displayName || 'Codex account')
    if (this.isProfileBusy(profile.profileId)) throw managerError('CODEX_PROFILE_BUSY', '该账号仍有活跃 Agent 任务，请先安全停止任务。')
    const client = await this.clientFor(profile.profileId, { executable })
    const type = method === 'device_code' ? 'chatgptDeviceCode' : 'chatgpt'
    this.profileStore.update(profile.profileId, { authState: 'authorizing', error: null })
    this.publishProfile(profile.profileId, 'login_started')
    try {
      const result = await client.request('account/login/start', { type }, { timeoutMs: 20000 })
      if (!result?.loginId) throw managerError('CODEX_LOGIN_INVALID_RESPONSE', 'Codex 登录未返回有效的登录标识。')
      this.pendingLogins.set(result.loginId, profile.profileId)
      return {
        schemaVersion: 1,
        profileId: profile.profileId,
        loginId: result.loginId,
        type: result.type,
        authUrl: safeAuthUrl(result.authUrl),
        verificationUrl: safeAuthUrl(result.verificationUrl),
        userCode: result.userCode ? String(result.userCode).slice(0, 80) : undefined
      }
    } catch (error) {
      this.profileStore.update(profile.profileId, { authState: 'error', error: safeManagerMessage(error) })
      this.publishProfile(profile.profileId, 'login_failed')
      throw normalizeManagerError(error)
    }
  }

  async cancelLogin ({ profileId, loginId }) {
    if (this.pendingLogins.get(loginId) !== profileId) throw managerError('CODEX_LOGIN_NOT_FOUND', '待处理的 Codex 登录不存在。')
    const client = await this.clientFor(profileId)
    await client.request('account/login/cancel', { loginId }, { timeoutMs: 10000 })
    this.pendingLogins.delete(loginId)
    this.profileStore.update(profileId, { authState: 'unauthenticated', error: null })
    this.publishProfile(profileId, 'login_cancelled')
    return this.listAccounts()
  }

  async onLoginCompleted (profileId, params) {
    if (!this.profileStore.get(profileId)) return
    if (params?.loginId) this.pendingLogins.delete(params.loginId)
    if (!params?.success) {
      this.profileStore.update(profileId, { authState: 'error', error: sanitizeErrorText(params?.error || 'Codex 登录失败。') })
      this.publishProfile(profileId, 'login_failed')
      return
    }
    try {
      await this.refreshAccount(profileId, true)
      this.publishProfile(profileId, 'login_completed')
    } catch (error) {
      this.profileStore.update(profileId, { authState: 'error', error: safeManagerMessage(error) })
      this.publishProfile(profileId, 'login_refresh_failed')
    }
  }

  async refreshAccount (profileId, refreshToken = false, options = {}) {
    const client = await this.clientFor(profileId, { allowDownload: options.allowDownload !== false })
    const result = await client.request('account/read', { refreshToken }, { timeoutMs: 20000 })
    const account = result?.account
    if (!account || account.type !== 'chatgpt') {
      const profile = this.profileStore.update(profileId, { authState: 'unauthenticated', maskedEmail: null, planType: null, rateLimits: null, error: null })
      this.publishProfile(profileId, 'account_read')
      return profile
    }
    let rateLimits
    let rateError
    try {
      const limits = await client.request('account/rateLimits/read', undefined, { timeoutMs: 15000 })
      rateLimits = limits?.rateLimitsByLimitId?.codex || limits?.rateLimits
    } catch (error) {
      rateError = safeManagerMessage(error)
    }
    const profile = this.profileStore.update(profileId, {
      email: account.email,
      planType: account.planType,
      authState: 'authenticated',
      rateLimits,
      error: rateError
    })
    this.publishProfile(profileId, 'account_read')
    return profile
  }

  selectProfile (profileId) {
    if (this.isProfileBusy(profileId)) throw managerError('CODEX_PROFILE_BUSY', '该账号仍有活跃 Agent 任务，请先安全停止任务。')
    return this.profileStore.select(profileId)
  }

  async logout (profileId) {
    if (this.isProfileBusy(profileId)) throw managerError('CODEX_PROFILE_BUSY', '该账号仍有活跃 Agent 任务，请先安全停止任务。')
    const client = await this.clientFor(profileId)
    await client.request('account/logout', undefined, { timeoutMs: 15000 })
    const profile = this.profileStore.update(profileId, { authState: 'unauthenticated', maskedEmail: null, planType: null, rateLimits: null, error: null })
    this.publishProfile(profileId, 'logout')
    return profile
  }

  async removeProfile (profileId) {
    if (this.isProfileBusy(profileId)) throw managerError('CODEX_PROFILE_BUSY', '该账号仍有活跃 Agent 任务，请先安全停止任务。')
    const client = this.clients.get(profileId)
    if (client) {
      try { await client.request('account/logout', undefined, { timeoutMs: 5000 }) } catch (_) {}
      this.unbindClient(profileId)
      await client.dispose()
      this.clients.delete(profileId)
    }
    for (const [loginId, pendingProfileId] of this.pendingLogins) {
      if (pendingProfileId === profileId) this.pendingLogins.delete(loginId)
    }
    return this.profileStore.delete(profileId)
  }

  async runPlannerTurn (profileId, input, signal, onProgress = () => {}) {
    const progress = (phase, message) => {
      try { onProgress({ phase, message: String(message).slice(0, 200) }) } catch (_) {}
    }
    const profile = this.profileStore.get(profileId)
    if (!profile) throw managerError('CODEX_PROFILE_NOT_FOUND', '请选择有效的 Codex 账号。')
    progress('connecting', '正在连接 Codex App Server…')
    const client = await this.clientFor(profileId, { allowDownload: false })
    progress('authenticating', '正在确认 Codex 账号状态…')
    const account = await this.readCachedAccount(profileId, client)
    if (account?.account?.type !== 'chatgpt') throw managerError('CODEX_AUTH_REQUIRED', 'Codex 账号尚未授权或登录已失效，请重新授权。')
    const paths = this.profileStore.ensureProfileDirectories(profileId)
    const configured = this.getConfig()
    const existingThread = this.taskThreads.get(input.taskId)
    progress('preparing', existingThread ? '正在复用当前任务的 AI 规划线程…' : '正在准备隔离的 AI 规划线程…')
    const threadId = existingThread?.threadId || await this.startTaskThread({
      client,
      profileId,
      taskId: input.taskId,
      paths,
      model: configured.agentPlannerModel || configured.codexModelAI,
      reasoningEffort: configured.agentReasoningEffort
    })
    const prompt = `${buildPrompt(input, { includeOutputSchema: false })}\n\n<CODEX_OUTPUT_MAPPING>\n${CODEX_OUTPUT_MAPPING_INSTRUCTIONS}\n</CODEX_OUTPUT_MAPPING>`
    const deltas = []
    const completedItems = []
    let usage
    let responding = false
    let latestProviderError
    const onDelta = params => {
      if (params?.threadId !== threadId || typeof params.delta !== 'string') return
      deltas.push(params.delta)
      if (!responding) {
        responding = true
        progress('responding', 'AI 已形成下一步，正在整理结构化决策…')
      }
    }
    const onUsage = params => {
      if (params?.threadId === threadId) usage = extractUsage(params)
    }
    const onItemCompleted = params => {
      if (params?.threadId !== threadId || params?.item?.type !== 'agentMessage') return
      completedItems.push(params.item)
    }
    const onServerError = params => {
      if (params?.threadId !== threadId) return
      latestProviderError = params
      if (params?.willRetry) progress('thinking', 'AI 服务连接暂时不稳定，正在自动重试…')
    }
    client.on('item/agentMessage/delta', onDelta)
    client.on('thread/tokenUsage/updated', onUsage)
    client.on('item/completed', onItemCompleted)
    client.on('codex/server-error', onServerError)
    let active
    const interrupt = () => {
      if (active?.turnId) client.interrupt(threadId, active.turnId).catch(() => {})
    }
    signal?.addEventListener('abort', interrupt, { once: true })
    try {
      const startResult = await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        outputSchema: CodexPlannerOutputSchema,
        approvalPolicy: 'untrusted',
        sandboxPolicy: {
          type: 'readOnly',
          networkAccess: false
        }
      }, { timeoutMs: 30000 })
      const turnId = startResult?.turn?.id
      if (!turnId) throw managerError('CODEX_TURN_START_FAILED', 'Codex App Server 未能开始规划。')
      active = { profileId, client, threadId, turnId }
      this.activeTurns.set(input.taskId, active)
      progress('thinking', 'AI 正在结合服务器上下文思考下一步…')
      if (signal?.aborted) {
        await client.interrupt(threadId, turnId).catch(() => {})
        throw managerError('CODEX_TURN_CANCELLED', 'Codex 规划已取消。')
      }
      const completed = await client.waitForNotification('turn/completed', params => {
        if (params?.threadId !== threadId) return false
        return params?.turn?.id === turnId || params?.turnId === turnId
      }, { timeoutMs: 300000, signal })
      const turn = completed?.turn
      if (turn?.status === 'interrupted') throw managerError('CODEX_TURN_CANCELLED', 'Codex 规划已取消。')
      if (turn?.status !== 'completed') {
        const providerMessage = latestProviderError?.error?.message || latestProviderError?.error?.additionalDetails
        throw managerError('CODEX_TURN_FAILED', sanitizeErrorText(turn?.error?.message || providerMessage || 'Codex 规划失败。'))
      }
      const finalItem = [...(turn.items || []), ...completedItems].reverse().find(item => item?.type === 'agentMessage')
      const text = deltas.join('') || finalItem?.text || ''
      const decision = decodeCodexPlannerDecision(parseStructuredJson(text), input)
      this.profileStore.update(profileId, { lastUsedAt: new Date().toISOString(), authState: 'authenticated' })
      return { decision, usage }
    } catch (error) {
      throw normalizeManagerError(error)
    } finally {
      signal?.removeEventListener('abort', interrupt)
      client.removeListener('item/agentMessage/delta', onDelta)
      client.removeListener('thread/tokenUsage/updated', onUsage)
      client.removeListener('item/completed', onItemCompleted)
      client.removeListener('codex/server-error', onServerError)
      this.activeTurns.delete(input.taskId)
    }
  }

  async interruptTask (taskId) {
    const active = this.activeTurns.get(taskId)
    if (!active) return
    await active.client.interrupt(active.threadId, active.turnId)
  }

  releaseTaskSession (taskId) {
    this.taskThreads.delete(taskId)
  }

  async readCachedAccount (profileId, client) {
    const cached = this.accountCache.get(profileId)
    if (cached && Date.now() - cached.readAt < 5 * 60 * 1000) return cached.value
    const value = await client.request('account/read', { refreshToken: false }, { timeoutMs: 15000 })
    this.accountCache.set(profileId, { readAt: Date.now(), value })
    return value
  }

  async startTaskThread ({ client, profileId, taskId, paths, model, reasoningEffort }) {
    const config = {
      ...PLANNING_ONLY_CONFIG,
      features: { ...PLANNING_ONLY_CONFIG.features },
      apps: { _default: { ...PLANNING_ONLY_CONFIG.apps._default } }
    }
    if (reasoningEffort) config.model_reasoning_effort = reasoningEffort
    const params = {
      cwd: paths.runtime,
      ephemeral: true,
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      baseInstructions: PLANNING_ONLY_INSTRUCTIONS,
      developerInstructions: PLANNING_ONLY_INSTRUCTIONS,
      config,
      serviceName: 'OpsHalo'
    }
    if (model) params.model = model
    const threadResult = await client.request('thread/start', params, { timeoutMs: 30000 })
    const threadId = threadResult?.thread?.id
    if (!threadId) throw managerError('CODEX_THREAD_START_FAILED', 'Codex App Server 未能创建规划线程。')
    this.taskThreads.set(taskId, { profileId, threadId, client, createdAt: Date.now() })
    return threadId
  }

  recordSecurityEvent (profileId, event) {
    this.audit?.append('codex_app_server_security', { profileId, ...event })
    this.emit('securityEvent', { profileId, ...event })
  }

  publishProfile (profileId, reason) {
    this.emit('accountEvent', { schemaVersion: 1, profileId, reason, accounts: this.listAccounts() })
  }

  async resolveExecutable (allowDownload) {
    if (!this.runtimeManager) return resolveCodexExecutable(this.getConfig())
    return this.runtimeManager.resolveExecutable(this.getConfig(), { allowDownload })
  }

  async dispose () {
    const entries = [...this.clients.entries()]
    const clients = entries.map(([, client]) => client)
    entries.forEach(([profileId]) => this.unbindClient(profileId))
    this.clients.clear()
    this.activeTurns.clear()
    this.taskThreads.clear()
    this.accountCache.clear()
    this.pendingLogins.clear()
    await Promise.allSettled(clients.map(client => client.dispose()))
  }
}

function resolveCodexExecutable (config = {}) {
  const configured = String(config.codexAppServerExecutable || process.env.CODEX_APP_SERVER_EXECUTABLE || '').trim()
  if (configured) {
    const path = require('path')
    const fs = require('fs')
    if (!path.isAbsolute(configured) || !fs.existsSync(configured)) throw managerError('CODEX_EXECUTABLE_NOT_FOUND', '配置的 Codex App Server 可执行文件不存在。')
    return configured
  }
  throw managerError('CODEX_RUNTIME_MISSING', 'Codex 运行时尚未安装，请打开 AI 配置并点击账号按钮完成下载。')
}

function safeAuthUrl (value) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Unsafe URL')
    return url.toString()
  } catch (_) {
    throw managerError('CODEX_LOGIN_URL_INVALID', 'Codex App Server 返回了不安全的授权地址。')
  }
}

function extractUsage (params) {
  const usage = params?.tokenUsage || params?.usage || params
  const total = usage?.total || usage?.last || usage
  const inputTokens = Number(total?.inputTokens || total?.input_tokens || 0)
  const outputTokens = Number(total?.outputTokens || total?.output_tokens || 0)
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, Math.round(inputTokens)) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, Math.round(outputTokens)) : 0
  }
}

function parseStructuredJson (raw) {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw || '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(candidate)
}

function safeManagerMessage (error) {
  return sanitizeErrorText(error?.safeMessage || error?.message || 'Codex App Server 操作失败。')
}

function normalizeManagerError (error) {
  if (error?.safeMessage) return error
  if (error?.name === 'ZodError') return managerError('CODEX_INVALID_MODEL_OUTPUT', 'Codex 未返回有效的结构化规划结果。')
  return managerError(error?.code || 'CODEX_APP_SERVER_ERROR', safeManagerMessage(error))
}

function managerError (code, safeMessage) {
  const error = rpcError(code, safeMessage)
  error.category = code === 'CODEX_TURN_CANCELLED' ? 'cancelled' : code === 'CODEX_AUTH_REQUIRED' ? 'permission_denied' : 'internal_error'
  error.retryable = ['CODEX_APP_SERVER_TIMEOUT', 'CODEX_APP_SERVER_EXITED', 'CODEX_APP_SERVER_UNAVAILABLE'].includes(code)
  return error
}

module.exports = {
  CodexAppServerManager,
  PLANNING_ONLY_CONFIG,
  resolveCodexExecutable,
  safeAuthUrl,
  extractUsage,
  parseStructuredJson,
  managerError
}
