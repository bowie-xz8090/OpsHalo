import bookmarkSchema from './bookmark-schema.js'

const defaultValues = {
  ssh: {
    port: 22,
    enableSsh: true,
    enableSftp: true,
    useSshAgent: true,
    x11: false,
    term: 'xterm-256color',
    displayRaw: false,
    authType: 'password',
    encode: 'utf8',
    envLang: 'en_US.UTF-8',
    username: 'root'
  }
}

const requiredFields = {
  ssh: ['host']
}

export function fixBookmarkData (data) {
  if (!data || typeof data !== 'object') {
    return data
  }

  const type = data.type || 'ssh'
  const schema = bookmarkSchema[type]

  if (!schema) {
    return data
  }

  const fixed = { ...data }

  if (!fixed.type) {
    fixed.type = type
  }

  const defaults = defaultValues[type] || {}
  for (const [key, value] of Object.entries(defaults)) {
    if (fixed[key] === undefined || fixed[key] === null) {
      fixed[key] = value
    }
  }

  if (fixed.connectionHoppings?.length) {
    fixed.hasHopping = true
  }

  return fixed
}

export function validateBookmarkData (data) {
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Invalid data format']
    }
  }

  const type = data.type || 'ssh'
  const required = requiredFields[type]
  const errors = []

  if (!required) {
    return {
      valid: false,
      errors: [`Unsupported bookmark type: ${type}`]
    }
  }

  for (const field of required) {
    if (!data[field]) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

export function getMissingRequiredFields (data) {
  if (!data || typeof data !== 'object') {
    return []
  }

  const type = data.type || 'ssh'
  const required = requiredFields[type] || []
  const missing = []

  for (const field of required) {
    if (!data[field]) {
      missing.push(field)
    }
  }

  return missing
}

export default {
  fixBookmarkData,
  validateBookmarkData,
  getMissingRequiredFields
}
