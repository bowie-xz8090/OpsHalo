import { refsStatic } from '../common/ref'
import { useEffect, useRef } from 'react'
import ConnectionList from './connection-list'
import { debounce } from 'lodash-es'

export default function BookmarkPanel (props) {
  const { store } = window
  const bookmarksPanelRef = useRef(null)
  const SCROLL_REF_ID = 'bookmarks-scroll-position'

  useEffect(() => {
    if (store.openedSideBar) {
      const savedPosition = refsStatic.get(SCROLL_REF_ID)
      if (savedPosition) {
        setTimeout(() => {
          if (bookmarksPanelRef.current) {
            bookmarksPanelRef.current.scrollTop = savedPosition
          }
        }, 100)
      }
    }
  }, [store.openedSideBar])

  const handleScroll = debounce((e) => {
    const top = e.target.scrollTop
    if (top > 0) {
      refsStatic.add(SCROLL_REF_ID, e.target.scrollTop)
    }
  }, 100)

  return (
    <div className='sidebar-panel-bookmarks' ref={bookmarksPanelRef} onScroll={handleScroll}>
      <div className='sidebar-inner'>
        <ConnectionList store={store} from='sidebar' />
      </div>
    </div>
  )
}
