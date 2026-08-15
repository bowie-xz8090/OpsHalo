export const shellInputMode = 'shell'
export const agentInputMode = 'agent'

export function normalizeAgentInputMode (mode) {
  return mode === agentInputMode ? agentInputMode : shellInputMode
}

export function resolveSmartInputRoute ({
  agentModeEnabled,
  inputMode,
  inputType
}) {
  if (inputType === 'command') return 'terminal'
  if (!agentModeEnabled) return 'legacy-smart-shell'
  return normalizeAgentInputMode(inputMode) === agentInputMode
    ? 'agent'
    : 'terminal'
}
