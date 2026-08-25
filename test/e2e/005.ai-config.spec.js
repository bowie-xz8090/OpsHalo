const { _electron: electron, test, expect } = require('@playwright/test')
const delay = require('./common/wait')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')

test.describe('AI configuration', () => {
  let electronApp
  let client

  test.beforeEach(async () => {
    electronApp = await electron.launch(appOptions)
    client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(4500)
  })

  test.afterEach(async () => {
    await client.evaluate(() => { window.store.showAIConfigModal = false }).catch(() => {})
    await electronApp.close().catch(() => {})
  })

  test('shows only supported backends and saves OpenAI Compatible settings', async () => {
    await client.evaluate(async () => {
      await window.store.setConfig({
        aiBackendType: 'openai_compatible',
        baseURLAI: 'http://127.0.0.1:43434',
        apiPathAI: '/chat/completions',
        modelAI: 'initial-model',
        roleAI: 'test terminal assistant',
        apiKeyAI: 'initial-key',
        authHeaderNameAI: 'Authorization: Bearer',
        languageAI: 'Chinese'
      })
      window.store.showAIConfigModal = true
    })

    const modal = client.locator('.ai-config-modal')
    await expect(modal).toBeVisible()
    const backendSelector = modal.getByLabel('segmented control')
    await expect(backendSelector.getByText('API Key', { exact: true })).toBeVisible()
    await expect(backendSelector.getByText('ChatGPT / Codex 账号', { exact: true })).toBeVisible()
    await expect(modal.getByText(/Strands/i)).toHaveCount(0)

    await modal.locator('#modelAI').fill('saved-model')
    await modal.locator('#apiKeyAI').fill('saved-key')
    await modal.getByRole('button', { name: '仅保存' }).click()
    await expect(modal).not.toBeVisible()

    await expect.poll(() => client.evaluate(() => ({
      backend: window.store.config.aiBackendType,
      model: window.store.config.modelAI,
      apiKey: window.store.config.apiKeyAI,
      legacyAdapter: window.store.config.agentHarnessAdapter
    }))).toEqual({
      backend: 'openai_compatible',
      model: 'saved-model',
      apiKey: 'saved-key',
      legacyAdapter: undefined
    })
  })
})
