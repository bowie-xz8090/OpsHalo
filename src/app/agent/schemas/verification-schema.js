const { z } = require('zod')
const {
  IdSchema, IsoDateSchema, ResourceTargetSchema,
  CompletionCriterionSchema, ChangeRecordSchema
} = require('./shared')
const { FactRecordSchema } = require('./observation-schema')

const ToolIntentTemplateSchema = z.strictObject({
  toolName: z.string().min(1).max(128),
  arguments: z.record(z.string(), z.unknown()),
  target: ResourceTargetSchema,
  purpose: z.string().min(1).max(1000)
})

const VerificationCheckSchema = z.strictObject({
  checkId: IdSchema,
  description: z.string().min(1).max(1000),
  intent: ToolIntentTemplateSchema,
  predicate: z.strictObject({
    operator: z.enum(['equal', 'match', 'range', 'exists']),
    path: z.string().min(1).max(500),
    expected: z.unknown().optional()
  }),
  critical: z.boolean()
})

const VerificationPlanSchema = z.strictObject({
  planId: IdSchema,
  preconditions: z.array(VerificationCheckSchema).max(50),
  postconditions: z.array(VerificationCheckSchema).max(50),
  successExpression: z.string().min(1).max(2000),
  rollbackIntentTemplate: ToolIntentTemplateSchema.optional()
})

const VerificationOutcomeSchema = z.strictObject({
  planId: IdSchema,
  status: z.enum(['passed', 'failed', 'partial', 'inconclusive']),
  checkResults: z.array(z.strictObject({
    checkId: IdSchema,
    status: z.enum(['passed', 'failed', 'inconclusive']),
    actualSummary: z.string().max(2000),
    evidenceRefs: z.array(z.string().max(1000)).max(50)
  })).max(100),
  evidenceRefs: z.array(z.string().max(1000)).max(100),
  verifiedAt: IsoDateSchema
})

const FinalResultSchema = z.strictObject({
  status: z.enum(['complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'partial']),
  conclusion: z.string().max(5000),
  confirmedFacts: z.array(FactRecordSchema).max(200),
  inferences: z.array(FactRecordSchema).max(200),
  unresolvedItems: z.array(z.string().max(2000)).max(100),
  operations: z.array(ChangeRecordSchema).max(100),
  verificationOutcomes: z.array(VerificationOutcomeSchema).max(100),
  evidenceRefs: z.array(z.string().max(1000)).max(200),
  nextSuggestedProbe: ToolIntentTemplateSchema.optional(),
  completedAt: IsoDateSchema
})

module.exports = {
  CompletionCriterionSchema,
  ToolIntentTemplateSchema,
  VerificationCheckSchema,
  VerificationPlanSchema,
  VerificationOutcomeSchema,
  FinalResultSchema
}
