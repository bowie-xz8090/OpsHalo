const { z } = require('zod')
const { IdSchema, IsoDateSchema } = require('./shared')
const { PlannerDecisionSchema } = require('./harness-schema')

const ProviderTypeSchema = z.enum(['openai-compatible', 'codex-subscription', 'strands'])
const ProviderPhaseSchema = z.enum(['connecting', 'authenticating', 'preparing', 'thinking', 'responding', 'degraded'])

const SafeProviderErrorSchema = z.strictObject({
  code: z.string().min(1).max(120),
  category: z.string().min(1).max(120),
  retryable: z.boolean(),
  safeMessage: z.string().min(1).max(2000)
})

const ProviderEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('phase'), phase: ProviderPhaseSchema, safeMessage: z.string().min(1).max(200), code: z.string().max(120).optional() }),
  z.strictObject({ type: z.literal('text.delta'), delta: z.string().min(1).max(8192) }),
  z.strictObject({ type: z.literal('decision.delta'), field: z.string().min(1).max(120), delta: z.string().max(8192) }),
  z.strictObject({ type: z.literal('decision.completed'), decision: PlannerDecisionSchema }),
  z.strictObject({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cachedTokens: z.number().int().nonnegative().optional()
  }),
  z.strictObject({ type: z.literal('completed'), finishReason: z.string().min(1).max(120), providerRequestId: z.string().max(256).optional() }),
  z.strictObject({ type: z.literal('error'), error: SafeProviderErrorSchema })
])

const AgentProviderSessionMetadataSchema = z.strictObject({
  sessionId: IdSchema,
  taskId: IdSchema,
  providerType: ProviderTypeSchema,
  capabilitySnapshotId: IdSchema,
  createdAt: IsoDateSchema,
  lastUsedAt: IsoDateSchema,
  activeTurns: z.number().int().min(0).max(1),
  rebuildCount: z.number().int().min(0).max(1),
  closedAt: IsoDateSchema.optional(),
  closeReason: z.enum(['completed', 'cancelled', 'failed', 'expired', 'shutdown']).optional()
})

module.exports = {
  ProviderTypeSchema,
  ProviderPhaseSchema,
  SafeProviderErrorSchema,
  ProviderEventSchema,
  AgentProviderSessionMetadataSchema
}
