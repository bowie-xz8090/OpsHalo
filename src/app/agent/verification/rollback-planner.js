const crypto = require('crypto')

function createRollbackIntent (session, verificationPlan) {
  const template = verificationPlan?.rollbackIntentTemplate
  if (!template) return null
  return {
    schemaVersion: 1,
    taskId: session.taskId,
    invocationId: `rollback_${crypto.randomBytes(18).toString('base64url')}`,
    toolName: template.toolName,
    toolVersion: '1',
    arguments: template.arguments,
    target: template.target,
    purpose: template.purpose,
    expectedObservation: '验证回滚后的实际资源状态'
  }
}

module.exports = { createRollbackIntent }
