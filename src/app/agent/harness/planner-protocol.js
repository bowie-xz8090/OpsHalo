const crypto = require('crypto')
const { z } = require('zod')
const { PlannerDecisionSchema } = require('../schemas/harness-schema')

const NullableStringSchema = z.string().nullable()

const PlannerDecisionWireSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goalStatus: z.enum(['continue', 'verify', 'complete', 'need_user', 'blocked']),
  planSummary: z.string(),
  reasonSummary: z.string(),
  knownFactIds: z.array(z.string()),
  missingInformation: z.array(z.string()),
  expectedObservation: NullableStringSchema,
  action: z.strictObject({
    toolName: z.string(),
    toolVersion: z.string(),
    argumentsJson: z.string(),
    target: z.strictObject({
      kind: z.enum(['session', 'host', 'process', 'port', 'file', 'service', 'container', 'mcp_resource']),
      canonicalId: z.string(),
      display: z.string()
    }),
    requestedTimeoutMs: z.number().int().positive().nullable(),
    purpose: z.string(),
    expectedObservation: z.string(),
    verificationPlanJson: z.string().nullable()
  }).nullable(),
  completionCriteria: z.array(z.strictObject({
    criterionId: z.string(),
    statement: z.string(),
    critical: z.boolean(),
    status: z.enum(['pending', 'passed', 'failed', 'inconclusive']),
    evidenceRefs: z.array(z.string())
  })),
  userQuestion: NullableStringSchema
})

const PlannerOutputJsonSchema = Object.freeze({
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    goalStatus: { type: 'string', enum: ['continue', 'verify', 'complete', 'need_user', 'blocked'] },
    planSummary: { type: 'string' },
    reasonSummary: { type: 'string' },
    knownFactIds: { type: 'array', items: { type: 'string' } },
    missingInformation: { type: 'array', items: { type: 'string' } },
    expectedObservation: nullable({ type: 'string' }),
    action: nullable({
      type: 'object',
      properties: {
        toolName: { type: 'string' },
        toolVersion: { type: 'string' },
        argumentsJson: {
          type: 'string',
          description: 'A JSON-encoded object containing only arguments for the selected public tool.'
        },
        target: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['session', 'host', 'process', 'port', 'file', 'service', 'container', 'mcp_resource'] },
            canonicalId: { type: 'string' },
            display: { type: 'string' }
          },
          required: ['kind', 'canonicalId', 'display'],
          additionalProperties: false
        },
        requestedTimeoutMs: nullable({ type: 'integer' }),
        purpose: { type: 'string' },
        expectedObservation: { type: 'string' },
        verificationPlanJson: nullable({
          type: 'string',
          description: 'A JSON-encoded VerificationPlan object for a mutation.'
        })
      },
      required: ['toolName', 'toolVersion', 'argumentsJson', 'target', 'requestedTimeoutMs', 'purpose', 'expectedObservation', 'verificationPlanJson'],
      additionalProperties: false
    }),
    completionCriteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterionId: { type: 'string' },
          statement: { type: 'string' },
          critical: { type: 'boolean' },
          status: { type: 'string', enum: ['pending', 'passed', 'failed', 'inconclusive'] },
          evidenceRefs: { type: 'array', items: { type: 'string' } }
        },
        required: ['criterionId', 'statement', 'critical', 'status', 'evidenceRefs'],
        additionalProperties: false
      }
    },
    userQuestion: nullable({ type: 'string' })
  },
  required: [
    'schemaVersion',
    'goalStatus',
    'planSummary',
    'reasonSummary',
    'knownFactIds',
    'missingInformation',
    'expectedObservation',
    'action',
    'completionCriteria',
    'userQuestion'
  ],
  additionalProperties: false
})

const PLANNER_OUTPUT_MAPPING_INSTRUCTIONS = [
  'The required output is a transport-safe PlannerDecision representation.',
  'Every schema field must be present. Use null for expectedObservation, action, requestedTimeoutMs, verificationPlanJson, or userQuestion when it is not applicable.',
  'When goalStatus is continue, action must be non-null and argumentsJson must be a JSON string encoding exactly one object of arguments for the selected public tool.',
  'For a mutating action, verificationPlanJson must be a JSON string encoding the complete VerificationPlan described by the product contract. For a read-only action, use null unless verification is explicitly needed.',
  'Do not put taskId, invocationId, or schemaVersion inside action. OpsHalo adds those trusted envelope fields after validating this response.',
  'For every other goalStatus, action must be null. For need_user, userQuestion must be a non-empty question.'
].join(' ')

function nullable (schema) {
  return { anyOf: [schema, { type: 'null' }] }
}

function decodePlannerDecision (value, input = {}) {
  const internal = PlannerDecisionSchema.safeParse(value)
  if (internal.success) return internal.data
  const wire = PlannerDecisionWireSchema.parse(value)
  const decision = {
    schemaVersion: 1,
    goalStatus: wire.goalStatus,
    planSummary: wire.planSummary,
    reasonSummary: wire.reasonSummary,
    knownFactIds: wire.knownFactIds,
    missingInformation: wire.missingInformation,
    completionCriteria: wire.completionCriteria
  }
  if (wire.expectedObservation !== null) decision.expectedObservation = wire.expectedObservation
  if (wire.userQuestion !== null) decision.userQuestion = wire.userQuestion
  if (wire.action !== null) {
    decision.action = {
      schemaVersion: 1,
      invocationId: `invocation_${crypto.randomBytes(18).toString('base64url')}`,
      taskId: input.taskId,
      toolName: wire.action.toolName,
      toolVersion: wire.action.toolVersion,
      arguments: parseJsonObject(wire.action.argumentsJson, 'argumentsJson'),
      target: wire.action.target,
      purpose: wire.action.purpose,
      expectedObservation: wire.action.expectedObservation
    }
    if (wire.action.requestedTimeoutMs !== null) decision.action.requestedTimeoutMs = wire.action.requestedTimeoutMs
    if (wire.action.verificationPlanJson !== null) {
      decision.action.verificationPlan = parseJsonObject(wire.action.verificationPlanJson, 'verificationPlanJson')
    }
  }
  return PlannerDecisionSchema.parse(decision)
}

function parsePlannerDecision (raw, input = {}) {
  if (raw && typeof raw === 'object') return decodePlannerDecision(raw, input)
  const text = String(raw || '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const candidate = fenced ? fenced[1] : start >= 0 && end >= start ? text.slice(start, end + 1) : text
  return decodePlannerDecision(JSON.parse(candidate), input)
}

function parseJsonObject (value, field) {
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) throw protocolError(`${field} exceeds the 64 KiB transport limit`)
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (_) {
    throw protocolError(`${field} is not valid JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw protocolError(`${field} must encode one JSON object`)
  return parsed
}

function protocolError (message) {
  const error = new Error(message)
  error.code = 'AGENT_INVALID_MODEL_OUTPUT'
  return error
}

module.exports = {
  PlannerDecisionWireSchema,
  PlannerOutputJsonSchema,
  PLANNER_OUTPUT_MAPPING_INSTRUCTIONS,
  decodePlannerDecision,
  parsePlannerDecision,
  parseJsonObject
}
