const { definition, objectSchema, shellQuote, runStructured } = require('./common')

function registerConfigTools (registry, adapter) {
  registry.register(definition({
    name: 'config.read_limited',
    description: 'Read a bounded configuration excerpt; secrets are redacted before storage or model use.',
    sensitivityFloor: 'S2',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 }, maxBytes: { type: 'integer', minimum: 1, maximum: 131072 }, format: { enum: ['auto', 'json', 'yaml', 'ini', 'env', 'text'] } }, ['path'])
  }), context => runStructured(adapter, context, `test -f ${shellQuote(context.arguments.path)} && dd if=${shellQuote(context.arguments.path)} bs=1 count=${context.arguments.maxBytes || 65536} status=none`, text => ({ format: context.arguments.format || 'auto', excerpt: text })))
}

module.exports = { registerConfigTools }
