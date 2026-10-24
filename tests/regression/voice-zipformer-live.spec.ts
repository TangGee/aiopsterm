import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, expect } from './support/desktop'

test('live Zipformer updates the input, stops on silence and reuses both models @voice @live', async ({ desktop }, info) => {
  test.skip(!process.env.AIOPSTERM_VOICE_FIXTURE_DIR, 'Requires verified model archives for real CPU inference.')
  test.setTimeout(180_000)
  const root = join(desktop.root, 'state', 'voice-models')
  await mkdir(root, { recursive: true })
  const fixture = process.env.AIOPSTERM_VOICE_FIXTURE_DIR!
  for (const name of await readdir(fixture)) {
    if (name.endsWith('.tar.bz2') || name.endsWith('.tgz')) {
      await copyFile(join(fixture, name), join(root, name.endsWith('.tgz') ? name.replace('.tgz', '-1.12.40.tgz') : name))
    }
  }
  await desktop.page.locator('[data-module-key="settings"]').click()
  await desktop.page.locator('.settings-nav-item').filter({ hasText: '语音输入' }).click()
  await desktop.page.getByTestId('voice-auto-install').click()
  await expect.poll(async () => {
    const install = (await desktop.api('getVoiceInputStatus')).installation
    if (install.phase === 'error') throw new Error(install.errorMessage)
    return install.phase
  }, { timeout: 90_000 }).toBe('complete')
  const preferences = (await desktop.api('getVoiceInputStatus')).preferences
  expect(preferences.localEngine).toBe('zipformer')
  const wav = await readFile(join(dirname(preferences.modelPath), 'test_wavs', '1.wav'))
  await desktop.page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    ;(window as any).voiceTestContexts = []
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext({ sampleRate: 16000 })
      ;(window as any).voiceTestContexts.push(context)
      await context.resume()
      const audio = await context.decodeAudioData(bytes.buffer.slice(0))
      const buffer = context.createBuffer(1, audio.length + 16000 * 3, 16000)
      buffer.copyToChannel(audio.getChannelData(0), 0)
      const destination = context.createMediaStreamDestination()
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination)
      source.start(context.currentTime + 0.3)
      return destination.stream
    }
    const target = document.createElement('textarea')
    target.dataset.testid = 'voice-live-target'; target.value = 'before after'
    Object.assign(target.style, { position: 'fixed', top: '100px', left: '300px', zIndex: '3000' })
    document.body.append(target); target.focus(); target.setSelectionRange(7, 7)
  }, wav.toString('base64'))
  const mic = desktop.page.getByTestId('global-voice-button')
  await mic.click()
  await expect(mic).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => desktop.page.getByTestId('voice-live-target').inputValue(), { timeout: 20_000 }).toContain('重点')
  await info.attach('live-input', { body: await desktop.page.screenshot(), contentType: 'image/png' })
  await expect(mic).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 })
  await expect(mic).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  const value = await desktop.page.getByTestId('voice-live-target').inputValue()
  expect(value).toMatch(/^before .*。after$/)
  expect(value.match(/重点/g)).toHaveLength(1)
  expect(await desktop.page.locator('.voice-panel').count()).toBe(0)
  await desktop.page.getByTestId('voice-live-target').evaluate(element => element.remove())
  await desktop.localTerminal()
  await desktop.page.locator('.terminal-pane.active .xterm-host').click()
  await mic.click()
  await expect(desktop.page.locator('.terminal-voice-draft')).toContainText('重点', { timeout: 20_000 })
  expect(await desktop.replay()).not.toContain('重点')
  await info.attach('terminal-preedit', { body: await desktop.page.screenshot(), contentType: 'image/png' })
  await expect(mic).toHaveAttribute('aria-busy', 'false', { timeout: 40_000 })
  await expect.poll(() => desktop.replay()).toContain('重点')
  expect(await desktop.page.locator('.terminal-voice-draft').count()).toBe(0)
  const log = await readFile(join(desktop.root, 'state', 'logs', 'aiopsterm-runtime.log'), 'utf8')
  const events = log.trim().split('\n').map(line => JSON.parse(line))
  expect(events.filter(entry => entry.event === 'voice.runtime.ready')).toHaveLength(1)
  expect(events.filter(entry => entry.event === 'voice.runtime.exited')).toHaveLength(0)
  await info.attach('voice-runtime-log', { body: log, contentType: 'text/plain' })
  await desktop.page.evaluate(async () => { for (const context of (window as any).voiceTestContexts) await context.close() })
})
