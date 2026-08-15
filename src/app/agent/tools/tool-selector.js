const DOMAIN_RULES = Object.freeze([
  { pattern: /docker|podman|container|容器|镜像/i, prefixes: ['docker.'] },
  { pattern: /service|systemd|服务|守护进程/i, prefixes: ['service.'] },
  { pattern: /process|进程|pid|cpu|内存|memory/i, prefixes: ['process.', 'metrics.', 'host.'] },
  { pattern: /port|listen|socket|network|连接|端口|监听|网络/i, prefixes: ['network.'] },
  { pattern: /log|journal|日志/i, prefixes: ['service.logs', 'docker.logs', 'filesystem.read_limited', 'config.read_limited'] },
  { pattern: /file|directory|path|配置|文件|目录|路径|conf/i, prefixes: ['filesystem.', 'config.'] },
  { pattern: /host|system|kernel|uptime|disk|主机|系统|内核|磁盘|负载/i, prefixes: ['host.', 'metrics.', 'process.'] }
])

function selectPublicTools (descriptors, context = {}, maxTools = 8) {
  if (!Array.isArray(descriptors) || descriptors.length <= maxTools) return descriptors || []
  const text = [
    context.objective,
    ...(context.missingInformation || []),
    context.latestError?.safeMessage,
    ...(context.adaptationHints || []).map(item => `${item.code || ''} ${item.suggestedTool || ''}`)
  ].filter(Boolean).join(' ')
  const wanted = new Set(['session.describe'])
  for (const rule of DOMAIN_RULES) {
    if (!rule.pattern.test(text)) continue
    for (const descriptor of descriptors) {
      if (rule.prefixes.some(prefix => descriptor.name === prefix || descriptor.name.startsWith(prefix))) wanted.add(descriptor.name)
    }
  }
  for (const hint of context.adaptationHints || []) {
    if (hint.suggestedTool) wanted.add(hint.suggestedTool)
  }
  if (!wanted.size || wanted.size === 1) {
    for (const name of ['host.profile', 'process.list', 'network.ports', 'service.status', 'docker.list', 'filesystem.list']) wanted.add(name)
  }
  wanted.add('shell.exec')
  const scored = descriptors.map((descriptor, index) => ({
    descriptor,
    index,
    score: wanted.has(descriptor.name) ? 100 : DOMAIN_RULES.reduce((score, rule) => score + (rule.pattern.test(text) && rule.prefixes.some(prefix => descriptor.name.startsWith(prefix)) ? 20 : 0), 0)
  }))
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxTools)
    .map(item => item.descriptor)
}

module.exports = { DOMAIN_RULES, selectPublicTools }
