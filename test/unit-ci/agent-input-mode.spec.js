const assert = require('node:assert/strict')
const test = require('node:test')

const modeModule = import('../../src/client/components/terminal/agent-input-mode.mjs')

test('Agent input mode defaults to shell and rejects unknown values', async () => {
  const { normalizeAgentInputMode } = await modeModule
  assert.equal(normalizeAgentInputMode(), 'shell')
  assert.equal(normalizeAgentInputMode('unknown'), 'shell')
  assert.equal(normalizeAgentInputMode('agent'), 'agent')
})

test('feature flag off preserves the legacy Smart Shell route', async () => {
  const { resolveSmartInputRoute } = await modeModule
  assert.equal(resolveSmartInputRoute({
    agentModeEnabled: false,
    inputMode: 'shell',
    inputType: 'natural-language'
  }), 'legacy-smart-shell')
})

test('Shell mode never intercepts natural language when Agent mode is enabled', async () => {
  const { resolveSmartInputRoute } = await modeModule
  assert.equal(resolveSmartInputRoute({
    agentModeEnabled: true,
    inputMode: 'shell',
    inputType: 'natural-language'
  }), 'terminal')
})

test('Agent mode routes natural language but leaves explicit commands in terminal', async () => {
  const { resolveSmartInputRoute } = await modeModule
  assert.equal(resolveSmartInputRoute({
    agentModeEnabled: true,
    inputMode: 'agent',
    inputType: 'natural-language'
  }), 'agent')
  assert.equal(resolveSmartInputRoute({
    agentModeEnabled: true,
    inputMode: 'agent',
    inputType: 'command'
  }), 'terminal')
})
