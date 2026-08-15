/**
 * app path
 */
const { app } = require('electron')
const { resolve } = require('path')
const constants = require('./runtime-constants')
const installSrc = require('../lib/install-src')
const { dataDirName } = require('./mini-identity')

function getDataPath () {
  const defaultValue = {
    appPath: app.getPath('appData'),
    isPortable: false
  }
  if (!constants.isWin) {
    return defaultValue
  }
  const exePath = app.getPath('exe')
    .replace(/\\OpsHalo\.exe$/i, '')
    .replace(/\\electerm\.exe$/i, '')
  const p = exePath + '\\' + dataDirName
  if (
    installSrc === 'win-x64-portable.tar.gz' ||
    require('fs').existsSync(
      p
    )
  ) {
    return {
      appPath: exePath,
      exePath,
      isPortable: true
    }
  }
  return {
    ...defaultValue,
    exePath
  }
}

module.exports = {
  ...getDataPath(),
  sshKeysPath: resolve(
    app.getPath('home'),
    '.ssh'
  ),
  dataDirName,
  ...constants
}
