const crypto = require('crypto')

const DIAGNOSTIC_OR_CHANGE = /为什么|原因|排查|诊断|故障|异常|报错|错误|日志|配置|修改|修复|重启|启动|停止|删除|安装|变更|优化|why|root cause|diagnos|troubleshoot|error|fail|logs?|config|restart|start|stop|delete|remove|install|fix/i
const CHANGE_ONLY = /修改|修复|重启|启动|停止|删除|安装|变更|优化|replace|edit|write|restart|start|stop|delete|remove|install|fix/i
const QUERY_VERB = /查询|查看|列出|有哪些|多少|状态|信息|show|list|find|which|status|info/i

function routeFastQuery (record) {
  const objective = String(record.prompt || '').trim()
  if (!objective) return null
  const nginxConfig = matchNginxConfigRoute(objective)
  if (nginxConfig && !CHANGE_ONLY.test(objective)) return wrapRoute(record, objective, nginxConfig)
  if (DIAGNOSTIC_OR_CHANGE.test(objective) || !QUERY_VERB.test(objective)) return null
  const matched = matchRoute(objective)
  if (!matched) return null
  return wrapRoute(record, objective, matched)
}

function wrapRoute (record, objective, matched) {
  const criterionId = `criterion_${crypto.createHash('sha256').update(`${matched.routeId}:${objective}`).digest('hex').slice(0, 20)}`
  return {
    route: matched,
    decision: {
      schemaVersion: 1,
      goalStatus: 'continue',
      planSummary: matched.planSummary,
      reasonSummary: '这是目标明确的有界只读查询，可直接读取结构化结果。',
      knownFactIds: [],
      missingInformation: [matched.missingInformation],
      expectedObservation: matched.expectedObservation,
      completionCriteria: [{
        criterionId,
        statement: matched.completionStatement,
        critical: true,
        status: 'pending',
        evidenceRefs: []
      }],
      action: {
        schemaVersion: 1,
        invocationId: `invocation_${crypto.randomBytes(18).toString('base64url')}`,
        taskId: record.taskId,
        toolName: matched.toolName,
        toolVersion: '1',
        arguments: matched.arguments,
        target: matched.target,
        purpose: matched.purpose,
        expectedObservation: matched.expectedObservation
      }
    }
  }
}

function matchNginxConfigRoute (objective) {
  if (!/(?:nginx)/i.test(objective) || !/(?:配置|config(?:uration)?)/i.test(objective) || !/(?:docker|容器|container)/i.test(objective)) return null
  const tokens = objective.match(/[A-Za-z0-9][A-Za-z0-9_.-]{0,119}/g) || []
  const stop = new Set(['docker', 'container', 'nginx', 'config', 'configuration', 'show', 'view', 'get', 'cat'])
  const container = tokens.find(token => !stop.has(token.toLowerCase()))
  if (!container) return null
  return route('docker-nginx-config', 'docker.nginx_config', { container }, 'container', container, `Docker 容器 ${container}`, `读取 ${container} 的 Nginx 生效配置`, 'nginx -T 输出、配置校验状态和完整证据', '指定容器的 Nginx 生效配置已有执行证据')
}

function matchRoute (objective) {
  if (/docker|podman|容器|镜像/i.test(objective)) {
    const query = extractSelector(objective, ['docker', 'podman', '容器', '镜像'])
    return route('docker-list', 'docker.list', compact({ state: 'all', limit: 100, query }), 'container', query || 'all-containers', query ? `匹配 ${query} 的容器` : 'Docker 容器', '查询有界 Docker 容器列表', '容器名称、镜像、状态和端口', 'Docker 容器查询已有完整执行证据')
  }
  if (/进程|process|\bpid\b/i.test(objective)) {
    const query = extractSelector(objective, ['进程', 'process', 'pid'])
    return route('process-list', 'process.list', compact({ query, sort: 'cpu', limit: 100 }), 'process', query || 'all-processes', query ? `匹配 ${query} 的进程` : '进程列表', '查询有界进程列表', '进程 ID、用户、CPU、内存和命令', '进程查询已有完整执行证据')
  }
  if (/端口|监听|ports?|listen/i.test(objective)) {
    return route('network-ports', 'network.ports', { protocol: protocolFor(objective), limit: 100 }, 'port', 'listening-ports', '监听端口', '查询有界监听端口', '协议、本地地址、端口和进程', '监听端口查询已有完整执行证据')
  }
  if (/主机|系统信息|系统概况|内核|运行时间|host profile|system info|kernel|uptime/i.test(objective)) {
    return route('host-profile', 'host.profile', { sections: ['os', 'kernel', 'uptime', 'memory', 'disk', 'facilities'] }, 'host', 'current-host', '当前主机', '读取有界主机概况', '操作系统、内核、运行时间、内存和磁盘摘要', '主机概况已有完整执行证据')
  }
  const service = extractService(objective)
  if (service) {
    return route('service-status', 'service.status', { service }, 'service', service, `服务 ${service}`, `查询 ${service} 服务状态`, '加载、活动、子状态和主进程', '服务状态查询已有完整执行证据')
  }
  return null
}

function route (routeId, toolName, args, kind, canonicalId, display, purpose, expectedObservation, completionStatement) {
  return {
    routeId,
    toolName,
    arguments: args,
    target: { kind, canonicalId, display },
    purpose,
    expectedObservation,
    completionStatement,
    missingInformation: expectedObservation,
    planSummary: purpose
  }
}

function extractSelector (objective, domainWords) {
  const afterRelation = /(?:中的?|里面的?|里的?|包含|匹配|名称为|名为|named|matching|containing|with)\s*([A-Za-z0-9_.@-]{1,120})/i.exec(objective)
  if (afterRelation) return afterRelation[1]
  const ascii = objective.match(/[A-Za-z][A-Za-z0-9_.@-]{1,119}/g) || []
  const stop = new Set([...domainWords.map(item => item.toLowerCase()), 'show', 'list', 'find', 'status', 'info', 'which', 'all'])
  return ascii.map(item => item.toLowerCase()).find(item => !stop.has(item))
}

function extractService (objective) {
  let match = /(?:查询|查看|显示)?\s*([A-Za-z0-9@_.-]{1,120})\s*(?:服务|service)\s*(?:的)?\s*(?:状态|status)/i.exec(objective)
  if (match) return match[1]
  match = /(?:service)\s+([A-Za-z0-9@_.-]{1,120})\s+(?:status)/i.exec(objective)
  return match?.[1]
}

function protocolFor (objective) {
  if (/\btcp\b/i.test(objective)) return 'tcp'
  if (/\budp\b/i.test(objective)) return 'udp'
  return 'all'
}

function compact (value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''))
}

module.exports = { DIAGNOSTIC_OR_CHANGE, CHANGE_ONLY, QUERY_VERB, routeFastQuery, matchRoute, matchNginxConfigRoute, extractSelector, extractService }
