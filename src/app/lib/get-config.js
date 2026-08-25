const { dbAction } = require('./db')
const defaultSetting = require('../common/config-default')
const getPort = require('./get-port')
const { userConfigId, userNoEncryptConfigId } = require('../common/constants')
const generate = require('../common/uid')
const globalState = require('./glob-state')
const { normalizeLegacyAgentConfig, hasLegacyAgentConfig } = require('../agent/config')

exports.getConfig = async (inited) => {
  const query = {
    _id: userConfigId
  }
  const storedUserConfig = await dbAction('data', 'findOne', query) || {}
  const shouldMigrateAgentConfig = hasLegacyAgentConfig(storedUserConfig)
  const userConfig = normalizeLegacyAgentConfig(storedUserConfig)
  if (shouldMigrateAgentConfig) {
    await dbAction('data', 'update', query, {
      ...userConfig,
      _id: userConfigId
    }, { upsert: true })
  }
  const requireAuth = userConfig.hashedPassword
  delete userConfig._id
  delete userConfig.host
  delete userConfig.terminalTypes
  delete userConfig.tokenElecterm
  delete userConfig.hashedPassword
  delete userConfig.salt
  const port = inited
    ? globalState.get('config').port
    : await getPort()
  const config = {
    ...defaultSetting,
    ...userConfig,
    requireAuth,
    port,
    tokenElecterm: inited ? globalState.get('config').tokenElecterm : generate()
  }
  return {
    userConfig,
    config
  }
}

exports.getDbConfig = async () => {
  const userConfig = await dbAction('data', 'findOne', {
    _id: userConfigId
  }) || {}
  return userConfig
}

exports.getUserConfigNoEnc = async () => {
  const userConfig = await dbAction('data', 'findOne', {
    _id: userNoEncryptConfigId
  }) || {}
  return userConfig
}
