import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { isolatedEnvironment } from '../regression/support/environment'

test('global voice records WAV, inserts with undo, and opens a reusable editor @quick', async () => {
  const directory = path.join(os.tmpdir(), `aiopsterm-voice-e2e-${Date.now()}`)
  await mkdir(directory, { recursive: true })
  let uploaded = ''
  const server = createServer((request, response) => {
    request.on('data', (chunk) => { uploaded += chunk.toString() })
    request.on('end', () => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ text: 'voice words' })) })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await writeFile(path.join(directory, 'voice-input.json'), JSON.stringify({ preferences: { mode: 'service', endpoint: `http://127.0.0.1:${port}/audio/transcriptions`, model: 'test-speech', executablePath: '', modelPath: '', shortcut: '', headsetEnabled: false } }))
  const app = await electron.launch({
    args: ['.', '--lang=zh-CN', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...await isolatedEnvironment(directory), NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: directory, AIOPSTERM_MCP_DISCOVERY_DISABLE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const button = page.getByTestId('global-voice-button')
    await expect(button).toBeVisible()
    await page.evaluate(() => {
      const input = document.createElement('textarea')
      input.id = 'voice-e2e-input'; input.value = 'before after'; input.style.cssText = 'position:fixed;left:200px;top:120px;z-index:2001;width:240px;height:70px'
      document.body.append(input); input.focus(); input.setSelectionRange(7, 7)
    })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(600)
    await button.click()
    await expect(page.locator('#voice-e2e-input')).toHaveValue('before voice wordsafter')
    expect(uploaded).toContain('audio/wav')
    expect(uploaded).toContain('RIFF')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(page.locator('#voice-e2e-input')).toHaveValue('before after')
    await page.evaluate(() => document.querySelector('#voice-e2e-input')?.remove())
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(600); await button.click()
    await expect(page.getByTestId('voice-transcript')).toHaveValue('voice words')
    await page.getByTestId('voice-transcript').fill('edited transcript')
    await page.screenshot({ path: 'test-results/global-voice-dialog.png', fullPage: true })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('voice-transcript')).toHaveCount(0)
    await button.hover()
    await page.locator('.voice-secondary').first().click()
    await expect(page.getByTestId('voice-transcript')).toHaveValue('edited transcript')
    const rectangle = await button.boundingBox()
    expect(rectangle?.width).toBe(48)
    expect(rectangle?.height).toBe(48)
    await page.screenshot({ path: 'test-results/global-voice-button.png', fullPage: true })
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
