/**
 * New / edit SSH connection popup (mini edition)
 * Visibility is driven by props from the auto-wrapped Main parent
 * so manate reactivity is reliable.
 */
import { Modal } from 'antd'
import { pick } from 'lodash-es'
import BookmarkForm from '../bookmark-form'
import {
  settingMap
} from '../../common/constants'
import getInitItem from '../../common/init-setting-item'
import './connection-modal.styl'

export default function ConnectionModal ({ store }) {
  const visible = !!store.connectionModalVisible
  const formData = store.connectionFormItem || getInitItem([], settingMap.bookmarks)
  const isNew = !formData.id || String(formData.id).startsWith('new-bookmark')

  function handleClose () {
    store.hideConnectionModal()
  }

  if (!visible) {
    return null
  }

  const formProps = {
    store,
    formData,
    type: settingMap.bookmarks,
    hide: handleClose,
    ...pick(store, [
      'currentBookmarkGroupId',
      'config'
    ]),
    bookmarkGroups: store.bookmarkGroups || [],
    bookmarks: store.bookmarks || [],
    serials: store.serials || [],
    loaddingSerials: store.loaddingSerials
  }

  return (
    <Modal
      open={visible}
      title={isNew ? '新建连接' : '编辑连接'}
      onCancel={handleClose}
      footer={null}
      width={720}
      destroyOnHidden
      className='connection-modal'
      centered
      zIndex={2000}
      getContainer={() => document.body}
      styles={{
        body: {
          maxHeight: '70vh',
          overflow: 'auto',
          paddingTop: 8
        }
      }}
    >
      <BookmarkForm
        key={formData.id || 'new-connection'}
        {...formProps}
      />
    </Modal>
  )
}
