const { definition, objectSchema } = require('./common')

function registerTerminalTools (registry) {
  registry.register(definition({
    name: 'terminal.pty_start',
    description: 'Request explicit user terminal handoff for an interactive command.',
    category: 'interactive',
    mutability: 'reversible',
    riskFloor: 'R3',
    sensitivityFloor: 'S1',
    costFloor: 'C1',
    approval: 'always',
    defaultTimeoutMs: 60000,
    maxTimeoutMs: 120000,
    inputSchema: objectSchema({ command: { type: 'string', minLength: 1, maxLength: 8000 } }, ['command'])
  }), async () => {
    const error = new Error('Explicit terminal handoff is required')
    error.code = 'AGENT_INTERACTIVE_REQUIRED'
    throw error
  })
  registry.register(definition({
    name: 'terminal.pty_input',
    description: 'Accept user-originated PTY input only; models cannot call this tool.',
    category: 'interactive',
    mutability: 'reversible',
    riskFloor: 'R3',
    sensitivityFloor: 'S2',
    costFloor: 'C1',
    approval: 'blocked',
    inputSchema: objectSchema({ data: { type: 'string', maxLength: 4096 } }, ['data'])
  }), async () => { throw new Error('Agent-originated PTY input is forbidden') })
  registry.register(definition({
    name: 'terminal.cancel',
    description: 'Cancel the current task invocation without closing the SSH connection.',
    category: 'context',
    riskFloor: 'R1',
    sensitivityFloor: 'S0',
    costFloor: 'C0',
    approval: 'blocked',
    inputSchema: objectSchema({ invocationId: { type: 'string', minLength: 8, maxLength: 160 } }, ['invocationId'])
  }), async context => ({ stdout: JSON.stringify({ ok: true, data: { cancelRequested: true }, warnings: [], meta: { durationMs: 0, source: 'terminal.cancel', capturedAt: new Date().toISOString(), partial: false } }), stderr: '', exitCode: 0 }))
}

module.exports = { registerTerminalTools }
