function classifyExecutionError (result, stderr = '') {
  const text = `${result.transportError?.safeMessage || ''}\n${stderr}`
  let category = result.transportError?.category
  if (result.status === 'timeout') category = 'timeout'
  else if (result.status === 'cancelled') category = 'cancelled'
  else if (!category && /command not found|not recognized|no such file or directory/i.test(text)) category = 'command_not_found'
  else if (!category && /permission denied|operation not permitted|access denied/i.test(text)) category = 'permission_denied'
  else if (!category && /unknown option|unrecognized option|illegal option/i.test(text)) category = 'unsupported_option'
  else if (!category && /password|requires? (?:a )?tty|interactive/i.test(text)) category = 'interactive_required'
  else if (!category && result.transportError) category = 'transport_error'
  else if (!category && (result.status === 'error' || result.status === 'unknown' || result.status === 'partial')) category = 'internal_error'
  if (!category) return []
  return [{
    schemaVersion: 1,
    code: result.transportError?.code || `AGENT_${category.toUpperCase()}`,
    category,
    source: 'executor',
    retryable: typeof result.transportError?.retryable === 'boolean'
      ? result.transportError.retryable
      : !['cancelled', 'interactive_required'].includes(category),
    safeMessage: result.transportError?.safeMessage || safeMessage(category),
    occurredAt: new Date().toISOString()
  }]
}

function safeMessage (category) {
  return {
    command_not_found: '目标环境中没有该命令，需改用已有工具。',
    permission_denied: '当前会话权限不足。',
    unsupported_option: '目标环境不支持该命令选项。',
    timeout: '动作执行超时，需缩小探查范围。',
    cancelled: '动作已取消。',
    interactive_required: '动作需要用户接管交互。',
    transport_error: '终端连接或执行通道发生错误。',
    internal_error: '动作未成功完成，请结合退出码和已脱敏输出调整下一步。'
  }[category]
}

module.exports = { classifyExecutionError }
