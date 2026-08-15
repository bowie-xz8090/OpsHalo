const { definition, objectSchema } = require('./common')

function registerShellTools (registry, adapter) {
  registry.register(definition({
    name: 'shell.exec',
    description: 'Fallback bounded Linux shell execution. Structured tools must be preferred.',
    inputSchema: objectSchema({ command: { type: 'string', minLength: 1, maxLength: 8000 } }, ['command']),
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 120000,
    parserId: 'shell'
  }), context => adapter.execute(context))
}

module.exports = { registerShellTools }
