const GATEWAY_REQUIRED_MCP_TOOLS = new Set([
  'send_terminal_command',
  'cancel_terminal_command',
  'execute_command',
  'run_background_command',
  'get_background_task_status',
  'get_background_task_log',
  'cancel_background_task',
  'cleanup_background_task',
  'sftp_list',
  'sftp_stat',
  'sftp_read_file',
  'sftp_del',
  'sftp_upload',
  'sftp_download',
  'zmodem_upload',
  'zmodem_download'
])

function assertLegacyMcpGatewayBoundary (config, action, data) {
  if (config?.agentModeEnabled !== true || action !== 'tool-call') return
  if (!GATEWAY_REQUIRED_MCP_TOOLS.has(data?.toolName)) return
  const error = new Error('This MCP operation requires an Agent task and Tool Gateway capability while Agent mode is enabled')
  error.code = 'AGENT_MCP_GATEWAY_REQUIRED'
  error.safeMessage = 'Agent 模式下该 MCP 操作必须通过统一 Tool Gateway；旧 Renderer 执行通道已关闭。'
  throw error
}

module.exports = { GATEWAY_REQUIRED_MCP_TOOLS, assertLegacyMcpGatewayBoundary }
