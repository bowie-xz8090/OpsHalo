import { useState } from 'react'
import AgentSessionHeader from './agent-session-header'
import AgentTimeline from './agent-timeline'
import AgentApprovalCard from './agent-approval-card'
import AgentUserInputCard from './agent-user-input-card'
import AgentEvidenceDetail from './agent-evidence-detail'
import AgentFinalCard from './agent-final-card'
import { currentAgentActivity } from '../../../store/agent-session-view.mjs'
import './agent-session.styl'

export default function AgentSessionOverlay ({ session, onControl, getEvidence, deleteEvidence, onHandoff, finalDetailsOpen, onLayoutChange, onClose, embedded = false, readOnly = false }) {
  const [evidenceRef, setEvidenceRef] = useState(null)
  if (!session) return null
  const hasTimeline = !!session.timeline?.length
  const minimal = embedded
    ? !session.pendingApproval && !session.pendingUserInput && !session.finalResult
    : !session.plan && !hasTimeline && !session.pendingApproval && !session.pendingUserInput && !session.finalResult
  const contentSized = embedded && !minimal
  const activity = currentAgentActivity(session)
  return (
    <div className={`agent-session-overlay-inner${minimal ? ' is-thinking-only' : ''}${embedded ? ' is-embedded' : ''}${contentSized ? ' is-content-sized' : ''}`}>
      <AgentSessionHeader session={session} onControl={onControl} onClose={onClose} minimal={minimal} embedded={embedded} readOnly={readOnly} />
      {!minimal && !session.finalResult && activity && (
        <section className='agent-current-activity' aria-live='polite'>
          <span className='agent-activity-dot' aria-hidden='true' />
          <span>{activity}</span>
        </section>
      )}
      {!minimal && !session.finalResult && session.plan?.missingInformation?.length > 0 && !session.pendingApproval && (
        <details className='agent-plan-details'>
          <summary>正在继续探查 {session.plan.missingInformation.length} 项信息</summary>
          <p>{session.plan.missingInformation.join('；')}</p>
        </details>
      )}
      {!session.finalResult && (
        <AgentTimeline
          timeline={session.timeline}
          onEvidence={setEvidenceRef}
          awaitingApproval={!!session.pendingApproval}
        />
      )}
      <AgentApprovalCard
        approval={session.pendingApproval}
        resolvedDecision={session._embeddedResolvedDecision}
        readOnly={readOnly}
        onDecision={decision => onControl('resolve_approval', { decision })}
        onRevise={revisedCommand => onControl('revise_approval', {
          approvalRequestId: session.pendingApproval.approvalRequestId,
          intentDigest: session.pendingApproval.intentDigest,
          revisedCommand
        })}
      />
      <AgentUserInputCard
        request={session.pendingUserInput}
        onCancel={() => onControl('cancel', { reason: 'user_input_cancelled' })}
        onHandoff={onHandoff}
      />
      <AgentFinalCard result={session.finalResult} detailsOpen={finalDetailsOpen} onLayoutChange={onLayoutChange} />
      <AgentEvidenceDetail
        taskId={session.taskId}
        evidenceRef={evidenceRef}
        open={!!evidenceRef}
        onClose={() => setEvidenceRef(null)}
        load={getEvidence}
        onDelete={async request => {
          await deleteEvidence(request)
          setEvidenceRef(null)
        }}
      />
    </div>
  )
}
