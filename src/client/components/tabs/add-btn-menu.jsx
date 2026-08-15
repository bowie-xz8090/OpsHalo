/**
 * Add button menu — mini edition
 */

import React, { useCallback, useState } from 'react'
import {
  PlusCircleOutlined,
  BookOutlined
} from '@ant-design/icons'
import BookmarksList from '../sidebar/connection-list'
import DragHandle from '../common/drag-handle'

export default function AddBtnMenu ({
  menuRef,
  menuPosition,
  menuTop,
  menuLeft,
  onMenuScroll,
  batch,
  addPanelWidth,
  setAddPanelWidth,
  onClose
}) {
  const [showList, setShowList] = useState(false)
  const cls = 'pd2x pd1y context-item pointer'

  const onDragEnd = useCallback((nw) => {
    if (setAddPanelWidth) {
      setAddPanelWidth(nw)
    }
  }, [setAddPanelWidth])

  const onDragMove = useCallback((nw) => {
    if (menuRef.current) {
      menuRef.current.style.width = nw + 'px'
    }
  }, [menuRef])

  const handleNewConnection = () => {
    window.openTabBatch = batch
    window.store.openConnectionModal()
    onClose?.()
  }

  const handleShowList = () => {
    setShowList(true)
  }

  const dragProps = {
    min: 300,
    max: 600,
    width: addPanelWidth || 300,
    onDragEnd,
    onDragMove,
    left: menuPosition === 'right'
  }

  return (
    <div
      ref={menuRef}
      className={`add-menu-wrap add-menu-${menuPosition}`}
      style={{
        maxHeight: window.innerHeight - menuTop - 50,
        top: menuTop,
        left: menuLeft,
        width: addPanelWidth ? addPanelWidth + 'px' : undefined
      }}
      onScroll={onMenuScroll}
    >
      <DragHandle
        {...dragProps}
      />
      <div className='add-menu-header'>
        <div
          className={cls}
          onClick={handleNewConnection}
        >
          <PlusCircleOutlined /> 新建连接
        </div>
        <div
          className={cls + (showList ? ' active' : '')}
          onClick={handleShowList}
        >
          <BookOutlined /> 连接列表
        </div>
      </div>
      {
        showList
          ? (
            <div className='add-menu-list'>
              <div className='pd1x pd1y bold'>连接列表</div>
              <BookmarksList store={window.store} autoFocus />
            </div>
            )
          : null
      }
    </div>
  )
}
