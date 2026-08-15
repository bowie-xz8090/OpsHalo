const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { atomicWriteJson } = require('../session/session-store')
const { POLICY_VERSION } = require('../config')

function defaultPolicy (featureFlags = {}) {
  return {
    schemaVersion: 1,
    version: POLICY_VERSION,
    agentModeEnabled: featureFlags.agentModeEnabled === true,
    mutationEnabled: featureFlags.agentMutationEnabled === true,
    externalMcpEnabled: featureFlags.agentExternalMcpEnabled === true,
    r4ApprovalEnabled: false,
    userRules: [],
    commandBlacklist: splitPatterns(featureFlags.commandBlacklist),
    commandWhitelist: splitPatterns(featureFlags.commandWhitelist)
  }
}

class PolicyLoader {
  constructor (rootPath, featureFlags) {
    this.filePath = path.join(rootPath, 'runtime-policy.json')
    this.featureFlags = featureFlags
  }

  load () {
    const base = defaultPolicy(this.featureFlags)
    if (!fs.existsSync(this.filePath)) {
      atomicWriteJson(this.filePath, base)
      return base
    }
    let parsed
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) } catch (_) { return base }
    const merged = {
      ...base,
      userRules: Array.isArray(parsed.userRules) ? parsed.userRules.slice(0, 100) : [],
      commandBlacklist: [...new Set([...base.commandBlacklist, ...(Array.isArray(parsed.commandBlacklist) ? parsed.commandBlacklist : [])])].slice(0, 100),
      commandWhitelist: [...new Set([...base.commandWhitelist, ...(Array.isArray(parsed.commandWhitelist) ? parsed.commandWhitelist : [])])].slice(0, 100),
      r4ApprovalEnabled: parsed.r4ApprovalEnabled === true
    }
    merged.version = `agent-policy-v1-${crypto.createHash('sha256').update(JSON.stringify(merged)).digest('hex').slice(0, 12)}`
    return merged
  }
}

function splitPatterns (value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 100)
}

module.exports = { PolicyLoader, defaultPolicy, splitPatterns }
