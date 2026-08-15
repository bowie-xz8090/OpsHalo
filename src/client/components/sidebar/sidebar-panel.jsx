/**
 * Connection list side panel (mini edition)
 */

import { memo } from 'react'
import BookmarkWrap from './bookmark'
import { Tooltip } from 'antd'
import {
  CloseOutlined,
  PlusCircleOutlined,
  PushpinOutlined
} from '@ant-design/icons'

export default memo(function SidebarPanel (props) {
  const { pinned } = props
  const { store } = window
  const prps = {
    className: 'font16 mg1x mg2l pointer iblock control-icon'
  }
  const prps1 = {
    className: prps.className + (pinned ? ' pinned' : '')
  }

  return (
    <div
      className='sidebar-panel bookmarks-panel animate-fast'
    >
      <div className='sidebar-pin-top'>
        <div className='pd1y pd1x sidebar-panel-control alignright'>
          <span className='fleft bold pd1l' style={{ lineHeight: '24px' }}>
            连接列表
          </span>
          <Tooltip title='新建连接'>
            <PlusCircleOutlined
              {...prps}
              onClick={() => store.openConnectionModal()}
            />
          </Tooltip>
          <Tooltip title='固定'>
            <PushpinOutlined
              {...prps1}
              onClick={store.handlePin}
            />
          </Tooltip>
          <CloseOutlined
            {...prps}
            onClick={store.handleCloseSidebar}
          />
        </div>
      </div>
      <BookmarkWrap {...props} />
    </div>
  )
})
