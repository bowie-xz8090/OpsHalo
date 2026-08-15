const { z } = require('zod')
const {
  RiskLevelSchema,
  SensitivitySchema,
  CostLevelSchema,
  ExecutionStatusSchema,
  ErrorCategorySchema
} = require('./enums')

const VersionSchema = z.literal(1)
const IdSchema = z.string().min(8).max(160).regex(/^[A-Za-z0-9_-]+$/)
const IsoDateSchema = z.string().datetime({ offset: true })
const JsonValueSchema = z.json()
const JsonObjectSchema = z.record(z.string(), JsonValueSchema)

const ResourceTargetSchema = z.strictObject({
  kind: z.enum(['session', 'host', 'process', 'port', 'file', 'service', 'container', 'mcp_resource']),
  canonicalId: z.string().min(1).max(2048),
  display: z.string().min(1).max(2048)
})

const PolicyReasonSchema = z.strictObject({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(1000),
  source: z.enum(['tool_floor', 'shell_analysis', 'sensitivity', 'cost', 'builtin_rule', 'user_policy', 'model_hint'])
})

const AgentErrorSchema = z.strictObject({
  schemaVersion: VersionSchema,
  code: z.string().min(1).max(120),
  category: ErrorCategorySchema,
  source: z.enum(['harness', 'gateway', 'policy', 'approval', 'executor', 'observation', 'verification']),
  retryable: z.boolean(),
  safeMessage: z.string().min(1).max(2000),
  safeDetails: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  evidenceRef: z.string().max(1000).optional(),
  occurredAt: IsoDateSchema
})

const CompletionCriterionSchema = z.strictObject({
  criterionId: IdSchema,
  statement: z.string().min(1).max(1000),
  critical: z.boolean(),
  status: z.enum(['pending', 'passed', 'failed', 'inconclusive']),
  evidenceRefs: z.array(z.string().max(1000)).max(50)
})

const ChangeRecordSchema = z.strictObject({
  invocationId: IdSchema,
  intentDigest: z.string().length(64),
  resource: ResourceTargetSchema,
  expectedEffect: z.string().max(2000),
  actualStatus: ExecutionStatusSchema,
  approvalRequestId: IdSchema,
  verificationPlanId: IdSchema,
  verificationStatus: z.enum(['pending', 'passed', 'failed', 'partial', 'inconclusive']),
  evidenceRefs: z.array(z.string().max(1000)).max(50)
})

const ApprovalDisplaySchema = z.strictObject({
  approvalRequestId: IdSchema,
  risk: RiskLevelSchema,
  sensitivity: SensitivitySchema,
  cost: CostLevelSchema,
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(256),
  cwd: z.string().min(1).max(4096),
  toolName: z.string().min(1).max(256),
  fullCommandOrArguments: z.string().min(1).max(16000),
  affectedResources: z.array(z.string().max(2048)).max(50),
  privilegeAndInteraction: z.array(z.string().max(500)).max(20),
  timeoutMs: z.number().int().positive().max(900000),
  expectedEffect: z.string().max(2000),
  riskReasons: z.array(z.string().max(1000)).max(50),
  prechecks: z.array(z.string().max(1000)).max(30),
  verificationChecks: z.array(z.string().max(1000)).max(30),
  rollbackSummary: z.string().max(2000).optional(),
  expiresAt: IsoDateSchema
})

function toJsonSchema (schema, name) {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input', reused: 'ref', name })
}

function toStructuredOutputJsonSchema (schema, name) {
  return pruneStructuredOutputSchema(toJsonSchema(schema, name))
}

function pruneStructuredOutputSchema (value) {
  if (Array.isArray(value)) return value.map(pruneStructuredOutputSchema)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'propertyNames') continue
    result[key] = pruneStructuredOutputSchema(child)
  }
  return result
}

module.exports = {
  VersionSchema,
  IdSchema,
  IsoDateSchema,
  JsonValueSchema,
  JsonObjectSchema,
  ResourceTargetSchema,
  PolicyReasonSchema,
  AgentErrorSchema,
  CompletionCriterionSchema,
  ChangeRecordSchema,
  ApprovalDisplaySchema,
  toJsonSchema,
  toStructuredOutputJsonSchema,
  pruneStructuredOutputSchema
}
