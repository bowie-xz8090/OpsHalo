const { z } = require('zod')
const { IdSchema, IsoDateSchema } = require('./shared')

const ExecutionChunkSchema = z.strictObject({
  invocationId: IdSchema,
  stream: z.enum(['stdout', 'stderr']),
  sequence: z.number().int().positive(),
  receivedAt: IsoDateSchema,
  bytes: z.instanceof(Uint8Array)
})

const SafeExecutionProgressSchema = z.strictObject({
  invocationId: IdSchema,
  stdoutBytes: z.number().int().nonnegative(),
  stderrBytes: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  silentForMs: z.number().int().nonnegative(),
  safeLastLine: z.string().max(512).optional(),
  truncated: z.boolean(),
  source: z.enum(['output', 'timer'])
})

module.exports = { ExecutionChunkSchema, SafeExecutionProgressSchema }
