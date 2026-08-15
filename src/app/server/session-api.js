/**
 * run cmd with terminal
 */

const {
  terminals
} = require('./remote-common')
const { startSession } = require('./session')
const { CapabilityTokenManager } = require('../agent/approval/capability-token')
const { sessionFingerprint } = require('../agent/tools/intent-normalizer')

const capabilityVerifier = process.env.agentCapabilitySecret
  ? new CapabilityTokenManager(process.env.agentCapabilitySecret)
  : null
const activeAgentSftp = new Map()

async function runCmd (body) {
  const { pid, cmd } = body
  const term = terminals(pid)
  let txt = ''
  if (term) {
    txt = await term.runCmd(cmd)
  }
  return txt
}

async function execCmd (body) {
  const { pid, cmd, timeoutMs } = body
  const term = terminals(pid)
  if (!term || typeof term.execCommand !== 'function') {
    throw new Error('Exec channel not supported for this session type')
  }
  return term.execCommand(cmd, { timeoutMs })
}

async function describeAgentSession (body) {
  const { pid } = body
  const term = terminals(pid)
  if (!term) throw new Error('Terminal session not found')
  const init = term.initOptions || {}
  const sessionType = String(init.type || init.connectionType || '').toLowerCase()
  const remoteHost = init.host || term.connectOptions?.host
  if ((sessionType === 'local' || !remoteHost) && process.platform === 'win32') {
    const error = new Error('Agent structured operations currently require a Linux or SSH server session')
    error.code = 'AGENT_UNSUPPORTED_PLATFORM'
    error.safeMessage = '当前 Agent 结构化运维仅支持 Linux/SSH 服务器会话。'
    throw error
  }
  let cwd = init.startDirectory || init.cwd || '~'
  if (typeof term.execCommand === 'function') {
    try {
      const result = await term.execCommand('pwd; printf "\\n__AGENT_SHELL__=%s" "$SHELL"', { timeoutMs: 5000 })
      const shellMarker = result.stdout.lastIndexOf('\n__AGENT_SHELL__=')
      if (shellMarker >= 0) {
        cwd = result.stdout.slice(0, shellMarker).trim().split(/\r?\n/).pop() || cwd
      } else {
        cwd = result.stdout.trim().split(/\r?\n/).pop() || cwd
      }
    } catch (_) {}
  }
  return {
    tabId: String(init.srcTabId || init.uid || pid),
    connectionId: String(init.bookmarkId || init.id || init.uid || pid),
    sessionPid: String(pid),
    host: String(init.host || term.connectOptions?.host || 'unknown'),
    port: Number(init.port || term.connectOptions?.port || 22),
    hostKeyFingerprint: init.hostKeyFingerprint || undefined,
    username: String(init.username || term.connectOptions?.username || 'unknown'),
    cwd,
    shell: String(init.shell || '$SHELL'),
    platform: 'linux',
    bindingConfidence: init.hostKeyFingerprint ? 'strong' : 'reduced',
    capturedAt: new Date().toISOString()
  }
}

async function agentExecCmd (body) {
  const { pid, command, timeoutMs, invocationId, capability, expected } = body
  const term = terminals(pid)
  if (!term || typeof term.execCommand !== 'function') throw new Error('Exec channel not supported for this session type')
  if (!capabilityVerifier) throw new Error('Agent capability verifier is unavailable')
  const binding = await describeAgentSession({ pid })
  const actualExpected = { ...expected, sessionFingerprint: sessionFingerprint(binding), invocationId }
  capabilityVerifier.verifyExternal(capability, actualExpected, { consume: true })
  return term.execCommand(command, { timeoutMs, invocationId })
}

async function agentCancelExec (body) {
  const { pid, invocationId } = body
  const stream = activeAgentSftp.get(invocationId)
  if (stream) {
    stream.destroy(new Error('Agent SFTP operation cancelled'))
    activeAgentSftp.delete(invocationId)
    return { cancelRequested: true, remoteTermination: 'confirmed' }
  }
  const term = terminals(pid)
  if (!term || typeof term.cancelExecCommand !== 'function') return { cancelRequested: false, remoteTermination: 'unconfirmed' }
  return term.cancelExecCommand(invocationId)
}

async function agentSftp (body) {
  const { pid, operation, arguments: args, content, invocationId, capability, expected } = body
  const term = terminals(pid)
  if (!term?.conn || typeof term.conn.sftp !== 'function') throw new Error('SFTP channel not supported for this session type')
  if (!capabilityVerifier) throw new Error('Agent capability verifier is unavailable')
  const binding = await describeAgentSession({ pid })
  capabilityVerifier.verifyExternal(capability, { ...expected, sessionFingerprint: sessionFingerprint(binding), invocationId }, { consume: true })
  const client = await openSftp(term.conn)
  try {
    if (operation === 'list') {
      const entries = await sftpCall(client, 'readdir', args.path)
      const data = entries.slice(0, Math.min(args.limit || 100, 200)).map(entry => ({
        name: entry.filename,
        longname: entry.longname,
        size: entry.attrs?.size,
        mode: entry.attrs?.mode,
        mtime: entry.attrs?.mtime
      }))
      return sftpResult(JSON.stringify({ ok: true, data, warnings: [], meta: { source: 'sftp.list', partial: entries.length > data.length } }))
    }
    if (operation === 'read') {
      const maxBytes = Math.min(args.maxBytes || 65536, 262144)
      const stream = client.createReadStream(args.path, { start: args.offset || 0, end: (args.offset || 0) + maxBytes - 1 })
      activeAgentSftp.set(invocationId, stream)
      const buffer = await collectStream(stream, maxBytes)
      return sftpResult(JSON.stringify({
        ok: true,
        data: { path: args.path, offset: args.offset || 0, text: buffer.toString('utf8'), returnedBytes: buffer.length },
        warnings: [],
        meta: { source: 'sftp.read_limited', partial: buffer.length >= maxBytes }
      }))
    }
    if (operation === 'write') {
      if (Buffer.byteLength(String(content || ''), 'utf8') > 2 * 1024 * 1024) throw new Error('SFTP write content exceeds 2 MiB')
      const stream = client.createWriteStream(args.path, { flags: 'w', mode: 0o600 })
      activeAgentSftp.set(invocationId, stream)
      await writeStream(stream, String(content || ''))
      return sftpResult(JSON.stringify({ ok: true, data: { path: args.path, bytesWritten: Buffer.byteLength(String(content || ''), 'utf8') }, warnings: [], meta: { source: 'sftp.write', partial: false } }))
    }
    if (operation === 'delete') {
      const attrs = await sftpCall(client, 'lstat', args.path)
      await sftpCall(client, attrs.isDirectory() ? 'rmdir' : 'unlink', args.path)
      return sftpResult(JSON.stringify({ ok: true, data: { path: args.path, deleted: true }, warnings: [], meta: { source: 'sftp.delete', partial: false } }))
    }
    throw new Error('Unsupported Agent SFTP operation')
  } finally {
    activeAgentSftp.delete(invocationId)
    client.end?.()
  }
}

function openSftp (conn) {
  return new Promise((resolve, reject) => conn.sftp((error, client) => error ? reject(error) : resolve(client)))
}

function sftpCall (client, method, ...args) {
  return new Promise((resolve, reject) => client[method](...args, (error, value) => error ? reject(error) : resolve(value)))
}

function collectStream (stream, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    stream.on('data', chunk => {
      const available = Math.max(0, maxBytes - size)
      if (available) chunks.push(Buffer.from(chunk).subarray(0, available))
      size += Math.min(chunk.length, available)
      if (size >= maxBytes) stream.destroy()
    })
    stream.on('error', reject)
    stream.on('close', () => resolve(Buffer.concat(chunks)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function writeStream (stream, content) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject)
    stream.on('close', resolve)
    stream.end(content)
  })
}

function sftpResult (stdout) {
  return { mode: 'sftp', stdout, stderr: '', exitCode: 0 }
}

async function resize (body) {
  const { pid, cols, rows } = body
  const term = terminals(pid)
  if (term) {
    term.resize(cols, rows)
  }
  return 'ok'
}

async function toggleTerminalLog (body) {
  const { pid } = body
  const term = terminals(pid)
  if (term) {
    term.toggleTerminalLog()
  }
  return 'ok'
}

async function toggleTerminalLogTimestamp (body) {
  const { pid } = body
  const term = terminals(pid)
  if (term) {
    term.toggleTerminalLogTimestamp()
  }
  return 'ok'
}

async function createTerm (body, ws) {
  const t = await startSession(body, ws)
  return t.pid
}

async function testTerm (body, ws) {
  const r = await startSession(body, ws, 'test')
  if (r) {
    return r
  } else {
    throw new Error('test failed')
  }
}

async function setTerminalLogPath (body) {
  const { pid, logPath } = body
  const term = terminals(pid)
  if (term) {
    term.setTerminalLogPath(logPath)
  }
  return 'ok'
}

async function startTerminalLogFile (body) {
  const { pid, logFilePath, addTimeStampToTermLog } = body
  const term = terminals(pid)
  if (term) {
    term.startTerminalLogFile(logFilePath, addTimeStampToTermLog)
  }
  return 'ok'
}

exports.createTerm = createTerm
exports.testTerm = testTerm
exports.resize = resize
exports.runCmd = runCmd
exports.execCmd = execCmd
exports.describeAgentSession = describeAgentSession
exports.agentExecCmd = agentExecCmd
exports.agentCancelExec = agentCancelExec
exports.agentSftp = agentSftp
exports.toggleTerminalLog = toggleTerminalLog
exports.toggleTerminalLogTimestamp = toggleTerminalLogTimestamp
exports.setTerminalLogPath = setTerminalLogPath
exports.startTerminalLogFile = startTerminalLogFile
