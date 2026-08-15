const { _electron: electron, test, expect } = require('@playwright/test')
const delay = require('./common/wait')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

async function setAgentSession (client, session) {
  await client.evaluate((nextSession) => {
    const tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
    const terminal = tab && window.refs.get(`term-${tab.id}`)
    if (!terminal) throw new Error('Agent UI test requires a mounted terminal')
    terminal.setState({
      smartShellOverlayAnchor: {
        top: 40,
        left: 24,
        width: 760,
        height: 430,
        maxHeight: 430,
        fontSize: 14,
        scale: 1
      },
      agentSession: nextSession
    })
  }, session)
}

test.describe('per-tab Shell and Agent input mode', () => {
  test.setTimeout(100000)

  test('defaults to Shell and keeps each tab selection isolated', async () => {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    try {
      await delay(5000)
      const firstTab = await client.evaluate(async () => {
        await window.store.setConfig({
          agentModeEnabled: true,
          baseURLAI: 'http://127.0.0.1:43434',
          modelAI: 'test-model',
          roleAI: 'test terminal assistant',
          apiKeyAI: 'test-key',
          authHeaderNameAI: 'Authorization: Bearer',
          apiPathAI: '/chat/completions',
          languageAI: 'Chinese'
        })
        let tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        if (!tab) {
          window.store.addTab()
          tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        }
        if (!tab) throw new Error('Test requires an available terminal tab')
        window.store.clickTab(tab.id, tab.batch)
        delete tab.aiInputMode
        return { id: tab.id, batch: tab.batch }
      })

      const modeSwitch = client.locator('.session-current .agent-input-mode-switch')
      await expect(modeSwitch).toBeVisible()
      await expect(modeSwitch.getByRole('button', { name: 'Shell模式' })).toHaveAttribute('aria-pressed', 'true')

      await modeSwitch.getByRole('button', { name: 'Agent模式' }).click()
      await expect(modeSwitch.getByRole('button', { name: 'Agent模式' })).toHaveAttribute('aria-pressed', 'true')
      expect(await client.evaluate(() => {
        return window.store.tabs.find(item => item.id === window.store.activeTabId)?.aiInputMode
      })).toBe('agent')

      const secondTabId = await client.evaluate(() => {
        window.store.addTab()
        return window.store.activeTabId
      })
      await expect(client.locator('.session-current .agent-input-mode-switch')).toBeVisible()
      await expect(client.locator('.session-current .agent-input-mode-option').filter({ hasText: 'Shell模式' })).toHaveAttribute('aria-pressed', 'true')

      await client.evaluate(({ id, batch }) => window.store.clickTab(id, batch), firstTab)
      await expect(client.locator('.session-current .agent-input-mode-option').filter({ hasText: 'Agent模式' })).toHaveAttribute('aria-pressed', 'true')

      expect(await client.evaluate((secondId) => {
        return window.store.tabs.find(item => item.id === secondId)?.aiInputMode
      }, secondTabId)).toBeUndefined()
    } finally {
      await client.evaluate(async () => {
        for (const tab of window.store.tabs) delete tab.aiInputMode
        await window.store.setConfig({ agentModeEnabled: false })
      }).catch(() => {})
      await electronApp.close().catch(() => {})
    }
  })

  test('renders running, approval, handoff, evidence and terminal states accessibly', async () => {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    try {
      await delay(5000)
      const terminalTabId = await client.evaluate(() => {
        let tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        if (!tab) {
          window.store.addTab()
          tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        }
        if (!tab) throw new Error('Test requires an available terminal tab')
        window.store.clickTab(tab.id, tab.batch)
        return tab.id
      })
      await expect.poll(() => client.evaluate(tabId => window.refs.has(`term-${tabId}`), terminalTabId)).toBe(true)
      await client.evaluate((tabId) => {
        const terminal = window.refs.get(`term-${tabId}`)
        terminal.agentTestControlCalls = []
        terminal.handleAgentControl = async (...args) => {
          terminal.agentTestControlCalls.push(args)
          return true
        }
        window.store.getAgentEvidence = async ({ offset }) => ({
          content: offset ? '第二页证据' : '第一页证据',
          totalBytes: 24,
          nextOffset: offset ? null : 12,
          metadata: {
            kind: 'text',
            mediaType: 'text/plain',
            sha256: 'abc123',
            redactionSummary: { count: 1 },
            expiresAt: new Date(Date.now() + 3600000).toISOString()
          }
        })
        window.store.deleteAgentEvidence = async () => ({ deleted: true })
      }, terminalTabId)

      const base = {
        taskId: 'task-ui-test',
        prompt: '排查 api 容器 502',
        binding: { tabId: 'ui-test-tab' },
        budget: {
          elapsedMs: 84000,
          reactSteps: { used: 3, max: 12 },
          autoReadActions: { used: 3, max: 8 }
        },
        plan: {
          planSummary: '确认容器健康状态并检查最近错误',
          missingInformation: ['上游连接错误']
        },
        timeline: [{
          stepId: 'step-3',
          reactStep: 3,
          kind: 'tool',
          status: 'running',
          title: '读取 api 容器最近日志',
          reasonSummary: '验证健康检查失败原因',
          toolName: 'docker.logs',
          targetDisplay: 'api --since 15m --tail 200',
          risk: { r: 'R1', s: 'S1', c: 'C1' },
          progress: { elapsedMs: 4000, capturedBytes: 18600, safeLastLine: 'connection refused' },
          evidenceRefs: [],
          expandedByDefault: true
        }]
      }

      await setAgentSession(client, { ...base, status: 'executing' })
      await expect(client.getByRole('status')).toContainText('正在执行')
      await expect(client.getByRole('log', { name: 'Agent 执行过程' })).toContainText('读取 api 容器最近日志')
      await expect(client.locator('.agent-step-summary')).toHaveAttribute('aria-expanded', 'true')
      await expect(client.locator('.agent-session-overlay-inner')).toContainText('3/12 步')
      await expect(client.locator('.agent-plan-details')).toContainText('正在继续探查 1 项信息')

      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 600))
      await expect.poll(async () => client.locator('.terminal-smart-shell-overlay.is-agent-session').evaluate(element => window.getComputedStyle(element).bottom)).toBe('0px')

      await client.getByRole('button', { name: '关闭并停止 AI' }).click()
      await expect(client.locator('.agent-session-overlay-inner')).toHaveCount(0)
      expect(await client.evaluate((tabId) => {
        const terminal = window.refs.get(`term-${tabId}`)
        return terminal.agentTestControlCalls.at(-1)
      }, terminalTabId)).toEqual(['cancel', { reason: 'user_closed_agent_panel' }])
      await client.evaluate(tabId => { window.refs.get(`term-${tabId}`).agentTestControlCalls = [] }, terminalTabId)

      const approval = {
        approvalRequestId: 'approval-ui-test',
        intentDigest: 'intent-ui-test',
        toolName: 'shell.exec',
        risk: 'R3',
        sensitivity: 'S1',
        cost: 'C1',
        username: 'ops',
        host: 'prod-01',
        port: 22,
        cwd: '/opt/api',
        fullCommandOrArguments: 'systemctl restart api',
        expectedEffect: '重启 api 服务',
        affectedResources: ['systemd:api'],
        privilegeAndInteraction: [],
        timeoutMs: 60000,
        prechecks: ['记录当前 PID'],
        verificationChecks: ['服务 active', '端口 8080'],
        rollbackSummary: '失败后请求人工处置',
        riskReasons: ['服务状态变更'],
        allowedDecisions: ['reject', 'cancel_task', 'approve_once', 'approve_task_exact_match'],
        expiresAt: new Date(Date.now() + 600000).toISOString()
      }
      await setAgentSession(client, { ...base, status: 'awaiting_approval', pendingApproval: approval })
      const approvalCard = client.getByRole('dialog', { name: 'Agent 操作审批' })
      await expect(approvalCard).toContainText('systemctl restart api')
      await expect(approvalCard.getByRole('button', { name: /执行$/ })).toBeVisible()
      await expect(approvalCard.getByRole('button', { name: /修改$/ })).toBeVisible()
      await expect(approvalCard.getByRole('button', { name: /拒绝$/ })).toBeVisible()
      await expect(approvalCard.getByRole('button', { name: '本任务允许完全相同操作', exact: true })).toHaveCount(0)
      await expect(approvalCard.getByRole('button', { name: '取消整个任务', exact: true })).toHaveCount(0)
      await approvalCard.focus()
      await client.keyboard.press('Enter')
      expect(await client.evaluate(() => {
        const tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        return window.refs.get(`term-${tab.id}`).agentTestControlCalls.length
      })).toBe(0)

      await setAgentSession(client, {
        ...base,
        status: 'awaiting_approval',
        pendingApproval: { ...approval, risk: 'R5' }
      })
      await expect(approvalCard).toContainText('该操作已被安全策略阻断')
      await expect(approvalCard.getByRole('button', { name: '执行', exact: true })).toHaveCount(0)
      await expect(approvalCard.getByRole('button', { name: '本任务允许完全相同操作', exact: true })).toHaveCount(0)

      await setAgentSession(client, {
        ...base,
        status: 'awaiting_user',
        pendingUserInput: {
          requestId: 'handoff-ui-test',
          kind: 'terminal_handoff',
          question: 'sudo 正在请求密码'
        }
      })
      await expect(client.locator('.agent-user-input-card')).toContainText('AI 不会读取、保存或输入密码')
      await expect(client.getByRole('button', { name: '接管终端输入' })).toBeVisible()
      await expect(client.locator('.agent-user-input-card textarea')).toHaveCount(0)

      const result = {
        status: 'complete',
        conclusion: '已确认 api 连接数据库失败',
        confirmedFacts: [{ factId: 'fact-1', statement: 'db:5432 connection refused', confidence: 'confirmed' }],
        inferences: [],
        operations: [],
        unresolvedItems: [],
        evidenceRefs: ['evidence://task-ui-test/E-01']
      }
      await setAgentSession(client, { ...base, status: 'complete', finalResult: result })
      await expect(client.locator('.agent-plan-details')).toHaveCount(0)
      await client.getByRole('button', { name: '查看证据' }).click()
      await expect(client.locator('.agent-evidence-content')).toContainText('第一页证据')
      await client.getByRole('button', { name: '加载下一页' }).click()
      await expect(client.locator('.agent-evidence-content')).toContainText('第二页证据')
      await client.locator('.ant-drawer-close').click()

      const finalStates = {
        complete: '排查完成',
        inconclusive: '证据不足',
        blocked: '已阻断',
        partial: '部分完成',
        failed: '任务失败',
        cancelled: '已取消'
      }
      for (const [status, label] of Object.entries(finalStates)) {
        await setAgentSession(client, {
          ...base,
          status,
          finalResult: { ...result, status, conclusion: `${label}测试结论`, evidenceRefs: [] }
        })
        await expect(client.locator('.agent-final-card')).toContainText(label)
        await expect(client.locator('.agent-stop-button')).toHaveCount(0)
        await expect(client.getByRole('button', { name: '关闭 AI 结果' })).toBeVisible()
      }
    } finally {
      await electronApp.close().catch(() => {})
    }
  })

  test('AI settings switch mutually between retained API config and Codex accounts', async () => {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    try {
      await delay(5000)
      await client.evaluate(async () => {
        await window.store.setConfig({
          aiBackendType: 'openai_compatible',
          baseURLAI: 'https://api.example.test/v1',
          apiPathAI: '/chat/completions',
          modelAI: 'retained-model',
          roleAI: 'retained-role',
          apiKeyAI: 'retained-key',
          authHeaderNameAI: 'Authorization: Bearer',
          languageAI: 'Chinese'
        })
        window.store.showAIConfigModal = true
      })

      const modal = client.locator('.ai-config-modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('input[value="https://api.example.test/v1"]')).toBeVisible()
      await modal.getByText('ChatGPT / Codex Subscription', { exact: true }).click()
      await expect(modal.getByText('使用 ChatGPT / Codex 订阅账号')).toBeVisible()
      await expect(modal.getByText('Harness：官方 Codex App Server（固定）')).toBeVisible()
      await expect(modal.locator('input[placeholder="通常留空，使用安装包内置版本"]')).toBeVisible()
      await expect(modal.locator('input[value="https://api.example.test/v1"]')).toHaveCount(0)

      await modal.getByText('API Key / OpenAI Compatible', { exact: true }).click()
      await expect(modal.locator('input[value="https://api.example.test/v1"]')).toBeVisible()
      await expect(modal.locator('input[value="retained-model"]')).toBeVisible()
    } finally {
      await client.evaluate(() => { window.store.showAIConfigModal = false }).catch(() => {})
      await electronApp.close().catch(() => {})
    }
  })

  test('blank upgraded AI settings recover the latest protected history before rendering terminal controls', async () => {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)

    try {
      await delay(5000)
      const recovered = await client.evaluate(async () => {
        const previousHistory = window.localStorage.getItem('ai_config_history')
        const previousConfig = window.store.config
        const history = [{
          aiBackendType: 'openai_compatible',
          baseURLAI: 'https://api.recovery.test/v1',
          apiPathAI: '/chat/completions',
          modelAI: 'recovered-model',
          roleAI: 'terminal expert',
          apiKeyAI: 'recovered-test-key',
          authHeaderNameAI: 'Authorization: Bearer',
          languageAI: 'Chinese',
          agentModeEnabled: true,
          agentMutationEnabled: false,
          agentExternalMcpEnabled: false,
          agentHarnessAdapter: 'openai_compatible'
        }]
        const key = window.pre.runSync('getStorageKey')
        const input = new TextEncoder().encode(JSON.stringify(history))
        const keyBytes = new TextEncoder().encode(key)
        const output = new Uint8Array(input.length)
        for (let index = 0; index < input.length; index++) output[index] = input[index] ^ keyBytes[index % keyBytes.length]
        let binary = ''
        for (const byte of output) binary += String.fromCharCode(byte)
        window.localStorage.setItem('ai_config_history', `enc1:${btoa(binary)}`)
        const blank = {
          ...previousConfig,
          aiBackendType: 'openai_compatible',
          apiKeyAI: '',
          codexProfileId: '',
          agentModeEnabled: false,
          agentMutationEnabled: false,
          agentExternalMcpEnabled: false
        }
        window.et.globs = { ...(window.et.globs || {}), config: blank }
        window.store._config = blank
        await window.store.initApp()
        let tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        if (!tab) {
          window.store.addTab()
          tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
        }
        if (tab) window.store.clickTab(tab.id, tab.batch)
        window.__aiRecoveryCleanup = { previousHistory, previousConfig }
        return {
          apiKeyPresent: Boolean(window.store.config.apiKeyAI),
          modelAI: window.store.config.modelAI,
          agentModeEnabled: window.store.config.agentModeEnabled
        }
      })
      expect(recovered).toEqual({ apiKeyPresent: true, modelAI: 'recovered-model', agentModeEnabled: true })
      await expect(client.locator('.session-current .agent-input-mode-switch')).toBeVisible()
    } finally {
      await client.evaluate(() => {
        const cleanup = window.__aiRecoveryCleanup
        if (!cleanup) return
        if (cleanup.previousHistory === null) window.localStorage.removeItem('ai_config_history')
        else window.localStorage.setItem('ai_config_history', cleanup.previousHistory)
        window.store._config = cleanup.previousConfig
        if (window.et.globs) window.et.globs.config = cleanup.previousConfig
        delete window.__aiRecoveryCleanup
      }).catch(() => {})
      await electronApp.close().catch(() => {})
    }
  })
})
