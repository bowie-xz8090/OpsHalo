/**
 * Mini edition: flat connection list (no bookmark group tree)
 */
import { auto } from 'manate/react'
import { Empty, Input, Spin } from 'antd'
import { useState } from 'react'
import createTitle from '../../common/create-title'
import {
  EditOutlined,
  ApiOutlined
} from '@ant-design/icons'
import './connection-list.styl'

function filterConnections (bookmarks, keyword) {
  const kw = keyword.trim().toLowerCase()
  return bookmarks
    .filter(b => b && b.host && b.type !== 'local')
    .filter(b => {
      if (!kw) return true
      const title = createTitle(b, false).toLowerCase()
      return title.includes(kw) ||
        String(b.host || '').toLowerCase().includes(kw) ||
        String(b.title || '').toLowerCase().includes(kw) ||
        String(b.username || '').toLowerCase().includes(kw)
    })
}

export default auto(function ConnectionList ({ store, from, autoFocus, batch }) {
  const [keyword, setKeyword] = useState('')
  const bookmarks = Array.isArray(store.bookmarks) ? store.bookmarks : []
  const openedSideBar = store.openedSideBar
  const dataReady = store.configLoaded && !store.initLoadingData
  // Do not useMemo on bookmarks — sidebar mounts before data load; a cached
  // empty list would stick if the array is filled without changing reference.
  const list = filterConnections(bookmarks, keyword)

  // Hooks must run before any early return
  if (from === 'sidebar' && openedSideBar !== 'bookmarks') {
    return null
  }

  if (!dataReady) {
    return (
      <div className='connection-list connection-list-loading pd3 aligncenter'>
        <Spin description='正在加载连接列表…' />
      </div>
    )
  }

  function handleConnect (item) {
    // Set batch before addTab — parent onClick runs after this and is too late.
    if (batch !== undefined && batch !== null) {
      window.openTabBatch = batch
    } else if (from !== 'sidebar') {
      window.openTabBatch = window.store.currentLayoutBatch ?? 0
    }
    if (!store.pinned && from === 'sidebar') {
      store.setOpenedSideBar('')
    }
    store.onSelectBookmark(item.id)
  }

  function handleEdit (e, item) {
    e.stopPropagation()
    store.openConnectionModal(item)
  }

  if (!list.length && !keyword) {
    return (
      <div className='connection-list pd2y pd1x'>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description='暂无保存的连接，点击「新建连接」添加'
        />
      </div>
    )
  }

  return (
    <div className='connection-list'>
      <div className='connection-list-search pd1x'>
        <Input.Search
          allowClear
          placeholder='搜索连接'
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          autoFocus={autoFocus}
        />
      </div>
      <div className='connection-list-items'>
        {
          list.length
            ? list.map(item => (
              <div
                key={item.id}
                className='connection-list-item pointer'
                onClick={() => handleConnect(item)}
                title='点击连接'
              >
                <ApiOutlined className='connection-list-icon' />
                <div className='connection-list-main'>
                  <div className='connection-list-title'>
                    {createTitle(item, false)}
                  </div>
                  {
                    item.description
                      ? (
                        <div className='connection-list-desc'>
                          {item.description}
                        </div>
                        )
                      : null
                  }
                </div>
                <EditOutlined
                  className='connection-list-edit'
                  onClick={(e) => handleEdit(e, item)}
                  title='编辑'
                />
              </div>
            ))
            : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description='无匹配连接'
              />
              )
        }
      </div>
    </div>
  )
})
