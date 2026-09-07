import { test, expect } from './support/desktop'
import { startRegressionProvider } from './support/provider'

for (const scenario of ['answer', 'error', 'cancel', 'tool', 'tool-reject'] as const) {
  test(`classic AI real provider ${scenario} through renderer and IPC @core`, async ({ desktop }) => {
    const provider = await startRegressionProvider()
    provider.setScenario(scenario === 'tool-reject' ? 'tool' : scenario)
    try {
      const config = await desktop.api('getConfig')
      await desktop.api('saveConfig', {
        modelProvider: 'ollama', modelName: 'regression-model',
        aiPreferences: { ...config.aiPreferences, needProxy: false },
        modelSettings: { ...config.modelSettings,
          providers: { ...config.modelSettings?.providers, ollama: { baseUrl: provider.baseUrl, modelId: 'regression-model', apiKey: '' } },
          options: [{ name: 'regression-model', locked: false, checked: true, type: 'custom', apiProvider: 'ollama' }]
        }
      })
      await desktop.page.reload()
      await desktop.localTerminal()
      await desktop.page.getByTestId('ai-panel-mode-open').click()
      await desktop.page.getByTestId('ai-mode-classic').click()
      await desktop.page.locator('.chat-editable').fill('REGRESSION_REQUEST')
      await desktop.page.locator('.chat-input button[type="submit"]').click()
      await expect.poll(() => provider.requests.length).toBeGreaterThan(0)
      expect(provider.requests[0].model).toBe('regression-model')
      expect(JSON.stringify(provider.requests[0].messages)).toContain('REGRESSION_REQUEST')
      if (scenario === 'error') {
        await expect(desktop.page.locator('.ai-panel')).toContainText(/503|Regression provider unavailable/)
        provider.setScenario('answer')
        await desktop.page.locator('.chat-editable').fill('REGRESSION_RETRY')
        await desktop.page.locator('.chat-input button[type="submit"]').click()
        await expect(desktop.page.locator('.message.assistant')).toContainText(['REGRESSION_ANSWER_COMPLETE'])
      } else if (scenario === 'cancel') {
        await expect(desktop.page.locator('.ai-panel')).toContainText('REGRESSION_STREAM_START')
        await desktop.page.locator('.chat-input button[type="submit"]').click()
        await expect.poll(() => provider.disconnected).toBeGreaterThan(0)
        await expect(desktop.page.locator('.chat-editable')).toBeEditable()
      } else if (scenario === 'tool' || scenario === 'tool-reject') {
        await expect(desktop.page.getByTestId('ai-message-command-text')).toContainText('echo REGRESSION_TOOL_OK')
        await expect(desktop.page.getByTestId('ai-message-command-approval-badge')).toBeVisible()
        expect(await desktop.replay()).not.toContain('REGRESSION_TOOL_OK')
        if (scenario === 'tool-reject') {
          await desktop.page.getByTestId('ai-message-command-reject').click()
          await expect(desktop.page.getByTestId('ai-message-command-status')).toContainText('拒绝')
          await expect(desktop.page.locator('.ai-panel')).toContainText('REGRESSION_ANSWER_COMPLETE')
          expect(await desktop.replay()).not.toContain('REGRESSION_TOOL_OK')
        } else {
          await desktop.page.getByTestId('ai-message-command-run').click()
          await expect.poll(() => desktop.replay()).toContain('REGRESSION_TOOL_OK')
          await expect(desktop.page.getByTestId('ai-message-command-status')).toHaveClass(/succeeded/)
        }
      } else {
        await expect(desktop.page.locator('.ai-panel')).toContainText('REGRESSION_ANSWER_COMPLETE')
        const id = await desktop.page.locator('.ai-conversation-tab.active').getAttribute('data-conversation-id')
        expect(id).toBeTruthy()
        await expect.poll(async () => JSON.stringify(await desktop.api('restoreChatConversation', id))).toContain('REGRESSION_ANSWER_COMPLETE')
        await desktop.restart()
        const restored = await desktop.api('restoreChatConversation', id)
        expect(restored.ok, JSON.stringify(restored)).toBe(true)
        expect(JSON.stringify(restored.data.messages)).toContain('REGRESSION_ANSWER_COMPLETE')
      }
    } finally { await provider.close() }
  })
}

test('Codex and classic surfaces remain mutually exclusive @core', async ({ desktop }) => {
  const page = desktop.page
  const config = await desktop.api('getConfig')
  await desktop.api('saveConfig', {
    modelProvider: 'ollama', modelName: 'REGRESSION_UI_MODEL',
    modelSettings: { ...config.modelSettings,
      providers: { ...config.modelSettings?.providers, ollama: { baseUrl: 'http://127.0.0.1:9', modelId: 'REGRESSION_UI_MODEL', apiKey: '' } },
      options: [{ name: 'REGRESSION_UI_MODEL', locked: false, checked: true, type: 'custom', apiProvider: 'ollama' }]
    }
  })
  await page.reload()
  await page.getByTestId('ai-panel-mode-open').click()
  await page.getByTestId('ai-mode-classic').click()
  await expect(page.locator('.chat-editable')).toBeVisible()
  await expect(page.locator('.ai-panel')).toContainText('REGRESSION_UI_MODEL')
  await page.getByTestId('ai-panel-mode-open').click()
  await page.getByTestId('ai-mode-codex').click()
  await expect(page.getByTestId('ai-codex-shell')).toBeVisible()
  await expect(page.locator('.chat-editable')).not.toBeVisible()
  await expect(page.locator('.ai-panel').getByText('REGRESSION_UI_MODEL', { exact: true })).not.toBeVisible()
  await page.getByTestId('ai-panel-mode-open').click()
  await page.getByTestId('ai-mode-classic').click()
  await expect(page.locator('.ai-panel')).toHaveClass(/mode-classic/)
  await expect(page.getByTestId('ai-codex-shell')).not.toBeVisible()
  await expect(page.locator('.chat-editable')).toBeVisible()
})
