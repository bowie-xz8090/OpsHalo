const { envelope } = require('../tools/builtin/common')

class McpAdapter {
  constructor (gatewayCall) {
    this.gatewayCall = gatewayCall
  }

  async execute (context) {
    if (!this.gatewayCall) throw new Error('MCP adapter is unavailable')
    const value = await this.gatewayCall({
      arguments: context.arguments,
      signal: context.signal,
      taskId: context.session.taskId,
      invocationId: context.intent.invocationId
    })
    if (value && typeof value === 'object' && ('stdout' in value || 'stderr' in value || 'exitCode' in value)) return { mode: 'mcp', ...value }
    return {
      mode: 'mcp',
      stdout: JSON.stringify(envelope(value, context.intent.toolName)),
      stderr: '',
      exitCode: 0
    }
  }
}

module.exports = { McpAdapter }
