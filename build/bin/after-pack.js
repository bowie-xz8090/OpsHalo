/**
 * electron-builder afterPack: strip bulky Chromium license dump from packaged app.
 * Does not affect runtime; shrinks win-unpacked / install payload.
 */
const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')
const {
  collectForbiddenCodexEntries,
  isForbiddenCodexPath,
  collectForbiddenRetiredAgentEntries,
  isForbiddenRetiredAgentPath
} = require('./verify-mini-artifact')

const MAX_APP_ASAR_BYTES = 18 * 1024 * 1024

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
  assertPackagedRuntimePolicy(resourcesDir)
}

function assertPackagedRuntimePolicy (resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  if (!fs.existsSync(appAsar)) throw new Error(`Packaged app.asar is missing: ${appAsar}`)
  const appAsarBytes = fs.statSync(appAsar).size
  if (appAsarBytes > MAX_APP_ASAR_BYTES) {
    throw new Error(`Packaged app.asar exceeds 18 MiB: ${(appAsarBytes / 1024 / 1024).toFixed(1)} MiB`)
  }
  const violations = asar.listPackage(appAsar).filter(entry => isForbiddenCodexPath(entry) || isForbiddenRetiredAgentPath(entry))
  collectForbiddenCodexEntries(resourcesDir, resourcesDir, violations)
  collectForbiddenRetiredAgentEntries(resourcesDir, resourcesDir, violations)
  if (violations.length) throw new Error(`Packaged application contains forbidden runtime entries:\n${[...new Set(violations)].join('\n')}`)
  console.log(`[runtime-gate] app.asar ${(appAsarBytes / 1024 / 1024).toFixed(1)} MiB; no Codex or retired Agent runtime`)
}

module.exports.assertPackagedRuntimePolicy = assertPackagedRuntimePolicy
module.exports.assertNoCodexRuntime = assertPackagedRuntimePolicy
module.exports.MAX_APP_ASAR_BYTES = MAX_APP_ASAR_BYTES
