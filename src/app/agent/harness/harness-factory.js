const { StrandsHarnessAdapter } = require('./strands-harness-adapter')
const { OpenAICompatibleHarnessAdapter } = require('./openai-harness-adapter')
const { StrictJsonHarnessAdapter } = require('./strict-json-adapter')
const { CodexAppServerHarnessAdapter } = require('./codex-app-server-adapter')
const { AIchatWithTools, capabilityProfileHash } = require('../../lib/ai')
const { normalizeAiBackendSelection } = require('../config')
const { normalizeAgentModelProfiles } = require('../schemas/model-profile-schema')

class HarnessFactory {
  constructor (config, options = {}) {
    this.configProvider = typeof config === 'function' ? config : () => config
    this.codexManager = options.codexManager
  }

  config () {
    return this.configProvider() || {}
  }

  selectedAdapter (config = this.config()) {
    let selected = ['strands', 'openai_compatible', 'strict_json'].includes(config.agentHarnessAdapter)
      ? config.agentHarnessAdapter
      : 'openai_compatible'
    if (config.agentStructuredMode === 'json') selected = 'strict_json'
    return selected === 'strands' && requiresDirectCompatibleAdapter(config.baseURLAI)
      ? 'openai_compatible'
      : selected
  }

  selection () {
    const config = this.config()
    const backend = normalizeAiBackendSelection(config)
    const modelProfiles = normalizeAgentModelProfiles(profileConfig(config))
    const capabilityReport = capabilityReportSnapshot(config)
    if (backend.type === 'codex_subscription') {
      if (!backend.codexProfileId) throw factoryError('CODEX_PROFILE_REQUIRED', '请先选择并授权一个 Codex 账号。')
      return {
        adapter: 'codex_app_server',
        modelId: config.codexModelAI || 'codex-default',
        providerId: 'openai-codex-subscription',
        profileId: backend.codexProfileId,
        supportsNativeTools: false,
        supportsStructuredOutput: true,
        maxContextTokens: modelProfiles.planner.contextLimit,
        modelProfiles,
        capabilityReport
      }
    }
    const adapter = this.selectedAdapter(config)
    return {
      adapter,
      modelId: config.agentPlannerModel || config.modelAI,
      providerId: providerId(config.baseURLAI),
      supportsNativeTools: adapter === 'openai_compatible',
      supportsStructuredOutput: adapter !== 'strict_json',
      maxContextTokens: modelProfiles.planner.contextLimit,
      modelProfiles,
      capabilityReport
    }
  }

  async create (record) {
    const config = configForSelection(this.config(), record?.harness)
    const selection = record?.harness || this.selection()
    const adapter = selection.adapter
    if (adapter === 'codex_app_server') {
      if (!this.codexManager || !selection.profileId) throw factoryError('CODEX_APP_SERVER_UNAVAILABLE', 'Codex App Server Harness 尚未初始化。')
      return new CodexAppServerHarnessAdapter({
        manager: this.codexManager,
        profileId: selection.profileId,
        maxContextTokens: selection.maxContextTokens
      })
    }
    if (adapter === 'openai_compatible') return new OpenAICompatibleHarnessAdapter(config)
    if (adapter === 'strict_json') {
      return new StrictJsonHarnessAdapter(async (prompt, signal) => {
        const result = await AIchatWithTools(
          [{ role: 'system', content: 'Return one valid JSON object matching the supplied schema. No Markdown.' }, { role: 'user', content: prompt }],
          config.modelAI,
          config.baseURLAI,
          config.apiPathAI,
          config.apiKeyAI,
          config.proxyAI,
          [],
          config.authHeaderNameAI,
          {
            signal,
            timeoutMs: config.agentModelTimeoutMs,
            maxOutputTokens: config.agentMaxOutputTokens,
            temperature: config.agentTemperature
          }
        )
        if (result.error) throw new Error(result.error)
        return result.message?.content
      })
    }
    return new StrandsHarnessAdapter(config, {
      compatibleFallback: config.agentCompatibleFallbackEnabled === true
        ? new OpenAICompatibleHarnessAdapter(config)
        : null
    })
  }
}

function configForSelection (config, selection) {
  const planner = selection?.modelProfiles?.planner
  const summarizer = selection?.modelProfiles?.summarizer
  if (!planner) return config
  return {
    ...config,
    baseURLAI: planner.baseURL || config.baseURLAI,
    modelAI: planner.modelId,
    agentPlannerModel: planner.modelId,
    agentSummarizerModel: summarizer?.modelId || planner.modelId,
    agentMaxContextTokens: planner.contextLimit,
    agentMaxOutputTokens: planner.maxOutputTokens,
    agentModelTimeoutMs: planner.turnTimeoutMs,
    agentStreamingEnabled: config.agentProviderStreamingV2 !== false && planner.streaming,
    agentStructuredMode: planner.structuredMode,
    agentReasoningEffort: planner.reasoningEffort,
    agentTemperature: planner.temperature,
    agentPromptCacheEnabled: planner.promptCache
  }
}

function profileConfig (config) {
  if (config.agentModelProfilesV2 !== false) return config
  return {
    ...config,
    agentFastModel: '',
    agentPlannerModel: config.modelAI,
    agentSummarizerModel: ''
  }
}

function capabilityReportSnapshot (config) {
  const level = config.agentCapabilityLevel
  const checkedAt = Date.parse(config.agentCapabilityCheckedAt)
  if (!['automatic', 'limited', 'unavailable'].includes(level) || !Number.isFinite(checkedAt)) return undefined
  const profileHash = capabilityProfileHash(config)
  if (profileHash !== config.agentCapabilityProfileHash) return undefined
  const configuredExpiry = Date.parse(config.agentCapabilityExpiresAt)
  const expiresAtMs = Number.isFinite(configuredExpiry) ? configuredExpiry : checkedAt + 24 * 60 * 60 * 1000
  return {
    level,
    profileHash,
    checkedAt: new Date(checkedAt).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expired: Date.now() >= expiresAtMs
  }
}

function providerId (baseURL) {
  try { return new URL(baseURL).hostname } catch (_) { return 'configured-provider' }
}

function requiresDirectCompatibleAdapter (baseURL) {
  return /(?:^|\.)dashscope\.aliyuncs\.com$/i.test(providerId(baseURL))
}

function boundedInteger (value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback
}

function factoryError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.source = 'harness'
  return error
}

module.exports = { HarnessFactory, providerId, factoryError, requiresDirectCompatibleAdapter, boundedInteger, configForSelection, capabilityReportSnapshot, profileConfig }
