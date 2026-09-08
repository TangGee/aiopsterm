import { _electron as electron, test, expect } from '@playwright/test'
import { isolatedEnvironment } from '../regression/support/environment'

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
      await page.evaluate(async () => {
        const api = (window as any).aiops
        const config = await api.getConfig()
        await api.saveConfig({ theme: 'ubuntu-terminal', language: 'en-US', terminal: { ...config.terminal, fontSize: 19 } })
        const result = await api.saveAsset({ name: 'REGRESSION_UPGRADE_ASSET', host: '127.0.0.1', username: 'fixture', port: 22222 })
        if (!result.ok) throw new Error(JSON.stringify(result))
      })
    }
    const config = await page.evaluate(() => (window as any).aiops.getConfig())
    expect(config).toMatchObject({ theme: 'ubuntu-terminal', language: 'en-US', terminal: { fontSize: 19 } })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'ubuntu-terminal')
    await page.locator('[data-module-key="workspace"]').click()
    await page.locator('.workspace-search input').fill('REGRESSION_UPGRADE_ASSET')
    await expect(page.locator('.workspace-host-row').filter({ hasText: 'REGRESSION_UPGRADE_ASSET' })).toBeVisible()
  } finally { await app.close() }
})
