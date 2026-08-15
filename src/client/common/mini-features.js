/**
 * Mini edition feature gate.
 * Keep SSH (+ config save), SFTP, AI tips, UI themes,
 * and settings: 通用 / terminal / sync / AI.
 */
import {
  connectionMap,
  settingMap,
  settingTerminalId,
  settingSyncId,
  settingAiId
} from './constants'
import { isAIDisabled } from './ai-feature'

export const MINI_MODE = true

/** Session types available for new connections / bookmarks */
export const miniSessionTypes = [
  connectionMap.ssh
]

/** Top-level setting modal tabs */
export const miniSettingTabs = [
  settingMap.setting,
  settingMap.terminalThemes
]

/** Items under the Settings tab (「通用」由 store.settingSidebarList 前置注入) */
export function getMiniSettingList () {
  const list = [
    {
      id: settingTerminalId,
      title: '终端设置'
    },
    {
      id: settingSyncId,
      title: '数据同步配置'
    },
    {
      id: settingAiId,
      title: 'AI配置'
    }
  ]
  if (isAIDisabled()) {
    return list.filter(item => item.id !== settingAiId)
  }
  return list
}

export function isMiniSessionType (type) {
  return miniSessionTypes.includes(type)
}

export function filterMiniSessionConfig (sessionConfig) {
  if (!MINI_MODE) {
    return sessionConfig
  }
  const next = {}
  for (const key of miniSessionTypes) {
    if (sessionConfig[key]) {
      next[key] = sessionConfig[key]
    }
  }
  return next
}
