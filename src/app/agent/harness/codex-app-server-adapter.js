const { AgentHarness } = require('./agent-harness')

class CodexAppServerHarnessAdapter extends AgentHarness {
  constructor (options) {
    super()
    this.manager = options.manager
    this.profileId = options.profileId
    this.maxContextTokens = options.maxContextTokens || 32000
    this.activeTaskId = null
    this.disposed = false
  }

  getCapabilities () {
    return { nativeTools: false, structuredOutput: true, streaming: true, usage: true, cancellation: true, maxContextTokens: this.maxContextTokens }
  }

  async * runTurn (input, signal) {
    if (this.disposed) throw adapterError('CODEX_ADAPTER_DISPOSED', 'Codex Harness 已关闭。')
    this.activeTaskId = input.taskId
    try {
      const statuses = []
      let wake
      let result
      let failure
      let settled = false
      const turn = this.manager.runPlannerTurn(this.profileId, input, signal, status => {
        statuses.push(status)
        wake?.()
      }).then(value => {
        result = value
      }, error => {
        failure = error
      }).finally(() => {
        settled = true
        wake?.()
      })
      while (true) {
        if (statuses.length) {
          const status = statuses.shift()
          yield { type: 'status', phase: status.phase, message: status.message }
          continue
        }
        if (settled) break
        await new Promise(resolve => { wake = resolve })
        wake = null
      }
      await turn
      if (failure) throw failure
      if (result.usage) yield { type: 'usage', ...result.usage }
      yield { type: 'decision', decision: result.decision }
    } finally {
      this.activeTaskId = null
    }
  }

  async dispose () {
    this.disposed = true
    if (this.activeTaskId) await this.manager.interruptTask(this.activeTaskId).catch(() => {})
  }
}

function adapterError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.source = 'harness'
  return error
}

module.exports = { CodexAppServerHarnessAdapter }
