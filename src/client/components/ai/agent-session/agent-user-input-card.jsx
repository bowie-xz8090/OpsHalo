import { Alert, Button } from 'antd'

export default function AgentUserInputCard ({ request, onCancel, onHandoff }) {
  if (!request) return null
  if (request.kind === 'terminal_handoff') {
    return (
      <section className='agent-user-input-card'>
        <Alert type='warning' title='需要用户接管终端' description='AI 不会读取、保存或输入密码。接管结束后会重新探查环境，原审批不会复用。' />
        <p>{request.question}</p>
        <Button type='primary' onClick={onHandoff}>接管终端输入</Button>
        <Button onClick={onCancel}>取消该操作</Button>
      </section>
    )
  }
  return (
    <section className='agent-user-input-card'>
      <strong>需要你确认任务范围</strong>
      <p>{request.question}</p>
      {request.safeContext && <p className='muted'>{request.safeContext}</p>}
      <p className='muted'>本轮不会继续执行。请关闭结果后，直接在下方 Shell 光标输入下一条自然语言问题。</p>
      <Button onClick={onCancel}>结束本轮</Button>
    </section>
  )
}
