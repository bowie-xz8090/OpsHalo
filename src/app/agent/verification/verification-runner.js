const crypto = require('crypto')

class VerificationRunner {
  constructor (gateway, observationPipeline) {
    this.gateway = gateway
    this.observationPipeline = observationPipeline
  }

  async runChecks (session, plan, phase, signal) {
    const checks = phase === 'precheck' ? plan.preconditions : plan.postconditions
    const checkResults = []
    const evidenceRefs = []
    for (const check of checks) {
      const descriptor = this.gateway.publicTools().find(tool => tool.name === check.intent.toolName)
      if (!descriptor) {
        checkResults.push({ checkId: check.checkId, status: 'inconclusive', actualSummary: '验证工具不可用。', evidenceRefs: [] })
        continue
      }
      const intent = {
        schemaVersion: 1,
        taskId: session.taskId,
        invocationId: `verify_${crypto.randomBytes(18).toString('base64url')}`,
        toolName: descriptor.name,
        toolVersion: descriptor.version,
        arguments: check.intent.arguments,
        target: check.intent.target,
        purpose: check.description,
        expectedObservation: check.description
      }
      try {
        const prepared = await this.gateway.prepare(session, intent)
        if (prepared.decision.outcome !== 'allow') {
          checkResults.push({ checkId: check.checkId, status: 'inconclusive', actualSummary: '验证动作未满足自动只读策略。', evidenceRefs: [] })
          continue
        }
        const executed = await this.gateway.execute(session, prepared.intent, prepared.capability, signal, prepared.timeoutMs)
        const observation = await this.observationPipeline.process({ ...session, currentInvocation: { toolName: intent.toolName, isVerification: true } }, executed.result, executed.streams, signal)
        evidenceRefs.push(...observation.evidenceRefs)
        checkResults.push({
          checkId: check.checkId,
          status: evaluatePredicate(check.predicate, observation, executed.streams) ? 'passed' : executed.result.status === 'success' ? 'failed' : 'inconclusive',
          actualSummary: observation.summary,
          evidenceRefs: observation.evidenceRefs
        })
      } catch (error) {
        if (signal?.aborted) throw error
        checkResults.push({
          checkId: check.checkId,
          status: 'inconclusive',
          actualSummary: String(error.safeMessage || error.message || '验证执行失败').slice(0, 2000),
          evidenceRefs: []
        })
      }
    }
    const failed = checkResults.some(item => item.status === 'failed')
    const inconclusive = checkResults.some(item => item.status === 'inconclusive')
    const status = failed ? 'failed' : inconclusive ? 'inconclusive' : 'passed'
    return { planId: plan.planId, status, checkResults, evidenceRefs: [...new Set(evidenceRefs)], verifiedAt: new Date().toISOString() }
  }
}

function evaluatePredicate (predicate, observation, streams) {
  const value = selectPath({ observation, stdout: streams.stdout, stderr: streams.stderr }, predicate.path)
  if (predicate.operator === 'exists') return value !== undefined && value !== null && value !== ''
  if (predicate.operator === 'equal') return String(value) === String(predicate.expected)
  if (predicate.operator === 'match') {
    try { return new RegExp(String(predicate.expected)).test(String(value)) } catch (_) { return false }
  }
  if (predicate.operator === 'range') {
    const expected = predicate.expected || {}
    const number = Number(value)
    return Number.isFinite(number) && (expected.min === undefined || number >= expected.min) && (expected.max === undefined || number <= expected.max)
  }
  return false
}

function selectPath (value, rawPath) {
  const path = String(rawPath || '').replace(/^\$\.?/, '').split('.').filter(Boolean)
  return path.reduce((current, part) => current == null ? undefined : current[part], value)
}

module.exports = { VerificationRunner, evaluatePredicate, selectPath }
