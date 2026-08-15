class PtyHandoffAdapter {
  async execute () {
    const error = new Error('User terminal handoff is required')
    error.code = 'AGENT_INTERACTIVE_REQUIRED'
    error.category = 'interactive_required'
    error.safeMessage = '该动作需要用户接管终端，Agent 不会自动输入凭据。'
    throw error
  }
}

module.exports = { PtyHandoffAdapter }
