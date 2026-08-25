/**
 * user-controll.json controll
 */

const { dbAction } = require('./db')
const { userConfigId, userNoEncryptConfigId } = require('../common/constants')
const { getDbConfig } = require('./get-config')
const globalState = require('./glob-state')
const { normalizeLegacyAgentConfig } = require('../agent/config')

const configNoEncryptFields = ['allowMultiInstance']

function hasNoEncryptFields (userConfig) {
  for (const f of configNoEncryptFields) {
    if (f in userConfig) {
      return true
    }
  }
  return false
}

exports.saveUserConfig = async (userConfig) => {
  userConfig = normalizeLegacyAgentConfig(userConfig)
  const q = {
    _id: userConfigId
  }
  delete userConfig.host
  delete userConfig.terminalTypes
  delete userConfig.tokenElecterm
  delete userConfig.server
  delete userConfig.port
  globalState.update('config', userConfig)
  const conf = await getDbConfig()
  if (hasNoEncryptFields(userConfig)) {
    const q1 = {
      _id: userNoEncryptConfigId
    }
    const noEncryptConfig = {}
    for (const f of configNoEncryptFields) {
      if (f in userConfig) {
        noEncryptConfig[f] = userConfig[f]
      }
    }
    await dbAction('data', 'update', q1, noEncryptConfig, {
      upsert: true
    })
  }
  const persistedConfig = normalizeLegacyAgentConfig({
    ...q,
    ...conf,
    ...userConfig
  })
  const result = await dbAction('data', 'update', q, persistedConfig, {
    upsert: true
  })
  try {
    require('../agent').getAgentRuntime()?.refreshConfig(userConfig)
  } catch (_) {}
  return result
}
