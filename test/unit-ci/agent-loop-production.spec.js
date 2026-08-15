const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { classifyHarnessError } = require('../../src/app/agent/harness/harness-errors')
const {
  PlannerDecisionWireSchema,
  PlannerOutputJsonSchema,
  decodePlannerDecision
} = require('../../src/app/agent/harness/planner-protocol')
const { routeFastQuery } = require('../../src/app/agent/session/fast-query-router')
const { prepareTurnInput } = require('../../src/app/agent/session/context-manager')
const { selectPublicTools } = require('../../src/app/agent/tools/tool-selector')
const { ToolRegistry } = require('../../src/app/agent/tools/registry')
const { registerDockerTools } = require('../../src/app/agent/tools/builtin/docker-tools')
const { parseResultView } = require('../../src/app/agent/observation/parsers')
const { formatResult } = require('../../src/app/agent/verification/result-projector')
const { invokeAgentWithTimeout } = require('../../src/app/agent/harness/strands-harness-adapter')

test('provider schema errors containing context are not misclassified as context exhaustion', () => {
  const schema = classifyHarnessError(new Error("Invalid schema for response_format: In context=('properties', 'arguments'), 'propertyNames' is not permitted. code=invalid_json_schema"))
  assert.equal(schema.category, 'invalid_model_output')
  const context = classifyHarnessError(Object.assign(new Error('maximum context length exceeded: input tokens are too many'), { code: 'context_length_exceeded' }))
  assert.equal(context.category, 'context_exhausted')
  const rate = classifyHarnessError(Object.assign(new Error('too many requests'), { status: 429 }))
  assert.equal(rate.category, 'rate_limited')
  assert.equal(rate.retryable, true)
})

test('all planner adapters can use one provider-safe wire schema', () => {
  const generated = z.toJSONSchema(PlannerDecisionWireSchema)
  assert.equal(JSON.stringify(generated).includes('propertyNames'), false)
  assert.equal(JSON.stringify(PlannerOutputJsonSchema).includes('propertyNames'), false)
  const decision = decodePlannerDecision({
    schemaVersion: 1,
    goalStatus: 'continue',
    planSummary: 'list containers',
    reasonSummary: 'read-only query',
    knownFactIds: [],
    missingInformation: ['container list'],
    expectedObservation: 'matching containers',
    action: {
      toolName: 'docker.list',
      toolVersion: '1',
      argumentsJson: '{"state":"all","query":"nginx","limit":20}',
      target: { kind: 'container', canonicalId: 'nginx', display: 'nginx containers' },
      requestedTimeoutMs: null,
      purpose: 'list containers',
      expectedObservation: 'matching containers',
      verificationPlanJson: null
    },
    completionCriteria: [],
    userQuestion: null
  }, { taskId: 'task_wire_12345' })
  assert.deepEqual(decision.action.arguments, { state: 'all', query: 'nginx', limit: 20 })
  assert.equal(decision.action.taskId, 'task_wire_12345')
})

test('fast query routing is high-confidence and excludes diagnosis or changes', () => {
  const direct = routeFastQuery({ taskId: 'task_fast_12345', prompt: '查询docker中的nginx' })
  assert.equal(direct.route.toolName, 'docker.list')
  assert.equal(direct.route.arguments.query, 'nginx')
  assert.equal(routeFastQuery({ taskId: 'task_diag_12345', prompt: '排查docker中的nginx为什么反复重启' }), null)
  assert.equal(routeFastQuery({ taskId: 'task_change_12345', prompt: '重启 nginx 服务' }), null)
  const service = routeFastQuery({ taskId: 'task_service_12345', prompt: '查询 nginx 服务状态' })
  assert.equal(service.route.toolName, 'service.status')
  assert.equal(service.route.arguments.service, 'nginx')
  const config = routeFastQuery({ taskId: 'task_config_12345', prompt: '查看docker nginx-lb的nginx配置' })
  assert.equal(config.route.toolName, 'docker.nginx_config')
  assert.equal(config.route.arguments.container, 'nginx-lb')
  assert.equal(routeFastQuery({ taskId: 'task_config_change_12345', prompt: '修改docker nginx-lb的nginx配置' }), null)
})

test('tool selector sends a small goal-relevant catalog', () => {
  const names = [
    'session.describe', 'host.profile', 'process.list', 'network.ports', 'service.status', 'service.logs',
    'docker.list', 'docker.inspect', 'docker.logs', 'docker.stats', 'filesystem.list', 'config.read_limited', 'shell.exec'
  ]
  const descriptors = names.map(name => ({ name, description: name, inputSchema: {} }))
  const selected = selectPublicTools(descriptors, { objective: '排查 Docker 中 nginx 容器状态与日志' })
  assert.equal(selected.length <= 8, true)
  assert.equal(selected.some(item => item.name === 'docker.list'), true)
  assert.equal(selected.some(item => item.name === 'docker.logs'), true)
  assert.equal(selected.some(item => item.name === 'session.describe'), true)
})

test('context accounting measures the final serialized prompt and only exhausts a minimal oversized turn', () => {
  const input = {
    schemaVersion: 1,
    taskId: 'task_context_12345',
    objective: '查询 docker 中的 nginx',
    mode: 'diagnose',
    uiLocale: 'zh-CN',
    sessionSummary: { host: 'example.test', username: 'root', cwd: '/root', shell: '/bin/bash', platform: 'linux' },
    workingMemory: memory(),
    budgetRemaining: {},
    availableTools: Array.from({ length: 20 }, (_, index) => ({ name: `tool.${index}`, description: 'x'.repeat(200), inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }))
  }
  const normal = prepareTurnInput(input, 32000)
  assert.equal(normal.exhausted, false)
  assert.equal(normal.metrics.promptTokens > 1000, true)
  assert.equal(normal.metrics.promptBytes > JSON.stringify(input.workingMemory).length, true)
  const tiny = prepareTurnInput(input, 1200)
  assert.equal(tiny.exhausted, true)
  assert.equal(tiny.input.availableTools.length <= 4, true)
})

test('docker query is applied before the result limit and reports scan versus match counts', async () => {
  const registry = new ToolRegistry()
  registerDockerTools(registry, {
    execute: async () => ({
      stdout: [
        'aaa\tapp\tcompany/app:1\trunning\tUp 1 hour\t',
        'bbb\tnginx-lb\tnginx:1.27\trunning\tUp 1 hour\t0.0.0.0:80->80/tcp',
        'ccc\tworker\tcompany/worker:1\texited\tExited (0)\t'
      ].join('\n'),
      stderr: '',
      exitCode: 0
    })
  })
  const item = registry.get('docker.list')
  const result = await item.executor({ arguments: { state: 'all', query: 'nginx', limit: 10 }, intent: { toolName: 'docker.list' } })
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.data.totalScanned, 3)
  assert.equal(envelope.data.matchedCount, 1)
  assert.equal(envelope.data.items[0].name, 'nginx-lb')
})

test('display truncation does not turn a complete server query into an incomplete result', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({ id: String(index), name: `nginx-${index}`, image: 'nginx:1.27', state: 'running' }))
  const view = parseResultView('docker.list', JSON.stringify({ data: { items, totalScanned: 40, matchedCount: 40, query: 'nginx', partial: false } }))
  assert.equal(view.rows.length, 30)
  assert.equal(view.partial, false)
  assert.equal(view.displayTruncated, true)
  assert.match(formatResult('docker-list', view), /另有 10 项未展开/)
})

test('bounded nginx config output is projected without another model turn', async () => {
  const registry = new ToolRegistry()
  registerDockerTools(registry, {
    execute: async payload => {
      assert.match(payload.arguments.command, /docker exec -- 'nginx-lb' nginx -T/)
      return { stdout: 'nginx: configuration file /etc/nginx/nginx.conf test is successful\nworker_processes auto;\nevents {}\nhttp { server { listen 80; } }', stderr: '', exitCode: 0 }
    }
  })
  const result = await registry.get('docker.nginx_config').executor({ arguments: { container: 'nginx-lb' }, intent: { toolName: 'docker.nginx_config' } })
  const view = parseResultView('docker.nginx_config', result.stdout)
  assert.equal(view.partial, false)
  assert.match(formatResult('docker-nginx-config', view), /worker_processes auto/)
})

test('Strands planning has a hard deadline and cancels the SDK request', async () => {
  let cancelled = 0
  const agent = { invoke: () => new Promise(() => {}), cancel: () => { cancelled++ } }
  await assert.rejects(invokeAgentWithTimeout(agent, 'prompt', undefined, 20), error => error.code === 'ETIMEDOUT')
  assert.equal(cancelled, 1)
})

function memory () {
  return {
    objective: 'query',
    scope: [],
    completionCriteria: [],
    planSummary: '',
    reasonSummary: '',
    facts: [],
    hypotheses: [],
    missingInformation: [],
    recentObservationIds: [],
    changeRecords: [],
    verificationObligations: [],
    contradictions: []
  }
}
