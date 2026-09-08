import { test, expect } from './support/desktop'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transcriptFor } from './support/corpus'

for (const locale of ['zh-CN', 'en-US']) for (const scale of [1, 1.5, 2]) for (const theme of ['dark', 'light']) {
  test(`surfaces ${locale} scale ${scale} ${theme} layout and approved screenshots @visual`, async ({ desktop }, info) => {
    await desktop.restart({ REGRESSION_LOCALE: locale })
    // Pin renderer dimensions independently of host screen size and window-manager clamping.
    const viewport = await desktop.app.context().newCDPSession(desktop.page)
    let size = { width: 1280, height: 900 }
    const config = await desktop.api('getConfig')
    await desktop.api('saveConfig', { theme, modelProvider: 'ollama', modelName: 'REGRESSION_UI_MODEL',
      modelSettings: { ...config.modelSettings,
        providers: { ...config.modelSettings.providers, ollama: { baseUrl: 'http://127.0.0.1:9', modelId: 'REGRESSION_UI_MODEL' } },
        options: [{ name: 'REGRESSION_UI_MODEL', checked: true, locked: false, type: 'custom', apiProvider: 'ollama' }]
      } })
    await desktop.page.reload()
    await desktop.page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'
      + '.managed-ai-session-content-header p, .ai-session-row-meta-main, .top-notice { visibility: hidden !important; }'
      + (process.platform === 'linux' ? 'body { font-family: "Noto Sans CJK SC", sans-serif !important; }' : '') })
    const filePath = join(desktop.root, 'visual.jsonl')
    await writeFile(filePath, transcriptFor('codex', 60))
    await desktop.api('publishAiAgentSessionEvent', { source: 'codex', sessionId: 'visual-session', event: 'session_start', title: 'REGRESSION_VISUAL_SESSION', transcriptPath: filePath, receivedAt: Date.now() })
    const snapshot = async (name: string) => {
      await viewport.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: scale, mobile: false })
      const shell = desktop.page.locator('.app-shell')
      await desktop.page.evaluate(() => document.fonts.ready)
      await desktop.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      expect(await desktop.page.evaluate(() => devicePixelRatio)).toBe(scale)
      const geometry = await shell.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return { width: box.width, scroll: element.scrollWidth, viewport: innerWidth, height: box.height, viewportHeight: innerHeight }
      })
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1)
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewportHeight + 1)
      const key = `${locale}-${scale}-${theme}-${name}.png`
      const toolbar = desktop.page.locator('.managed-ai-session-content-toolbar')
      if (await toolbar.isVisible()) {
        const valid = await toolbar.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return [...element.querySelectorAll('.managed-ai-session-record-summary, .managed-ai-session-record-search, button')].every((control) => {
            const rect = control.getBoundingClientRect()
            return rect.left >= box.left && rect.right <= box.right + 1 && rect.bottom <= box.bottom + 1 && control.scrollHeight <= control.clientHeight + 2
          })
        })
        expect(valid, 'Session toolbar controls must fit the actual pane, not just the outer window').toBe(true)
      }
      // Capture the configured device pixels directly; Electron's screenshot helper can reset emulation.
      const captured = await viewport.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, ...size, scale: 1 } })
      const png = Buffer.from(captured.data, 'base64')
      expect(png.readUInt32BE(16)).toBe(size.width * scale)
      expect(png.readUInt32BE(20)).toBe(size.height * scale)
      await info.attach(key, { body: png, contentType: 'image/png' })
      if (process.env.AIOPSTERM_VISUAL_BASELINES === '1' || existsSync(info.snapshotPath(key))) expect(png).toMatchSnapshot(key, { maxDiffPixelRatio: 0.002 })
      else info.annotations.push({ type: 'missing-approved-baseline', description: `${process.platform}: ${key}; geometry only, not visual regression approval` })
    }
    await desktop.page.getByTestId('ai-panel-mode-open').click()
    await desktop.page.getByTestId('ai-mode-classic').click()
    const input = desktop.page.locator('.chat-editable')
    await input.fill('Regression input 中文 Unicode and a long line to test wrapping in the host Agent panel')
    await expect(input).toBeVisible()
    await snapshot('classic')
    await desktop.page.getByTestId('ai-panel-mode-open').click()
    await desktop.page.getByTestId('ai-mode-codex').click()
    await expect(input).not.toBeVisible()
    await snapshot('codex')
    await desktop.page.locator('[data-module-key="aiSessions"]').click()
    await desktop.page.locator('.ai-sessions-header-actions button').last().click()
    await desktop.page.locator('.ai-sessions-mode-button.mode-library').click()
    await desktop.page.locator('.ai-session-row').filter({ hasText: 'REGRESSION_VISUAL_SESSION' }).first().click({ button: 'right' })
    await snapshot('session-menu')
    await desktop.page.locator('.ai-session-context-menu button').first().click()
    await expect(desktop.page.locator('.managed-ai-session-content')).toBeVisible()
    await expect(desktop.page.locator('.managed-ai-session-record-card')).toHaveCount(20)
    await expect(desktop.page.locator('.managed-ai-session-content-refresh')).toBeEnabled()
    await snapshot('session-editor')
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768))
    size = { width: 1024, height: 768 }
    await expect(desktop.page.locator('.managed-ai-session-content-pagination')).toBeVisible()
    await snapshot('compact-session-editor')
  })
}
