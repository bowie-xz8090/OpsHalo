/**
 * setting modal
 */

import message from '../components/common/message'
import copy from 'json-deep-copy'
import {
  settingMap,
  settingCommonId,
  settingSyncId,
  modals
} from '../common/constants'
import { buildNewTheme } from '../common/terminal-theme'
import getInitItem from '../common/init-setting-item'
import newTerm from '../common/new-terminal'
import settingList from '../common/setting-list'

const e = window.translate

export default Store => {
  Store.prototype.setConfig = function (conf) {
    const { store } = window
    Object.assign(
      store._config,
      copy(conf)
    )
  }
  Store.prototype.setSftpSortSetting = function (conf) {
    Object.assign(
      window.store.sftpSortSetting,
      conf
    )
  }

  Store.prototype.openBookmarkEdit = function (item) {
    window.store.openConnectionModal(item)
  }

  Store.prototype.handleOpenQuickCommandsSetting = function () {
    // Quick commands removed in mini edition
    window.store.openSetting()
  }

  Store.prototype.onSelectHistory = function (tab) {
    const { store } = window
    const type = tab?.type || 'ssh'
    if (type !== 'ssh') {
      return message.warning('Mini 版仅支持 SSH 连接')
    }
    const batch = Number(window.openTabBatch ?? store.currentLayoutBatch ?? 0) || 0
    store.addTab({
      ...copy(tab),
      type: 'ssh',
      ...newTerm(true, true),
      batch
    })
    delete window.openTabBatch
  }

  Store.prototype.onSelectBookmark = function (id) {
    const { store } = window
    const bookmarks = Array.isArray(store.bookmarks) ? store.bookmarks : []
    const found = bookmarks.find(it => it && it.id === id)
    if (!found) {
      return
    }
    const item = copy(found)
    if (item.type && item.type !== 'ssh') {
      return message.warning('Mini 版仅支持 SSH 连接')
    }
    const batch = Number(window.openTabBatch ?? store.currentLayoutBatch ?? 0) || 0
    store.addTab({
      ...item,
      type: 'ssh',
      from: 'bookmarks',
      srcId: item.id,
      ...newTerm(true, true),
      batch
    })

    delete window.openTabBatch
  }

  Store.prototype.openSetting = function () {
    const { store } = window
    const commonItem = getInitItem([], settingMap.setting)
    if (
      store.settingTab === settingMap.setting &&
      store.settingItem.id === settingCommonId &&
      store.showModal === modals.setting
    ) {
      return store.hideSettingModal()
    }
    store.settingTab = settingMap.setting
    store.setSettingItem(commonItem)
    store.openSettingModal()
  }

  Store.prototype.openSettingSync = function () {
    const { store } = window
    if (
      store.settingTab === settingMap.setting &&
      store.settingItem.id === settingSyncId &&
      store.showModal === modals.setting
    ) {
      return store.hideSettingModal()
    }
    store.storeAssign({
      settingTab: settingMap.setting
    })
    store.setSettingItem(settingList().find(d => d.id === settingSyncId))
    store.openSettingModal()
  }

  Store.prototype.openTerminalThemes = function () {
    const { store } = window
    if (
      store.settingTab === settingMap.terminalThemes &&
      store.settingItem.id === ''
    ) {
      return store.hideSettingModal()
    }
    store.storeAssign({
      settingTab: settingMap.terminalThemes
    })
    store.setSettingItem(buildNewTheme())
    store.openSettingModal()
  }

  Store.prototype.openSettingModal = function () {
    const { store } = window
    if (store.isSecondInstance) {
      return message.warning(
        e('sencondInstanceTip')
      )
    }
    store.showModal = modals.setting
  }

  Store.prototype.hideSettingModal = function () {
    const { store } = window
    store.showModal = modals.hide
    store.setSettingItem({})
  }

  Store.prototype.loadFontList = async function () {
    const fonts = await window.pre.runGlobalAsync('loadFontList')
      .catch(err => {
        console.log('loadFontList error', err)
        return []
      })
    window.et.fonts = fonts
  }

  Store.prototype.handleChangeSettingTab = function (settingTab) {
    const { store } = window
    const nextTab = settingTab === settingMap.bookmarks
      ? settingMap.setting
      : settingTab
    const arr = store.getItems(nextTab)
    const item = getInitItem(arr, nextTab)
    store.storeAssign({
      settingTab: nextTab
    })
    store.setSettingItem(item)
  }
}
