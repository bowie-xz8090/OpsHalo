import { Tag } from 'antd'
import {
  readableConfidence,
  readableFactStatement,
  readableFinalConclusion,
  readableFinalStatus,
  readableOperationStatus
} from '../../../common/agent-final-copy.mjs'

const statusColors = {
  inconclusive: 'gold',
  blocked: 'red',
  partial: 'orange',
  failed: 'red',
  cancelled: 'default'
}

export default function AgentFinalCard ({ result, detailsOpen, onLayoutChange }) {
  if (!result) return null
  const statusLabel = readableFinalStatus(result.status)
  const hasDetails = !!(result.confirmedFacts?.length || result.inferences?.length || result.operations?.length || result.unresolvedItems?.length || result.knowledgeCitations?.length)
  const expanded = detailsOpen ?? result.status !== 'complete'
  return (
    <section className={`agent-final-card is-${result.status}`}>
      <h3>
        分析结果
        {statusLabel && <Tag color={statusColors[result.status]}>{statusLabel}</Tag>}
      </h3>
      <p className='agent-final-conclusion'>{readableFinalConclusion(result)}</p>
      {hasDetails && (
        <details
          className='agent-final-details'
          open={expanded}
          onToggle={event => {
            if (event.currentTarget.open !== expanded) onLayoutChange?.(event.currentTarget.open)
          }}
        >
          <summary>查看分析依据和待确认内容</summary>
          {!!result.confirmedFacts?.length && <><h4>命令输出已确认</h4>{result.confirmedFacts.map(fact => <p key={fact.factId}>• {readableFactStatement(fact.statement)}{readableConfidence(fact.confidence) ? `（${readableConfidence(fact.confidence)}）` : ''}</p>)}</>}
          {!!result.inferences?.length && <><h4>AI 分析判断</h4>{result.inferences.map(fact => <p key={fact.factId}>• {readableFactStatement(fact.statement)}</p>)}</>}
          {!!result.operations?.length && <><h4>操作结果</h4>{result.operations.map(item => <p key={item.invocationId}>• {item.expectedEffect}：{[readableOperationStatus(item.actualStatus), readableOperationStatus(item.verificationStatus)].filter(Boolean).join('，')}</p>)}</>}
          {!!result.unresolvedItems?.length && <><h4>仍需确认</h4>{result.unresolvedItems.map((item, index) => <p key={index}>• {item}</p>)}</>}
          {!!result.knowledgeCitations?.length && <><h4>参考文档</h4>{result.knowledgeCitations.map(item => <p key={`${item.sourceId}:${item.chunkId}:${item.sourceVersion}`} className={item.stale ? 'is-stale' : ''}>• {item.sourcePath}{item.startLine ? `:${item.startLine}${item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ''}` : ''}{item.stale ? '（来源已变化或删除）' : ''}</p>)}</>}
        </details>
      )}
    </section>
  )
}
