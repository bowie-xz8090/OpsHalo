const { defaults } = require('../config')

function createBudget (now = Date.now(), overrides = {}) {
  const maxReactSteps = Math.min(overrides.maxReactSteps || defaults.maxReactSteps, defaults.hardMaxReactSteps)
  return {
    maxReactSteps,
    hardMaxReactSteps: defaults.hardMaxReactSteps,
    usedReactSteps: 0,
    maxAutoReadActions: overrides.maxAutoReadActions || defaults.maxAutoReadActions,
    usedAutoReadActions: 0,
    maxEquivalentActionRepeats: defaults.maxEquivalentActionRepeats,
    maxConsecutiveErrors: defaults.maxConsecutiveErrors,
    consecutiveErrors: 0,
    taskDeadlineAt: new Date(now + defaults.taskTimeoutMs).toISOString(),
    capturedOutputBytes: 0
  }
}

function checkBudget (budget, now = Date.now()) {
  if (budget.usedReactSteps >= Math.min(budget.maxReactSteps, budget.hardMaxReactSteps)) return { allowed: false, code: 'react_steps_exhausted' }
  if (budget.consecutiveErrors >= budget.maxConsecutiveErrors) return { allowed: false, code: 'consecutive_errors_exhausted' }
  const deadline = budget.approvedLongDeadlineAt || budget.taskDeadlineAt
  if (now >= Date.parse(deadline)) return { allowed: false, code: 'task_timeout' }
  return { allowed: true }
}

function consumeTurn (budget) {
  return { ...budget, usedReactSteps: budget.usedReactSteps + 1 }
}

function consumeAutoRead (budget) {
  if (budget.usedAutoReadActions >= budget.maxAutoReadActions) {
    const error = new Error('Automatic read-only budget exhausted')
    error.code = 'AGENT_AUTO_READ_BUDGET'
    throw error
  }
  return { ...budget, usedAutoReadActions: budget.usedAutoReadActions + 1 }
}

function recordResult (budget, { error = false, capturedBytes = 0 } = {}) {
  return {
    ...budget,
    consecutiveErrors: error ? budget.consecutiveErrors + 1 : 0,
    capturedOutputBytes: budget.capturedOutputBytes + capturedBytes
  }
}

function remaining (budget, now = Date.now()) {
  const deadline = Date.parse(budget.approvedLongDeadlineAt || budget.taskDeadlineAt)
  return {
    reactSteps: Math.max(0, budget.maxReactSteps - budget.usedReactSteps),
    autoReadActions: Math.max(0, budget.maxAutoReadActions - budget.usedAutoReadActions),
    milliseconds: Math.max(0, deadline - now),
    equivalentRepeats: budget.maxEquivalentActionRepeats,
    consecutiveErrors: Math.max(0, budget.maxConsecutiveErrors - budget.consecutiveErrors),
    approximateContextTokens: 0
  }
}

module.exports = { createBudget, checkBudget, consumeTurn, consumeAutoRead, recordResult, remaining }
