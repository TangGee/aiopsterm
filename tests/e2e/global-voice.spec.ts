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

test('first voice use opens the dedicated settings page with model presets and help @quick', async () => {
  const directory = path.join(os.tmpdir(), `aiopsterm-voice-setup-${Date.now()}`)
  await mkdir(directory, { recursive: true })
  const app = await electron.launch({
    args: ['.', '--lang=zh-CN'],
    env: { ...await isolatedEnvironment(directory), NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: directory, AIOPSTERM_MCP_DISCOVERY_DISABLE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('global-voice-button').click()
    const settings = page.getByTestId('voice-settings-page')
    await expect(settings).toBeVisible()
    await expect(page.locator('[data-settings-key="voice"]')).toBeVisible()
    await expect(page.getByTestId('voice-preset')).toHaveValue('sensevoice')
    await expect(page.getByTestId('global-voice-button')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('voice-auto-install')).toBeVisible()
    await page.getByTestId('voice-manual-setup').locator('summary').click()
    await page.getByTestId('voice-executable').fill('/missing/sherpa-onnx-offline')
    await page.getByTestId('voice-model-file').fill('/missing/model.int8.onnx')
    await page.getByTestId('voice-tokens').fill('/missing/tokens.txt')
    await page.getByTestId('voice-save').click()
    await expect(settings.locator('.voice-notice')).toContainText(/配置检查失败|Configuration check failed/)
    await page.getByTestId('voice-preset').selectOption('whisper')
    await expect(page.getByTestId('voice-tokens')).toHaveCount(0)
    await expect(page.getByTestId('voice-model-file')).toHaveValue('')
    await page.getByTestId('voice-preset').selectOption('sensevoice')
    await page.locator('.settings-content-scroll').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: 'test-results/voice-settings-presets.png', fullPage: true })
    await page.getByTestId('voice-mode').selectOption('service')
    await page.getByTestId('voice-service-provider').selectOption('doubao')
    await expect(page.getByTestId('voice-endpoint')).toHaveValue('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash')
    await expect(page.getByTestId('voice-service-model')).toHaveValue('volc.bigasr.auc_turbo')
    await page.getByTestId('voice-save').click()
    await expect(settings.locator('.voice-notice')).toContainText(/请补全|Complete/)
    await page.locator('.settings-content-scroll').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: 'test-results/voice-settings-doubao.png', fullPage: true })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
