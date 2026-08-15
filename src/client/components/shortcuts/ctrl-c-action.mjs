export function resolveCtrlCAction ({ hasSelection, terminalHandoff, aiActive }) {
  if (hasSelection) return 'copy_selection'
  if (terminalHandoff) return 'send_terminal_sigint'
  if (aiActive) return 'cancel_ai'
  return 'pass_through'
}
