const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('Renderer Agent has no direct terminal, SFTP, MCP or provider-tool execution path', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/client/components/ai/agent-tools.js')), false)
  const rendererAgent = source('src/client/components/ai/agent.js')
  assert.match(rendererAgent, /startAgentSession/)
  assert.doesNotMatch(rendererAgent, /AIchatWithTools|executeToolCall|mcpSend|mcpSftp|send_terminal_command/)
  const ipc = source('src/app/lib/ipc.js')
  assert.doesNotMatch(ipc, /\bAIchatWithTools\b/)
})

test('Provider events are projected through validated Agent events before Renderer publication', () => {
  const manager = source('src/app/agent/session/session-manager.js')
  const runtime = source('src/app/agent/index.js')
  const renderer = source('src/client/store/agent-session.js')
  assert.match(manager, /AgentEventSchema\.parse/)
  assert.match(runtime, /webContents\.send\('agent:event', event\)/)
  assert.doesNotMatch(runtime, /ProviderEvent|rawProvider|providerPayload/)
  assert.doesNotMatch(renderer, /reasoning_delta|tool_delta|partial tool|providerPayload|rawProvider/i)
})

test('all Agent SSH, SFTP and MCP execution adapters are reachable only below ToolGateway', () => {
  const runtime = source('src/app/agent/index.js')
  assert.match(runtime, /new ToolGateway/)
  assert.match(runtime, /new AgentSessionManager\([\s\S]*gateway,/)
  assert.match(runtime, /new SshExecAdapter\(bridge\)/)
  assert.match(runtime, /new SftpAdapter\(bridge, evidenceStore\)/)
  assert.doesNotMatch(source('src/client/components/ai/agent.js'), /SshExecAdapter|SftpAdapter|registerMcpTools|serverChild/)
})
