const crypto = require('crypto')

function stable (value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key])
      return result
    }, {})
  }
  return value
}

function digest (value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

function progressFingerprint (memory) {
  return digest({
    missingInformation: [...(memory.missingInformation || [])].sort(),
    facts: (memory.facts || []).map(f => [f.factId, f.confidence]),
    contradictions: (memory.contradictions || []).map(c => [c.contradictionId, c.status]),
    verificationObligations: (memory.verificationObligations || []).map(v => [v.invocationId, v.verificationPlan?.planId])
  })
}

function actionFingerprint (intent, errorCategory) {
  return digest({
    toolName: intent.toolName,
    arguments: intent.normalizedArguments || intent.arguments,
    target: intent.target,
    errorCategory: errorCategory || null
  })
}

class ProgressDetector {
  constructor (maxRepeats = 2) {
    this.maxRepeats = maxRepeats
    this.records = []
  }

  record (memory, intent, errorCategory) {
    const current = {
      progressHash: progressFingerprint(memory),
      actionHash: actionFingerprint(intent, errorCategory)
    }
    this.records.push(current)
    if (this.records.length > this.maxRepeats + 1) this.records.shift()
    const equivalent = this.records.filter(r => r.progressHash === current.progressHash && r.actionHash === current.actionHash).length
    return { equivalent, blocked: equivalent > this.maxRepeats, ...current }
  }
}

module.exports = { stable, digest, progressFingerprint, actionFingerprint, ProgressDetector }
