const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const packagedModules = path.join(root, 'work/app/node_modules')

test('packaged SSH SM crypto closure still signs, verifies, encrypts and decrypts', () => {
  const { sm2, sm3, sm4 } = require(path.join(packagedModules, 'sm-crypto-v2'))
  const keys = sm2.generateKeyPairHex()
  const message = 'OpsHalo SSH SM runtime smoke'
  const signature = sm2.doSignature(message, keys.privateKey)
  assert.equal(sm2.doVerifySignature(message, signature, keys.publicKey), true)
  const encrypted = sm2.doEncrypt(message, keys.publicKey)
  assert.equal(sm2.doDecrypt(encrypted, keys.privateKey), message)
  assert.match(sm3(message), /^[a-f0-9]{64}$/)
  const sm4Key = '0123456789abcdeffedcba9876543210'
  assert.equal(sm4.decrypt(sm4.encrypt(message, sm4Key), sm4Key), message)
})

test('packaged Zod schemas retain validation while unused locale payload is absent', () => {
  const { z } = require(path.join(packagedModules, 'zod'))
  const schema = z.strictObject({ value: z.string().min(2) })
  assert.deepEqual(schema.parse({ value: 'ok' }), { value: 'ok' })
  assert.equal(schema.safeParse({ value: '' }).success, false)
  assert.equal(fs.existsSync(path.join(packagedModules, 'zod/v4/locales/en.cjs')), true)
  assert.equal(fs.existsSync(path.join(packagedModules, 'zod/v4/locales/zh-CN.cjs')), false)
})

test('packaged TweetNaCl keeps its declared CommonJS entry only', () => {
  const naclRoot = path.join(packagedModules, 'tweetnacl')
  const nacl = require(naclRoot)
  assert.equal(nacl.sign.keyPair().publicKey.length, 32)
  assert.equal(fs.existsSync(path.join(naclRoot, 'nacl-fast.js')), true)
  assert.equal(fs.existsSync(path.join(naclRoot, 'nacl.js')), false)
})
