const crypto = require('crypto')

class SessionExecutionBridge {
  constructor (getServerChild) {
    this.getServerChild = getServerChild
    this.pending = new Map()
    this.child = null
    this.listener = message => this.onMessage(message)
  }

  bindChild () {
    const child = this.getServerChild()
    if (!child || !child.connected) {
      const error = bridgeError('AGENT_SESSION_SERVER_UNAVAILABLE', '本地会话服务不可用。')
      error.beforeStarted = true
      throw error
    }
    if (this.child !== child) {
      if (this.child) this.child.removeListener('message', this.listener)
      this.child = child
      child.on('message', this.listener)
    }
    return child
  }

  request (action, payload, signal, onProgress) {
    const child = this.bindChild()
    const id = `agentmsg_${crypto.randomBytes(18).toString('base64url')}`
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        reject(bridgeError('AGENT_CANCELLED', 'Agent 动作已取消。'))
      }
      if (signal?.aborted) return abort()
      if (signal) signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { resolve, reject, signal, abort, onProgress })
      try {
        child.send({ type: 'agent', id, action, ...payload })
      } catch (error) {
        this.pending.delete(id)
        if (signal) signal.removeEventListener('abort', abort)
        error.beforeStarted = true
        reject(error)
      }
    })
  }

  onMessage (message) {
    if (message?.type === 'agent-progress') {
      const pending = this.pending.get(message.id)
      if (pending?.onProgress) pending.onProgress(message.progress)
      return
    }
    if (message?.type !== 'agent-response') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (pending.signal) pending.signal.removeEventListener('abort', pending.abort)
    if (message.error) pending.reject(bridgeError(message.error.code, message.error.safeMessage))
    else pending.resolve(message.data)
  }

  describe (tabId, signal) {
    return this.request('describe-session', { pid: tabId }, signal)
  }

  exec ({ session, command, timeoutMs, intent, capability, expected, signal, progress }) {
    const abort = () => this.cancel(session.sessionBinding.sessionPid, intent.invocationId)
    signal?.addEventListener('abort', abort, { once: true })
    return this.request('exec', {
      pid: session.sessionBinding.sessionPid,
      command,
      timeoutMs,
      capability,
      expected
    }, signal, progress).then(result => ({
      ...result,
      status: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'success' : 'error'
    })).finally(() => signal?.removeEventListener('abort', abort))
  }

  sftp ({ session, operation, arguments: args, content, timeoutMs, intent, capability, expected, signal }) {
    const abort = () => this.cancel(session.sessionBinding.sessionPid, intent.invocationId)
    signal?.addEventListener('abort', abort, { once: true })
    return this.request('sftp', {
      pid: session.sessionBinding.sessionPid,
      operation,
      arguments: args,
      content,
      timeoutMs,
      capability,
      expected
    }, signal).finally(() => signal?.removeEventListener('abort', abort))
  }

  cancel (sessionPid, invocationId) {
    return this.request('cancel', { pid: sessionPid, invocationId }).catch(() => ({ cancelRequested: false, remoteTermination: 'unconfirmed' }))
  }

  dispose () {
    if (this.child) this.child.removeListener('message', this.listener)
    for (const pending of this.pending.values()) pending.reject(bridgeError('AGENT_SESSION_SERVER_UNAVAILABLE', '本地会话服务已停止。'))
    this.pending.clear()
  }
}

function bridgeError (code, message) {
  const error = new Error(message)
  error.code = code
  error.safeMessage = message
  error.source = 'executor'
  return error
}

module.exports = { SessionExecutionBridge, bridgeError }
