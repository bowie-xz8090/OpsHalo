const { definition, objectSchema, shellQuote, runStructured } = require('./common')

const servicePattern = '^[A-Za-z0-9@_.-]{1,200}$'

function registerServiceTools (registry, adapter) {
  registry.register(definition({
    name: 'service.status',
    description: 'Read bounded status fields for one systemd service.',
    costFloor: 'C0',
    inputSchema: objectSchema({ service: { type: 'string', pattern: servicePattern } }, ['service'])
  }), context => runStructured(adapter, context, `systemctl show --no-pager --property=Id,LoadState,ActiveState,SubState,MainPID,ExecMainStatus -- ${shellQuote(context.arguments.service)}`, parseKeyValues))
  registry.register(definition({
    name: 'service.logs',
    description: 'Read a bounded journal window for one service.',
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 30000,
    inputSchema: objectSchema({
      service: { type: 'string', pattern: servicePattern },
      sinceMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
      maxLines: { type: 'integer', minimum: 1, maximum: 2000 }
    }, ['service'])
  }), context => {
    const since = context.arguments.sinceMinutes || 15
    const lines = context.arguments.maxLines || 200
    return runStructured(adapter, context, `journalctl --no-pager -o short-iso -u ${shellQuote(context.arguments.service)} --since "${since} minutes ago" -n ${lines}`)
  })
}

function parseKeyValues (text) {
  return String(text).split(/\r?\n/).filter(Boolean).reduce((result, line) => {
    const index = line.indexOf('=')
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1)
    return result
  }, {})
}

module.exports = { registerServiceTools, parseKeyValues }
