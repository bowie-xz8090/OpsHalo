/**
 * electron-builder afterPack: strip bulky Chromium license dump from packaged app.
 * Does not affect runtime; shrinks win-unpacked / install payload.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
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
  stripUpstreamRuntimeSignatures(context)
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

function stripUpstreamRuntimeSignatures (context) {
  if (context.electronPlatformName === 'darwin') {
    stripMacSignatures(path.join(context.appOutDir, 'OpsHalo.app', 'Contents'))
  } else if (context.electronPlatformName === 'win32') {
    stripWindowsSignatures(context.appOutDir)
  }
}

function stripMacSignatures (root) {
  let removedBytes = 0
  walkFiles(root, file => {
    if (!isMachO(file)) return
    const before = fs.statSync(file).size
    try {
      execFileSync('/usr/bin/codesign', ['--remove-signature', file], { stdio: 'ignore' })
      removedBytes += Math.max(0, before - fs.statSync(file).size)
    } catch (_) {}
  })
  if (removedBytes) {
    console.log(`[mini-slim] removed ${(removedBytes / 1024 / 1024).toFixed(1)} MiB of upstream macOS signatures before application signing`)
  }
}

function stripWindowsSignatures (root) {
  let removedBytes = 0
  walkFiles(root, file => {
    if (!/\.(?:dll|exe|node)$/i.test(file)) return
    removedBytes += stripPeCertificateTable(file)
  })
  if (removedBytes) {
    console.log(`[mini-slim] removed ${(removedBytes / 1024 / 1024).toFixed(1)} MiB of upstream Windows signatures before application signing`)
  }
}

function stripPeCertificateTable (file) {
  let fd
  try {
    fd = fs.openSync(file, 'r+')
    const stat = fs.fstatSync(fd)
    if (stat.size < 256) return 0
    const header = Buffer.alloc(Math.min(stat.size, 4096))
    fs.readSync(fd, header, 0, header.length, 0)
    if (header.readUInt16LE(0) !== 0x5a4d) return 0
    const peOffset = header.readUInt32LE(0x3c)
    if (peOffset + 24 > header.length || header.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return 0
    const optionalOffset = peOffset + 24
    const magic = header.readUInt16LE(optionalOffset)
    const dataDirectoryOffset = magic === 0x20b ? optionalOffset + 112 : magic === 0x10b ? optionalOffset + 96 : 0
    const certificateEntryOffset = dataDirectoryOffset + (8 * 4)
    if (!dataDirectoryOffset || certificateEntryOffset + 8 > header.length) return 0
    const certificateOffset = header.readUInt32LE(certificateEntryOffset)
    const certificateSize = header.readUInt32LE(certificateEntryOffset + 4)
    if (!certificateOffset || !certificateSize || certificateOffset + certificateSize > stat.size) return 0
    const trailingBytes = stat.size - certificateOffset - certificateSize
    if (trailingBytes > 7) return 0
    if (trailingBytes) {
      const trailing = Buffer.alloc(trailingBytes)
      fs.readSync(fd, trailing, 0, trailing.length, certificateOffset + certificateSize)
      if (trailing.some(byte => byte !== 0)) return 0
    }
    fs.writeSync(fd, Buffer.alloc(8), 0, 8, certificateEntryOffset)
    fs.truncateSync(file, certificateOffset)
    return stat.size - certificateOffset
  } catch (_) {
    return 0
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function isMachO (file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const magic = Buffer.alloc(4)
    if (fs.readSync(fd, magic, 0, 4, 0) !== 4) return false
    return new Set([
      'cffaedfe', 'feedfacf', 'cefaedfe', 'feedface',
      'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'
    ]).has(magic.toString('hex'))
  } catch (_) {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function walkFiles (root, visitor) {
  let entries = []
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch (_) { return }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walkFiles(absolute, visitor)
    else if (entry.isFile()) visitor(absolute)
  }
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
module.exports.isMachO = isMachO
module.exports.stripPeCertificateTable = stripPeCertificateTable
