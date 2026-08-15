import {
  SwapOutlined
} from '@ant-design/icons'
import {
  Badge,
  Popover
} from 'antd'
import classnames from 'classnames'
import TransferModal from './transfer-modal'
import './transfer.styl'

const e = window.translate

export default function TransferList (props) {
  const {
    fileTransfers = [],
    transferTab,
    transferHistory = [],
    variant = 'sidebar',
    alwaysShow = false
  } = props
  const len = fileTransfers.length
  if (!alwaysShow && !len && !transferHistory.length) {
    return null
  }
  const color = fileTransfers.some(item => item.error) ? 'red' : 'green'
  const isSession = variant === 'session'
  const bdProps = {
    count: len,
    size: 'small',
    offset: isSession ? [-2, 2] : [-10, -5],
    color,
    overflowCount: 99,
    showZero: false
  }
  const transferModalProps = {
    fileTransfers,
    transferHistory,
    transferTab
  }
  const hasContent = len > 0 || transferHistory.length > 0
  const popProps = {
    placement: isSession ? 'bottomLeft' : 'right',
    destroyOnHidden: true,
    classNames: { root: 'transfer-list-card' },
    autoAdjustOverflow: true,
    content: hasContent
      ? <TransferModal {...transferModalProps} />
      : <div className='pd1'>{e('fileTransfers')}: 0</div>
  }
  const icon = (
    <SwapOutlined
      className={classnames(
        isSession
          ? 'sess-icon pointer transfer-session-icon'
          : 'iblock font20 control-icon'
      )}
    />
  )
  return (
    <div
      className={isSession ? 'transfer-session-wrap' : 'control-icon-wrap'}
      title={e('fileTransfers')}
    >
      <Popover {...popProps}>
        <span className='pointer'>
          <Badge {...bdProps}>
            {icon}
          </Badge>
        </span>
      </Popover>
    </div>
  )
}
