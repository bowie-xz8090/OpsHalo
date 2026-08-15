/**
 * terminal/sftp/serial class
 */

const CAPTURE_HEAD_BYTES = 32 * 1024
const CAPTURE_TAIL_BYTES = 64 * 1024

function createBoundedTextCapture () {
  let head = Buffer.alloc(0)
  let tail = Buffer.alloc(0)
  let totalBytes = 0
  return {
    append (data) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      totalBytes += buffer.length
      if (head.length < CAPTURE_HEAD_BYTES) {
        const take = Math.min(CAPTURE_HEAD_BYTES - head.length, buffer.length)
        head = Buffer.concat([head, buffer.subarray(0, take)])
      }
      tail = Buffer.concat([tail, buffer])
      if (tail.length > CAPTURE_TAIL_BYTES) tail = tail.subarray(tail.length - CAPTURE_TAIL_BYTES)
    },
    result () {
      const overlap = totalBytes <= head.length ? Buffer.alloc(0) : tail
      const value = Buffer.concat([head, overlap]).toString('utf8')
      return { value, totalBytes, omittedBytes: Math.max(0, totalBytes - Buffer.byteLength(value, 'utf8')) }
    }
  }
}

exports.commonExtends = function (Cls) {
  Cls.prototype.customEnv = function (envs) {
    if (!envs) {
      return {}
    }
    return envs.split(' ').reduce((p, k) => {
      const [key, value] = k.split('=')
      if (key && value) {
        p[key] = value
      }
      return p
    }, {})
  }

  Cls.prototype.getEnv = function (initOptions = this.initOptions) {
    return {
      LANG: initOptions.envLang || 'en_US.UTF-8',
      ...this.customEnv(initOptions.setEnv)
    }
  }

  Cls.prototype.getExecOpts = function () {
    return {
      env: this.getEnv()
    }
  }

  Cls.prototype.runCmd = function (cmd, conn) {
    return new Promise((resolve, reject) => {
      const client = conn || this.conn || this.client
      client.exec(cmd, this.getExecOpts(), (err, stream) => {
        if (err) reject(err)
        if (stream) {
          let r = ''
          stream
            .on('data', function (data) {
              const d = data.toString()
              r = r + d
            })
            .on('close', (code, signal) => {
              resolve(r)
            })
        } else {
          resolve('')
        }
      })
    })
  }

  // Structured command execution over an SSH exec channel.
  // Unlike runCmd (which merges stdout/stderr and drops the exit code),
  // execCommand captures both streams separately and resolves the real
  // exit code. Optional timeoutMs closes the channel early and resolves
  // partial output with timedOut: true.
  Cls.prototype.execCommand = function (cmd, options = {}, conn) {
    return new Promise((resolve, reject) => {
      const { timeoutMs = 0, invocationId } = options || {}
      const client = conn || this.conn || this.client
      if (!client || typeof client.exec !== 'function') {
        reject(new Error('Exec channel not supported for this session type'))
        return
      }
      let timer = null
      client.exec(cmd, this.getExecOpts(), (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        if (!stream) {
          resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false })
          return
        }
        const stdoutCapture = createBoundedTextCapture()
        const stderrCapture = createBoundedTextCapture()
        let exitCode = null
        let settled = false
        const done = (timedOut) => {
          if (settled) return
          settled = true
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          const stdout = stdoutCapture.result()
          const stderr = stderrCapture.result()
          if (invocationId && this._agentExecStreams) this._agentExecStreams.delete(invocationId)
          resolve({
            stdout: stdout.value,
            stderr: stderr.value,
            stdoutTotalBytes: stdout.totalBytes,
            stderrTotalBytes: stderr.totalBytes,
            stdoutOmittedBytes: stdout.omittedBytes,
            stderrOmittedBytes: stderr.omittedBytes,
            exitCode,
            timedOut
          })
        }
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            try {
              stream.signal?.('TERM')
              stream.close()
            } catch (_) {
              // ignore — best effort channel close
            }
            done(true)
          }, timeoutMs)
        }
        stream.on('data', (data) => {
          stdoutCapture.append(data)
        })
        if (stream.stderr) {
          stream.stderr.on('data', (data) => {
            stderrCapture.append(data)
          })
        }
        stream.on('exit', (code) => {
          exitCode = typeof code === 'number' ? code : null
        })
        stream.on('close', () => done(false))
        stream.on('error', (e) => {
          if (timer) {
            clearTimeout(timer)
            timer = null
          }
          if (!settled) {
            settled = true
            if (invocationId && this._agentExecStreams) this._agentExecStreams.delete(invocationId)
            reject(e)
          }
        })
        if (invocationId) {
          this._agentExecStreams = this._agentExecStreams || new Map()
          this._agentExecStreams.set(invocationId, stream)
        }
      })
    })
  }

  Cls.prototype.cancelExecCommand = function (invocationId) {
    const stream = this._agentExecStreams?.get(invocationId)
    if (!stream) return { cancelRequested: false, remoteTermination: 'unconfirmed' }
    try { stream.signal?.('INT') } catch (_) {}
    const graceTimer = setTimeout(() => {
      if (this._agentExecStreams?.get(invocationId) !== stream) return
      try { stream.signal?.('TERM') } catch (_) {}
      try { stream.close() } catch (_) {}
      this._agentExecStreams.delete(invocationId)
    }, 1500)
    graceTimer.unref?.()
    return { cancelRequested: true, remoteTermination: 'unconfirmed' }
  }
  return Cls
}
