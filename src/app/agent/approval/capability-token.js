const crypto = require('crypto')
const { defaults } = require('../config')

function encode (value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function safeEqual (a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

class CapabilityTokenManager {
  constructor (secret = crypto.randomBytes(32)) {
    this.secret = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'base64url')
    this.issued = new Map()
    this.externalConsumed = new Set()
  }

  issue (claims, ttlMs = defaults.capabilityTtlMs) {
    const now = Date.now()
    const complete = {
      tokenId: claims.tokenId || `cap_${crypto.randomBytes(18).toString('base64url')}`,
      taskId: claims.taskId,
      invocationId: claims.invocationId,
      intentDigest: claims.intentDigest,
      sessionFingerprint: claims.sessionFingerprint,
      policyVersion: claims.policyVersion,
      scope: claims.scope || 'once',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(ttlMs, defaults.capabilityTtlMs)).toISOString()
    }
    const payload = encode(complete)
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url')
    this.issued.set(complete.tokenId, { claims: complete, consumed: false })
    return `${payload}.${signature}`
  }

  verify (token, expected, { consume = false } = {}) {
    const claims = this.verifySignature(token, expected)
    const stored = this.issued.get(claims.tokenId)
    if (!stored || stored.consumed) throw capabilityError('AGENT_CAPABILITY_REPLAYED')
    if (consume) stored.consumed = true
    return claims
  }

  verifyExternal (token, expected, { consume = false } = {}) {
    const claims = this.verifySignature(token, expected)
    if (this.externalConsumed.has(claims.tokenId)) throw capabilityError('AGENT_CAPABILITY_REPLAYED')
    if (consume) this.externalConsumed.add(claims.tokenId)
    return claims
  }

  verifySignature (token, expected) {
    if (typeof token !== 'string' || token.length > 4096) throw capabilityError('AGENT_CAPABILITY_INVALID')
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra) throw capabilityError('AGENT_CAPABILITY_INVALID')
    const expectedSignature = crypto.createHmac('sha256', this.secret).update(payload).digest('base64url')
    if (!safeEqual(signature, expectedSignature)) throw capabilityError('AGENT_CAPABILITY_INVALID')
    let claims
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch (_) { throw capabilityError('AGENT_CAPABILITY_INVALID') }
    if (Date.now() >= Date.parse(claims.expiresAt)) {
      this.issued.delete(claims.tokenId)
      throw capabilityError('AGENT_CAPABILITY_EXPIRED')
    }
    const keys = ['taskId', 'invocationId', 'intentDigest', 'sessionFingerprint', 'policyVersion']
    for (const key of keys) {
      if (expected[key] !== claims[key]) throw capabilityError('AGENT_CAPABILITY_MISMATCH')
    }
    return claims
  }

  revokeTask (taskId) {
    for (const [tokenId, entry] of this.issued) {
      if (entry.claims.taskId === taskId) this.issued.delete(tokenId)
    }
  }

  exportVerifierSecret () {
    return this.secret.toString('base64url')
  }
}

function capabilityError (code) {
  const error = new Error(code)
  error.code = code
  error.safeMessage = '执行授权无效、已过期或已被使用，请重新确认。'
  return error
}

module.exports = { CapabilityTokenManager, capabilityError }
