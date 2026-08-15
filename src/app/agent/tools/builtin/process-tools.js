const { definition, objectSchema, runStructured, parseTabular } = require('./common')

function registerProcessTools (registry, adapter) {
  registry.register(definition({
    name: 'process.list',
    description: 'List a bounded number of Linux processes with CPU and memory fields.',
    inputSchema: objectSchema({
      query: { type: 'string', maxLength: 200 },
      sort: { enum: ['cpu', 'memory', 'pid'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 }
    }, [])
  }), context => {
    const limit = context.arguments.limit || 50
    const query = String(context.arguments.query || '').trim().toLowerCase()
    const sort = context.arguments.sort === 'memory' ? '-pmem' : context.arguments.sort === 'pid' ? 'pid' : '-pcpu'
    return runStructured(adapter, context, `LC_ALL=C ps -eo pid=,ppid=,user=,pcpu=,pmem=,stat=,comm= --sort=${sort} | head -n 500`, text => {
      const all = parseTabular(text, ['pid', 'ppid', 'user', 'cpu', 'memory', 'state', 'command'])
      const matched = query ? all.filter(item => Object.values(item).some(value => String(value || '').toLowerCase().includes(query))) : all
      return { items: matched.slice(0, limit), totalScanned: all.length, matchedCount: matched.length, query: query || undefined, partial: all.length >= 500 || matched.length > limit }
    })
  })

  registry.register(definition({
    name: 'process.detail',
    description: 'Read bounded details for one positive process id; environment variables are never read.',
    inputSchema: objectSchema({ pid: { type: 'integer', minimum: 1, maximum: 4194304 } }, ['pid'])
  }), context => {
    const pid = context.arguments.pid
    const command = `printf "PID=${pid}\\n"; printf "CMDLINE="; tr "\\0" " " < /proc/${pid}/cmdline 2>/dev/null | head -c 4096; printf "\\nCWD="; readlink /proc/${pid}/cwd 2>/dev/null; printf "\\nSTATUS\\n"; sed -n "1,30p" /proc/${pid}/status 2>/dev/null`
    return runStructured(adapter, context, command)
  })
}

module.exports = { registerProcessTools }
