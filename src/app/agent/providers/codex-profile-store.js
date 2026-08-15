const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAX_PROFILE_FILE_BYTES = 1024 * 1024

function ensurePrivateDirectory (directory, fsModule = fs) {
  fsModule.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fsModule.chmodSync(directory, 0o700)
  const stat = fsModule.statSync(directory)
  if (!stat.isDirectory()) throw profileError('CODEX_PROFILE_PATH_INVALID', 'Codex 账号目录无效。')
}

function maskEmail (email) {
  const value = String(email || '').trim()
  const at = value.indexOf('@')
  if (at <= 0) return value ? `${value.slice(0, 1)}***` : undefined
  const local = value.slice(0, at)
  return `${local.slice(0, Math.min(2, local.length))}***${value.slice(at)}`
}

function sanitizeRateLimits (value) {
  if (!value || typeof value !== 'object') return undefined
  const sanitizeWindow = window => window && typeof window === 'object'
    ? {
        usedPercent: Number.isFinite(window.usedPercent) ? Math.max(0, Math.min(100, Math.round(window.usedPercent))) : undefined,
        windowDurationMins: Number.isFinite(window.windowDurationMins) ? Math.max(0, Math.round(window.windowDurationMins)) : undefined,
        resetsAt: Number.isFinite(window.resetsAt) ? Math.max(0, Math.round(window.resetsAt)) : undefined
      }
    : undefined
  return {
    limitId: String(value.limitId || 'codex').slice(0, 120),
    primary: sanitizeWindow(value.primary),
    secondary: sanitizeWindow(value.secondary),
    rateLimitReachedType: value.rateLimitReachedType ? String(value.rateLimitReachedType).slice(0, 120) : undefined,
    observedAt: new Date().toISOString()
  }
}

function sanitizeProfile (profile) {
  return {
    schemaVersion: 1,
    profileId: String(profile.profileId || ''),
    displayName: String(profile.displayName || 'Codex account').slice(0, 120),
    maskedEmail: profile.maskedEmail ? String(profile.maskedEmail).slice(0, 320) : undefined,
    planType: profile.planType ? String(profile.planType).slice(0, 80) : undefined,
    authState: ['unknown', 'unauthenticated', 'authorizing', 'authenticated', 'expired', 'error'].includes(profile.authState) ? profile.authState : 'unknown',
    rateLimits: sanitizeRateLimits(profile.rateLimits),
    error: profile.error ? String(profile.error).slice(0, 500) : undefined,
    createdAt: profile.createdAt || new Date().toISOString(),
    updatedAt: profile.updatedAt || new Date().toISOString(),
    lastUsedAt: profile.lastUsedAt
  }
}

class CodexProfileStore {
  constructor (rootPath, options = {}) {
    this.fs = options.fs || fs
    this.root = path.resolve(rootPath)
    this.profilesRoot = path.join(this.root, 'profiles')
    this.indexPath = path.join(this.root, 'profiles.json')
    ensurePrivateDirectory(this.root, this.fs)
    ensurePrivateDirectory(this.profilesRoot, this.fs)
    this.state = this.load()
  }

  load () {
    if (!this.fs.existsSync(this.indexPath)) return { schemaVersion: 1, currentProfileId: null, profiles: [] }
    const stat = this.fs.statSync(this.indexPath)
    if (stat.size > MAX_PROFILE_FILE_BYTES) return this.quarantine('too_large')
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.indexPath, 'utf8'))
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles)) throw new Error('Unsupported profile schema')
      const profiles = parsed.profiles.map(sanitizeProfile).filter(profile => /^codex_[A-Za-z0-9_-]{12,}$/.test(profile.profileId))
      const currentProfileId = profiles.some(profile => profile.profileId === parsed.currentProfileId) ? parsed.currentProfileId : null
      return { schemaVersion: 1, currentProfileId, profiles }
    } catch (_) {
      return this.quarantine('corrupt')
    }
  }

  quarantine (reason) {
    if (this.fs.existsSync(this.indexPath)) {
      try { this.fs.renameSync(this.indexPath, `${this.indexPath}.${Date.now()}.${reason}`) } catch (_) {}
    }
    return { schemaVersion: 1, currentProfileId: null, profiles: [] }
  }

  save () {
    const temp = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`
    const value = JSON.stringify(this.state, null, 2)
    if (Buffer.byteLength(value, 'utf8') > MAX_PROFILE_FILE_BYTES) throw profileError('CODEX_PROFILE_QUOTA_EXCEEDED', 'Codex 账号元数据超过本地配额。')
    this.fs.writeFileSync(temp, value, { encoding: 'utf8', mode: 0o600 })
    this.fs.chmodSync(temp, 0o600)
    this.fs.renameSync(temp, this.indexPath)
  }

  list () {
    return { schemaVersion: 1, currentProfileId: this.state.currentProfileId, profiles: this.state.profiles.map(profile => ({ ...profile })) }
  }

  get (profileId) {
    return this.state.profiles.find(profile => profile.profileId === profileId)
  }

  create (displayName) {
    const profileId = `codex_${crypto.randomBytes(16).toString('base64url')}`
    const now = new Date().toISOString()
    const profile = sanitizeProfile({ profileId, displayName, authState: 'unauthenticated', createdAt: now, updatedAt: now })
    this.ensureProfileDirectories(profileId)
    this.state.profiles.push(profile)
    if (!this.state.currentProfileId) this.state.currentProfileId = profileId
    this.save()
    return { ...profile }
  }

  update (profileId, patch) {
    const index = this.state.profiles.findIndex(profile => profile.profileId === profileId)
    if (index < 0) throw profileError('CODEX_PROFILE_NOT_FOUND', 'Codex 账号不存在。')
    const current = this.state.profiles[index]
    const next = sanitizeProfile({
      ...current,
      displayName: patch.displayName === undefined ? current.displayName : patch.displayName,
      maskedEmail: patch.email ? maskEmail(patch.email) : patch.maskedEmail === undefined ? current.maskedEmail : patch.maskedEmail,
      planType: patch.planType === undefined ? current.planType : patch.planType,
      authState: patch.authState === undefined ? current.authState : patch.authState,
      rateLimits: patch.rateLimits === undefined ? current.rateLimits : patch.rateLimits,
      error: patch.error === undefined ? current.error : patch.error,
      lastUsedAt: patch.lastUsedAt === undefined ? current.lastUsedAt : patch.lastUsedAt,
      updatedAt: new Date().toISOString()
    })
    this.state.profiles[index] = next
    this.save()
    return { ...next }
  }

  select (profileId) {
    if (!this.get(profileId)) throw profileError('CODEX_PROFILE_NOT_FOUND', 'Codex 账号不存在。')
    this.state.currentProfileId = profileId
    this.update(profileId, { lastUsedAt: new Date().toISOString() })
    return this.list()
  }

  paths (profileId) {
    if (!/^codex_[A-Za-z0-9_-]{12,}$/.test(String(profileId || ''))) throw profileError('CODEX_PROFILE_ID_INVALID', 'Codex 账号标识无效。')
    const profileRoot = path.resolve(this.profilesRoot, profileId)
    if (path.relative(this.profilesRoot, profileRoot).startsWith('..')) throw profileError('CODEX_PROFILE_PATH_INVALID', 'Codex 账号目录越界。')
    return { profileRoot, codexHome: path.join(profileRoot, 'codex-home'), runtime: path.join(profileRoot, 'runtime') }
  }

  ensureProfileDirectories (profileId) {
    const paths = this.paths(profileId)
    ensurePrivateDirectory(paths.profileRoot, this.fs)
    ensurePrivateDirectory(paths.codexHome, this.fs)
    ensurePrivateDirectory(paths.runtime, this.fs)
    return paths
  }

  delete (profileId) {
    const paths = this.paths(profileId)
    this.state.profiles = this.state.profiles.filter(profile => profile.profileId !== profileId)
    if (this.state.currentProfileId === profileId) this.state.currentProfileId = this.state.profiles[0]?.profileId || null
    this.save()
    if (this.fs.existsSync(paths.profileRoot)) {
      this.fs.rmSync(paths.profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
    return this.list()
  }
}

function profileError (code, safeMessage) {
  const error = new Error(safeMessage)
  error.code = code
  error.safeMessage = safeMessage
  return error
}

module.exports = { CodexProfileStore, ensurePrivateDirectory, maskEmail, sanitizeProfile, sanitizeRateLimits, profileError }
