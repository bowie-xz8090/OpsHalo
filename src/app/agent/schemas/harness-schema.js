const { z } = require('zod')
const { GoalStatusSchema } = require('./enums')
const {
  VersionSchema, IdSchema, CompletionCriterionSchema
} = require('./shared')
const { ToolIntentSchema } = require('./tool-schema')
const { ObservationSchema } = require('./observation-schema')

const PlannerDecisionSchema = z.strictObject({
  schemaVersion: VersionSchema,
  goalStatus: GoalStatusSchema,
  planSummary: z.string().max(500),
  reasonSummary: z.string().max(300),
  knownFactIds: z.array(IdSchema).max(200),
  missingInformation: z.array(z.string().max(1000)).max(10),
  expectedObservation: z.string().max(1000).optional(),
  action: ToolIntentSchema.optional(),
  completionCriteria: z.array(CompletionCriterionSchema).max(50),
  userQuestion: z.string().max(1000).optional()
}).superRefine((value, ctx) => {
  if (value.goalStatus === 'continue' && !value.action) {
    ctx.addIssue({ code: 'custom', path: ['action'], message: 'continue requires exactly one action' })
  }
  if (value.goalStatus !== 'continue' && value.action) {
    ctx.addIssue({ code: 'custom', path: ['action'], message: 'only continue may include an action' })
  }
  if (value.goalStatus === 'need_user' && !value.userQuestion) {
    ctx.addIssue({ code: 'custom', path: ['userQuestion'], message: 'need_user requires a question' })
  }
})

const HarnessSelectionSchema = z.strictObject({
  adapter: z.enum(['strands', 'openai_compatible', 'strict_json', 'codex_app_server']),
  modelId: z.string().min(1).max(500),
  providerId: z.string().min(1).max(500),
  profileId: IdSchema.optional(),
  supportsNativeTools: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  maxContextTokens: z.number().int().positive().max(10000000)
})

const AgentTurnInputSchema = z.strictObject({
  schemaVersion: VersionSchema,
  taskId: IdSchema,
  objective: z.string().min(1).max(8000),
  mode: z.enum(['query', 'diagnose', 'operate']),
  uiLocale: z.string().min(2).max(32).optional(),
  sessionSummary: z.strictObject({
    host: z.string().max(512),
    username: z.string().max(256),
    cwd: z.string().max(4096),
    shell: z.string().max(256),
    platform: z.literal('linux')
  }),
  workingMemory: z.record(z.string(), z.unknown()),
  budgetRemaining: z.record(z.string(), z.number()),
  availableTools: z.array(z.record(z.string(), z.unknown())).max(100),
  latestObservation: ObservationSchema.optional()
})

const HarnessEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('status'), phase: z.enum(['connecting', 'authenticating', 'preparing', 'thinking', 'responding']), message: z.string().min(1).max(200) }),
  z.strictObject({ type: z.literal('text_delta'), text: z.string().max(8192) }),
  z.strictObject({ type: z.literal('decision_delta'), partial: z.unknown() }),
  z.strictObject({ type: z.literal('decision'), decision: PlannerDecisionSchema }),
  z.strictObject({ type: z.literal('usage'), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('provider_warning'), code: z.string().max(120), message: z.string().max(1000) })
])

module.exports = {
  PlannerDecisionSchema,
  HarnessSelectionSchema,
  AgentTurnInputSchema,
  HarnessEventSchema
}
