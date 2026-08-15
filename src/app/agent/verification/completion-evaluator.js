class CompletionEvaluator {
  async evaluate (session) {
    const critical = session.memory.completionCriteria.filter(item => item.critical)
    const missingCriteria = critical.filter(item => item.status !== 'passed' || !item.evidenceRefs.length)
    const unresolvedContradictions = session.memory.contradictions.filter(item => item.impact === 'critical' && item.status !== 'resolved')
    const unverifiedChanges = session.memory.changeRecords.filter(item => item.verificationStatus !== 'passed')
    let status = 'complete'
    let conclusion = session.memory.facts.length ? summarizeFacts(session.memory.facts) : '已完成当前目标的证据检查。'
    let reason
    if (unverifiedChanges.length) {
      status = session.memory.changeRecords.length > 1 ? 'partial' : 'failed'
      conclusion = '存在未验证、验证失败或状态未知的变更，不能宣称操作完成。'
      reason = { code: 'unverified_change', safeMessage: conclusion, recoverable: false }
    } else if (unresolvedContradictions.length) {
      status = 'inconclusive'
      conclusion = '关键证据存在未解决的矛盾。'
      reason = { code: 'critical_contradiction', safeMessage: conclusion, recoverable: true }
    } else if (missingCriteria.length || !session.memory.facts.length) {
      status = 'inconclusive'
      conclusion = '当前证据不足以满足全部关键完成判据。'
      reason = { code: 'insufficient_evidence', safeMessage: conclusion, recoverable: true }
    }
    return {
      status,
      reason,
      finalResult: {
        status,
        conclusion,
        confirmedFacts: session.memory.facts.filter(f => f.confidence !== 'inferred'),
        inferences: session.memory.facts.filter(f => f.confidence === 'inferred'),
        unresolvedItems: [...session.memory.missingInformation, ...missingCriteria.map(item => item.statement)],
        operations: session.memory.changeRecords,
        verificationOutcomes: session.verification?.outcomes || [],
        evidenceRefs: session.evidenceRefs,
        completedAt: new Date().toISOString()
      }
    }
  }
}

function summarizeFacts (facts) {
  return facts.slice(0, 5).map(item => item.statement).join('；').slice(0, 5000)
}

module.exports = { CompletionEvaluator, summarizeFacts }
