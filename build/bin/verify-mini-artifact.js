const fs = require('fs')
const path = require('path')

const removedRelativePaths = [
  'server/session-telnet.js',
  'server/session-serial.js',
  'server/session-ftp.js',
  'server/session-rdp.js',
  'server/session-vnc.js',
  'server/session-spice.js',
  'server/ftp-client.js',
  'server/ftp-file.js',
  'server/ftp-transfer.js',
  'server/rdp-proxy.js',
  'server/spice-proxy.js',
  'server/telnet.js',
  'lib/serial-port.js',
  'widgets/widget-batch-op.js',
  'widgets/widget-local-ftp-server.js',
  'agent/harness/strands-harness-adapter.js'
]

const removedModules = [
  '@openai/codex',
  '@strands-agents/sdk',
  '@modelcontextprotocol/sdk',
  '@opentelemetry/api',
  '@aws-sdk',
  '@smithy',
  'openai',
  'electerm-sync',
  'jsonwebtoken',
  '@electerm/ftp-srv',
  '@novnc/novnc',
  'basic-ftp',
  'ironrdp-wasm',
  'node-forge',
  'serialport',
  'spice-client'
]

const requiredRuntimePaths = [
  'agent/harness/openai-harness-adapter.js',
  'agent/harness/codex-app-server-adapter.js',
  'node_modules/node-pty/build/Release/pty.node',
  ...(process.platform === 'darwin' ? ['node_modules/node-pty/build/Release/spawn-helper'] : [])
]

function verifyMiniArtifact (artifactRoot = path.resolve(__dirname, '../../work/app')) {
  if (!fs.existsSync(artifactRoot)) throw new Error(`Mini artifact is missing: ${artifactRoot}`)
  const violations = []
  for (const relative of removedRelativePaths) {
    if (fs.existsSync(path.join(artifactRoot, relative))) violations.push(relative)
  }
  for (const moduleName of removedModules) {
    if (fs.existsSync(path.join(artifactRoot, 'node_modules', ...moduleName.split('/')))) violations.push(`node_modules/${moduleName}`)
  }
  collectForbiddenCodexEntries(artifactRoot, artifactRoot, violations)
  collectForbiddenRetiredAgentEntries(artifactRoot, artifactRoot, violations)
  for (const relative of requiredRuntimePaths) {
    if (!fs.existsSync(path.join(artifactRoot, relative))) violations.push(`missing:${relative}`)
  }
  const pkgPath = path.join(artifactRoot, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  for (const moduleName of removedModules) {
    if (pkg.dependencies?.[moduleName]) violations.push(`package.json:${moduleName}`)
  }
  if (violations.length) throw new Error(`Removed Mini features remain in artifact:\n${violations.join('\n')}`)
  return { artifactRoot, checkedPaths: removedRelativePaths.length, checkedModules: removedModules.length, checkedRuntimePaths: requiredRuntimePaths.length }
}

function collectForbiddenCodexEntries (root, current, violations) {
  let entries = []
  try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch (_) { return }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (isForbiddenCodexPath(relative)) {
        violations.push(relative)
        continue
      }
      collectForbiddenCodexEntries(root, absolute, violations)
      continue
    }
    if (entry.isFile() && isForbiddenCodexPath(relative)) {
      violations.push(relative)
    }
  }
}

function isForbiddenCodexPath (relativePath) {
  const normalized = String(relativePath || '').split(path.sep).join('/').replace(/^\/+/, '')
  return /(?:^|\/)node_modules\/@openai\/codex(?:-|\/|$)/.test(normalized) ||
    /(?:^|\/)(?:codex|codex\.exe|codex-code-mode-host(?:\.exe)?|codex-command-runner\.exe|codex-windows-sandbox-setup\.exe|codex-linux-sandbox)$/.test(normalized)
}

function collectForbiddenRetiredAgentEntries (root, current, violations) {
  let entries = []
  try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch (_) { return }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (isForbiddenRetiredAgentPath(relative)) {
        violations.push(relative)
        continue
      }
      collectForbiddenRetiredAgentEntries(root, absolute, violations)
      continue
    }
    if (entry.isFile() && isForbiddenRetiredAgentPath(relative)) violations.push(relative)
  }
}

function isForbiddenRetiredAgentPath (relativePath) {
  const normalized = String(relativePath || '').split(path.sep).join('/').replace(/^\/+/, '')
  return /(?:^|\/)agent\/harness\/strands-harness-adapter\.js$/.test(normalized) ||
    /(?:^|\/)node_modules\/(?:@strands-agents\/sdk|@modelcontextprotocol\/sdk|@opentelemetry\/api|@aws-sdk|@smithy|openai)(?:\/|$)/.test(normalized)
}

if (require.main === module) {
  const result = verifyMiniArtifact(process.argv[2])
  console.log(`Mini artifact verified: ${result.checkedPaths} removed paths, ${result.checkedModules} removed modules, ${result.checkedRuntimePaths} required runtime paths`)
}

module.exports = {
  verifyMiniArtifact,
  removedRelativePaths,
  removedModules,
  requiredRuntimePaths,
  collectForbiddenCodexEntries,
  isForbiddenCodexPath,
  collectForbiddenRetiredAgentEntries,
  isForbiddenRetiredAgentPath
}
