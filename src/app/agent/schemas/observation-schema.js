const { z } = require('zod')
const { ExecutionStatusSchema } = require('./enums')
const { VersionSchema, IdSchema, IsoDateSchema, AgentErrorSchema } = require('./shared')

const FactRecordSchema = z.strictObject({
  factId: IdSchema,
  statement: z.string().min(1).max(2000),
  confidence: z.enum(['observed', 'corroborated', 'inferred']),
  evidenceRefs: z.array(z.string().max(1000)).min(1).max(50),
  sourceInvocationIds: z.array(IdSchema).min(1).max(50),
  firstObservedAt: IsoDateSchema,
  lastConfirmedAt: IsoDateSchema,
  supersedesFactId: IdSchema.optional()
})

const ExtractedFactSchema = z.strictObject({
  statement: z.string().min(1).max(2000),
  confidence: z.enum(['observed', 'inferred']),
  evidenceRef: z.string().min(1).max(1000),
  sourcePath: z.string().max(1000).optional()
})

const ObservationSchema = z.strictObject({
  schemaVersion: VersionSchema,
  observationId: IdSchema,
  invocationId: IdSchema,
  status: ExecutionStatusSchema,
  exitCode: z.number().int().nullable(),
  summary: z.string().max(1200),
  facts: z.array(ExtractedFactSchema).max(100),
  resultView: z.strictObject({
    kind: z.enum(['list', 'record']),
    columns: z.array(z.string().max(120)).max(30),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(50),
    totalScanned: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
    query: z.string().max(200).optional(),
    partial: z.boolean(),
    displayTruncated: z.boolean().optional()
  }).optional(),
  errors: z.array(AgentErrorSchema).max(50),
  sample: z.array(z.strictObject({
    stream: z.enum(['stdout', 'stderr', 'tool']),
    text: z.string().max(8192),
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
    priority: z.enum(['error', 'verification', 'boundary', 'ordinary'])
  })).max(100),
  truncated: z.boolean(),
  omittedBytes: z.number().int().nonnegative(),
  omittedLines: z.number().int().nonnegative().optional(),
  untrustedContent: z.literal(true),
  evidenceRefs: z.array(z.string().max(1000)).max(100),
  adaptationHints: z.array(z.strictObject({
    code: z.string().min(1).max(120),
    suggestedTool: z.string().max(128).optional(),
    suggestedArgumentChanges: z.record(z.string(), z.unknown()).optional(),
    message: z.string().max(1000)
  })).max(20)
})

const EvidenceRecordSchema = z.strictObject({
  schemaVersion: VersionSchema,
  evidenceId: IdSchema,
  taskId: IdSchema,
  invocationId: IdSchema,
  kind: z.enum(['command_output', 'tool_result', 'snapshot', 'config_excerpt', 'verification']),
  mediaType: z.enum(['text/plain', 'application/json']),
  redactionSummary: z.strictObject({
    count: z.number().int().nonnegative(),
    types: z.array(z.string().max(120)).max(100),
    failedClosedChunks: z.number().int().nonnegative()
  }),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
  compressedByteLength: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  relativePath: z.string().min(1).max(2048)
})

module.exports = { FactRecordSchema, ObservationSchema, EvidenceRecordSchema }
