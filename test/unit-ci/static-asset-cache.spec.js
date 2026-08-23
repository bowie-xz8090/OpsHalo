const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { cacheControlForAsset } = require('../../src/app/lib/file-server')

test('HTML and entry bundles always revalidate', () => {
  assert.equal(cacheControlForAsset(path.join('/app/assets', 'index.html')), 'no-cache')
  assert.equal(cacheControlForAsset(path.join('/app/assets/js', 'opshalo-1.0.15.js')), 'no-cache')
  assert.equal(cacheControlForAsset(path.join('/app/assets/css', 'style-1.0.15.css')), 'no-cache')
})

test('only content-hashed dynamic chunks are immutable', () => {
  assert.equal(
    cacheControlForAsset(path.join('/app/assets/chunk', 'ai-chat-1.0.15-Ab12_cd3.js')),
    'public, max-age=31536000, immutable'
  )
  assert.equal(cacheControlForAsset(path.join('/app/assets/chunk', 'ai-chat-1.0.15.js')), 'no-cache')
  assert.equal(cacheControlForAsset(path.join('/app/assets/chunk', 'ai-chat-1.0.15-Ab12_cd3.js'), true), 'no-store')
})
