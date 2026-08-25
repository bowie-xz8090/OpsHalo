const { _electron: electron, test, expect } = require('@playwright/test')
const delay = require('./common/wait')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

async function setAgentSession (client, session) {
  await client.evaluate(async (nextSession) => {
    const tab = window.store.tabs.find(item => item.id === window.store.activeTabId) || window.store.tabs[0]
    const terminal = tab && window.refs.get(`term-${tab.id}`)
    if (!terminal) throw new Error('Agent UI test requires a mounted terminal')
    terminal.setState({ agentSession: nextSession })
    terminal.renderAgentEmbeddedSession(nextSession)
    await terminal._agentEmbeddedUpdateQueue
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

  test('keeps the full executed approval in xterm history and waits for the final result body', async () => {
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
      await expect.poll(() => client.evaluate(tabId => !!window.refs.get(`term-${tabId}`)?.term, terminalTabId)).toBe(true)
      await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        terminal.agentTestControlCalls = []
        terminal.handleAgentControl = async (...args) => {
          terminal.agentTestControlCalls.push(args)
          return true
        }
      }, terminalTabId)

      const base = {
        taskId: 'task-embedded-ui-test',
        prompt: '排查 api 容器 502',
        binding: { tabId: terminalTabId },
        status: 'planning',
        snapshotVersion: 1,
        lastEventSequence: 1,
        budget: {
          elapsedMs: 4000,
          reactSteps: { used: 2, max: 12 },
          autoReadActions: { used: 1, max: 8 }
        },
        timeline: []
      }
      await setAgentSession(client, base)
      const decorations = client.locator('.agent-session-decoration')
      await expect(decorations).toHaveCount(1)
      await expect(decorations.first().locator('.agent-session-overlay-inner.is-embedded')).toBeVisible()
      await expect(decorations.first()).toContainText('AI 正在')

      const approval = {
        approvalRequestId: 'approval-embedded-ui-test',
        intentDigest: 'intent-embedded-ui-test',
        toolName: 'shell.review_exec',
        risk: 'R1',
        sensitivity: 'S1',
        cost: 'C1',
        username: 'ops',
        host: 'prod-01',
        port: 22,
        cwd: '/opt/api',
        fullCommandOrArguments: 'ps -ef | grep api',
        expectedEffect: '查看 api 进程',
        affectedResources: [],
        privilegeAndInteraction: [],
        timeoutMs: 60000,
        prechecks: [],
        verificationChecks: ['获得进程列表'],
        rollbackSummary: '只读操作无需回滚',
        riskReasons: ['只读进程查询'],
        allowedDecisions: ['reject', 'approve_once'],
        expiresAt: new Date(Date.now() + 600000).toISOString()
      }
      await setAgentSession(client, {
        ...base,
        status: 'awaiting_approval',
        snapshotVersion: 2,
        lastEventSequence: 4,
        pendingApproval: approval,
        timeline: [{
          stepId: 'step-2',
          reactStep: 2,
          kind: 'approval',
          status: 'awaiting',
          title: '查看 api 进程',
          expandedByDefault: true
        }]
      })
      const approvalCard = decorations.first().getByRole('dialog', { name: 'Agent 操作审批' })
      await expect(approvalCard).toContainText('ps -ef | grep api')
      await expect(approvalCard.getByRole('button', { name: /执行$/ })).toBeVisible()
      await expect(decorations.first().locator('.agent-session-meta')).toContainText('第 2 步')
      await expect(decorations.first().locator('.agent-session-meta')).not.toContainText('/12')
      const approvalRows = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        return [...terminal._agentEmbeddedEntries.values()][0].rows
      }, terminalTabId)
      expect(approvalRows).toBeGreaterThan(2)

      await approvalCard.getByRole('button', { name: /执行$/ }).click()
      await expect(decorations).toHaveCount(1)
      await expect(decorations.first().locator('.agent-session-header')).toContainText('已执行步骤')
      await expect(decorations.first().locator('.agent-approval-card')).toHaveClass(/is-resolved/)
      await expect(decorations.first().getByRole('dialog', { name: 'Agent 操作审批' })).toContainText('已执行以下操作')
      await expect(decorations.first()).toContainText('ps -ef | grep api')
      await expect(decorations.first()).toContainText('R1 低风险只读')
      await expect(decorations.first().getByRole('button', { name: /执行$/ })).toHaveCount(0)
      await expect(decorations.first().getByRole('button', { name: '拒绝' })).toHaveCount(0)
      const resolvedApprovalLayout = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        const entry = [...terminal._agentEmbeddedEntries.values()][0]
        return { rows: entry.rows, frozen: entry.frozen }
      }, terminalTabId)
      expect(resolvedApprovalLayout.rows).toBeGreaterThan(2)
      expect(resolvedApprovalLayout.rows).toBeLessThanOrEqual(approvalRows)
      expect(resolvedApprovalLayout.frozen).toBe(true)
      await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        terminal._agentNativeTerminalTasks.add('task-embedded-ui-test')
        terminal._agentNativeTerminalRunningTasks.add('task-embedded-ui-test')
      }, terminalTabId)

      await setAgentSession(client, {
        ...base,
        status: 'planning',
        snapshotVersion: 3,
        lastEventSequence: 5,
        budget: { ...base.budget, reactSteps: { used: 3, max: 12 } }
      })
      await setAgentSession(client, {
        ...base,
        status: 'awaiting_approval',
        snapshotVersion: 2,
        lastEventSequence: 4,
        pendingApproval: approval
      })
      await expect(decorations).toHaveCount(1)
      await expect.poll(() => client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        return {
          status: terminal._agentPendingNativeSessions.get('task-embedded-ui-test')?.status,
          consumedApprovalIds: [...terminal._agentConsumedApprovalIds],
          controlChoice: terminal.agentTestControlCalls.at(-1)?.[1]?.decision?.choice
        }
      }, terminalTabId)).toEqual({
        status: 'planning',
        consumedApprovalIds: ['approval-embedded-ui-test'],
        controlChoice: 'approve_once'
      })

      const planningPlacement = await client.evaluate(async tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        await terminal.writeTerminal('[root@test ~]# ps -ef | grep api\r\napi output\r\n[root@test ~]# ')
        terminal._agentNativeTerminalCompletionSignals.add('task-embedded-ui-test')
        terminal.flushAgentNativeTerminalCompletion()
        await terminal._agentEmbeddedUpdateQueue
        await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
        const entries = [...terminal._agentEmbeddedEntries.values()]
        const entry = entries.at(-1)
        const previousLine = terminal.term.buffer.active.getLine(entry.marker.line - 1)?.translateToString(true)
        const terminalLines = Array.from(
          { length: terminal.term.buffer.active.length },
          (_, index) => terminal.term.buffer.active.getLine(index)?.translateToString(true)
        )
        return {
          previousLine,
          historyMarkerLine: entries[0].marker.line,
          commandLine: terminalLines.findIndex(line => line === '[root@test ~]# ps -ef | grep api'),
          planningMarkerLine: entry.marker.line,
          rows: entry.rows,
          height: entry.element?.getBoundingClientRect().height,
          cellHeight: terminal.term.dimensions?.css?.cell?.height || (terminal.domRef.current.clientHeight / terminal.term.rows),
          terminalText: terminalLines.join('\n')
        }
      }, terminalTabId)
      await expect(decorations).toHaveCount(2)
      await expect(decorations.first().locator('.agent-session-header')).toContainText('已执行步骤')
      await expect(decorations.first()).toContainText('ps -ef | grep api')
      await expect(decorations.last()).toContainText('AI 正在')
      await expect(decorations.getByRole('dialog', { name: 'Agent 操作审批' })).toHaveCount(1)
      expect(planningPlacement.previousLine).toBe('[root@test ~]# ')
      expect(planningPlacement.historyMarkerLine).toBeLessThan(planningPlacement.commandLine)
      expect(planningPlacement.commandLine).toBeLessThan(planningPlacement.planningMarkerLine)
      expect(planningPlacement.rows).toBe(2)
      expect(planningPlacement.height).toBeLessThanOrEqual(planningPlacement.cellHeight * 2 + 1)
      expect(planningPlacement.terminalText).toContain('[root@test ~]# ps -ef | grep api\napi output\n[root@test ~]# ')

      await setAgentSession(client, {
        ...base,
        status: 'complete',
        snapshotVersion: 4,
        lastEventSequence: 6,
        budget: { ...base.budget, reactSteps: { used: 3, max: 12 } }
      })
      await expect(decorations).toHaveCount(2)
      await expect(decorations.last()).toContainText('AI 正在')
      await expect(decorations.last().locator('.agent-session-header')).not.toContainText('已结束')

      await setAgentSession(client, {
        ...base,
        status: 'complete',
        snapshotVersion: 5,
        lastEventSequence: 7,
        budget: { ...base.budget, reactSteps: { used: 3, max: 12 } },
        finalResult: {
          status: 'complete',
          conclusion: 'API 进程正在运行。',
          confirmedFacts: Array.from({ length: 18 }, (_, index) => ({
            factId: `fact-embedded-ui-${index}`,
            statement: `api 实例 ${index + 1} 的进程正在运行，命令输出包含该实例的进程号、启动用户与完整启动参数`,
            confidence: 'confirmed'
          })),
          inferences: [],
          operations: [],
          unresolvedItems: [],
          evidenceRefs: []
        }
      })
      await expect(decorations).toHaveCount(2)
      await expect(decorations.first().locator('.agent-session-header')).toContainText('已执行步骤')
      await expect(decorations.first()).toContainText('ps -ef | grep api')
      await expect(decorations.last().locator('.agent-session-header')).toContainText('已结束')
      await expect(decorations.last().locator('.agent-final-card')).toContainText('分析结果')
      await expect(decorations.last().locator('.agent-final-card')).toContainText('API 进程正在运行。')
      await expect(decorations.last().locator('.agent-final-card button')).toHaveCount(0)
      await expect(decorations.last().locator('.agent-final-card')).not.toContainText('查看证据')
      await expect(decorations.last().locator('.agent-final-card')).not.toContainText('清理证据')
      await expect(decorations.last().locator('.agent-final-card')).not.toContainText('继续追问')
      await expect(decorations.last().locator('.agent-timeline')).toHaveCount(0)
      const details = decorations.last().locator('.agent-final-details')
      await expect(details).not.toHaveAttribute('open', '')
      const collapsedLayout = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        const entry = [...terminal._agentEmbeddedEntries.values()].at(-1)
        return {
          rows: entry.rows,
          markerLine: entry.marker.line,
          cursorLine: terminal.term.buffer.active.baseY + terminal.term.buffer.active.cursorY
        }
      }, terminalTabId)
      await details.locator('summary').click()
      await expect(details).toHaveAttribute('open', '')
      await expect.poll(() => client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        return [...terminal._agentEmbeddedEntries.values()].at(-1).rows
      }, terminalTabId)).toBeGreaterThan(collapsedLayout.rows)
      const finalLayout = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        const entry = [...terminal._agentEmbeddedEntries.values()].at(-1)
        const overlay = entry.element?.querySelector('.agent-session-overlay-inner.is-content-sized')
        const finalCard = entry.element?.querySelector('.agent-final-card')
        const header = entry.element?.querySelector('.agent-session-header')
        const terminalRect = terminal.domRef.current.getBoundingClientRect()
        const headerRect = header?.getBoundingClientRect()
        const cursorLine = terminal.term.buffer.active.baseY + terminal.term.buffer.active.cursorY
        return {
          rows: entry.rows,
          markerLine: entry.marker.line,
          cursorLine,
          viewportLine: entry.marker.line - terminal.term.buffer.active.viewportY,
          decorationHeight: entry.element?.clientHeight,
          overlayHeight: overlay?.getBoundingClientRect().height,
          overlayScrollHeight: overlay?.scrollHeight,
          overlayOverflowY: overlay && window.getComputedStyle(overlay).overflowY,
          finalHeight: finalCard?.getBoundingClientRect().height,
          finalScrollHeight: finalCard?.scrollHeight,
          finalOverflowY: finalCard && window.getComputedStyle(finalCard).overflowY,
          headerVisible: !!headerRect && headerRect.top >= terminalRect.top - 1 && headerRect.bottom <= terminalRect.bottom + 1
        }
      }, terminalTabId)
      expect(finalLayout.rows).toBeGreaterThan(20)
      expect(finalLayout.cursorLine).toBeGreaterThanOrEqual(finalLayout.markerLine + finalLayout.rows)
      expect(finalLayout.viewportLine).toBeGreaterThanOrEqual(0)
      expect(finalLayout.headerVisible).toBe(true)
      expect(finalLayout.overlayOverflowY).toBe('visible')
      expect(finalLayout.finalOverflowY).toBe('visible')
      expect(finalLayout.overlayScrollHeight).toBeLessThanOrEqual(finalLayout.overlayHeight + 1)
      expect(finalLayout.finalScrollHeight).toBeLessThanOrEqual(finalLayout.finalHeight + 1)
      expect(finalLayout.overlayHeight).toBeLessThanOrEqual(finalLayout.decorationHeight + 1)
      const embeddedEntries = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        return [...terminal._agentEmbeddedEntries.values()].map(entry => ({
          markerLine: entry.marker.line,
          rows: entry.rows,
          frozen: entry.frozen
        }))
      }, terminalTabId)
      expect(embeddedEntries).toHaveLength(2)
      expect(embeddedEntries[0].rows).toBeGreaterThan(2)
      expect(embeddedEntries[0]).toEqual(expect.objectContaining({ frozen: true }))
      expect(embeddedEntries[1]).toEqual(expect.objectContaining({ frozen: true }))
      const scrolledCard = await client.evaluate(async tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        const entry = [...terminal._agentEmbeddedEntries.values()].at(-1)
        await terminal.writeTerminal('\r\n'.repeat(terminal.term.rows + 6))
        terminal.term.scrollToLine(entry.marker.line + 2)
        terminal.term.refresh(0, terminal.term.rows - 1)
        await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
        return {
          display: entry.element?.style.display,
          top: Number.parseFloat(entry.element?.style.top || '0'),
          viewportLine: entry.marker.line - terminal.term.buffer.active.viewportY,
          rows: entry.rows
        }
      }, terminalTabId)
      expect(scrolledCard.viewportLine).toBe(-2)
      expect(scrolledCard.viewportLine + scrolledCard.rows).toBeGreaterThan(0)
      expect(scrolledCard.display).toBe('block')
      expect(scrolledCard.top).toBeLessThan(0)
      await expect(client.locator('.terminal-smart-shell-overlay.is-agent-session')).toHaveCount(0)
    } finally {
      await electronApp.close().catch(() => {})
    }
  })

  test('fits an initially expanded final card before restoring the Shell prompt', async () => {
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
      await expect.poll(() => client.evaluate(tabId => !!window.refs.get(`term-${tabId}`)?.term, terminalTabId)).toBe(true)
      await client.evaluate(async tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        await terminal.writeTerminal('\r\n[root@test ~]# ')
        terminal._agentPendingPromptPrefix = '[root@test ~]# '
      }, terminalTabId)
      const base = {
        taskId: 'task-initially-expanded-final',
        prompt: '查看 nginx 配置',
        binding: { tabId: terminalTabId },
        status: 'planning',
        budget: {
          elapsedMs: 34000,
          reactSteps: { used: 2, max: 12 },
          autoReadActions: { used: 1, max: 8 }
        },
        timeline: []
      }
      await setAgentSession(client, base)
      await setAgentSession(client, {
        ...base,
        status: 'inconclusive',
        finalResult: {
          status: 'inconclusive',
          conclusion: '目前的命令输出还不能确认全部结果。',
          confirmedFacts: Array.from({ length: 18 }, (_, index) => ({
            factId: `fact-initially-expanded-${index}`,
            statement: `配置项 ${index + 1} 已从命令输出中确认，并包含足够长的说明以验证终态首次展开时的实际内容高度`,
            confidence: 'confirmed'
          })),
          inferences: [],
          operations: [],
          unresolvedItems: ['仍需确认一项配置来源。'],
          evidenceRefs: []
        }
      })

      const decoration = client.locator('.agent-session-decoration').last()
      const details = decoration.locator('.agent-final-details')
      await expect(details).toHaveAttribute('open', '')
      await expect.poll(() => client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        return [...terminal._agentEmbeddedEntries.values()].at(-1)?.rows || 0
      }, terminalTabId)).toBeGreaterThan(20)
      const layout = await client.evaluate(tabId => {
        const terminal = window.refs.get(`term-${tabId}`)
        const entry = [...terminal._agentEmbeddedEntries.values()].at(-1)
        const overlay = entry.element?.querySelector('.agent-session-overlay-inner.is-content-sized')
        const finalCard = entry.element?.querySelector('.agent-final-card')
        const cursorLine = terminal.term.buffer.active.baseY + terminal.term.buffer.active.cursorY
        return {
          rows: entry.rows,
          markerLine: entry.marker.line,
          cursorLine,
          promptLine: terminal.term.buffer.active.getLine(cursorLine)?.translateToString(true),
          decorationHeight: entry.element?.getBoundingClientRect().height,
          overlayHeight: overlay?.getBoundingClientRect().height,
          overlayScrollHeight: overlay?.scrollHeight,
          finalHeight: finalCard?.getBoundingClientRect().height,
          finalScrollHeight: finalCard?.scrollHeight
        }
      }, terminalTabId)
      expect(layout.cursorLine).toBe(layout.markerLine + layout.rows)
      expect(layout.promptLine).toBe('[root@test ~]# ')
      expect(layout.overlayScrollHeight).toBeLessThanOrEqual(layout.overlayHeight + 1)
      expect(layout.finalScrollHeight).toBeLessThanOrEqual(layout.finalHeight + 1)
      expect(layout.overlayHeight).toBeLessThanOrEqual(layout.decorationHeight + 1)
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
      await modal.getByText('ChatGPT / Codex 账号', { exact: true }).click()
      await expect(modal.getByText('使用 ChatGPT / Codex 订阅账号')).toBeVisible()
      await expect(modal.getByText('高级：自定义 Codex App Server（可选）')).toBeVisible()
      await expect(modal.locator('input[placeholder="通常留空，自动检测或按需下载"]')).toBeVisible()
      await expect(modal.locator('input[value="https://api.example.test/v1"]')).toHaveCount(0)

      await modal.getByText('API Key', { exact: true }).click()
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
          agentExternalMcpEnabled: false
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

  test('persists Agent enablement across a real application restart', async () => {
    let electronApp = await electron.launch(appOptions)
    let client = await electronApp.firstWindow()
    let originalConfig
    try {
      await delay(3000)
      originalConfig = await client.evaluate(async () => {
        const previous = window.store.config
        const next = {
          ...previous,
          aiBackendType: 'openai_compatible',
          baseURLAI: 'https://api.restart-persistence.test/v1',
          apiPathAI: '/chat/completions',
          modelAI: 'restart-persistence-model',
          roleAI: 'terminal expert',
          apiKeyAI: 'restart-persistence-key',
          authHeaderNameAI: 'Authorization: Bearer',
          languageAI: 'Chinese',
          agentModeEnabled: true,
          agentMutationEnabled: true
        }
        await window.pre.runGlobalAsync('saveUserConfig', next)
        window.store.updateConfig(next)
        return previous
      })
      await electronApp.close()

      electronApp = await electron.launch(appOptions)
      client = await electronApp.firstWindow()
      const expectedConfig = {
        backend: 'openai_compatible',
        model: 'restart-persistence-model',
        agentModeEnabled: true,
        agentMutationEnabled: true
      }
      await expect.poll(() => client.evaluate(() => ({
        loaded: window.store?.configLoaded === true,
        config: {
          backend: window.store?.config?.aiBackendType,
          model: window.store?.config?.modelAI,
          agentModeEnabled: window.store?.config?.agentModeEnabled,
          agentMutationEnabled: window.store?.config?.agentMutationEnabled
        }
      })), { timeout: 15000 }).toEqual({
        loaded: true,
        config: expectedConfig
      })
    } finally {
      if (originalConfig) {
        await client?.evaluate(async previous => {
          await window.pre.runGlobalAsync('saveUserConfig', previous)
          window.store.updateConfig(previous)
        }, originalConfig).catch(() => {})
      }
      await electronApp?.close().catch(() => {})
    }
  })
})
