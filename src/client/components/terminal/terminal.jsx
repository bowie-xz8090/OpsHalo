import { Component, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { isEqual, pick, debounce, throttle } from 'lodash-es'
import clone from '../../common/to-simple-obj.js'
import resolve from '../../common/resolve.js'
import {
  Spin,
  Dropdown,
  Button
} from 'antd'
import message from '../common/message'
import { notification } from '../common/notification'
import ShowItem from '../common/show-item.jsx'
import Modal from '../common/modal'
import classnames from 'classnames'
import './terminal.styl'
import {
  agentInputMode,
  normalizeAgentInputMode,
  resolveSmartInputRoute
} from './agent-input-mode.mjs'
import {
  calculateSmartShellOverlayPadding,
  createOptimisticAgentSession,
  failOptimisticAgentSession,
  isTerminalAgentStatus
} from '../../store/agent-session-view.mjs'
import {
  formatAgentTerminalTranscript,
  parseAgentEvidenceTranscript
} from '../../common/agent-terminal-transcript.mjs'
import {
  readTerminalInput,
  readTerminalLogicalLine,
  readTerminalPrompt
} from '../../common/terminal-input-line.mjs'
import {
  statusMap,
  paneMap,
  typeMap,
  isWin,
  rendererTypes,
  isMac,
  isMacJs,
  connectionMap
} from '../../common/constants.js'
import deepCopy from 'json-deep-copy'
import { readClipboardAsync, readClipboard, copy } from '../../common/clipboard.js'
import AttachAddon from './attach-addon-custom.js'
import getProxy from '../../common/get-proxy.js'
import { ZmodemClient } from './zmodem-client.js'
import { TrzszClient } from './trzsz-client.js'
import DropFileModal from './drop-file-modal.jsx'
import keyControlPressed from '../../common/key-control-pressed.js'
import NormalBuffer from './normal-buffer.jsx'
import {
  createTerm,
  resizeTerm,
  startTerminalLogFile,
  toggleTerminalLog,
  execCmd
} from './terminal-apis.js'
import { shortcutExtend, shortcutDescExtend } from '../shortcuts/shortcut-handler.js'
import { KeywordHighlighterAddon } from './highlight-addon.js'
import { getFilePath, isUnsafeFilename } from '../../common/file-drop-utils.js'
import { getFolderFromFilePath } from '../sftp/file-read.js'
import { CommandTrackerAddon } from './command-tracker-addon.js'
import { Osc52Addon } from './osc52-addon.js'
import AIIcon from '../icons/ai-icon.jsx'
import { isAIDisabled } from '../../common/ai-feature.js'
import {
  AimOutlined
} from '@ant-design/icons'
import {
  getShellIntegrationCommand,
  detectRemoteShell,
  detectShellType
} from './shell.js'
import iconsMap from '../sys-menu/icons-map.jsx'
import { refs, refsStatic } from '../common/ref.js'
import ExternalLink from '../common/external-link.jsx'
import createDefaultLogPath from '../../common/default-log-path.js'
import SearchResultBar from './terminal-search-bar'
import RemoteFloatControl from '../common/remote-float-control'
import ReconnectOverlay from './reconnect-overlay.jsx'
import TerminalErrorHandle from './terminal-error-handle.jsx'
import TerminalSmartShellOverlay from './terminal-smart-shell-overlay.jsx'
import AgentSessionOverlay from '../ai/agent-session/agent-session-overlay.jsx'
import uid from '../../common/uid'
import { appendMandatoryGuardrails } from '../ai/ai-guardrails'
import {
  buildSmartShellMessages,
  classifySmartInput,
  parseSmartShellResponse,
  buildSmartShellContext,
  buildSmartShellProbeCommand,
  parseSmartShellProbeOutput,
  selectSmartShellSkill
} from '../ai/smart-shell-utils'
import {
  loadTerminal,
  loadFitAddon,
  loadWebLinksAddon,
  loadWebglAddon,
  loadSearchAddon,
  loadLigaturesAddon,
  loadUnicode11Addon,
  loadImageAddon
} from './xterm-loader.js'
import {
  createRendererThemeConfig,
  handleTerminalColorQuery
} from './terminal-color-query.mjs'

const e = window.translate

class Term extends Component {
  constructor (props) {
    super(props)
    this.state = {
      loading: false,
      hasSelection: false,
      saveTerminalLogToFile: !!this.props.config.saveTerminalLogToFile,
      addTimeStampToTermLog: !!this.props.config.addTimeStampToTermLog,
      logPath: this.props.config.sessionLogPath || createDefaultLogPath(),
      logFileName: '',
      recording: false,
      recordingFilePath: '',
      passType: 'password',
      lines: [],
      searchResults: [],
      matchIndex: -1,
      totalLines: 0,
      reconnectCountdown: null,
      terminalError: null,
      dropFileModalVisible: false,
      droppedFiles: [],
      fontSizeChanged: false,
      smartShellProposal: null,
      smartShellOverlayAnchor: null,
      agentSession: null,
      agentInterrupting: false
    }
    this.id = `term-${this.props.tab.id}`
    refs.add(this.id, this)
    this.currentInput = ''
    this.shellInjected = false
    this.shellType = null
    this.smartShellProposalId = ''
    this._smartShellPadLines = 0
    this._smartShellReservedRows = 0
    this._agentTerminalCommands = new Map()
    this._agentRenderedEvidence = new Set()
    this._agentEvidenceRendering = new Set()
    this._agentRenderedTranscripts = new Set()
    this._agentNativeTerminalTasks = new Set()
    this._agentNativeTerminalRunningTasks = new Set()
    this._agentNativeTerminalCompletionSignals = new Set()
    this._agentPendingNativeSessions = new Map()
    this._agentConsumedApprovalIds = new Set()
    this._agentPendingPromptPrefix = ''
    this._agentInputBuffer = null
    this._agentInputCursor = 0
    this._agentInputPrompt = ''
    this._agentEmbeddedEntries = new Map()
    this._agentEmbeddedLiveKey = ''
    this._agentEmbeddedSequence = 0
    this._agentEmbeddedUpdateQueue = Promise.resolve()
    this._agentEmbeddedPositionRaf = null
  }

  domRef = createRef()

  componentDidMount () {
    this.agentSessionUnsubscribe = window.store.subscribeAgentSession?.(
      this.props.tab.id,
      agentSession => {
        if (this.onClose) return
        if (!agentSession) {
          this.setState({ agentSession: null, agentInterrupting: false })
          return
        }
        agentSession = this.normalizeAgentSessionSnapshot(agentSession)
        if (!agentSession) return
        if (agentSession._tabActive === false) return
        if (agentSession.status === 'paused' || ['complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'partial'].includes(agentSession.status)) {
          this._agentManualPauseRequested = false
        }
        this.setState({ agentSession, agentInterrupting: false }, () => {
          this.renderAgentTerminalTranscript(agentSession)
          this.renderAgentTerminalEvidence(agentSession)
            .catch(() => {})
            .finally(() => this.renderAgentEmbeddedSession(agentSession))
        })
      }
    )
    this.initTerminal()
    if (this.props.tab.enableSsh === false) {
      this.props.tab.pane = paneMap.fileManager
    }
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevState.agentSession?.status === 'paused' && this.state.agentSession?.status !== 'paused') {
      this._agentManualPauseRequested = false
      this.agentTerminalHandoff = false
    }
    const shouldChange = (
      prevProps.currentBatchTabId !== this.props.currentBatchTabId &&
      this.props.tab.id === this.props.currentBatchTabId &&
      this.props.pane === paneMap.terminal
    ) || (
      this.props.pane !== prevProps.pane &&
      this.props.pane === paneMap.terminal
    )
    const names = [
      'width',
      'height',
      'left',
      'top'
    ]
    if (
      !isEqual(
        pick(this.props, names),
        pick(prevProps, names)
      )
    ) {
      this.onResize()
    }
    if (shouldChange && this.term) {
      this.term.focus()
      // 标签从 display:none 变为可见时，延迟到下一动画帧再 fit，读取正确布局
      // 尺寸纠正列数；并用 refresh 强制重绘，清除快速连续打开多个连接时隐藏
      // 标签被 0 列 fit 导致的虚假/重复提示符。
      requestAnimationFrame(() => {
        if (this.term && !this.onClose) {
          this.fitAndRefresh()
          setTimeout(() => this.fitAndRefresh(), 80)
        }
      })
    }
    if (
      this.state.smartShellProposal &&
      (
        prevState.smartShellProposal !== this.state.smartShellProposal ||
        !isEqual(pick(this.props, names), pick(prevProps, names))
      )
    ) {
      requestAnimationFrame(() => {
        this.updateSmartShellOverlayAnchor()
        setTimeout(() => this.updateSmartShellOverlayAnchor(), 60)
      })
    } else if (!this.state.smartShellProposal && prevState.smartShellProposal) {
      if (this.state.smartShellOverlayAnchor) {
        this.setState({ smartShellOverlayAnchor: null })
      }
    }
    this.checkConfigChange(
      prevProps,
      this.props
    )
    if (
      prevProps.activeTabId === this.props.tab.id &&
      this.props.activeTabId !== this.props.tab.id &&
      this.isAgentSessionActive()
    ) {
      this.handleAgentControl('pause').catch(() => {})
    }
    const themeChanged = !isEqual(
      this.props.themeConfig,
      prevProps.themeConfig
    )
    // Also detect theme ID changes. Two different themes might share the
    // same terminal colour config but have different UI colours (--main),
    // which means the WebGL background needs to change even though
    // themeConfig (terminal colours) is identical.
    const themeIdChanged = prevProps.config?.theme !== this.props.config?.theme
    if ((themeChanged || themeIdChanged) && this.term) {
      this.registerTerminalColorQueryHandlers(this.term, this.props.themeConfig)
      this.applyTerminalTheme(true)
    }
  }

  componentWillUnmount () {
    this.agentSessionUnsubscribe?.()
    this.agentSessionUnsubscribe = null
    this.disposeAgentEmbeddedEntries()
    window.cancelAnimationFrame(this._agentEmbeddedPositionRaf)
    this._agentEmbeddedPositionRaf = null
    this.agentEmbeddedScrollDisposable?.dispose?.()
    this.agentEmbeddedRenderDisposable?.dispose?.()
    refs.remove(this.id)
    clearTimeout(this.longPressTimer)
    this.longPressTimer = null
    this.touchStartPos = null
    if (window.store.activeTerminalId === this.props.tab.id) {
      window.store.activeTerminalId = ''
    }
    if (this.term) {
      this.term.parent = null
    }
    this.disposeTerminalColorQueryHandlers()
    window.cancelAnimationFrame(this.timers.themeRaf)
    this.timers.themeRaf = null
    Object.keys(this.timers).forEach(k => {
      clearTimeout(this.timers[k])
      this.timers[k] = null
    })
    this.onClose = true
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    if (this.term) {
      this.term.dispose()
      this.term = null
    }
    this.attachAddon = null
    this.fitAddon = null
    this.zmodemClient = null
    this.trzszClient = null
    this.searchAddon = null
    this.fitAddon = null
    this.cmdAddon = null
    this.imageAddon = null
    this.webglContextLossDisposable?.dispose?.()
    this.webglContextLossDisposable = null
    this.webglAddon = null
    this.webglRecovering = false
  }

  terminalConfigProps = [
    {
      name: 'rightClickSelectsWord',
      type: 'glob'
    },
    {
      name: 'fontSize',
      type: 'glob_local'
    },
    {
      name: 'fontFamily',
      type: 'glob_local'
    }
  ]

  initAttachAddon = async () => {
    this.attachAddon = new AttachAddon(
      this.term,
      this.socket,
      isWin && !this.isRemote()
    )
    this.attachAddon.decoder = new TextDecoder(
      this.encode || this.props.tab.encode || 'utf-8'
    )
    await this.attachAddon.activate(this.term)
    if (this.osc52Addon) {
      this.osc52Addon.setSendData(this.attachAddon._sendData.bind(this.attachAddon))
    }
  }

  getValue = (props, type, name) => {
    return type === 'glob'
      ? props.config[name]
      : props.tab[name] || props.config[name]
  }

  checkConfigChange = (prevProps, props) => {
    for (const k of this.terminalConfigProps) {
      const { name, type } = k
      const prev = this.getValue(prevProps, type, name)
      const curr = this.getValue(props, type, name)
      if (
        prev !== curr
      ) {
        this.term.options[name] = curr
        if (['fontFamily', 'fontSize'].includes(name)) {
          this.onResize()
        }
        if (name === 'fontSize') {
          this.originalFontSize = curr
          this.setState({ fontSizeChanged: false })
        }
      }
    }

    // Handle renderer type changes (dom <-> webGL) by reloading the
    // renderer and refreshing the theme so the background color is
    // correct for the new renderer.
    if (
      prevProps.config.rendererType !== props.config.rendererType &&
      this.term
    ) {
      this.reloadWebglRenderer('renderer type change')
        .then(() => this.applyTerminalTheme())
        .catch(e => console.error('renderer type change failed', e))
    }

    // Check for shell integration related config changes
    const prevShowSuggestions = prevProps.config.showCmdSuggestions
    const currShowSuggestions = props.config.showCmdSuggestions
    const prevSftpFollow = prevProps.sftpPathFollowSsh
    const currSftpFollow = props.sftpPathFollowSsh

    if (
      (!prevShowSuggestions && currShowSuggestions) ||
      (!prevSftpFollow && currSftpFollow)
    ) {
      // Config was toggled to true, try to inject shell integration if not already done
      if (this.canInjectShellIntegration() && !this.shellInjected) {
        // If there's an active execution queue, add to it
        if (this.executionQueue && this.executionQueue.length > 0) {
          this.executionQueue.unshift({
            type: 'shell_integration',
            execute: async () => {
              await this.injectShellIntegration()
              if (currSftpFollow) {
                this.attachAddon._sendData('\r')
              }
            }
          })
        } else {
          // No active queue, inject directly
          this.injectShellIntegration().then(() => {
            if (currSftpFollow) {
              this.attachAddon._sendData('\r')
            }
          })
        }
      } else if (this.shellInjected && currSftpFollow) {
        this.getCwd()
      }
    }
    if (
      !prevSftpFollow &&
      currSftpFollow &&
      this.isLocal() &&
      isWin
    ) {
      return this.warnSftpFollowUnsupported()
    }
  }

  timers = {}

  getDomId = () => {
    return `term-${this.props.tab.id}`
  }

  zoom = (v) => {
    const { term } = this
    if (!term) {
      return
    }
    term.options.fontSize = term.options.fontSize + v
    window.store.triggerResize()
    if (this.originalFontSize == null) {
      this.originalFontSize = term.options.fontSize - v
    }
    this.setState({
      fontSizeChanged: term.options.fontSize !== this.originalFontSize
    })
  }

  handleResetFontSize = () => {
    const { term } = this
    if (!term || this.originalFontSize == null) {
      return
    }
    term.options.fontSize = this.originalFontSize
    window.store.triggerResize()
    this.setState({ fontSizeChanged: false })
    term.focus()
  }

  isActiveTerminal = () => {
    return this.props.tab.id === this.props.activeTabId &&
    this.props.tab.pane === paneMap.terminal
  }

  clearShortcut = (e) => {
    e.stopPropagation()
    this.onClear()
  }

  // selectAllShortcut = (e) => {
  //   e.stopPropagation()
  //   this.term.selectAll()
  // }

  copyShortcut = (e) => {
    const sel = this.term.getSelection()
    if (sel) {
      e.stopPropagation()
      this.copySelectionToClipboard()
      return false
    }
  }

  searchShortcut = (e) => {
    e.stopPropagation()
    this.toggleSearch()
  }

  pasteSelectedShortcut = (e) => {
    e.stopPropagation()
    this.tryInsertSelected()
  }

  pasteTextTooLong = () => {
    if (window.et.isWebApp) {
      return false
    }
    const text = readClipboard()
    return text.length > 500
  }

  askUserConfirm = () => {
    Modal.confirm({
      title: e('paste'),
      content: (
        <div>
          <p>{e('paste')}:</p>
          <div className='paste-text'>
            <pre>
              <code>{readClipboard()}</code>
            </pre>
          </div>
        </div>
      ),
      okText: e('ok'),
      cancelText: e('cancel'),
      onOk: () => this.onPaste(true)
    })
  }

  warnSftpFollowUnsupported = () => {
    message.warning(
      <span>
        Fish shell/windows shell is not supported for SFTP follow SSH path feature. See: <ExternalLink to='https://github.com/electerm/electerm/wiki/Warning-about-sftp-follow-ssh-path-function'>wiki</ExternalLink>
      </span>
      , 7)
  }

  pasteShortcut = (e) => {
    if (this.pasteTextTooLong()) {
      this.askUserConfirm()
      e.preventDefault()
      e.stopPropagation()
      return false
    }
    if (isMac) {
      return true
    }
    if (!this.isRemote()) {
      return true
    }
    if (this.term.buffer.active.type !== 'alternate') {
      return false
    }
    return true
  }

  showNormalBufferShortcut = (e) => {
    e.stopPropagation()
    this.openNormalBuffer()
  }

  getSmartShellTab = () => {
    const tabId = this.props.tab?.id
    if (!tabId) {
      return null
    }
    return window.store.tabs.find(tab => tab.id === tabId) || null
  }

  getSmartShellHistory = () => {
    const tab = this.getSmartShellTab()
    return Array.isArray(tab?.smartShellHistory) ? tab.smartShellHistory : []
  }

  appendSmartShellHistory = (entry) => {
    const tabId = this.props.tab?.id
    if (!tabId || !window.store.appendSmartShellHistory) {
      return null
    }
    return window.store.appendSmartShellHistory(tabId, entry)
  }

  updateSmartShellHistory = (entryId, updates) => {
    const tabId = this.props.tab?.id
    if (!tabId || !window.store.updateSmartShellHistory) {
      return null
    }
    return window.store.updateSmartShellHistory(tabId, entryId, updates)
  }

  getRecentCommandHistory = (limit = 12) => {
    return (window.store.terminalCommandHistory || [])
      .slice()
      .sort((a, b) => new Date(b.lastUseTime).getTime() - new Date(a.lastUseTime).getTime())
      .slice(0, limit)
      .map(item => item.cmd)
      .filter(Boolean)
  }

  getTerminalTail = (lineCount = 24) => {
    if (!this.term?.buffer?.active) {
      return ''
    }
    const buffer = this.term.buffer.active
    const bottom = buffer.baseY + buffer.cursorY
    const start = Math.max(0, bottom - lineCount + 1)
    const lines = []
    for (let i = start; i <= bottom; i++) {
      const line = buffer.getLine(i)
      if (!line) {
        continue
      }
      const text = line.translateToString(true).trimEnd()
      if (text.trim()) {
        lines.push(text)
      }
    }
    return lines.join('\n')
  }

  collectSmartShellProbe = async () => {
    if (!this.pid) {
      return null
    }
    try {
      const result = await execCmd(
        this.pid,
        buildSmartShellProbeCommand(),
        2500,
        { silent: true }
      )
      return parseSmartShellProbeOutput(
        result?.stdout || '',
        result?.stderr || '',
        result || {}
      )
    } catch (error) {
      return {
        warnings: [error?.message || String(error)],
        stderr: error?.message || String(error)
      }
    }
  }

  collectSmartShellContext = async (prompt) => {
    const tab = this.props.tab || {}
    const runtimeProbe = await this.collectSmartShellProbe()
    return buildSmartShellContext({
      prompt: String(prompt || '').trim(),
      tab,
      tabId: tab.id || '',
      tabType: tab.type || '',
      host: tab.host || '',
      cwd: this.getCwd() || tab.cwd || '',
      shellType: this.shellType || '',
      isConnected: !!tab.host,
      isRemote: this.isRemote(),
      selectedTabIds: Array.from(window.store._batchInputSelectedTabIds || []),
      recentCommands: this.getRecentCommandHistory(),
      sessionHistory: this.getSmartShellHistory(),
      terminalTail: this.getTerminalTail(),
      runtimeProbe
    })
  }

  clearSmartShellProposal = () => {
    this.clearSmartShellCursorSpace()
    this.smartShellProposalId = ''
    this.setState({
      smartShellProposal: null,
      smartShellOverlayAnchor: null
    })
  }

  clearShellInputLine = () => {
    if (!this.attachAddon?._sendData) {
      return
    }
    // Natural-language text has already been echoed to the shell while typing,
    // so blocking Enter alone is not enough; clear the editable line first.
    const input = String(this.getCurrentInput() || '')
    const shell = String(this.shellType || '').toLowerCase()
    const isWindowsShell = shell.includes('powershell') ||
      shell.includes('pwsh') ||
      shell === 'cmd' ||
      (isWin && !this.isRemote())
    if (isWindowsShell) {
      // Ctrl+U is a readline binding; PowerShell/cmd prints it as literal "^U".
      // Delete the editable text with backspaces instead.
      if (input.length) {
        this.attachAddon._sendData('\b'.repeat(input.length))
      }
      return
    }
    // Move to the end first so a mid-line cursor does not leave the suffix behind.
    this.attachAddon._sendData('\x05\x15')
  }

  /**
   * 固定 AI 提示窗高度（含标题、提示文案、至少 3 行命令预览区）。
   */
  getSmartShellOverlayHeight = (fontSize = 14) => {
    // head + message + 3-line command(+pad) + notes 预留 + margins
    return Math.round(Math.max(12, fontSize) * 18.5)
  }

  /**
   * 在命令行下方预留固定弹窗高度对应的终端行数。
   * 写假换行后必须恢复光标列，否则列落到 0，取消时清屏会擦掉整行命令。
   * 仅当光标靠近底端、下方空间不足时才上移；上方有足够空间时不动。
   */
  ensureSmartShellCursorSpace = () => {
    if (!this.term) {
      return
    }
    this.clearSmartShellCursorSpace()
    const rows = this.term.rows || 0
    if (rows < 4) {
      return
    }
    const fontSize = this.term.options?.fontSize || 14
    const pos = this.getCursorPosition()
    const cellHeight = pos?.cellHeight || (this.domRef.current?.clientHeight / rows) || (fontSize * 1.4)
    const needRows = Math.max(1, Math.ceil((this.getSmartShellOverlayHeight(fontSize) + 12) / cellHeight) + 1)
    this._smartShellReservedRows = needRows
    const cursorY = this.term.buffer.active.cursorY
    const cursorX = this.term.buffer.active.cursorX
    const spaceBelow = rows - cursorY - 1
    // 下方已经够放弹窗：不动光标（不影响中间/上方的情况）
    if (spaceBelow >= needRows) {
      this._smartShellPadLines = 0
      return
    }
    // 底端：多预留 2 行空隙，避免弹窗贴住/挡住光标行
    const need = calculateSmartShellOverlayPadding({ rows, cursorY, reservedRows: needRows })
    if (need <= 0) {
      this._smartShellPadLines = 0
      return
    }
    this._smartShellPadLines = need
    // \r\n 会把列重置为 0；上移后用 CHA 恢复原列（1-based）
    const col = Math.max(1, cursorX + 1)
    this.term.write(
      '\r\n'.repeat(need) + `\x1b[${need}A\x1b[${col}G`,
      () => this.updateSmartShellOverlayAnchor()
    )
  }

  clearSmartShellCursorSpace = () => {
    const need = this._smartShellPadLines || 0
    this._smartShellPadLines = 0
    this._smartShellReservedRows = 0
    if (!need || !this.term) {
      return
    }
    // 光标仍在命令行原列；只擦除下方临时空白行
    this.term.write('\x1b[0J')
  }

  getSmartShellOverlayAnchor = () => {
    if (!this.term || !this.state.smartShellProposal) {
      return null
    }
    const wrapEl = this.domRef.current?.parentElement
    if (!wrapEl) {
      return null
    }
    const wrapRect = wrapEl.getBoundingClientRect()
    const fontSize = Math.max(12, Math.min(16, this.term.options?.fontSize || 14))
    const gap = 12
    const preferredHeight = this.getSmartShellOverlayHeight(fontSize)
    const pos = this.getCursorPosition()
    if (!pos) return null
    const top = Math.max(8, pos.top - wrapRect.top + gap)
    const available = Math.max(120, wrapRect.height - top - 12)
    const height = Math.min(preferredHeight, available)
    return {
      top,
      left: 12,
      width: Math.max(240, wrapRect.width - 24),
      height,
      maxWidth: Math.max(240, wrapRect.width - 24),
      maxHeight: available,
      fontSize,
      scale: Math.max(0.85, Math.min(1.15, wrapRect.width / 900))
    }
  }

  updateSmartShellOverlayAnchor = () => {
    if (!this.state.smartShellProposal) {
      if (this.state.smartShellOverlayAnchor) {
        this.setState({ smartShellOverlayAnchor: null })
      }
      return
    }
    const anchor = this.getSmartShellOverlayAnchor()
    this.setState(prev => {
      if (isEqual(prev.smartShellOverlayAnchor, anchor)) {
        return null
      }
      return { smartShellOverlayAnchor: anchor }
    })
  }

  updateSmartShellProposal = (updates) => {
    this.setState(prev => {
      if (!prev.smartShellProposal) {
        return null
      }
      return {
        smartShellProposal: {
          ...prev.smartShellProposal,
          ...updates
        }
      }
    })
  }

  restoreShellInputLine = (text) => {
    const value = String(text || '')
    if (!value || !this.attachAddon?._sendData) {
      return
    }
    this.attachAddon._sendData(value)
  }

  handleSmartShellReject = () => {
    const proposal = this.state.smartShellProposal
    if (proposal?.id) {
      this.updateSmartShellHistory(proposal.id, {
        status: 'rejected',
        rejectedAt: Date.now()
      })
    }
    // Keep the original command-line text; only close the overlay
    this.clearSmartShellProposal()
    if (this.term && !this.onClose) {
      try {
        this.term.refresh(0, this.term.rows - 1)
      } catch (e) {}
      this.term.focus()
    }
  }

  handleSmartShellSave = (command) => {
    const nextCommand = String(command || '')
    const proposal = this.state.smartShellProposal
    this.updateSmartShellProposal({
      command: nextCommand,
      editableCommand: nextCommand,
      status: 'ready'
    })
    if (proposal?.id) {
      this.updateSmartShellHistory(proposal.id, {
        command: nextCommand,
        editableCommand: nextCommand,
        status: 'ready'
      })
    }
    this.term?.focus()
  }

  handleSmartShellExecute = async (command) => {
    const nextCommand = String(command || '').trim()
    if (!nextCommand) {
      return
    }
    if (this.shouldUseManualHistory()) {
      window.store.addCmdHistory(nextCommand)
    }
    const proposal = this.state.smartShellProposal
    if (proposal?.id) {
      this.updateSmartShellHistory(proposal.id, {
        command: nextCommand,
        status: 'executed',
        executedAt: Date.now()
      })
    } else {
      this.appendSmartShellHistory({
        source: 'smart',
        status: 'executed',
        prompt: nextCommand,
        command: nextCommand,
        executedAt: Date.now(),
        cwd: this.getCwd() || this.props.tab?.cwd || '',
        host: this.props.tab?.host || '',
        tabType: this.props.tab?.type || '',
        skill: selectSmartShellSkill(nextCommand, {
          tab: this.props.tab,
          cwd: this.getCwd() || this.props.tab?.cwd || '',
          host: this.props.tab?.host || '',
          tabType: this.props.tab?.type || ''
        })
      })
    }
    this.clearSmartShellProposal()
    this.clearShellInputLine()
    await new Promise(resolve => setTimeout(resolve, 60))
    this.runQuickCommand(nextCommand)
  }

  startSmartShellAnalysis = async (prompt) => {
    const currentPrompt = String(prompt || '').trim()
    if (!currentPrompt) {
      return false
    }

    const classification = classifySmartInput(currentPrompt)
    if (classification.type === 'command') {
      return false
    }

    const proposalId = uid()
    this.smartShellProposalId = proposalId

    const baseProposal = {
      id: proposalId,
      prompt: currentPrompt,
      response: '',
      command: '',
      editableCommand: '',
      risk: 'unknown',
      needs_confirmation: true,
      notes: [],
      skill: 'linux',
      contextSummary: 'collecting shell context…',
      contextUsed: [],
      assumptions: [],
      status: 'pending',
      message: 'AI 正在分析请求…'
    }

    this.setState({
      smartShellProposal: baseProposal
    }, () => {
      this.updateSmartShellOverlayAnchor()
    })
    const proposalContext = await this.collectSmartShellContext(currentPrompt)
    if (this.onClose || this.smartShellProposalId !== proposalId) {
      return true
    }

    this.appendSmartShellHistory({
      id: proposalId,
      source: 'smart',
      status: 'pending',
      prompt: currentPrompt,
      command: '',
      message: 'AI 正在分析请求…',
      cwd: proposalContext.cwd,
      host: proposalContext.host,
      tabType: proposalContext.tabType,
      skill: proposalContext.skill,
      summary: proposalContext.summary,
      notes: []
    })

    this.setState({
      smartShellProposal: {
        ...baseProposal,
        skill: proposalContext.skill,
        contextSummary: proposalContext.summary
      }
    })
    this.updateSmartShellHistory(proposalId, {
      cwd: proposalContext.cwd,
      host: proposalContext.host,
      tabType: proposalContext.tabType,
      skill: proposalContext.skill,
      summary: proposalContext.summary
    })

    if (window.store.aiConfigMissing()) {
      window.store.toggleAIConfig()
      if (!this.onClose && this.smartShellProposalId === proposalId) {
        this.setState({
          smartShellProposal: {
            ...baseProposal,
            status: 'config-missing',
            message: '请先配置 AI 的地址、模型和密钥，然后再重新提交。'
          }
        })
        this.updateSmartShellHistory(proposalId, {
          status: 'config-missing',
          message: '请先配置 AI 的地址、模型和密钥，然后再重新提交。'
        })
      }
      return true
    }

    try {
      const language = this.props.config.languageAI || window.store.getLangName()
      const role = appendMandatoryGuardrails((this.props.config.roleAI || '') + `;用[${language}]回复`)
      const messages = buildSmartShellMessages(
        currentPrompt,
        proposalContext,
        language
      )
      messages[0].content = appendMandatoryGuardrails(messages[0].content)

      const aiResponse = await window.pre.runGlobalAsync(
        'AIchat',
        currentPrompt,
        this.props.config.modelAI,
        role,
        this.props.config.baseURLAI,
        this.props.config.apiPathAI,
        this.props.config.apiKeyAI,
        this.props.config.proxyAI,
        false,
        this.props.config.authHeaderNameAI,
        messages,
        proposalId
      )

      if (this.onClose || this.smartShellProposalId !== proposalId) {
        return true
      }

      if (aiResponse && aiResponse.error) {
        this.setState({
          smartShellProposal: {
            ...baseProposal,
            status: 'error',
            message: aiResponse.error
          }
        })
        return true
      }

      const proposal = parseSmartShellResponse(aiResponse?.response || '', currentPrompt)
      const command = String(proposal.command || '').trim()
      const skill = proposal.skill || proposalContext.skill
      const contextUsed = proposal.context_used || []
      const assumptions = proposal.assumptions || []
      const contextSummary = proposalContext.summary

      this.setState({
        smartShellProposal: {
          ...baseProposal,
          status: 'ready',
          message: proposal.message || aiResponse?.response || '已生成建议命令。',
          command,
          editableCommand: command,
          risk: proposal.risk,
          needs_confirmation: proposal.needs_confirmation,
          notes: proposal.notes || [],
          skill,
          contextSummary,
          contextUsed,
          assumptions,
          response: aiResponse?.response || ''
        }
      })
      this.updateSmartShellHistory(proposalId, {
        status: 'ready',
        message: proposal.message || aiResponse?.response || '已生成建议命令。',
        command,
        risk: proposal.risk,
        notes: proposal.notes || [],
        skill,
        summary: contextSummary,
        contextUsed
      })
    } catch (error) {
      if (this.onClose || this.smartShellProposalId !== proposalId) {
        return true
      }
      this.setState({
        smartShellProposal: {
          ...baseProposal,
          status: 'error',
          message: error?.message || String(error)
        }
      })
      this.updateSmartShellHistory(proposalId, {
        status: 'error',
        message: error?.message || String(error)
      })
    }
    return true
  }

  isAgentSessionActive = (session = this.state.agentSession) => {
    const status = session?.status
    return !!status && !isTerminalAgentStatus(status)
  }

  hasPendingAgentApproval = (session = this.state.agentSession) => {
    return !!session && (session.status === 'awaiting_approval' || !!session.pendingApproval)
  }

  normalizeAgentSessionSnapshot = session => {
    // Terminal transitions publish their state event immediately before the
    // final-result event. Keep the existing live card until the result body is
    // available so the user never sees an empty "finished" shell.
    if (isTerminalAgentStatus(session?.status) && !session.finalResult) return null
    const approvalRequestId = session?.pendingApproval?.approvalRequestId
    if (!approvalRequestId || !this._agentConsumedApprovalIds.has(approvalRequestId)) return session
    if (session.status === 'awaiting_approval' && !session.finalResult) return null
    return { ...session, pendingApproval: undefined }
  }

  isNewerAgentSessionSnapshot = (nextSession, currentSession) => {
    if (!currentSession) return true
    const nextOrder = [
      Number(nextSession?.snapshotVersion) || 0,
      Number(nextSession?.lastEventSequence) || 0,
      Number(nextSession?._projectedAt) || 0
    ]
    const currentOrder = [
      Number(currentSession?.snapshotVersion) || 0,
      Number(currentSession?.lastEventSequence) || 0,
      Number(currentSession?._projectedAt) || 0
    ]
    for (let index = 0; index < nextOrder.length; index++) {
      if (nextOrder[index] > currentOrder[index]) return true
      if (nextOrder[index] < currentOrder[index]) return false
    }
    return true
  }

  updateAgentSession = (taskId, updater) => {
    this.setState(prev => {
      if (prev.agentSession?.taskId !== taskId) return null
      return { agentSession: updater(prev.agentSession) }
    })
  }

  getAgentEmbeddedRows = () => 2

  isCompactAgentEmbeddedSession = session => {
    return !!session && !session.pendingApproval && !session.pendingUserInput && !session.finalResult
  }

  shouldAnchorAgentCardBelowPrompt = () => {
    const buffer = this.term?.buffer?.active
    const line = readTerminalLogicalLine(buffer)
    const prompt = readTerminalPrompt(buffer) || this._agentPendingPromptPrefix
    return !!prompt && line.trimEnd() === String(prompt).trimEnd()
  }

  writeTerminal = (data = '') => {
    return new Promise(resolve => {
      if (!this.term || this.onClose) return resolve()
      this.term.write(data, resolve)
    })
  }

  queueAgentEmbeddedUpdate = update => {
    this._agentEmbeddedUpdateQueue = this._agentEmbeddedUpdateQueue
      .then(() => update())
      .catch(error => console.error('Agent embedded card update failed', error))
    return this._agentEmbeddedUpdateQueue
  }

  renderAgentEmbeddedSession = (session) => {
    if (!this.term || !session) return
    const snapshot = this.normalizeAgentSessionSnapshot(clone(session))
    if (!snapshot) return
    if (this._agentNativeTerminalRunningTasks.has(snapshot.taskId)) {
      const current = this._agentPendingNativeSessions.get(snapshot.taskId)
      if (this.isNewerAgentSessionSnapshot(snapshot, current)) {
        this._agentPendingNativeSessions.set(snapshot.taskId, snapshot)
      }
      return
    }
    this.queueAgentEmbeddedUpdate(async () => {
      if (!this.term || this.onClose) return
      let entry = this._agentEmbeddedEntries.get(this._agentEmbeddedLiveKey)
      if (entry?.taskId?.startsWith('pending_') && !snapshot.taskId.startsWith('pending_') && entry.session?.prompt === snapshot.prompt) {
        entry.taskId = snapshot.taskId
      }
      if (entry?.frozen || entry?.taskId !== snapshot.taskId) entry = null
      if (
        entry &&
        this.isCompactAgentEmbeddedSession(snapshot) &&
        !this.isCompactAgentEmbeddedSession(entry.session)
      ) {
        entry.frozen = true
        this._agentEmbeddedLiveKey = ''
        this.renderAgentEmbeddedEntry(entry)
        entry = null
      }

      if (!entry) {
        const shouldCreate = snapshot._optimistic ||
          ['intake', 'planning', 'policy_check', 'paused'].includes(snapshot.status) ||
          snapshot.pendingApproval || snapshot.pendingUserInput || snapshot.finalResult
        if (!shouldCreate) return
        entry = await this.createAgentEmbeddedEntry(snapshot)
      } else {
        await this.updateAgentEmbeddedEntry(entry, snapshot)
      }
      if (!entry) return

      if (snapshot.finalResult) {
        entry.frozen = true
        this._agentEmbeddedLiveKey = ''
        entry.needsContentFit = true
        this.renderAgentEmbeddedEntry(entry)
        const fittedBeforePrompt = await this.fitAgentEmbeddedEntryToContent(entry)
        await this.writeTerminal(this._agentPendingPromptPrefix || this.getCurrentPromptPrefix())
        if (!fittedBeforePrompt) {
          entry.needsContentFit = true
          await this.fitAgentEmbeddedEntryToContent(entry)
        }
        await this.revealAgentEmbeddedFinalEntry(entry)
        this.term?.focus()
      }
    })
  }

  createAgentEmbeddedEntry = async session => {
    await this.writeTerminal(this.shouldAnchorAgentCardBelowPrompt() ? '\r\n' : '\r\x1b[2K')
    const marker = this.term?.registerMarker(0)
    if (!marker) return null
    const key = `${session.taskId}:${++this._agentEmbeddedSequence}`
    const entry = {
      key,
      taskId: session.taskId,
      session,
      marker,
      decoration: null,
      root: null,
      element: null,
      rows: this.getAgentEmbeddedRows(session),
      needsContentFit: !this.isCompactAgentEmbeddedSession(session),
      frozen: false
    }
    this._agentEmbeddedEntries.set(key, entry)
    this._agentEmbeddedLiveKey = key
    marker.onDispose(() => this.removeAgentEmbeddedEntry(key, false))
    await this.writeTerminal('\r\n'.repeat(entry.rows))
    this.registerAgentEmbeddedDecoration(entry)
    await this.fitAgentEmbeddedEntryToContent(entry)
    this.term?.scrollToBottom()
    return entry
  }

  updateAgentEmbeddedEntry = async (entry, session) => {
    if (!entry) return
    const nextRows = this.getAgentEmbeddedRows(session)
    const cursorLine = this.term.buffer.active.baseY + this.term.buffer.active.cursorY
    const cursorAdjacent = cursorLine === entry.marker.line + entry.rows
    entry.session = session
    entry.needsContentFit = !this.isCompactAgentEmbeddedSession(session)
    if (nextRows > entry.rows && cursorAdjacent) {
      const addedRows = nextRows - entry.rows
      entry.rows = nextRows
      this.registerAgentEmbeddedDecoration(entry)
      await this.writeTerminal('\r\n'.repeat(addedRows))
    } else {
      this.renderAgentEmbeddedEntry(entry)
    }
    await this.fitAgentEmbeddedEntryToContent(entry)
  }

  waitForAgentEmbeddedPaint = () => new Promise(resolve => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
  })

  fitAgentEmbeddedEntryToContent = async entry => {
    if (!entry?.marker || entry.marker.isDisposed) return false
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.waitForAgentEmbeddedPaint()
      const element = entry.element
      const overlay = element?.querySelector('.agent-session-overlay-inner.is-content-sized')
      if (!element || !overlay) continue
      const cellHeight = this.getAgentEmbeddedCellHeight(element)
      const decorationStyle = window.getComputedStyle(element)
      const verticalPadding = (Number.parseFloat(decorationStyle.paddingTop) || 0) + (Number.parseFloat(decorationStyle.paddingBottom) || 0)
      const contentHeight = Math.max(overlay.scrollHeight, overlay.getBoundingClientRect().height) + verticalPadding + 1
      const requiredRows = Math.max(this.getAgentEmbeddedRows(entry.session), Math.ceil(contentHeight / cellHeight))
      if (requiredRows === entry.rows) {
        entry.needsContentFit = false
        return true
      }
      if (!await this.resizeAgentEmbeddedEntryRows(entry, requiredRows)) {
        entry.needsContentFit = true
        return false
      }
      entry.needsContentFit = false
      return true
    }
    entry.needsContentFit = true
    return false
  }

  resizeAgentEmbeddedEntryRows = async (entry, requiredRows) => {
    if (!this.term || !entry?.marker || entry.marker.isDisposed) return false
    const nextRows = Math.max(this.getAgentEmbeddedRows(entry.session), Math.trunc(Number(requiredRows) || 0))
    if (nextRows === entry.rows) return true
    const buffer = this.term.buffer.active
    const cursorLine = buffer.baseY + buffer.cursorY
    if (cursorLine !== entry.marker.line + entry.rows) return false
    const rowDelta = nextRows - entry.rows
    const currentLine = buffer.getLine(cursorLine)
    const currentText = currentLine?.translateToString(true) || ''
    const currentCursorX = buffer.cursorX
    const currentEndX = this.getAgentTerminalLineEndColumn(currentLine)
    entry.rows = nextRows
    this.registerAgentEmbeddedDecoration(entry)
    if (rowDelta > 0) {
      await this.writeTerminal(`\r\x1b[2K${'\r\n'.repeat(rowDelta)}${currentText}`)
    } else {
      await this.writeTerminal(`\r\x1b[2K\x1b[${Math.abs(rowDelta)}F\x1b[0J${currentText}`)
    }
    const trailingColumns = Math.max(0, currentEndX - currentCursorX)
    if (trailingColumns) await this.writeTerminal(`\x1b[${trailingColumns}D`)
    this.positionAgentEmbeddedDecoration(entry)
    return true
  }

  getAgentTerminalLineEndColumn = line => {
    if (!line) return 0
    let endColumn = 0
    for (let index = 0; index < line.length; index++) {
      const cell = line.getCell(index)
      if (cell?.getChars()) endColumn = index + Math.max(1, cell.getWidth())
    }
    return endColumn
  }

  scheduleAgentEmbeddedFit = entry => {
    window.cancelAnimationFrame(entry?.fitRaf)
    if (!entry || entry.marker?.isDisposed) return
    entry.fitRaf = window.requestAnimationFrame(() => {
      entry.fitRaf = null
      this.queueAgentEmbeddedUpdate(async () => {
        await this.fitAgentEmbeddedEntryToContent(entry)
        this.positionAgentEmbeddedDecoration(entry)
      })
    })
  }

  revealAgentEmbeddedFinalEntry = async entry => {
    if (!this.term || !entry?.marker || entry.marker.isDisposed) return
    await this.waitForAgentEmbeddedPaint()
    this.term.refresh(0, Math.max(0, this.term.rows - 1))
    if (entry.rows >= Math.max(1, this.term.rows - 1)) {
      this.term.scrollToLine(entry.marker.line)
    } else {
      this.term.scrollToBottom()
    }
    await this.waitForAgentEmbeddedPaint()
    this.positionAgentEmbeddedDecoration(entry)
  }

  registerAgentEmbeddedDecoration = entry => {
    if (!this.term || !entry?.marker || entry.marker.isDisposed) return
    if (entry.root) {
      entry.root.unmount()
      entry.root = null
      entry.element = null
    }
    entry.decoration?.dispose?.()
    entry.decoration = this.term.registerDecoration({
      marker: entry.marker,
      x: 0,
      width: Math.max(1, this.term.cols),
      height: entry.rows,
      layer: 'top'
    })
    entry.decoration?.onRender(element => {
      if (entry.element !== element) {
        entry.root?.unmount?.()
        entry.element = element
        entry.element.classList.add('agent-session-decoration')
        entry.root = createRoot(element)
      }
      this.positionAgentEmbeddedDecoration(entry, element)
      this.renderAgentEmbeddedEntry(entry)
      if (entry.needsContentFit) this.scheduleAgentEmbeddedFit(entry)
    })
    // Electron's xterm renderer may not repaint after a decoration is added to
    // rows that were just written, so explicitly request its first render.
    this.term.refresh(0, Math.max(0, this.term.rows - 1))
  }

  positionAgentEmbeddedDecoration = (entry, element = entry?.element) => {
    if (!this.term || !entry?.marker || !element) return false
    const cellHeight = this.getAgentEmbeddedCellHeight(element)
    const canvasWidth = this.term.dimensions?.css?.canvas?.width
    const viewportLine = entry.marker.line - this.term.buffer.active.viewportY
    const intersectsViewport = viewportLine < this.term.rows && viewportLine + entry.rows > 0
    element.style.display = intersectsViewport ? 'block' : 'none'
    if (!intersectsViewport) return false
    element.style.top = `${viewportLine * cellHeight}px`
    element.style.height = `${entry.rows * cellHeight}px`
    element.style.lineHeight = `${cellHeight}px`
    if (canvasWidth) element.style.width = `${canvasWidth}px`
    return true
  }

  getAgentEmbeddedCellHeight = element => {
    const cell = this.term?.dimensions?.css?.cell
    return cell?.height || (this.domRef.current?.clientHeight / this.term.rows) || Number.parseFloat(element?.style?.lineHeight) || 1
  }

  scheduleAgentEmbeddedPositions = () => {
    window.cancelAnimationFrame(this._agentEmbeddedPositionRaf)
    this._agentEmbeddedPositionRaf = window.requestAnimationFrame(() => {
      this._agentEmbeddedPositionRaf = null
      for (const entry of this._agentEmbeddedEntries.values()) {
        this.positionAgentEmbeddedDecoration(entry)
      }
    })
  }

  renderAgentEmbeddedEntry = entry => {
    if (!entry?.root || !entry.session) return
    entry.root.render(
      <AgentSessionOverlay
        session={entry.session}
        embedded
        readOnly={entry.frozen}
        onControl={(action, extra) => this.handleAgentEmbeddedControl(entry, action, extra)}
        getEvidence={request => window.store.getAgentEvidence(request)}
        deleteEvidence={request => window.store.deleteAgentEvidence(request)}
        onHandoff={() => this.handleAgentEmbeddedHandoff(entry)}
        finalDetailsOpen={entry.finalDetailsOpen}
        onLayoutChange={open => {
          entry.finalDetailsOpen = open
          entry.needsContentFit = true
          this.scheduleAgentEmbeddedFit(entry)
        }}
      />
    )
  }

  handleAgentEmbeddedControl = async (entry, action, extra = {}) => {
    if (!entry || entry.frozen) return false
    const previousSession = entry.session
    const approvedExecution = action === 'resolve_approval' &&
      ['approve_once', 'approve_task_exact_match'].includes(extra?.decision?.choice) &&
      ['shell.exec', 'shell.review_exec'].includes(previousSession.pendingApproval?.toolName)
    const approvalRequestId = previousSession.pendingApproval?.approvalRequestId
    let approvalConsumed = false
    if (approvedExecution) {
      approvalConsumed = await this.freezeAgentExecutedApprovalEntry(entry, extra?.decision)
      if (!approvalConsumed) {
        message.error('终端位置正在更新，请再次执行。')
        return false
      }
      if (approvalRequestId) this._agentConsumedApprovalIds.add(approvalRequestId)
    } else if (action === 'resolve_approval') {
      entry.session = {
        ...entry.session,
        status: extra?.decision?.choice === 'reject' ? 'cancelled' : 'executing',
        _embeddedResolvedDecision: extra?.decision
      }
      entry.frozen = true
      this._agentEmbeddedLiveKey = ''
      this.renderAgentEmbeddedEntry(entry)
    }
    const success = await this.handleAgentControl(action, extra, previousSession)
    if (!success && action === 'resolve_approval') {
      if (approvalConsumed) {
        if (approvalRequestId) this._agentConsumedApprovalIds.delete(approvalRequestId)
        entry.session = previousSession
        entry.frozen = false
        entry.needsContentFit = true
        this._agentEmbeddedLiveKey = entry.key
        this.renderAgentEmbeddedEntry(entry)
        await this.fitAgentEmbeddedEntryToContent(entry)
      } else {
        entry.session = previousSession
        entry.frozen = false
        this._agentEmbeddedLiveKey = entry.key
        this.renderAgentEmbeddedEntry(entry)
      }
    }
    return success
  }

  freezeAgentExecutedApprovalEntry = async (entry, decision) => {
    if (!this.term || !entry?.marker || entry.marker.isDisposed) return false
    const previousSession = entry.session
    entry.session = {
      ...previousSession,
      status: 'executing',
      _embeddedResolvedDecision: decision
    }
    entry.frozen = true
    entry.needsContentFit = true
    this._agentEmbeddedLiveKey = ''
    this.renderAgentEmbeddedEntry(entry)
    await this.fitAgentEmbeddedEntryToContent(entry)
    this.term.scrollToBottom()
    return true
  }

  handleAgentEmbeddedHandoff = entry => {
    if (!entry || entry.frozen) return
    this.agentTerminalHandoff = true
    this.handleAgentControl('pause', {}, entry.session).finally(() => this.term?.focus())
  }

  freezeAgentEmbeddedLiveSession = taskId => {
    const entry = this._agentEmbeddedEntries.get(this._agentEmbeddedLiveKey)
    if (!entry || entry.frozen || entry.taskId !== taskId) return
    entry.frozen = true
    this._agentEmbeddedLiveKey = ''
    this.renderAgentEmbeddedEntry(entry)
  }

  removeAgentEmbeddedEntry = (key, disposeMarker = true) => {
    const entry = this._agentEmbeddedEntries.get(key)
    if (!entry) return
    window.cancelAnimationFrame(entry.fitRaf)
    this._agentEmbeddedEntries.delete(key)
    if (this._agentEmbeddedLiveKey === key) this._agentEmbeddedLiveKey = ''
    entry.root?.unmount?.()
    entry.root = null
    entry.decoration?.dispose?.()
    entry.decoration = null
    if (disposeMarker) entry.marker?.dispose?.()
  }

  disposeAgentEmbeddedEntries = () => {
    for (const key of [...this._agentEmbeddedEntries.keys()]) {
      this.removeAgentEmbeddedEntry(key)
    }
  }

  startAgentAnalysis = async (prompt, parentTaskId, forceAgent = false) => {
    const currentPrompt = String(prompt || '').trim()
    if (
      !currentPrompt ||
      !this.props.config.agentModeEnabled ||
      (!forceAgent && normalizeAgentInputMode(this.props.tab.aiInputMode) !== agentInputMode)
    ) return false
    if (window.store.agentAiConfigMissing()) {
      const unavailableSession = failOptimisticAgentSession(
        createOptimisticAgentSession({
          clientRequestId: `config_${uid()}`,
          tabId: this.props.tab.id,
          prompt: currentPrompt
        }),
        new Error('AI 配置不可用，请先完成配置。')
      )
      this.setState({ agentSession: unavailableSession }, () => this.renderAgentEmbeddedSession(unavailableSession))
      window.store.toggleAIConfig()
      return true
    }
    if (this.isAgentSessionActive()) {
      return true
    }
    const clientRequestId = `client_${uid()}`
    const optimisticSession = createOptimisticAgentSession({
      clientRequestId,
      tabId: this.props.tab.id,
      prompt: currentPrompt
    })
    this._pendingAgentStart = { clientRequestId, cancelled: false }
    this.setState({
      agentSession: optimisticSession,
      agentInterrupting: false
    }, () => this.renderAgentEmbeddedSession(optimisticSession))
    try {
      const response = await window.store.startAgentSession({
        schemaVersion: 1,
        clientRequestId,
        tabId: this.props.tab.id,
        prompt: currentPrompt,
        mode: 'diagnose',
        parentTaskId,
        uiLocale: this.props.config.language || 'zh-CN'
      })
      if (this._pendingAgentStart?.clientRequestId === clientRequestId && this._pendingAgentStart.cancelled) {
        await window.store.controlAgentSession(response.taskId, 'cancel', { reason: 'user_cancelled_during_start' }).catch(() => {})
      }
      if (this._pendingAgentStart?.clientRequestId === clientRequestId) this._pendingAgentStart = null
      // Agent mode treats the typed natural language as the visible user record.
      // Keep it on the terminal after Enter so the session reads like a dialogue.
      this.closeSuggestions()
      return true
    } catch (error) {
      if (this._pendingAgentStart?.clientRequestId === clientRequestId) {
        this._pendingAgentStart = null
        this.setState(prev => ({
          agentSession: failOptimisticAgentSession(prev.agentSession || optimisticSession, error),
          agentInterrupting: false
        }), () => this.renderAgentEmbeddedSession(this.state.agentSession))
      }
      return true
    }
  }

  handleAgentControl = async (action, extra = {}, targetSession) => {
    const session = targetSession || this.state.agentSession
    if (!session) return
    if (session._optimistic) {
      if (action !== 'cancel') return false
      if (this._pendingAgentStart) this._pendingAgentStart.cancelled = true
      this.updateAgentSession(session.taskId, current => ({
        ...current,
        status: 'cancelled',
        _optimistic: false,
        statusReason: { code: 'user_cancelled', message: '已停止等待 AI。' },
        finalResult: {
          status: 'cancelled',
          conclusion: '任务已由用户中断。',
          confirmedFacts: [],
          inferences: [],
          operations: [],
          unresolvedItems: [],
          evidenceRefs: []
        }
      }))
      this.setState({ agentInterrupting: false })
      this.renderAgentEmbeddedSession({
        ...session,
        status: 'cancelled',
        _optimistic: false,
        finalResult: {
          status: 'cancelled',
          conclusion: '任务已由用户中断。',
          confirmedFacts: [],
          inferences: [],
          operations: [],
          unresolvedItems: [],
          evidenceRefs: []
        }
      })
      return true
    }
    if (action === 'cancel') {
      this.setState({ agentInterrupting: true })
      this.updateAgentSession(session.taskId, current => ({
        ...current,
        statusReason: { code: 'interrupting', message: '正在中断 AI…（Ctrl+C）' }
      }))
    }
    if (
      action === 'resolve_approval' &&
      ['approve_once', 'approve_task_exact_match'].includes(extra?.decision?.choice) &&
      ['shell.exec', 'shell.review_exec'].includes(session.pendingApproval?.toolName)
    ) {
      const command = String(session.pendingApproval?.fullCommandOrArguments || '').trim()
      if (command) {
        const prompt = this._agentPendingPromptPrefix || this.getCurrentPromptPrefix()
        this._agentTerminalCommands.set(session.taskId, { command, prompt })
        if (session.pendingApproval.toolName === 'shell.review_exec') {
          this._agentNativeTerminalTasks.add(session.taskId)
          this._agentNativeTerminalRunningTasks.add(session.taskId)
          this._agentNativeTerminalCompletionSignals.delete(session.taskId)
          this._agentPendingNativeSessions.delete(session.taskId)
          await new Promise(resolve => setTimeout(resolve, 60))
          this.term?.write(prompt)
          this.runQuickCommand(command)
        } else {
          this.term?.write(`${prompt}\x1b[36m${command}\x1b[0m\r\n`)
        }
      }
    }
    try {
      const controlResult = await window.store.controlAgentSession(session.taskId, action, extra)
      if (action === 'resolve_approval' && controlResult?.snapshot) {
        this.renderAgentTerminalTranscript(controlResult.snapshot)
      }
      return true
    } catch (error) {
      this.setState({ agentInterrupting: false })
      if (error.latestSnapshot) {
        this.updateAgentSession(session.taskId, () => error.latestSnapshot)
        this.renderAgentEmbeddedSession(error.latestSnapshot)
      } else message.error(error.safeMessage || error.message)
      return false
    }
  }

  renderAgentTerminalEvidence = async (session) => {
    const terminalStatuses = ['complete', 'inconclusive', 'blocked', 'failed', 'cancelled', 'partial']
    if (!this.term || !session || !terminalStatuses.includes(session.status)) return
    if (!this._agentTerminalCommands.has(session.taskId)) return
    if (this._agentNativeTerminalTasks.has(session.taskId)) return
    const terminalTranscript = session._terminalTranscript || session.finalResult?.terminalTranscript
    if (this._agentRenderedTranscripts.has(terminalTranscript?.invocationId)) return
    const refs = session.finalResult?.evidenceRefs || []
    const evidenceRef = refs[refs.length - 1]
    if (!evidenceRef || this._agentRenderedEvidence.has(evidenceRef) || this._agentEvidenceRendering.has(evidenceRef)) return
    this._agentEvidenceRendering.add(evidenceRef)
    try {
      let offset = 0
      let content = ''
      do {
        const page = await window.store.getAgentEvidence({ taskId: session.taskId, evidenceRef, offset, limit: 64 * 1024 })
        content += page.content || ''
        offset = page.nextOffset
        if (content.length > 2 * 1024 * 1024) break
      } while (offset !== null)
      const output = formatAgentTerminalTranscript(parseAgentEvidenceTranscript(content))
      this.freezeAgentEmbeddedLiveSession(session.taskId)
      this.writeAgentTerminalResult(session.taskId, output)
      this._agentRenderedEvidence.add(evidenceRef)
    } finally {
      this._agentEvidenceRendering.delete(evidenceRef)
    }
  }

  renderAgentTerminalTranscript = (session) => {
    const transcript = session?._terminalTranscript || session?.finalResult?.terminalTranscript
    if (!this.term || !transcript?.invocationId || this._agentRenderedTranscripts.has(transcript.invocationId)) return
    if (!this._agentTerminalCommands.has(session.taskId)) return
    if (this._agentNativeTerminalTasks.has(session.taskId)) return
    this.freezeAgentEmbeddedLiveSession(session.taskId)
    const output = formatAgentTerminalTranscript(transcript)
    this._agentRenderedTranscripts.add(transcript.invocationId)
    this.writeAgentTerminalResult(session.taskId, output)
  }

  writeAgentTerminalResult = (taskId, output) => {
    const execution = this._agentTerminalCommands.get(taskId)
    if (!this.term || !execution) return
    const result = String(output || '')
    const separator = result && !result.endsWith('\r\n') ? '\r\n' : ''
    this.term.write(`${result}${separator}${execution.prompt || ''}`, () => this.term?.focus())
  }

  commitAgentPromptToTerminal = (promptText) => {
    if (!this.term || !this.attachAddon?._sendData) return false
    const capturedLocally = this._agentInputBuffer !== null
    const promptPrefix = this._agentInputPrompt || this.getCurrentPromptPrefix() || this._agentPendingPromptPrefix
    this._agentPendingPromptPrefix = promptPrefix

    if (!capturedLocally) this.clearShellInputLine()
    this.resetAgentInputDraft()
    this.term.write(
      `${capturedLocally ? '' : `\x1b[36m${String(promptText || '')}\x1b[0m`}\r\n`,
      () => this.term?.focus()
    )
    return true
  }

  shouldInterceptSmartShellEnter = (forceAgent = false) => {
    if (!this.term || this.onClose) {
      return false
    }
    // shortcut-handler and attach-addon may both see the same Enter;
    // only handle it once so Windows backspace-clear does not delete the prompt.
    const now = Date.now()
    if (this._smartShellEnterAt && now - this._smartShellEnterAt < 80) {
      return true
    }
    if (this.term.buffer.active.type === 'alternate') {
      return false
    }
    if (this.attachAddon?._passwordPromptDetected) {
      return false
    }
    if (refsStatic.get('terminal-suggestions')?.state?.passwordMode) {
      return false
    }
    if (this.hasPendingAgentApproval()) return false

    const currentPrompt = String(this.getCurrentInput() || '').trim()
    if (!currentPrompt) {
      return false
    }
    const classification = classifySmartInput(currentPrompt)
    const inputRoute = forceAgent && this.props.config.agentModeEnabled === true
      ? 'agent'
      : resolveSmartInputRoute({
        agentModeEnabled: this.props.config.agentModeEnabled === true,
        inputMode: this.props.tab.aiInputMode,
        inputType: classification.type
      })
    if (inputRoute === 'terminal') {
      return false
    }

    this._smartShellEnterAt = now

    const proposal = this.state.smartShellProposal
    if (proposal && proposal.prompt === currentPrompt) {
      // Keep typed text on the prompt; only ensure room for the overlay
      this.ensureSmartShellCursorSpace()
      requestAnimationFrame(() => {
        this.updateSmartShellOverlayAnchor()
        setTimeout(() => this.updateSmartShellOverlayAnchor(), 80)
      })
      return true
    }

    if (inputRoute === 'agent') {
      const parentTaskId = this.state.agentSession?.taskId
      this.commitAgentPromptToTerminal(currentPrompt)
      this.startAgentAnalysis(currentPrompt, parentTaskId, forceAgent)
    } else {
      this.ensureSmartShellCursorSpace()
      this.startSmartShellAnalysis(currentPrompt)
    }
    this.closeSuggestions()
    if (inputRoute !== 'agent') {
      requestAnimationFrame(() => {
        this.updateSmartShellOverlayAnchor()
        setTimeout(() => this.updateSmartShellOverlayAnchor(), 80)
      })
    }
    return true
  }

  runQuickCommand = (cmd, inputOnly = false) => {
    if (this.term && this.attachAddon) {
      this.attachAddon._sendData(cmd + (inputOnly ? '' : '\r'))
      this.term.focus()
    }
  }

  cd = (p) => {
    if (isUnsafeFilename(p)) {
      return message.error('File name contains unsafe characters')
    }
    const isWinPath = /^[a-zA-Z]:\\/.test(p)
    this.runQuickCommand(isWinPath ? `cd /d "${p}"` : `cd "${p}"`)
  }

  onDrop = e => {
    const dt = e.dataTransfer
    const fromFile = dt.getData('fromFile')
    const notSafeMsg = 'File name contains unsafe characters'
    const isSshTerminal = this.props.tab.type === connectionMap.ssh

    if (fromFile) {
      try {
        const fileData = JSON.parse(fromFile)
        const filePath = resolve(fileData.path, fileData.name)
        if (isUnsafeFilename(filePath)) {
          message.error(notSafeMsg)
          return
        }
        if (isSshTerminal) {
          const behavior = this.props.config.dragDropBehavior || 'ask'
          if (behavior === 'ask') {
            this.setState({
              dropFileModalVisible: true,
              droppedFiles: [{ path: filePath, isRemote: true }]
            })
          } else {
            this.handleDropFileAction(behavior, [{ path: filePath, isRemote: true }])
          }
          return
        }
        this.attachAddon._sendData(`"${filePath}" `)
        return
      } catch (e) {
        console.error('Failed to parse fromFile data:', e)
      }
    }

    const files = dt.files
    if (files && files.length) {
      const arr = Array.from(files)
      const filePaths = arr.map(f => getFilePath(f))

      const hasUnsafeFilename = filePaths.some(path => isUnsafeFilename(path))
      if (hasUnsafeFilename) {
        message.error(notSafeMsg)
        return
      }

      if (isSshTerminal) {
        const behavior = this.props.config.dragDropBehavior || 'ask'
        if (behavior === 'ask') {
          this.setState({
            dropFileModalVisible: true,
            droppedFiles: filePaths.map(path => ({ path, isRemote: false }))
          })
        } else {
          this.handleDropFileAction(behavior, filePaths.map(path => ({ path, isRemote: false })))
        }
        return
      }

      const filesAll = filePaths.map(path => `"${path}"`).join(' ')
      this.attachAddon._sendData(filesAll)
    }
  }

  handleDropFileModalCancel = () => {
    this.setState({
      dropFileModalVisible: false,
      droppedFiles: []
    })
  }

  handleDropFileAction = (action, filesOverride) => {
    const droppedFiles = filesOverride || this.state.droppedFiles
    if (!droppedFiles || !droppedFiles.length) {
      this.handleDropFileModalCancel()
      return
    }

    const filePaths = droppedFiles.map(f => f.path)

    switch (action) {
      case 'trz': {
        if (this.trzszClient && this.trzszClient.isActive) {
          message.warning('A transfer is already in progress')
          this.handleDropFileModalCancel()
          return
        }
        window._apiControlSelectFile = filePaths
        this.attachAddon._sendData('trz\r')
        break
      }
      case 'rz':{
        if (this.zmodemClient && this.zmodemClient.isActive) {
          message.warning('A transfer is already in progress')
          this.handleDropFileModalCancel()
          return
        }
        window._apiControlSelectFile = filePaths
        this.attachAddon._sendData('rz\r')
        break
      }
      case 'inputOnly':
      default: {
        const filesAll = filePaths.map(path => `"${path}"`).join(' ')
        this.attachAddon._sendData(filesAll)
        break
      }
    }

    this.handleDropFileModalCancel()
  }

  onSelection = () => {
    if (
      !this.props.config.copyWhenSelect ||
      window.store.onOperation
    ) {
      return false
    }
    this.copySelectionToClipboard()
  }

  copySelectionToClipboard = () => {
    const txt = this.term.getSelection()
    if (txt) {
      copy(txt)
    }
  }

  tryInsertSelected = () => {
    const txt = this.term.getSelection()
    if (txt) {
      this.attachAddon._sendData(txt)
    }
  }

  webLinkHandler = (event, url) => {
    if (event?.button === 2) {
      return false
    }
    if (!this.props.config.ctrlOrMetaOpenTerminalLink) {
      return window.openLink(url, '_blank')
    }
    if (keyControlPressed(event)) {
      window.openLink(url, '_blank')
    }
  }

  // ---- Mobile touch support ----
  // On touch devices, long-press should (1) select the word under the finger
  // and (2) open the context menu — mirroring desktop right-click behaviour.
  // xterm.js only uses touch events for scrolling, so we add explicit
  // long-press detection here.
  longPressTimer = null
  touchStartPos = null
  longPressFired = false
  longPressThreshold = 500 // ms
  longPressMoveTolerance = 10 // px

  onTouchStart = (e) => {
    if (e.touches.length !== 1) {
      return
    }
    const touch = e.touches[0]
    this.touchStartPos = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      target: e.currentTarget
    }
    this.longPressFired = false
    clearTimeout(this.longPressTimer)
    this.longPressTimer = setTimeout(() => {
      this.handleLongPress()
    }, this.longPressThreshold)
  }

  onTouchMove = (e) => {
    if (!this.touchStartPos) {
      return
    }
    const touch = e.touches[0]
    const dx = touch.clientX - this.touchStartPos.clientX
    const dy = touch.clientY - this.touchStartPos.clientY
    if (Math.sqrt(dx * dx + dy * dy) > this.longPressMoveTolerance) {
      clearTimeout(this.longPressTimer)
      this.longPressTimer = null
      this.touchStartPos = null
    }
  }

  onTouchEnd = () => {
    const wasTap = this.touchStartPos && !this.longPressFired
    clearTimeout(this.longPressTimer)
    this.longPressTimer = null
    this.touchStartPos = null
    // xterm's own touch (Gesture) handler calls preventDefault()/stopPropagation()
    // on touchstart/touchend, which suppresses the synthesised mousedown xterm
    // relies on to focus its hidden helper textarea. As a result a tap never
    // focuses the terminal on touch devices, so the soft keyboard never opens
    // and you cannot type. Focus explicitly on a clean tap (not a long-press,
    // not a scroll) so mobile input works. The focus() runs synchronously inside
    // this user-gesture handler, so iOS/Android will show the keyboard.
    if (wasTap && this.term) {
      this.term.focus()
    }
  }

  handleLongPress = () => {
    if (!this.touchStartPos || this.state.loading) {
      return
    }
    this.longPressFired = true
    const { clientX, clientY, target } = this.touchStartPos

    // Select the word at the touch position (same as desktop right-click word
    // select) so the user can immediately copy or act on it.
    this.selectWordAt(clientX, clientY)

    // Respect pasteWhenContextMenu: when enabled, long-press pastes instead
    // of showing the menu (same as desktop right-click).
    if (this.props.config.pasteWhenContextMenu) {
      this.onPaste()
      return
    }

    // Dispatch a synthetic contextmenu event so antd Dropdown's contextMenu
    // trigger opens the menu at the exact finger position.
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY
    })
    target.dispatchEvent(event)
  }

  selectWordAt = (clientX, clientY) => {
    if (!this.term) {
      return
    }
    const termElement = this.term.element
    if (!termElement) {
      return
    }
    const rect = termElement.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return
    }

    const cellWidth = rect.width / this.term.cols
    const cellHeight = rect.height / this.term.rows
    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    const buffer = this.term.buffer.active
    const line = buffer.getLine(row)
    if (!line) {
      return
    }

    const text = line.translateToString(true)
    const wordSeparator = this.props.config.terminalWordSeparator ||
      ' ./\\()"\'-:,.;<>~!@#$%^&*|+=[]{}`~ ?'

    // If the touched cell is empty or a separator, nothing to select
    if (col >= text.length || wordSeparator.includes(text[col])) {
      return
    }

    // Find word start
    let start = col
    while (start > 0 && !wordSeparator.includes(text[start - 1])) {
      start--
    }
    // Find word end
    let end = col
    while (end < text.length && !wordSeparator.includes(text[end])) {
      end++
    }

    if (end > start) {
      this.term.select(start, row, end - start)
    }
  }

  onContextMenuInner = e => {
    e.preventDefault()
    if (this.state.loading) {
      return
    }
    if (this.props.config.pasteWhenContextMenu) {
      return this.onPaste()
    }
  }

  onCopy = () => {
    const selected = this.term.getSelection()
    copy(selected)
    this.term.focus()
  }

  onSelectAll = () => {
    this.term.selectAll()
  }

  onClear = () => {
    const shouldClear = this.searchAddon &&
      window.store.termSearchOpen &&
      window.store.termSearch
    if (
      shouldClear
    ) {
      this.searchAddon.clearDecorations()
    }
    this.term.clear()
    this.term.focus()
    if (shouldClear) {
      this.searchAddon._lineCache.clear()
      this.timers.clearSearchTimer = setTimeout(() => {
        refsStatic.get('term-search')?.next()
      }, 100)
    }
  }

  isRemote = () => {
    return this.props.tab?.host
  }

  onPaste = async (skipTextLengthCheck) => {
    let selected = await readClipboardAsync()
    if (!skipTextLengthCheck && selected.length > 500) {
      return this.askUserConfirm()
    }
    if (isWin && this.isRemote()) {
      selected = selected.replace(/\r\n/g, '\n')
    }
    this.term.paste(selected || '')
    this.term.focus()
  }

  onPasteSelected = () => {
    const selected = this.term.getSelection()
    this.term.paste(selected || '')
    this.term.focus()
  }

  toggleSearch = () => {
    window.store.toggleTerminalSearch()
  }

  toggleKeepalive = () => {
    if (!this.attachAddon) {
      return false
    }
    this._keepaliveEnabled = !this._keepaliveEnabled
    this.attachAddon.setKeepalive(this._keepaliveEnabled)
    return this._keepaliveEnabled
  }

  onSearchResultsChange = ({ resultIndex, resultCount }) => {
    window.store.storeAssign({
      termSearchMatchCount: resultCount,
      termSearchMatchIndex: resultIndex
    })

    this.updateSearchResults(resultIndex)
  }

  updateSearchResults = (resultIndex) => {
    const matches = this.searchAddon._resultTracker.searchResults.map((result, i) => {
      return result.row
    })

    this.setState({
      searchResults: matches,
      matchIndex: resultIndex,
      totalLines: this.term.buffer.active.length
    })
  }

  searchPrev = (searchInput, options) => {
    this.searchAddon.findPrevious(
      searchInput, options
    )
  }

  searchNext = (searchInput, options) => {
    this.searchAddon.findNext(
      searchInput, options
    )
  }

  explainWithAi = () => {
    window.store.explainWithAi(
      this.term.getSelection()
    )
  }

  getTerminalBufferText = () => {
    const { addTimeStampToTermLog } = this.state
    const buffer = this.term.buffer.active
    const len = buffer.length
    const rawLines = []
    for (let i = 0; i < len; i++) {
      const line = buffer.getLine(i)
      rawLines.push(line ? line.translateToString(false) : '')
    }
    // trim trailing blank lines before applying timestamps
    while (rawLines.length && !rawLines[rawLines.length - 1].trim()) {
      rawLines.pop()
    }
    if (!addTimeStampToTermLog) {
      return rawLines.join('\n')
    }
    return rawLines.map(text => {
      const now = new Date()
      const ts = `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}] `
      return ts + text
    }).join('\n')
  }

  syncTermInfo = (stateUpdate) => {
    this.setState(stateUpdate)
    const infoUpdate = pick(stateUpdate, ['saveTerminalLogToFile', 'addTimeStampToTermLog', 'logPath', 'logFileName'])
    if (Object.keys(infoUpdate).length) {
      refs.get('term-info-' + this.props.tab.id)?.setState(infoUpdate)
    }
  }

  openLogSaveDialog = async (titleKey) => {
    const { logName } = this.props
    const result = await window.api.saveDialog({
      title: e(titleKey),
      defaultPath: logName + '.log',
      filters: [
        { name: 'Log files', extensions: ['log'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) {
      return null
    }
    return result.filePath
  }

  onSaveTerminalLog = async () => {
    const filePath = await this.openLogSaveDialog('saveTerminalLogToFile')
    if (!filePath) {
      return
    }
    const content = this.getTerminalBufferText()
    await window.fs.writeFile(filePath, content).catch(window.store.onError)
    const { addTimeStampToTermLog } = this.state
    startTerminalLogFile(this.pid, filePath, addTimeStampToTermLog).catch(window.store.onError)
    const { path: logPath, name: logFileName } = getFolderFromFilePath(filePath, false)
    this.syncTermInfo({ saveTerminalLogToFile: true, logPath, logFileName })
    notification.success({
      message: e('saveTerminalLogToFile'),
      description: <ShowItem to={filePath}>{filePath}</ShowItem>,
      duration: 5
    })
  }

  onRecord = async () => {
    const filePath = await this.openLogSaveDialog('record')
    if (!filePath) {
      return
    }
    const { addTimeStampToTermLog } = this.state
    startTerminalLogFile(this.pid, filePath, addTimeStampToTermLog).catch(window.store.onError)
    const { path: logPath, name: logFileName } = getFolderFromFilePath(filePath, false)
    this.syncTermInfo({ saveTerminalLogToFile: true, logPath, logFileName })
    this.setState({ recording: true, recordingFilePath: filePath })
    notification.success({
      message: e('record'),
      description: <ShowItem to={filePath}>{filePath}</ShowItem>,
      duration: 5
    })
  }

  onStopRecord = () => {
    const { recordingFilePath } = this.state
    toggleTerminalLog(this.pid).catch(window.store.onError)
    this.syncTermInfo({ saveTerminalLogToFile: false })
    this.setState({ recording: false, recordingFilePath: '' })
    notification.success({
      message: e('stopRecord'),
      description: <ShowItem to={recordingFilePath}>{recordingFilePath}</ShowItem>
    })
  }

  renderContextMenu = () => {
    const { hasSelection, recording } = this.state
    const copyed = true
    const copyShortcut = this.getShortcut('terminal_copy')
    const pasteShortcut = this.getShortcut('terminal_paste')
    const clearShortcut = this.getShortcut('terminal_clear')
    const searchShortcut = this.getShortcut('terminal_search')
    const selectAllShortcut = isMacJs ? 'meta+a' : 'ctrl+shift+a'
    const items = [
      {
        key: 'onCopy',
        icon: <iconsMap.CopyOutlined />,
        label: e('copy'),
        disabled: !hasSelection,
        extra: copyShortcut
      },
      {
        key: 'onPaste',
        icon: <iconsMap.SwitcherOutlined />,
        label: e('paste'),
        disabled: !copyed,
        extra: pasteShortcut
      },
      {
        key: 'onPasteSelected',
        icon: <iconsMap.SwitcherOutlined />,
        label: e('pasteSelected'),
        disabled: !hasSelection
      },
      {

        key: 'onSelectAll',
        icon: <iconsMap.CheckSquareOutlined />,
        label: e('selectall'),
        extra: selectAllShortcut
      },
      ...(
        isAIDisabled()
          ? []
          : [{
              key: 'explainWithAi',
              icon: <AIIcon />,
              label: e('explainWithAi'),
              disabled: !hasSelection
            }]
      ),
      {
        key: 'onClear',
        icon: <iconsMap.ReloadOutlined />,
        label: e('clear'),
        extra: clearShortcut
      },
      {
        key: 'toggleSearch',
        icon: <iconsMap.SearchOutlined />,
        label: e('search'),
        extra: searchShortcut
      },
      {
        key: 'onSaveTerminalLog',
        icon: <iconsMap.SaveOutlined />,
        label: e('saveTerminalLogToFile')
      },
      {
        key: recording ? 'onStopRecord' : 'onRecord',
        icon: recording ? <iconsMap.StopOutlined /> : <iconsMap.PlayCircleFilled />,
        label: e(recording ? 'stopRecord' : 'record')
      }
    ]
    return items
  }

  onContextMenu = ({ key }) => {
    this[key]()
  }

  notifyOnData = debounce(() => {
    window.store.notifyTabOnData(this.props.tab.id)
  }, 1000)

  parse (rawText) {
    let result = ''
    const len = rawText.length
    for (let i = 0; i < len; i++) {
      if (rawText[i] === '\b') {
        result = result.slice(0, -1)
      } else {
        result += rawText[i]
      }
    }
    return result
  }

  getCmd = () => {
    return this.cmdAddon.getCurrentCommand()
  }

  getCwd = () => {
    // Use shell integration CWD if available
    if (this.cmdAddon && this.cmdAddon.hasShellIntegration()) {
      const cwd = this.cmdAddon.getCwd()
      if (cwd) {
        this.setCwd(cwd)
        return cwd
      }
    }
    // Fallback: no longer needed with shell integration
    return ''
  }

  setCwd = (cwd) => {
    this.props.setCwd(cwd, this.state.id)
  }

  getCursorPosition = () => {
    if (!this.term) return null

    // Get the active buffer and cursor position
    const buffer = this.term.buffer.active
    const cursorRow = buffer.cursorY
    const cursorCol = buffer.cursorX

    // Get dimensions from term element
    const termElement = this.term.element
    if (!termElement) return null

    // Get the exact position of the terminal element
    const termRect = termElement.getBoundingClientRect()

    // Calculate cell dimensions
    const cellWidth = termRect.width / this.term.cols
    const cellHeight = termRect.height / this.term.rows

    // Calculate absolute position relative to terminal element
    const left = Math.floor(termRect.left + (cursorCol * cellWidth))
    const top = Math.floor(termRect.top + ((cursorRow + 1) * cellHeight))

    return {
      cellWidth,
      cellHeight,
      left,
      top
    }
  }

  closeSuggestions = () => {
    refsStatic
      .get('terminal-suggestions')
      ?.closeSuggestions()
  }

  openSuggestions = (cursorPos, data) => {
    refsStatic
      .get('terminal-suggestions')
      ?.openSuggestions(cursorPos, data)
  }

  /**
   * Read current input directly from terminal buffer
   * This is more reliable than tracking character-by-character
   */
  getCurrentInput = () => {
    const terminalInput = readTerminalInput(this.term?.buffer?.active)
    if (this._agentInputBuffer === null) return terminalInput
    // IME/composition can paint its final segment before xterm emits onData.
    // Prefer the complete visual line when it is longer than the local draft.
    return Array.from(terminalInput).length > Array.from(this._agentInputBuffer).length
      ? terminalInput
      : this._agentInputBuffer
  }

  getCurrentPromptPrefix = () => {
    return readTerminalPrompt(this.term?.buffer?.active)
  }

  setCurrentInput = (value) => {
    this.currentInput = value
  }

  shouldCaptureAgentTerminalInput = () => {
    if (!this.term || this.onClose || this.agentTerminalHandoff) return false
    if (!this.props.config.agentModeEnabled) return false
    if (normalizeAgentInputMode(this.props.tab.aiInputMode) !== agentInputMode) return false
    if (this.term.buffer.active.type === 'alternate') return false
    if (this.attachAddon?._passwordPromptDetected) return false
    const session = this.state.agentSession
    return !session || isTerminalAgentStatus(session.status)
  }

  renderAgentInputDraft = () => {
    if (!this.term || this._agentInputBuffer === null) return
    const beforeCursor = Array.from(this._agentInputBuffer).slice(0, this._agentInputCursor).join('')
    const column = terminalTextWidth(this._agentInputPrompt) + terminalTextWidth(beforeCursor) + 1
    this.term.write(`\r\x1b[2K${this._agentInputPrompt}\x1b[36m${this._agentInputBuffer}\x1b[0m\x1b[0K\x1b[${Math.max(1, column)}G`)
  }

  resetAgentInputDraft = () => {
    this._agentInputBuffer = null
    this._agentInputCursor = 0
    this._agentInputPrompt = ''
  }

  captureAgentTerminalInput = (data) => {
    if (this.hasPendingAgentApproval()) return true
    if (!this.shouldCaptureAgentTerminalInput()) return false
    const value = String(data || '')
    if (this._agentInputBuffer === null) {
      this._agentInputBuffer = ''
      this._agentInputCursor = 0
      this._agentInputPrompt = readTerminalPrompt(this.term?.buffer?.active) || this._agentPendingPromptPrefix
    }
    if (value === '\r' || value === '\n') {
      const command = this._agentInputBuffer
      if (!command.trim()) {
        this.resetAgentInputDraft()
        this.attachAddon?._sendData?.(value)
        return true
      }
      // A literal shell command still works in Agent mode. Natural-language
      // Enter is intercepted earlier by shouldInterceptSmartShellEnter().
      const route = resolveSmartInputRoute({
        agentModeEnabled: true,
        inputMode: this.props.tab.aiInputMode,
        inputType: classifySmartInput(command).type
      })
      if (route === 'terminal') {
        const prompt = this._agentInputPrompt
        this.term.write(`\r\x1b[2K${prompt}`)
        this.resetAgentInputDraft()
        this.attachAddon?._sendData?.(`${command}${value}`)
      }
      return true
    }
    if (value === '\x7f' || value === '\b') {
      if (this._agentInputCursor > 0) {
        const chars = Array.from(this._agentInputBuffer)
        chars.splice(this._agentInputCursor - 1, 1)
        this._agentInputBuffer = chars.join('')
        this._agentInputCursor--
        this.renderAgentInputDraft()
      }
      return true
    }
    if (value === '\x1b[D') {
      this._agentInputCursor = Math.max(0, this._agentInputCursor - 1)
      this.renderAgentInputDraft()
      return true
    }
    if (value === '\x1b[C') {
      this._agentInputCursor = Math.min(Array.from(this._agentInputBuffer).length, this._agentInputCursor + 1)
      this.renderAgentInputDraft()
      return true
    }
    if (value === '\x03') {
      this.term.write(`\r\x1b[2K${this._agentInputPrompt}^C\r\n${this._agentInputPrompt}`)
      this.resetAgentInputDraft()
      return true
    }
    const pasteStart = '\x1b[200~'
    const pasteEnd = '\x1b[201~'
    const withoutStart = value.startsWith(pasteStart) ? value.slice(pasteStart.length) : value
    const pasted = withoutStart.endsWith(pasteEnd) ? withoutStart.slice(0, -pasteEnd.length) : withoutStart
    if (!isPrintableTerminalInput(pasted)) return true
    const chars = Array.from(this._agentInputBuffer)
    const insertion = Array.from(pasted)
    chars.splice(this._agentInputCursor, 0, ...insertion)
    this._agentInputBuffer = chars.join('')
    this._agentInputCursor += insertion.length
    this.renderAgentInputDraft()
    return true
  }

  /**
   * Handle special input events for command history tracking
   * The actual input reading is done via getCurrentInput from buffer
   */
  handleInputEvent = (d) => {
    // Handle Enter - add command to history
    if (d === '\r' || d === '\n') {
      const currentCmd = this.getCurrentInput()
      const smartInput = classifySmartInput(currentCmd)
      if (
        currentCmd &&
        currentCmd.trim() &&
        this.shouldUseManualHistory() &&
        smartInput.type === 'command'
      ) {
        const trimmedCmd = currentCmd.trim()
        window.store.addCmdHistory(trimmedCmd)
        this.appendSmartShellHistory({
          source: 'manual',
          status: 'executed',
          prompt: trimmedCmd,
          command: trimmedCmd,
          cwd: this.getCwd() || this.props.tab?.cwd || '',
          host: this.props.tab?.host || '',
          tabType: this.props.tab?.type || '',
          skill: selectSmartShellSkill(trimmedCmd, {
            tab: this.props.tab,
            cwd: this.getCwd() || this.props.tab?.cwd || '',
            host: this.props.tab?.host || '',
            tabType: this.props.tab?.type || ''
          })
        })
      }
      if (smartInput.type === 'command' && this.state.smartShellProposal) {
        this.clearSmartShellProposal()
      }
      if (currentCmd && currentCmd.trim() === 'exit') {
        this.userTypeExit = true
      }
      this.closeSuggestions()
    }
  }

  onPasswordPromptDetected = () => {
    window.store.notifyTabPasswordPrompt(this.props.tab.id)
    if (!this.props.config.showCmdSuggestions) {
      return
    }
    const cursorPos = this.getCursorPosition()
    if (cursorPos) {
      refsStatic
        .get('terminal-suggestions')
        ?.openPasswordSuggestions(cursorPos)
    }
  }

  onPasswordPromptCancelled = () => {
    window.store.clearTabPasswordPrompt(this.props.tab.id)
    const suggestions = refsStatic.get('terminal-suggestions')
    if (suggestions?.state?.passwordMode) {
      suggestions.closeSuggestions()
    }
  }

  onData = (d) => {
    if (this.hasPendingAgentApproval()) return
    if (this.isAgentSessionActive() && !this.agentTerminalHandoff && !this._agentManualPauseRequested) {
      this._agentManualPauseRequested = true
      this._agentManualInputQueue = (this._agentManualInputQueue || '') + d
      this.handleAgentControl('pause').then(paused => {
        const queued = this._agentManualInputQueue || ''
        this._agentManualInputQueue = ''
        if (paused && queued) this.handleInputEvent(queued)
      })
      return
    }
    if (this._agentManualPauseRequested && this.state.agentSession?.status !== 'paused') {
      this._agentManualInputQueue = (this._agentManualInputQueue || '') + d
      return
    }
    this.handleInputEvent(d)
    // Skip normal suggestion logic when in password mode
    const suggestions = refsStatic.get('terminal-suggestions')
    if (suggestions?.state?.passwordMode) {
      if (d === '\r' || d === '\n') {
        this.closeSuggestions()
      }
      return
    }
    if (this.props.config.showCmdSuggestions) {
      if (d === '\r' || d === '\n') {
        this.closeSuggestions()
        return
      }
      // Debounce the suggestion opening to avoid expensive work
      // (buffer read + getBoundingClientRect + React re-render) on every keystroke
      this._debouncedOpenSuggestions()
    } else {
      this.closeSuggestions()
    }
  }

  _debouncedOpenSuggestions = debounce(function () {
    const data = this.getCurrentInput()
    if (!data) {
      this.closeSuggestions()
      return
    }
    const cursorPos = this.getCursorPosition()
    this.openSuggestions(cursorPos, data)
  }, 80)

  /**
   * Called by AttachAddonCustom after data is written to the terminal buffer.
   * This fires after server echo arrives, so getCurrentInput() reflects the
   * latest state. We trigger a debounced suggestion refresh so the dropdown
   * updates correctly after backspace, delete, and other edits that rely on
   * server-side echo to update the buffer.
   */
  onTerminalWrite = () => {
    this.flushAgentNativeTerminalCompletion()
    if (!this.props.config.showCmdSuggestions) {
      return
    }
    const suggestions = refsStatic.get('terminal-suggestions')
    if (suggestions?.state?.showSuggestions && !suggestions?.state?.passwordMode) {
      this._debouncedOpenSuggestions()
    }
  }

  signalAgentNativeCommandFinished = (command) => {
    const executed = String(command || '').trim()
    for (const taskId of this._agentNativeTerminalRunningTasks) {
      const expected = String(this._agentTerminalCommands.get(taskId)?.command || '').trim()
      if (!executed || !expected || executed === expected) {
        this._agentNativeTerminalCompletionSignals.add(taskId)
        break
      }
    }
  }

  flushAgentNativeTerminalCompletion = () => {
    if (!this._agentNativeTerminalRunningTasks.size) return
    if (!this.cmdAddon?.hasShellIntegration?.()) {
      const line = readTerminalLogicalLine(this.term?.buffer?.active)
      const prompt = readTerminalPrompt(this.term?.buffer?.active)
      const input = readTerminalInput(this.term?.buffer?.active)
      for (const taskId of this._agentNativeTerminalRunningTasks) {
        const expectedPrompt = String(this._agentTerminalCommands.get(taskId)?.prompt || '')
        if (prompt && !input && line === prompt && (!expectedPrompt || prompt === expectedPrompt)) {
          this._agentNativeTerminalCompletionSignals.add(taskId)
        }
      }
    }
    for (const taskId of [...this._agentNativeTerminalCompletionSignals]) {
      if (!this._agentNativeTerminalRunningTasks.has(taskId)) continue
      this._agentNativeTerminalCompletionSignals.delete(taskId)
      this._agentNativeTerminalRunningTasks.delete(taskId)
      const pendingSession = this._agentPendingNativeSessions.get(taskId)
      this._agentPendingNativeSessions.delete(taskId)
      if (pendingSession) this.renderAgentEmbeddedSession(pendingSession)
    }
  }

  loadRenderer = async (term, config) => {
    // xterm 6.x: only the built-in DOM renderer and the WebGL addon exist
    // (the canvas renderer addon was removed in 6.x). 'dom' = no addon loaded
    // (built-in DOM renderer). Legacy 'canvas' settings fall back to DOM.
    if (config.rendererType === rendererTypes.webGL) {
      try {
        const WebglAddon = await loadWebglAddon()
        const webglAddon = new WebglAddon()
        this.webglAddon = webglAddon
        // On macOS native fullscreen the GPU/WebGL context can be lost when
        // the window migrates across Spaces. Without a listener xterm keeps
        // drawing into a dead context and every terminal goes black while the
        // rest of the UI stays alive. Rebuild the addon to recover.
        this.webglContextLossDisposable = webglAddon.onContextLoss(this.handleWebglContextLoss)
        term.loadAddon(webglAddon)
      } catch (e) {
        console.error('render with webgl failed, fallback to dom renderer')
        console.error(e)
        // built-in DOM renderer is used (no addon loaded)
        this.webglAddon = null
      }
    }
  }

  reloadWebglRenderer = (reason = 'reload') => {
    console.warn(`webgl renderer ${reason}, rebuilding`)
    try {
      this.webglContextLossDisposable?.dispose?.()
      this.webglContextLossDisposable = null
    } catch (e) {
      console.error(e)
    }
    try {
      this.webglAddon?.dispose?.()
    } catch (e) {
      console.error(e)
    }
    this.webglAddon = null
    const { term } = this
    const { config } = this.props
    return this.loadRenderer(term, config)
      .then(() => {
        term.refresh(0, term.rows - 1)
      })
      .catch(e => {
        console.error(`webgl renderer ${reason} failed`, e)
      })
  }

  handleWebglContextLoss = (webglAddon = this.webglAddon) => {
    if (this.webglRecovering || !webglAddon) {
      return
    }
    this.webglRecovering = true
    this.reloadWebglRenderer('context loss')
      .finally(() => {
        this.webglRecovering = false
      })
  }

  terminalColorQueryDisposables = []

  disposeTerminalColorQueryHandlers = () => {
    this.terminalColorQueryDisposables.forEach(disposable => disposable?.dispose?.())
    this.terminalColorQueryDisposables.length = 0
  }

  getVisibleTerminalBackground = () => {
    const uiThemeConfig = window.store?.getUiThemeConfig?.() || {}
    // The store value (uiThemeConfig.main) is always immediately up-to-date
    // when the theme changes, because it reads directly from store.config.theme.
    // The CSS --main variable lags behind because UiTheme's useEffect runs
    // asynchronously after componentDidUpdate. So we prioritise the store
    // value, and only fall back to CSS (for custom-CSS edge cases) or the
    // terminal theme background (last resort).
    const root = document.documentElement
    const cssMain = root && window.getComputedStyle
      ? window.getComputedStyle(root).getPropertyValue('--main').trim()
      : ''
    return uiThemeConfig.main || cssMain || this.props.themeConfig.background
  }

  getVisibleTerminalForeground = () => {
    const uiThemeConfig = window.store?.getUiThemeConfig?.() || {}
    return uiThemeConfig.text
  }

  registerTerminalColorQueryHandlers = (term, themeConfig = {}) => {
    this.disposeTerminalColorQueryHandlers()
    if (!term?.parser?.registerOscHandler) {
      return
    }
    const background = this.getVisibleTerminalBackground()
    const foregroundFallback = this.getVisibleTerminalForeground()
    this.terminalColorQueryDisposables.push(
      term.parser.registerOscHandler(10, data => {
        return handleTerminalColorQuery(term, 10, themeConfig.foreground, foregroundFallback, data)
      }),
      term.parser.registerOscHandler(11, data => {
        return handleTerminalColorQuery(term, 11, background, themeConfig.background, data)
      })
    )
  }

  getRendererThemeConfig = (themeConfig = this.props.themeConfig) => {
    return createRendererThemeConfig(
      deepCopy(themeConfig),
      this.props.config.rendererType,
      this.getVisibleTerminalBackground()
    )
  }

  /**
   * Apply the current renderer theme to the terminal and trigger a repaint.
   * When `deferred` is true (WebGL mode), a second repaint is scheduled on
   * the next animation frame so the theme picks up CSS --main changes that
   * UiTheme's useEffect applies asynchronously after componentDidUpdate.
   * The optional `term` parameter is used during initTerminal, where
   * this.term hasn't been assigned yet.
   */
  applyTerminalTheme = (deferred = false, term = this.term) => {
    if (!term || this.onClose) {
      return
    }
    term.options.theme = this.getRendererThemeConfig(this.props.themeConfig)
    term.refresh(0, term.rows - 1)
    if (deferred && this.props.config.rendererType === rendererTypes.webGL) {
      window.cancelAnimationFrame(this.timers.themeRaf)
      this.timers.themeRaf = window.requestAnimationFrame(() => {
        if (!this.term || this.onClose) {
          return
        }
        this.term.options.theme = this.getRendererThemeConfig(this.props.themeConfig)
        this.term.refresh(0, this.term.rows - 1)
      })
    }
  }

  initTerminal = async () => {
    const { themeConfig, tab = {}, config = {} } = this.props
    const tc = this.getRendererThemeConfig(themeConfig)
    const Terminal = await loadTerminal()
    const term = new Terminal({
      allowProposedApi: true,
      scrollback: config.scrollback,
      rightClickSelectsWord: config.rightClickSelectsWord || false,
      fontFamily: tab.fontFamily || config.fontFamily,
      theme: tc,
      allowTransparency: true,
      wordSeparator: config.terminalWordSeparator,
      cursorStyle: config.cursorStyle,
      cursorBlink: config.cursorBlink,
      fontSize: tab.fontSize || config.fontSize,
      screenReaderMode: config.screenReaderMode
    })

    term.parent = this
    term.onSelectionChange(this.onSelection)
    term.open(this.domRef.current, true)
    this.agentEmbeddedScrollDisposable = term.onScroll(this.scheduleAgentEmbeddedPositions)
    this.agentEmbeddedRenderDisposable = term.onRender(this.scheduleAgentEmbeddedPositions)
    this.registerTerminalColorQueryHandlers(term, themeConfig)
    await this.loadRenderer(term, config)
    // Re-apply the theme after the renderer is loaded. The Terminal was
    // constructed before UiTheme's useEffect ran, so the initial theme
    // may have a stale background. Pass `term` directly because this.term
    // is not assigned yet. Use deferred=true so a second repaint picks up
    // any CSS --main changes applied by UiTheme's useEffect.
    if (config.rendererType === rendererTypes.webGL) {
      this.applyTerminalTheme(true, term)
    }

    const FitAddon = await loadFitAddon()
    this.fitAddon = new FitAddon()
    this.cmdAddon = new CommandTrackerAddon()
    this.cmdAddon.onCommandExecuted((cmd) => {
      if (cmd && cmd.trim()) {
        window.store.addCmdHistory(cmd.trim())
      }
    })
    this.cmdAddon.onCommandFinished((cmd) => {
      this.signalAgentNativeCommandFinished(cmd)
    })
    this.cmdAddon.onCwdChanged((cwd) => {
      this.setCwd(cwd)
    })
    const SearchAddon = await loadSearchAddon()
    this.searchAddon = new SearchAddon()
    const LigaturesAddon = await loadLigaturesAddon()
    const ligtureAddon = new LigaturesAddon()
    this.searchAddon.onDidChangeResults(this.onSearchResultsChange)
    const Unicode11Addon = await loadUnicode11Addon()
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.loadAddon(ligtureAddon)
    term.unicode.activeVersion = '11'
    term.loadAddon(this.fitAddon)
    term.loadAddon(this.searchAddon)
    term.loadAddon(this.cmdAddon)
    this.osc52Addon = new Osc52Addon()
    term.loadAddon(this.osc52Addon)
    if (tab.enableTerminalImage) {
      const ImageAddon = await loadImageAddon()
      this.imageAddon = new ImageAddon({
        pixelLimit: 33554432
      })
      term.loadAddon(this.imageAddon)
    }
    term.onData(this.onData)
    this.term = term
    term.onSelectionChange(this.onSelectionChange)
    term.attachCustomKeyEventHandler(this.handleKeyboardEvent.bind(this))
    // 容器不可见（隐藏标签 display:none）时不 fit，避免算出 0 列把 shell
    // 提示符逐字符错误换行；待标签激活可见后由 fitAndRefresh 重新适配。
    if (this.isElementVisible()) {
      this.fitAddon.fit()
    }
    await this.remoteInit(term)
  }

  onSelectionChange = () => {
    const hasSelection = this.term.hasSelection()
    const txt = hasSelection ? this.term.getSelection().trim() : ''
    this.setState({ hasSelection })
    refsStatic.get('unix-timestamp-tooltip')?.onSelection(txt)
  }

  // setActive = () => {
  //   const name = `activeTabId${this.props.batch}`
  //   const tabId = this.props.tab.id
  //   window.store.storeAssign({
  //     activeTabId: tabId,
  //     [name]: tabId
  //   })
  // }

  runInitScript = async () => {
    window.store.triggerResize()
    const {
      startDirectory,
      runScripts
    } = this.props.tab

    const scripts = runScripts ? [...runScripts] : []
    const startFolder = startDirectory || window.initFolder
    if (startFolder) {
      scripts.unshift({ script: `cd "${startFolder}"`, delay: 0 })
    }

    // Create unified execution queue
    this.executionQueue = []

    // Add shell integration injection to queue if needed
    if (this.canInjectShellIntegration()) {
      this.executionQueue.push({
        type: 'shell_integration',
        execute: async () => {
          await this.injectShellIntegration()
        }
      })
    }

    // Add delayed scripts to queue
    scripts.forEach(script => {
      this.executionQueue.push({
        type: 'delayed_script',
        script: script.script,
        delay: script.delay || 0,
        execute: () => {
          if (script.script) {
            this.attachAddon._sendData(script.script + '\r')
          }
        }
      })
    })

    this.processExecutionQueue()
  }

  shouldUseManualHistory = () => {
    return !this.cmdAddon || !this.cmdAddon.hasShellIntegration()
  }

  canInjectShellIntegration = () => {
    const { config } = this.props
    const canInject = (config.showCmdSuggestions || this.props.sftpPathFollowSsh) &&
    (
      this.isSsh() ||
      (this.isLocal() && !isWin)
    )
    return canInject
  }

  isSsh = () => {
    const { host, type } = this.props.tab
    return host && (type === 'ssh' || type === undefined)
  }

  isLocal = () => {
    const { host, type } = this.props.tab
    return !host &&
      (type === 'local' || type === undefined)
  }

  /**
   * Process the unified execution queue one item at a time
   */
  processExecutionQueue = async () => {
    if (!this.executionQueue || this.executionQueue.length === 0) {
      return
    }

    const item = this.executionQueue.shift()

    try {
      if (item.type === 'shell_integration') {
        await item.execute()
      } else if (item.type === 'delayed_script') {
        item.execute()
        // Wait for the specified delay before processing next item
        if (item.delay > 0) {
          await new Promise(resolve => {
            this.timers.timerDelay = setTimeout(resolve, item.delay)
          })
        }
      }
    } catch (error) {
      console.error('[Shell Integration] Error processing queue item:', item.type, error)
    }

    // Process next item
    this.processExecutionQueue()
  }

  /**
   * Inject shell integration commands from client-side
   * This replaces the server-side source xxx.xxx approach
   * Uses output suppression to hide the injection command
   * Returns a promise that resolves when injection is complete
   */
  injectShellIntegration = async () => {
    if (this.shellInjected) {
      return Promise.resolve()
    }

    let shellType
    if (this.isLocal()) {
      const { config } = this.props
      const localShell = isMac ? config.execMac : config.execLinux
      shellType = detectShellType(localShell)
    } else if (this.isSsh()) {
      shellType = await detectRemoteShell(this.pid)
    }

    this.shellType = shellType
    if (shellType === 'fish') {
      if (this.props.sftpPathFollowSsh) {
        this.warnSftpFollowUnsupported()
      }
      return Promise.resolve()
    }

    // Don't inject for sh type shells unless sftpPathFollowSsh is true
    if (shellType === 'sh' && !this.props.sftpPathFollowSsh) {
      return Promise.resolve()
    }

    const integrationCmd = getShellIntegrationCommand(shellType)

    return new Promise((resolve) => {
      // Wait for initial data (prompt/banner) to arrive before injecting
      this.attachAddon.onInitialData(() => {
        if (this.attachAddon) {
          // Start suppressing output before sending the integration command
          // This hides the command and its output until OSC 633 is detected
          const suppressionTimeout = this.isSsh() ? 5000 : 3000
          // Pass callback to resolve the promise after suppression ends
          this.attachAddon.startOutputSuppression(suppressionTimeout, () => {
            this.shellInjected = true
            resolve()
          })
          this.attachAddon._sendData(integrationCmd)
        } else {
          resolve()
        }
      })
    })
  }

  setStatus = status => {
    const id = this.props.tab?.id
    this.props.editTab(id, {
      status
    })
  }

  openNormalBuffer = () => {
    const normal = this.term.buffer.normal
    const len = normal.length
    const lines = new Array(len).fill('').map((x, i) => {
      return normal.getLine(i).translateToString(false)
    })
    this.setState({
      lines
    })
  }

  closeNormalBuffer = () => {
    this.setState({
      lines: []
    })
    this.term.focus()
  }

  onBufferChange = buf => {
    this.bufferMode = buf.type
  }

  buildWsUrl = (port) => {
    const { host, tokenElecterm } = this.props.config
    const { id } = this.props.tab
    if (window.et.buildWsUrl) {
      return window.et.buildWsUrl(
        host,
        port,
        tokenElecterm,
        id
      )
    }
    return `ws://${host}:${port}/terminals/${id}?token=${tokenElecterm}`
  }

  remoteInit = async (term = this.term) => {
    this.setState({
      loading: true,
      terminalError: null
    })
    const { cols, rows } = term
    const { config } = this.props
    const {
      keywords = []
    } = config
    const { logName } = this.props
    const tab = window.store.applyProfileToTabs(deepCopy(this.props.tab || {}))
    const {
      srcId, from = 'bookmarks',
      type,
      term: terminalType,
      displayRaw,
      id
    } = tab
    const { savePassword } = this.state
    const termType = type
    const extra = this.props.sessionOptions
    // Determine if this is a local terminal (no host)
    const isLocalType = !tab.host
    // Build exec settings: only for local type, prefer tab settings over config
    let execOpts = {}
    let execPropName = 'execLinux'
    if (isWin) {
      execPropName = 'execWindows'
    } else if (isMac) {
      execPropName = 'execMac'
    }
    if (isLocalType) {
      // Check flat properties on tab first (bookmark data), then fall back to config
      if (tab[execPropName]) {
        // Use bookmark's exec setting directly
        execOpts = {
          [execPropName]: tab[execPropName],
          [`${execPropName}Args`]: tab[`${execPropName}Args`] || []
        }
      } else if (config[execPropName]) {
        // Use global config exec settings
        execOpts = {
          [execPropName]: config[execPropName],
          [`${execPropName}Args`]: config[`${execPropName}Args`] || []
        }
      }
    }
    const keepaliveInterval = tab.keepaliveInterval || config.keepaliveInterval
    const opts = clone({
      cols,
      rows,
      term: terminalType || config.terminalType,
      saveTerminalLogToFile: config.saveTerminalLogToFile,
      ...tab,
      ...extra,
      ...execOpts,
      logName,
      sessionLogPath: this.state.logPath,
      ...pick(config, [
        'addTimeStampToTermLog',
        'keepaliveCountMax',
        'keyword2FA',
        'debug'
      ]),
      keepaliveInterval,
      tabId: id,
      uid: id,
      srcTabId: tab.id,
      termType,
      readyTimeout: config.sshReadyTimeout,
      proxy: getProxy(tab, config),
      type: tab.host
        ? typeMap.remote
        : typeMap.local
    })
    const isAutoReconnect = !!(tab.autoReConnect && this.props.config.autoReconnectTerminal)
    const r = await createTerm(opts)
      .catch(err => {
        if (!isAutoReconnect) {
          const text = err.message
          this.handleError({ message: text, from, srcId })
        }
      })
    // Guard: component was unmounted while createTerm was pending.
    // The child process is already running; connect briefly to trigger its cleanup.
    if (this.onClose) {
      if (r && r.port) {
        try {
          const tmpSock = new WebSocket(this.buildWsUrl(r.port))
          tmpSock.onopen = () => tmpSock.close()
        } catch (_e) {}
      }
      return
    }
    if (typeof r === 'string' && r.includes('fail')) {
      return this.promote()
    }
    if (savePassword) {
      window.store.editItem(srcId, extra, from)
    }
    this.setState({
      loading: false
    })
    if (!r) {
      if (isAutoReconnect) {
        this.scheduleAutoReconnect(3000)
        return
      }
      this.setStatus(statusMap.error)
      return
    }
    this.port = r.port
    this.setStatus(statusMap.success)
    refs.get('sftp-' + id)?.initData(id, r.port)
    term.pid = id
    this.pid = id
    const wsUrl = this.buildWsUrl(r.port)
    const socket = new WebSocket(wsUrl)
    socket.onclose = this.oncloseSocket
    socket.onerror = this.onerrorSocket
    this.socket = socket
    this.initSocketEvents()
    this.term = term
    socket.onopen = async () => {
      await this.initAttachAddon()
      this.runInitScript()
      // 从空白页首次进入时，容器可能尚未完成布局；延迟多次 fit，并在仍无输出时回车唤醒提示符
      this.schedulePostConnectFit()
    }
    // term.onRrefresh(this.onRefresh)
    term.onResize(this.onResizeTerminal)
    // xterm 6.x exposes buffer change as a public event (IBufferNamespace.onBufferChange).
    // Previously this reached into the private _onBufferChange._listeners array.
    term.buffer.onBufferChange(this.onBufferChange)
    const WebLinksAddon = await loadWebLinksAddon()
    term.loadAddon(new WebLinksAddon(this.webLinkHandler))
    term.focus()
    this.zmodemClient = new ZmodemClient(this)
    this.zmodemClient.init(socket)
    this.trzszClient = new TrzszClient(this)
    this.trzszClient.init(socket)
    // 仅在可见时 fit，隐藏标签跳过，避免 0 列损坏提示符。
    if (this.isElementVisible()) {
      this.fitAddon.fit()
    }
    term.displayRaw = displayRaw
    term.loadAddon(
      new KeywordHighlighterAddon(keywords)
    )
  }

  handleError = ({ message: errorMessage, from, srcId }) => {
    this.setState({
      terminalError: {
        message: errorMessage || 'Failed to create terminal session',
        from,
        srcId
      }
    })
  }

  handleEditBookmarkFromError = () => {
    // Bookmark editing UI has been removed
  }

  initSocketEvents = () => {
    const originalSend = this.socket.send
    this.socket.send = (data) => {
      // Call original send first
      originalSend.call(this.socket, data)

      // Broadcast to other terminals
      this.broadcastSocketData(data)
    }
  }

  canReceiveBroadcast = (termRef) => {
    return (
      termRef.socket &&
      termRef.props?.tab.pane === paneMap.terminal
    )
  }

  broadcastSocketData = (data) => {
    if (!this.isActiveTerminal() || !this.props.broadcastInput) {
      return
    }

    window.refs.forEach((termRef, refId) => {
      if (
        refId !== this.id &&
        refId.startsWith('term-') &&
        this.canReceiveBroadcast(termRef)
      ) {
        termRef.socket.send(data)
      }
    })
  }

  // 判断终端挂载容器当前是否真实可见（非 display:none）。
  // 隐藏标签的 clientWidth/clientHeight 为 0，此时不应 fit，否则会算出 0 列。
  isElementVisible = () => {
    const el = this.domRef.current
    if (!el) {
      return false
    }
    return el.clientWidth > 0 && el.clientHeight > 0
  }

  // 从首页空会话首次打开时，Sessions 刚挂载，fit 可能读到错误尺寸或被跳过；
  // 连接成功后补几次适配，必要时用回车唤醒已被服务端缓冲刷新前丢掉的提示符场景。
  schedulePostConnectFit = () => {
    const delays = [0, 50, 150, 400]
    delays.forEach((ms, i) => {
      const key = `postConnectFit${i}`
      clearTimeout(this.timers[key])
      this.timers[key] = setTimeout(() => {
        if (this.onClose || !this.term) {
          return
        }
        this.fitAndRefresh()
        if (i === delays.length - 1) {
          this.nudgePromptIfEmpty()
        }
      }, ms)
    })
  }

  hasTerminalOutput = () => {
    if (!this.term) {
      return false
    }
    try {
      const buf = this.term.buffer.active
      const len = Math.min(buf.length, 80)
      for (let i = 0; i < len; i++) {
        const line = buf.getLine(i)
        if (line && line.translateToString(true).trim()) {
          return true
        }
      }
    } catch (e) {}
    return false
  }

  nudgePromptIfEmpty = () => {
    if (
      this.onClose ||
      !this.attachAddon?._sendData ||
      this.hasTerminalOutput() ||
      !this.isSsh()
    ) {
      return
    }
    try {
      this.attachAddon._sendData('\r')
    } catch (e) {}
  }

  // 重新适配终端尺寸并强制重绘可见区域。
  // 仅当容器真正可见时才 fit：隐藏标签(display:none)下 clientWidth 为 0，
  // 若在此时 fit 会算出 0/极小列数，使 shell 提示符被逐字符错误换行，
  // 出现快速连续打开多个连接时的虚假/重复提示符。因此隐藏态跳过 fit，
  // 保留 xterm 默认 80x24，待标签激活可见后再 fit 重绘，从根上避免换行损坏。
  fitAndRefresh = () => {
    if (!this.term || !this.fitAddon || this.onClose) {
      return
    }
    if (!this.isElementVisible()) {
      return
    }
    try {
      this.fitAddon.fit()
      this.term.refresh(0, this.term.rows - 1)
    } catch (e) {
      console.info('resize failed', e)
    }
  }

  onResize = throttle(() => {
    this.fitAndRefresh()
    this.updateSmartShellOverlayAnchor()
  }, 200)

  onerrorSocket = err => {
    console.error('onerrorSocket', err)
  }

  oncloseSocket = () => {
    if (this.onClose || this.props.tab.enableSsh === false) {
      return
    }
    this.setStatus(
      statusMap.error
    )
    if (this.userTypeExit) {
      return this.props.delTab(this.props.tab.id)
    }
    const { autoReconnectTerminal } = this.props.config
    if (autoReconnectTerminal) {
      this.scheduleAutoReconnect(3000)
    }
  }

  scheduleAutoReconnect = (delay = 3000) => {
    clearTimeout(this.timers.reconnectTimer)
    clearInterval(this.timers.reconnectCountdown)
    const seconds = Math.round(delay / 1000)
    this.setState({ reconnectCountdown: seconds })
    let remaining = seconds
    this.timers.reconnectCountdown = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        clearInterval(this.timers.reconnectCountdown)
        this.timers.reconnectCountdown = null
      }
      this.setState({ reconnectCountdown: remaining <= 0 ? null : remaining })
    }, 1000)
    this.timers.reconnectTimer = setTimeout(() => {
      clearInterval(this.timers.reconnectCountdown)
      this.timers.reconnectCountdown = null
      this.setState({ reconnectCountdown: null })
      if (this.onClose || !this.props.config.autoReconnectTerminal) {
        return
      }
      const reconnectCount = (this.props.tab.autoReConnect || 0) + 1
      this.props.reloadTab({ ...this.props.tab, autoReConnect: reconnectCount })
    }, delay)
  }

  handleCancelAutoReconnect = () => {
    clearTimeout(this.timers.reconnectTimer)
    clearInterval(this.timers.reconnectCountdown)
    this.timers.reconnectTimer = null
    this.timers.reconnectCountdown = null
    this.setState({ reconnectCountdown: null })
  }

  batchInput = (cmd) => {
    this.attachAddon._sendData(cmd + '\r')
  }

  onResizeTerminal = size => {
    const { cols, rows } = size
    resizeTerm(this.pid, cols, rows)
    window.requestAnimationFrame(() => {
      for (const entry of this._agentEmbeddedEntries.values()) {
        this.positionAgentEmbeddedDecoration(entry)
      }
      this.term?.refresh(0, Math.max(0, this.term.rows - 1))
    })
  }

  handleCancel = () => {
    const { id } = this.props.tab
    this.props.delTab(id)
  }

  handleShowInfo = () => {
    const { logName, tab } = this.props
    const infoProps = {
      logName,
      id: tab.id,
      pid: tab.id,
      isRemote: this.isRemote(),
      isActive: this.isActiveTerminal()
    }
    Object.assign(window.store.terminalInfoProps, infoProps)
  }

  renderResetFontSizeButton = () => {
    if (!this.state.fontSizeChanged) {
      return null
    }
    const txt = `${e('reset')} ${e('fontSize')}`
    return (
      <Button
        className='terminal-fontsize-reset'
        onClick={this.handleResetFontSize}
        type='default'
        size='small'
        title={txt}
        icon={<AimOutlined />}
      />
    )
  }

  // getPwd = async () => {
  //   const { sessionId, config } = this.props
  //   const { pid } = this.state
  //   const prps = {
  //     host: config.host,
  //     port: config.port,
  //     pid,
  //     sessionId
  //   }
  //   const result = await runCmds(prps, ['pwd'])
  //     .catch(window.store.onError)
  //   return result ? result[0].trim() : ''
  // }

  switchEncoding = encode => {
    this.encode = encode
    this.attachAddon.decoder = new TextDecoder(encode)
  }

  render () {
    const { loading } = this.state
    const { height, width, left, top, fullscreen } = this.props
    const { id } = this.props.tab
    const isActive = this.isActiveTerminal()
    const cls = classnames(
      'term-wrap',
      'tw-' + id,
      {
        'terminal-not-active': !isActive
      }
    )
    const prps1 = {
      className: cls,
      style: {
        height,
        width,
        left,
        top,
        zIndex: 10
      },
      onDrop: this.onDrop,
      onContextMenu: this.onContextMenuInner,
      onTouchStart: this.onTouchStart,
      onTouchMove: this.onTouchMove,
      onTouchEnd: this.onTouchEnd
    }
    // const fileProps = {
    //   type: 'file',
    //   multiple: true,
    //   id: `${id}-file-sel`,
    //   className: 'hide'
    // }
    const prps3 = {
      id: this.getDomId(),
      ref: this.domRef,
      className: 'absolute term-wrap-2',
      style: {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
      }
    }
    const dropdownProps = {
      menu: {
        items: this.renderContextMenu(),
        onClick: this.onContextMenu
      },
      trigger: this.props.config.pasteWhenContextMenu ? [] : ['contextMenu']
    }
    const barProps = {
      matchIndex: this.state.matchIndex,
      matches: this.state.searchResults,
      totalLines: this.state.totalLines,
      height
    }
    const spin = loading ? <Spin className='loading-wrapper' spinning={loading} /> : null
    return (
      <Dropdown {...dropdownProps}>
        <div
          {...prps1}
        >
          <div
            {...prps3}
          />
          <NormalBuffer
            lines={this.state.lines}
            close={this.closeNormalBuffer}
          />
          <SearchResultBar {...barProps} />
          <RemoteFloatControl
            isFullScreen={fullscreen}
          />
          <TerminalErrorHandle
            errorMessage={this.state.terminalError?.message}
            showEditBookmarkButton={false}
            onEditBookmark={this.handleEditBookmarkFromError}
          />
          <ReconnectOverlay
            countdown={this.state.reconnectCountdown}
          />
          <TerminalSmartShellOverlay
            proposal={this.state.smartShellProposal}
            anchor={this.state.smartShellOverlayAnchor}
            onExecute={this.handleSmartShellExecute}
            onSave={this.handleSmartShellSave}
            onReject={this.handleSmartShellReject}
          />
          {this.renderResetFontSizeButton()}
          <DropFileModal
            visible={this.state.dropFileModalVisible}
            files={this.state.droppedFiles}
            onSelect={this.handleDropFileAction}
            onCancel={this.handleDropFileModalCancel}
          />
          {spin}
        </div>
      </Dropdown>
    )
  }
}

function isPrintableTerminalInput (value) {
  return Array.from(String(value || '')).some(character => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  })
}

function terminalTextWidth (value) {
  return Array.from(String(value || '')).reduce((width, character) => {
    return width + ((character.codePointAt(0) || 0) > 255 ? 2 : 1)
  }, 0)
}

export default shortcutDescExtend(shortcutExtend(Term))
