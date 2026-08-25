const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const removedDependencies = [
  '@openai/codex',
  '@strands-agents/sdk',
  '@modelcontextprotocol/sdk',
  '@opentelemetry/api',
  'openai',
  'jsonwebtoken',
  '@electerm/ftp-srv',
  '@novnc/novnc',
  'basic-ftp',
  'ironrdp-wasm',
  'node-forge',
  'serialport',
  'spice-client'
]
const removedPaths = [
  'src/app/server/session-telnet.js',
  'src/app/server/session-serial.js',
  'src/app/server/session-ftp.js',
  'src/app/server/session-rdp.js',
  'src/app/server/session-vnc.js',
  'src/app/server/session-spice.js',
  'src/app/server/xmodem.js',
  'src/client/components/rdp',
  'src/client/components/vnc',
  'src/client/components/spice',
  'src/client/components/web',
  'src/client/components/profile',
  'src/client/components/quick-commands',
  'src/client/components/widgets',
  'src/client/components/batch-op/batch-op-editor.jsx',
  'src/client/components/batch-op/batch-op-logs.jsx',
  'src/client/store/quick-command.js',
  'src/app/agent/harness/strands-harness-adapter.js'
]

function hasFiles (target) {
  if (!fs.existsSync(target)) return false
  if (fs.statSync(target).isFile()) return true
  return fs.readdirSync(target).some(entry => hasFiles(path.join(target, entry)))
}

test('Mini package has no removed protocol dependencies', () => {
  const pkg = require('../../package.json')
  for (const dependency of removedDependencies) {
    assert.equal(pkg.dependencies?.[dependency], undefined, dependency)
    assert.equal(pkg.devDependencies?.[dependency], undefined, dependency)
  }
})

test('Mini source has no removed protocol implementations', () => {
  for (const relativePath of removedPaths) {
    assert.equal(hasFiles(path.join(root, relativePath)), false, relativePath)
  }
})

test('session factory rejects removed protocol types instead of treating them as SSH', async () => {
  const { startSession } = require('../../src/app/server/session')
  for (const type of ['telnet', 'serial', 'ftp', 'rdp', 'vnc', 'spice', 'web']) {
    await assert.rejects(
      startSession({ type }, {}),
      error => error.code === 'UNSUPPORTED_SESSION_TYPE'
    )
  }
})

test('build config no longer relies on heavy-session stubs', () => {
  const source = fs.readFileSync(path.join(root, 'build/vite/conf.js'), 'utf8')
  assert.doesNotMatch(source, /miniStubPlugin|ironrdp|novnc|spice-client/)
})

test('packaged OpsHalo removes the Electron default app fallback', () => {
  const afterPack = fs.readFileSync(path.resolve(__dirname, '../../build/bin/after-pack.js'), 'utf8')
  assert.match(afterPack, /default_app\.asar/)
  assert.match(afterPack, /unlinkSync\(defaultApp\)/)
  assert.match(afterPack, /assertPackagedRuntimePolicy\(resourcesDir\)/)
  assert.match(afterPack, /MAX_APP_ASAR_BYTES = 18 \* 1024 \* 1024/)
})

test('node-pty cleanup preserves every Unix runtime binary', t => {
  const { slimNodePty } = require('../../build/bin/mini-slim')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-node-pty-'))
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  const release = path.join(tempRoot, 'build', 'Release')
  fs.mkdirSync(release, { recursive: true })
  for (const name of ['pty.node', 'spawn-helper', 'compile.log']) {
    fs.writeFileSync(path.join(release, name), name)
  }

  slimNodePty(tempRoot)

  assert.equal(fs.existsSync(path.join(release, 'pty.node')), true)
  assert.equal(fs.existsSync(path.join(release, 'spawn-helper')), true)
  assert.equal(fs.existsSync(path.join(release, 'compile.log')), false)
})

test('release artifact scan rejects Codex and retired Agent runtime entries', () => {
  const { isForbiddenCodexPath, isForbiddenRetiredAgentPath, requiredRuntimePaths } = require('../../build/bin/verify-mini-artifact')
  assert.equal(isForbiddenCodexPath('/node_modules/@openai/codex-darwin-arm64/vendor/bin/codex'), true)
  assert.equal(isForbiddenCodexPath('app.asar.unpacked/vendor/codex.exe'), true)
  assert.equal(isForbiddenCodexPath('agent/providers/codex-runtime-manager.js'), false)
  assert.equal(isForbiddenRetiredAgentPath('/node_modules/@strands-agents/sdk/dist/index.js'), true)
  assert.equal(isForbiddenRetiredAgentPath('/node_modules/@aws-sdk/core/index.js'), true)
  assert.equal(isForbiddenRetiredAgentPath('/node_modules/@smithy/core/index.js'), true)
  assert.equal(isForbiddenRetiredAgentPath('/node_modules/openai/index.js'), true)
  assert.equal(isForbiddenRetiredAgentPath('/agent/harness/strands-harness-adapter.js'), true)
  assert.equal(isForbiddenRetiredAgentPath('/agent/harness/openai-harness-adapter.js'), false)
  assert.equal(requiredRuntimePaths.includes('node_modules/node-pty/build/Release/pty.node'), true)
  if (process.platform !== 'win32') {
    assert.equal(requiredRuntimePaths.includes('node_modules/node-pty/build/Release/spawn-helper'), true)
  }
})

test('v1.0.27 release sizes use platform-specific strictness', t => {
  const { LIMITS, classifyArtifact, verifyReleaseSizes } = require('../../build/bin/verify-release-size')
  assert.deepEqual(classifyArtifact('OpsHalo-1.0.27-win-x64-installer.exe'), ['Windows installer', 90 * 1024 * 1024, true])
  assert.deepEqual(classifyArtifact('OpsHalo-1.0.27-win-x64.tar.gz'), ['Windows tarball', 120 * 1024 * 1024, false])
  assert.deepEqual(classifyArtifact('OpsHalo-1.0.27-mac-arm64.dmg'), ['macOS DMG', 95 * 1024 * 1024, false])
  assert.deepEqual(classifyArtifact('OpsHalo-1.0.27-linux-x86_64.AppImage'), ['Linux package', 85 * 1024 * 1024, false])
  assert.equal(LIMITS.linuxTarball, 105 * 1024 * 1024)

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-release-size-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const installer = path.join(root, 'OpsHalo-1.0.27-win-x64-installer.exe')
  fs.writeFileSync(installer, '')
  fs.truncateSync(installer, LIMITS.windowsInstaller)
  assert.equal(verifyReleaseSizes(root)[0].bytes, LIMITS.windowsInstaller)
  fs.truncateSync(installer, LIMITS.windowsInstaller + 1)
  assert.throws(() => verifyReleaseSizes(root), /Release size gate failed/)
})

test('Mini deep links register only SSH and the internal app protocol', () => {
  const main = fs.readFileSync(path.join(root, 'src/app/lib/deep-link.js'), 'utf8')
  const renderer = fs.readFileSync(path.join(root, 'src/client/components/setting-panel/deep-link-control.jsx'), 'utf8')
  assert.match(main, /DEEP_LINK_PROTOCOLS = \['ssh', 'electerm'\]/)
  assert.match(renderer, /const protocols = \['ssh', 'electerm'\]/)
  assert.doesNotMatch(main, /'telnet'|'rdp'|'vnc'|'serial'|'spice'|'ftp'/)
})

test('old removed bookmarks remain unchanged on load and are rejected for new use', async () => {
  const moduleUrl = pathToFileURL(path.join(root, 'src/client/components/bookmark-form/fix-bookmark-default.js')).href
  const { fixBookmarkData, validateBookmarkData } = await import(moduleUrl)
  const old = { id: 'legacy-rdp', type: 'rdp', host: 'legacy.example', password: 'preserve-for-rollback' }
  assert.equal(fixBookmarkData(old), old)
  assert.equal(validateBookmarkData(old).valid, false)
  assert.equal(old.password, 'preserve-for-rollback')
  const listSource = fs.readFileSync(path.join(root, 'src/client/components/sidebar/connection-list.jsx'), 'utf8')
  assert.match(listSource, /!b\.type \|\| b\.type === 'ssh'/)
})

test('hidden Quick Command and Profile features are absent from new bookmark contracts', () => {
  const contracts = [
    fs.readFileSync(path.join(root, 'src/app/common/bookmark-zod-schemas.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/client/common/bookmark-schemas.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/client/components/bookmark-form/bookmark-schema.js'), 'utf8')
  ].join('\n')
  assert.doesNotMatch(contracts, /quickCommands|quickCommandSchema|password\|privateKey\|profiles/)
})
