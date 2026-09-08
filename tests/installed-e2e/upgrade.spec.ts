import { _electron as electron, test, expect } from '@playwright/test'
import { isolatedEnvironment } from '../regression/support/environment'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

test('installed release preserves user data through upgrade and reinstall', async () => {
  const root = process.env.AIOPSTERM_INSTALL_STATE
  const executablePath = process.env.AIOPSTERM_PACKAGED_APP
  if (!root || !executablePath) throw new Error('Run the disposable installer regression entry point.')
  const app = await electron.launch({ executablePath, args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: { ...await isolatedEnvironment(root), AIOPSTERM_USER_DATA_DIR: root, AIOPSTERM_MCP_DISCOVERY_DISABLE: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible()
    if (process.env.AIOPSTERM_INSTALL_PHASE === 'seed-old') {
      const transcriptPath = join(root, 'upgrade-session.jsonl')
      const parserPath = join(root, 'upgrade-parser.json')
      await writeFile(transcriptPath, JSON.stringify({ speaker: 'user', body: 'REGRESSION_UPGRADE_CONTENT' }) + '\n')
      await writeFile(parserPath, JSON.stringify({ schemaVersion: 1, id: 'upgrade-parser', source: 'upgrade-parser', displayName: 'Upgrade parser', storage: { kind: 'jsonl', paths: [transcriptPath] }, fallback: 'raw-json', rules: [{ id: 'text', kind: 'message', rolePointer: '/speaker', contentPointers: ['/body'] }] }))
      await page.evaluate(async ({ transcriptPath, parserPath }) => {
        const api = (window as any).aiops
        const config = await api.getConfig()
        await api.saveConfig({ theme: 'ubuntu-terminal', language: 'en-US', terminal: { ...config.terminal, fontSize: 19 }, exportMcp: { ...config.exportMcp, allowDatabaseRead: true } })
        const result = await api.saveAsset({ name: 'REGRESSION_UPGRADE_ASSET', host: '127.0.0.1', username: 'fixture', port: 22222, password: 'REGRESSION_SYNTHETIC_PASSWORD' })
        if (!result.ok) throw new Error(JSON.stringify(result))
        for (const result of [await api.importAgentSessionParser({ filePath: parserPath }), await api.publishAiAgentSessionEvent({ source: 'custom:upgrade-parser', sessionId: 'upgrade-session', event: 'session_start', title: 'REGRESSION_UPGRADE_HISTORY', transcriptPath, receivedAt: Date.now() })]) {
          if (!result.ok) throw new Error(JSON.stringify(result))
        }
        const chat = await api.createChatConversation()
        if (!chat.ok) throw new Error(JSON.stringify(chat))
        const history = await api.updateChatConversation({ id: chat.data.conversation.id, title: 'REGRESSION_UPGRADE_CHAT', messages: [
          { id: 'upgrade-user', role: 'user', text: 'REGRESSION_UPGRADE_QUESTION' },
          { id: 'upgrade-assistant', role: 'assistant', text: 'REGRESSION_UPGRADE_ANSWER', favorite: true }
        ] })
        if (!history.ok) throw new Error(JSON.stringify(history))
      }, { transcriptPath, parserPath })
    }
    const config = await page.evaluate(() => (window as any).aiops.getConfig())
    expect(config).toMatchObject({ theme: 'ubuntu-terminal', language: 'en-US', terminal: { fontSize: 19 } })
    expect(config.exportMcp.allowDatabaseRead).toBe(true)
    const persisted = await page.evaluate(async () => {
      const api = (window as any).aiops
      return { parsers: await api.listAgentSessionParsers(), sessions: await api.listManagedAiSessions(), content: await api.listManagedAiSessionContent({ source: 'custom:upgrade-parser', sessionId: 'upgrade-session' }) }
    })
    expect(JSON.stringify(persisted.parsers)).toContain('upgrade-parser')
    expect(JSON.stringify(persisted.sessions)).toContain('REGRESSION_UPGRADE_HISTORY')
    expect(persisted.content.data.records).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'REGRESSION_UPGRADE_CONTENT', role: 'user' })]))
    const password = await page.evaluate(async () => {
      const api = (window as any).aiops
      const snapshot = await api.listAssets()
      const assets = snapshot.assets || snapshot.data?.assets || []
      const asset = assets.find((item: any) => item.name === 'REGRESSION_UPGRADE_ASSET')
      if (!asset) throw new Error('Upgraded asset missing')
      return (await api.getAssetEditableSecret(asset.id)).data?.password
    })
    expect(password).toBe('REGRESSION_SYNTHETIC_PASSWORD')
    const history = await page.evaluate(async () => {
      const api = (window as any).aiops
      const chats = await api.listChatConversations()
      const chat = chats.data.conversations.find((item: any) => item.title === 'REGRESSION_UPGRADE_CHAT')
      if (!chat) throw new Error('Upgraded chat missing')
      return api.restoreChatConversation(chat.id)
    })
    expect(history.ok, JSON.stringify(history)).toBe(true)
    expect(history.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', text: 'REGRESSION_UPGRADE_QUESTION' }),
      expect.objectContaining({ role: 'assistant', text: 'REGRESSION_UPGRADE_ANSWER', favorite: true })
    ]))
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'ubuntu-terminal')
    await page.locator('[data-module-key="workspace"]').click()
    await page.locator('.workspace-search input').fill('REGRESSION_UPGRADE_ASSET')
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'REGRESSION_UPGRADE_ASSET' })).toBeVisible()
  } finally { await app.close() }
})
