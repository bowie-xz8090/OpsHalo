import { useState, useCallback, useEffect } from 'react'
import { Flex, Input, Segmented, Button } from 'antd'
import TabSelect from '../footer/tab-select'
import AiChatHistory from './ai-chat-history'
import AiChatSessions from './ai-chat-sessions'
import uid from '../../common/uid'
import { pick } from 'lodash-es'
import {
  SettingOutlined,
  SendOutlined,
  PlusOutlined,
  HistoryOutlined,
  CompressOutlined
} from '@ant-design/icons'
import {
  aiConfigWikiLink,
  aiChatModeLsKey
} from '../../common/constants'
import { getItem, setItem } from '../../common/safe-local-storage.js'
import HelpIcon from '../common/help-icon'
import { refsStatic } from '../common/ref'
import {
  classifySmartInput,
  estimateCommandRisk,
  selectSmartShellSkill
} from './smart-shell-utils'
import './ai.styl'

const { TextArea } = Input
const MAX_HISTORY = 500

function appendShellHistoryToSelectedTabs (entry) {
  const ids = Array.from(window.store.batchInputSelectedTabIds || [])
  if (!ids.length || !window.store.appendSmartShellHistory) {
    return
  }
  ids.forEach(id => {
    window.store.appendSmartShellHistory(id, entry)
  })
}

export default function AIChat (props) {
  const [prompt, setPrompt] = useState('')
  const [compressing, setCompressing] = useState(false)
  const [mode, setMode] = useState(() => getItem(aiChatModeLsKey) || 'smart')
  const isAgent = mode === 'agent'
  const submitDisabled = isAgent && props.agentRunning

  const currentChatSessionId = props.currentChatSessionId || ''

  useEffect(() => {
    if (!currentChatSessionId && props.rightPanelTab === 'ai') {
      window.store.startNewChat()
    }
  }, [currentChatSessionId, props.rightPanelTab])

  const sessionHistory = (props.aiChatHistory || []).filter(
    h => h.chatSessionId === currentChatSessionId
  )

  function handlePromptChange (e) {
    setPrompt(e.target.value)
  }

  function handleModeChange (val) {
    const m = val === 'smart' || val === 'ask' ? val : 'agent'
    setItem(aiChatModeLsKey, m)
    setMode(m)
  }

  function createChatEntry (updates) {
    const chatEntry = {
      prompt,
      response: '',
      isStreaming: false,
      pending: false,
      sessionId: null,
      chatSessionId: currentChatSessionId,
      mode,
      toolCalls: [],
      ...pick(props.config, [
        'nameAI',
        'modelAI',
        'roleAI',
        'baseURLAI',
        'apiPathAI',
        'apiKeyAI',
        'proxyAI',
        'languageAI',
        'authHeaderNameAI'
      ]),
      timestamp: Date.now(),
      id: uid(),
      ...updates
    }

    window.store.aiChatHistory.push(chatEntry)
    if (window.store.aiChatHistory.length > MAX_HISTORY) {
      window.store.aiChatHistory.splice(MAX_HISTORY)
    }
    return chatEntry
  }

  function runCommandDirectly (command, promptText) {
    const currentTab = window.store.currentTab || {}
    const chatEntry = createChatEntry({
      prompt: promptText || command,
      response: 'Command sent to the active terminal.',
      smartInputType: 'command',
      proposalStatus: 'executed',
      commandProposal: {
        message: 'Detected as a Linux command and sent directly to the terminal.',
        command,
        risk: estimateCommandRisk(command),
        needs_confirmation: false,
        notes: [],
        classification: 'command',
        status: 'executed',
        executedAt: Date.now()
      }
    })
    window.store.addCmdHistory(command)
    appendShellHistoryToSelectedTabs({
      source: 'manual',
      status: 'executed',
      prompt: promptText || command,
      command,
      cwd: currentTab.cwd || '',
      host: currentTab.host || '',
      tabType: currentTab.type || '',
      skill: selectSmartShellSkill(command, {
        tab: currentTab,
        cwd: currentTab.cwd || '',
        host: currentTab.host || '',
        tabType: currentTab.type || ''
      })
    })
    window.store.runCommandInTerminal(command)
    return chatEntry
  }

  const handleSubmit = useCallback(function () {
    const trimmed = prompt.trim()
    if (!trimmed) return

    if (mode === 'smart') {
      const classification = classifySmartInput(trimmed)
      if (classification.type === 'command') {
        runCommandDirectly(trimmed, trimmed)
        setPrompt('')
        return
      }
      if (window.store.aiConfigMissing()) {
        window.store.toggleAIConfig()
        return
      }
      createChatEntry({
        prompt: trimmed,
        response: 'Analyzing request...',
        pending: true,
        smartShell: true,
        smartInputType: 'natural',
        commandProposal: {
          message: 'Analyzing request...',
          command: '',
          risk: 'unknown',
          needs_confirmation: true,
          notes: [],
          classification: 'natural',
          status: 'pending'
        }
      })
      setPrompt('')
      return
    }

    if (window.store.aiConfigMissing()) {
      window.store.toggleAIConfig()
      return
    }

    createChatEntry({
      prompt: trimmed,
      pending: true
    })
    setPrompt('')
  }, [prompt, mode, currentChatSessionId, props.config])

  function renderHistory () {
    if (props.showChatSessions) {
      return (
        <AiChatSessions
          sessions={window.store.getChatSessions()}
          currentChatSessionId={currentChatSessionId}
          onLoadSession={(sid) => window.store.loadChatSession(sid)}
          onDeleteSession={(sid) => window.store.deleteChatSession(sid)}
          onClearAll={() => window.store.clearAllChatSessions()}
        />
      )
    }
    return (
      <AiChatHistory
        history={sessionHistory}
      />
    )
  }

  function toggleConfig () {
    window.store.toggleAIConfig()
  }

  function handleNewChat () {
    window.store.startNewChat()
  }

  async function handleCompressSession () {
    setCompressing(true)
    try {
      await window.store.compressChatSession(currentChatSessionId)
    } finally {
      setCompressing(false)
    }
  }

  function handleShowHistory () {
    window.store.toggleChatSessions()
  }

  function renderTabSelect () {
    if (isAgent) {
      return null
    }
    return (
      <TabSelect
        selectedTabIds={props.selectedTabIds}
        tabs={props.tabs}
        activeTabId={props.activeTabId}
      />
    )
  }

  function renderSendIcon () {
    if (submitDisabled) {
      return (
        <SendOutlined
          className='mg1l send-to-ai-icon disabled'
          title='Agent is running, please wait'
        />
      )
    }
    return (
      <SendOutlined
        onClick={handleSubmit}
        className='mg1l pointer icon-hover send-to-ai-icon'
        title='Enter to send, Shift+Enter for new line'
      />
    )
  }

  useEffect(() => {
    refsStatic.add('AIChat', {
      setPrompt,
      handleSubmit
    })
    if (props.rightPanelTab === 'ai' && window.store.aiConfigMissing()) {
      window.store.toggleAIConfig()
    }
    return () => {
      refsStatic.remove('AIChat')
    }
  }, [handleSubmit])

  if (props.rightPanelTab !== 'ai') {
    return null
  }

  const handleKeyPress = (e) => {
    if (!e.shiftKey) {
      e.preventDefault()
      if (!submitDisabled) {
        handleSubmit()
      }
    }
  }
  const e = window.translate
  return (
    <Flex vertical className='ai-chat-container'>
      <Flex className='ai-chat-history' flex='auto'>
        {renderHistory()}
      </Flex>

      <Flex vertical className='ai-chat-input'>
        <Flex className='ai-chat-toolbar mg1b' align='left' gap={4}>
          <Button
            size='small'
            icon={<PlusOutlined />}
            onClick={handleNewChat}
            className='mg1r new-chat-btn'
          >
            {e('new')}
          </Button>
          {sessionHistory.length >= 2 && (
            <Button
              size='small'
              icon={<CompressOutlined />}
              onClick={handleCompressSession}
              loading={compressing}
              className='mg1r'
            >
              {e('compress')}
            </Button>
          )}
          <Button
            size='small'
            icon={<HistoryOutlined />}
            onClick={handleShowHistory}
            type={props.showChatSessions ? 'primary' : 'default'}
          >
            {e('history')}
          </Button>
        </Flex>
        <TextArea
          value={prompt}
          onChange={handlePromptChange}
          onPressEnter={handleKeyPress}
          placeholder={mode === 'smart'
            ? 'Type a Linux command or natural language request'
            : 'Enter your prompt here'}
          autoSize={{ minRows: 3, maxRows: 10 }}
          className='ai-chat-textarea'
        />
        <Flex className='ai-chat-terminals' justify='space-between' align='center'>
          <Flex align='center'>
            <Segmented
              options={[
                { label: 'Smart', value: 'smart' },
                { label: 'Ask', value: 'ask' },
                { label: 'Agent', value: 'agent' }
              ]}
              value={mode}
              onChange={handleModeChange}
              size='small'
            />
            {renderTabSelect()}
            <SettingOutlined
              onClick={toggleConfig}
              className='mg1l pointer icon-hover toggle-ai-setting-icon'
            />
            <HelpIcon
              link={aiConfigWikiLink}
            />
          </Flex>
          {renderSendIcon()}
        </Flex>
      </Flex>
      {window.et.AIDisclamer && (
        <div className='ai-disclamer mg1t'>{window.et.AIDisclamer}</div>
      )}
    </Flex>
  )
}
