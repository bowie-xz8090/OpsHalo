const { z } = require('zod')
const { AgentEventTypeSchema } = require('./enums')
const { IdSchema, IsoDateSchema } = require('./shared')

const AgentEventVersionSchema = z.union([z.literal(1), z.literal(2)])

const AgentEventSchema = z.strictObject({
  schemaVersion: AgentEventVersionSchema,
  eventId: IdSchema,
  taskId: IdSchema,
  sequence: z.number().int().positive(),
  snapshotVersion: z.number().int().nonnegative(),
  type: AgentEventTypeSchema,
  occurredAt: IsoDateSchema,
  correlationId: z.string().max(256).optional(),
  causationEventId: IdSchema.optional(),
  payload: z.record(z.string(), z.unknown())
})

function validateEventSequence (events, startSequence = 0) {
  let expected = startSequence + 1
  const seenIds = new Set()
  for (const event of events) {
    const parsed = AgentEventSchema.parse(event)
    if (seenIds.has(parsed.eventId)) continue
    if (parsed.sequence !== expected) {
      return { valid: false, expected, actual: parsed.sequence }
    }
    seenIds.add(parsed.eventId)
    expected++
  }
  return { valid: true, lastSequence: expected - 1 }
}

module.exports = { AgentEventSchema, AgentEventVersionSchema, validateEventSequence }
