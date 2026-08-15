const { definition, objectSchema } = require('./common')

function registerSftpTools (registry, adapter) {
  const unavailable = async () => {
    const error = new Error('Bound SFTP session is unavailable; use a bounded filesystem probe instead')
    error.code = 'AGENT_FACILITY_UNAVAILABLE'
    throw error
  }
  registry.register(definition({
    name: 'sftp.list',
    description: 'List a bounded SFTP directory through the existing session.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['path'])
  }), adapter?.list || unavailable)
  registry.register(definition({
    name: 'sftp.read_limited',
    description: 'Read a bounded SFTP file range through the existing session.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 }, offset: { type: 'integer', minimum: 0 }, maxBytes: { type: 'integer', minimum: 1, maximum: 262144 } }, ['path'])
  }), adapter?.read || unavailable)
  for (const name of ['sftp.write', 'sftp.delete']) {
    registry.register(definition({
      name,
      description: `${name} through the existing SFTP session with explicit approval.`,
      category: 'change',
      mutability: name.endsWith('delete') ? 'destructive' : 'reversible',
      riskFloor: name.endsWith('delete') ? 'R4' : 'R3',
      sensitivityFloor: 'S2',
      costFloor: 'C1',
      approval: 'always',
      defaultTimeoutMs: 60000,
      maxTimeoutMs: 120000,
      inputSchema: name.endsWith('delete')
        ? objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 } }, ['path'])
        : objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 }, contentRef: { type: 'string', minLength: 1, maxLength: 1000 } }, ['path', 'contentRef'])
    }), adapter?.[name.endsWith('delete') ? 'delete' : 'write'] || unavailable)
  }
}

module.exports = { registerSftpTools }
