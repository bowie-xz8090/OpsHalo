const { EventEmitter, once } = require('events')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const tar = require('tar')
const { CodexJsonRpcClient, buildLaunchSpec, minimalEnvironment } = require('./codex-jsonrpc-client')
const { CODEX_RUNTIME_VERSION, getCodexRuntimeEntry } = require('./codex-runtime-manifest')

const INSTALL_MARKER = '.installed.json'
const MAX_TAR_ENTRIES = 24

class CodexRuntimeManager extends EventEmitter {
  constructor (options) {
    super()
    this.root = options.root
    this.getConfig = options.getConfig || (() => ({}))
    this.fetchImpl = options.fetchImpl
    this.platform = options.platform || process.platform
    this.arch = options.arch || process.arch
    this.manifestEntry = options.manifestEntry || getCodexRuntimeEntry(this.platform, this.arch)
    this.smokeImpl = options.smokeImpl || (params => smokeRuntime(params))
    this.tarImpl = options.tarImpl || tar
    this.allowInsecureTestSource = options.allowInsecureTestSource === true
    this.inflight = null
    this.abortController = null
    this.userCancelled = false
    this.localValidation = new Map()
    this.localRuntimeVersion = null
    this.status = this.baseStatus('missing')
    this.refreshLocalStatus()
  }

  baseStatus (state, patch = {}) {
    return {
      state,
      version: this.manifestEntry?.version || CODEX_RUNTIME_VERSION,
      platform: this.platform,
      arch: this.arch,
      downloadedBytes: 0,
      totalBytes: this.manifestEntry?.packedBytes || 0,
      ...patch
    }
  }

  getStatus () {
    this.refreshLocalStatus()
    return { ...this.status }
  }

  refreshLocalStatus () {
    const configured = configuredExecutable(this.getConfig())
    if (configured) {
      this.status = path.isAbsolute(configured) && fs.existsSync(configured)
        ? this.baseStatus('ready', this.localRuntimeVersion ? { version: this.localRuntimeVersion } : {})
        : this.baseStatus('failed', { error: '配置的 Codex App Server 可执行文件不存在。' })
      return
    }
    const fallback = !this.inflight ? this.findFallbackInstalled() : undefined
    if (!this.inflight && this.isInstalled()) {
      this.localRuntimeVersion = null
      this.status = this.baseStatus('ready', { downloadedBytes: this.manifestEntry.packedBytes })
    } else if (fallback) {
      this.status = this.baseStatus('ready', { version: fallback.version })
    } else if (!this.inflight && findLocalCodexExecutable({ platform: this.platform })) {
      this.status = this.baseStatus('ready', this.localRuntimeVersion ? { version: this.localRuntimeVersion } : {})
    } else if (!this.inflight && this.status.state === 'ready') {
      this.status = this.baseStatus('missing')
    }
  }

  publish (state, patch = {}) {
    this.status = this.baseStatus(state, patch)
    this.emit('runtimeEvent', { ...this.status })
  }

  paths () {
    if (!this.manifestEntry) return {}
    const platformKey = `${this.platform}-${this.arch}`
    const versionRoot = path.join(this.root, this.manifestEntry.version)
    const installRoot = path.join(versionRoot, platformKey)
    const downloadRoot = path.join(this.root, '.downloads')
    const partial = path.join(downloadRoot, `${this.manifestEntry.version}-${platformKey}.tgz.partial`)
    return {
      versionRoot,
      installRoot,
      executable: path.join(installRoot, ...this.manifestEntry.executableRelativePath.split('/')),
      marker: path.join(installRoot, INSTALL_MARKER),
      downloadRoot,
      partial,
      partialMeta: `${partial}.json`
    }
  }

  isInstalled () {
    if (!this.manifestEntry) return false
    const paths = this.paths()
    try {
      const marker = JSON.parse(fs.readFileSync(paths.marker, 'utf8'))
      return marker.version === this.manifestEntry.version &&
        marker.platform === this.platform &&
        marker.arch === this.arch &&
        marker.integrity === this.manifestEntry.integrity &&
        fs.statSync(paths.executable).isFile()
    } catch (_) {
      return false
    }
  }

  findFallbackInstalled () {
    if (!this.manifestEntry) return undefined
    const platformKey = `${this.platform}-${this.arch}`
    let versions = []
    try { versions = fs.readdirSync(this.root, { withFileTypes: true }) } catch (_) { return undefined }
    const candidates = []
    for (const versionEntry of versions) {
      if (!versionEntry.isDirectory() || versionEntry.name === this.manifestEntry.version || versionEntry.name.startsWith('.')) continue
      const installRoot = path.join(this.root, versionEntry.name, platformKey)
      const marker = readJson(path.join(installRoot, INSTALL_MARKER))
      const executable = path.join(installRoot, ...this.manifestEntry.executableRelativePath.split('/'))
      if (marker?.version !== versionEntry.name || marker.platform !== this.platform || marker.arch !== this.arch || !/^sha512-[A-Za-z0-9+/=]+$/.test(String(marker.integrity || ''))) continue
      try {
        const stat = fs.lstatSync(executable)
        const realExecutable = fs.realpathSync(executable)
        const relative = path.relative(fs.realpathSync(installRoot), realExecutable)
        if (!stat.isFile() || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
      } catch (_) {
        continue
      }
      candidates.push({
        executable,
        version: marker.version,
        installedAt: Date.parse(marker.installedAt || '') || 0
      })
    }
    return candidates.sort((left, right) => right.installedAt - left.installedAt || right.version.localeCompare(left.version))[0]
  }

  async resolveExecutable (config = this.getConfig(), options = {}) {
    const configured = configuredExecutable(config)
    if (configured) {
      if (!path.isAbsolute(configured) || !fs.existsSync(configured)) {
        throw runtimeError('CODEX_EXECUTABLE_NOT_FOUND', '配置的 Codex App Server 可执行文件不存在。')
      }
      try {
        await this.validateLocalExecutable(configured)
      } catch (_) {
        throw runtimeError('CODEX_CUSTOM_RUNTIME_INCOMPATIBLE', '配置的 Codex 无法完成 App Server 初始化，请检查自定义路径。')
      }
      this.publish('ready', this.localRuntimeVersion ? { version: this.localRuntimeVersion } : {})
      return configured
    }
    if (this.isInstalled()) return this.paths().executable
    const fallback = this.findFallbackInstalled()
    if (fallback) {
      try {
        await this.validateLocalExecutable(fallback.executable)
        this.publish('ready', { version: this.localRuntimeVersion || fallback.version })
        return fallback.executable
      } catch (_) {}
    }
    const local = findLocalCodexExecutable({ platform: this.platform })
    if (local) {
      try {
        await this.validateLocalExecutable(local)
        this.publish('ready', this.localRuntimeVersion ? { version: this.localRuntimeVersion } : {})
        return local
      } catch (error) {
        if (options.allowDownload !== true) {
          throw runtimeError('CODEX_LOCAL_RUNTIME_INCOMPATIBLE', '检测到本机 Codex，但版本或 App Server 不兼容，请在 AI 配置中下载固定版本。')
        }
      }
    }
    if (options.allowDownload === true) return this.ensureRuntime()
    throw runtimeError('CODEX_RUNTIME_MISSING', 'Codex 运行时尚未安装，请打开 AI 配置并点击账号按钮完成下载。')
  }

  async validateLocalExecutable (executable) {
    const stat = await fs.promises.stat(executable)
    const cacheKey = `${executable}:${stat.size}:${stat.mtimeMs}`
    let validation = this.localValidation.get(cacheKey)
    if (!validation) {
      const executableKey = crypto.createHash('sha256').update(executable).digest('hex').slice(0, 16)
      const externalRoot = path.join(this.root, '.external-smoke', executableKey)
      validation = this.smokeImpl({
        executable,
        version: this.manifestEntry?.version || CODEX_RUNTIME_VERSION,
        root: externalRoot,
        requireExactVersion: false
      })
      this.localValidation.clear()
      this.localValidation.set(cacheKey, validation)
    }
    let result
    try {
      result = await validation
    } catch (error) {
      this.localValidation.delete(cacheKey)
      throw error
    }
    if (result?.version) this.localRuntimeVersion = result.version
  }

  ensureRuntime () {
    if (!this.manifestEntry) {
      return Promise.reject(runtimeError('CODEX_RUNTIME_UNSUPPORTED', `当前平台 ${this.platform}/${this.arch} 暂不支持 Codex 运行时。`))
    }
    if (this.isInstalled()) {
      this.publish('ready', { downloadedBytes: this.manifestEntry.packedBytes })
      return Promise.resolve(this.paths().executable)
    }
    if (this.inflight) return this.inflight
    if (typeof this.fetchImpl !== 'function') {
      return Promise.reject(runtimeError('CODEX_RUNTIME_NETWORK_UNAVAILABLE', '应用网络服务尚未就绪，请重启后重试。'))
    }
    this.abortController = new AbortController()
    this.userCancelled = false
    this.inflight = this.install().finally(() => {
      this.inflight = null
      this.abortController = null
      this.userCancelled = false
    })
    return this.inflight
  }

  cancelDownload () {
    if (!this.inflight || !this.abortController) return this.getStatus()
    this.userCancelled = true
    this.abortController.abort()
    return this.getStatus()
  }

  async install () {
    const entry = this.manifestEntry
    const paths = this.paths()
    try {
      await fs.promises.mkdir(paths.downloadRoot, { recursive: true, mode: 0o700 })
      await fs.promises.chmod(paths.downloadRoot, 0o700).catch(() => {})
      await this.download(entry, paths)
      this.publish('verifying', { downloadedBytes: entry.packedBytes })
      await verifyFile(paths.partial, entry)
      const executable = await this.extractAndInstall(entry, paths)
      await this.cleanupOldVersions(entry.version)
      await Promise.allSettled([
        fs.promises.rm(paths.partial, { force: true }),
        fs.promises.rm(paths.partialMeta, { force: true })
      ])
      this.publish('ready', { downloadedBytes: entry.packedBytes })
      return executable
    } catch (error) {
      if (isAbortError(error) || this.userCancelled) {
        this.publish('missing', { downloadedBytes: fileSize(paths.partial) })
        throw runtimeError('CODEX_RUNTIME_DOWNLOAD_CANCELLED', 'Codex 运行时下载已取消，可再次点击继续下载。')
      }
      if (error?.discardPartial === true) {
        await Promise.allSettled([
          fs.promises.rm(paths.partial, { force: true }),
          fs.promises.rm(paths.partialMeta, { force: true })
        ])
      }
      const normalized = normalizeRuntimeError(error)
      this.publish('failed', { downloadedBytes: fileSize(paths.partial), error: normalized.safeMessage })
      throw normalized
    }
  }

  async download (entry, paths) {
    let downloadedBytes = fileSize(paths.partial)
    if (downloadedBytes > entry.packedBytes) {
      await resetPartial(paths)
      downloadedBytes = 0
    }
    const metadata = readJson(paths.partialMeta)
    let response = await this.requestDownload(entry, downloadedBytes, metadata?.etag)
    if (response.status === 416 && downloadedBytes === entry.packedBytes) return
    const append = downloadedBytes > 0 && response.status === 206 && validContentRange(response.headers.get('content-range'), downloadedBytes, entry.packedBytes)
    if (downloadedBytes > 0 && !append) {
      await resetPartial(paths)
      downloadedBytes = 0
      response = response.status === 200 ? response : await this.requestDownload(entry, 0)
    }
    if (response.status !== 200 && response.status !== 206) {
      throw runtimeError('CODEX_RUNTIME_DOWNLOAD_FAILED', `Codex 运行时下载失败（HTTP ${response.status}）。`)
    }
    assertPinnedResponse(response, entry, { allowHttp: this.allowInsecureTestSource })
    const etag = cleanEtag(response.headers.get('etag'))
    await writeJson(paths.partialMeta, {
      version: entry.version,
      platform: this.platform,
      arch: this.arch,
      etag
    })
    const output = fs.createWriteStream(paths.partial, { flags: append ? 'a' : 'w', mode: 0o600 })
    let total = append ? downloadedBytes : 0
    this.publish('downloading', { downloadedBytes: total })
    try {
      if (!response.body) throw runtimeError('CODEX_RUNTIME_DOWNLOAD_FAILED', 'Codex 运行时下载没有返回内容。')
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        total += chunk.length
        if (total > entry.packedBytes) {
          const error = runtimeError('CODEX_RUNTIME_TOO_LARGE', 'Codex 运行时下载内容超过固定大小。')
          error.discardPartial = true
          throw error
        }
        if (!output.write(chunk)) await once(output, 'drain')
        this.publish('downloading', { downloadedBytes: total })
      }
      await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()))
    } catch (error) {
      await closeOutputPreservingPartial(output)
      throw error
    }
    if (total !== entry.packedBytes) {
      throw runtimeError('CODEX_RUNTIME_DOWNLOAD_INTERRUPTED', 'Codex 运行时下载中断，可再次点击继续。')
    }
  }

  requestDownload (entry, start, etag) {
    const headers = {}
    if (start > 0) {
      headers.Range = `bytes=${start}-`
      if (etag) headers['If-Range'] = etag
    }
    return this.fetchImpl(entry.url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: this.abortController.signal
    })
  }

  async extractAndInstall (entry, paths) {
    const staging = `${paths.installRoot}.staging-${process.pid}-${Date.now()}`
    await fs.promises.rm(staging, { recursive: true, force: true })
    await fs.promises.mkdir(staging, { recursive: true, mode: 0o700 })
    try {
      await inspectArchive(paths.partial, entry, this.tarImpl)
      await this.tarImpl.x({
        file: paths.partial,
        cwd: staging,
        strip: 1,
        strict: true,
        preserveOwner: false,
        filter: (entryPath, tarEntry) => isAllowedTarEntry(entryPath, tarEntry, entry)
      })
      const executable = path.join(staging, ...entry.executableRelativePath.split('/'))
      const stat = await fs.promises.stat(executable)
      if (!stat.isFile()) throw unsafeArchiveError('Codex 运行时缺少主可执行文件。')
      await applyRestrictedPermissions(staging, executable)
      await this.smokeImpl({ executable, version: entry.version, root: staging })
      await writeJson(path.join(staging, INSTALL_MARKER), {
        version: entry.version,
        platform: this.platform,
        arch: this.arch,
        integrity: entry.integrity,
        installedAt: new Date().toISOString()
      })
      await fs.promises.mkdir(paths.versionRoot, { recursive: true, mode: 0o700 })
      await fs.promises.rm(paths.installRoot, { recursive: true, force: true })
      await fs.promises.rename(staging, paths.installRoot)
      return paths.executable
    } catch (error) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async cleanupOldVersions (activeVersion) {
    let entries = []
    try { entries = await fs.promises.readdir(this.root, { withFileTypes: true }) } catch (_) { return }
    await Promise.allSettled(entries
      .filter(entry => entry.isDirectory() && entry.name !== activeVersion && entry.name !== '.downloads')
      .map(entry => fs.promises.rm(path.join(this.root, entry.name), { recursive: true, force: true })))
  }
}

function configuredExecutable (config = {}) {
  return String(config.codexAppServerExecutable || process.env.CODEX_APP_SERVER_EXECUTABLE || '').trim()
}

function findLocalCodexExecutable (options = {}) {
  const platform = options.platform || process.platform
  const sourcePath = options.pathValue === undefined ? process.env.PATH : options.pathValue
  const home = options.home || os.homedir()
  const directories = String(sourcePath || '').split(path.delimiter).filter(Boolean)
  const common = options.includeCommon === false
    ? []
    : (platform === 'win32'
        ? [
            process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
            process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs')
          ]
        : [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'])
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  for (const directory of [...new Set([...directories, ...common].filter(Boolean))]) {
    for (const name of names) {
      const candidate = path.resolve(directory, name)
      try {
        const stat = fs.statSync(candidate)
        if (stat.isFile()) return candidate
      } catch (_) {}
    }
  }
  return undefined
}

function assertPinnedResponse (response, entry, options = {}) {
  let finalUrl
  try { finalUrl = new URL(response.url || entry.url) } catch (_) { throw runtimeError('CODEX_RUNTIME_SOURCE_INVALID', 'Codex 运行时下载来源无效。') }
  const pinned = new URL(entry.url)
  const allowedProtocol = finalUrl.protocol === 'https:' || (options.allowHttp === true && finalUrl.protocol === 'http:')
  if (!allowedProtocol || finalUrl.origin !== pinned.origin || finalUrl.pathname !== pinned.pathname) {
    throw runtimeError('CODEX_RUNTIME_SOURCE_INVALID', 'Codex 运行时下载被重定向到未允许的地址。')
  }
}

function validContentRange (value, start, total) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value || ''))
  return Boolean(match && Number(match[1]) === start && Number(match[2]) >= start && Number(match[3]) === total)
}

function cleanEtag (value) {
  const etag = String(value || '').trim()
  return etag.length <= 200 ? etag : ''
}

async function verifyFile (file, entry) {
  const stat = await fs.promises.stat(file)
  if (stat.size !== entry.packedBytes) {
    const error = runtimeError('CODEX_RUNTIME_SIZE_MISMATCH', 'Codex 运行时文件大小校验失败。')
    error.discardPartial = true
    throw error
  }
  const expected = entry.integrity.replace(/^sha512-/, '')
  const hash = crypto.createHash('sha512')
  const stream = fs.createReadStream(file)
  stream.on('data', chunk => hash.update(chunk))
  await once(stream, 'end')
  const actual = hash.digest('base64')
  if (!timingSafeEqual(actual, expected)) {
    const error = runtimeError('CODEX_RUNTIME_INTEGRITY_MISMATCH', 'Codex 运行时完整性校验失败，请重试。')
    error.discardPartial = true
    throw error
  }
}

function timingSafeEqual (actual, expected) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

async function inspectArchive (file, entry, tarImpl) {
  let count = 0
  let bytes = 0
  let validationError
  await tarImpl.t({
    file,
    strict: true,
    onentry: tarEntry => {
      if (validationError) return
      count += 1
      bytes += Number(tarEntry.size || 0)
      if (count > MAX_TAR_ENTRIES || bytes > entry.unpackedBytes) {
        validationError = unsafeArchiveError('Codex 运行时压缩包内容超过安全限制。')
      } else if (!isAllowedTarEntry(tarEntry.path, tarEntry, entry)) {
        validationError = unsafeArchiveError('Codex 运行时压缩包包含未允许的文件。')
      }
    }
  })
  if (validationError) throw validationError
  if (count === 0) throw unsafeArchiveError('Codex 运行时压缩包为空。')
}

function isAllowedTarEntry (entryPath, tarEntry, entry) {
  const raw = String(entryPath || '')
  if (!raw || raw.includes('\\') || raw.includes('\0') || path.posix.isAbsolute(raw)) return false
  const withoutTrailingSlash = raw.replace(/\/+$/, '')
  const normalized = path.posix.normalize(withoutTrailingSlash)
  if (normalized !== withoutTrailingSlash) return false
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return false
  const type = tarEntry?.type || 'File'
  if (!['File', 'OldFile', 'Directory'].includes(type)) return false
  const relative = normalized.replace(/^package\/?/, '')
  if (!relative) return type === 'Directory'
  if (type === 'Directory') return relative === 'vendor' || relative === `vendor/${entry.triple}` || relative.startsWith(`vendor/${entry.triple}/`)
  if (relative === 'README.md' || relative === 'package.json') return true
  const escapedTriple = escapeRegExp(entry.triple)
  return new RegExp(`^vendor/${escapedTriple}/(?:codex-package\\.json|codex-path/(?:rg|rg\\.exe)|codex-resources/zsh/bin/zsh|bin/(?:codex|codex\\.exe|codex-code-mode-host|codex-code-mode-host\\.exe|codex-command-runner\\.exe|codex-windows-sandbox-setup\\.exe|codex-linux-sandbox))$`).test(relative)
}

async function applyRestrictedPermissions (root, executable) {
  const entries = await fs.promises.readdir(root, { recursive: true, withFileTypes: true })
  await fs.promises.chmod(root, 0o700).catch(() => {})
  for (const entry of entries) {
    const target = path.join(entry.parentPath || entry.path, entry.name)
    if (entry.isDirectory()) await fs.promises.chmod(target, 0o700).catch(() => {})
    else if (entry.isFile()) await fs.promises.chmod(target, target === executable || isRuntimeHelper(entry.name) ? 0o700 : 0o600).catch(() => {})
  }
}

function isRuntimeHelper (name) {
  return /^(?:codex|codex\.exe|codex-code-mode-host(?:\.exe)?|codex-command-runner\.exe|codex-windows-sandbox-setup\.exe|codex-linux-sandbox|rg(?:\.exe)?|zsh)$/.test(name)
}

async function smokeRuntime ({ executable, version, root, requireExactVersion = true }) {
  const smokeRoot = path.join(root, '.smoke')
  const codexHome = path.join(smokeRoot, 'home')
  await fs.promises.mkdir(codexHome, { recursive: true, mode: 0o700 })
  try {
    const output = await spawnForOutput(executable, ['--version'], smokeRoot, codexHome)
    const detectedVersion = /\bcodex(?:-cli)?\s+([^\s]+)/i.exec(output)?.[1]
    if (!detectedVersion || (requireExactVersion && detectedVersion !== version)) throw runtimeError('CODEX_RUNTIME_VERSION_MISMATCH', 'Codex 运行时版本检查失败。')
    const client = new CodexJsonRpcClient({ executable, cwd: smokeRoot, codexHome, version, defaultTimeoutMs: 20000 })
    try { await client.start() } finally { await client.dispose().catch(() => {}) }
    return { version: detectedVersion }
  } catch (error) {
    if (error?.safeMessage) throw error
    throw runtimeError('CODEX_RUNTIME_SMOKE_FAILED', 'Codex 运行时初始化检查失败，请重试。')
  } finally {
    await fs.promises.rm(smokeRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function spawnForOutput (executable, args, cwd, codexHome) {
  return new Promise((resolve, reject) => {
    const launch = buildLaunchSpec(executable, args)
    const child = spawn(launch.executable, launch.args, {
      cwd,
      env: minimalEnvironment(process.env, codexHome),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: launch.windowsVerbatimArguments
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(runtimeError('CODEX_RUNTIME_SMOKE_TIMEOUT', 'Codex 运行时版本检查超时。'))
    }, 20000)
    child.stdout.on('data', chunk => { output = `${output}${chunk}`.slice(-4096) })
    child.stderr.on('data', chunk => { output = `${output}${chunk}`.slice(-4096) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(runtimeError('CODEX_RUNTIME_SMOKE_FAILED', 'Codex 运行时版本检查失败。'))
    })
  })
}

function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { return undefined }
}

async function writeJson (file, value) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.promises.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.promises.chmod(file, 0o600).catch(() => {})
}

async function resetPartial (paths) {
  await Promise.allSettled([
    fs.promises.rm(paths.partial, { force: true }),
    fs.promises.rm(paths.partialMeta, { force: true })
  ])
}

function fileSize (file) {
  try { return fs.statSync(file).size } catch (_) { return 0 }
}

function closeOutputPreservingPartial (output) {
  if (output.closed) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => resolve()
    output.once('close', done)
    output.once('error', done)
    output.end()
  })
}

function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unsafeArchiveError (safeMessage) {
  const error = runtimeError('CODEX_RUNTIME_ARCHIVE_UNSAFE', safeMessage)
  error.discardPartial = true
  return error
}

function isAbortError (error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

function normalizeRuntimeError (error) {
  if (error?.safeMessage) return error
  return runtimeError('CODEX_RUNTIME_DOWNLOAD_FAILED', 'Codex 运行时下载或安装失败，请检查网络后重试。')
}

function runtimeError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  error.category = code.includes('CANCELLED') ? 'cancelled' : 'internal_error'
  error.retryable = !['CODEX_RUNTIME_UNSUPPORTED', 'CODEX_RUNTIME_SOURCE_INVALID'].includes(code)
  return error
}

module.exports = {
  CodexRuntimeManager,
  INSTALL_MARKER,
  MAX_TAR_ENTRIES,
  configuredExecutable,
  findLocalCodexExecutable,
  validContentRange,
  assertPinnedResponse,
  verifyFile,
  inspectArchive,
  isAllowedTarEntry,
  smokeRuntime,
  runtimeError
}
