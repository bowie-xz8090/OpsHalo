const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { SecretRedactor } = require('../observation/secret-redactor')
const { normalizePaths, tokens } = require('./skill-registry')

const supportedExtension = /\.(?:md|txt|json|ya?ml)$/i
const VECTOR_DIMENSIONS = 128
const RRF_K = 60

class LocalKnowledgeBase {
  constructor (options = {}) {
    this.redactor = options.redactor || new SecretRedactor()
    this.root = options.root
    this.indexPath = this.root ? path.join(this.root, 'knowledge-index.v1.json') : null
    this.vectorPath = this.root ? path.join(this.root, 'vectors', 'local-hash-v1.json') : null
    this.chunks = []
    this.invertedIndex = new Map()
    this.averageDocumentLength = 0
    this.warnings = []
    this.enabled = false
    this.embeddingMode = 'off'
    this.vectors = []
    this.refresh(options.config || {})
  }

  refresh (config = {}) {
    this.enabled = config.agentKnowledgeEnabled === true
    this.embeddingMode = this.enabled && config.agentKnowledgeEmbeddingMode === 'local' ? 'local' : 'off'
    this.chunks = []
    this.invertedIndex = new Map()
    this.averageDocumentLength = 0
    this.warnings = []
    this.vectors = []
    if (!this.enabled) {
      this.persistIndex()
      this.persistVectors()
      return this.summary()
    }
    this.inspectPersistedIndex()
    let totalBytes = 0
    for (const source of normalizePaths(config.agentKnowledgeSources)) {
      for (const file of sourceFiles(source)) {
        try {
          const stat = fs.lstatSync(file)
          if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) continue
          totalBytes += stat.size
          if (totalBytes > 10 * 1024 * 1024) throw new Error('Knowledge source limit exceeds 10 MiB')
          this.chunks.push(...indexFile(file, stat, this.redactor))
          if (this.chunks.length >= 5000) break
        } catch (error) {
          this.warnings.push({ source: file, message: String(error.message || error).slice(0, 300) })
        }
      }
      if (this.chunks.length >= 5000) break
    }
    const built = buildInvertedIndex(this.chunks)
    this.invertedIndex = built.index
    this.averageDocumentLength = built.averageDocumentLength
    if (this.embeddingMode === 'local') this.vectors = this.chunks.map(chunk => localEmbedding(chunk.tokenFrequencies))
    this.persistIndex()
    this.persistVectors()
    return this.summary()
  }

  search (query, limit = 6) {
    if (!this.enabled || !this.chunks.length) return []
    const queryTokens = tokens(query)
    if (!queryTokens.size) return []
    const scores = new Map()
    const documentCount = this.chunks.length
    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token)
      if (!postings) continue
      const inverseDocumentFrequency = Math.log(1 + (documentCount - postings.size + 0.5) / (postings.size + 0.5))
      for (const [chunkIndex, frequency] of postings) {
        const chunk = this.chunks[chunkIndex]
        const lengthNormalization = 1 - 0.75 + 0.75 * chunk.tokenCount / Math.max(1, this.averageDocumentLength)
        const score = inverseDocumentFrequency * (frequency * 2.2) / (frequency + 1.2 * lengthNormalization)
        scores.set(chunkIndex, (scores.get(chunkIndex) || 0) + score)
      }
    }
    const keywordRanked = [...scores.entries()].map(([chunkIndex, score]) => ({ chunkIndex, score }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || compareChunks(this.chunks[a.chunkIndex], this.chunks[b.chunkIndex]))
    const ranked = this.embeddingMode === 'local'
      ? reciprocalRankFusion(keywordRanked, vectorRank(this.vectors, localEmbedding(frequencies(query))))
      : keywordRanked
    return ranked
      .slice(0, Math.max(0, Math.min(Number(limit) || 6, 6)))
      .map(({ chunkIndex, score }) => {
        const chunk = this.chunks[chunkIndex]
        return {
          sourceId: chunk.sourceId,
          sourcePath: chunk.sourcePath,
          sourceVersion: chunk.sourceVersion,
          chunkId: chunk.chunkId,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
          text: chunk.text,
          retrievedAt: new Date().toISOString(),
          retrievalMode: this.embeddingMode === 'local' ? 'hybrid_rrf' : 'fts',
          stale: false,
          untrusted: true
        }
      })
  }

  summary () {
    return { enabled: this.enabled, retrievalMode: this.embeddingMode === 'local' ? 'hybrid_rrf' : 'fts', chunkCount: this.chunks.length, termCount: this.invertedIndex.size, vectorCount: this.vectors.length, warningCount: this.warnings.length, warnings: this.warnings.slice(0, 20) }
  }

  annotateCitations (citations = []) {
    const currentBySource = new Map()
    for (const citation of citations) {
      if (currentBySource.has(citation.sourcePath)) continue
      let versions = new Set()
      try {
        const stat = fs.lstatSync(citation.sourcePath)
        if (!stat.isSymbolicLink() && stat.isFile()) {
          versions = new Set(indexFile(citation.sourcePath, stat, this.redactor).map(item => `${item.chunkId}:${item.sourceVersion}`))
        }
      } catch (_) {}
      currentBySource.set(citation.sourcePath, versions)
    }
    return citations.map(citation => ({
      ...citation,
      stale: !currentBySource.get(citation.sourcePath)?.has(`${citation.chunkId}:${citation.sourceVersion}`)
    }))
  }

  isCitationStale (citation) {
    return this.annotateCitations([citation])[0]?.stale !== false
  }

  inspectPersistedIndex () {
    if (!this.indexPath || !fs.existsSync(this.indexPath)) return
    try {
      const value = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'))
      if (value?.schemaVersion !== 1 || !Array.isArray(value?.chunks)) throw new Error('unsupported index schema')
    } catch (_) {
      this.warnings.push({ source: this.indexPath, message: 'Knowledge index was corrupt and has been rebuilt from explicit sources' })
    }
  }

  persistIndex () {
    if (!this.indexPath) return
    try {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
      const temporary = `${this.indexPath}.${process.pid}.tmp`
      const payload = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        chunks: this.chunks.map(chunk => ({
          sourceId: chunk.sourceId,
          sourcePath: chunk.sourcePath,
          sourceVersion: chunk.sourceVersion,
          chunkId: chunk.chunkId,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text
        }))
      }
      fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, this.indexPath)
    } catch (error) {
      this.warnings.push({ source: this.indexPath, message: String(error.message || error).slice(0, 300) })
    }
  }

  persistVectors () {
    if (!this.vectorPath) return
    if (this.embeddingMode !== 'local') {
      try { fs.unlinkSync(this.vectorPath) } catch (_) {}
      return
    }
    try {
      fs.mkdirSync(path.dirname(this.vectorPath), { recursive: true, mode: 0o700 })
      const temporary = `${this.vectorPath}.${process.pid}.tmp`
      const payload = {
        schemaVersion: 1,
        algorithm: 'local-hash-v1',
        dimensions: VECTOR_DIMENSIONS,
        generatedAt: new Date().toISOString(),
        vectors: this.chunks.map((chunk, index) => ({ chunkId: chunk.chunkId, sourceVersion: chunk.sourceVersion, values: this.vectors[index] }))
      }
      fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, this.vectorPath)
    } catch (error) {
      this.warnings.push({ source: this.vectorPath, message: String(error.message || error).slice(0, 300) })
    }
  }
}

function sourceFiles (source) {
  try {
    const stat = fs.lstatSync(source)
    if (stat.isSymbolicLink()) return []
    if (stat.isFile()) return supportedExtension.test(source) ? [source] : []
    if (!stat.isDirectory()) return []
    return fs.readdirSync(source, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && supportedExtension.test(entry.name))
      .map(entry => path.join(source, entry.name))
      .slice(0, 500)
  } catch (_) {
    return []
  }
}

function indexFile (file, stat, redactor) {
  const sourcePath = fs.realpathSync(file)
  const raw = fs.readFileSync(sourcePath, 'utf8')
  const redacted = redactor.redact(raw)
  if (redacted.failed) throw new Error('Knowledge source redaction failed')
  const sourceId = `source_${crypto.createHash('sha256').update(sourcePath).digest('hex').slice(0, 20)}`
  const sourceVersion = crypto.createHash('sha256').update(`${stat.mtimeMs}:${stat.size}:${redacted.text}`).digest('hex').slice(0, 20)
  const lines = redacted.text.split(/\r?\n/)
  const chunks = []
  let start = 0
  while (start < lines.length) {
    let end = start
    let length = 0
    while (end < lines.length && length + lines[end].length + 1 <= 4000) {
      length += lines[end].length + 1
      end++
    }
    if (end === start) end++
    const text = lines.slice(start, end).join('\n').trim()
    if (text) {
      const chunkId = `chunk_${crypto.createHash('sha256').update(`${sourceId}:${start}:${text}`).digest('hex').slice(0, 20)}`
      const tokenFrequencies = frequencies(text)
      chunks.push({ sourceId, sourcePath, sourceVersion, chunkId, startLine: start + 1, endLine: end, text, tokens: new Set(tokenFrequencies.keys()), tokenFrequencies, tokenCount: [...tokenFrequencies.values()].reduce((sum, count) => sum + count, 0) })
    }
    start = Math.max(end, start + 1)
  }
  return chunks
}

function lexicalScore (document, query) {
  let matches = 0
  for (const token of query) if (document.has(token)) matches += token.length > 2 ? 3 : 1
  return matches / Math.max(1, Math.sqrt(document.size))
}

function frequencies (value) {
  const result = new Map()
  for (const token of tokens(value)) result.set(token, (result.get(token) || 0) + 1)
  return result
}

function buildInvertedIndex (chunks) {
  const index = new Map()
  let totalDocumentLength = 0
  chunks.forEach((chunk, chunkIndex) => {
    totalDocumentLength += chunk.tokenCount
    for (const [token, frequency] of chunk.tokenFrequencies) {
      if (!index.has(token)) index.set(token, new Map())
      index.get(token).set(chunkIndex, frequency)
    }
  })
  return {
    index,
    averageDocumentLength: chunks.length ? totalDocumentLength / chunks.length : 0
  }
}

function localEmbedding (tokenFrequencies) {
  const vector = new Array(VECTOR_DIMENSIONS).fill(0)
  for (const [token, count] of tokenFrequencies) {
    const digest = crypto.createHash('sha256').update(token).digest()
    const index = digest.readUInt16BE(0) % VECTOR_DIMENSIONS
    vector[index] += (digest[2] & 1 ? 1 : -1) * Math.log1p(count)
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map(value => Number((value / norm).toFixed(6)))
}

function vectorRank (vectors, queryVector) {
  return vectors.map((vector, chunkIndex) => ({
    chunkIndex,
    score: vector.reduce((sum, value, index) => sum + value * (queryVector[index] || 0), 0)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
}

function reciprocalRankFusion (...rankings) {
  const scores = new Map()
  for (const ranking of rankings) {
    ranking.forEach((item, index) => scores.set(item.chunkIndex, (scores.get(item.chunkIndex) || 0) + 1 / (RRF_K + index + 1)))
  }
  return [...scores.entries()].map(([chunkIndex, score]) => ({ chunkIndex, score }))
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
}

function compareChunks (a, b) {
  return a.sourcePath.localeCompare(b.sourcePath) || a.startLine - b.startLine
}

module.exports = { LocalKnowledgeBase, sourceFiles, indexFile, lexicalScore, frequencies, buildInvertedIndex, localEmbedding, vectorRank, reciprocalRankFusion }
