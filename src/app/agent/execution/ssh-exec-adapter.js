const { sessionFingerprint } = require('../tools/intent-normalizer')
const { shellQuote } = require('../tools/builtin/common')

class SshExecAdapter {
  constructor (bridge) {
    this.bridge = bridge
  }

  execute ({ session, arguments: args, timeoutMs, intent, signal, capability }) {
    const cwd = session.sessionBinding.cwd === '~' ? '"$HOME"' : shellQuote(session.sessionBinding.cwd)
    return this.bridge.exec({
      session,
      command: `cd -- ${cwd} && ${args.command}`,
      timeoutMs,
      intent,
      capability,
      expected: {
        taskId: session.taskId,
        invocationId: intent.invocationId,
        intentDigest: intent.intentDigest,
        sessionFingerprint: sessionFingerprint(session.sessionBinding),
        policyVersion: session.featurePolicyVersion
      },
      signal
    })
  }
}

module.exports = { SshExecAdapter }
