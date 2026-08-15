const { definition, objectSchema, runStructured } = require('./common')

function registerHostTools (registry, adapter) {
  registry.register(definition({
    name: 'host.profile',
    description: 'Read a bounded Linux host profile: OS, kernel, uptime, memory and disk summary.',
    inputSchema: objectSchema({ sections: { type: 'array', maxItems: 6, items: { enum: ['os', 'kernel', 'uptime', 'memory', 'disk', 'facilities'] } } }, [])
  }), context => runStructured(adapter, context, 'printf "OS="; (grep -E "^(PRETTY_NAME|NAME)=" /etc/os-release 2>/dev/null | head -n1 || uname -s); printf "KERNEL="; uname -sr; printf "UPTIME="; uptime -p 2>/dev/null || uptime; printf "MEMORY="; (free -b 2>/dev/null | head -n2 | tail -n1 || true); printf "DISK="; df -Pk / 2>/dev/null | tail -n1; printf "FACILITIES="; command -v systemctl docker podman ss journalctl 2>/dev/null | tr "\\n" ","', parseHost))
}

function parseHost (text) {
  const data = {}
  for (const line of String(text).split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index > 0) data[line.slice(0, index).toLowerCase()] = line.slice(index + 1).replace(/^['"]|['"]$/g, '')
  }
  return data
}

module.exports = { registerHostTools, parseHost }
