const { EventEmitter } = require('events')
const { spawn } = require('child_process')
const readline = require('readline')

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024
const MAX_STDERR_BYTES = 8 * 1024

class CodexJsonRpcClient extends EventEmitter {
  constructor (options) {
    super()
    this.executable = options.executable || 'codex'
    this.cwd = options.cwd
    this.codexHome = options.codexHome
    this.version = options.version || '0.0.0'
    this.spawnImpl = options.spawnImpl || spawn
    this.requestHandler = options.requestHandler
    this.defaultTimeoutMs = options.defaultTimeoutMs || 20000
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.notificationHistory = []
    this.stderr = ''
    this.startPromise = null
    this.disposed = false
    this.treeTerminationRequired = false
  }

  async start () {
    if (this.disposed) throw rpcError('CODEX_APP_SERVER_DISPOSED', 'Codex App Server 已关闭。')
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal().catch(error => {
      this.startPromise = null
      throw error
    })
    return this.startPromise
  }

  async startInternal () {
    const args = ['app-server', '--listen', 'stdio://']
    const launch = buildLaunchSpec(this.executable, args)
    this.treeTerminationRequired = launch.windowsVerbatimArguments === true
    const child = this.spawnImpl(launch.executable, launch.args, {
      cwd: this.cwd,
      env: minimalEnvironment(process.env, this.codexHome),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: launch.windowsVerbatimArguments
    })
    this.child = child
    if (!child?.stdin || !child?.stdout || !child?.stderr) throw rpcError('CODEX_APP_SERVER_START_FAILED', '无法创建 Codex App Server 标准输入输出通道。')
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', line => this.onLine(line))
    child.stderr.on('data', chunk => {
      this.stderr = sanitizeErrorText(`${this.stderr}${chunk}`).slice(-MAX_STDERR_BYTES)
    })
    child.once('error', error => this.onExit(error))
    child.once('exit', (code, signal) => this.onExit(rpcError('CODEX_APP_SERVER_EXITED', `Codex App Server 已退出（${code ?? signal ?? 'unknown'}）。`)))
    await this.request('initialize', {
      clientInfo: { name: 'OpsHalo', title: 'OpsHalo', version: this.version },
      capabilities: { experimentalApi: false }
    }, { skipStart: true })
    this.notify('initialized')
    this.emit('ready')
    return this
  }

  request (method, params, options = {}) {
    if (!options.skipStart && !this.startPromise) return this.start().then(() => this.request(method, params, { ...options, skipStart: true }))
    if (!this.child?.stdin?.writable) return Promise.reject(rpcError('CODEX_APP_SERVER_UNAVAILABLE', 'Codex App Server 当前不可用。'))
    const id = this.nextId++
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(rpcError('CODEX_APP_SERVER_TIMEOUT', `Codex App Server 请求超时：${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        this.write(params === undefined ? { method, id } : { method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  notify (method, params) {
    this.write(params === undefined ? { method } : { method, params })
  }

  write (message) {
    if (!this.child?.stdin?.writable) throw rpcError('CODEX_APP_SERVER_UNAVAILABLE', 'Codex App Server 当前不可用。')
    const line = JSON.stringify(message)
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) throw rpcError('CODEX_APP_SERVER_MESSAGE_TOO_LARGE', 'Codex App Server 消息超过安全上限。')
    this.child.stdin.write(`${line}\n`)
  }

  onLine (line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
      this.onExit(rpcError('CODEX_APP_SERVER_MESSAGE_TOO_LARGE', 'Codex App Server 返回消息超过安全上限。'))
      this.child?.kill()
      return
    }
    let message
    try { message = JSON.parse(line) } catch (_) {
      this.emit('protocolError', rpcError('CODEX_APP_SERVER_INVALID_JSON', 'Codex App Server 返回了无效 JSON。'))
      return
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) {
        const error = rpcError('CODEX_APP_SERVER_REQUEST_FAILED', sanitizeErrorText(message.error.message || `请求失败：${pending.method}`))
        error.rpcCode = message.error.code
        pending.reject(error)
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message)
      return
    }
    if (message.method) {
      const notification = { method: message.method, params: message.params, receivedAt: Date.now() }
      this.notificationHistory.push(notification)
      if (this.notificationHistory.length > 100) this.notificationHistory.shift()
      this.emit('notification', notification)
      this.emit(notificationEventName(message.method), message.params)
    }
  }

  async handleServerRequest (message) {
    try {
      if (!this.requestHandler) throw rpcMethodError('Codex App Server server request is disabled')
      const result = await this.requestHandler(message)
      this.write({ id: message.id, result })
    } catch (error) {
      this.write({
        id: message.id,
        error: {
          code: Number.isInteger(error.code) ? error.code : -32601,
          message: error.safeMessage || 'This App Server request is disabled by OpsHalo.'
        }
      })
    }
  }

  waitForNotification (method, predicate = () => true, options = {}) {
    const previous = [...this.notificationHistory].reverse().find(item => item.method === method && predicate(item.params))
    if (previous) return Promise.resolve(previous.params)
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs
    const signal = options.signal
    const eventName = notificationEventName(method)
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener(eventName, handler)
        this.removeListener('exit', onExit)
        signal?.removeEventListener('abort', onAbort)
      }
      const handler = params => {
        if (!predicate(params)) return
        cleanup()
        resolve(params)
      }
      const onAbort = () => {
        cleanup()
        reject(rpcError('CODEX_APP_SERVER_CANCELLED', 'Codex 请求已取消。'))
      }
      const onExit = error => {
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(rpcError('CODEX_APP_SERVER_TIMEOUT', `等待 Codex App Server 事件超时：${method}`))
      }, timeoutMs)
      this.on(eventName, handler)
      this.once('exit', onExit)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }

  async interrupt (threadId, turnId) {
    if (!threadId || !turnId || !this.child) return
    return this.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 5000 })
  }

  onExit (error) {
    if (!this.child) return
    this.child = null
    this.startPromise = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.emit('exit', error)
  }

  async dispose () {
    this.disposed = true
    const child = this.child
    this.child = null
    this.startPromise = null
    const disposalError = rpcError('CODEX_APP_SERVER_DISPOSED', 'Codex App Server 已关闭。')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(disposalError)
    }
    this.pending.clear()
    this.emit('exit', disposalError)
    if (!child) return
    const exited = new Promise(resolve => {
      child.once('exit', resolve)
      child.once('error', resolve)
    })
    try { child.stdin?.end() } catch (_) {}
    if (this.treeTerminationRequired) {
      await terminateProcessTree(child)
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
      return
    }
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 1000))
    ])
    if (!graceful) {
      await terminateProcessTree(child)
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 2000))
      ])
    }
  }
}

function notificationEventName (method) {
  return method === 'error' ? 'codex/server-error' : method
}

function minimalEnvironment (source, codexHome) {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL', 'TERM']
  const env = {}
  for (const key of allowed) if (source[key] !== undefined) env[key] = source[key]
  env.CODEX_HOME = codexHome
  env.NO_COLOR = '1'
  return env
}

function buildLaunchSpec (executable, args, platform = process.platform, environment = process.env) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { executable, args, windowsVerbatimArguments: false }
  }
  const command = `""${executable}" ${args.join(' ')}"`
  return {
    executable: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', command],
    windowsVerbatimArguments: true
  }
}

async function terminateProcessTree (child) {
  if (process.platform === 'win32' && Number.isInteger(child?.pid)) {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false
      })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
    return
  }
  try { child?.kill() } catch (_) {}
}

function sanitizeErrorText (value) {
  return String(value || '')
    .replace(/(bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/ig, '$1 <redacted>')
    .replace(/((?:access|refresh|id)?_?token|api[_-]?key|password|secret)(["'\s:=]+)[^\s,"'}]+/ig, '$1$2<redacted>')
    .slice(0, 2000)
}

function rpcError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.source = 'harness'
  return error
}

function rpcMethodError (safeMessage) {
  const error = rpcError(-32601, safeMessage)
  return error
}

module.exports = { CodexJsonRpcClient, buildLaunchSpec, minimalEnvironment, sanitizeErrorText, terminateProcessTree, rpcError, notificationEventName, MAX_MESSAGE_BYTES }
