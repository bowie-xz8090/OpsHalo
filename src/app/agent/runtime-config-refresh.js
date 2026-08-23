const { normalizeFeatureFlags } = require('./config')
const { isTerminalStatus } = require('./session/state-machine')

function isRuntimeBlockingConfigRefresh (runtime) {
  if (!runtime || runtime.finished === true) return false
  const status = runtime.record?.status
  return status !== 'paused' && !isTerminalStatus(status)
}

function createRuntimeConfigRefresher ({
  manager,
  policyEngine,
  skillRegistry,
  knowledgeBase,
  loadPolicy
}) {
  let pendingConfig

  const hasBlockingRuntime = () => {
    return [...manager.sessions.values()].some(isRuntimeBlockingConfigRefresh)
  }

  const apply = (config) => {
    const featureFlags = normalizeFeatureFlags(config)
    const policy = loadPolicy(config, featureFlags)
    manager.featureFlags = featureFlags
    manager.policyVersion = policy.version
    manager.configRefreshPending = false
    policyEngine.policy = policy
    skillRegistry.refresh(config)
    knowledgeBase.refresh(config)
    return { ...featureFlags, deferred: false }
  }

  const refresh = (nextConfig = {}) => {
    const config = { ...nextConfig }
    const featureFlags = normalizeFeatureFlags(config)

    // Admission follows the saved switch immediately. Policy changes remain
    // frozen while an existing task is actively running.
    manager.featureFlags = {
      ...manager.featureFlags,
      agentModeEnabled: featureFlags.agentModeEnabled
    }
    if (hasBlockingRuntime()) {
      pendingConfig = config
      manager.configRefreshPending = true
      return { deferred: true, agentModeEnabled: featureFlags.agentModeEnabled }
    }

    pendingConfig = undefined
    return apply(config)
  }

  const flush = () => {
    if (!pendingConfig || hasBlockingRuntime()) {
      return { deferred: !!pendingConfig }
    }
    const config = pendingConfig
    pendingConfig = undefined
    return apply(config)
  }

  return {
    refresh,
    flush,
    hasPending: () => !!pendingConfig
  }
}

module.exports = {
  createRuntimeConfigRefresher,
  isRuntimeBlockingConfigRefresh
}
