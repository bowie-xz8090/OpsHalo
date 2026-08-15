import { useEffect, useState } from 'react'
import { Button, Input, Tag } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'

export default function AgentApprovalCard ({ approval, onDecision, onRevise }) {
  const [editing, setEditing] = useState(false)
  const [command, setCommand] = useState('')
  useEffect(() => {
    setEditing(false)
    setCommand(approval?.toolName === 'shell.exec' ? approval.fullCommandOrArguments : '')
  }, [approval?.approvalRequestId])
  if (!approval) return null
  const allowed = new Set(approval.allowedDecisions || [])
  const permanentlyBlocked = approval.risk === 'R5'
  const decide = choice => onDecision({
    approvalRequestId: approval.approvalRequestId,
    choice,
    intentDigest: approval.intentDigest,
    decidedAt: new Date().toISOString()
  })
  return (
    <section className='agent-approval-card' role='dialog' aria-label='Agent 操作审批' tabIndex='-1'>
      <div className='agent-approval-head'>
        <div className='agent-approval-title'>
          {permanentlyBlocked ? '该操作已被安全策略阻断' : '是否同意执行以下操作并查看输出？'}
        </div>
        <div className='agent-approval-actions is-primary'>
          {!editing && !permanentlyBlocked && allowed.has('approve_once') && (
            <Button type='primary' size='small' icon={<PlayCircleOutlined />} onClick={() => decide('approve_once')}>执行</Button>
          )}
          {approval.toolName === 'shell.exec' && !editing && !permanentlyBlocked && (
            <Button size='small' icon={<EditOutlined />} onClick={() => setEditing(true)}>修改</Button>
          )}
          {editing && (
            <Button
              type='primary'
              size='small'
              icon={<CheckOutlined />}
              disabled={!command.trim() || command === approval.fullCommandOrArguments}
              onClick={() => onRevise(command.trim())}
            >
              重新检查
            </Button>
          )}
          {editing && <Button size='small' onClick={() => setEditing(false)}>取消修改</Button>}
          {allowed.has('reject') && <Button size='small' icon={<CloseOutlined />} onClick={() => decide('reject')}>拒绝</Button>}
        </div>
      </div>

      <div className='agent-approval-risk-line'>
        <Tag color={riskColor(approval.risk)}>{approval.risk} {riskLabel(approval.risk)}</Tag>
        <span>{approval.username}@{approval.host}:{approval.port}</span>
        <span aria-hidden='true'>·</span>
        <span>超时 {Math.round(approval.timeoutMs / 1000)} 秒</span>
      </div>

      {editing
        ? (
          <Input.TextArea
            className='agent-approval-editor'
            value={command}
            onChange={event => setCommand(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 10 }}
            maxLength={8000}
          />
          )
        : <pre className='agent-approval-command'>{approval.fullCommandOrArguments}</pre>}

      <details className='agent-approval-details'>
        <summary>查看影响、验证与完整风险信息</summary>
        <dl>
          <dt>工作目录</dt><dd>{approval.cwd}</dd>
          <dt>工具</dt><dd>{approval.toolName}</dd>
          <dt>预期影响</dt><dd>{approval.expectedEffect}</dd>
          <dt>影响资源</dt><dd>{approval.affectedResources?.join(', ') || '未声明额外资源'}</dd>
          <dt>权限/交互</dt><dd>{approval.privilegeAndInteraction?.join(', ') || '无'}</dd>
          <dt>前置检查</dt><dd>{approval.prechecks?.join('；') || '无'}</dd>
          <dt>成功验证</dt><dd>{approval.verificationChecks?.join('；') || '未声明'}</dd>
          <dt>回滚</dt><dd>{approval.rollbackSummary || '无自动回滚；失败后需重新决策'}</dd>
          <dt>风险原因</dt><dd>{approval.riskReasons?.join('；') || '由工具安全元数据和命令分析确定'}</dd>
        </dl>
      </details>
      <small className='agent-approval-expiry'>审批将在 {new Date(approval.expiresAt).toLocaleTimeString()} 过期；Enter 和 Escape 不会批准。</small>
    </section>
  )
}

function riskColor (risk) {
  if (risk === 'R5' || risk === 'R4') return 'red'
  if (risk === 'R3') return 'orange'
  return 'gold'
}

function riskLabel (risk) {
  return {
    R0: '无远端影响',
    R1: '低风险只读',
    R2: '需确认读取',
    R3: '可逆变更',
    R4: '高风险操作',
    R5: '禁止操作'
  }[risk] || ''
}
