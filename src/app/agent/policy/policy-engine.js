const crypto = require('crypto')
const { PolicyDecisionSchema } = require('../schemas/tool-schema')
const { mergeRisk, isAutoExecutable } = require('./risk-model')
const { POLICY_VERSION } = require('../config')

class PolicyEngine {
  constructor (options = {}) {
    this.policy = options.policy || {
      version: POLICY_VERSION,
      mutationEnabled: false,
      externalMcpEnabled: false,
      r4ApprovalEnabled: false,
      userRules: []
    }
  }

  evaluate (session, definition, normalizedIntent, hints = {}) {
    const commandAnalysis = normalizedIntent.commandAnalysis
    const argumentAnalysis = analyzeStructuredArguments(definition, normalizedIntent.normalizedArguments)
    const merged = mergeRisk({
      risk: definition.riskFloor,
      sensitivity: definition.sensitivityFloor,
      cost: definition.costFloor
    }, commandAnalysis || {}, argumentAnalysis, hints.model || {})
    const reasons = [{ code: 'tool_floor', message: `工具最低等级 ${definition.riskFloor}/${definition.sensitivityFloor}/${definition.costFloor}`, source: 'tool_floor' }]
    if (commandAnalysis?.riskSignals) reasons.push(...commandAnalysis.riskSignals)
    reasons.push(...argumentAnalysis.reasons)
    if (hints.model && (hints.model.risk || hints.model.sensitivity || hints.model.cost)) {
      reasons.push({ code: 'model_risk_hint', message: '模型建议提高风险等级。', source: 'model_hint' })
    }
    let outcome
    const matchedRuleIds = [...(commandAnalysis?.denyRuleIds || []), ...argumentAnalysis.denyRuleIds]
    const userCommandRule = definition.name === 'shell.exec' ? matchUserCommandRules(normalizedIntent.normalizedArguments?.command || normalizedIntent.arguments?.command || '', this.policy) : null
    if (userCommandRule) {
      matchedRuleIds.push(userCommandRule.code)
      reasons.push({ code: userCommandRule.code, message: userCommandRule.message, source: 'user_policy' })
    }
    const isExternalMcp = definition.category === 'network' && definition.name.startsWith('mcp.')
    if (merged.risk === 'R5' || definition.approval === 'blocked' || userCommandRule) {
      outcome = 'deny'
    } else if (isExternalMcp && !this.policy.externalMcpEnabled) {
      outcome = 'deny'
      matchedRuleIds.push('external_mcp_disabled')
      reasons.push({ code: 'external_mcp_disabled', message: '外部 MCP Agent 能力未启用。', source: 'user_policy' })
    } else if (definition.mutability !== 'none' && !this.policy.mutationEnabled) {
      outcome = 'deny'
      matchedRuleIds.push('mutation_disabled')
      reasons.push({ code: 'mutation_disabled', message: 'Agent 变更能力未启用。', source: 'user_policy' })
    } else if (merged.risk === 'R4' && !this.policy.r4ApprovalEnabled) {
      outcome = 'deny'
      matchedRuleIds.push('r4_disabled')
      reasons.push({ code: 'r4_disabled', message: '当前策略阻断高风险操作。', source: 'user_policy' })
    } else if (definition.approval === 'always' || merged.risk === 'R4' || merged.risk === 'R3' || merged.risk === 'R2' || ['S2', 'S3'].includes(merged.sensitivity) || ['C2', 'C3'].includes(merged.cost)) {
      outcome = 'require_approval'
    } else if (definition.approval === 'auto_if_bounded' && isAutoExecutable({ ...merged, bounded: normalizedIntent.commandAnalysis ? normalizedIntent.commandAnalysis.bounded : normalizedIntent.bounded !== false })) {
      outcome = 'allow'
    } else {
      outcome = 'require_approval'
    }
    const allowedApprovalScopes = outcome === 'require_approval'
      ? (merged.risk === 'R4' ? ['once'] : ['once', 'task_exact_match'])
      : []
    return PolicyDecisionSchema.parse({
      schemaVersion: 1,
      decisionId: `decision_${crypto.randomBytes(18).toString('base64url')}`,
      taskId: normalizedIntent.taskId,
      invocationId: normalizedIntent.invocationId,
      outcome,
      risk: merged.risk,
      sensitivity: merged.sensitivity,
      cost: merged.cost,
      reasons,
      matchedRuleIds,
      policyVersion: this.policy.version,
      allowedApprovalScopes,
      evaluatedAt: new Date().toISOString()
    })
  }
}

function analyzeStructuredArguments (definition, args) {
  if (definition.name === 'shell.exec') return { reasons: [], denyRuleIds: [] }
  const strings = collectStrings(args)
  const paths = strings.filter(value => value.startsWith('/'))
  const reasons = []
  const denyRuleIds = []
  let risk
  let sensitivity
  let cost
  if (paths.some(value => /^\/(?:dev\/(?:mem|kmem|sd[a-z]|nvme\d+n\d+)|proc\/kcore)(?:\/|$)/i.test(value))) {
    risk = 'R5'
    denyRuleIds.push('protected_device_read')
    reasons.push({ code: 'protected_device_read', message: '目标包含禁止自动访问的设备或内核内存路径。', source: 'builtin_rule' })
  }
  if (paths.some(value => /(?:\/etc\/(?:shadow|gshadow)|\/\.ssh\/(?:id_|authorized_keys)|\/\.aws\/credentials|\/\.kube\/config|(?:secret|token|credential|private[-_]?key))/i.test(value))) {
    sensitivity = 'S3'
    reasons.push({ code: 'sensitive_path', message: '目标路径可能包含凭据、令牌或私钥。', source: 'sensitivity' })
  }
  if (paths.some(value => value === '/') || Number(args?.limit) > 200 || Number(args?.maxBytes) > 262144) {
    cost = 'C2'
    reasons.push({ code: 'broad_structured_scope', message: '结构化查询范围较大，需要用户确认。', source: 'cost' })
  }
  return { risk, sensitivity, cost, reasons, denyRuleIds }
}

function collectStrings (value, result = []) {
  if (typeof value === 'string') result.push(value)
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, result))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, result))
  return result
}

function matchUserCommandRules (command, policy) {
  const matches = (patterns, value) => patterns.some(pattern => {
    try { return new RegExp(pattern).test(value) } catch (_) { return false }
  })
  const blacklist = policy.commandBlacklist || []
  if (matches(blacklist, command)) return { code: 'user_command_blacklist', message: '命令匹配用户配置的黑名单规则。' }
  const whitelist = policy.commandWhitelist || []
  if (whitelist.length && !matches(whitelist, command)) return { code: 'user_command_whitelist', message: '命令不在用户配置的白名单内。' }
  return null
}

module.exports = { PolicyEngine, analyzeStructuredArguments, matchUserCommandRules }
