const { definition, objectSchema, shellQuote, runStructured, parseTabular } = require('./common')

function registerFilesystemTools (registry, adapter) {
  registry.register(definition({
    name: 'filesystem.list',
    description: 'List one normalized directory without recursion.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: { type: 'integer', minimum: 0, maximum: 100000 } }, ['path'])
  }), context => {
    const limit = context.arguments.limit || 100
    const offset = context.arguments.cursor || 0
    const command = `find ${shellQuote(context.arguments.path)} -mindepth 1 -maxdepth 1 -printf "%f\\t%y\\t%s\\t%T@\\t%m\\n" 2>/dev/null | sort | tail -n +${offset + 1} | head -n ${limit}`
    return runStructured(adapter, context, command, text => ({ items: parseTabular(text, ['name', 'type', 'size', 'mtime', 'mode'], /\t/), nextCursor: offset + limit }))
  })
  registry.register(definition({
    name: 'filesystem.stat',
    description: 'Read metadata for one normalized filesystem path.',
    inputSchema: objectSchema({ path: { type: 'string', minLength: 1, maxLength: 4096 } }, ['path'])
  }), context => runStructured(adapter, context, `stat -Lc "type=%F\\nsize=%s\\nmode=%a\\nowner=%U:%G\\nmtime=%y" -- ${shellQuote(context.arguments.path)}`))
  registry.register(definition({
    name: 'filesystem.read_limited',
    description: 'Read a byte-bounded range from one regular file. Device paths and known secret files require stricter policy.',
    inputSchema: objectSchema({
      path: { type: 'string', minLength: 1, maxLength: 4096 },
      offset: { type: 'integer', minimum: 0, maximum: 1073741824 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 262144 }
    }, ['path'])
  }), context => {
    const bytes = context.arguments.maxBytes || 65536
    const offset = context.arguments.offset || 0
    const command = `test -f ${shellQuote(context.arguments.path)} && dd if=${shellQuote(context.arguments.path)} bs=1 skip=${offset} count=${bytes} status=none`
    return runStructured(adapter, context, command, text => ({ text, offset, returnedBytes: Buffer.byteLength(text, 'utf8'), truncated: Buffer.byteLength(text, 'utf8') >= bytes }))
  })
}

module.exports = { registerFilesystemTools }
