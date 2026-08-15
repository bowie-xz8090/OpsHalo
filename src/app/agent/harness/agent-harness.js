class AgentHarness {
  getCapabilities () {
    throw new Error('getCapabilities() must be implemented')
  }

  async * runTurn () {
    throw new Error('runTurn() must be implemented')
  }

  async dispose () {}
}

function assertHarness (value) {
  if (!value || typeof value.getCapabilities !== 'function' || typeof value.runTurn !== 'function' || typeof value.dispose !== 'function') {
    throw new Error('Invalid AgentHarness implementation')
  }
  return value
}

module.exports = { AgentHarness, assertHarness }
