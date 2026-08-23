const fs = require('fs')
const path = require('path')

const BUILTIN_SKILLS = Object.freeze([
  {
    id: 'diagnose-service',
    version: '1.0.0',
    title: 'Diagnose Linux service',
    description: 'Correlate service state, process, port and bounded logs before forming a root-cause conclusion.',
    triggers: ['service', 'systemd', '服务', '启动失败', '异常'],
    allowedToolCategories: ['service', 'process', 'network'],
    content: 'Start with service.status. If state is unhealthy, inspect bounded service.logs, then correlate process.list and network.ports. Treat log errors as clues until corroborated. Never restart before explicit approval and a postcondition.'
  },
  {
    id: 'diagnose-nginx',
    version: '1.0.0',
    title: 'Diagnose Nginx',
    description: 'Inspect Nginx service/container state, listeners and effective configuration with read-only evidence.',
    triggers: ['nginx', 'reverse proxy', '反向代理', '网关'],
    allowedToolCategories: ['service', 'docker', 'process', 'network', 'config'],
    content: 'Identify whether Nginx runs as a service or container. Correlate status, process, listeners and bounded logs. Use docker.nginx_config only for an explicitly identified container. Any reload, restart or configuration write requires approval and read-only verification.'
  }
])

class SkillRegistry {
  constructor (options = {}) {
    this.skills = []
    this.warnings = []
    this.refresh(options.config || {})
  }

  refresh (config = {}) {
    this.skills = config.agentSkillsEnabled === false ? [] : BUILTIN_SKILLS.map(item => ({ ...item, source: 'builtin', resourcePaths: [] }))
    this.warnings = []
    if (config.agentSkillsEnabled !== true) return this.summary()
    for (const root of normalizePaths(config.agentSkillDirectories)) {
      for (const directory of skillDirectories(root)) {
        try {
          const skill = loadSkill(directory, root)
          if (!this.skills.some(item => item.id === skill.id && item.version === skill.version)) this.skills.push(skill)
        } catch (error) {
          this.warnings.push({ source: directory, message: String(error.message || error).slice(0, 300) })
        }
      }
    }
    return this.summary()
  }

  routeMetadata (objective, limit = 8) {
    const query = tokens(objective)
    if (!query.size) return []
    return this.skills.map(skill => ({ skill, score: scoreSkill(skill, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
      .slice(0, Math.max(0, Math.min(Number(limit) || 8, 8)))
      .map(({ skill, score }) => ({
        id: skill.id,
        version: skill.version,
        title: skill.title,
        description: skill.description,
        allowedToolCategories: skill.allowedToolCategories,
        source: skill.source,
        untrusted: skill.source !== 'builtin',
        score
      }))
  }

  loadSelected (identifiers, options = {}) {
    const limit = Math.max(0, Math.min(Number(options.limit) || 2, 2))
    let remainingChars = Math.max(0, Math.min(Number(options.tokenBudget) || 3000, 12000)) * 4
    const wanted = new Set((identifiers || []).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean))
    const selected = []
    for (const skill of this.skills) {
      if (!wanted.has(skill.id) || selected.length >= limit || remainingChars <= 0) continue
      try {
        const raw = skill.source === 'builtin'
          ? String(skill.content || '')
          : skill.resourcePaths.map(resource => fs.readFileSync(resource, 'utf8')).join('\n\n')
        const content = raw.slice(0, Math.min(12000, remainingChars))
        remainingChars -= content.length
        selected.push({
          id: skill.id,
          version: skill.version,
          title: skill.title,
          description: skill.description,
          allowedToolCategories: skill.allowedToolCategories,
          source: skill.source,
          content,
          untrusted: skill.source !== 'builtin'
        })
      } catch (error) {
        this.warnings.push({ source: skill.source, message: String(error.message || error).slice(0, 300) })
      }
    }
    return selected
  }

  select (objective, limit = 2) {
    const candidates = this.routeMetadata(objective, Math.max(Number(limit) || 2, 2))
    return this.loadSelected(candidates.map(item => item.id), { limit, tokenBudget: 3000 })
  }

  summary () {
    return { skillCount: this.skills.length, warningCount: this.warnings.length, warnings: this.warnings.slice(0, 20) }
  }
}

function loadSkill (directory, configuredRoot) {
  const root = fs.realpathSync(configuredRoot)
  const realDirectory = fs.realpathSync(directory)
  if (!isInside(root, realDirectory)) throw new Error('Skill directory escapes configured root')
  const manifestPath = path.join(realDirectory, 'skill.json')
  const stat = fs.statSync(manifestPath)
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error('skill.json is missing or too large')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const id = boundedIdentifier(manifest.id, 'Skill id')
  const version = boundedIdentifier(manifest.version, 'Skill version')
  const resources = Array.isArray(manifest.resources) ? manifest.resources.slice(0, 10) : []
  const resourcePaths = []
  for (const relative of resources) {
    if (!/\.(?:md|txt|json|ya?ml)$/i.test(String(relative))) throw new Error('Skill resource type is not supported')
    const resource = fs.realpathSync(path.join(realDirectory, relative))
    if (!isInside(realDirectory, resource)) throw new Error('Skill resource escapes its directory')
    if (fs.lstatSync(path.join(realDirectory, relative)).isSymbolicLink()) throw new Error('Skill resource symlinks are not supported')
    const resourceStat = fs.statSync(resource)
    if (!resourceStat.isFile() || resourceStat.size > 128 * 1024) throw new Error('Skill resource is too large')
    resourcePaths.push(resource)
  }
  return {
    id,
    version,
    title: String(manifest.title || id).slice(0, 120),
    description: String(manifest.description || '').slice(0, 500),
    triggers: stringList(manifest.triggers, 30, 120),
    allowedToolCategories: stringList(manifest.allowedToolCategories, 20, 80),
    resourcePaths,
    source: realDirectory
  }
}

function skillDirectories (configured) {
  try {
    const stat = fs.statSync(configured)
    if (!stat.isDirectory()) return []
    if (fs.existsSync(path.join(configured, 'skill.json'))) return [configured]
    return fs.readdirSync(configured, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => path.join(configured, entry.name)).slice(0, 100)
  } catch (_) {
    return []
  }
}

function normalizePaths (value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/\r?\n/)
  return [...new Set(items.map(item => String(item || '').trim()).filter(item => path.isAbsolute(item)))].slice(0, 20)
}

function scoreSkill (skill, query) {
  const searchable = tokens([skill.id, skill.title, skill.description, ...(skill.triggers || [])].join(' '))
  let score = 0
  for (const token of query) if (searchable.has(token)) score += token.length > 2 ? 3 : 1
  return score
}

function tokens (value) {
  const text = String(value || '').toLowerCase()
  const words = text.match(/[a-z0-9_.-]{2,}|[\u3400-\u9fff]{2,}/g) || []
  const result = new Set(words)
  for (const word of words.filter(item => /[\u3400-\u9fff]/.test(item))) {
    for (let index = 0; index < word.length - 1; index++) result.add(word.slice(index, index + 2))
  }
  return result
}

function isInside (root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function boundedIdentifier (value, label) {
  const result = String(value || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(result)) throw new Error(`${label} is invalid`)
  return result
}

function stringList (value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map(item => String(item).slice(0, maxLength)).filter(Boolean).slice(0, maxItems) : []
}

module.exports = { SkillRegistry, BUILTIN_SKILLS, loadSkill, normalizePaths, tokens, isInside }
