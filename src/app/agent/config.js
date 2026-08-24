const path = require('path')
const { normalizeRuntimeV2Flags } = require('./rollout/feature-rollout')

const SCHEMA_VERSION = 1
const POLICY_VERSION = 'agent-policy-v1'

const defaults = Object.freeze({
  maxReactSteps: 12,
  hardMaxReactSteps: 20,
  maxAutoReadActions: 8,
  maxEquivalentActionRepeats: 2,
  maxConsecutiveErrors: 3,
  taskTimeoutMs: 5 * 60 * 1000,
  approvedLongTaskMaxMs: 15 * 60 * 1000,
  modelObservationBytes: 6 * 1024,
  modelObservationHardMaxBytes: 8 * 1024,
  maxRawCaptureBytes: 2 * 1024 * 1024,
  maxCaptureMemoryBytes: 256 * 1024,
  captureHeadBytes: 32 * 1024,
  captureTailBytes: 64 * 1024,
  evidenceQuotaBytes: 10 * 1024 * 1024,
  evidenceRetentionHours: 24,
  sessionRetentionDays: 7,
  sessionQuotaBytes: 20 * 1024 * 1024,
  auditRetentionDays: 30,
  auditQuotaBytes: 50 * 1024 * 1024,
  approvalTtlMs: 10 * 60 * 1000,
  capabilityTtlMs: 60 * 1000,
  eventReplayLimit: 200,
  promptMaxChars: 8000,
  userInputMaxChars: 4000,
  evidenceChunkMaxBytes: 64 * 1024
})

function runtimeRoot (userDataPath) {
  return path.join(userDataPath, 'agent-runtime', `v${SCHEMA_VERSION}`)
}

function codexAccountsRoot (userDataPath) {
  return path.join(userDataPath, 'ai-accounts', 'codex', `v${SCHEMA_VERSION}`)
}

function codexRuntimeRoot (userDataPath) {
  return path.join(userDataPath, 'agent', 'codex-runtime')
}

function normalizeAiBackendSelection (config = {}) {
  const type = config.aiBackendType === 'codex_subscription'
    ? 'codex_subscription'
    : 'openai_compatible'
  return {
    schemaVersion: SCHEMA_VERSION,
    type,
    codexProfileId: type === 'codex_subscription' && typeof config.codexProfileId === 'string' && config.codexProfileId.trim()
      ? config.codexProfileId.trim()
      : undefined
  }
}

function normalizeFeatureFlags (config = {}) {
  const agentModeEnabled = config.agentModeEnabled === true
  const runtimeV2 = normalizeRuntimeV2Flags(config)
  return {
    ...runtimeV2,
    agentModeEnabled,
    agentMutationEnabled: agentModeEnabled && config.agentMutationEnabled === true,
    agentExternalMcpEnabled: agentModeEnabled && config.agentExternalMcpEnabled === true,
    agentGroundedSynthesisEnabled: agentModeEnabled && runtimeV2.agentGroundedFinalSynthesisV2 && config.agentGroundedSynthesisEnabled !== false,
    agentSkillsEnabled: agentModeEnabled && runtimeV2.agentSkillsV2 && config.agentSkillsEnabled !== false,
    agentKnowledgeEnabled: agentModeEnabled && runtimeV2.agentKnowledgeBaseV2 && config.agentKnowledgeEnabled === true
  }
}

module.exports = {
  SCHEMA_VERSION,
  POLICY_VERSION,
  defaults,
  runtimeRoot,
  codexAccountsRoot,
  codexRuntimeRoot,
  normalizeAiBackendSelection,
  normalizeFeatureFlags
}
