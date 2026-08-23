const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createRuntimeConfigRefresher,
  isRuntimeBlockingConfigRefresh
} = require('../../src/app/agent/runtime-config-refresh')

function fixture (runtime) {
  const refreshed = []
  const manager = {
    sessions: new Map(runtime ? [['task-1', runtime]] : []),
    featureFlags: { agentModeEnabled: false, agentMutationEnabled: false },
    policyVersion: 'old-policy',
    configRefreshPending: false
  }
  const policyEngine = { policy: { version: 'old-policy' } }
  const refresher = createRuntimeConfigRefresher({
    manager,
    policyEngine,
    skillRegistry: { refresh: config => refreshed.push(['skills', config]) },
    knowledgeBase: { refresh: config => refreshed.push(['knowledge', config]) },
    loadPolicy: config => ({ version: `policy-${config.revision}` })
  })
  return { manager, policyEngine, refresher, refreshed }
}

test('only actively running Agent tasks block a runtime config refresh', () => {
  assert.equal(isRuntimeBlockingConfigRefresh(), false)
  assert.equal(isRuntimeBlockingConfigRefresh({ finished: true, record: { status: 'planning' } }), false)
  assert.equal(isRuntimeBlockingConfigRefresh({ finished: false, record: { status: 'paused' } }), false)
  assert.equal(isRuntimeBlockingConfigRefresh({ finished: false, record: { status: 'complete' } }), false)
  assert.equal(isRuntimeBlockingConfigRefresh({ finished: false, record: { status: 'planning' } }), true)
  assert.equal(isRuntimeBlockingConfigRefresh({ finished: false, record: { status: 'awaiting_approval' } }), true)
})

test('historical paused tasks do not keep Agent admission disabled', () => {
  const state = fixture({ finished: false, record: { status: 'paused' } })
  const result = state.refresher.refresh({
    revision: 'enabled',
    agentModeEnabled: true,
    agentMutationEnabled: true
  })

  assert.equal(result.deferred, false)
  assert.equal(state.manager.featureFlags.agentModeEnabled, true)
  assert.equal(state.manager.featureFlags.agentMutationEnabled, true)
  assert.equal(state.manager.policyVersion, 'policy-enabled')
  assert.equal(state.policyEngine.policy.version, 'policy-enabled')
  assert.equal(state.manager.configRefreshPending, false)
  assert.equal(state.refreshed.length, 2)
})

test('running tasks defer policy changes and automatically apply the latest saved config once paused', () => {
  const runtime = { finished: false, record: { status: 'planning' } }
  const state = fixture(runtime)

  const first = state.refresher.refresh({ revision: 'first', agentModeEnabled: true })
  const latest = state.refresher.refresh({ revision: 'latest', agentModeEnabled: true, agentMutationEnabled: true })

  assert.equal(first.deferred, true)
  assert.equal(latest.deferred, true)
  assert.equal(state.manager.featureFlags.agentModeEnabled, true)
  assert.equal(state.manager.featureFlags.agentMutationEnabled, false)
  assert.equal(state.manager.configRefreshPending, true)
  assert.equal(state.refreshed.length, 0)

  runtime.record.status = 'paused'
  const flushed = state.refresher.flush()

  assert.equal(flushed.deferred, false)
  assert.equal(state.manager.featureFlags.agentMutationEnabled, true)
  assert.equal(state.manager.policyVersion, 'policy-latest')
  assert.equal(state.manager.configRefreshPending, false)
  assert.equal(state.refreshed.length, 2)
})
