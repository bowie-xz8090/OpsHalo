const { createHmac } = require('crypto')

const SAFE_ERROR_FIELDS = new Set(['headers', 'data'])
const HMAC_ALGORITHMS = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512'
}

function safeErrorConfig (value) {
  if (!value || typeof value !== 'object') return value
  const safe = {}
  for (const [key, entry] of Object.entries(value)) {
    if (['string', 'number', 'boolean'].includes(typeof entry)) safe[key] = entry
    else if (SAFE_ERROR_FIELDS.has(key) && entry && typeof entry === 'object') {
      try { safe[key] = JSON.parse(JSON.stringify(entry)) } catch (_) {}
    }
  }
  return safe
}

class SyncHttpError extends Error {
  constructor (status, statusText, data, config) {
    super(`status: ${status}\nstatusText: ${statusText}\ndata: ${JSON.stringify(data, null, 2)}\nconfig: ${JSON.stringify(safeErrorConfig(config), null, 2)}`)
    this.status = status
    this.statusText = statusText
    this.data = data
    this.config = safeErrorConfig(config)
  }
}

function signSyncToken (userId, secret, algorithm = 'HS256', now = Date.now()) {
  const digest = HMAC_ALGORITHMS[algorithm]
  if (!digest) throw new Error(`Unsupported sync token algorithm: ${algorithm}`)
  const encodedHeader = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify({ id: userId, exp: now + 1000000, iat: Math.floor(now / 1000) })).toString('base64url')
  const unsigned = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac(digest, secret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

class SyncClient {
  constructor (axiosInstance, type, token, userAgent = 'electerm-sync/v2.0.0') {
    this.axios = axiosInstance
    this.type = type
    this.userAgent = userAgent
    if (type === 'github') {
      this.token = token
      this.server = 'https://api.github.com'
      this.userId = ''
      this.algorithm = 'HS256'
    } else if (type === 'gitee') {
      this.token = token
      this.server = 'https://gitee.com/api/v5'
      this.userId = ''
      this.algorithm = 'HS256'
    } else {
      const [secret, server, userId = '', algorithm = 'HS256'] = String(token || '').split('####')
      this.token = secret
      this.server = server
      this.userId = userId
      this.algorithm = algorithm
    }
  }

  async request (request) {
    try {
      const response = await this.axios.request({
        ...request,
        headers: this.headers(request.headers)
      })
      return response.data
    } catch (error) {
      if (error && error.response) {
        throw new SyncHttpError(error.response.status, error.response.statusText, error.response.data, error.response.config)
      }
      if (error && error.config) error.config = safeErrorConfig(error.config)
      throw error
    }
  }

  headers (headers = {}) {
    const authorization = this.type === 'github' || this.type === 'gitee'
      ? `token ${this.token}`
      : `Bearer ${this.userId ? signSyncToken(this.userId, this.token, this.algorithm) : this.token}`
    return {
      'Content-Type': 'application/json',
      Authorization: authorization,
      'X-User-Agent': this.userAgent,
      ...headers
    }
  }

  async run (func, args) {
    if (this.type === 'github' || this.type === 'gitee') return this.runGist(func, args)
    return this.runCustom(func, args)
  }

  async runGist (func, args) {
    if (func === 'test') return this.request({ url: `${this.server}/gists?per_page=1`, method: 'GET' })
    if (func === 'create') return this.request({ url: `${this.server}/gists`, method: 'POST', data: args[0] })
    if (func === 'update') return this.request({ url: `${this.server}/gists/${args[0]}`, method: 'PATCH', data: args[1] })
    if (func === 'getOne') return this.request({ url: `${this.server}/gists/${args[0]}`, method: 'GET' })
    throw new Error(`Unsupported func: ${func}`)
  }

  async runCustom (func, args) {
    if (func === 'test') {
      if (args.length) this.userId = args[0]
      return this.request({ url: this.server, method: 'POST' })
    }
    if (func === 'create') return this.request({ url: this.server, method: 'PUT', data: args[0] })
    if (func === 'update') {
      if (args.length > 1) this.userId = args[0]
      return this.request({ url: this.server, method: 'PUT', data: args.length > 1 ? args[1] : args[0] })
    }
    if (func === 'getOne') {
      if (args.length) this.userId = args[0]
      return this.request({ url: this.server, method: 'GET' })
    }
    throw new Error(`Unsupported func: ${func}`)
  }
}

async function syncRequest (axiosInstance, type, func, args, token) {
  return new SyncClient(axiosInstance, type, token).run(func, args)
}

module.exports = {
  SyncClient,
  SyncHttpError,
  safeErrorConfig,
  signSyncToken,
  syncRequest
}
