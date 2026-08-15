const commandStartTokens = new Set([
  'alias',
  'awk',
  'basename',
  'bash',
  'bun',
  'cat',
  'cd',
  'chmod',
  'chown',
  'clear',
  'cmp',
  'comm',
  'cp',
  'curl',
  'date',
  'df',
  'diff',
  'dig',
  'docker',
  'docker-compose',
  'du',
  'echo',
  'env',
  'export',
  'fd',
  'find',
  'free',
  'git',
  'grep',
  'gunzip',
  'gzip',
  'head',
  'history',
  'htop',
  'ifconfig',
  'ip',
  'journalctl',
  'kill',
  'kubectl',
  'less',
  'ln',
  'ls',
  'lsof',
  'make',
  'mkdir',
  'mv',
  'nc',
  'netstat',
  'node',
  'npm',
  'npx',
  'nslookup',
  'openssl',
  'ping',
  'pnpm',
  'ps',
  'pwd',
  'python',
  'python3',
  'redis-cli',
  'rm',
  'rsync',
  'scp',
  'sed',
  'service',
  'sh',
  'sort',
  'ssh',
  'stat',
  'sudo',
  'systemctl',
  'tail',
  'tar',
  'tee',
  'top',
  'touch',
  'tr',
  'tree',
  'uname',
  'uniq',
  'unzip',
  'vim',
  'vi',
  'watch',
  'wc',
  'wget',
  'which',
  'whoami',
  'xargs',
  'yarn',
  'zip'
])

const shellKeywords = new Set([
  'case',
  'do',
  'done',
  'elif',
  'else',
  'fi',
  'for',
  'function',
  'if',
  'select',
  'then',
  'until',
  'while'
])

const riskRank = {
  read_only: 0,
  changes_files: 1,
  network: 2,
  privileged: 3,
  destructive: 4,
  unknown: 5
}

const smartShellSkillProfiles = {
  git: {
    label: 'git',
    description: 'Git / repository workflow',
    instructions: [
      'Prefer read-only inspection first: git status --short --branch, git log --oneline --decorate -n 5, git diff --stat.',
      'If the user asks to change branches, merge, rebase, reset, or commit, explain the impact briefly and prefer the smallest safe command.',
      'Use the current repository root and branch from context when available.'
    ]
  },
  docker: {
    label: 'docker',
    description: 'Docker / container workflow',
    instructions: [
      'Prefer inspection commands first: docker ps, docker images, docker compose ps, docker logs, docker inspect.',
      'Avoid destructive cleanup unless the user explicitly asks for it.',
      'Mention whether the command targets docker compose, a container, or an image.'
    ]
  },
  node: {
    label: 'node',
    description: 'Node.js / package-manager workflow',
    instructions: [
      'Prefer package-aware commands: inspect package.json scripts, lockfiles, and the active package manager before suggesting installs.',
      'Choose npm, pnpm, yarn, or bun based on the context and installed tools.',
      'When debugging, favor read-only commands such as node -v, npm run, npm ls, pnpm why, or yarn why.'
    ]
  },
  sftp: {
    label: 'sftp',
    description: 'SFTP / file-sync workflow',
    instructions: [
      'Focus on safe file listing, editing, syncing, permission checks, and path resolution.',
      'Prefer commands that verify the target path before changing it.',
      'When editing remote files, keep the workflow explicit and cautious.'
    ]
  },
  linux: {
    label: 'linux',
    description: 'General Linux shell workflow',
    instructions: [
      'Prefer standard POSIX/Linux commands and keep the command short and executable.',
      'When the request is broad or ambiguous, propose a read-only discovery command first.',
      'Never mix the user’s natural language into the shell command.'
    ]
  }
}

const smartShellHistoryLimit = 12
const smartShellTailCharLimit = 3200

function hasNaturalLanguageCue (line) {
  return /(?:请|帮|帮我|一下|看看|查看|分析|说明|为什么|怎么|如何|能不能|是否|给我|推荐|建议|处理|修复|排查|查一下|确认|总结|比较)/.test(line)
}

function clampText (text, limit = 400) {
  const value = String(text || '').trim()
  if (!value) {
    return ''
  }
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function compactList (items, limit = smartShellHistoryLimit) {
  if (!Array.isArray(items)) {
    return []
  }
  return items
    .filter(Boolean)
    .slice(-limit)
}

function takeList (items, limit = smartShellHistoryLimit) {
  if (!Array.isArray(items)) {
    return []
  }
  return items
    .filter(Boolean)
    .slice(0, limit)
}

function redactShellSecrets (text) {
  const value = String(text || '')
  if (!value) {
    return value
  }
  return value
    .replace(/(--?(?:password|pass|token|secret|api[-_]?key|access[-_]?key|private[-_]?key)(?:=|\s+))([^\s"'`]+)/gi, '$1[redacted]')
    .replace(/(PASSWORD|PASS|TOKEN|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY)\s*=\s*([^\s"'`]+)/gi, '$1=[redacted]')
    .replace(/(Authorization:\s*Bearer\s+)([^\s"'`]+)/gi, '$1[redacted]')
}

function normalizeSkillKey (skill) {
  const key = String(skill || '').trim().toLowerCase()
  return smartShellSkillProfiles[key] ? key : 'linux'
}

function summarizeSkill (skill) {
  const normalized = normalizeSkillKey(skill)
  return smartShellSkillProfiles[normalized]
}

function normalizeHistoryEntry (entry) {
  if (!entry) {
    return null
  }
  const raw = typeof entry === 'string' ? { prompt: entry } : entry
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map(note => clampText(redactShellSecrets(note), 180)).filter(Boolean)
    : []
  return {
    id: raw.id || '',
    source: raw.source || raw.kind || 'manual',
    status: raw.status || raw.state || '',
    prompt: clampText(redactShellSecrets(raw.prompt || raw.request || ''), 420),
    command: clampText(redactShellSecrets(raw.command || raw.editableCommand || ''), 420),
    message: clampText(redactShellSecrets(raw.message || raw.response || ''), 260),
    cwd: clampText(raw.cwd || '', 220),
    host: clampText(raw.host || '', 160),
    tabType: clampText(raw.tabType || raw.type || '', 80),
    risk: raw.risk || 'unknown',
    skill: normalizeSkillKey(raw.skill || raw.selectedSkill || ''),
    notes,
    timestamp: raw.timestamp || raw.ts || raw.createdAt || raw.executedAt || 0,
    executedAt: raw.executedAt || '',
    rejectedAt: raw.rejectedAt || ''
  }
}

function normalizeRuntimeProbe (probe) {
  if (!probe || typeof probe !== 'object') {
    return null
  }
  const git = probe.git && typeof probe.git === 'object'
    ? {
        root: clampText(probe.git.root || '', 240),
        branch: clampText(probe.git.branch || '', 160),
        status: takeList(probe.git.status || [], 12).map(line => clampText(redactShellSecrets(line), 240)).filter(Boolean)
      }
    : {
        root: '',
        branch: '',
        status: []
      }
  return {
    cwd: clampText(probe.cwd || '', 240),
    user: clampText(probe.user || '', 80),
    host: clampText(probe.host || '', 160),
    shell: clampText(probe.shell || '', 120),
    uname: clampText(probe.uname || '', 240),
    tools: takeList(probe.tools || [], 20).map(tool => clampText(tool, 40)).filter(Boolean),
    git,
    files: takeList(probe.files || [], 20).map(file => clampText(file, 260)).filter(Boolean),
    warnings: takeList(probe.warnings || [], 8).map(line => clampText(redactShellSecrets(line), 240)).filter(Boolean),
    raw: clampText(redactShellSecrets(probe.raw || ''), 4000),
    stderr: clampText(redactShellSecrets(probe.stderr || ''), 1600),
    exitCode: probe.exitCode,
    timedOut: !!probe.timedOut
  }
}

function extractTextFragments (context) {
  const parts = [
    context?.request,
    context?.prompt,
    context?.cwd,
    context?.host,
    context?.tabType,
    context?.runtimeProbe?.cwd,
    context?.runtimeProbe?.host,
    context?.runtimeProbe?.shell,
    context?.runtimeProbe?.uname,
    context?.runtimeProbe?.git?.root,
    context?.runtimeProbe?.git?.branch,
    context?.terminalTail,
    JSON.stringify(context?.recentCommands || []),
    JSON.stringify(context?.sessionHistory || []),
    JSON.stringify(context?.runtimeProbe?.git?.status || []),
    JSON.stringify(context?.runtimeProbe?.files || [])
  ]
  return redactShellSecrets(parts.filter(Boolean).join('\n')).toLowerCase()
}

function buildSessionHistoryMessages (sessionHistory = []) {
  const messages = []
  for (const entry of compactList(sessionHistory, smartShellHistoryLimit)) {
    const normalized = normalizeHistoryEntry(entry)
    if (!normalized) {
      continue
    }
    const userLines = [
      `Terminal session turn (${normalized.source}${normalized.status ? ` / ${normalized.status}` : ''})`
    ]
    if (normalized.cwd) {
      userLines.push(`cwd: ${normalized.cwd}`)
    }
    if (normalized.host) {
      userLines.push(`host: ${normalized.host}`)
    }
    if (normalized.prompt) {
      userLines.push(`request: ${normalized.prompt}`)
    }
    if (normalized.command) {
      userLines.push(`command: ${normalized.command}`)
    }
    if (normalized.notes.length) {
      userLines.push(`notes: ${normalized.notes.join(' | ')}`)
    }

    if (normalized.command || normalized.message) {
      messages.push({
        role: 'user',
        content: userLines.join('\n')
      })
      messages.push({
        role: 'assistant',
        content: [
          normalized.message ? `message: ${normalized.message}` : '',
          normalized.command ? `command: ${normalized.command}` : '',
          normalized.risk ? `risk: ${normalized.risk}` : '',
          normalized.skill ? `skill: ${normalized.skill}` : '',
          normalized.executedAt ? `executedAt: ${normalized.executedAt}` : '',
          normalized.rejectedAt ? `rejectedAt: ${normalized.rejectedAt}` : ''
        ].filter(Boolean).join('\n')
      })
    } else {
      messages.push({
        role: 'user',
        content: userLines.join('\n')
      })
    }
  }
  return messages
}

function makeSkillInstructions (skill) {
  const profile = summarizeSkill(skill)
  return profile ? profile.instructions.join('\n') : smartShellSkillProfiles.linux.instructions.join('\n')
}

function stripQuotes (text) {
  return text.replace(/^['"]|['"]$/g, '')
}

function firstCommandToken (line) {
  const tokens = line.trim().split(/\s+/).map(stripQuotes)
  let index = 0
  while (tokens[index] && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
    index++
  }
  return tokens[index] || ''
}

function hasShellOperator (line) {
  return /(\|\||&&|[|;<>`]|[$][(]|[$][{])/.test(line)
}

function hasCjkText (line) {
  return /[\u3400-\u9fff]/.test(line)
}

function startsWithShellPath (line) {
  return /^(\.\/|\.\.\/|\/|~\/|[$][A-Za-z_][A-Za-z0-9_]*\/)/.test(line.trim())
}

function looksLikeAssignmentOnly (line) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(line.trim())
}

function looksLikeShellLine (line) {
  const trimmed = line.trim()
  if (!trimmed) {
    return false
  }
  if (trimmed.startsWith('#!')) {
    return true
  }
  if (startsWithShellPath(trimmed) || looksLikeAssignmentOnly(trimmed)) {
    return true
  }

  const token = firstCommandToken(trimmed)
  if (!token) {
    return false
  }
  const normalizedToken = token.replace(/^[({]+/, '').replace(/[)}]+$/, '')
  if (commandStartTokens.has(normalizedToken) || shellKeywords.has(normalizedToken)) {
    if (hasCjkText(trimmed) && hasNaturalLanguageCue(trimmed)) {
      return false
    }
    return true
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+$/.test(normalizedToken)) {
    return true
  }
  if (hasShellOperator(trimmed) && !hasCjkText(trimmed) && /^[\x20-\x7e]+$/.test(trimmed)) {
    return true
  }
  return false
}

export function classifySmartInput (input) {
  const value = String(input || '').trim()
  if (!value) {
    return {
      type: 'empty',
      confidence: 1,
      reason: 'empty'
    }
  }

  const lines = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  if (!lines.length) {
    return {
      type: 'natural',
      confidence: 0.8,
      reason: 'comment-only input'
    }
  }

  const shellLines = lines.filter(looksLikeShellLine)
  const isCommand = shellLines.length === lines.length
  return {
    type: isCommand ? 'command' : 'natural',
    confidence: isCommand ? 0.9 : 0.75,
    reason: isCommand ? 'shell-like input' : 'natural language input'
  }
}

function pickHighestRisk (left, right) {
  return riskRank[left] >= riskRank[right] ? left : right
}

export function estimateCommandRisk (command = '') {
  const text = String(command).toLowerCase()
  if (!text.trim()) {
    return 'unknown'
  }
  let risk = 'read_only'

  if (/\b(rm\s+[^;\n]*-[^\n]*[rf]|mkfs|dd\s+if=|shutdown|reboot|halt|poweroff|userdel|groupdel|iptables\s+-f|ufw\s+reset)\b/.test(text)) {
    risk = pickHighestRisk(risk, 'destructive')
  }
  if (/\b(sudo|su|chmod|chown|chgrp|systemctl\s+(start|stop|restart|enable|disable|reload)|service\s+\S+\s+(start|stop|restart|reload)|iptables|firewall-cmd|ufw|mount|umount)\b/.test(text)) {
    risk = pickHighestRisk(risk, 'privileged')
  }
  if (/\b(apt|apt-get|yum|dnf|pacman|apk|brew|npm|pnpm|yarn|pip|pip3|gem|cargo)\s+(install|remove|uninstall|upgrade|update|add|delete|publish)\b/.test(text)) {
    risk = pickHighestRisk(risk, 'network')
  }
  if (/(^|\s)(mv|cp|touch|mkdir|rmdir|tee|truncate)\b|(^|\s)sed\s+-i\b|[>]{1,2}|\bgit\s+(pull|push|checkout|reset|clean|merge|rebase|commit|apply)\b/.test(text)) {
    risk = pickHighestRisk(risk, 'changes_files')
  }
  return risk
}

function normalizeRisk (risk, command) {
  const normalized = String(risk || '').trim().toLowerCase()
  if (riskRank[normalized] !== undefined) {
    return normalized
  }
  return command ? estimateCommandRisk(command) : 'unknown'
}

function stripMarkdownFence (text) {
  const trimmed = String(text || '').trim()
  const match = trimmed.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmed
}

function extractShellSnippet (text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return ''
  }

  const fenced = raw.match(/```(?:bash|sh|shell|zsh|fish|powershell)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1].trim()) {
    return fenced[1].trim()
  }

  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    if (looksLikeShellLine(line)) {
      return line
    }
  }

  return ''
}

function parseJsonLoose (raw) {
  const clean = stripMarkdownFence(raw)
  try {
    return JSON.parse(clean)
  } catch {
    const first = clean.indexOf('{')
    const last = clean.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(clean.slice(first, last + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

export function parseSmartShellResponse (raw, prompt) {
  const parsed = parseJsonLoose(raw)
  if (!parsed || typeof parsed !== 'object') {
    const command = extractShellSnippet(raw)
    return {
      message: String(raw || '').trim() || 'AI did not return a command proposal.',
      command,
      risk: normalizeRisk('unknown', command),
      needs_confirmation: command ? normalizeRisk('unknown', command) !== 'read_only' : true,
      notes: command ? ['Structured JSON parsing failed, but a shell snippet was extracted.'] : ['Structured JSON parsing failed.'],
      skill: 'linux',
      context_used: [],
      assumptions: [],
      sourcePrompt: prompt
    }
  }

  const commandFromArray = Array.isArray(parsed.commands)
    ? parsed.commands.filter(Boolean).join('\n')
    : ''
  const command = String(parsed.command || parsed.script || commandFromArray || extractShellSnippet(parsed.message) || '').trim()
  const risk = normalizeRisk(parsed.risk, command)
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.map(String).filter(Boolean)
    : (parsed.note ? [String(parsed.note)] : [])
  const contextUsed = Array.isArray(parsed.context_used)
    ? parsed.context_used.map(String).filter(Boolean)
    : []
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.map(String).filter(Boolean)
    : []

  return {
    message: String(parsed.message || parsed.summary || parsed.explanation || '').trim(),
    command,
    risk,
    needs_confirmation: parsed.needs_confirmation === undefined
      ? risk !== 'read_only'
      : !!parsed.needs_confirmation,
    notes,
    skill: normalizeSkillKey(parsed.skill || parsed.selected_skill || ''),
    context_used: contextUsed,
    assumptions,
    sourcePrompt: prompt
  }
}

export function selectSmartShellSkill (request = '', context = {}) {
  const text = extractTextFragments({
    ...context,
    request
  })
  const scores = {
    git: 0,
    docker: 0,
    node: 0,
    sftp: 0,
    linux: 0
  }
  const addScore = (skill, regex, weight = 2) => {
    if (regex.test(text)) {
      scores[skill] += weight
    }
  }

  addScore('git', /\bgit\b|\bbranch\b|\bcommit\b|\bmerge\b|\brebase\b|\bstash\b|\bcheckout\b|\breset\b|\bdiff\b|\bstatus\b|\blog\b|\brepo\b/, 3)
  if (context?.runtimeProbe?.git?.root || context?.runtimeProbe?.git?.branch) {
    scores.git += 2
  }
  if (compactList(context?.recentCommands || []).some(cmd => /\bgit\b/.test(cmd))) {
    scores.git += 1
  }

  addScore('docker', /\bdocker\b|\bcompose\b|\bcontainer\b|\bimage\b|\bpodman\b|\bkubectl\b|\bhelm\b|\bk8s\b/, 3)
  addScore('node', /\bnode\b|\bnpm\b|\bpnpm\b|\byarn\b|\bbun\b|\bpackage\.json\b|\blockfile\b|\btsconfig\b|\bvite\b|\bwebpack\b|\bnext\b|\breact\b|\btypescript\b/, 3)
  addScore('sftp', /\bsftp\b|\bscp\b|\brsync\b|\bupload\b|\bdownload\b|\bfile\b|\bpermission\b|\bchmod\b|\bchown\b|\bowner\b|\bsync\b|\bedit\b|\bremote\b/, 3)
  addScore('linux', /\bsystemctl\b|\bjournalctl\b|\bservice\b|\bdmesg\b|\bps\b|\btop\b|\bhtop\b|\bfree\b|\buname\b|\bdf\b|\bdu\b|\bmount\b|\bumount\b|\bkill\b|\bchmod\b|\bchown\b/, 1)

  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [skill, score] = ordered[0] || ['linux', 0]
  return score > 0 ? skill : 'linux'
}

export function summarizeSmartShellContext (context = {}) {
  const parts = []
  if (context.tabType) {
    parts.push(context.tabType)
  }
  if (context.host) {
    parts.push(context.host)
  }
  if (context.cwd) {
    parts.push(`cwd=${context.cwd}`)
  }
  if (context.runtimeProbe?.git?.branch) {
    parts.push(`git=${context.runtimeProbe.git.branch}`)
  } else if (context.runtimeProbe?.git?.root) {
    parts.push('git repo')
  }
  if (context.skill) {
    parts.push(`skill=${context.skill}`)
  }
  if (context.sessionHistory?.length) {
    parts.push(`session=${context.sessionHistory.length}`)
  }
  if (context.recentCommands?.length) {
    parts.push(`history=${context.recentCommands.length}`)
  }
  if (context.terminalTail) {
    parts.push('tail')
  }
  if (context.runtimeProbe?.tools?.length) {
    parts.push(`tools=${context.runtimeProbe.tools.slice(0, 5).join(',')}`)
  }
  return parts.join(' · ')
}

export function buildSmartShellContext (rawContext = {}) {
  const tab = rawContext.tab || {}
  const request = clampText(redactShellSecrets(rawContext.request || rawContext.prompt || ''), 600)
  const sessionHistory = compactList(rawContext.sessionHistory || rawContext.session_history || [], smartShellHistoryLimit)
    .map(normalizeHistoryEntry)
    .filter(Boolean)
  const recentCommands = compactList(rawContext.recentCommands || rawContext.recent_commands || [], 12)
    .map(cmd => clampText(redactShellSecrets(cmd), 220))
    .filter(Boolean)
  const terminalTail = clampText(redactShellSecrets(rawContext.terminalTail || rawContext.terminal_tail || ''), smartShellTailCharLimit)
  const runtimeProbe = normalizeRuntimeProbe(rawContext.runtimeProbe || rawContext.runtime_probe || null)
  const selectedTabIds = compactList(rawContext.selectedTabIds || rawContext.selected_tab_ids || [], 8)
    .map(id => clampText(id, 80))
    .filter(Boolean)

  const tabSummary = {
    id: clampText(tab.id || rawContext.tabId || '', 80),
    type: clampText(tab.type || rawContext.tabType || '', 40),
    host: clampText(tab.host || rawContext.host || '', 160),
    cwd: clampText(rawContext.cwd || tab.cwd || '', 320),
    title: clampText(tab.title || '', 120),
    shellType: clampText(rawContext.shellType || rawContext.shell_type || tab.shellType || '', 60),
    isRemote: rawContext.isRemote !== undefined ? !!rawContext.isRemote : !!(tab.host || rawContext.host),
    isConnected: rawContext.isConnected !== undefined ? !!rawContext.isConnected : !!(tab.host || rawContext.host)
  }

  const skill = normalizeSkillKey(rawContext.skill || selectSmartShellSkill(request, {
    tab: tabSummary,
    sessionHistory,
    recentCommands,
    terminalTail,
    runtimeProbe,
    selectedTabIds
  }))
  const skillProfile = summarizeSkill(skill)
  const normalized = {
    request,
    prompt: request,
    tab: tabSummary,
    cwd: tabSummary.cwd,
    host: tabSummary.host,
    tabType: tabSummary.type,
    isRemote: tabSummary.isRemote,
    isConnected: tabSummary.isConnected,
    selectedTabIds,
    sessionHistory,
    recentCommands,
    terminalTail,
    runtimeProbe,
    skill,
    skillProfile,
    summary: ''
  }
  normalized.summary = summarizeSmartShellContext(normalized)
  return normalized
}

export function buildSmartShellProbeCommand () {
  return [
    'printf "__electerm_ai_probe_v1__\\n"',
    'printf "cwd=%s\\n" "$(pwd 2>/dev/null || printf "")"',
    'printf "user=%s\\n" "$(id -un 2>/dev/null || whoami 2>/dev/null || printf "")"',
    'printf "host=%s\\n" "$(hostname 2>/dev/null || printf "")"',
    'printf "shell=%s\\n" "' + '$' + '{SHELL:-}"',
    'printf "uname=%s\\n" "$(uname -a 2>/dev/null || printf "")"',
    'printf "tools="',
    'for tool in git docker docker-compose kubectl node npm pnpm yarn bun python3 python pip3 pip rg fd curl wget systemctl journalctl; do command -v "$tool" >/dev/null 2>&1 && printf "%s " "$tool"; done',
    'printf "\\n"',
    'if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  printf "git_root=%s\\n" "$(git rev-parse --show-toplevel 2>/dev/null || printf "")"',
    '  printf "git_branch=%s\\n" "$(git branch --show-current 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || printf "")"',
    '  printf "git_status_start\\n"',
    '  git status --short --branch 2>/dev/null | head -80',
    '  printf "git_status_end\\n"',
    'fi',
    'printf "files_start\\n"',
    '(find . 2>/dev/null | sed "s#^\\./##" | sed "/^\\.$/d" | head -80) || (ls -la 2>/dev/null | head -80)',
    'printf "files_end\\n"'
  ].join('\n')
}

export function parseSmartShellProbeOutput (stdout = '', stderr = '', meta = {}) {
  const raw = String(stdout || '')
  const lines = raw.split(/\r?\n/)
  const runtimeProbe = {
    cwd: '',
    user: '',
    host: '',
    shell: '',
    uname: '',
    tools: [],
    git: {
      root: '',
      branch: '',
      status: []
    },
    files: [],
    warnings: [],
    raw: clampText(raw, 4000),
    stderr: clampText(stderr, 1600),
    exitCode: meta.exitCode,
    timedOut: !!meta.timedOut
  }

  let section = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed === '__electerm_ai_probe_v1__') {
      continue
    }
    if (trimmed === 'git_status_start') {
      section = 'git_status'
      continue
    }
    if (trimmed === 'git_status_end') {
      section = ''
      continue
    }
    if (trimmed === 'files_start') {
      section = 'files'
      continue
    }
    if (trimmed === 'files_end') {
      section = ''
      continue
    }

    if (section === 'git_status') {
      runtimeProbe.git.status.push(clampText(redactShellSecrets(trimmed), 240))
      continue
    }
    if (section === 'files') {
      runtimeProbe.files.push(clampText(redactShellSecrets(trimmed), 260))
      continue
    }

    const eq = trimmed.indexOf('=')
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === 'cwd') {
        runtimeProbe.cwd = value
      } else if (key === 'user') {
        runtimeProbe.user = value
      } else if (key === 'host') {
        runtimeProbe.host = value
      } else if (key === 'shell') {
        runtimeProbe.shell = value
      } else if (key === 'uname') {
        runtimeProbe.uname = value
      } else if (key === 'tools') {
        runtimeProbe.tools = value.split(/\s+/).filter(Boolean)
      } else if (key === 'git_root') {
        runtimeProbe.git.root = value
      } else if (key === 'git_branch') {
        runtimeProbe.git.branch = value
      } else {
        runtimeProbe[key] = value
      }
      continue
    }

    runtimeProbe.warnings.push(clampText(redactShellSecrets(trimmed), 240))
  }

  if (runtimeProbe.stderr) {
    runtimeProbe.warnings.push(runtimeProbe.stderr)
  }
  return runtimeProbe
}

export function buildSmartShellMessages (request, context, language) {
  const lang = language || 'English'
  const normalized = buildSmartShellContext({
    ...(context || {}),
    request
  })
  const skillProfile = normalized.skillProfile || summarizeSkill(normalized.skill)
  const sessionMessages = buildSessionHistoryMessages(normalized.sessionHistory)
  return [
    {
      role: 'system',
      content: `You are an AI shell planner inside electerm, an SSH terminal and SFTP client.
Treat each terminal tab as a long-lived conversation window.
Combine the current request, the session history, recent commands, the terminal tail, and the runtime probe before suggesting anything.

Active skill: ${skillProfile?.label || 'linux'}
Skill focus:
${makeSkillInstructions(normalized.skill)}

Output rules:
- Return pure JSON only, with no markdown fences and no extra words.
- Produce one command or a short shell script that the shell can run verbatim.
- Prefer the smallest safe command that solves the request.
- If the request is broad, ambiguous, or risky, propose a read-only discovery command or ask for the missing detail.
- Never mix the user's natural-language text into the shell command.
- Never include secrets, passwords, tokens, or destructive operations unless the user explicitly asked for them.

JSON schema:
{
  "message": "short user-facing explanation in ${lang}",
  "command": "one command or short shell script, no markdown fence",
  "risk": "read_only|changes_files|network|privileged|destructive|unknown",
  "needs_confirmation": true,
  "notes": ["optional short notes in ${lang}"],
  "skill": "git|docker|node|sftp|linux",
  "context_used": ["optional context fields used"],
  "assumptions": ["optional assumptions"]
}`
    },
    ...sessionMessages,
    {
      role: 'user',
      content: JSON.stringify({
        request,
        terminal_context: {
          tab: normalized.tab,
          cwd: normalized.cwd,
          host: normalized.host,
          tabType: normalized.tabType,
          isRemote: normalized.isRemote,
          isConnected: normalized.isConnected,
          recentCommands: normalized.recentCommands,
          sessionSummary: normalized.summary,
          terminalTail: normalized.terminalTail,
          runtimeProbe: normalized.runtimeProbe,
          selectedSkill: normalized.skill,
          skillNotes: skillProfile?.instructions || [],
          selectedTabIds: normalized.selectedTabIds
        }
      }, null, 2)
    }
  ]
}
