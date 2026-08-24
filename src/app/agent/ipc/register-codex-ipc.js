const { BrowserWindow } = require('electron')
const { z } = require('zod')
const { IdSchema, VersionSchema } = require('../schemas/shared')
const { ok, fail } = require('./ipc-errors')
const { SlidingWindowRateLimiter } = require('./register-agent-ipc')

const ListSchema = z.strictObject({ schemaVersion: VersionSchema.optional() })
const LoginSchema = z.strictObject({
  schemaVersion: VersionSchema.optional(),
  profileId: IdSchema.optional(),
  displayName: z.string().min(1).max(120).optional(),
  method: z.enum(['browser', 'device_code'])
})
const CancelLoginSchema = z.strictObject({ schemaVersion: VersionSchema.optional(), profileId: IdSchema, loginId: z.string().min(1).max(200) })
const ProfileSchema = z.strictObject({ schemaVersion: VersionSchema.optional(), profileId: IdSchema })
const RuntimeSchema = z.strictObject({ schemaVersion: VersionSchema.optional() })

function registerCodexIpc ({ ipcMain, manager, runtimeManager, openExternal }) {
  const limiter = new SlidingWindowRateLimiter()
  const channels = []
  const register = (channel, schema, rate, handler) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, request) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win || win.isDestroyed()) throw ipcError('CODEX_UNTRUSTED_SENDER', '无法确认请求窗口身份。')
        limiter.check(`${win.id}:${channel}`, rate.limit, rate.intervalMs)
        if (Buffer.byteLength(JSON.stringify(request || {}), 'utf8') > rate.maxBytes) throw ipcError('CODEX_REQUEST_TOO_LARGE', 'Codex 账号请求超过大小限制。')
        return ok(await handler(schema.parse(request || {}), win.id))
      } catch (error) {
        return fail(error)
      }
    })
    channels.push(channel)
  }

  register('codex:list-accounts', ListSchema, { limit: 6, intervalMs: 1000, maxBytes: 1024 }, () => manager.listAccounts())
  register('codex:start-login', LoginSchema, { limit: 2, intervalMs: 10000, maxBytes: 4096 }, async request => {
    const result = await manager.startLogin(request)
    const url = result.authUrl || result.verificationUrl
    if (url && openExternal) await openExternal(url)
    return result
  })
  register('codex:cancel-login', CancelLoginSchema, { limit: 4, intervalMs: 1000, maxBytes: 4096 }, request => manager.cancelLogin(request))
  register('codex:refresh-account', ProfileSchema, { limit: 3, intervalMs: 5000, maxBytes: 2048 }, request => manager.refreshAccount(request.profileId, false))
  register('codex:select-account', ProfileSchema, { limit: 4, intervalMs: 1000, maxBytes: 2048 }, request => manager.selectProfile(request.profileId))
  register('codex:logout', ProfileSchema, { limit: 2, intervalMs: 5000, maxBytes: 2048 }, request => manager.logout(request.profileId))
  register('codex:remove-account', ProfileSchema, { limit: 2, intervalMs: 5000, maxBytes: 2048 }, request => manager.removeProfile(request.profileId))
  register('codex:get-runtime-status', RuntimeSchema, { limit: 6, intervalMs: 1000, maxBytes: 1024 }, () => runtimeManager.getStatus())
  register('codex:cancel-runtime-download', RuntimeSchema, { limit: 4, intervalMs: 1000, maxBytes: 1024 }, () => runtimeManager.cancelDownload())
  return () => channels.forEach(channel => ipcMain.removeHandler(channel))
}

function ipcError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  return error
}

module.exports = { registerCodexIpc, LoginSchema, ProfileSchema, RuntimeSchema }
