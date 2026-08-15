/**
 * setting modal — mini edition
 * Connections are edited via connection popup, not this settings drawer.
 */

import { auto } from 'manate/react'
import { pick } from 'lodash-es'
import { Tabs, Spin } from 'antd'
import { lazy, Suspense } from 'react'
import SettingModal from './setting-wrap'
import {
  settingMap,
  modals
} from '../../common/constants'

const TabSettings = lazy(() => import('./tab-settings'))
const TabThemes = lazy(() => import('./tab-themes'))

const Loading = () => <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>

const e = window.translate

const miniTabs = [
  settingMap.setting,
  settingMap.terminalThemes
]

export default auto(function SettingModalWrap (props) {
  const selectItem = (item) => {
    window.store.setSettingItem(item)
  }

  function renderTabs () {
    const { store } = props
    const tabsShouldConfirmDel = [
      settingMap.terminalThemes
    ]
    const { settingTab, settingItem, settingSidebarList } = store
    const activeTab = miniTabs.includes(settingTab)
      ? settingTab
      : settingMap.setting
    const props0 = {
      store,
      activeItemId: settingItem.id,
      type: activeTab,
      onClickItem: selectItem,
      shouldConfirmDel: tabsShouldConfirmDel.includes(activeTab),
      list: settingSidebarList
    }
    const formProps = {
      store,
      formData: settingItem,
      type: activeTab,
      hide: store.hideSettingModal,
      ...pick(store, [
        'config'
      ]),
      serials: store.serials,
      loaddingSerials: store.loaddingSerials
    }
    const items = [
      {
        key: settingMap.setting,
        label: e(settingMap.setting),
        children: null
      },
      {
        key: settingMap.terminalThemes,
        label: 'UI主题设置',
        children: null
      }
    ]
    const tabsProps = {
      activeKey: activeTab,
      animated: false,
      items,
      onChange: store.handleChangeSettingTab,
      destroyOnHidden: true,
      className: 'setting-tabs',
      type: 'card'
    }
    return (
      <>
        <Tabs
          {...tabsProps}
        />
        <Suspense fallback={<Loading />}>
          <TabSettings
            listProps={props0}
            settingItem={settingItem}
            settingTab={activeTab}
            store={store}
          />
          <TabThemes
            listProps={props0}
            settingItem={settingItem}
            formProps={formProps}
            store={store}
            settingTab={activeTab}
          />
        </Suspense>
      </>
    )
  }

  const {
    showModal,
    hideSettingModal,
    innerWidth,
    useSystemTitleBar
  } = props.store
  const show = showModal === modals.setting
  if (!show) {
    return null
  }
  return (
    <SettingModal
      onCancel={hideSettingModal}
      visible={show}
      useSystemTitleBar={useSystemTitleBar}
      innerWidth={innerWidth}
      isMobile={props.store.isMobile}
    >
      {renderTabs()}
    </SettingModal>
  )
})
