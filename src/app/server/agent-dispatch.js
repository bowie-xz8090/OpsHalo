const crypto = require('crypto')
const { terminals } = require('./session-process')
const { CapabilityTokenManager } = require('../agent/approval/capability-token')

const verifier = process.env.agentCapabilitySecret
  ? new CapabilityTokenManager(process.env.agentCapabilitySecret)
  : null

async function dispatchAgentMessage (message) {
  if (!message || message.type !== 'agent' || !message.id || !message.action) throw new Error('Invalid Agent process message')
  const pid = String(message.pid || '')
  const terminal = terminals(pid)
  if (!terminal) throw new Error('Terminal session not found')
  if (message.action === 'describe-session') return terminal.describeAgentSession(message.id)
  if (message.action === 'exec') {
    if (!verifier) throw new Error('Agent capability verifier is unavailable')
    verifier.verifyExternal(message.capability, message.expected, { consume: true })
    return terminal.agentExecCommand({
      command: message.command,
      timeoutMs: message.timeoutMs,
      invocationId: message.expected.invocationId,
      capability: message.capability,
      expected: message.expected
    }, message.id)
  }
  if (message.action === 'sftp') {
    if (!verifier) throw new Error('Agent capability verifier is unavailable')
    verifier.verifyExternal(message.capability, message.expected, { consume: true })
    return terminal.agentSftp({
      operation: message.operation,
      arguments: message.arguments,
      content: message.content,
      timeoutMs: message.timeoutMs,
      invocationId: message.expected.invocationId,
      capability: message.capability,
      expected: message.expected
    }, message.id)
  }
  if (message.action === 'cancel') return terminal.agentCancelExec(message.invocationId, message.id)
  throw new Error('Unsupported Agent process action')
}

function registerAgentProcessMessages () {
  process.on('message', async message => {
    if (message?.type !== 'agent') return
    try {
      const data = await dispatchAgentMessage(message)
      process.send({ type: 'agent-response', id: message.id, data })
    } catch (error) {
      process.send({
        type: 'agent-response',
        id: message.id || `invalid_${crypto.randomBytes(8).toString('hex')}`,
        error: { code: error.code || 'AGENT_SERVER_ERROR', safeMessage: String(error.safeMessage || error.message || 'Agent server request failed').slice(0, 2000) }
      })
    }
  })
}

module.exports = { dispatchAgentMessage, registerAgentProcessMessages }
