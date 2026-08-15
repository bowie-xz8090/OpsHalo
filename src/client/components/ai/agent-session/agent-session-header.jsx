import { useEffect, useState } from 'react'
import { Button, Tooltip } from 'antd'
import {
  CloseOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined
} from '@ant-design/icons'
import {
  currentAgentActivity,
  isTerminalAgentStatus
} from '../../../store/agent-session-view.mjs'

const statusLabels = {
  intake: 'AI 正在准备…',
  planning: 'AI 正在思考…',
  policy_check: '正在检查操作安全性…',
  awaiting_approval: '等待你的确认',
  executing: '正在执行服务器探查…',
  observing: '正在读取执行结果…',
  reducing: '正在整理关键信息…',
  evaluating: 'AI 正在分析结果…',
  awaiting_user: '等待你补充信息',
  verifying: '正在验证结论…',
  paused: '任务已暂停',
  complete: '任务已完成',
  inconclusive: '证据不足',
  blocked: '操作已阻断',
  partial: '任务部分完成',
  failed: '任务失败',
  cancelled: '任务已取消'
}

export default function AgentSessionHeader ({ session, onControl, onClose, minimal = false }) {
  const [now, setNow] = useState(Date.now())
  const terminal = isTerminalAgentStatus(session.status)
  useEffect(() => {
    if (terminal || session.status === 'paused') return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [terminal, session.status])

  const elapsed = getLiveElapsed(session, now, terminal)
  const label = minimal ? currentAgentActivity(session) : (statusLabels[session.status] || session.status)
  return (
    <header className={`agent-session-header${minimal ? ' is-minimal' : ''}`} role='status' aria-live='polite'>
      <div className='agent-session-status'>
        {!terminal && session.status !== 'paused'
          ? <span className='agent-session-spinner' aria-hidden='true' />
          : <span className={`agent-session-state-dot is-${session.status}`} aria-hidden='true' />}
        <strong>{label}</strong>
        {!minimal && (
          <span className='agent-session-meta'>
            {session.budget?.reactSteps?.used || 0}/{session.budget?.reactSteps?.max || 12} 步
            <span aria-hidden='true'> · </span>
            {formatDuration(elapsed)}
          </span>
        )}
      </div>
      <div className='agent-session-controls'>
        {!terminal && (session.status === 'paused'
          ? (
            <Tooltip title='继续任务'>
              <Button type='text' size='small' aria-label='继续任务' icon={<PlayCircleOutlined />} onClick={() => onControl('resume')} />
            </Tooltip>
            )
          : !minimal && !session._optimistic
              ? (
                <Tooltip title='暂停任务'>
                  <Button type='text' size='small' aria-label='暂停任务' icon={<PauseOutlined />} onClick={() => onControl('pause')} />
                </Tooltip>
                )
              : null)}
        {!terminal && (
          <Tooltip title='停止 AI（Ctrl+C）'>
            <Button
              type='text'
              size='small'
              danger
              className='agent-stop-button'
              aria-label='停止 AI（Ctrl+C）'
              icon={<StopOutlined />}
              onClick={() => onControl('cancel', { reason: 'user_stop_button' })}
            />
          </Tooltip>
        )}
        <Tooltip title={terminal ? '关闭结果' : '关闭并停止 AI'}>
          <Button
            type='text'
            size='small'
            className='agent-close-button'
            aria-label={terminal ? '关闭 AI 结果' : '关闭并停止 AI'}
            icon={<CloseOutlined />}
            onClick={onClose}
          />
        </Tooltip>
      </div>
    </header>
  )
}

function getLiveElapsed (session, now, terminal) {
  if (session._startedAt) return Math.max(0, (terminal ? session._projectedAt || now : now) - session._startedAt)
  const base = session.budget?.elapsedMs || 0
  return terminal ? base : base + Math.max(0, now - (session._projectedAt || now))
}

function formatDuration (milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
