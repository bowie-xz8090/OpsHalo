const { definition, objectSchema, envelope } = require('./common')

function registerSessionTools (registry, bridge) {
  registry.register(definition({
    name: 'session.describe',
    description: 'Describe the currently bound terminal session without exposing credentials.',
    category: 'context',
    riskFloor: 'R0',
    sensitivityFloor: 'S0',
    costFloor: 'C0',
    defaultTimeoutMs: 5000,
    maxTimeoutMs: 10000,
    inputSchema: objectSchema({}, [])
  }), async context => {
    const started = Date.now()
    const data = await bridge.describe(context.session.sessionBinding.sessionPid, context.signal)
    return { stdout: JSON.stringify(envelope(data, 'session.describe', [], false, Date.now() - started)), stderr: '', exitCode: 0, status: 'success' }
  })
}

module.exports = { registerSessionTools }
