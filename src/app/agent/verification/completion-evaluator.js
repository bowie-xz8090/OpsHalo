const { CompletionDecisionSchema } = require('../schemas/verification-schema')

class CompletionEvaluator {
  async evaluate (session) {
    const verifiedFacts = session.memory.facts.filter(item => item.confidence !== 'inferred')
    const factIdsByEvidence = indexFactIdsByEvidence(verifiedFacts)
    const criterionResults = session.memory.completionCriteria.map(criterion => {
      const factIds = [...new Set((criterion.evidenceRefs || []).flatMap(reference => factIdsByEvidence.get(reference) || []))]
      const status = criterion.status === 'passed' && factIds.length
        ? 'met'
        : criterion.status === 'failed'
          ? 'unmet'
          : 'unknown'
      return { criterionId: criterion.criterionId, status, factIds }
    })
    const criticalResults = session.memory.completionCriteria
      .map((criterion, index) => ({ criterion, result: criterionResults[index] }))
      .filter(item => item.criterion.critical)
    const missingCriteria = criticalResults.filter(item => item.result.status !== 'met')
    const unresolvedContradictions = session.memory.contradictions.filter(item => item.impact === 'critical' && item.status !== 'resolved')
    const unverifiedChanges = session.memory.changeRecords.filter(item => item.verificationStatus !== 'passed')
    let status = 'satisfied'
    const warnings = []
    if (unverifiedChanges.length) {
      status = 'failed'
      warnings.push('存在未验证、验证失败或状态未知的变更，不能宣称操作完成。')
    } else if (unresolvedContradictions.length) {
      status = 'inconclusive'
      warnings.push('命令输出中的信息不一致，暂时无法确认最终结果。')
    } else if (missingCriteria.length || !verifiedFacts.length) {
      status = 'inconclusive'
      warnings.push('目前的命令输出还不能确认全部结果。')
    }
    return CompletionDecisionSchema.parse({
      status,
      criterionResults,
      unresolved: [...new Set([
        ...session.memory.missingInformation,
        ...missingCriteria.map(item => item.criterion.statement)
      ])].slice(0, 100),
      warnings,
      maySynthesize: verifiedFacts.length > 0 && !['blocked', 'cancelled'].includes(status)
    })
  }
}

function indexFactIdsByEvidence (facts) {
  const result = new Map()
  for (const fact of facts) {
    for (const reference of fact.evidenceRefs || []) {
      if (!result.has(reference)) result.set(reference, [])
      result.get(reference).push(fact.factId)
    }
  }
  return result
}

module.exports = { CompletionEvaluator, indexFactIdsByEvidence }
