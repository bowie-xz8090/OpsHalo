const { parseDecision } = require('./strict-json-adapter')
const { decodePlannerDecision } = require('./planner-protocol')

function parseMessage (message, input = {}) {
  const call = message?.tool_calls?.find(item => item.function?.name === 'submit_agent_decision')
  if (call) return decodePlannerDecision(JSON.parse(call.function.arguments), input)
  return parseDecision(message?.content, input)
}

module.exports = { parseMessage }
