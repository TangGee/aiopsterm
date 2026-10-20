import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, expect } from './support/desktop'

test.afterEach(async ({ desktop }, info) => {
  const log = await readFile(join(desktop.root, 'state', 'logs', 'aiopsterm-runtime.log'), 'utf8').catch(() => '')
  if (log) await info.attach('installation-runtime-log', { body: log, contentType: 'text/plain' })
})

test('one-click voice installation cancels, retries, validates and persists @voice @live', async ({ desktop }, info) => {
  test.skip(process.env.AIOPSTERM_LIVE_VOICE_INSTALL !== '1', 'Requires explicit opt-in for real model downloads.')
  test.setTimeout(15 * 60_000)
  await desktop.app.evaluate((_, root) => {
    process.chdir(root)
    ;(globalThis as any).voiceInstallErrors = []
    // Record main-process exceptions instead of blocking automation in a native dialog.
    process.on('uncaughtException', error => (globalThis as any).voiceInstallErrors.push(error.stack || error.message))
  }, desktop.root)
  const proxy = process.env.AIOPSTERM_TEST_DOWNLOAD_PROXY
  if (proxy) await desktop.app.evaluate(async ({ session }, proxyRules) => {
    await session.defaultSession.setProxy({ proxyRules })
  }, proxy)
  const forceApiFallback = process.env.AIOPSTERM_TEST_VOICE_API_FALLBACK === '1'
  await desktop.app.evaluate(({ session }, forceApiFallback) => {
    ;(globalThis as any).voiceDownloadRequests = 0
    ;(globalThis as any).voiceApiRequests = 0
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (/^https:\/\/(github\.com|api\.github\.com|release-assets\.githubusercontent\.com)\//.test(details.url)) {
        ;(globalThis as any).voiceDownloadRequests++
      }
      if (details.url.startsWith('https://api.github.com/')) (globalThis as any).voiceApiRequests++
      callback({ cancel: forceApiFallback && details.url.startsWith('https://github.com/') })
    })
  }, forceApiFallback)
  const openSettings = async () => {
    await desktop.page.locator('[data-module-key="settings"]').click()
    await desktop.page.locator('.settings-nav-item').filter({ hasText: '语音输入' }).click()
    await expect(desktop.page.getByTestId('voice-auto-install')).toBeEnabled()
  }
  await openSettings()
  await desktop.page.evaluate(() => {
    const progress = (window as any).voiceInstallProbe = { phases: [] as string[], received: {} as Record<string, number> }
    ;(window as any).aiops.onVoiceInputStatusChanged((status: any) => {
      const value = status.installation
      if (!value) return
      const phase = `${value.phase}:${value.asset || ''}`
      if (progress.phases.at(-1) !== phase) progress.phases.push(phase)
      if (value.asset) progress.received[value.asset] = Math.max(progress.received[value.asset] || 0, value.received)
    })
  })
  await desktop.page.getByTestId('voice-auto-install').click()
  await expect.poll(() => desktop.page.evaluate(() =>
    Math.max(0, ...Object.values((window as any).voiceInstallProbe.received) as number[])
  ), { timeout: 120_000 }).toBeGreaterThan(0)
  await desktop.page.getByTestId('voice-install-progress').getByRole('button').click()
  await expect.poll(async () => (await desktop.api('getVoiceInputStatus')).installation.phase).toBe('cancelled')
  expect((await desktop.api('getVoiceInputStatus')).preferences.modelPath).toBe('')
  console.log('Cancelled after receiving bytes; configuration remains unchanged')

  await desktop.page.getByTestId('voice-auto-install').click()
  const waitForComplete = async () => {
    let lastLog = 0
    while (true) {
      const status = await desktop.api('getVoiceInputStatus')
      const progress = status.installation
      if (Date.now() - lastLog > 10_000 || progress.phase === 'complete') {
        console.log(JSON.stringify(progress))
        lastLog = Date.now()
      }
      if (progress.phase === 'complete') return status.preferences
      if (progress.phase === 'error' || progress.phase === 'cancelled') throw new Error(JSON.stringify(progress))
      await desktop.page.waitForTimeout(500)
    }
  }
  const preferences = await waitForComplete()
  expect(preferences).toMatchObject({ mode: 'local', localEngine: 'sensevoice' })
  for (const field of ['executablePath', 'modelPath', 'tokensPath']) expect((await stat(preferences[field])).size).toBeGreaterThan(0)
  expect(await desktop.api('validateVoiceInputPreferences', preferences)).toEqual({ ok: true })
  await expect(desktop.page.getByTestId('voice-model-file')).toHaveValue(preferences.modelPath)
  await expect(desktop.page.getByTestId('voice-executable')).toHaveValue(preferences.executablePath)
  await expect(desktop.page.getByTestId('voice-tokens')).toHaveValue(preferences.tokensPath)
  const progress = await desktop.page.evaluate(() => (window as any).voiceInstallProbe)
  expect(progress.phases).toEqual(expect.arrayContaining([
    'cancelled:', 'downloading:engine', 'extracting:engine', 'downloading:model', 'extracting:model', 'checking:', 'complete:'
  ]))
  await info.attach('installation-progress', { body: JSON.stringify(progress), contentType: 'application/json' })
  await info.attach('installed-settings', { body: await desktop.page.screenshot(), contentType: 'image/png' })

  const samples = join(dirname(preferences.modelPath), 'test_wavs')
  for (const name of ['zh.wav', 'en.wav']) {
    const audio = await readFile(join(samples, name))
    const pending = desktop.api('transcribeVoiceInput', {
      requestId: `live-${name}`, audioData: audio.toString('base64'), audioFormat: 'wav'
    })
    let done = false
    void pending.then(() => { done = true }, () => { done = true })
    await expect.poll(async () => {
      const errors = await desktop.app.evaluate(() => (globalThis as any).voiceInstallErrors)
      return errors.length ? errors : done
    }, { timeout: 30_000 }).toBe(true)
    const result = await pending
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.data.text.trim()).not.toBe('')
    console.log(`Recognized ${name}: ${result.data.text}`)
  }
  expect(await desktop.app.evaluate(() => (globalThis as any).voiceInstallErrors)).toEqual([])
  const modelRoot = join(await desktop.app.evaluate(({ app }) => app.getPath('userData')), 'voice-models')
  expect((await readdir(modelRoot)).filter(name => name.startsWith('.download-') || name.startsWith('.check-'))).toEqual([])
  const requests = await desktop.app.evaluate(() => (globalThis as any).voiceDownloadRequests)
  await desktop.page.getByTestId('voice-auto-install').click()
  expect(await waitForComplete()).toEqual(preferences)
  expect(await desktop.app.evaluate(() => (globalThis as any).voiceDownloadRequests)).toBe(requests)
  if (forceApiFallback) {
    // One cancelled engine request, then one complete engine and one model request.
    expect(await desktop.app.evaluate(() => (globalThis as any).voiceApiRequests)).toBe(3)
  }
  console.log('Reinstallation reused the validated model without network requests')
  await desktop.restart()
  expect((await desktop.api('getVoiceInputStatus')).preferences).toEqual(preferences)
  await openSettings()
  await expect(desktop.page.getByTestId('voice-model-file')).toHaveValue(preferences.modelPath)
  const logPath = join(await desktop.app.evaluate(({ app }) => app.getPath('userData')), 'logs', 'aiopsterm-runtime.log')
  const log = await readFile(logPath, 'utf8')
  const events = log.trim().split('\n').map(line => JSON.parse(line))
    .filter(entry => entry.event?.startsWith('voice.install.'))
  expect(events.map(entry => entry.event)).toEqual(expect.arrayContaining([
    'voice.install.started', 'voice.install.network-route', 'voice.install.cancelled',
    'voice.install.download.completed', 'voice.install.extraction.completed',
    'voice.install.validation.completed', 'voice.install.completed', 'voice.install.cache.reused'
  ]))
  expect(events.every(entry => typeof entry.installationId === 'string')).toBe(true)
  await info.attach('voice-install-log', { body: JSON.stringify(events, null, 2), contentType: 'application/json' })
})
