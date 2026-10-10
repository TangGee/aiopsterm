import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { encodeVoiceWav } from '../../src/renderer/src/services/voice/voiceWav'
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
  const audioFile = path.join(directory, 'microphone.wav')
  const samples = Float32Array.from({ length: 16000 * 10 }, (_, index) => 0.3 * Math.sin(2 * Math.PI * (220 + 40 * Math.sin(index / 800)) * index / 16000))
  await writeFile(audioFile, Buffer.from(encodeVoiceWav([samples], 16000)))
  const app = await electron.launch({
    args: ['.', '--lang=zh-CN', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${audioFile}`],
    env: { ...await isolatedEnvironment(directory), NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: directory, AIOPSTERM_MCP_DISCOVERY_DISABLE: '1', AIOPSTERM_ASSETS_ENABLE_SEED: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
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
    await page.keyboard.press('Escape')
    // A real terminal receives recognition while recording is still running.
    await page.locator('[data-module-key="workspace"]').click()
    await page.locator('.workspace-search input').fill('127.0.0.1')
    await page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first().dblclick()
    const terminal = page.locator('.terminal-pane.active .xterm-host')
    await expect(terminal).toBeVisible()
    await expect.poll(() => page.evaluate(async () => {
      const result = await window.aiops.invokeControlRequest('terminal.list', {})
      return (result.data as any)?.terminals?.some((entry: any) => entry.connected)
    })).toBe(true)
    await terminal.click()
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(async () => {
      const result = await window.aiops.invokeControlRequest('terminal.replay', { tailLines: 100 })
      if (!result.ok) throw new Error(JSON.stringify(result))
      const data = result.data as any
      return String(data?.text || data?.snapshot_text || '')
    })).toContain('voice words')
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('voice-transcript')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/global-voice-streaming-terminal.png', fullPage: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-busy', 'false')
    await terminal.click()
    await page.keyboard.press('Control+u')
    // Permission/device errors share a stack with the fallback editor and can be dismissed.
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Requested device not found', 'NotFoundError') } })
      ;(document.activeElement as HTMLElement)?.blur()
    })
    await button.click()
    const alert = page.getByRole('alert').filter({ hasText: /未找到可用的麦克风|No usable microphone/ })
    await expect(alert).toBeVisible()
    const alertBox = (await alert.boundingBox())!
    const closeBox = (await alert.getByRole('button').boundingBox())!
    expect(closeBox.y).toBeGreaterThanOrEqual(alertBox.y)
    expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(alertBox.y + alertBox.height)
    expect(Math.abs(closeBox.y + closeBox.height / 2 - alertBox.y - alertBox.height / 2)).toBeLessThan(2)
    const panelBox = (await page.getByTestId('voice-transcript').boundingBox())!
    expect(panelBox.y + panelBox.height).toBeLessThan(alertBox.y)
    await page.screenshot({ path: 'test-results/global-voice-error-layout.png', fullPage: true })
    await alert.getByRole('button').click()
    await expect(alert).toHaveCount(0)

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
