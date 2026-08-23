const SUPPORTED_PROTOCOLS = ['ssh', 'electerm']
const DEFAULT_PORTS = {
  ssh: 22,
  electerm: 22
}
const OPTS_DENY_LIST = ['type', 'host']

function parseAuthority (authority) {
  let auth = ''
  let hostPort = authority
  const atIndex = authority.lastIndexOf('@')
  if (atIndex >= 0) {
    auth = authority.slice(0, atIndex)
    hostPort = authority.slice(atIndex + 1)
  }

  let host = hostPort
  let port
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']')
    if (close < 0) return null
    host = hostPort.slice(1, close)
    if (hostPort[close + 1] === ':') {
      port = Number(hostPort.slice(close + 2))
    }
  } else {
    const colon = hostPort.lastIndexOf(':')
    if (colon >= 0 && /^\d+$/.test(hostPort.slice(colon + 1))) {
      host = hostPort.slice(0, colon)
      port = Number(hostPort.slice(colon + 1))
    }
  }
  if (!host || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    return null
  }

  let username = ''
  let password = ''
  if (auth) {
    const colon = auth.indexOf(':')
    if (colon >= 0) {
      username = decodeURIComponent(auth.slice(0, colon))
      password = decodeURIComponent(auth.slice(colon + 1))
    } else {
      username = decodeURIComponent(auth)
    }
  }
  return { host, port, username, password }
}

function parseQuickConnect (value) {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    let input = value.trim()
    const schemeMatch = input.match(/^([a-z][\w+.-]*):\/\//i)
    let scheme = 'ssh'
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase()
      if (!SUPPORTED_PROTOCOLS.includes(scheme)) return null
      input = input.slice(schemeMatch[0].length)
    } else if (/:\/\//.test(input)) {
      return null
    }

    const queryIndex = input.indexOf('?')
    const authority = (queryIndex >= 0 ? input.slice(0, queryIndex) : input).replace(/\/+$/, '')
    const query = queryIndex >= 0 ? input.slice(queryIndex + 1) : ''
    const params = new URLSearchParams(query)
    if (scheme === 'electerm') {
      const requestedType = params.get('type') || params.get('tp') || 'ssh'
      if (requestedType !== 'ssh') return null
    }

    const parsed = parseAuthority(authority)
    if (!parsed) return null
    const result = {
      type: 'ssh',
      host: parsed.host,
      port: parsed.port || 22,
      enableSsh: true,
      enableSftp: true,
      useSshAgent: true,
      authType: 'password',
      term: 'xterm-256color',
      encode: 'utf-8',
      envLang: 'en_US.UTF-8'
    }
    if (parsed.username) result.username = parsed.username
    if (parsed.password) result.password = parsed.password
    if (params.has('title')) result.title = params.get('title')

    const rawOpts = params.get('opts')
    if (rawOpts) {
      const unquoted = rawOpts.replace(/^(?:'|")|(?:'|")$/g, '')
      try {
        const extra = JSON.parse(unquoted)
        for (const key of OPTS_DENY_LIST) delete extra[key]
        Object.assign(result, extra)
      } catch (error) {
        console.error('Failed to parse opts:', error)
      }
    }
    return result
  } catch (error) {
    console.error('Error parsing quick connect string:', error)
    return null
  }
}

function getDefaultPort (protocol) {
  return DEFAULT_PORTS[protocol]
}

function getSupportedProtocols () {
  return [...SUPPORTED_PROTOCOLS]
}

export {
  parseQuickConnect,
  getDefaultPort,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
  DEFAULT_PORTS,
  OPTS_DENY_LIST
}
