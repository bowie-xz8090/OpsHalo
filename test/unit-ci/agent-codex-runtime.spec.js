const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const tar = require('tar')
const { CodexProfileStore } = require('../../src/app/agent/providers/codex-profile-store')
const { CodexAppServerManager } = require('../../src/app/agent/providers/codex-app-server-manager')
const {
  CodexRuntimeManager,
  assertPinnedResponse,
  inspectArchive,
  isAllowedTarEntry
} = require('../../src/app/agent/providers/codex-runtime-manager')
const {
  CODEX_RUNTIME_MANIFEST,
  CODEX_RUNTIME_VERSION
} = require('../../src/app/agent/providers/codex-runtime-manifest')

test('runtime manifest pins every supported platform to Codex 0.147.0 over official HTTPS', () => {
  assert.deepEqual(Object.keys(CODEX_RUNTIME_MANIFEST).sort(), [
    'darwin:arm64',
    'darwin:x64',
    'linux:arm64',
    'linux:x64',
    'win32:arm64',
    'win32:x64'
  ])
  for (const entry of Object.values(CODEX_RUNTIME_MANIFEST)) {
    assert.equal(entry.version, CODEX_RUNTIME_VERSION)
    assert.match(entry.url, /^https:\/\/registry\.npmjs\.org\/@openai\/codex\/-\/codex-0\.147\.0-/)
    assert.match(entry.integrity, /^sha512-/)
    assert.ok(entry.packedBytes > 100 * 1024 * 1024)
    assert.ok(entry.unpackedBytes > entry.packedBytes)
  }
  assert.throws(() => assertPinnedResponse({ url: 'https://attacker.example/codex.tgz' }, CODEX_RUNTIME_MANIFEST['linux:x64']), /未允许的地址/)
})

test('same-version requests share one download, publish progress and clean old runtimes', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive)
  const root = temporaryRoot(t)
  fs.mkdirSync(path.join(root, '0.146.0', 'linux-x64'), { recursive: true })
  const manager = runtimeManager(root, fixture.entry(server.url))
  const events = []
  manager.on('runtimeEvent', event => events.push(event))
  const first = manager.ensureRuntime()
  const second = manager.ensureRuntime()
  assert.equal(first, second)
  const executable = await first
  assert.ok(fs.statSync(executable).isFile())
  assert.equal(server.requests.length, 1)
  assert.ok(events.some(event => event.state === 'downloading' && event.downloadedBytes > 0))
  assert.ok(events.some(event => event.state === 'verifying'))
  assert.deepEqual(Object.keys(events.at(-1)).sort(), [
    'arch',
    'downloadedBytes',
    'platform',
    'state',
    'totalBytes',
    'version'
  ])
  assert.equal(manager.getStatus().state, 'ready')
  assert.equal(fs.existsSync(path.join(root, '0.146.0')), false)
  const marker = fs.readFileSync(path.join(root, '0.147.0', 'linux-x64', '.installed.json'), 'utf8')
  assert.doesNotMatch(marker, /https?:|token|command/i)
})

test('partial downloads resume with Range and ETag', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive)
  const root = temporaryRoot(t)
  const manager = runtimeManager(root, fixture.entry(server.url))
  const paths = manager.paths()
  const content = fs.readFileSync(fixture.archive)
  const midpoint = Math.floor(content.length / 2)
  fs.mkdirSync(paths.downloadRoot, { recursive: true })
  fs.writeFileSync(paths.partial, content.subarray(0, midpoint))
  fs.writeFileSync(paths.partialMeta, JSON.stringify({ etag: server.etag }))
  await manager.ensureRuntime()
  assert.equal(server.requests[0].range, `bytes=${midpoint}-`)
  assert.equal(server.requests[0].ifRange, server.etag)
  assert.equal(server.requests[0].status, 206)
})

test('a server that ignores Range safely restarts from zero', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive, { ignoreRange: true })
  const root = temporaryRoot(t)
  const manager = runtimeManager(root, fixture.entry(server.url))
  const paths = manager.paths()
  const content = fs.readFileSync(fixture.archive)
  fs.mkdirSync(paths.downloadRoot, { recursive: true })
  fs.writeFileSync(paths.partial, content.subarray(0, 20))
  await manager.ensureRuntime()
  assert.equal(server.requests[0].range, 'bytes=20-')
  assert.equal(server.requests[0].status, 200)
  assert.equal(fs.statSync(manager.paths().executable).isFile(), true)
})

test('cancel retains a resumable partial and retry continues it', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive, { slow: true })
  const root = temporaryRoot(t)
  const manager = runtimeManager(root, fixture.entry(server.url))
  const pending = manager.ensureRuntime()
  await waitForEvent(manager, event => event.state === 'downloading' && event.downloadedBytes > 0)
  manager.cancelDownload()
  await assert.rejects(pending, error => error.code === 'CODEX_RUNTIME_DOWNLOAD_CANCELLED')
  const partialBytes = fs.statSync(manager.paths().partial).size
  assert.ok(partialBytes > 0 && partialBytes < fixture.bytes.length)
  server.options.slow = false
  await manager.ensureRuntime()
  assert.match(server.requests.at(-1).range, /^bytes=\d+-$/)
})

test('connection interruption preserves the partial and the next request recovers it', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive, { disconnectFirst: true })
  const root = temporaryRoot(t)
  const manager = runtimeManager(root, fixture.entry(server.url))
  await assert.rejects(manager.ensureRuntime(), /下载或安装失败|下载中断/)
  assert.ok(fs.statSync(manager.paths().partial).size > 0)
  await manager.ensureRuntime()
  assert.match(server.requests.at(-1).range, /^bytes=\d+-$/)
  assert.equal(manager.getStatus().state, 'ready')
})

test('integrity mismatch and oversized responses delete corrupted partials', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive)
  const root = temporaryRoot(t)
  const badHash = runtimeManager(root, { ...fixture.entry(server.url), integrity: `sha512-${Buffer.alloc(64).toString('base64')}` })
  await assert.rejects(badHash.ensureRuntime(), error => error.code === 'CODEX_RUNTIME_INTEGRITY_MISMATCH')
  assert.equal(fs.existsSync(badHash.paths().partial), false)

  const tooSmall = runtimeManager(temporaryRoot(t), { ...fixture.entry(server.url), packedBytes: fixture.bytes.length - 1 })
  await assert.rejects(tooSmall.ensureRuntime(), error => error.code === 'CODEX_RUNTIME_TOO_LARGE')
  assert.equal(fs.existsSync(tooSmall.paths().partial), false)
})

test('a failed upgrade preserves the previously installed runtime', async t => {
  const fixture = await runtimeFixture(t)
  const server = await fileServer(t, fixture.archive)
  const root = temporaryRoot(t)
  const oldExecutable = path.join(root, '0.146.0', 'linux-x64', 'vendor', 'x86_64-unknown-linux-musl', 'bin', 'codex')
  fs.mkdirSync(path.dirname(oldExecutable), { recursive: true })
  fs.writeFileSync(oldExecutable, 'old runtime\n')
  fs.writeFileSync(path.join(root, '0.146.0', 'linux-x64', '.installed.json'), JSON.stringify({
    version: '0.146.0',
    platform: 'linux',
    arch: 'x64',
    integrity: 'sha512-b2xk',
    installedAt: '2026-08-01T00:00:00.000Z'
  }))
  const manager = runtimeManager(root, {
    ...fixture.entry(server.url),
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`
  })
  await assert.rejects(manager.ensureRuntime(), error => error.code === 'CODEX_RUNTIME_INTEGRITY_MISMATCH')
  assert.equal(fs.readFileSync(oldExecutable, 'utf8'), 'old runtime\n')
  assert.equal(await manager.resolveExecutable({}, { allowDownload: false }), oldExecutable)
  assert.equal(manager.getStatus().version, '0.146.0')
})

test('an explicit custom Codex path accepts any version only after capability validation', async t => {
  const root = temporaryRoot(t)
  const executable = path.join(root, 'custom-codex')
  fs.writeFileSync(executable, 'custom runtime\n')
  let validations = 0
  let downloads = 0
  const manager = new CodexRuntimeManager({
    root: path.join(root, 'cache'),
    platform: 'linux',
    arch: 'x64',
    getConfig: () => ({ codexAppServerExecutable: executable }),
    fetchImpl: async () => { downloads += 1 },
    smokeImpl: async ({ requireExactVersion }) => {
      validations += 1
      assert.equal(requireExactVersion, false)
      return { version: '9.8.7' }
    }
  })
  assert.equal(await manager.resolveExecutable(undefined, { allowDownload: true }), executable)
  assert.equal(await manager.resolveExecutable(undefined, { allowDownload: true }), executable)
  assert.equal(manager.getStatus().version, '9.8.7')
  assert.equal(validations, 1)
  assert.equal(downloads, 0)
})

test('an incompatible explicit custom path fails closed without downloading', async t => {
  const root = temporaryRoot(t)
  const executable = path.join(root, 'custom-codex')
  fs.writeFileSync(executable, 'incompatible runtime\n')
  let downloads = 0
  const manager = new CodexRuntimeManager({
    root: path.join(root, 'cache'),
    platform: 'linux',
    arch: 'x64',
    getConfig: () => ({ codexAppServerExecutable: executable }),
    fetchImpl: async () => { downloads += 1 },
    smokeImpl: async () => { throw new Error('initialize failed') }
  })
  await assert.rejects(
    manager.resolveExecutable(undefined, { allowDownload: true }),
    error => error.code === 'CODEX_CUSTOM_RUNTIME_INCOMPATIBLE'
  )
  assert.equal(downloads, 0)
})

test('archive validation accepts required official helpers and rejects unsafe paths', () => {
  const entry = CODEX_RUNTIME_MANIFEST['linux:x64']
  assert.equal(isAllowedTarEntry('package/vendor/x86_64-unknown-linux-musl/bin/codex', { type: 'File' }, entry), true)
  assert.equal(isAllowedTarEntry('package/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh', { type: 'File' }, entry), true)
  assert.equal(isAllowedTarEntry('package/../../escape', { type: 'File' }, entry), false)
  assert.equal(isAllowedTarEntry('/absolute/codex', { type: 'File' }, entry), false)
  assert.equal(isAllowedTarEntry('package/vendor/x86_64-unknown-linux-musl/bin/extra', { type: 'File' }, entry), false)
  assert.equal(isAllowedTarEntry('package/vendor/x86_64-unknown-linux-musl/bin/codex', { type: 'SymbolicLink' }, entry), false)
})

test('archive inspection rejects unknown entries without leaving validation pending', async t => {
  const root = temporaryRoot(t)
  const packageRoot = path.join(root, 'source', 'package')
  fs.mkdirSync(packageRoot, { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'unexpected.txt'), 'blocked\n')
  const archive = path.join(root, 'unsafe.tgz')
  await tar.c({ gzip: true, cwd: path.join(root, 'source'), file: archive }, ['package'])
  await assert.rejects(
    inspectArchive(archive, { ...CODEX_RUNTIME_MANIFEST['linux:x64'], unpackedBytes: 1024 }, tar),
    error => error.code === 'CODEX_RUNTIME_ARCHIVE_UNSAFE'
  )
})

test('runtime failure does not create a phantom account or change the selected account', async t => {
  const profileRoot = temporaryRoot(t)
  const store = new CodexProfileStore(profileRoot)
  const failure = Object.assign(new Error('download failed'), { code: 'CODEX_RUNTIME_DOWNLOAD_FAILED', safeMessage: '下载失败。' })
  const runtimeManager = { resolveExecutable: async () => { throw failure } }
  const manager = new CodexAppServerManager({ profileStore: store, runtimeManager, getConfig: () => ({}) })
  await assert.rejects(manager.startLogin({ method: 'browser', displayName: 'No phantom' }), error => error.code === failure.code)
  assert.equal(store.list().profiles.length, 0)

  const profile = store.create('Existing')
  store.update(profile.profileId, { authState: 'authenticated', email: 'person@example.com', planType: 'plus' })
  store.select(profile.profileId)
  const before = store.list()
  await assert.rejects(manager.refreshAccount(profile.profileId), error => error.code === failure.code)
  assert.deepEqual(store.list(), before)
})

async function runtimeFixture (t) {
  const root = temporaryRoot(t)
  const packageRoot = path.join(root, 'source', 'package')
  const triple = 'x86_64-unknown-linux-musl'
  const executable = path.join(packageRoot, 'vendor', triple, 'bin', 'codex')
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(executable, '#!/bin/sh\necho codex-cli 0.147.0\n')
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(path.join(packageRoot, 'README.md'), 'fixture\n')
  const archive = path.join(root, 'runtime.tgz')
  await tar.c({ gzip: true, cwd: path.join(root, 'source'), file: archive }, ['package'])
  const bytes = fs.readFileSync(archive)
  const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`
  return {
    archive,
    bytes,
    entry: url => ({
      version: CODEX_RUNTIME_VERSION,
      url,
      integrity,
      packedBytes: bytes.length,
      unpackedBytes: 1024 * 1024,
      triple,
      executableName: 'codex',
      executableRelativePath: `vendor/${triple}/bin/codex`
    })
  }
}

function runtimeManager (root, manifestEntry) {
  return new CodexRuntimeManager({
    root,
    platform: 'linux',
    arch: 'x64',
    manifestEntry,
    fetchImpl: global.fetch,
    smokeImpl: async () => {},
    allowInsecureTestSource: true
  })
}

async function fileServer (t, file, options = {}) {
  const bytes = fs.readFileSync(file)
  const etag = '"fixture-etag"'
  const requests = []
  const mutableOptions = { ...options }
  let disconnected = false
  const server = http.createServer((request, response) => {
    const range = request.headers.range
    let start = 0
    let status = 200
    if (range && !mutableOptions.ignoreRange) {
      start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] || 0)
      status = 206
    }
    requests.push({ range, ifRange: request.headers['if-range'], status })
    response.statusCode = status
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('ETag', etag)
    response.setHeader('Content-Length', bytes.length - start)
    if (status === 206) response.setHeader('Content-Range', `bytes ${start}-${bytes.length - 1}/${bytes.length}`)
    if (mutableOptions.disconnectFirst && !disconnected) {
      disconnected = true
      response.flushHeaders()
      response.write(bytes.subarray(start, start + Math.max(1, Math.floor((bytes.length - start) / 2))))
      return setTimeout(() => response.destroy(), 20)
    }
    if (!mutableOptions.slow) return response.end(bytes.subarray(start))
    let offset = start
    const timer = setInterval(() => {
      if (offset >= bytes.length) {
        clearInterval(timer)
        return response.end()
      }
      const end = Math.min(bytes.length, offset + 16)
      response.write(bytes.subarray(offset, end))
      offset = end
    }, 5)
    response.once('close', () => clearInterval(timer))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/runtime.tgz`,
    etag,
    requests,
    options: mutableOptions
  }
}

function temporaryRoot (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-codex-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function waitForEvent (manager, predicate) {
  return new Promise(resolve => {
    const handler = event => {
      if (!predicate(event)) return
      manager.removeListener('runtimeEvent', handler)
      resolve(event)
    }
    manager.on('runtimeEvent', handler)
  })
}
