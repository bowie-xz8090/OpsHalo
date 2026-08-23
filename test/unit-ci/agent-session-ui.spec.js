const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { AgentEventSchema } = require('../../src/app/agent/schemas/event-schema')

const viewModule = import('../../src/client/store/agent-session-view.mjs')
const transcriptModule = import('../../src/client/common/agent-terminal-transcript.mjs')
const finalCopyModule = import('../../src/client/common/agent-final-copy.mjs')

test('Agent final result copy hides internal evidence terminology', async () => {
  const {
    readableConfidence,
    readableFactStatement,
    readableFinalConclusion,
    readableFinalStatus
  } = await finalCopyModule
  assert.equal(
    readableFinalConclusion({ status: 'inconclusive', conclusion: '关键证据存在未解决的矛盾。' }),
    '命令输出中的信息不一致，暂时无法确认最终结果。'
  )
  assert.equal(readableFinalStatus('inconclusive'), '仍需确认')
  assert.equal(readableConfidence('observed'), '命令输出已确认')
  assert.equal(readableFactStatement('nginx=syntax is ok (observed)'), 'Nginx：syntax is ok')
})

test('Agent final result only presents the analysis without redundant actions', () => {
  const finalCard = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/agent-session/agent-final-card.jsx'), 'utf8')
  const overlay = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/ai/agent-session/agent-session-overlay.jsx'), 'utf8')
  assert.doesNotMatch(finalCard, /查看证据|清理证据|继续追问/)
  assert.doesNotMatch(finalCard, /<Button/)
  assert.doesNotMatch(finalCard, /agent-final-actions/)
  assert.match(overlay, /<AgentFinalCard result=\{session\.finalResult\} detailsOpen=\{finalDetailsOpen\} onLayoutChange=\{onLayoutChange\} \/>/)
})

test('internal Agent protocol events do not become visible timeline rows', async () => {
  const { projectTimeline } = await viewModule
  const internalTypes = ['session.created', 'session.state_changed', 'budget.updated', 'harness.progress', 'evidence.available']
  let timeline = []
  for (const type of internalTypes) timeline = projectTimeline(timeline, { type, payload: {} })
  assert.deepEqual(timeline, [])
})

test('knowledge citations survive renderer projection without becoming terminal steps', async () => {
  const projectionModule = await import('../../src/client/store/agent-session.js')
  const projection = new projectionModule.AgentSessionProjection({ onEvent: () => () => {} })
  const session = {
    taskId: 'task_knowledge_projection_12345',
    lastEventSequence: 0,
    snapshotVersion: 1,
    timeline: [],
    knowledgeCitations: []
  }
  const citation = {
    sourceId: 'source_projection_12345',
    sourcePath: '/runbooks/nginx.md',
    sourceVersion: 'version12345',
    chunkId: 'chunk_projection_12345',
    startLine: 4,
    endLine: 8,
    score: 0.25,
    retrievedAt: new Date().toISOString(),
    retrievalMode: 'fts',
    stale: false
  }
  const projected = projection.project(session, {
    taskId: session.taskId,
    sequence: 1,
    snapshotVersion: 2,
    type: 'knowledge.retrieved',
    payload: { count: 1, citations: [citation] }
  })
  assert.deepEqual(projected.knowledgeCitations, [citation])
  assert.deepEqual(projected.timeline, [])
  projection.dispose()
})

test('one invocation is projected as one readable step across its lifecycle', async () => {
  const { projectTimeline } = await viewModule
  const invocationId = 'invocation_ui_projection_12345'
  const events = [
    { type: 'action.proposed', correlationId: invocationId, payload: { invocationId, purpose: '检查 Nginx 配置', toolName: 'shell.exec', targetDisplay: '/etc/nginx/nginx.conf', expectedObservation: '确认生效配置路径' } },
    { type: 'policy.evaluated', payload: { invocationId, outcome: 'allow', risk: 'R1', sensitivity: 'S1', cost: 'C1' } },
    { type: 'execution.started', correlationId: invocationId, payload: { invocationId, toolName: 'shell.exec', startedAt: new Date().toISOString() } },
    { type: 'execution.progress', correlationId: invocationId, payload: { invocationId, elapsedMs: 900, bytesReceived: 120, message: 'syntax is ok' } },
    { type: 'observation.ready', correlationId: invocationId, payload: { invocationId, status: 'success', summary: 'Nginx 配置语法正常', facts: [], evidenceRefs: [] } }
  ]
  const timeline = events.reduce(projectTimeline, [])
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].title, '检查 Nginx 配置')
  assert.equal(timeline[0].observationSummary, 'Nginx 配置语法正常')
  assert.equal(timeline[0].risk.r, 'R1')
})

test('shell observation exposes a bounded terminal transcript to the terminal view', async () => {
  const projectionModule = await import('../../src/client/store/agent-session.js')
  const projection = new projectionModule.AgentSessionProjection({ onEvent: () => () => {} })
  const session = {
    taskId: 'task_transcript_projection_12345',
    lastEventSequence: 0,
    snapshotVersion: 1,
    timeline: []
  }
  const projected = projection.project(session, {
    taskId: session.taskId,
    sequence: 1,
    snapshotVersion: 2,
    type: 'observation.ready',
    occurredAt: new Date().toISOString(),
    payload: {
      invocationId: 'invocation_transcript_projection_12345',
      status: 'success',
      summary: 'done',
      facts: [],
      evidenceRefs: [],
      terminalTranscript: { stdout: 'line\n', stderr: '', exitCode: 0 }
    }
  })
  assert.equal(projected._terminalTranscript.stdout, 'line\n')
  projection.dispose()
})

test('snapshot gap recovery keeps the latest shell transcript', async () => {
  const projectionModule = await import('../../src/client/store/agent-session.js')
  const projection = new projectionModule.AgentSessionProjection({ onEvent: () => () => {} })
  const projected = projection.replaceSnapshot({
    taskId: 'task_transcript_snapshot_12345',
    binding: { tabId: 'tab_transcript_snapshot_12345' },
    latestObservation: {
      invocationId: 'invocation_transcript_snapshot_12345',
      terminalTranscript: { stdout: 'snapshot line\n', stderr: '', exitCode: 0 }
    }
  })
  assert.equal(projected._terminalTranscript.stdout, 'snapshot line\n')
  assert.equal(projected._terminalTranscript.invocationId, 'invocation_transcript_snapshot_12345')
  projection.dispose()
})

test('terminal state change is not exposed before its final result event', async () => {
  const projectionModule = await import('../../src/client/store/agent-session.js')
  const projection = new projectionModule.AgentSessionProjection({ onEvent: () => () => {} })
  const received = []
  const taskId = 'task_terminal_pair_12345'
  projection.subscribeTab('tab_terminal_pair', session => received.push(session))
  projection.replaceSnapshot({
    taskId,
    binding: { tabId: 'tab_terminal_pair' },
    status: 'evaluating',
    lastEventSequence: 8,
    snapshotVersion: 4,
    timeline: []
  }, { activate: true })

  await projection.applyEvent({
    taskId,
    sequence: 9,
    snapshotVersion: 5,
    type: 'session.state_changed',
    payload: { from: 'evaluating', to: 'complete' }
  })
  assert.equal(received.length, 1)
  assert.equal(received[0].status, 'evaluating')

  await projection.applyEvent({
    taskId,
    sequence: 10,
    snapshotVersion: 5,
    type: 'session.completed',
    payload: {
      status: 'complete',
      conclusion: 'Nginx 配置位于 /etc/nginx/nginx.conf。',
      confirmedFacts: [],
      inferences: [],
      operations: [],
      unresolvedItems: [],
      evidenceRefs: []
    }
  })
  assert.equal(received.length, 2)
  assert.equal(received[1].status, 'complete')
  assert.equal(received[1].finalResult.conclusion, 'Nginx 配置位于 /etc/nginx/nginx.conf。')
  projection.dispose()
})

test('a delayed task snapshot cannot replace the explicitly active task in the same tab', async () => {
  const projectionModule = await import('../../src/client/store/agent-session.js')
  const projection = new projectionModule.AgentSessionProjection({ onEvent: () => () => {} })
  const received = []
  projection.subscribeTab('tab_projection_active', session => received.push(session))
  const active = {
    taskId: 'task_projection_active_12345',
    binding: { tabId: 'tab_projection_active' },
    status: 'complete',
    timeline: []
  }
  const delayed = {
    taskId: 'task_projection_delayed_12345',
    binding: { tabId: 'tab_projection_active' },
    status: 'awaiting_approval',
    timeline: []
  }
  projection.replaceSnapshot(active, { activate: true })
  projection.replaceSnapshot(delayed)
  assert.equal(projection.activeByTab.get('tab_projection_active'), active.taskId)
  assert.equal(received.at(-1).taskId, delayed.taskId)
  assert.equal(received.at(-1)._tabActive, false)
  projection.replaceSnapshot(delayed, { activate: true })
  assert.equal(projection.activeByTab.get('tab_projection_active'), delayed.taskId)
  assert.equal(received.at(-1)._tabActive, true)
  projection.dispose()
})

test('optimistic Agent session provides immediate activity and can become an embedded failure card', async () => {
  const { createOptimisticAgentSession, currentAgentActivity, failOptimisticAgentSession } = await viewModule
  const pending = createOptimisticAgentSession({
    clientRequestId: 'client_ui_pending_12345',
    tabId: 'tab-ui-pending',
    prompt: '查询 Nginx 配置'
  })
  assert.equal(pending.status, 'intake')
  assert.match(currentAgentActivity(pending), /准备 AI/)
  const failed = failOptimisticAgentSession(pending, { code: 'AGENT_CONFIG', safeMessage: 'AI 配置不可用。' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.finalResult.conclusion, 'AI 配置不可用。')
})

test('harness progress is a versioned Agent event', () => {
  const event = AgentEventSchema.parse({
    schemaVersion: 1,
    eventId: 'event_harness_progress_12345',
    taskId: 'task_harness_progress_12345',
    sequence: 1,
    snapshotVersion: 2,
    type: 'harness.progress',
    occurredAt: new Date().toISOString(),
    payload: { phase: 'thinking', message: 'AI 正在思考…' }
  })
  assert.equal(event.type, 'harness.progress')
})

test('Agent cards are mounted on xterm buffer decorations instead of a floating overlay', () => {
  const terminal = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'), 'utf8')
  const overlay = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/terminal/terminal-smart-shell-overlay.jsx'), 'utf8')
  const agentUiDir = path.resolve(__dirname, '../../src/client/components/ai/agent-session')
  assert.match(terminal, /registerAgentEmbeddedDecoration/)
  assert.match(terminal, /registerMarker\(0\)/)
  assert.match(terminal, /registerDecoration\(\{/)
  assert.match(terminal, /intersectsViewport/)
  assert.match(terminal, /viewportLine \+ entry\.rows > 0/)
  assert.match(terminal, /fitAgentEmbeddedEntryToContent/)
  assert.match(terminal, /isCompactAgentEmbeddedSession/)
  assert.match(terminal, /!this\.isCompactAgentEmbeddedSession\(entry\.session\)/)
  assert.match(terminal, /Math\.ceil\(contentHeight \/ cellHeight\)/)
  assert.match(terminal, /await this\.fitAgentEmbeddedEntryToContent\(entry\)/)
  assert.match(terminal, /freezeAgentExecutedApprovalEntry/)
  assert.match(terminal, /_embeddedResolvedDecision: decision/)
  assert.match(terminal, /isTerminalAgentStatus\(session\?\.status\) && !session\.finalResult/)
  assert.doesNotMatch(terminal, /_embeddedExecutionHistory/)
  assert.doesNotMatch(terminal, /consumeAgentExecutedApprovalEntry/)
  assert.match(terminal, /revealAgentEmbeddedFinalEntry/)
  assert.match(terminal, /this\.term\.scrollToLine\(entry\.marker\.line\)/)
  assert.match(terminal, /scheduleAgentEmbeddedFit/)
  assert.match(terminal, /getAgentTerminalLineEndColumn/)
  assert.match(terminal, /requiredRows === entry\.rows/)
  assert.match(terminal, /entry\.finalDetailsOpen = open/)
  assert.match(terminal, /entry\.needsContentFit = true/)
  assert.match(terminal, /if \(entry\.needsContentFit\) this\.scheduleAgentEmbeddedFit\(entry\)/)
  assert.match(terminal, /if \(!fittedBeforePrompt\)/)
  assert.match(terminal, /this\.scheduleAgentEmbeddedFit\(entry\)/)
  assert.match(terminal, /<AgentSessionOverlay/)
  assert.match(terminal, /freezeAgentEmbeddedLiveSession/)
  assert.match(terminal, /shouldAnchorAgentCardBelowPrompt/)
  assert.match(terminal, /this\.shouldAnchorAgentCardBelowPrompt\(\) \? '\\r\\n' : '\\r\\x1b\[2K'/)
  assert.match(terminal, /'\\r\\n'\.repeat\(entry\.rows\)/)
  assert.doesNotMatch(terminal, /agentSession=\{this\.state\.agentSession\}/)
  assert.doesNotMatch(overlay, /AgentSessionOverlay|agentSession|is-agent-session/)
  assert.ok(fs.readdirSync(agentUiDir).includes('agent-session-overlay.jsx'))
  assert.ok(fs.readdirSync(agentUiDir).includes('agent-approval-card.jsx'))
})

test('Shell and Agent mode selector stays visible and routes missing setup to AI config', () => {
  const control = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/session/session-control.jsx'), 'utf8')
  const session = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/session/session.jsx'), 'utf8')
  assert.match(control, /Shell模式/)
  assert.match(control, /Agent模式/)
  assert.doesNotMatch(control, /if \(!agentModeEnabled\) return null/)
  assert.match(session, /!agentModeEnabled \|\| window\.store\.agentAiConfigMissing\(\)/)
  assert.match(session, /window\.store\.toggleAIConfig\(\)/)
})

test('Agent command evidence is formatted for the terminal transcript', async () => {
  const { parseAgentEvidenceTranscript, formatAgentTerminalTranscript } = await transcriptModule
  const transcript = parseAgentEvidenceTranscript(JSON.stringify({ stdout: 'tcp LISTEN 0 511 0.0.0.0:80\n', stderr: '', exitCode: 0, status: 'success' }))
  assert.equal(formatAgentTerminalTranscript(transcript), 'tcp LISTEN 0 511 0.0.0.0:80\r\n')
  const terminal = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'), 'utf8')
  assert.match(terminal, /writeAgentTerminalResult/)
  assert.match(terminal, /limit: 64 \* 1024/)
})

test('terminal Agent input stays local while card approvals use explicit buttons', () => {
  const terminal = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'), 'utf8')
  const attachAddon = fs.readFileSync(path.resolve(__dirname, '../../src/client/components/terminal/attach-addon-custom.js'), 'utf8')
  assert.equal(terminal.includes("this.attachAddon._sendData('\\x05\\x15')"), true)
  assert.match(terminal, /commitAgentPromptToTerminal/)
  assert.match(terminal, /captureAgentTerminalInput/)
  assert.match(terminal, /if \(this\.hasPendingAgentApproval\(\)\) return true/)
  assert.match(terminal, /handleAgentEmbeddedControl/)
  assert.match(attachAddon, /captureAgentTerminalInput/)
  assert.doesNotMatch(terminal, /archiveAgentSuggestion|agentSessionAnchorLine/)
})
