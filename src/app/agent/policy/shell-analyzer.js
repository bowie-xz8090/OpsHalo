const { matchBuiltinDeny } = require('./builtin-deny-rules')

const knownReadCommands = new Set(['cat', 'grep', 'egrep', 'fgrep', 'head', 'tail', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'ps', 'pgrep', 'ss', 'netstat', 'lsof', 'df', 'du', 'free', 'uptime', 'uname', 'id', 'whoami', 'hostname', 'date', 'stat', 'ls', 'find', 'journalctl', 'systemctl', 'docker', 'podman', 'ip', 'env', 'printenv', 'readlink', 'realpath'])
const networkCommands = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'rsync', 'telnet', 'ftp'])
const interactiveCommands = new Set(['vim', 'vi', 'nano', 'emacs', 'less', 'more', 'top', 'htop', 'watch', 'man', 'ssh', 'sftp', 'ftp'])
const mutationCommands = new Set(['rm', 'rmdir', 'mv', 'cp', 'install', 'mkdir', 'touch', 'truncate', 'chmod', 'chown', 'chgrp', 'kill', 'pkill', 'killall', 'reboot', 'shutdown', 'poweroff', 'mount', 'umount', 'apt', 'apt-get', 'dnf', 'yum', 'apk', 'pacman', 'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel'])

function tokenize (command) {
  const tokens = []
  let token = ''
  let quote = null
  let escaped = false
  let parseComplete = true
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      token += char
      escaped = true
      continue
    }
    if (quote) {
      token += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      token += char
      continue
    }
    if (/\s/.test(char)) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    if ('|;&()<>'.includes(char)) {
      if (token) tokens.push(token)
      token = ''
      const next = command[i + 1]
      if ((char === '|' || char === '&' || char === '>' || char === '<') && next === char) {
        tokens.push(char + next)
        i++
      } else {
        tokens.push(char)
      }
      continue
    }
    token += char
  }
  if (token) tokens.push(token)
  if (quote || escaped) parseComplete = false
  return { tokens, parseComplete }
}

function commandNames (tokens) {
  const names = []
  let expectsCommand = true
  for (const raw of tokens) {
    if (['|', '||', '&&', ';', '&', '('].includes(raw)) {
      expectsCommand = true
      continue
    }
    if (!expectsCommand || ['>', '>>', '<', '<<'].includes(raw) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue
    const clean = raw.replace(/^['"]|['"]$/g, '')
    names.push(clean.split('/').pop())
    expectsCommand = false
  }
  return names
}

function analyzeShell (command) {
  const raw = String(command || '')
  const { tokens, parseComplete } = tokenize(raw)
  const names = commandNames(tokens)
  const denyMatches = matchBuiltinDeny(raw)
  const hasWriteRedirect = tokens.some(token => token === '>' || token === '>>')
  const substitutions = []
  if (/`|\$\(/.test(raw)) substitutions.push('command')
  if (/<\(|>\(/.test(raw)) substitutions.push('process')
  if (/\$\{/.test(raw)) substitutions.push('parameter')
  const pipelines = tokens.filter(token => token === '|').length
  const background = tokens.includes('&') || /&\s*$/.test(raw)
  const privilegeSignals = names.filter(name => ['sudo', 'su', 'doas'].includes(name))
  const interactiveSignals = names.filter(name => interactiveCommands.has(name))
  if (/\b(?:tail\s+-f|journalctl\s+-f|docker\s+logs\s+-f)\b/i.test(raw)) interactiveSignals.push('continuous_follow')
  const networkTargets = names.filter(name => networkCommands.has(name))
  const mutationSignals = names.filter(name => mutationCommands.has(name))
  if (/\bfind\b[^\n]*(?:-delete|-exec(?:dir)?\s+(?:rm|mv|cp|chmod|chown|shred)\b)/i.test(raw)) mutationSignals.push('find_change')
  if (/\b(?:xargs|command|env|nohup|timeout)\b[^\n]*\b(?:rm|rmdir|mv|cp|install|truncate|chmod|chown|kill|pkill|reboot|shutdown|mount|umount)\b/i.test(raw)) mutationSignals.push('wrapped_change')
  if (/\bsed\s+[^\n]*-(?:[^\s]*i|i[^\s]*)\b/.test(raw)) mutationSignals.push('sed_in_place')
  if (/\b(?:systemctl|service)\s+(?:restart|start|stop|reload|enable|disable|mask|unmask)\b/i.test(raw)) mutationSignals.push('service_change')
  if (/\b(?:docker|podman)\s+(?:rm|rmi|restart|stop|start|kill|exec|run|compose\s+(?:up|down))\b/i.test(raw)) mutationSignals.push('container_change')
  if (/\b(?:kubectl|helm)\s+(?:apply|delete|patch|replace|scale|rollout|upgrade|install|uninstall)\b/i.test(raw)) mutationSignals.push('cluster_change')
  const sensitiveRead = /(?:\/etc\/(?:shadow|gshadow)|\.ssh\/(?:id_|authorized_keys)|\.aws\/credentials|\.kube\/config|(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[=:])/i.test(raw)
  const unknownCommands = names.filter(name => !knownReadCommands.has(name) && !networkCommands.has(name) && !mutationCommands.has(name) && !['sudo', 'su', 'doas', 'sh', 'bash', 'zsh'].includes(name))
  let risk = 'R1'
  const sensitivity = sensitiveRead ? 'S3' : 'S1'
  let cost = 'C1'
  const reasons = []
  if (!raw.trim() || raw.length > 8000) reasons.push(reason('invalid_command', '命令为空或超过长度限制。'))
  if (!parseComplete || substitutions.length || /\b(?:eval|sh|bash|zsh)\s+-c\b/.test(raw) || /<<-?/.test(raw)) {
    risk = mutationSignals.length || hasWriteRedirect ? 'R3' : 'R2'
    reasons.push(reason('complex_shell', '复杂 Shell 语义无法作为普通只读命令自动执行。'))
  }
  if (unknownCommands.length) {
    risk = maxRisk(risk, 'R2')
    reasons.push(reason('unknown_command', `存在未知命令：${unknownCommands.join(', ')}`))
  }
  if (pipelines || tokens.some(token => token === ';' || token === '&&' || token === '||')) {
    risk = maxRisk(risk, 'R2')
    reasons.push(reason('compound_command', '包含管道或多命令组合。'))
  }
  if (hasWriteRedirect || mutationSignals.length || background) {
    risk = maxRisk(risk, 'R3')
    reasons.push(reason('mutation_signal', '命令包含写入、状态变更或后台执行语义。'))
  }
  if (networkTargets.length) {
    risk = maxRisk(risk, 'R2')
    reasons.push(reason('network_access', '命令会访问网络目标。'))
  }
  if (privilegeSignals.length) {
    risk = maxRisk(risk, 'R4')
    reasons.push(reason('privilege_escalation', '命令包含提权语义。'))
  }
  if (interactiveSignals.length) {
    risk = maxRisk(risk, 'R3')
    reasons.push(reason('interactive_required', '命令需要交互或可能持续运行。'))
  }
  if (sensitiveRead) {
    risk = maxRisk(risk, networkTargets.length ? 'R4' : 'R2')
    reasons.push(reason('sensitive_data', '命令可能读取高敏感信息。'))
  }
  if (denyMatches.length) {
    risk = 'R5'
    reasons.push(...denyMatches.map(match => reason(match.id, match.message)))
  }
  if (/\b(?:find\s+\/|du\s+-[a-z]*s?\s+\/|docker\s+stats\s+(?:--no-stream\s+)?$)/i.test(raw)) {
    cost = 'C2'
    reasons.push(reason('broad_scope', '查询范围可能显著消耗资源。'))
  }
  const bounded = parseComplete && !substitutions.length && !background && !interactiveSignals.length && !unknownCommands.length && !hasWriteRedirect && !mutationSignals.length && pipelines === 0 && raw.length <= 8000
  return {
    parser: 'fallback_tokens',
    parseComplete,
    commands: names.map(name => ({ name, argv: [], resolvedClass: knownReadCommands.has(name) ? 'read' : networkCommands.has(name) ? 'network' : mutationCommands.has(name) ? 'change' : 'unknown' })),
    pipelines,
    redirections: tokens.filter(token => ['>', '>>', '<', '<<'].includes(token)).map(operator => ({ operator, targetClass: operator.startsWith('>') ? 'write' : 'read' })),
    substitutions,
    background,
    interactiveSignals,
    networkTargets,
    filesystemTargets: tokens.filter(token => /^['"]?\//.test(token)),
    privilegeSignals,
    dataFlow: networkTargets.length && sensitiveRead ? [{ from: 'sensitive_local', to: 'network', external: true }] : [],
    riskSignals: reasons,
    risk,
    sensitivity,
    cost,
    bounded,
    denyRuleIds: denyMatches.map(match => match.id)
  }
}

function reason (code, message) {
  return { code, message, source: code === 'sensitive_data' ? 'sensitivity' : code === 'broad_scope' ? 'cost' : code.startsWith('destroy') || code.includes('overwrite') || code.includes('format') ? 'builtin_rule' : 'shell_analysis' }
}

function maxRisk (a, b) {
  return ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].indexOf(a) > ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].indexOf(b) ? a : b
}

module.exports = { analyzeShell, tokenize, commandNames, knownReadCommands }
