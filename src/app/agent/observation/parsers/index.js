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

function parseGenericFacts (text, evidenceRef) {
  const source = String(text || '')
  const listeningPorts = parseListeningPortsInspection(source)
  if (listeningPorts) {
    return [{
      statement: `发现 ${listeningPorts.length} 个监听端口。`,
      confidence: 'observed',
      evidenceRef,
      sourcePath: '$.listeningPorts',
      parserId: 'network.listening-ports.v1'
    }]
  }
  const nginxInspection = parseNginxInspection(source)
  if (nginxInspection) {
    const facts = []
    if (nginxInspection.syntaxOk) facts.push(nginxFact('Nginx 配置语法检查通过。', evidenceRef, '$.syntaxOk'))
    if (nginxInspection.configPath) facts.push(nginxFact(`Nginx 主配置文件为 ${nginxInspection.configPath}。`, evidenceRef, '$.configPath'))
    if (nginxInspection.includes?.length) facts.push(nginxFact(`主配置引用：${nginxInspection.includes.join('、')}。`, evidenceRef, '$.includes'))
    if (nginxInspection.files?.length) facts.push(nginxFact(`发现 ${nginxInspection.files.length} 个 Nginx 站点配置文件。`, evidenceRef, '$.files'))
    if (facts.length) return facts
  }
  const lines = source.split(/\r?\n/)
  const facts = []
  let offset = 0
  for (const line of lines) {
    const trimmed = line.trim()
    const start = offset
    const end = start + Buffer.byteLength(line, 'utf8')
    offset = end + 1
    if (!trimmed || trimmed.length > 1000) continue
    const pair = /^([A-Za-z][A-Za-z0-9 _./()-]{0,80})\s*[:=]\s*(.+)$/.exec(trimmed)
    if (pair && !isSensitiveKey(pair[1])) {
      facts.push({
        statement: `${pair[1].trim()}=${pair[2].trim().slice(0, 500)}`,
        confidence: 'observed',
        evidenceRef,
        sourcePath: `line:${facts.length + 1}`,
        parserId: 'generic.key-value.v1',
        evidenceRange: { start, end }
      })
      if (facts.length >= 20) break
    }
  }
  if (facts.length) return facts
  const nonEmpty = lines.map((line, index) => ({ line: line.trim(), index })).filter(item => item.line)
  const table = parseTextTable(nonEmpty)
  if (table) {
    const first = nonEmpty[0]
    const last = nonEmpty[Math.min(nonEmpty.length - 1, 10)]
    const start = byteOffsetForLine(lines, first.index)
    const end = byteOffsetForLine(lines, last.index) + Buffer.byteLength(lines[last.index], 'utf8')
    return [{
      statement: `命令返回 ${table.rowCount} 条表格记录，列为 ${table.columns.join('、')}；样本：${table.samples.join('；')}`.slice(0, 1800),
      confidence: 'observed',
      evidenceRef,
      sourcePath: 'table',
      parserId: 'generic.table.v1',
      evidenceRange: { start, end }
    }]
  }
  const error = nonEmpty.find(item => /\b(?:error|failed|failure|fatal|denied|not found|timeout)\b|错误|失败|拒绝|超时/i.test(item.line))
  if (!error && nonEmpty.length === 1 && nonEmpty[0].line.length <= 700) {
    const item = nonEmpty[0]
    const start = byteOffsetForLine(lines, item.index)
    return [{
      statement: `命令输出：${item.line}`,
      confidence: 'observed',
      evidenceRef,
      sourcePath: `line:${item.index + 1}`,
      parserId: 'generic.scalar.v1',
      evidenceRange: { start, end: start + Buffer.byteLength(lines[item.index], 'utf8') }
    }]
  }
  if (!error) return []
  const start = byteOffsetForLine(lines, error.index)
  return [{
    statement: `输出包含待验证错误线索：${error.line.slice(0, 700)}`,
    confidence: 'inferred',
    evidenceRef,
    sourcePath: `line:${error.index + 1}`,
    parserId: 'generic.error-clue.v1',
    evidenceRange: { start, end: start + Buffer.byteLength(lines[error.index], 'utf8') }
  }]
}

function parseTextTable (items) {
  if (items.length < 2) return null
  const split = value => value.split(/\t+|\s{2,}/).map(item => item.trim()).filter(Boolean)
  const columns = split(items[0].line)
  if (columns.length < 2 || columns.length > 20) return null
  const rows = items.slice(1, 11).map(item => split(item.line)).filter(row => row.length >= Math.min(2, columns.length))
  if (!rows.length) return null
  return {
    columns: columns.map(item => item.slice(0, 80)),
    rowCount: Math.max(0, items.length - 1),
    samples: rows.slice(0, 3).map(row => row.slice(0, columns.length).join(' | ').slice(0, 300))
  }
}

function byteOffsetForLine (lines, target) {
  let value = 0
  for (let index = 0; index < target; index++) value += Buffer.byteLength(lines[index], 'utf8') + 1
  return value
}

function isSensitiveKey (value) {
  return /password|passwd|secret|token|api[_ -]?key|private[_ -]?key|cookie|authorization/i.test(String(value || ''))
}

function parseResultView (toolName, text) {
  if (toolName === 'shell.review_exec') {
    const listeningPorts = parseListeningPortsInspection(text)
    if (listeningPorts) {
      const rows = listeningPorts.slice(0, 30)
      return {
        kind: 'list',
        columns: ['protocol', 'state', 'local', 'peer', 'process'],
        rows,
        totalScanned: listeningPorts.length,
        matchedCount: listeningPorts.length,
        query: 'listening-ports',
        partial: false,
        displayTruncated: listeningPorts.length > rows.length
      }
    }
    const inspection = parseNginxInspection(text)
    if (inspection) {
      const row = Object.entries(inspection).reduce((result, [key, value]) => {
        if (value === undefined) return result
        result[key] = Array.isArray(value) ? value.join('\n') : value
        return result
      }, {})
      return {
        kind: 'record',
        columns: Object.keys(row),
        rows: [row],
        totalScanned: 1,
        matchedCount: 1,
        query: inspection.kind,
        partial: false,
        displayTruncated: inspection.keyDirectives?.length >= 300
      }
    }
  }
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

function parseListeningPortsInspection (text) {
  const source = String(text || '')
  if (!source.includes('---LISTENING PORTS---')) return null
  const output = source.split('---LISTENING PORTS---').slice(1).join('---LISTENING PORTS---')
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const fields = line.split(/\s+/)
    if (fields.length < 5) return null
    const hasState = !/^\d+$/.test(fields[1])
    return {
      protocol: fields[0],
      state: hasState ? fields[1] : '',
      local: fields[hasState ? 4 : 3] || '',
      peer: fields[hasState ? 5 : 4] || '',
      process: fields.slice(hasState ? 6 : 5).join(' ')
    }
  }).filter(item => item?.protocol && item.local)
}

function parseNginxInspection (text) {
  const source = String(text || '')
  if (source.includes('---CONFIG PATH---') && source.includes('---MAIN CONFIG---')) {
    const [beforePath, remainder = ''] = source.split('---CONFIG PATH---')
    const [pathPart, config = ''] = remainder.split('---MAIN CONFIG---')
    const configPath = pathPart.split(/\r?\n/).map(line => line.trim()).find(line => /^\/[^\s]+$/.test(line)) || '/etc/nginx/nginx.conf'
    return {
      kind: 'main-config',
      syntaxOk: /syntax is ok|test is successful/i.test(beforePath),
      configPath,
      user: directive(config, 'user'),
      workerProcesses: directive(config, 'worker_processes'),
      errorLog: directive(config, 'error_log'),
      pid: directive(config, 'pid'),
      includes: directives(config, 'include', 12),
      listen: directives(config, 'listen', 12),
      serverNames: directives(config, 'server_name', 12)
    }
  }
  if (source.includes('---INCLUDED CONFIGS---') && source.includes('---KEY DIRECTIVES---')) {
    const [, remainder = ''] = source.split('---INCLUDED CONFIGS---')
    const [filesPart, directivesPart = ''] = remainder.split('---KEY DIRECTIVES---')
    return {
      kind: 'included-configs',
      files: filesPart.split(/\r?\n/).map(line => line.trim()).filter(line => /^\/etc\/nginx\/conf\.d\/[^/]+\.conf$/.test(line)).slice(0, 100),
      keyDirectives: directivesPart.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 300)
    }
  }
  return null
}

function directive (config, name) {
  return directives(config, name, 1)[0]
}

function directives (config, name, limit) {
  const pattern = new RegExp(`^\\s*${name}\\s+(.+?);\\s*$`, 'i')
  return String(config || '').split(/\r?\n/).map(line => pattern.exec(line)?.[1]?.trim()).filter(Boolean).slice(0, limit)
}

function nginxFact (statement, evidenceRef, sourcePath) {
  return { statement, confidence: 'observed', evidenceRef, sourcePath, parserId: 'nginx.inspect.v1' }
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

module.exports = { parseStructuredFacts, parseGenericFacts, parseTextTable, parseResultView, parseNginxInspection, parseListeningPortsInspection, compactRow, findFirstArray }
