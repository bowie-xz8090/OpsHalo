/**
 * Session control bar — pane tabs and action icons.
 * On mobile a menu icon is shown; clicking it toggles the control icons.
 */
import {
  SearchOutlined,
  FullscreenOutlined,
  PaperClipOutlined,
  CloseOutlined,
  InfoCircleOutlined,
  DoubleRightOutlined,
  ApartmentOutlined,
  MoreOutlined,
  ColumnWidthOutlined,
  LogoutOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Tooltip, Popover, Select } from 'antd'
import classnames from 'classnames'
import {
  paneMap,
  connectionMap,
  statusMap,
  terminalSerialType
} from '../../common/constants'
import { SplitViewIcon } from '../icons/split-view'
import { HeartbeatIcon } from '../icons/heartbeat'
import TransferList from '../sidebar/transfer-list'
import encodes from '../bookmark-form/common/encodes'
import './session-control.styl'

const e = window.translate

export default function SessionControl (props) {
  const {
    tab,
    isMobile,
    showSidebarControl,
    isDisabled,
    isSshDisabled,
    isNotTerminalType,
    canSplitView,
    sftpPathFollowSsh,
    keepaliveEnabled,
    broadcastInput,
    wrapDisabled,
    delKeyPressed,
    hideDelKeyTip,
    agentModeEnabled,
    aiInputMode,
    aiModeSwitching,
    onChangePane,
    onChangeAiInputMode,
    toggleCheckSftpPathFollowSsh,
    onSshSftpSplitView,
    toggleKeepalive,
    toggleBroadcastInput,
    toggleWrap,
    onFullscreen,
    onOpenSearch,
    onShowInfo,
    onSwitchEncoding,
    onShowSidebar,
    onDismissDelKeyTip,
    onExitGracefully,
    onReload
  } = props

  if (isNotTerminalType) {
    return null
  }

  const isSsh = !!tab.authType
  const isLocal = !isSsh && (tab.type === connectionMap.local || !tab.type)
  const showSshFeatures = isSsh || isLocal
  const {
    fileTransfers = [],
    transferHistory = [],
    transferTab
  } = window.store

  // ---- sub-renderers ----

  function renderPaneControl () {
    if (isDisabled) {
      return null
    }
    const { sshSftpSplitView, pane } = tab
    if (sshSftpSplitView && canSplitView) {
      return null
    }
    const types = [
      paneMap.terminal,
      paneMap.fileManager
    ]
    const controls = [
      isSsh ? paneMap.ssh : paneMap.terminal
    ]
    if (isSsh || isLocal) {
      controls.push(isSsh ? paneMap.sftp : paneMap.fileManager)
    }
    return (
      <div className='term-sftp-tabs fleft'>
        {
          controls.map((type, i) => {
            const cls = classnames(
              'type-tab',
              type,
              {
                active: types[i] === pane
              }
            )
            return (
              <span
                className={cls}
                key={type + '_' + i}
                onClick={() => onChangePane(types[i])}
              >
                <span className='type-tab-txt'>
                  {
                    (type === paneMap.ssh || type === paneMap.sftp)
                      ? type.toUpperCase()
                      : e(type)
                  }
                  <span className='type-tab-line' />
                </span>
              </span>
            )
          })
        }
      </div>
    )
  }

  function renderAiInputModeControl () {
    if (!agentModeEnabled) return null
    const options = [
      { value: 'shell', label: 'Shell模式' },
      { value: 'agent', label: 'Agent模式' }
    ]
    return (
      <div
        className='agent-input-mode-switch'
        role='group'
        aria-label='终端输入模式'
      >
        {options.map(option => (
          <button
            type='button'
            key={option.value}
            className={classnames('agent-input-mode-option', {
              active: aiInputMode === option.value
            })}
            aria-pressed={aiInputMode === option.value}
            disabled={aiModeSwitching}
            onClick={() => onChangeAiInputMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    )
  }

  function renderDelTip (isS) {
    if (!isS || hideDelKeyTip || !delKeyPressed) {
      return null
    }
    return (
      <div className='type-tab'>
        <span className='mg1r'>Try <b>Shift + Backspace</b>?</span>
        <CloseOutlined
          onClick={onDismissDelKeyTip}
          className='pointer'
        />
      </div>
    )
  }

  function renderSftpPathFollowControl () {
    if (isDisabled) {
      return null
    }
    const { pane, enableSsh, sshSftpSplitView } = tab
    const checkTxt = e('sftpPathFollowSsh')
    const checkProps = {
      onClick: toggleCheckSftpPathFollowSsh,
      className: classnames(
        'sftp-follow-ssh-icon sess-icon pointer',
        {
          active: sftpPathFollowSsh
        }
      )
    }
    const isS = pane === paneMap.terminal ||
      sshSftpSplitView
    return (
      <>
        {
          (isSsh && enableSsh) || isLocal
            ? (
              <Tooltip title={checkTxt}>
                <span {...checkProps}>
                  <PaperClipOutlined />
                </span>
              </Tooltip>
              )
            : null
        }
        {renderDelTip(isS)}
      </>
    )
  }

  function renderSplitToggle () {
    if (isMobile) {
      return null
    }
    if (!canSplitView || isNotTerminalType || !showSshFeatures) {
      return null
    }
    const title = e('sshSftpSplitView')
    const { sshSftpSplitView } = tab
    const cls = classnames(
      'pointer sess-icon split-view-toggle',
      {
        active: sshSftpSplitView
      }
    )
    return (
      <Tooltip title={title} placement='bottomLeft'>
        <span
          className={cls}
          onClick={onSshSftpSplitView}
        >
          <SplitViewIcon />
        </span>
      </Tooltip>
    )
  }

  function renderKeepaliveIcon () {
    if (isSshDisabled || !showSshFeatures) {
      return null
    }
    const title = e('keepalive')
    const iconProps = {
      className: classnames('sess-icon pointer keepalive-icon', {
        active: keepaliveEnabled
      }),
      onClick: toggleKeepalive
    }
    return (
      <Tooltip title={title}>
        <HeartbeatIcon {...iconProps} />
      </Tooltip>
    )
  }

  function renderBroadcastIcon () {
    if (isSshDisabled || !showSshFeatures) {
      return null
    }
    const title = e('broadcastInput')
    const iconProps = {
      className: classnames('sess-icon pointer broadcast-icon', {
        active: broadcastInput
      }),
      onClick: toggleBroadcastInput
    }
    return (
      <Tooltip title={title}>
        <ApartmentOutlined {...iconProps} />
      </Tooltip>
    )
  }

  function renderWrapIcon () {
    const title = e(wrapDisabled ? 'enableWrap' : 'disableWrap')
    const iconProps = {
      className: classnames('sess-icon pointer wrap-toggle-icon', {
        active: wrapDisabled
      }),
      onClick: toggleWrap
    }
    return (
      <Tooltip title={title}>
        <ColumnWidthOutlined {...iconProps} />
      </Tooltip>
    )
  }

  function renderExitGracefullyIcon () {
    if (tab.type !== terminalSerialType) {
      return null
    }
    const title = e('exitGracefully')
    return (
      <Tooltip title={title}>
        <LogoutOutlined
          className='sess-icon pointer exit-gracefully-icon'
          onClick={onExitGracefully}
        />
      </Tooltip>
    )
  }

  function renderReloadIcon () {
    if (!onReload) {
      return null
    }
    return (
      <Tooltip title='重新载入'>
        <ReloadOutlined
          className='sess-icon pointer reload-session-icon'
          onClick={onReload}
        />
      </Tooltip>
    )
  }

  function renderTransferIcon () {
    return (
      <TransferList
        variant='session'
        alwaysShow
        fileTransfers={fileTransfers}
        transferHistory={transferHistory}
        transferTab={transferTab}
      />
    )
  }

  function renderSearchIcon () {
    const title = e('search')
    return (
      <Tooltip title={title} placement='bottomLeft'>
        <SearchOutlined
          className='mg1r icon-info iblock pointer spliter'
          onClick={onOpenSearch}
        />
      </Tooltip>
    )
  }

  function renderInfoIcon () {
    if (tab.status !== statusMap.success) {
      return null
    }
    return (
      <Tooltip title={e('info')} placement='bottomLeft'>
        <InfoCircleOutlined
          className='sess-icon pointer terminal-info-icon'
          onClick={onShowInfo}
        />
      </Tooltip>
    )
  }

  function renderShowSidebarIcon () {
    if (!showSidebarControl) {
      return null
    }
    return (
      <Tooltip title={e('show')} placement='bottomLeft'>
        <DoubleRightOutlined
          className='sess-icon pointer show-sidebar-icon'
          onClick={onShowSidebar}
        />
      </Tooltip>
    )
  }

  function renderEncodingSelect () {
    return (
      <Select
        className='session-encoding-select'
        value={props.encoding}
        onChange={onSwitchEncoding}
        options={encodes.map(encode => ({
          label: encode.toUpperCase(),
          value: encode
        }))}
        size='small'
        popupMatchSelectWidth={false}
        aria-label={e('encode')}
      />
    )
  }

  function renderFullscreenIcon () {
    const title = e('fullscreen')
    return (
      <Tooltip title={title} placement='bottomLeft'>
        <FullscreenOutlined
          className='mg1r icon-info iblock pointer spliter fullscreen-control-icon'
          onClick={onFullscreen}
        />
      </Tooltip>
    )
  }

  function renderTermControls () {
    const { pane } = tab
    if (pane !== paneMap.terminal) {
      return null
    }
    return (
      <div className='fright term-controls'>
        {renderEncodingSelect()}
        {renderFullscreenIcon()}
        {renderSearchIcon()}
      </div>
    )
  }

  // ---- mobile ----

  if (isMobile) {
    const extraIcons = (
      <div className='mobile-control-icons'>
        {renderSftpPathFollowControl()}
        {renderKeepaliveIcon()}
        {renderBroadcastIcon()}
        {renderWrapIcon()}
        {renderReloadIcon()}
        {renderTransferIcon()}
        {renderExitGracefullyIcon()}
        {renderInfoIcon()}
        {renderAiInputModeControl()}
        {renderTermControls()}
      </div>
    )
    return (
      <div className='terminal-control mobile-session-control'>
        {renderShowSidebarIcon()}
        {renderPaneControl()}
        <Popover
          content={extraIcons}
          trigger='click'
          placement='bottomRight'
        >
          <MoreOutlined className='mobile-control-toggle pointer' />
        </Popover>
      </div>
    )
  }

  // ---- desktop ----
  return (
    <div className='terminal-control fix'>
      {renderShowSidebarIcon()}
      {renderPaneControl()}
      {renderSftpPathFollowControl()}
      {renderSplitToggle()}
      {renderKeepaliveIcon()}
      {renderBroadcastIcon()}
      {renderWrapIcon()}
      {renderReloadIcon()}
      {renderTransferIcon()}
      {renderExitGracefullyIcon()}
      {renderInfoIcon()}
      {renderAiInputModeControl()}
      {renderTermControls()}
    </div>
  )
}
