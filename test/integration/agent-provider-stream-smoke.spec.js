const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')

const appRoot = process.env.OPSHALO_APP_ROOT || path.resolve(__dirname, '../../work/app')
const { OpenAICompatibleHarnessAdapter } = require(path.join(appRoot, 'agent/harness/openai-harness-adapter'))
const { StrandsHarnessAdapter } = require(path.join(appRoot, 'agent/harness/strands-harness-adapter'))

const actionSelection = {
  outcome: 'ask',
  summary: 'Need a service name.',
  toolName: null,
  argumentsJson: null,
  targetKind: null,
  targetId: null,
  targetDisplay: null,
  expectedObservation: null,
  verificationPlanJson: null,
  message: 'Which service should be inspected?'
}

const strandsDecision = {
  schemaVersion: 1,
  goalStatus: 'need_user',
  planSummary: 'Need a service name.',
  reasonSummary: 'The target service is not specified.',
  knownFactIds: [],
  missingInformation: ['service name'],
  expectedObservation: null,
  action: null,
  readProbeBundleJson: null,
  completionCriteria: [],
  userQuestion: 'Which service should be inspected?'
}

test('OpenAI-compatible adapter completes a real loopback HTTP/SSE stream', async t => {
  const fixture = await startProviderFixture()
  t.after(() => fixture.close())
  const adapter = new OpenAICompatibleHarnessAdapter(config(fixture.baseURL))
  t.after(() => adapter.dispose())

  const events = await collect(adapter.runTurn(input(), new AbortController().signal))

  assert.equal(events.at(-1).type, 'decision.completed')
  assert.equal(events.at(-1).decision.goalStatus, 'need_user')
  assert.equal(events.at(-1).decision.userQuestion, actionSelection.message)
  assert.ok(events.some(event => event.type === 'usage'))
  assert.deepEqual(fixture.requests.map(item => item.toolName), ['submit_agent_decision'])
  assert.ok(fixture.requests.every(item => item.stream === true && item.authHeaderSeen))
})

test('Strands SDK adapter completes a real loopback HTTP/SSE stream', async t => {
  const fixture = await startProviderFixture()
  t.after(() => fixture.close())
  const adapter = new StrandsHarnessAdapter(config(fixture.baseURL))
  t.after(() => adapter.dispose())

  const events = await collect(adapter.runTurn(input(), new AbortController().signal))

  assert.equal(events.at(-1).type, 'decision.completed')
  assert.equal(events.at(-1).decision.goalStatus, 'need_user')
  assert.equal(events.at(-1).decision.userQuestion, strandsDecision.userQuestion)
  assert.ok(events.some(event => event.type === 'usage'))
  assert.deepEqual(fixture.requests.map(item => item.toolName), ['strands_structured_output'])
  assert.ok(fixture.requests.every(item => item.stream === true && item.authHeaderSeen))
})

function config (baseURLAI) {
  return {
    baseURLAI,
    apiPathAI: '/chat/completions',
    apiKeyAI: 'loopback-smoke-key',
    authHeaderNameAI: 'Authorization: Bearer',
    modelAI: 'loopback-smoke-model',
    agentPlannerModel: 'loopback-smoke-model',
    agentStreamingEnabled: true,
    agentModelTimeoutMs: 5000,
    agentMaxOutputTokens: 512,
    agentMaxContextTokens: 8192
  }
}

function input () {
  return {
    schemaVersion: 1,
    taskId: 'task_provider_smoke_12345',
    objective: 'Inspect a service without making changes.',
    mode: 'diagnose',
    uiLocale: 'en-US',
    sessionSummary: {
      host: 'fixture.invalid',
      username: 'tester',
      cwd: '/srv/app',
      shell: '/bin/bash',
      platform: 'linux'
    },
    workingMemory: {
      objective: 'Inspect a service without making changes.',
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
    },
    budgetRemaining: {},
    availableTools: []
  }
}

async function collect (iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

async function startProviderFixture () {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req)
    const toolName = body.tools?.[0]?.function?.name
    requests.push({
      path: req.url,
      stream: body.stream,
      toolName,
      authHeaderSeen: /^Bearer\s+\S+$/i.test(String(req.headers.authorization || ''))
    })
    const args = JSON.stringify(toolName === 'strands_structured_output' ? strandsDecision : actionSelection)
    const splitAt = Math.max(1, Math.floor(args.length / 2))
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(sseChunk({
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: 'call_provider_smoke', type: 'function', function: { name: toolName, arguments: args.slice(0, splitAt) } }]
        },
        finish_reason: null
      }]
    }))
    setTimeout(() => {
      res.write(sseChunk({
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(splitAt) } }] },
          finish_reason: 'tool_calls'
        }]
      }))
      res.write(sseChunk({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }))
      res.end('data: [DONE]\n\n')
    }, 20)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    requests,
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

function sseChunk (payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function readJson (req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
