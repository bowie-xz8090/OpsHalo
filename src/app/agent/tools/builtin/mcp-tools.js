const { McpAdapter } = require('../../execution/mcp-adapter')

function registerMcpTools (registry, tools = []) {
  return tools.map(tool => {
    const adapter = new McpAdapter(tool.executor)
    return registry.registerConservativeMcp(tool.name, tool.inputSchema, context => adapter.execute(context), tool.metadata)
  })
}

module.exports = { registerMcpTools }
