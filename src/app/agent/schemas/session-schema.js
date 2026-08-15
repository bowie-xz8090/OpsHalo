const { z } = require('zod')
const { SessionStatusSchema } = require('./enums')
const {
  VersionSchema, IdSchema, IsoDateSchema, AgentErrorSchema,
  ApprovalDisplaySchema, CompletionCriterionSchema, ChangeRecordSchema
} = require('./shared')
const { HarnessSelectionSchema } = require('./harness-schema')
const { FactRecordSchema, ObservationSchema } = require('./observation-schema')
const { FinalResultSchema, VerificationOutcomeSchema } = require('./verification-schema')

const AgentStartRequestSchema = z.strictObject({
  schemaVersion: VersionSchema,
  clientRequestId: IdSchema,
  tabId: z.string().min(1).max(256),
  prompt: z.string().trim().min(1).max(8000),
  mode: z.enum(['query', 'diagnose', 'operate']),
  parentTaskId: IdSchema.optional(),
  conversationId: z.string().max(256).optional(),
  uiLocale: z.string().min(2).max(32)
})

const ApprovalDecisionSchema = z.strictObject({
  approvalRequestId: IdSchema,
  choice: z.enum(['approve_once', 'approve_task_exact_match', 'reject', 'cancel_task']),
  intentDigest: z.string().length(64),
  decidedAt: IsoDateSchema
})

const AgentControlRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('pause') }),
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('resume') }),
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('cancel'), reason: z.string().max(1000).optional() }),
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('submit_user_input'), requestId: IdSchema, value: z.string().max(4000) }),
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('revise_approval'), approvalRequestId: IdSchema, intentDigest: z.string().length(64), revisedCommand: z.string().trim().min(1).max(8000) }),
  z.strictObject({ schemaVersion: VersionSchema, taskId: IdSchema, expectedSnapshotVersion: z.number().int().nonnegative(), action: z.literal('resolve_approval'), decision: ApprovalDecisionSchema })
])

const SessionBindingSchema = z.strictObject({
  tabId: z.string().min(1).max(256),
  connectionId: z.string().min(1).max(512),
  sessionPid: z.string().min(1).max(256),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65535),
  hostKeyFingerprint: z.string().max(512).optional(),
  username: z.string().min(1).max(256),
  cwd: z.string().min(1).max(4096),
  shell: z.string().min(1).max(256),
  platform: z.literal('linux'),
  bindingConfidence: z.enum(['strong', 'reduced']),
  capturedAt: IsoDateSchema
})

const BudgetStateSchema = z.strictObject({
  maxReactSteps: z.number().int().min(1).max(20),
  hardMaxReactSteps: z.literal(20),
  usedReactSteps: z.number().int().nonnegative().max(20),
  maxAutoReadActions: z.number().int().nonnegative().max(20),
  usedAutoReadActions: z.number().int().nonnegative().max(20),
  maxEquivalentActionRepeats: z.number().int().min(1).max(10),
  maxConsecutiveErrors: z.number().int().min(1).max(10),
  consecutiveErrors: z.number().int().nonnegative().max(100),
  taskDeadlineAt: IsoDateSchema,
  approvedLongDeadlineAt: IsoDateSchema.optional(),
  modelInputTokens: z.number().int().nonnegative().optional(),
  modelOutputTokens: z.number().int().nonnegative().optional(),
  capturedOutputBytes: z.number().int().nonnegative()
})

const WorkingMemorySchema = z.strictObject({
  objective: z.string().min(1).max(8000),
  scope: z.array(z.string().max(1000)).max(100),
  completionCriteria: z.array(CompletionCriterionSchema).max(50),
  planSummary: z.string().max(500),
  reasonSummary: z.string().max(300).optional(),
  facts: z.array(FactRecordSchema).max(500),
  hypotheses: z.array(z.record(z.string(), z.unknown())).max(200),
  missingInformation: z.array(z.string().max(1000)).max(100),
  recentObservationIds: z.array(IdSchema).max(4),
  changeRecords: z.array(ChangeRecordSchema).max(100),
  verificationObligations: z.array(z.record(z.string(), z.unknown())).max(100),
  contradictions: z.array(z.record(z.string(), z.unknown())).max(100)
})

const ApprovalRequestSchema = z.strictObject({
  schemaVersion: VersionSchema,
  approvalRequestId: IdSchema,
  taskId: IdSchema,
  invocationId: IdSchema,
  intentDigest: z.string().length(64),
  policyDecisionId: IdSchema,
  sessionFingerprint: z.string().length(64),
  display: ApprovalDisplaySchema,
  allowedDecisions: z.array(z.enum(['approve_once', 'approve_task_exact_match', 'reject', 'cancel_task'])).min(1).max(4),
  expiresAt: IsoDateSchema
})

const AgentSessionRecordSchema = z.strictObject({
  schemaVersion: VersionSchema,
  taskId: IdSchema,
  ownerWindowId: z.number().int().nonnegative(),
  parentTaskId: IdSchema.optional(),
  conversationId: z.string().max(256).optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  status: SessionStatusSchema,
  statusReason: z.strictObject({ code: z.string().max(120), safeMessage: z.string().max(2000), recoverable: z.boolean() }).optional(),
  snapshotVersion: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().nonnegative(),
  featurePolicyVersion: z.string().min(1).max(100),
  sessionBinding: SessionBindingSchema,
  mode: z.enum(['query', 'diagnose', 'operate']),
  prompt: z.string().min(1).max(8000),
  uiLocale: z.string().min(2).max(32).optional(),
  harness: HarnessSelectionSchema,
  harnessActivity: z.strictObject({
    phase: z.enum(['connecting', 'authenticating', 'preparing', 'thinking', 'responding']),
    message: z.string().min(1).max(200),
    updatedAt: IsoDateSchema
  }).optional(),
  budget: BudgetStateSchema,
  memory: WorkingMemorySchema,
  latestObservation: ObservationSchema.optional(),
  currentInvocation: z.record(z.string(), z.unknown()).optional(),
  pendingApproval: ApprovalRequestSchema.optional(),
  pendingUserInput: z.record(z.string(), z.unknown()).optional(),
  verification: z.strictObject({ outcomes: z.array(VerificationOutcomeSchema).max(100) }).optional(),
  finalResult: FinalResultSchema.optional(),
  evidenceRefs: z.array(z.string().max(1000)).max(500),
  recentErrors: z.array(AgentErrorSchema).max(20)
})

module.exports = {
  AgentStartRequestSchema,
  ApprovalDecisionSchema,
  AgentControlRequestSchema,
  SessionBindingSchema,
  BudgetStateSchema,
  WorkingMemorySchema,
  ApprovalRequestSchema,
  AgentSessionRecordSchema
}
