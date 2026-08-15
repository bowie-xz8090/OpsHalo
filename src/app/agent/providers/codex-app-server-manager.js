const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
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
    this.getConfig = options.getConfig || (() => ({}))
    this.audit = options.audit
    this.version = options.version || '0.0.0'
    this.clientFactory = options.clientFactory || (clientOptions => new CodexJsonRpcClient(clientOptions))
    this.isProfileBusy = options.isProfileBusy || (() => false)
    this.clients = new Map()
    this.clientBindings = new Map()
    this.pendingLogins = new Map()
    this.activeTurns = new Map()
  }

  listAccounts () {
    return this.profileStore.list()
  }

  async clientFor (profileId) {
    const profile = this.profileStore.get(profileId)
    if (!profile) throw managerError('CODEX_PROFILE_NOT_FOUND', 'Codex 账号不存在。')
    let client = this.clients.get(profileId)
    if (client) {
      await client.start()
      return client
    }
    const paths = this.profileStore.ensureProfileDirectories(profileId)
    const executable = resolveCodexExecutable(this.getConfig())
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
    if (!profile) profile = this.profileStore.create(displayName || 'Codex account')
    if (this.isProfileBusy(profile.profileId)) throw managerError('CODEX_PROFILE_BUSY', '该账号仍有活跃 Agent 任务，请先安全停止任务。')
    const client = await this.clientFor(profile.profileId)
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

  async refreshAccount (profileId, refreshToken = false) {
    const client = await this.clientFor(profileId)
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
    const client = await this.clientFor(profileId)
    progress('authenticating', '正在确认 Codex 账号状态…')
    const account = await client.request('account/read', { refreshToken: false }, { timeoutMs: 15000 })
    if (account?.account?.type !== 'chatgpt') throw managerError('CODEX_AUTH_REQUIRED', 'Codex 账号尚未授权或登录已失效，请重新授权。')
    const paths = this.profileStore.ensureProfileDirectories(profileId)
    progress('preparing', '正在准备隔离的 AI 规划线程…')
    const threadResult = await client.request('thread/start', {
      cwd: paths.runtime,
      ephemeral: true,
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      baseInstructions: PLANNING_ONLY_INSTRUCTIONS,
      developerInstructions: PLANNING_ONLY_INSTRUCTIONS,
      config: PLANNING_ONLY_CONFIG,
      serviceName: 'OpsHalo'
    }, { timeoutMs: 30000 })
    const threadId = threadResult?.thread?.id
    if (!threadId) throw managerError('CODEX_THREAD_START_FAILED', 'Codex App Server 未能创建规划线程。')
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

  recordSecurityEvent (profileId, event) {
    this.audit?.append('codex_app_server_security', { profileId, ...event })
    this.emit('securityEvent', { profileId, ...event })
  }

  publishProfile (profileId, reason) {
    this.emit('accountEvent', { schemaVersion: 1, profileId, reason, accounts: this.listAccounts() })
  }

  async dispose () {
    const entries = [...this.clients.entries()]
    const clients = entries.map(([, client]) => client)
    entries.forEach(([profileId]) => this.unbindClient(profileId))
    this.clients.clear()
    this.activeTurns.clear()
    this.pendingLogins.clear()
    await Promise.allSettled(clients.map(client => client.dispose()))
  }
}

function resolveCodexExecutable (config = {}) {
  const configured = String(config.codexAppServerExecutable || process.env.CODEX_APP_SERVER_EXECUTABLE || '').trim()
  if (configured) {
    if (!path.isAbsolute(configured) || !fs.existsSync(configured)) throw managerError('CODEX_EXECUTABLE_NOT_FOUND', '配置的 Codex App Server 可执行文件不存在。')
    return configured
  }
  const bundled = findBundledCodexExecutable()
  if (bundled) return bundled
  throw managerError('CODEX_BUNDLED_EXECUTABLE_NOT_FOUND', '安装包内置的 Codex App Server 不完整，请重新安装 OpsHalo。')
}

function findBundledCodexExecutable (options = {}) {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const resourcesPath = options.resourcesPath === undefined ? process.resourcesPath : options.resourcesPath
  const moduleDir = options.moduleDir || __dirname
  const target = codexTarget(platform, arch)
  if (!target) return undefined
  const roots = [
    resourcesPath && path.join(resourcesPath, 'app.asar.unpacked', 'node_modules'),
    resourcesPath && path.join(resourcesPath, 'app', 'node_modules'),
    path.resolve(moduleDir, '../../node_modules'),
    path.resolve(moduleDir, '../../../../node_modules')
  ].filter(Boolean)
  try {
    const packageJson = require.resolve(`${target.packageName}/package.json`)
    roots.push(path.resolve(path.dirname(packageJson), '../..'))
  } catch (_) {}
  for (const root of [...new Set(roots)]) {
    const executable = path.join(root, target.packageName, 'vendor', target.triple, 'bin', target.executableName)
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    if (fs.existsSync(executable)) return executable
  }
  return undefined
}

function codexTarget (platform, arch) {
  const targets = {
    'win32:x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
    'win32:arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
    'linux:x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
    'linux:arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
    'darwin:x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
    'darwin:arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin', 'codex']
  }
  const value = targets[`${platform}:${arch}`]
  return value && { packageName: value[0], triple: value[1], executableName: value[2] }
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
  findBundledCodexExecutable,
  codexTarget,
  safeAuthUrl,
  extractUsage,
  parseStructuredJson,
  managerError
}
