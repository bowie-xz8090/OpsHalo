const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const scenarios = require('../fixtures/agent-capability-scenarios.json')

const workspaceRoot = path.resolve(__dirname, '../..')

test('capability scenario manifest maps at least 30 functional and 10 failure cases to executable tests', () => {
  const functional = scenarios.filter(item => item.group === 'functional')
  const failures = scenarios.filter(item => item.group === 'failure')
  assert.equal(functional.length >= 30, true)
  assert.equal(failures.length >= 10, true)
  assert.equal(new Set(scenarios.map(item => item.id)).size, scenarios.length)

  const requiredFunctional = ['query', 'diagnose', 'ordinary_shell', 'long_output', 'zero_match', 'conflict', 'knowledge_citation', 'final_synthesis']
  const requiredFailures = ['stream_disconnect', 'timeout', 'invalid_structure', 'binding_mismatch', 'permission_denied', 'unknown_remote_state', 'knowledge_corruption', 'cancel', 'unknown_citation', 'partial_failure']
  const functionalCategories = new Set(functional.map(item => item.category))
  const failureCategories = new Set(failures.map(item => item.category))
  for (const category of requiredFunctional) assert.equal(functionalCategories.has(category), true, `missing functional scenario: ${category}`)
  for (const category of requiredFailures) assert.equal(failureCategories.has(category), true, `missing failure scenario: ${category}`)

  for (const scenario of scenarios) {
    assert.equal(Array.isArray(scenario.forbiddenActions) && scenario.forbiddenActions.length > 0, true, `${scenario.id} must declare prohibited actions`)
    assert.equal(typeof scenario.evidenceRequired, 'boolean')
    assert.match(scenario.expectedStatus, /^(?:complete|inconclusive|blocked|failed|cancelled)$/)
    const sourcePath = path.resolve(workspaceRoot, scenario.testFile)
    assert.equal(sourcePath.startsWith(`${workspaceRoot}${path.sep}`), true)
    const source = fs.readFileSync(sourcePath, 'utf8')
    assert.equal(source.includes(`test('${scenario.testTitle}'`), true, `${scenario.id} maps to a missing test: ${scenario.testTitle}`)
  }
})
