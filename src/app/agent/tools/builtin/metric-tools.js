const { definition, objectSchema, runStructured } = require('./common')

function registerMetricTools (registry, adapter) {
  registry.register(definition({
    name: 'metrics.snapshot',
    description: 'Capture bounded CPU, load, memory, disk and top-process metrics.',
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    inputSchema: objectSchema({ sections: { type: 'array', maxItems: 5, items: { enum: ['load', 'cpu', 'memory', 'disk', 'network'] } }, durationSeconds: { type: 'integer', minimum: 1, maximum: 30 }, intervalSeconds: { type: 'integer', minimum: 1, maximum: 5 } }, [])
  }), context => runStructured(adapter, context, 'printf "LOAD\\n"; cat /proc/loadavg 2>/dev/null; printf "MEMORY\\n"; free -b 2>/dev/null; printf "DISK\\n"; df -Pk / 2>/dev/null; printf "TOP\\n"; LC_ALL=C ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu | head -n 11'))
}

module.exports = { registerMetricTools }
