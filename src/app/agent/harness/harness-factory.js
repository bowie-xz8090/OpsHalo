const { StrandsHarnessAdapter } = require('./strands-harness-adapter')
const { OpenAICompatibleHarnessAdapter } = require('./openai-harness-adapter')
const { StrictJsonHarnessAdapter } = require('./strict-json-adapter')
const { CodexAppServerHarnessAdapter } = require('./codex-app-server-adapter')
const { AIchatWithTools } = require('../../lib/ai')
const { normalizeAiBackendSelection } = require('../config')

class HarnessFactory {
  constructor (config, options = {}) {
    this.configProvider = typeof config === 'function' ? config : () => config
    this.codexManager = options.codexManager
  }

  config () {
    return this.configProvider() || {}
  }

  selectedAdapter (config = this.config()) {
    const selected = ['strands', 'openai_compatible', 'strict_json'].includes(config.agentHarnessAdapter)
      ? config.agentHarnessAdapter
      : 'openai_compatible'
    return selected === 'strands' && requiresDirectCompatibleAdapter(config.baseURLAI)
      ? 'openai_compatible'
      : selected
  }

  selection () {
    const config = this.config()
    const backend = normalizeAiBackendSelection(config)
    if (backend.type === 'codex_subscription') {
      if (!backend.codexProfileId) throw factoryError('CODEX_PROFILE_REQUIRED', '请先选择并授权一个 Codex 账号。')
      return {
        adapter: 'codex_app_server',
        modelId: config.codexModelAI || 'codex-default',
        providerId: 'openai-codex-subscription',
        profileId: backend.codexProfileId,
        supportsNativeTools: false,
        supportsStructuredOutput: true,
        maxContextTokens: config.agentMaxContextTokens || 32000
      }
    }
    const adapter = this.selectedAdapter(config)
    return {
      adapter,
      modelId: config.modelAI,
      providerId: providerId(config.baseURLAI),
      supportsNativeTools: adapter === 'openai_compatible',
      supportsStructuredOutput: adapter !== 'strict_json',
      maxContextTokens: config.agentMaxContextTokens || 32000
    }
  }

  async create (record) {
    const config = this.config()
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
          { signal }
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

function providerId (baseURL) {
  try { return new URL(baseURL).hostname } catch (_) { return 'configured-provider' }
}

function requiresDirectCompatibleAdapter (baseURL) {
  return /(?:^|\.)dashscope\.aliyuncs\.com$/i.test(providerId(baseURL))
}

function factoryError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.source = 'harness'
  return error
}

module.exports = { HarnessFactory, providerId, factoryError, requiresDirectCompatibleAdapter }
