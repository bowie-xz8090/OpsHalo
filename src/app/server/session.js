/**
 * SSH and local terminal session factory.
 */

/**
 * Dynamically load a module based on terminal type
 * @param {string} type - Terminal type
 * @returns {Object} The loaded module
 */
const sessionModules = {
  local: () => require('./session-local'),
  ssh: () => require('./session-ssh')
}

/**
 * Create a terminal session
 * @param {object} initOptions - Terminal initialization options
 * @param {object} ws - WebSocket connection
 * @returns {Promise} Terminal session
 */
exports.startSession = async function (initOptions, ws, func = 'session') {
  const type = initOptions.termType || initOptions.type || 'ssh'
  const normalizedType = type === 'remote' ? 'ssh' : type
  const loadModule = sessionModules[normalizedType]
  if (!loadModule) {
    const error = new Error(`Unsupported session type: ${type}`)
    error.code = 'UNSUPPORTED_SESSION_TYPE'
    throw error
  }
  const module = loadModule()
  return module[func](initOptions, ws)
}
