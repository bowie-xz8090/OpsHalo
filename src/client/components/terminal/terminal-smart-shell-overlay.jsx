import { useEffect, useMemo, useState } from 'react'
import { Button, Input } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import classnames from 'classnames'

export default function TerminalSmartShellOverlay ({
  proposal,
  anchor,
  onExecute,
  onSave,
  onReject
}) {
  const [editing, setEditing] = useState(false)
  const [draftCommand, setDraftCommand] = useState('')

  useEffect(() => {
    if (!proposal) {
      return
    }
    const initialCommand = String(proposal.editableCommand || proposal.command || '')
    setDraftCommand(initialCommand)
    setEditing(!initialCommand.trim() && proposal.status !== 'pending')
  }, [proposal?.id, proposal?.command, proposal?.editableCommand, proposal?.status])

  useEffect(() => {
    if (!proposal) {
      return undefined
    }
    function handleKeyDown (e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editing && String(proposal.command || '').trim()) {
          handleCancelEdit()
          return
        }
        onReject?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [proposal, editing, onReject])

  const command = editing ? draftCommand : String(proposal?.command || '')
  const trimmedCommand = command.trim()
  const canExecute = !!trimmedCommand && proposal?.status !== 'pending' && !editing

  const message = proposal?.message || (proposal?.status === 'pending'
    ? 'AI 正在分析请求…'
    : 'No command was generated.')

  const notes = useMemo(() => {
    return Array.isArray(proposal?.notes) ? proposal.notes.filter(Boolean) : []
  }, [proposal?.notes])
  const overlayStyle = useMemo(() => {
    if (!anchor) {
      return undefined
    }
    const scale = anchor.scale || 1
    const height = anchor.height || anchor.maxHeight
    return {
      top: anchor.top,
      left: anchor.left,
      width: anchor.width,
      height: height ? `${height}px` : undefined,
      maxWidth: anchor.maxWidth ? `${anchor.maxWidth}px` : undefined,
      maxHeight: anchor.maxHeight ? `${anchor.maxHeight}px` : undefined,
      fontSize: `${anchor.fontSize || 14}px`,
      '--smart-shell-scale': String(scale),
      '--smart-shell-height': height ? `${height}px` : undefined
    }
  }, [anchor])

  if (!proposal) return null

  function handleModify () {
    setDraftCommand(String(proposal.command || proposal.editableCommand || ''))
    setEditing(true)
  }

  function handleCancelEdit () {
    setDraftCommand(String(proposal.command || ''))
    setEditing(false)
  }

  function handleSave () {
    onSave?.(draftCommand)
    setEditing(false)
  }

  function handleEditorKeyDown (e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (String(proposal.command || '').trim()) {
        handleCancelEdit()
      }
    }
  }

  let editAction
  if (editing) {
    editAction = (
      <Button
        size='small'
        icon={<CheckOutlined />}
        onClick={handleSave}
      >
        保存修改
      </Button>
    )
  } else {
    editAction = (
      <Button
        size='small'
        icon={<EditOutlined />}
        onClick={handleModify}
        disabled={proposal.status === 'pending'}
      >
        修改
      </Button>
    )
  }

  let commandBlock
  if (editing) {
    commandBlock = (
      <Input.TextArea
        value={draftCommand}
        onChange={(e) => setDraftCommand(e.target.value)}
        onKeyDown={handleEditorKeyDown}
        autoSize={false}
        rows={3}
        className='terminal-smart-shell-editor'
      />
    )
  } else {
    commandBlock = (
      <pre
        className={classnames('terminal-smart-shell-command', {
          empty: !trimmedCommand
        })}
      >
        {trimmedCommand || 'No command was generated.'}
      </pre>
    )
  }

  return (
    <div
      className={classnames('terminal-smart-shell-overlay', {
        'is-anchored': !!anchor
      })}
      style={overlayStyle}
    >
      <div className='terminal-smart-shell-card'>
        <div className='terminal-smart-shell-head'>
          <div className='terminal-smart-shell-title'>
            是否同意执行以下命令并查看输出?
          </div>
          <div className='terminal-smart-shell-buttons'>
            {editAction}
            <Button
              size='small'
              type='primary'
              icon={<PlayCircleOutlined />}
              onClick={() => onExecute?.(trimmedCommand)}
              disabled={!canExecute}
            >
              执行
            </Button>
            <Button
              size='small'
              icon={<CloseOutlined />}
              onClick={() => onReject?.()}
            >
              取消
            </Button>
          </div>
        </div>

        <div className='terminal-smart-shell-message'>
          {message}
        </div>

        {commandBlock}

        {notes.length > 0 && (
          <div className='terminal-smart-shell-notes'>
            {notes.map((note, index) => (
              <div key={`${proposal.id}-note-${index}`}>
                • {note}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
