function parseStructuredFacts (toolName, text, evidenceRef) {
  const facts = []
  let value
  try { value = JSON.parse(text) } catch (_) { return facts }
  const data = value?.data === undefined ? value : value.data
  if (!data || typeof data !== 'object') return facts
  const add = (statement, sourcePath) => facts.push({ statement, confidence: 'observed', evidenceRef, sourcePath })
  if (toolName === 'session.describe') add(`当前会话为 ${data.username || 'unknown'}@${data.host || 'unknown'}，工作目录 ${data.cwd || 'unknown'}。`, '$')
  if (toolName === 'host.profile') {
    if (data.os) add(`操作系统：${data.os}`, '$.os')
    if (data.kernel) add(`内核：${data.kernel}`, '$.kernel')
    if (data.uptime) add(`运行时长：${data.uptime}`, '$.uptime')
  }
  if (toolName === 'service.status' && data.name) add(`服务 ${data.name} 状态为 ${data.active || data.status || 'unknown'}。`, '$.active')
  if (toolName === 'docker.list' && Array.isArray(data.items)) {
    const containers = data.items.slice(0, 12).map(item => {
      const identity = item.name || item.id || 'unknown'
      const details = [item.image, item.state || item.status].filter(Boolean).join('，')
      return details ? `${identity}（${details}）` : identity
    })
    const suffix = data.items.length > containers.length ? `；另有 ${data.items.length - containers.length} 个匹配项未展开` : ''
    add(`扫描 ${data.totalScanned ?? data.items.length} 个容器，发现 ${data.matchedCount ?? data.items.length} 个匹配容器${containers.length ? `：${containers.join('；')}` : ''}${suffix}。`, '$.items')
  }
  if (toolName === 'docker.nginx_config' && typeof data.config === 'string') add(`已从容器 ${data.container || 'unknown'} 读取 Nginx 生效配置，共 ${data.bytes ?? Buffer.byteLength(data.config, 'utf8')} 字节。`, '$.config')
  if (toolName === 'network.ports' && Array.isArray(data.items)) add(`发现 ${data.items.length} 个匹配监听端口。`, '$.items')
  if (toolName === 'process.list' && Array.isArray(data.items)) add(`发现 ${data.items.length} 个匹配进程。`, '$.items')
  if (!facts.length) {
    const list = findFirstArray(data)
    if (list) add(`${toolName} 返回 ${list.value.length} 条有界结构化记录。`, list.path)
    else {
      const scalarSummary = Object.entries(data).filter(([key, item]) => !/text|content|excerpt|log|line|env|secret|token|password/i.test(key) && ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 6).map(([key, item]) => `${key}=${String(item).slice(0, 120)}`).join('，')
      if (scalarSummary) add(`${toolName} 已确认：${scalarSummary}。`, '$')
    }
  }
  return facts
}

function parseResultView (toolName, text) {
  let value
  try { value = JSON.parse(text) } catch (_) { return undefined }
  const data = value?.data === undefined ? value : value.data
  if (!data || typeof data !== 'object') return undefined
  if (toolName === 'docker.nginx_config' && typeof data.config === 'string') {
    const config = data.config.slice(0, 4200)
    return {
      kind: 'record',
      columns: ['container', 'config', 'bytes'],
      rows: [{ container: String(data.container || '').slice(0, 200), config, bytes: safeCount(data.bytes, Buffer.byteLength(data.config, 'utf8')) }],
      totalScanned: 1,
      matchedCount: 1,
      query: String(data.container || '').slice(0, 200) || undefined,
      partial: value?.meta?.partial === true,
      displayTruncated: data.displayTruncated === true || data.config.length > config.length
    }
  }
  if (Array.isArray(data.items)) {
    const rows = data.items.slice(0, 30).map(compactRow)
    return {
      kind: 'list',
      columns: [...new Set(rows.flatMap(item => Object.keys(item)))].slice(0, 30),
      rows,
      totalScanned: safeCount(data.totalScanned, data.items.length),
      matchedCount: safeCount(data.matchedCount, data.items.length),
      query: typeof data.query === 'string' && data.query ? data.query.slice(0, 200) : undefined,
      partial: value?.meta?.partial === true || data.partial === true,
      displayTruncated: data.items.length > rows.length
    }
  }
  const row = compactRow(data)
  if (!Object.keys(row).length) return undefined
  return {
    kind: 'record',
    columns: Object.keys(row).slice(0, 30),
    rows: [row],
    totalScanned: 1,
    matchedCount: 1,
    query: toolName === 'service.status' ? String(data.Id || '').slice(0, 200) || undefined : undefined,
    partial: value?.meta?.partial === true,
    displayTruncated: false
  }
}

function compactRow (row) {
  return Object.entries(row || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null).slice(0, 30).reduce((result, [key, value]) => {
    result[key] = typeof value === 'string' ? value.slice(0, 500) : value
    return result
  }, {})
}

function safeCount (value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function findFirstArray (value, path = '$', depth = 0) {
  if (depth > 3 || !value || typeof value !== 'object') return null
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`
    if (Array.isArray(item)) return { value: item, path: itemPath }
    const nested = findFirstArray(item, itemPath, depth + 1)
    if (nested) return nested
  }
  return null
}

module.exports = { parseStructuredFacts, parseResultView, compactRow, findFirstArray }
