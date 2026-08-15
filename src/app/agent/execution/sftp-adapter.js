const { sessionFingerprint } = require('../tools/intent-normalizer')

class SftpAdapter {
  constructor (bridge, evidenceStore) {
    this.bridge = bridge
    this.evidenceStore = evidenceStore
  }

  async unavailable () {
    const error = new Error('The current terminal has no bound SFTP execution bridge')
    error.code = 'AGENT_FACILITY_UNAVAILABLE'
    throw error
  }

  list = context => this.execute('list', context)
  read = context => this.execute('read', context)
  write = async context => this.execute('write', context, await this.readContentRef(context))
  delete = context => this.execute('delete', context)

  execute (operation, context, content) {
    if (!this.bridge.sftp) return this.unavailable()
    const { session, intent, capability, timeoutMs, signal } = context
    return this.bridge.sftp({
      session,
      operation,
      arguments: context.arguments,
      content,
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

  async readContentRef (context) {
    const ref = context.arguments.contentRef
    let offset = 0
    let content = ''
    do {
      const page = this.evidenceStore.read(context.session.taskId, ref, offset)
      content += page.content
      offset = page.nextOffset
      if (Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) throw new Error('SFTP write content exceeds 2 MiB')
    } while (offset !== null)
    return content
  }
}

module.exports = { SftpAdapter }
