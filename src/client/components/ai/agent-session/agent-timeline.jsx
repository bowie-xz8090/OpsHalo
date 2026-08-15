import { useState } from 'react'
import AgentStepCard from './agent-step-card'

export default function AgentTimeline ({ timeline, onEvidence, awaitingApproval }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const steps = (timeline || []).filter(step => !(awaitingApproval && step.status === 'awaiting'))
  if (!steps.length) return null
  const currentIndex = findLastIndex(steps, step => ['pending', 'running', 'warning', 'error'].includes(step.status))
  const current = currentIndex >= 0 ? steps[currentIndex] : null
  const history = steps.filter((_, index) => index !== currentIndex)
  return (
    <section className='agent-timeline' role='log' aria-label='Agent 执行过程'>
      {current && <AgentStepCard step={current} onEvidence={onEvidence} current />}
      {!!history.length && (
        <div className='agent-history'>
          <button
            type='button'
            className='agent-history-toggle'
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            {historyOpen ? '收起' : '查看'}已完成步骤（{history.length}）
          </button>
          {historyOpen && history.map(step => <AgentStepCard key={step.stepId} step={step} onEvidence={onEvidence} />)}
        </div>
      )}
    </section>
  )
}

function findLastIndex (items, predicate) {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}
