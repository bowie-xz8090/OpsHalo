const { z } = require('zod')

const AgentModelProfileSchema = z.strictObject({
  provider: z.enum(['openai-compatible', 'codex-subscription']),
  baseURL: z.string().url().max(2048).optional(),
  accountProfileId: z.string().min(8).max(160).optional(),
  modelId: z.string().min(1).max(500),
  contextLimit: z.number().int().min(4096).max(1000000),
  maxOutputTokens: z.number().int().min(128).max(32768),
  turnTimeoutMs: z.number().int().min(5000).max(60000),
  streaming: z.boolean(),
  structuredMode: z.enum(['native-tools', 'json']),
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']),
  temperature: z.number().min(0).max(2),
  promptCache: z.boolean(),
  concurrency: z.number().int().min(1).max(3),
  inheritedFrom: z.enum(['planner']).optional()
}).superRefine((value, context) => {
  if (value.provider === 'openai-compatible' && !value.baseURL) context.addIssue({ code: 'custom', path: ['baseURL'], message: 'OpenAI-compatible profiles require baseURL' })
  if (value.provider === 'codex-subscription' && !value.accountProfileId) context.addIssue({ code: 'custom', path: ['accountProfileId'], message: 'Codex profiles require accountProfileId' })
})

const AgentModelProfilesSchema = z.strictObject({
  fast: AgentModelProfileSchema.optional(),
  planner: AgentModelProfileSchema,
  summarizer: AgentModelProfileSchema
})

const CapabilityReportSnapshotSchema = z.strictObject({
  level: z.enum(['automatic', 'limited', 'unavailable']),
  profileHash: z.string().min(8).max(128),
  checkedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  expired: z.boolean()
})

function normalizeAgentModelProfiles (config = {}) {
  const provider = config.aiBackendType === 'codex_subscription' ? 'codex-subscription' : 'openai-compatible'
  const plannerModel = stringValue(config.agentPlannerModel) || stringValue(config.modelAI) || (provider === 'codex-subscription' ? 'codex-default' : 'default-model')
  const common = {
    provider,
    ...(provider === 'codex-subscription'
      ? { accountProfileId: stringValue(config.codexProfileId) }
      : { baseURL: validUrl(config.baseURLAI) }),
    contextLimit: boundedInteger(config.agentMaxContextTokens, 32000, 4096, 1000000),
    maxOutputTokens: boundedInteger(config.agentMaxOutputTokens, 2048, 128, 32768),
    turnTimeoutMs: boundedInteger(config.agentModelTimeoutMs, 30000, 5000, 60000),
    streaming: config.agentStreamingEnabled !== false,
    structuredMode: config.agentStructuredMode === 'json' ? 'json' : 'native-tools',
    reasoningEffort: ['minimal', 'low', 'medium', 'high'].includes(config.agentReasoningEffort) ? config.agentReasoningEffort : 'medium',
    temperature: boundedNumber(config.agentTemperature, 0.2, 0, 2),
    promptCache: config.agentPromptCacheEnabled !== false,
    concurrency: 1
  }
  const planner = { ...common, modelId: plannerModel }
  const fastModel = stringValue(config.agentFastModel)
  const summarizerModel = stringValue(config.agentSummarizerModel)
  return AgentModelProfilesSchema.parse({
    ...(fastModel ? { fast: { ...common, modelId: fastModel } } : {}),
    planner,
    summarizer: { ...common, modelId: summarizerModel || plannerModel, inheritedFrom: summarizerModel ? undefined : 'planner' }
  })
}

function boundedInteger (value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback
}

function boundedNumber (value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(parsed, maximum)) : fallback
}

function stringValue (value) {
  const result = String(value || '').trim()
  return result || undefined
}

function validUrl (value) {
  try { return new URL(String(value || '')).toString() } catch (_) { return 'https://invalid.local/' }
}

module.exports = { AgentModelProfileSchema, AgentModelProfilesSchema, CapabilityReportSnapshotSchema, normalizeAgentModelProfiles, boundedInteger, boundedNumber }
