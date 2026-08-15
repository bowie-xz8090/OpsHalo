const crypto = require('crypto')
const { shellQuote, envelope } = require('../tools/builtin/common')

class BackgroundTaskAdapter {
  constructor (ssh) {
    this.ssh = ssh
    this.tasks = new Map()
  }

  key (taskId, backgroundTaskId) {
    return `${taskId}:${backgroundTaskId}`
  }

  async start (context) {
    const backgroundTaskId = `background_${crypto.randomBytes(12).toString('base64url')}`
    const logPath = `/tmp/electerm-agent-${backgroundTaskId}.log`
    const command = `nohup sh -c ${shellQuote(context.arguments.command)} > ${shellQuote(logPath)} 2>&1 < /dev/null & printf '%s' "$!"`
    const raw = await this.ssh.execute({ ...context, arguments: { command } })
    const pid = String(raw.stdout || '').trim().split(/\s+/).pop()
    if (!/^\d+$/.test(pid)) throw new Error('Background process did not return a PID')
    this.tasks.set(this.key(context.session.taskId, backgroundTaskId), { pid, logPath, commandDigest: context.intent.intentDigest })
    return result(raw, envelope({ backgroundTaskId, pid, logPath }, 'background.start'))
  }

  async status (context) {
    const task = this.get(context)
    const command = `if kill -0 ${task.pid} 2>/dev/null; then printf running; else wait ${task.pid} 2>/dev/null; printf stopped; fi`
    const raw = await this.ssh.execute({ ...context, arguments: { command } })
    return result(raw, envelope({ backgroundTaskId: context.arguments.backgroundTaskId, status: String(raw.stdout || '').trim() || 'unknown' }, 'background.status'))
  }

  async logs (context) {
    const task = this.get(context)
    const lines = Math.min(context.arguments.lines || 100, 500)
    const raw = await this.ssh.execute({ ...context, arguments: { command: `tail -n ${lines} -- ${shellQuote(task.logPath)}` } })
    return result(raw, envelope({ backgroundTaskId: context.arguments.backgroundTaskId, lines: String(raw.stdout || '').split(/\r?\n/).slice(-lines) }, 'background.logs'))
  }

  async cancel (context) {
    const task = this.get(context)
    const raw = await this.ssh.execute({ ...context, arguments: { command: `kill -INT ${task.pid} 2>/dev/null; sleep 1; kill -0 ${task.pid} 2>/dev/null && kill -TERM ${task.pid} 2>/dev/null || true` } })
    return result(raw, envelope({ backgroundTaskId: context.arguments.backgroundTaskId, cancelRequested: true }, 'background.cancel'))
  }

  get (context) {
    const task = this.tasks.get(this.key(context.session.taskId, context.arguments.backgroundTaskId))
    if (!task) {
      const error = new Error('Background task is unknown or belonged to an earlier app session')
      error.code = 'AGENT_FACILITY_UNAVAILABLE'
      throw error
    }
    return task
  }
}

function result (raw, value) {
  return { ...raw, mode: 'background', stdout: JSON.stringify(value), stderr: raw.stderr || '' }
}

module.exports = { BackgroundTaskAdapter }
