const { definition, objectSchema } = require('./common')
const { analyzeShell } = require('../../policy/shell-analyzer')

function registerShellTools (registry, adapter) {
  registry.register(definition({
    name: 'shell.review_exec',
    description: 'Propose one minimal bounded read-only Linux command for explicit user review. Use this for every user-visible remote-host observation so execution and output appear in the original terminal. Preserve the exact requested scope and do not add adjacent checks.',
    approval: 'always',
    parallelSafe: false,
    inputSchema: objectSchema({ command: { type: 'string', minLength: 1, maxLength: 8000 } }, ['command']),
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 120000,
    resultEncoding: 'text',
    parserId: 'shell_review'
  }), context => {
    const analysis = analyzeShell(context.arguments.command)
    const unsafe = analysis.riskSignals.some(item => ['mutation_signal', 'complex_shell', 'privilege_escalation', 'interactive_required'].includes(item.code))
    if (unsafe || analysis.denyRuleIds.length) {
      const error = new Error('Reviewed inspection accepts bounded non-interactive read commands only')
      error.code = 'AGENT_REVIEWED_COMMAND_NOT_READ_ONLY'
      throw error
    }
    return adapter.execute(context)
  })
  registry.register(definition({
    name: 'shell.exec',
    description: 'Propose a Linux shell mutation or other non-read action for explicit policy evaluation and user review. Read-only user-visible probes must use shell.review_exec.',
    parallelSafe: false,
    inputSchema: objectSchema({ command: { type: 'string', minLength: 1, maxLength: 8000 } }, ['command']),
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 120000,
    resultEncoding: 'text',
    parserId: 'shell'
  }), context => adapter.execute(context))
}

module.exports = { registerShellTools }
