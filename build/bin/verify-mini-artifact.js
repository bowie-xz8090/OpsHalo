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
  'widgets/widget-local-ftp-server.js'
]

const removedModules = [
  '@electerm/ftp-srv',
  '@novnc/novnc',
  'basic-ftp',
  'ironrdp-wasm',
  'node-forge',
  'serialport',
  'spice-client'
]

const requiredRuntimePaths = [
  'node_modules/@openai/codex/bin/codex.js',
  'node_modules/@strands-agents/sdk/dist/src/agent/agent.js',
  'node_modules/@strands-agents/sdk/dist/src/models/openai/model.js',
  'node_modules/@strands-agents/sdk/dist/src/tools/structured-output-tool.js',
  'node_modules/@strands-agents/sdk/dist/src/tools/tool.js'
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

if (require.main === module) {
  const result = verifyMiniArtifact(process.argv[2])
  console.log(`Mini artifact verified: ${result.checkedPaths} removed paths, ${result.checkedModules} removed modules, ${result.checkedRuntimePaths} required runtime paths`)
}

module.exports = { verifyMiniArtifact, removedRelativePaths, removedModules, requiredRuntimePaths }
