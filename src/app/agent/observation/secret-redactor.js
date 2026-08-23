const crypto = require('crypto')

const patterns = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['authorization', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi],
  ['aws_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['openai_key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['database_uri', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi],
  ['url_userinfo', /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/gi],
  ['secret_value', /((?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|cookie)\s*[=:]\s*['"]?)([^\s,'";}]+)/gi]
]

function placeholder (type, secret) {
  const hash = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8)
  return `<redacted:${type}:${hash}>`
}

class SecretRedactor {
  constructor (customPatterns = []) {
    this.patterns = [...patterns]
    this.invalidCustomPatterns = []
    for (const item of customPatterns) {
      try { this.patterns.push(['custom', new RegExp(item, 'g')]) } catch (error) { this.invalidCustomPatterns.push({ pattern: item, error: error.message }) }
    }
  }

  redact (text) {
    let output = String(text || '')
    const types = []
    let count = 0
    try {
      for (const [type, expression] of this.patterns) {
        expression.lastIndex = 0
        output = output.replace(expression, (...args) => {
          count++
          types.push(type)
          if (type === 'secret_value') return `${args[1]}${placeholder(type, args[2])}`
          return placeholder(type, args[0])
        })
      }
      return { text: output, summary: { count, types: [...new Set(types)], failedClosedChunks: 0 }, failed: false }
    } catch (_) {
      return { text: '', summary: { count, types: [...new Set(types)], failedClosedChunks: 1 }, failed: true }
    }
  }
}

class StreamingSecretRedactor {
  constructor (redactor = new SecretRedactor(), tailChars = 1024) {
    this.redactor = redactor
    this.tailChars = Math.max(256, Math.min(Number(tailChars) || 1024, 8192))
    this.buffer = ''
  }

  push (value) {
    this.buffer += String(value || '')
    if (hasOpenPrivateKey(this.buffer) || this.buffer.length <= this.tailChars) return emptyRedaction()
    const cut = this.buffer.length - this.tailChars
    const raw = this.buffer.slice(0, cut)
    this.buffer = this.buffer.slice(cut)
    return this.redactor.redact(raw)
  }

  flush () {
    const result = this.redactor.redact(this.buffer)
    this.buffer = ''
    return result
  }
}

function hasOpenPrivateKey (value) {
  const begin = value.lastIndexOf('-----BEGIN ')
  if (begin < 0) return false
  return value.indexOf('PRIVATE KEY-----', begin) >= 0 && value.indexOf('-----END ', begin) < 0
}

function emptyRedaction () {
  return { text: '', summary: { count: 0, types: [], failedClosedChunks: 0 }, failed: false }
}

module.exports = { SecretRedactor, StreamingSecretRedactor, patterns, placeholder, hasOpenPrivateKey }
