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
  readProbeBundleJson: NullableStringSchema.optional(),
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
    readProbeBundleJson: nullable({
      type: 'string',
      description: 'Optional JSON array of 2-3 independent parallel-safe structured read actions. Each item contains toolName, arguments, target, purpose, and expectedObservation.'
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
    'readProbeBundleJson',
    'completionCriteria',
    'userQuestion'
  ],
  additionalProperties: false
})

// Native tool-capable models only choose the next action. Trusted envelope IDs,
// completion criteria, and evidence links are reconstructed locally.
const ActionSelectionJsonSchema = Object.freeze({
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['act', 'answer', 'ask', 'block'] },
    summary: { type: 'string', description: 'Brief user-visible plan or answer.' },
    toolName: nullable({ type: 'string' }),
    argumentsJson: nullable({ type: 'string', description: 'JSON object containing arguments for the selected public tool.' }),
    targetKind: nullable({ type: 'string', enum: ['session', 'host', 'process', 'port', 'file', 'service', 'container', 'mcp_resource'] }),
    targetId: nullable({ type: 'string' }),
    targetDisplay: nullable({ type: 'string' }),
    expectedObservation: nullable({ type: 'string' }),
    verificationPlanJson: nullable({ type: 'string', description: 'Required for mutating actions; otherwise null.' }),
    readProbeBundleJson: nullable({ type: 'string', description: 'Optional JSON array of 2-3 independent structured read actions. Use only tools marked parallelSafe.' }),
    message: nullable({ type: 'string', description: 'Direct answer, user question, or blocking reason.' })
  },
  required: ['outcome', 'summary', 'toolName', 'argumentsJson', 'targetKind', 'targetId', 'targetDisplay', 'expectedObservation', 'verificationPlanJson', 'message'],
  additionalProperties: false
})

const PLANNER_OUTPUT_MAPPING_INSTRUCTIONS = [
  'The required output is a transport-safe PlannerDecision representation.',
  'Every schema field must be present. Use null for expectedObservation, action, requestedTimeoutMs, verificationPlanJson, or userQuestion when it is not applicable.',
  'When goalStatus is continue, action must be non-null and argumentsJson must be a JSON string encoding exactly one object of arguments for the selected public tool.',
  'Alternatively, continue may use readProbeBundleJson with action=null. The JSON string must encode 2-3 independent structured read actions whose catalog entries are parallelSafe; never include Shell, mutation, network, interactive, or dependent actions.',
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
  if (value && typeof value === 'object' && value.outcome) return decodeActionSelection(value, input)
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
  if (wire.readProbeBundleJson) decision.readProbeBundle = decodeReadProbeBundle(wire.readProbeBundleJson, input)
  return PlannerDecisionSchema.parse(decision)
}

function decodeActionSelection (value, input = {}) {
  const facts = Array.isArray(input.workingMemory?.facts) ? input.workingMemory.facts : []
  const knownFactIds = facts.map(fact => fact.factId).filter(Boolean).slice(0, 100)
  const criteria = Array.isArray(input.workingMemory?.completionCriteria) ? input.workingMemory.completionCriteria : []
  const summary = String(value.summary || value.message || '处理当前请求').slice(0, 500)
  const base = {
    schemaVersion: 1,
    planSummary: summary,
    reasonSummary: String(value.message || summary).slice(0, 300),
    knownFactIds,
    missingInformation: [],
    completionCriteria: criteria
  }
  if (value.outcome === 'answer') return PlannerDecisionSchema.parse({ ...base, goalStatus: 'complete' })
  if (value.outcome === 'ask') {
    const question = String(value.message || summary).slice(0, 1000)
    return PlannerDecisionSchema.parse({ ...base, goalStatus: 'need_user', missingInformation: [question], userQuestion: question })
  }
  if (value.outcome === 'block') return PlannerDecisionSchema.parse({ ...base, goalStatus: 'blocked' })
  if (value.outcome !== 'act') throw protocolError('outcome must be act, answer, ask, or block')
  if (value.readProbeBundleJson) {
    const readProbeBundle = decodeReadProbeBundle(value.readProbeBundleJson, input)
    const expected = readProbeBundle.actions.map(item => item.intent.expectedObservation).join('；').slice(0, 1000)
    return PlannerDecisionSchema.parse({
      ...base,
      goalStatus: 'continue',
      missingInformation: [expected],
      expectedObservation: expected,
      readProbeBundle
    })
  }
  const toolName = requireSelectionString(value.toolName, 'toolName')
  const expectedObservation = requireSelectionString(value.expectedObservation, 'expectedObservation')
  const targetKind = requireSelectionString(value.targetKind, 'targetKind')
  const targetId = requireSelectionString(value.targetId, 'targetId')
  const targetDisplay = requireSelectionString(value.targetDisplay, 'targetDisplay')
  const descriptor = (input.availableTools || []).find(item => item.name === toolName)
  if (!descriptor) throw protocolError(`toolName is not in the public catalog: ${toolName}`)
  const criterionId = `criterion_${crypto.createHash('sha256').update(`${input.taskId}:${summary}:${expectedObservation}`).digest('hex').slice(0, 20)}`
  const action = {
    schemaVersion: 1,
    invocationId: `invocation_${crypto.randomBytes(18).toString('base64url')}`,
    taskId: input.taskId,
    toolName,
    toolVersion: String(descriptor.version || '1'),
    arguments: parseJsonObject(requireSelectionString(value.argumentsJson, 'argumentsJson'), 'argumentsJson'),
    target: { kind: targetKind, canonicalId: targetId, display: targetDisplay },
    purpose: summary,
    expectedObservation
  }
  if (value.verificationPlanJson !== null && value.verificationPlanJson !== undefined) {
    action.verificationPlan = parseJsonObject(requireSelectionString(value.verificationPlanJson, 'verificationPlanJson'), 'verificationPlanJson')
  }
  return PlannerDecisionSchema.parse({
    ...base,
    goalStatus: 'continue',
    missingInformation: [expectedObservation],
    expectedObservation,
    completionCriteria: criteria.length ? criteria : [{ criterionId, statement: expectedObservation, critical: true, status: 'pending', evidenceRefs: [] }],
    action
  })
}

function decodeReadProbeBundle (raw, input = {}) {
  const parsed = parseJsonValue(raw, 'readProbeBundleJson')
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 3) throw protocolError('readProbeBundleJson must encode 2-3 actions')
  const actions = parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError(`readProbeBundleJson[${index}] must be an object`)
    const descriptor = (input.availableTools || []).find(item => item.name === value.toolName)
    if (!descriptor) throw protocolError(`bundle toolName is not in the public catalog: ${value.toolName}`)
    if (descriptor.parallelSafe !== true || descriptor.mutability !== 'none' || !['context', 'probe', 'read'].includes(descriptor.category)) {
      throw protocolError(`bundle tool is not parallel-safe: ${value.toolName}`)
    }
    return {
      intent: {
        schemaVersion: 1,
        invocationId: `invocation_${crypto.randomBytes(18).toString('base64url')}`,
        taskId: input.taskId,
        toolName: value.toolName,
        toolVersion: String(descriptor.version || '1'),
        arguments: value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments) ? value.arguments : {},
        target: value.target,
        purpose: String(value.purpose || value.expectedObservation || `read probe ${index + 1}`).slice(0, 1000),
        expectedObservation: String(value.expectedObservation || value.purpose || `probe ${index + 1} result`).slice(0, 1000)
      },
      dependsOn: []
    }
  })
  return {
    schemaVersion: 1,
    bundleId: `bundle_${crypto.randomBytes(18).toString('base64url')}`,
    actions
  }
}

function requireSelectionString (value, field) {
  if (typeof value !== 'string' || !value.trim()) throw protocolError(`${field} must be a non-empty string`)
  return value.trim()
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

function parseJsonValue (value, field) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64 * 1024) throw protocolError(`${field} exceeds the 64 KiB transport limit`)
  try { return JSON.parse(value) } catch (_) { throw protocolError(`${field} is not valid JSON`) }
}

function protocolError (message) {
  const error = new Error(message)
  error.code = 'AGENT_INVALID_MODEL_OUTPUT'
  return error
}

module.exports = {
  PlannerDecisionWireSchema,
  PlannerOutputJsonSchema,
  ActionSelectionJsonSchema,
  PLANNER_OUTPUT_MAPPING_INSTRUCTIONS,
  decodePlannerDecision,
  decodeReadProbeBundle,
  decodeActionSelection,
  parsePlannerDecision,
  parseJsonObject
}
