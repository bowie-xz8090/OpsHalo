const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('crypto')
const {
  SyncClient,
  SyncHttpError,
  signSyncToken
} = require('../../src/app/lib/sync-client')

function recorder (response = { ok: true }) {
  const requests = []
  return {
    requests,
    axios: {
      async request (request) {
        requests.push(request)
        return { data: response }
      }
    }
  }
}

test('GitHub and Gitee sync preserve gist routes and token authentication', async () => {
  for (const [type, server] of [['github', 'https://api.github.com'], ['gitee', 'https://gitee.com/api/v5']]) {
    const { axios, requests } = recorder()
    const client = new SyncClient(axios, type, 'secret')
    await client.run('test', [])
    await client.run('create', [{ files: {} }])
    await client.run('update', ['gist-id', { files: { a: {} } }])
    await client.run('getOne', ['gist-id'])
    assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
      ['GET', `${server}/gists?per_page=1`],
      ['POST', `${server}/gists`],
      ['PATCH', `${server}/gists/gist-id`],
      ['GET', `${server}/gists/gist-id`]
    ])
    assert.ok(requests.every(request => request.headers.Authorization === 'token secret'))
  }
})

test('custom and cloud sync preserve bearer behavior without storing generated credentials', async () => {
  const direct = recorder()
  await new SyncClient(direct.axios, 'cloud', 'access-token####https://sync.example').run('getOne', [])
  assert.equal(direct.requests[0].headers.Authorization, 'Bearer access-token')

  const custom = recorder()
  const client = new SyncClient(custom.axios, 'custom', 'secret####https://sync.example####user-1')
  await client.run('update', ['user-2', { payload: true }])
  const encoded = custom.requests[0].headers.Authorization.replace('Bearer ', '').split('.')
  assert.equal(encoded.length, 3)
  assert.deepEqual(JSON.parse(Buffer.from(encoded[1], 'base64url')), {
    id: 'user-2',
    exp: JSON.parse(Buffer.from(encoded[1], 'base64url')).exp,
    iat: JSON.parse(Buffer.from(encoded[1], 'base64url')).iat
  })
  assert.equal(
    encoded[2],
    createHmac('sha256', 'secret').update(`${encoded[0]}.${encoded[1]}`).digest('base64url')
  )
  assert.deepEqual(custom.requests[0].data, { payload: true })
})

test('sync JWT supports the legacy HMAC algorithms and rejects other algorithms', () => {
  for (const algorithm of ['HS256', 'HS384', 'HS512']) {
    const token = signSyncToken('user', 'secret', algorithm, 100)
    assert.equal(token.split('.').length, 3)
    assert.deepEqual(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')), {
      id: 'user',
      exp: 1000100,
      iat: 0
    })
  }
  assert.throws(() => signSyncToken('user', 'secret', 'RS256'), /Unsupported sync token algorithm/)
})

test('sync HTTP failures keep a readable sanitized response', async () => {
  const axios = {
    async request () {
      const error = new Error('request failed')
      error.response = {
        status: 403,
        statusText: 'Forbidden',
        data: { message: 'denied' },
        config: { url: 'https://sync.example', headers: { safe: true }, transformRequest: () => {} }
      }
      throw error
    }
  }
  await assert.rejects(
    new SyncClient(axios, 'cloud', 'token####https://sync.example').run('test', []),
    error => error instanceof SyncHttpError && error.status === 403 && !('transformRequest' in error.config)
  )
})
