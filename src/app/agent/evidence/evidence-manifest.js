const fs = require('fs')
const path = require('path')
const { atomicWriteJson, ensurePrivateDirectory } = require('../session/session-store')

class EvidenceManifest {
  constructor (rootPath, taskId) {
    this.taskId = taskId
    this.directory = path.join(rootPath, 'evidence', taskId)
    this.filePath = path.join(this.directory, 'manifest.json')
    ensurePrivateDirectory(this.directory)
  }

  load () {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: 1, taskId: this.taskId, records: [] }
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return value.schemaVersion === 1 && value.taskId === this.taskId && Array.isArray(value.records) ? value : { schemaVersion: 1, taskId: this.taskId, records: [] }
    } catch (_) {
      return { schemaVersion: 1, taskId: this.taskId, records: [] }
    }
  }

  save (manifest) {
    atomicWriteJson(this.filePath, manifest)
  }
}

module.exports = { EvidenceManifest }
