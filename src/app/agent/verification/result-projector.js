function projectFastQueryResult (session, route, observation) {
  if (!route || session.currentInvocation?.toolName !== route.toolName || !observation) return null
  if (observation.status !== 'success' || observation.errors.length || !observation.resultView || observation.resultView.partial) return null
  const evidenceRefs = observation.evidenceRefs || []
  if (!evidenceRefs.length) return null
  const facts = session.memory.facts.filter(fact => fact.evidenceRefs.some(ref => evidenceRefs.includes(ref)))
  return {
    status: 'complete',
    conclusion: formatResult(route.routeId, observation.resultView),
    confirmedFacts: facts,
    inferences: [],
    unresolvedItems: [],
    operations: session.memory.changeRecords,
    verificationOutcomes: session.verification?.outcomes || [],
    evidenceRefs: [...new Set([...session.evidenceRefs, ...evidenceRefs])],
    completedAt: new Date().toISOString()
  }
}

function formatResult (routeId, view) {
  const rows = view.rows || []
  if (!rows.length) return view.query ? `未发现匹配“${view.query}”的结果。` : '查询成功，未发现匹配结果。'
  const omitted = Math.max(0, (view.matchedCount || rows.length) - rows.length)
  const tail = view.displayTruncated || omitted > 0 ? `\n- ……另有 ${omitted} 项未展开，完整结果已保存为证据。` : ''
  if (routeId === 'docker-list') {
    return [`发现 ${view.matchedCount ?? rows.length} 个匹配容器：`, ...rows.map(item => `- ${item.name || item.id || 'unknown'}：镜像 ${item.image || 'unknown'}，状态 ${item.state || item.status || 'unknown'}${item.ports ? `，端口 ${item.ports}` : ''}`)].join('\n') + tail
  }
  if (routeId === 'docker-nginx-config') {
    const item = rows[0]
    const suffix = view.displayTruncated ? '\n\n配置较长，当前展示有界摘录；完整脱敏结果已保存为证据。' : ''
    return `容器 ${item.container || view.query || 'unknown'} 的 Nginx 生效配置：\n\n\`\`\`nginx\n${item.config || ''}\n\`\`\`${suffix}`.slice(0, 5000)
  }
  if (routeId === 'process-list') {
    return [`发现 ${view.matchedCount ?? rows.length} 个匹配进程：`, ...rows.map(item => `- PID ${item.pid || 'unknown'}，${item.user || 'unknown'}，CPU ${item.cpu || '?'}%，内存 ${item.memory || '?'}%，命令 ${item.command || 'unknown'}`)].join('\n') + tail
  }
  if (routeId === 'network-ports') {
    return [`发现 ${view.matchedCount ?? rows.length} 个监听项：`, ...rows.map(item => `- ${item.protocol || ''} ${item.local || 'unknown'} ${item.process ? `(${item.process})` : ''}`.trim())].join('\n') + tail
  }
  if (routeId === 'service-status') {
    const item = rows[0]
    return `服务 ${item.Id || view.query || 'unknown'}：LoadState=${item.LoadState || 'unknown'}，ActiveState=${item.ActiveState || 'unknown'}，SubState=${item.SubState || 'unknown'}，MainPID=${item.MainPID || 'unknown'}。`
  }
  if (routeId === 'host-profile') {
    return Object.entries(rows[0]).map(([key, value]) => `${key}: ${value}`).join('\n')
  }
  return rows.map(item => Object.entries(item).map(([key, value]) => `${key}=${value}`).join('，')).join('\n')
}

module.exports = { projectFastQueryResult, formatResult }
