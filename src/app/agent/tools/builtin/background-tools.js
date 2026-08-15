const { definition, objectSchema } = require('./common')

function registerBackgroundTools (registry, adapter) {
  registry.register(definition({
    name: 'background.start',
    description: 'Start an explicitly approved non-interactive background command and return a task-scoped identifier.',
    category: 'change',
    mutability: 'reversible',
    riskFloor: 'R3',
    sensitivityFloor: 'S1',
    costFloor: 'C2',
    approval: 'always',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    parserId: 'shell',
    inputSchema: objectSchema({ command: { type: 'string', minLength: 1, maxLength: 8000 } }, ['command'])
  }), context => adapter.start(context))
  registry.register(definition({
    name: 'background.status',
    description: 'Read the status of one task-scoped background command.',
    inputSchema: objectSchema({ backgroundTaskId: { type: 'string', minLength: 8, maxLength: 160 } }, ['backgroundTaskId'])
  }), context => adapter.status(context))
  registry.register(definition({
    name: 'background.logs',
    description: 'Read a bounded tail from one task-scoped background command log.',
    inputSchema: objectSchema({ backgroundTaskId: { type: 'string', minLength: 8, maxLength: 160 }, lines: { type: 'integer', minimum: 1, maximum: 500 } }, ['backgroundTaskId'])
  }), context => adapter.logs(context))
  registry.register(definition({
    name: 'background.cancel',
    description: 'Request bounded cancellation of one task-scoped background command.',
    category: 'change',
    mutability: 'reversible',
    riskFloor: 'R3',
    sensitivityFloor: 'S1',
    costFloor: 'C1',
    approval: 'always',
    defaultTimeoutMs: 10000,
    maxTimeoutMs: 20000,
    inputSchema: objectSchema({ backgroundTaskId: { type: 'string', minLength: 8, maxLength: 160 } }, ['backgroundTaskId'])
  }), context => adapter.cancel(context))
}

module.exports = { registerBackgroundTools }
