const { definition, objectSchema, shellQuote, runStructured, parseTabular } = require('./common')

const targetSchema = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9_.-]+$' }

function registerDockerTools (registry, adapter) {
  registry.register(definition({
    name: 'docker.list',
    description: 'List a bounded set of containers.',
    inputSchema: objectSchema({ state: { enum: ['all', 'running', 'exited'] }, query: { type: 'string', maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, [])
  }), context => {
    const limit = context.arguments.limit || 100
    const filter = context.arguments.state && context.arguments.state !== 'all' ? `--filter status=${context.arguments.state}` : ''
    const query = String(context.arguments.query || '').trim().toLowerCase()
    return runStructured(adapter, context, `docker ps -a ${filter} --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}" | head -n 500`, text => {
      const all = parseTabular(text, ['id', 'name', 'image', 'state', 'status', 'ports'], /\t/)
      const matched = query ? all.filter(item => [item.id, item.name, item.image, item.state, item.status].some(value => String(value || '').toLowerCase().includes(query))) : all
      return { items: matched.slice(0, limit), totalScanned: all.length, matchedCount: matched.length, query: query || undefined, partial: all.length >= 500 || matched.length > limit }
    })
  })
  registry.register(definition({
    name: 'docker.inspect',
    description: 'Inspect one container with secret environment values redacted by the observation pipeline.',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    inputSchema: objectSchema({ container: targetSchema }, ['container'])
  }), context => runStructured(adapter, context, `docker inspect -- ${shellQuote(context.arguments.container)}`, text => JSON.parse(text)[0] || {}))
  registry.register(definition({
    name: 'docker.nginx_config',
    description: 'Read and validate the effective Nginx configuration from one Docker container with nginx -T.',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    maxRawCaptureBytes: 512 * 1024,
    inputSchema: objectSchema({ container: targetSchema }, ['container'])
  }), context => runStructured(adapter, context, `docker exec -- ${shellQuote(context.arguments.container)} nginx -T 2>&1`, text => ({
    container: context.arguments.container,
    config: String(text).slice(0, 256 * 1024),
    bytes: Buffer.byteLength(String(text), 'utf8'),
    displayTruncated: Buffer.byteLength(String(text), 'utf8') > 256 * 1024
  })))
  registry.register(definition({
    name: 'docker.logs',
    description: 'Read bounded recent logs from one container.',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    inputSchema: objectSchema({ container: targetSchema, sinceMinutes: { type: 'integer', minimum: 1, maximum: 1440 }, tail: { type: 'integer', minimum: 1, maximum: 2000 } }, ['container'])
  }), context => runStructured(adapter, context, `docker logs --timestamps --since ${context.arguments.sinceMinutes || 15}m --tail ${context.arguments.tail || 200} -- ${shellQuote(context.arguments.container)}`))
  registry.register(definition({
    name: 'docker.stats',
    description: 'Capture a bounded no-stream container resource snapshot.',
    costFloor: 'C2',
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    inputSchema: objectSchema({ containers: { type: 'array', minItems: 1, maxItems: 20, items: targetSchema }, samples: { type: 'integer', minimum: 1, maximum: 5 }, intervalSeconds: { type: 'integer', minimum: 1, maximum: 5 } }, ['containers'])
  }), context => {
    const targets = context.arguments.containers.map(shellQuote).join(' ')
    return runStructured(adapter, context, `docker stats --no-stream --format "{{.ID}}\\t{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\\t{{.BlockIO}}\\t{{.PIDs}}" ${targets}`, text => ({ items: parseTabular(text, ['id', 'name', 'cpu', 'memory', 'network', 'block', 'pids'], /\t/) }))
  })
}

module.exports = { registerDockerTools }
