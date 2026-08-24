const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, net } = require('electron')
const { CodexRuntimeManager } = require('../../src/app/agent/providers/codex-runtime-manager')

async function main () {
  const requestedRoot = String(process.env.OPSHALO_CODEX_RUNTIME_SMOKE_ROOT || '').trim()
  const root = requestedRoot
    ? path.resolve(requestedRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'opshalo-codex-runtime-smoke-'))
  if (requestedRoot && !root.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) {
    throw new Error('Codex runtime smoke root must be inside the system temporary directory')
  }
  const manager = new CodexRuntimeManager({
    root,
    fetchImpl: (url, options) => net.fetch(url, options)
  })
  let lastPercent = -10
  manager.on('runtimeEvent', event => {
    if (event.state === 'downloading' && event.totalBytes > 0) {
      const percent = Math.floor((event.downloadedBytes / event.totalBytes) * 10) * 10
      if (percent >= lastPercent + 10) {
        lastPercent = percent
        console.log(`Codex runtime download: ${Math.min(100, percent)}%`)
      }
      return
    }
    if (event.state !== 'downloading') console.log(`Codex runtime: ${event.state}`)
  })
  const stop = () => manager.cancelDownload()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    let executable
    let lastError
    for (let attempt = 1; attempt <= 3 && !executable; attempt += 1) {
      try {
        executable = await manager.ensureRuntime()
      } catch (error) {
        lastError = error
        if (attempt < 3) console.warn(`Codex runtime smoke attempt ${attempt} interrupted; resuming the verified partial.`)
      }
    }
    if (!executable) throw lastError
    if (!fs.statSync(executable).isFile()) throw new Error('Codex runtime smoke did not install an executable')
    if (manager.getStatus().state !== 'ready') throw new Error('Codex runtime smoke did not reach ready state')
    console.log(`Codex ${manager.getStatus().version} runtime smoke passed for ${process.platform}/${process.arch}`)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    if (!requestedRoot) fs.rmSync(root, { recursive: true, force: true })
  }
}

app.commandLine.appendSwitch('disable-gpu')
app.whenReady()
  .then(main)
  .catch(error => {
    console.error(error.safeMessage || error.message)
    process.exitCode = 1
  })
  .finally(() => app.quit())
