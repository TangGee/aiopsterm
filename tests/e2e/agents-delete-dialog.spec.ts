import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

test('session delete confirmation follows the application theme @quick', async () => {
  const userDataDir = path.join(os.tmpdir(), `aiopsterm-e2e-agents-delete-${Date.now()}`)
  await mkdir(userDataDir, { recursive: true })
  await mkdir('test-results', { recursive: true })

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_CHAT_HISTORY_ENABLE_SEED: '1',
      AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('agents-mode-entry')).toBeVisible()

    const created = await page.evaluate(async () => {
      return (window as unknown as {
        aiops: {
          createProductSession: (input: Record<string, unknown>) => Promise<{ ok: boolean; errorMessage?: string }>
        }
      }).aiops.createProductSession({
        id: 'e2e-themed-delete-dialog',
        surface: 'codex',
        title: 'E2E themed delete dialog',
        isOpen: false
      })
    })
    expect(created.ok, created.errorMessage).toBe(true)

    await page.getByTestId('agents-mode-entry').click()
    const sessionRow = page.locator('.product-session-item[data-session-id="e2e-themed-delete-dialog"]')
    await expect(sessionRow).toBeVisible()
    await sessionRow.hover()
    await sessionRow.locator('.delete-btn').click()

    const backdrop = page.getByTestId('agents-delete-dialog')
    const dialog = backdrop.locator('.agents-delete-dialog')
    const cancelButton = dialog.locator('footer button').first()
    const dangerButton = dialog.locator('footer button.danger')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('E2E themed delete dialog')
    await expect(cancelButton).toBeFocused()

    const colors = await dialog.evaluate((element) => {
      const dialogStyle = getComputedStyle(element)
      const cancelStyle = getComputedStyle(element.querySelector('footer button') as HTMLElement)
      const dangerStyle = getComputedStyle(element.querySelector('footer button.danger') as HTMLElement)
      return {
        dialogBackground: dialogStyle.backgroundColor,
        dialogText: dialogStyle.color,
        cancelBackground: cancelStyle.backgroundColor,
        dangerBackground: dangerStyle.backgroundColor
      }
    })
    expect(colors.dialogBackground).not.toBe('rgb(255, 255, 255)')
    expect(colors.dialogText).not.toBe('rgb(0, 0, 0)')
    expect(colors.cancelBackground).not.toBe('rgb(255, 255, 255)')
    expect(colors.dangerBackground).not.toBe('rgb(255, 255, 255)')
    await expect(dangerButton).toBeVisible()

    await page.screenshot({
      path: path.join('test-results', 'agents-delete-dialog-theme.png'),
      fullPage: true
    })

    await page.keyboard.press('Escape')
    await expect(backdrop).toHaveCount(0)
    await expect(sessionRow).toBeVisible()
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
