const PLANNING_ONLY_INSTRUCTIONS = [
  'You are a planning-only adapter embedded in OpsHalo.',
  'Do not run local shell commands, edit or read local files, browse the web, or call built-in tools.',
  'Treat the public tool catalog in the prompt as descriptions only.',
  'Return exactly one PlannerDecision matching the supplied output schema.',
  'OpsHalo will independently validate every proposed action through its Tool Gateway.'
].join(' ')

function handleCodexServerRequest (request, onSecurityEvent = () => {}) {
  const method = String(request?.method || '')
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    onSecurityEvent({ type: 'codex_local_execution_denied', method })
    return { decision: 'cancel' }
  }
  if (method === 'item/permissions/requestApproval') {
    onSecurityEvent({ type: 'codex_permission_request_denied', method })
    return { permissions: {}, scope: 'turn' }
  }
  if (method === 'item/tool/requestUserInput') {
    onSecurityEvent({ type: 'codex_user_input_request_denied', method })
    return { answers: {} }
  }
  if (method === 'item/tool/requestOptionPicker') {
    onSecurityEvent({ type: 'codex_option_picker_denied', method })
    return { action: 'dismiss', selectedOptions: [], freeformAnswer: null }
  }
  if (method === 'item/tool/requestSetupCodexContextPicker') {
    onSecurityEvent({ type: 'codex_context_picker_denied', method })
    return { action: 'dismiss', selectedSources: [] }
  }
  if (method === 'mcpServer/elicitation/request') {
    onSecurityEvent({ type: 'codex_mcp_elicitation_denied', method })
    return { action: 'decline' }
  }
  if (method === 'currentTime/read') {
    return { currentTimeAt: Math.floor(Date.now() / 1000) }
  }
  if (method === 'applyPatchApproval' || method === 'execCommandApproval' || method === 'item/plan/requestImplementation') {
    onSecurityEvent({ type: 'codex_legacy_or_plan_request_denied', method })
    return { decision: 'cancel' }
  }
  if (method === 'item/tool/call') {
    onSecurityEvent({ type: 'codex_dynamic_tool_denied', method })
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: 'Dynamic tools are disabled. Return a PlannerDecision action for the electerm Tool Gateway.' }]
    }
  }
  const error = new Error('Unsupported App Server request')
  error.code = -32601
  error.safeMessage = 'Codex App Server 请求了未启用的本机能力。'
  throw error
}

module.exports = { PLANNING_ONLY_INSTRUCTIONS, handleCodexServerRequest }
