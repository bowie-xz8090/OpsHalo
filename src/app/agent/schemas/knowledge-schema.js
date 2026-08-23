const { z } = require('zod')
const { IdSchema, IsoDateSchema } = require('./shared')

const KnowledgeCitationSchema = z.strictObject({
  sourceId: IdSchema,
  sourcePath: z.string().min(1).max(4096),
  sourceVersion: z.string().min(8).max(128),
  chunkId: IdSchema,
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  score: z.number().finite(),
  retrievedAt: IsoDateSchema,
  retrievalMode: z.enum(['fts', 'hybrid_rrf']),
  stale: z.boolean()
})

module.exports = { KnowledgeCitationSchema }
