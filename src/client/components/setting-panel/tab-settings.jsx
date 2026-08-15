import { auto } from 'manate/react'
import message from '../common/message'
import SettingCommon from './setting-common'
import SettingTerminal from './setting-terminal'
import SettingCol from './col'
import SettingAi from '../ai/ai-config'
import SyncSetting from '../setting-sync/setting-sync'
import List from './list'
import {
  settingMap,
  settingSyncId,
  settingTerminalId,
  settingAiId,
  settingCommonId
} from '../../common/constants'
import { aiConfigsArr } from '../ai/ai-config-props'
import { pick } from 'lodash-es'

export default auto(function TabSettings (props) {
  const {
    settingTab
  } = props
  if (settingTab !== settingMap.setting) {
    return null
  }
  const {
    settingItem,
    listProps,
    store
  } = props

  function getInitialValues () {
    const res = pick(props.store.config, aiConfigsArr)
    if (!res.languageAI) {
      res.languageAI = window.store.getLangName()
    }
    return res
  }

  function handleConfigSubmit (values) {
    window.store.updateConfig(values)
    message.success('Saved')
  }

  const aiConfProps = {
    initialValues: getInitialValues(),
    onSubmit: handleConfigSubmit,
    showAIConfig: true
  }

  const sid = settingItem.id
  let elem = (
    <SettingCommon
      {...listProps}
      config={store.config}
    />
  )
  if (sid === settingSyncId) {
    const syncProps = pick(store, [
      'config',
      'isSyncingSetting',
      'isSyncDownload',
      'isSyncUpload',
      'syncType',
      'syncServerStatus'
    ])
    elem = <SyncSetting {...syncProps} />
  } else if (sid === settingAiId) {
    elem = <SettingAi {...aiConfProps} />
  } else if (sid === settingTerminalId) {
    elem = <SettingTerminal {...listProps} config={store.config} />
  } else if (sid === settingCommonId) {
    elem = (
      <SettingCommon
        {...listProps}
        config={store.config}
      />
    )
  }

  return (
    <div
      className='setting-tabs-setting'
    >
      <SettingCol>
        <List
          {...listProps}
        />
        {elem}
      </SettingCol>
    </div>
  )
})
