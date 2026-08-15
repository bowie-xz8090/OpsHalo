function parseJsonLines (text) {
  if (!text) {
    return []
  }
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce((items, line) => {
      try {
        items.push(JSON.parse(line))
      } catch (error) {
        // Ignore Docker warnings or other non-JSON output.
      }
      return items
    }, [])
}

function normalizeName (name = '') {
  return name.replace(/^\//, '')
}

function formatStatus (state = {}) {
  const status = state.Status || ''
  const health = state.Health?.Status
  return health ? `${status} (${health})` : status
}

function formatPorts (inspect = {}) {
  const sources = [
    inspect.HostConfig?.PortBindings,
    inspect.NetworkSettings?.Ports
  ]
  const ports = new Set()
  for (const source of sources) {
    for (const [containerPort, bindings] of Object.entries(source || {})) {
      for (const binding of bindings || []) {
        const hostPort = binding.HostPort
        if (!hostPort) {
          continue
        }
        const hostIp = binding.HostIp && binding.HostIp !== '0.0.0.0'
          ? binding.HostIp
          : ''
        const formattedIp = hostIp.includes(':') ? `[${hostIp}]` : hostIp
        const host = formattedIp ? `${formattedIp}:${hostPort}` : hostPort
        ports.add(`${host}->${containerPort}`)
      }
    }
  }
  return Array.from(ports).join(', ')
}

function findStats (stats, id, name) {
  return stats.find(item => {
    const statsId = item.ID || item.Container || ''
    const idMatches = Boolean(id && statsId) && (
      statsId === id || id.startsWith(statsId) || statsId.startsWith(id)
    )
    return idMatches ||
      normalizeName(item.Name) === name
  }) || {}
}

export default function formatDockers (inspectText, statsText) {
  const inspections = parseJsonLines(inspectText)
  const stats = parseJsonLines(statsText)
  const dockers = inspections.map(inspect => {
    const fullId = inspect.Id || inspect.ID || ''
    const name = normalizeName(inspect.Name || '')
    const usage = findStats(stats, fullId, name)
    const labels = inspect.Config?.Labels || {}
    return {
      name,
      containerId: fullId.slice(0, 12),
      fullId,
      image: inspect.Config?.Image || inspect.Image || '',
      status: formatStatus(inspect.State),
      ports: formatPorts(inspect),
      cpu: usage.CPUPerc || '',
      mem: usage.MemPerc || '',
      created: inspect.Created || '',
      lastStarted: inspect.State?.StartedAt || '',
      restartCount: inspect.RestartCount ?? 0,
      workingDir: labels['com.docker.compose.project.working_dir'] || '',
      configFiles: labels['com.docker.compose.project.config_files'] || ''
    }
  }).filter(item => item.fullId || item.name)
  return { dockers }
}
