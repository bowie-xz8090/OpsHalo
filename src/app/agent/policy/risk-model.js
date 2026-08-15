const { RISK_LEVELS, SENSITIVITY_LEVELS, COST_LEVELS } = require('../schemas/enums')

function maxLevel (levels, order) {
  return levels.filter(Boolean).reduce((highest, value) => {
    if (!order.includes(value)) throw new Error(`Unknown risk axis value: ${value}`)
    return order.indexOf(value) > order.indexOf(highest) ? value : highest
  }, order[0])
}

function maxRisk (...values) { return maxLevel(values, RISK_LEVELS) }
function maxSensitivity (...values) { return maxLevel(values, SENSITIVITY_LEVELS) }
function maxCost (...values) { return maxLevel(values, COST_LEVELS) }

function mergeRisk (floor, ...signals) {
  return {
    risk: maxRisk(floor.risk, ...signals.map(s => s.risk)),
    sensitivity: maxSensitivity(floor.sensitivity, ...signals.map(s => s.sensitivity)),
    cost: maxCost(floor.cost, ...signals.map(s => s.cost))
  }
}

function isAutoExecutable ({ risk, sensitivity, cost, bounded }) {
  return bounded === true && RISK_LEVELS.indexOf(risk) <= 1 && SENSITIVITY_LEVELS.indexOf(sensitivity) <= 1 && COST_LEVELS.indexOf(cost) <= 1
}

module.exports = { maxLevel, maxRisk, maxSensitivity, maxCost, mergeRisk, isAutoExecutable }
