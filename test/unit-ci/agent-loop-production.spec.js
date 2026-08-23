const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { classifyHarnessError } = require('../../src/app/agent/harness/harness-errors')
const {
  PlannerDecisionWireSchema,
  PlannerOutputJsonSchema,
  ActionSelectionJsonSchema,
  decodePlannerDecision,
  decodeReadProbeBundle
} = require('../../src/app/agent/harness/planner-protocol')
const { prepareTurnInput } = require('../../src/app/agent/session/context-manager')
const { selectPublicTools } = require('../../src/app/agent/tools/tool-selector')
const { buildPrompt } = require('../../src/app/agent/harness/prompt-builder')
const { ToolRegistry } = require('../../src/app/agent/tools/registry')
const { registerDockerTools } = require('../../src/app/agent/tools/builtin/docker-tools')
const { registerShellTools } = require('../../src/app/agent/tools/builtin/shell-tools')
const { analyzeShell } = require('../../src/app/agent/policy/shell-analyzer')
const { PolicyEngine } = require('../../src/app/agent/policy/policy-engine')
const { normalizeIntent } = require('../../src/app/agent/tools/intent-normalizer')
const { parseResultView, parseListeningPortsInspection } = require('../../src/app/agent/observation/parsers')
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
  assert.equal(Object.keys(ActionSelectionJsonSchema.properties).length, 11)
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

test('provider bundle protocol accepts only catalogued parallel-safe structured reads', () => {
  const input = {
    taskId: 'task_bundle_wire_12345',
    availableTools: [
      { name: 'service.status', version: '1', category: 'read', mutability: 'none', parallelSafe: true },
      { name: 'network.ports', version: '1', category: 'probe', mutability: 'none', parallelSafe: true },
      { name: 'shell.review_exec', version: '1', category: 'read', mutability: 'none', parallelSafe: false }
    ]
  }
  const raw = JSON.stringify([
    {
      toolName: 'service.status',
      arguments: { service: 'nginx' },
      target: { kind: 'service', canonicalId: 'nginx', display: 'nginx' },
      purpose: 'read service state',
      expectedObservation: 'service state'
    },
    {
      toolName: 'network.ports',
      arguments: { port: 80 },
      target: { kind: 'port', canonicalId: '80', display: 'port 80' },
      purpose: 'read listener state',
      expectedObservation: 'listener state'
    }
  ])
  const bundle = decodeReadProbeBundle(raw, input)
  assert.equal(bundle.actions.length, 2)
  assert.deepEqual(bundle.actions.map(item => item.intent.toolName), ['service.status', 'network.ports'])
  assert.equal(bundle.actions.every(item => item.intent.taskId === input.taskId), true)
  assert.throws(() => decodeReadProbeBundle(JSON.stringify([
    JSON.parse(raw)[0],
    { ...JSON.parse(raw)[1], toolName: 'shell.review_exec' }
  ]), input), /not parallel-safe/)
})

test('compact native action selection is expanded into a trusted planner decision', () => {
  const decision = decodePlannerDecision({
    outcome: 'act',
    summary: '检查 Nginx 生效配置',
    toolName: 'docker.list',
    argumentsJson: '{}',
    targetKind: 'container',
    targetId: 'nginx',
    targetDisplay: 'Nginx 容器',
    expectedObservation: '配置校验结果和生效配置',
    verificationPlanJson: null,
    message: null
  }, {
    taskId: 'task_compact_12345',
    availableTools: [{ name: 'docker.list', version: '1' }],
    workingMemory: { facts: [], completionCriteria: [] }
  })
  assert.equal(decision.goalStatus, 'continue')
  assert.equal(decision.action.toolName, 'docker.list')
  assert.deepEqual(decision.action.arguments, {})
  assert.equal(decision.completionCriteria.length, 1)
})

test('planner contract preserves natural-language scope and requires reviewed terminal probes', () => {
  const prompt = buildPrompt({
    taskId: 'task_scope_12345',
    objective: '查询 nginx 配置文件位置',
    uiLocale: 'zh-CN',
    mode: 'query',
    sessionSummary: { host: 'example.test', username: 'root', cwd: '/root', shell: '/bin/bash', platform: 'linux' },
    workingMemory: memory(),
    budgetRemaining: {},
    availableTools: [{ name: 'shell.review_exec', version: '1' }]
  })
  assert.match(prompt, /generate one minimal bounded command with shell\.review_exec/)
  assert.match(prompt, /request for a file path or location means return only the path/)
  assert.match(prompt, /Do not run a validator, test, status command, or diagnostic/)
  assert.match(prompt, /Do not reuse commands, targets, or follow-up steps/)
  assert.doesNotMatch(prompt, /SYNTAX CHECK|MAIN CONFIG|conf\.d\/\*\.conf/)
})

test('reviewed listening-port command passes the read-only executor and its output is parsed', async () => {
  const output = '---LISTENING PORTS---\ntcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=12,fd=6))\nudp UNCONN 0 0 127.0.0.1:323 0.0.0.0:* users:(("chronyd",pid=6,fd=5))'
  const route = { toolName: 'shell.review_exec', arguments: { command: 'ss -H -lntup | head -n 100' } }
  const analysis = analyzeShell(route.arguments.command)
  assert.equal(analysis.risk, 'R2')
  assert.equal(analysis.riskSignals.some(item => item.code === 'mutation_signal'), false)
  const registry = new ToolRegistry()
  registerShellTools(registry, { execute: async () => ({ stdout: output, stderr: '', exitCode: 0 }) })
  const result = await registry.get(route.toolName).executor({ arguments: route.arguments, intent: { toolName: route.toolName } })
  assert.equal(result.exitCode, 0)
  const parsed = parseListeningPortsInspection(output)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].local, '0.0.0.0:80')
  const view = parseResultView('shell.review_exec', output)
  assert.equal(view.kind, 'list')
  assert.equal(view.matchedCount, 2)
})

test('tool selector always prioritizes reviewed shell commands for natural-language operations', () => {
  const names = [
    'session.describe', 'host.profile', 'process.list', 'network.ports', 'service.status', 'service.logs',
    'docker.list', 'docker.inspect', 'docker.logs', 'docker.stats', 'filesystem.list', 'config.read_limited', 'shell.review_exec', 'shell.exec'
  ]
  const descriptors = names.map(name => ({ name, description: name, inputSchema: {} }))
  const selected = selectPublicTools(descriptors, { objective: '排查 Docker 中 nginx 容器状态与日志' })
  assert.equal(selected.length <= 8, true)
  assert.equal(selected[0].name, 'shell.review_exec')
  assert.equal(selected.some(item => item.name === 'shell.exec'), true)
  assert.equal(selected.some(item => item.name === 'docker.list'), false)
  assert.equal(selected.some(item => item.name === 'docker.logs'), false)
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
})

test('bounded nginx config output remains available to internal verification', async () => {
  const registry = new ToolRegistry()
  registerDockerTools(registry, {
    execute: async payload => {
      assert.match(payload.arguments.command, /docker exec -- 'nginx-lb' nginx -T/)
      return { stdout: 'nginx: configuration file /etc/nginx/nginx.conf test is successful\nworker_processes auto;\nevents {}\nhttp { server { listen 80; } }', stderr: '', exitCode: 0 }
    }
  })
  const result = await registry.get('docker.nginx_config').executor({ arguments: { container: 'nginx-lb' }, intent: { toolName: 'docker.nginx_config' } })
  assert.match(result.stdout, /worker_processes auto/)
})

test('every reviewed shell command allows only one-shot approval', () => {
  const registry = new ToolRegistry()
  registerShellTools(registry, { execute: async () => ({ stdout: '', stderr: '', exitCode: 0 }) })
  const registered = registry.get('shell.review_exec')
  const args = { command: 'nginx -V 2>&1 | sed -n "s/.*--conf-path=\\([^ ]*\\).*/\\1/p"' }
  const intent = normalizeIntent({
    schemaVersion: 1,
    invocationId: 'invocation_nginx_path_12345',
    taskId: 'task_nginx_path_12345',
    toolName: 'shell.review_exec',
    toolVersion: '1',
    arguments: args,
    target: { kind: 'file', canonicalId: 'nginx-config-path', display: 'Nginx 配置文件位置' },
    purpose: '查询 Nginx 配置文件位置',
    expectedObservation: '主配置文件路径'
  }, registered.definition, args)
  const policy = new PolicyEngine().evaluate({ taskId: 'task_nginx_path_12345' }, registered.definition, intent)
  assert.equal(policy.outcome, 'require_approval')
  assert.deepEqual(policy.allowedApprovalScopes, ['once'])
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
