class ApprovalScopeStore {
  constructor () {
    this.grants = new Map()
  }

  key (taskId, intentDigest, sessionFingerprint, policyVersion) {
    return `${taskId}:${intentDigest}:${sessionFingerprint}:${policyVersion}`
  }

  grant (taskId, intentDigest, sessionFingerprint, policyVersion, approvalRequestId) {
    this.grants.set(this.key(taskId, intentDigest, sessionFingerprint, policyVersion), { approvalRequestId })
  }

  get (taskId, intentDigest, sessionFingerprint, policyVersion) {
    return this.grants.get(this.key(taskId, intentDigest, sessionFingerprint, policyVersion))
  }

  revokeTask (taskId) {
    for (const key of this.grants.keys()) {
      if (key.startsWith(`${taskId}:`)) this.grants.delete(key)
    }
  }
}

module.exports = { ApprovalScopeStore }
