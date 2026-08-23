/**
 * electron-builder afterPack: strip bulky Chromium license dump from packaged app.
 * Does not affect runtime; shrinks win-unpacked / install payload.
 */
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack (context) {
  const appOutDir = context.appOutDir
  const license = path.join(appOutDir, 'LICENSES.chromium.html')
  if (fs.existsSync(license)) {
    const size = fs.statSync(license).size
    fs.unlinkSync(license)
    console.log(`[mini-slim] removed LICENSES.chromium.html (${(size / 1024 / 1024).toFixed(1)} MB)`)
  }
  const resourcesDir = process.platform === 'darwin'
    ? path.join(appOutDir, 'OpsHalo.app', 'Contents', 'Resources')
    : path.join(appOutDir, 'resources')
  const defaultApp = path.join(resourcesDir, 'default_app.asar')
  if (fs.existsSync(defaultApp)) {
    fs.unlinkSync(defaultApp)
    console.log('[mini-slim] removed Electron default_app.asar fallback')
  }
}
