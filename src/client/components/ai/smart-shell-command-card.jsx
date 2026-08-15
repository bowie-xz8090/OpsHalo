import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Flex, Input, Tag, Tooltip } from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  EditOutlined,
  PlayCircleOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import { estimateCommandRisk } from './smart-shell-utils'

const e = window.translate

function updateHistoryItem (itemId, updates) {
  const index = window.store.aiChatHistory.findIndex(entry => entry.id === itemId)
  if (index === -1) {
    return
  }
  Object.assign(window.store.aiChatHistory[index], updates)
  window.store.aiChatHistory = [...window.store.aiChatHistory]
}

function appendShellHistoryToSelectedTabs (entry) {
  const ids = Array.from(window.store.batchInputSelectedTabIds || [])
  if (!ids.length || !window.store.appendSmartShellHistory) {
    return
  }
  ids.forEach(id => {
    window.store.appendSmartShellHistory(id, entry)
  })
}

export default function SmartShellCommandCard ({ item }) {
  const proposal = item.commandProposal || {}
  const initialCommand = proposal.command || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialCommand)

  useEffect(() => {
    setDraft(initialCommand)
    setEditing(false)
  }, [item.id, initialCommand])

  const risk = useMemo(() => {
    return proposal.risk || estimateCommandRisk(initialCommand)
  }, [proposal.risk, initialCommand])

  const status = proposal.status || item.proposalStatus || 'pending'

  function setProposalState (updates) {
    updateHistoryItem(item.id, {
      commandProposal: {
        ...proposal,
        ...updates
      },
      proposalStatus: updates.status || status,
      response: updates.message || proposal.message || item.response
    })
  }

  function handleCopy () {
    copy(draft || initialCommand)
  }

  function handleExecute () {
    const command = (draft || initialCommand).trim()
    if (!command) {
      return
    }
    window.store.runCommandInTerminal(command)
    window.store.addCmdHistory(command)
    appendShellHistoryToSelectedTabs({
      source: 'ai',
      status: 'executed',
      prompt: item.prompt,
      command,
      cwd: window.store.currentTab?.cwd || '',
      host: window.store.currentTab?.host || '',
      tabType: window.store.currentTab?.type || '',
      skill: proposal.skill || 'linux',
      notes: proposal.notes || []
    })
    updateHistoryItem(item.id, {
      commandProposal: {
        ...proposal,
        command,
        executedAt: Date.now(),
        status: 'executed'
      },
      proposalStatus: 'executed',
      response: proposal.message || item.response
    })
  }

  function handleSave () {
    const command = draft.trim()
    setEditing(false)
    setProposalState({
      command,
      status: 'pending'
    })
  }

  function handleReject () {
    setEditing(false)
    updateHistoryItem(item.id, {
      commandProposal: {
        ...proposal,
        status: 'rejected',
        rejectedAt: Date.now()
      },
      proposalStatus: 'rejected'
    })
  }

  const command = editing ? draft : initialCommand
  const canExecute = !!command.trim() && status !== 'rejected'
  const skill = proposal.skill || 'linux'

  return (
    <div className={`smart-shell-command-card smart-shell-${status}`}>
      <Alert
        type={status === 'executed' ? 'success' : status === 'rejected' ? 'warning' : 'info'}
        showIcon
        title={proposal.message || item.response || 'Command proposal'}
      />
      <Flex className='smart-shell-meta mg1t' align='center' gap={6} wrap>
        <Tag color='purple'>
          {skill}
        </Tag>
        <Tag color={risk === 'read_only' ? 'blue' : risk === 'changes_files' ? 'gold' : risk === 'network' ? 'orange' : risk === 'privileged' ? 'red' : 'default'}>
          {risk}
        </Tag>
        <Tag color={status === 'executed' ? 'green' : status === 'rejected' ? 'default' : 'processing'}>
          {status}
        </Tag>
        {proposal.needs_confirmation && <Tag>confirm</Tag>}
      </Flex>
      {proposal.contextSummary && (
        <div className='smart-shell-context mg1t'>
          {proposal.contextSummary}
        </div>
      )}

      <div className='smart-shell-command-body mg1t'>
        {editing
          ? (
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 12 }}
              spellCheck={false}
            />
            )
          : (
            <pre className='smart-shell-command-pre'>{initialCommand || 'No command was generated.'}</pre>
            )}
      </div>

      {!!proposal.notes?.length && (
        <div className='smart-shell-notes mg1t'>
          {proposal.notes.map((note, index) => (
            <div key={`${note}-${index}`} className='smart-shell-note'>
              {note}
            </div>
          ))}
        </div>
      )}

      <Flex className='smart-shell-actions mg1t' justify='end' gap={8} wrap>
        <Tooltip title={e('copy') || 'Copy'}>
          <Button
            size='small'
            icon={<CopyOutlined />}
            onClick={handleCopy}
          />
        </Tooltip>
        {editing
          ? (
            <Button
              size='small'
              type='primary'
              icon={<SaveOutlined />}
              onClick={handleSave}
              disabled={!draft.trim()}
            >
              Save
            </Button>
            )
          : (
            <Button
              size='small'
              icon={<EditOutlined />}
              onClick={() => setEditing(true)}
              disabled={status === 'rejected'}
            >
              Modify
            </Button>
            )}
        <Button
          size='small'
          type='primary'
          icon={<PlayCircleOutlined />}
          onClick={handleExecute}
          disabled={!canExecute}
        >
          Execute
        </Button>
        <Button
          size='small'
          danger
          icon={<CloseOutlined />}
          onClick={handleReject}
          disabled={status === 'rejected' || status === 'executed'}
        >
          Reject
        </Button>
      </Flex>
    </div>
  )
}
