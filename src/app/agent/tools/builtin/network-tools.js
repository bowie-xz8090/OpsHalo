const { definition, objectSchema, runStructured, parseTabular } = require('./common')

function registerNetworkTools (registry, adapter) {
  registry.register(definition({
    name: 'network.ports',
    description: 'List bounded listening TCP/UDP ports and owning processes.',
    inputSchema: objectSchema({ protocol: { enum: ['tcp', 'udp', 'all'] }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, [])
  }), context => {
    const limit = context.arguments.limit || 100
    const protocol = context.arguments.protocol || 'all'
    return runStructured(adapter, context, '(command -v ss >/dev/null && ss -H -lntup || netstat -lntup 2>/dev/null | tail -n +3) | head -n 500', text => {
      const all = parseTabular(text, ['protocol', 'state', 'recvQ', 'sendQ', 'local', 'peer', 'process'])
      const matched = protocol === 'all' ? all : all.filter(item => String(item.protocol || '').toLowerCase().startsWith(protocol))
      return { items: matched.slice(0, limit), totalScanned: all.length, matchedCount: matched.length, query: protocol === 'all' ? undefined : protocol, partial: all.length >= 500 || matched.length > limit }
    })
  })
  registry.register(definition({
    name: 'network.connections',
    description: 'List a bounded set of current network connections.',
    inputSchema: objectSchema({ state: { type: 'string', maxLength: 40 }, process: { type: 'string', maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 200 } }, [])
  }), context => {
    const limit = context.arguments.limit || 100
    return runStructured(adapter, context, `(command -v ss >/dev/null && ss -H -ntup || netstat -ntup 2>/dev/null | tail -n +3) | head -n ${limit}`, text => ({ items: parseTabular(text, ['protocol', 'state', 'recvQ', 'sendQ', 'local', 'remote', 'process']) }))
  })
}

module.exports = { registerNetworkTools }
