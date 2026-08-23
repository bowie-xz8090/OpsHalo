const { ReadProbeBundleSchema } = require('../schemas/tool-schema')

const RISK_ORDER = Object.freeze({ R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 })
const SENSITIVITY_ORDER = Object.freeze({ S0: 0, S1: 1, S2: 2, S3: 3 })
const COST_ORDER = Object.freeze({ C0: 0, C1: 1, C2: 2, C3: 3 })
const STOP_CODES = new Set([
  'AGENT_SESSION_MISMATCH', 'AGENT_TASK_MISMATCH', 'AGENT_POLICY_CHANGED',
  'AGENT_CAPABILITY_MISMATCH', 'AGENT_CAPABILITY_EXPIRED',
  'AGENT_REMOTE_STATE_UNKNOWN', 'AGENT_CANCELLED'
])

class ReadProbeBundleScheduler {
  constructor (gateway, options = {}) {
    this.gateway = gateway
    this.concurrency = Math.max(1, Math.min(Number(options.concurrency) || 2, 3))
  }

  async prepare (session, rawBundle) {
    const bundle = ReadProbeBundleSchema.parse(rawBundle)
    const preflight = []
    for (const [index, action] of bundle.actions.entries()) {
      let definition
      try { definition = this.gateway.registry.get(action.intent.toolName).definition } catch (error) {
        return serialResult(bundle, 'unknown_tool', preflight, safeBundleError(error))
      }
      const reasons = []
      if (!definition.parallelSafe) reasons.push('tool_not_parallel_safe')
      if (definition.mutability !== 'none') reasons.push('mutation_requires_serial_execution')
      if (definition.category === 'interactive') reasons.push('interactive_requires_serial_execution')
      if (action.dependsOn.length) reasons.push('dependent_action_requires_serial_execution')
      if (definition.category === 'network' || definition.name.startsWith('mcp.')) reasons.push('network_action_requires_serial_execution')
      preflight.push({ index, action, definition, reasons })
    }
    const unsafe = preflight.find(item => item.reasons.length)
    if (unsafe) return serialResult(bundle, unsafe.reasons[0], preflight)

    const prepared = []
    for (const item of preflight) {
      let value
      try { value = await this.gateway.prepare(session, item.action.intent) } catch (error) {
        return serialResult(bundle, serialErrorReason(error), prepared, safeBundleError(error))
      }
      prepared.push({ ...item, prepared: value })
      if (!isBoundedAutoRead(value)) return serialResult(bundle, serialReason(value), prepared)
    }
    return { mode: 'parallel', bundle, prepared }
  }

  async executePrepared (session, preparedBundle, signal) {
    if (preparedBundle.mode !== 'parallel') return preparedBundle
    const results = new Array(preparedBundle.prepared.length)
    let cursor = 0
    let stoppedBy
    const worker = async () => {
      while (!stoppedBy) {
        if (signal?.aborted) {
          stoppedBy = { index: Math.min(cursor, preparedBundle.prepared.length - 1), code: 'AGENT_CANCELLED' }
          return
        }
        const index = cursor++
        if (index >= preparedBundle.prepared.length) return
        const item = preparedBundle.prepared[index]
        try {
          const executed = await this.gateway.execute(session, item.prepared.intent, item.prepared.capability, signal, item.prepared.timeoutMs)
          results[index] = { index, intent: item.prepared.intent, ...executed }
          if (executed.result.status === 'unknown') stoppedBy = { index, code: 'AGENT_REMOTE_STATE_UNKNOWN' }
          if (executed.result.status === 'cancelled') stoppedBy = { index, code: 'AGENT_CANCELLED' }
        } catch (error) {
          results[index] = { index, intent: item.prepared.intent, error: safeBundleError(error) }
          if (STOP_CODES.has(error.code)) stoppedBy = { index, code: error.code }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, preparedBundle.prepared.length) }, () => worker()))
    for (let index = 0; index < results.length; index++) {
      if (!results[index]) {
        results[index] = {
          index,
          intent: preparedBundle.prepared[index].prepared.intent,
          notStarted: true,
          error: { code: 'AGENT_BUNDLE_STOPPED', safeMessage: '同一组中的前序动作需要重新确认会话或策略，后续动作未发送。' }
        }
      }
    }
    return { mode: 'parallel', bundle: preparedBundle.bundle, results, stoppedBy }
  }

  async run (session, bundle, signal) {
    return this.executePrepared(session, await this.prepare(session, bundle), signal)
  }
}

function isBoundedAutoRead (value) {
  return value?.decision?.outcome === 'allow' && value.mutability === 'none' &&
    RISK_ORDER[value.decision.risk] <= RISK_ORDER.R1 &&
    SENSITIVITY_ORDER[value.decision.sensitivity] <= SENSITIVITY_ORDER.S1 &&
    COST_ORDER[value.decision.cost] <= COST_ORDER.C1 &&
    !!value.capability
}

function serialReason (value) {
  if (value?.mutability !== 'none') return 'mutation_requires_serial_execution'
  if (value?.decision?.outcome === 'require_approval') return 'approval_requires_serial_execution'
  if (value?.decision?.outcome === 'deny') return 'policy_denied'
  return 'risk_requires_serial_execution'
}

function serialErrorReason (error) {
  if (error?.code === 'AGENT_AUTO_READ_BUDGET') return 'budget_requires_serial_execution'
  if (error?.code === 'AGENT_TASK_MISMATCH' || error?.code === 'AGENT_SESSION_MISMATCH') return 'binding_requires_recheck'
  return 'preflight_failed'
}

function serialResult (bundle, reason, prepared = [], error) {
  return { mode: 'serial', reason, bundle, prepared, ...(error ? { error } : {}) }
}

function safeBundleError (error) {
  return {
    code: String(error?.code || 'AGENT_BUNDLE_ACTION_FAILED').slice(0, 120),
    safeMessage: String(error?.safeMessage || error?.message || '只读探查失败。').slice(0, 500)
  }
}

module.exports = { ReadProbeBundleScheduler, isBoundedAutoRead, serialReason, serialErrorReason, safeBundleError }
