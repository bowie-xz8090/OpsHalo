const internalConclusionRules = [
  {
    pattern: /(?:关键证据.*(?:矛盾|冲突)|unresolved contradiction)/i,
    replacement: '命令输出中的信息不一致，暂时无法确认最终结果。'
  },
  {
    pattern: /(?:尚无足够的已验证事实|证据不足|insufficient evidence)/i,
    replacement: '目前的命令输出还不能确认全部结果。'
  },
  {
    pattern: /AI 尚未完成全部关键目标/i,
    replacement: '本次检查尚未确认全部结果。'
  }
]

const statusLabels = {
  inconclusive: '仍需确认',
  blocked: '操作未执行',
  partial: '部分完成',
  failed: '处理失败',
  cancelled: '已停止'
}

const confidenceLabels = {
  observed: '命令输出已确认',
  corroborated: '多项结果已确认',
  inferred: 'AI 分析判断'
}

const operationStatusLabels = {
  pending: '待确认',
  running: '执行中',
  success: '执行成功',
  failed: '执行失败',
  cancelled: '已取消',
  timeout: '执行超时',
  unknown: '状态未知',
  passed: '检查通过',
  partial: '部分通过',
  inconclusive: '暂时无法确认'
}

const factKeyLabels = {
  nginx: 'Nginx',
  location: '配置项',
  status: '状态',
  service: '服务',
  process: '进程',
  port: '端口'
}

export function readableFinalConclusion (result = {}) {
  const conclusion = String(result.conclusion || '').trim()
  if (conclusion) {
    const internal = internalConclusionRules.find(item => item.pattern.test(conclusion))
    if (internal) return internal.replacement
    return conclusion
  }
  if (result.status === 'complete') return '本次检查已完成。'
  if (result.status === 'cancelled') return '本次检查已停止。'
  if (result.status === 'blocked') return '此操作未执行。'
  if (result.status === 'failed') return '本次检查未能完成。'
  return '目前的命令输出还不能确认全部结果。'
}

export function readableFinalStatus (status) {
  return statusLabels[status] || ''
}

export function readableConfidence (confidence) {
  return confidenceLabels[confidence] || ''
}

export function readableOperationStatus (status) {
  return operationStatusLabels[status] || ''
}

export function readableFactStatement (statement) {
  const value = String(statement || '')
    .replace(/\s*\((?:observed|corroborated|inferred)\)\s*$/i, '')
    .replace(/\[fact_[A-Za-z0-9_-]+\]/g, '')
    .trim()
  const assignment = /^([A-Za-z][\w.-]*)=(.+)$/.exec(value)
  if (!assignment) return value
  const label = factKeyLabels[assignment[1].toLowerCase()] || assignment[1]
  return `${label}：${assignment[2].trim()}`
}
