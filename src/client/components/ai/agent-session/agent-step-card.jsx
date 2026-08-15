import { useEffect, useState } from 'react'
import { Button, Tag } from 'antd'

export default function AgentStepCard ({ step, onEvidence, current = false }) {
  const [expanded, setExpanded] = useState(current || step.expandedByDefault || ['running', 'warning', 'error'].includes(step.status))
  useEffect(() => {
    if (current || ['warning', 'error'].includes(step.status)) setExpanded(true)
  }, [current, step.status])
  return (
    <article className={`agent-step-card is-${step.status}${current ? ' is-current' : ''}`}>
      <button
        type='button'
        className='agent-step-summary'
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`agent-step-status-icon is-${step.status}`} aria-hidden='true'>{statusIcon(step.status)}</span>
        <span className='agent-step-title'>{step.title}</span>
        <span className='agent-step-spacer' />
        {step.risk && <Tag className='agent-risk-tag'>{step.risk.r}</Tag>}
        <span className='agent-step-status-text'>{statusText(step.status)}</span>
        <span className='agent-step-chevron' aria-hidden='true'>{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded && (
        <div className='agent-step-detail'>
          {step.reasonSummary && <p>{step.reasonSummary}</p>}
          {step.toolName && <code>{step.toolName}{step.targetDisplay ? `  ${step.targetDisplay}` : ''}</code>}
          {step.progress && (
            <p className='agent-step-progress'>
              已运行 {Math.round(step.progress.elapsedMs / 1000)} 秒
              <span aria-hidden='true'> · </span>
              已采集 {formatBytes(step.progress.capturedBytes)}
              {step.progress.safeLastLine ? ` · ${step.progress.safeLastLine}` : ''}
            </p>
          )}
          {step.observationSummary && <p>{step.observationSummary}</p>}
          {(step.factViews || []).slice(0, 4).map((fact, index) => <p key={index}>• {fact.statement}</p>)}
          {(step.evidenceRefs || []).map(ref => (
            <Button key={ref} size='small' type='link' onClick={() => onEvidence(ref)}>查看证据</Button>
          ))}
        </div>
      )}
    </article>
  )
}

function statusIcon (status) {
  return { pending: '·', running: '●', awaiting: '!', success: '✓', warning: '!', error: '×', cancelled: '−' }[status] || '·'
}

function statusText (status) {
  return { pending: '准备中', running: '执行中', awaiting: '等待确认', success: '已完成', warning: '需注意', error: '失败', cancelled: '已取消' }[status] || status
}

function formatBytes (bytes = 0) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`
}
