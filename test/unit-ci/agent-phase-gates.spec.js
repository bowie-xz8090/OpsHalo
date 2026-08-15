const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ToolRegistry } = require('../../src/app/agent/tools/registry')
const { registerBuiltinTools } = require('../../src/app/agent/tools/builtin')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('G0 runtime baseline is pinned and defaults fail closed', () => {
  const pkg = JSON.parse(source('package.json'))
  assert.match(pkg.engines.node, /20\.19/)
  assert.equal(pkg.dependencies['@strands-agents/sdk'], '1.13.0')
  const defaults = source('src/app/common/default-setting.js')
  assert.match(defaults, /agentModeEnabled:\s*false/)
  assert.match(defaults, /agentMutationEnabled:\s*false/)
  assert.match(defaults, /agentExternalMcpEnabled:\s*false/)
})

test('G1-G3 execution boundaries and UI cancellation adapters are present', () => {
  assert.match(source('src/client/components/ai/agent-tools.js'), /Legacy Renderer Agent tool execution is disabled/)
  assert.match(source('src/app/widgets/widget-mcp-server.js'), /assertLegacyMcpGatewayBoundary/)
  assert.match(source('src/app/server/agent-dispatch.js'), /verifyExternal/)
  assert.match(source('src/app/server/session-api.js'), /verifyExternal/)
  assert.match(source('src/app/agent/harness/strands-harness-adapter.js'), /tools:\s*\[\]/)
  assert.match(source('src/client/components/shortcuts/shortcut-handler.js'), /resolveCtrlCAction/)
})

test('G2 structured catalog registers bounded security metadata for every built-in tool', () => {
  const unavailable = async () => ({ stdout: '', stderr: '', exitCode: 0 })
  const registry = registerBuiltinTools(new ToolRegistry(), {
    bridge: { describe: unavailable },
    ssh: { execute: unavailable },
    sftp: { list: unavailable, read: unavailable, write: unavailable, delete: unavailable },
    background: { start: unavailable, status: unavailable, logs: unavailable, cancel: unavailable }
  })
  const descriptors = registry.publicDescriptors()
  assert.ok(descriptors.length >= 25)
  assert.ok(descriptors.some(item => item.name === 'session.describe'))
  assert.ok(descriptors.some(item => item.name === 'shell.exec'))
  assert.ok(descriptors.some(item => item.name === 'sftp.write' && item.verificationRequired))
  for (const item of descriptors) {
    assert.match(item.riskFloor, /^R[0-5]$/)
    assert.ok(item.publicBounds.length >= 2)
    assert.equal(item.inputSchema.additionalProperties, false)
  }
})

test('G4-G5 mutation verification and conservative MCP registration fail closed', () => {
  const gateway = source('src/app/agent/tools/gateway.js')
  assert.match(gateway, /verification_plan_required/)
  assert.match(source('src/app/agent/session/session-manager.js'), /RUN_MUTATION_VERIFICATION/)
  const registry = new ToolRegistry()
  registry.registerConservativeMcp('unknown-write', { type: 'object', properties: {}, additionalProperties: false }, unavailableMcp)
  const definition = registry.get('mcp.unknown-write').definition
  assert.equal(definition.mutability, 'reversible')
  assert.equal(definition.riskFloor, 'R2')
  assert.equal(definition.approval, 'always')
})

async function unavailableMcp () {
  throw new Error('not executed by phase-gate test')
}
