const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

let formatDockers

describe('formatDockers', () => {
  test('setup: import ESM module', async () => {
    const mod = await import('../../src/client/components/terminal-info/format-dockers.js')
    formatDockers = mod.default
  })

  test('returns an empty list for empty or invalid output', () => {
    assert.deepStrictEqual(formatDockers('', ''), { dockers: [] })
    assert.deepStrictEqual(formatDockers('docker warning', 'bad json'), { dockers: [] })
  })

  test('merges inspect and stats data and lists every mapped port', () => {
    const fullId = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const inspect = JSON.stringify({
      Id: fullId,
      Name: '/web',
      Config: {
        Image: 'example/web:latest',
        Labels: {
          'com.docker.compose.project.working_dir': '/srv/example',
          'com.docker.compose.project.config_files': '/srv/example/compose.yml,/srv/example/compose.prod.yml'
        }
      },
      State: {
        Status: 'running',
        StartedAt: '2026-08-12T01:02:03Z',
        Health: { Status: 'healthy' }
      },
      Created: '2026-08-11T01:02:03Z',
      RestartCount: 3,
      HostConfig: {
        PortBindings: {
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '127.0.0.1', HostPort: '8081' }
          ]
        }
      },
      NetworkSettings: {
        Ports: {
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '127.0.0.1', HostPort: '8081' }
          ],
          '443/tcp': [{ HostIp: '::', HostPort: '8443' }]
        }
      }
    })
    const stats = JSON.stringify({
      ID: fullId,
      Name: 'web',
      CPUPerc: '2.50%',
      MemPerc: '8.75%'
    })
    const { dockers } = formatDockers(inspect, stats)
    assert.strictEqual(dockers.length, 1)
    assert.deepStrictEqual(dockers[0], {
      name: 'web',
      containerId: '1234567890ab',
      fullId,
      image: 'example/web:latest',
      status: 'running (healthy)',
      ports: '8080->80/tcp, 127.0.0.1:8081->80/tcp, [::]:8443->443/tcp',
      cpu: '2.50%',
      mem: '8.75%',
      created: '2026-08-11T01:02:03Z',
      lastStarted: '2026-08-12T01:02:03Z',
      restartCount: 3,
      workingDir: '/srv/example',
      configFiles: '/srv/example/compose.yml,/srv/example/compose.prod.yml'
    })
  })

  test('keeps stopped containers without stats data', () => {
    const inspect = JSON.stringify({
      Id: 'abcdef1234567890',
      Name: '/worker',
      Config: { Image: 'example/worker:1', Labels: null },
      State: { Status: 'exited', StartedAt: '0001-01-01T00:00:00Z' },
      RestartCount: 0,
      HostConfig: { PortBindings: null },
      NetworkSettings: { Ports: null }
    })
    const { dockers } = formatDockers(inspect, '')
    assert.strictEqual(dockers.length, 1)
    assert.strictEqual(dockers[0].status, 'exited')
    assert.strictEqual(dockers[0].cpu, '')
    assert.strictEqual(dockers[0].mem, '')
    assert.strictEqual(dockers[0].restartCount, 0)
  })
})
