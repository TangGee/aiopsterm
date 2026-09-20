import { test, expect } from './support/desktop'
import { TERMINAL_FONT_FAMILY, resolveTerminalFontFamily } from '../../src/shared/terminalTypography'

test('legacy terminal fallback loads bundled symbols without worker support', async ({ desktop }) => {
  await desktop.page.evaluate(() => {
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen')
  })
  await desktop.localTerminal()
  await expect(desktop.page.locator('.terminal-pane.active .xterm')).toBeVisible()
  await expect.poll(() => desktop.page.evaluate(() =>
    Array.from(document.fonts).some((face) => face.family === 'AIOpsTerm Symbols' && face.status === 'loaded')
  )).toBe(true)
  expect((await desktop.api('getConfig')).terminal.fontFamily).toBe(TERMINAL_FONT_FAMILY)
})

test('bundled icons load in the document and terminal render worker with unchanged defaults', async ({ desktop }) => {
  expect((await desktop.api('getConfig')).terminal.fontFamily).toBe(TERMINAL_FONT_FAMILY)
  await desktop.localTerminal()
  await expect.poll(() => desktop.page.evaluate(() =>
    Array.from(document.fonts).some((face) => face.family === 'AIOpsTerm Symbols' && face.status === 'loaded')
  )).toBe(true)
  await expect.poll(() => desktop.page.workers().some((worker) => worker.url().includes('threadedTerminalRenderWorker'))).toBe(true)
  const worker = desktop.page.workers().find((item) => item.url().includes('threadedTerminalRenderWorker'))!
  await expect.poll(() => worker.evaluate(() =>
    Array.from((self as unknown as { fonts: FontFaceSet }).fonts)
      .some((face) => face.family === 'AIOpsTerm Symbols' && face.status === 'loaded')
  )).toBe(true)
  const glyphs = await worker.evaluate(() => {
    const canvas = new OffscreenCanvas(64, 64)
    const context = canvas.getContext('2d')!
    const hash = (text: string, family: string) => {
      context.clearRect(0, 0, 64, 64)
      context.font = `32px ${family}`
      context.fillText(text, 8, 40)
      return Array.from(context.getImageData(0, 0, 64, 64).data).reduce((value, byte) => Math.imul(value ^ byte, 16777619), 2166136261)
    }
    return [0xe0b0, 0xf07b, 0xf126, 0xf120, 0xf0004].map((codepoint) => ({
      icon: hash(String.fromCodePoint(codepoint), '"AIOpsTerm Symbols"'),
      missing: hash(String.fromCodePoint(0x10fffd), '"AIOpsTerm Symbols"'),
      blank: hash(' ', '"AIOpsTerm Symbols"')
    }))
  })
  for (const glyph of glyphs) {
    expect(glyph.icon).not.toBe(glyph.missing)
    expect(glyph.icon).not.toBe(glyph.blank)
  }
  expect(new Set(glyphs.map((glyph) => glyph.icon)).size).toBe(glyphs.length)
  const normalText = await worker.evaluate(({ original, fallback }) => {
    const canvas = new OffscreenCanvas(400, 64)
    const context = canvas.getContext('2d')!
    const render = (family: string) => {
      context.clearRect(0, 0, 400, 64)
      context.font = `16px ${family}`
      const text = 'AaBb 0123 +-_= {} []'
      context.fillText(text, 8, 32)
      return {
        width: context.measureText(text).width,
        pixels: Array.from(context.getImageData(0, 0, 400, 64).data)
          .reduce((value, byte) => Math.imul(value ^ byte, 16777619), 2166136261)
      }
    }
    return { original: render(original), fallback: render(fallback) }
  }, { original: TERMINAL_FONT_FAMILY, fallback: resolveTerminalFontFamily() })
  expect(normalText.fallback).toEqual(normalText.original)
})

test('custom local fonts validate, persist and restore through the settings UI', async ({ desktop }, info) => {
  const font = await desktop.page.evaluate(async () => {
    for (const family of ['Consolas', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New']) {
      try {
        await new FontFace('Probe', `local("${family}")`).load()
        return family
      } catch { /* Try the next platform font. */ }
    }
    throw new Error('No supported system monospace font is installed.')
  })
  const openSettings = async () => {
    await desktop.page.locator('[data-module-key="settings"]').click()
    await desktop.page.locator('.settings-nav-item').filter({ hasText: '\u7ec8\u7aef' }).click()
  }
  await openSettings()
  await desktop.page.locator('#terminal-font-select').selectOption('__custom__')
  await desktop.page.locator('#terminal-font-name').fill('AIOpsTerm Missing Font 123456789')
  await desktop.page.locator('.terminal-font-settings button[type="submit"]').click()
  await expect(desktop.page.locator('#terminal-font-error')).toBeVisible()
  expect((await desktop.api('getConfig')).terminal.fontFamily).toBe(TERMINAL_FONT_FAMILY)
  await desktop.page.locator('#terminal-font-name').fill(font)
  await desktop.page.locator('.terminal-font-settings button[type="submit"]').click()
  await expect.poll(async () => (await desktop.api('getConfig')).terminal.fontFamily).toBe(JSON.stringify(font))
  await expect(desktop.page.locator('#terminal-font-error')).toHaveCount(0)
  await info.attach('custom-font-settings', { body: await desktop.page.locator('.terminal-font-settings').screenshot(), contentType: 'image/png' })
  await desktop.restart()
  await openSettings()
  await expect(desktop.page.locator('#terminal-font-select')).toHaveValue('__custom__')
  await expect(desktop.page.locator('#terminal-font-name')).toHaveValue(font)
  await desktop.page.locator('#terminal-font-select').selectOption(TERMINAL_FONT_FAMILY)
  await expect.poll(async () => (await desktop.api('getConfig')).terminal.fontFamily).toBe(TERMINAL_FONT_FAMILY)
  await expect(desktop.page.locator('#terminal-font-name')).toHaveCount(0)
})
