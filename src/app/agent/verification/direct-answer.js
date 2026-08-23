function isDirectLookupObjective (objective) {
  return /(?:哪里|在哪|位置|路径|where|path|location)/i.test(String(objective || '').trim())
}

function summarizeDirectLookup (facts, objective) {
  const question = String(objective || '').trim()
  if (!isDirectLookupObjective(question)) return ''
  const keywords = objectiveKeywords(question)
  const configRequested = /(?:配置|config)/i.test(question)
  const byPath = new Map()
  for (const fact of facts || []) {
    if (fact?.confidence === 'inferred') continue
    const statement = String(fact?.statement || '')
    for (const match of statement.match(/\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+/g) || []) {
      const path = match.replace(/[),.;:]+$/g, '')
      if (!path || path === '/') continue
      const haystack = `${statement} ${path}`.toLowerCase()
      let score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 4 : 0), 0)
      if (configRequested && /(?:\.conf$|\/conf(?:\/|$)|\/etc\/)/i.test(path)) score += 8
      if (configRequested && keywords.some(keyword => path.toLowerCase().includes(keyword))) score += 5
      if (/\.(?:html?|log)$/i.test(path)) score -= 8
      const current = byPath.get(path)
      if (!current || score > current.score) byPath.set(path, { path, score })
    }
  }
  const candidates = [...byPath.values()]
    .filter(item => !configRequested || /(?:\.conf$|\/conf(?:\/|$)|\/etc\/)/i.test(item.path))
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) return ''
  const path = candidates[0].path
  const target = directLookupTarget(question)
  if (/\p{Script=Han}/u.test(question)) {
    const subject = [target, configRequested ? '配置文件' : '位置'].filter(Boolean).join(' ')
    return `${subject || '目标位置'}位于 ${path}。`
  }
  return `${target || (configRequested ? 'The configuration file' : 'The requested item')} is located at ${path}.`
}

function objectiveKeywords (objective) {
  const ignored = new Set(['the', 'a', 'an', 'is', 'are', 'where', 'path', 'location', 'config', 'configuration', 'file', 'please', 'find', 'show'])
  return [...new Set((String(objective || '').toLowerCase().match(/[a-z][a-z0-9_.-]+/g) || [])
    .filter(item => item.length > 1 && !ignored.has(item)))]
}

function directLookupTarget (objective) {
  const keyword = objectiveKeywords(objective)[0]
  if (!keyword) return ''
  const labels = { nginx: 'Nginx', docker: 'Docker', ssh: 'SSH' }
  return labels[keyword] || keyword
}

module.exports = { isDirectLookupObjective, summarizeDirectLookup, objectiveKeywords, directLookupTarget }
