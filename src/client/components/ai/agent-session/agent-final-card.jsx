import { Button, Tag } from 'antd'

const labels = {
  complete: ['✓', '排查完成', 'green'],
  inconclusive: ['?', '证据不足', 'gold'],
  blocked: ['🔒', '已阻断', 'red'],
  partial: ['⚠', '部分完成', 'orange'],
  failed: ['✕', '任务失败', 'red'],
  cancelled: ['■', '已取消', 'default']
}

export default function AgentFinalCard ({ result, onEvidence, onClear, onFollowUp, canClear = true }) {
  if (!result) return null
  const [icon, label, color] = labels[result.status] || ['●', result.status, 'default']
  const hasDetails = !!(result.confirmedFacts?.length || result.inferences?.length || result.operations?.length || result.unresolvedItems?.length)
  return (
    <section className={`agent-final-card is-${result.status}`}>
      <h3>{icon} {label} <Tag color={color}>{result.status}</Tag></h3>
      <p className='agent-final-conclusion'>{result.conclusion}</p>
      {hasDetails && (
        <details className='agent-final-details' open={result.status !== 'complete'}>
          <summary>查看依据与未解决项</summary>
          {!!result.confirmedFacts?.length && <><h4>已确认事实</h4>{result.confirmedFacts.map(fact => <p key={fact.factId}>• {fact.statement}（{fact.confidence}）</p>)}</>}
          {!!result.inferences?.length && <><h4>推断</h4>{result.inferences.map(fact => <p key={fact.factId}>• {fact.statement}</p>)}</>}
          {!!result.operations?.length && <><h4>已执行操作与验证</h4>{result.operations.map(item => <p key={item.invocationId}>• {item.expectedEffect}：{item.actualStatus} / {item.verificationStatus}</p>)}</>}
          {!!result.unresolvedItems?.length && <><h4>未解决</h4>{result.unresolvedItems.map((item, index) => <p key={index}>• {item}</p>)}</>}
        </details>
      )}
      <div className='agent-final-actions'>
        {(result.evidenceRefs || []).map(ref => <Button key={ref} size='small' onClick={() => onEvidence(ref)}>查看证据</Button>)}
        {canClear && <Button size='small' onClick={onClear}>清理证据</Button>}
        <Button size='small' type='primary' onClick={onFollowUp}>继续追问</Button>
      </div>
    </section>
  )
}
