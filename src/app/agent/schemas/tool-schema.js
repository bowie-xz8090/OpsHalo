const { z } = require('zod')
const {
  RiskLevelSchema,
  SensitivitySchema,
  CostLevelSchema,
  PolicyOutcomeSchema,
  ExecutionStatusSchema,
  ApprovalScopeSchema
} = require('./enums')
const {
  VersionSchema, IdSchema, IsoDateSchema, JsonObjectSchema,
  ResourceTargetSchema, PolicyReasonSchema, AgentErrorSchema
} = require('./shared')
const { VerificationPlanSchema } = require('./verification-schema')

const ToolDefinitionSchema = z.strictObject({
  schemaVersion: VersionSchema,
  name: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  version: z.string().min(1).max(40),
  description: z.string().min(1).max(2000),
  category: z.enum(['context', 'probe', 'read', 'network', 'change', 'interactive']),
  mutability: z.enum(['none', 'reversible', 'destructive']),
  riskFloor: RiskLevelSchema,
  sensitivityFloor: SensitivitySchema,
  costFloor: CostLevelSchema,
  approval: z.enum(['auto_if_bounded', 'policy', 'always', 'blocked']),
  defaultTimeoutMs: z.number().int().positive().max(900000),
  maxTimeoutMs: z.number().int().positive().max(900000),
  maxRawCaptureBytes: z.number().int().positive().max(16 * 1024 * 1024),
  maxModelOutputBytes: z.number().int().positive().max(8192),
  supportsCancel: z.boolean(),
  supportsDryRun: z.boolean(),
  inputSchema: z.record(z.string(), z.unknown()),
  resultSchema: z.record(z.string(), z.unknown()),
  parserId: z.string().min(1).max(128)
}).superRefine((value, ctx) => {
  if (value.defaultTimeoutMs > value.maxTimeoutMs) {
    ctx.addIssue({ code: 'custom', message: 'default timeout exceeds maximum', path: ['defaultTimeoutMs'] })
  }
})

const ToolIntentSchema = z.strictObject({
  schemaVersion: VersionSchema,
  invocationId: IdSchema,
  taskId: IdSchema,
  toolName: z.string().min(1).max(128),
  toolVersion: z.string().min(1).max(40),
  arguments: JsonObjectSchema,
  target: ResourceTargetSchema,
  requestedTimeoutMs: z.number().int().positive().max(900000).optional(),
  purpose: z.string().min(1).max(1000),
  expectedObservation: z.string().min(1).max(1000),
  verificationPlan: VerificationPlanSchema.optional()
})

const NormalizedIntentSchema = ToolIntentSchema.extend({
  normalizedArguments: JsonObjectSchema,
  redactedDisplay: z.string().min(1).max(16000),
  intentDigest: z.string().length(64),
  commandAnalysis: z.record(z.string(), z.unknown()).optional()
})

const PolicyDecisionSchema = z.strictObject({
  schemaVersion: VersionSchema,
  decisionId: IdSchema,
  taskId: IdSchema,
  invocationId: IdSchema,
  outcome: PolicyOutcomeSchema,
  risk: RiskLevelSchema,
  sensitivity: SensitivitySchema,
  cost: CostLevelSchema,
  reasons: z.array(PolicyReasonSchema).max(100),
  matchedRuleIds: z.array(z.string().max(200)).max(100),
  policyVersion: z.string().min(1).max(100),
  allowedApprovalScopes: z.array(ApprovalScopeSchema).max(2),
  evaluatedAt: IsoDateSchema
})

const ExecutionResultSchema = z.strictObject({
  schemaVersion: VersionSchema,
  invocationId: IdSchema,
  receiptId: IdSchema,
  status: ExecutionStatusSchema,
  mode: z.enum(['exec', 'pty_handoff', 'sftp', 'mcp', 'background']),
  startedAt: IsoDateSchema,
  finishedAt: IsoDateSchema,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  signal: z.string().max(64).nullable(),
  stdoutCapture: z.record(z.string(), z.unknown()),
  stderrCapture: z.record(z.string(), z.unknown()),
  stderrMerged: z.boolean(),
  timedOut: z.boolean(),
  cancelRequested: z.boolean(),
  remoteTermination: z.enum(['confirmed', 'unconfirmed', 'not_applicable']),
  transportError: AgentErrorSchema.optional()
})

module.exports = {
  ToolDefinitionSchema,
  ToolIntentSchema,
  NormalizedIntentSchema,
  PolicyDecisionSchema,
  ExecutionResultSchema
}
