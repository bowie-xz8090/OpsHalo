import React, { useCallback, useEffect, useRef } from 'react'
import createTitle, { createTitleWithTag } from '../../common/create-title'
import { DeleteOutlined } from '@ant-design/icons'

export default function HistoryItem (props) {
  const { store } = window
  const {
    item
  } = props
  const timeoutRef = useRef(null)

  const handleClick = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      store.onSelectHistory(item.tab)
    }, 10)
  }, [item.tab])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  function handleDelete (e) {
    e.stopPropagation()
    const { id } = item
    const i = store.history.findIndex((i) => i.id === id)
    if (i !== -1) {
      store.history.splice(i, 1)
    }
  }

  if (!item.tab) {
    return null
  }
  const title = createTitleWithTag(item.tab)
  const tt = createTitle(item.tab)
  return (
    <div
      className='item-list-unit'
      title={tt}
      onClick={handleClick}
    >
      <div className='elli pd1y pd2x'>
        {title}
      </div>
      <DeleteOutlined
        className='list-item-edit'
        onClick={handleDelete}
      />
    </div>
  )
}
