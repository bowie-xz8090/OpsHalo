const { registerSessionTools } = require('./session-tools')
const { registerHostTools } = require('./host-tools')
const { registerProcessTools } = require('./process-tools')
const { registerNetworkTools } = require('./network-tools')
const { registerFilesystemTools } = require('./filesystem-tools')
const { registerServiceTools } = require('./service-tools')
const { registerDockerTools } = require('./docker-tools')
const { registerMetricTools } = require('./metric-tools')
const { registerConfigTools } = require('./config-tools')
const { registerShellTools } = require('./shell-tools')
const { registerTerminalTools } = require('./terminal-tools')
const { registerSftpTools } = require('./sftp-tools')
const { registerBackgroundTools } = require('./background-tools')

function registerBuiltinTools (registry, options) {
  registerSessionTools(registry, options.bridge)
  registerHostTools(registry, options.ssh)
  registerProcessTools(registry, options.ssh)
  registerNetworkTools(registry, options.ssh)
  registerFilesystemTools(registry, options.ssh)
  registerServiceTools(registry, options.ssh)
  registerDockerTools(registry, options.ssh)
  registerMetricTools(registry, options.ssh)
  registerConfigTools(registry, options.ssh)
  registerShellTools(registry, options.ssh)
  registerTerminalTools(registry)
  registerSftpTools(registry, options.sftp)
  registerBackgroundTools(registry, options.background)
  return registry
}

module.exports = { registerBuiltinTools }
