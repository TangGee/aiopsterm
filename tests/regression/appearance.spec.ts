import { test, expect } from './support/desktop'
import { themePresets } from '../../src/renderer/src/services/app/themeRuntime'
import { existsSync } from 'node:fs'

const themes = process.env.AIOPSTERM_FULL_VISUAL === '1' ? Object.keys(themePresets) : ['dark', 'light', 'ubuntu-terminal']
for (const theme of themes) {
  test(`appearance ${theme} font layout and restart persistence @visual`, async ({ desktop }, info) => {
    const freeze = async () => {
      await desktop.page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }'
        + (process.platform === 'linux' ? 'body { font-family: "Noto Sans CJK SC", sans-serif !important; }' : '') })
      await desktop.page.evaluate(() => document.fonts.ready)
    }
    const config = await desktop.api('getConfig')
    await desktop.api('saveConfig', { theme, terminal: { ...config.terminal, fontSize: 18, fontFamily: 'monospace' } })
    await desktop.page.reload()
    await expect(desktop.page.locator('html')).toHaveAttribute('data-theme-id', theme)
    await desktop.page.locator('[data-module-key="settings"]').click()
    // Pin the viewport and fonts; screenshots are separated by operating system.
    await freeze()
    const shell = desktop.page.locator('.app-shell')
    const layout = await shell.evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: element.clientWidth, scroll: element.scrollWidth, color: style.color, fontSize: style.fontSize }
    })
    expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1)
    expect(parseFloat(layout.fontSize)).toBeGreaterThanOrEqual(12)
    const before = await shell.screenshot({ animations: 'disabled' })
    await info.attach(`${theme}-before`, { body: before, contentType: 'image/png' })
    const approved = existsSync(info.snapshotPath(`${theme}.png`))
    info.annotations.push({ type: 'visual-baseline', description: approved ? 'approved OS baseline' : 'OS baseline absent; roundtrip comparison active' })
    if (process.env.AIOPSTERM_VISUAL_BASELINES === '1' || approved) {
      // Missing baselines fail; updating them is an explicit maintainer action.
      await expect(shell).toHaveScreenshot(`${theme}.png`)
    }
    await desktop.restart()
    const restored = await desktop.api('getConfig')
    expect(restored.theme).toBe(theme)
    expect(restored.terminal).toMatchObject({ fontSize: 18, fontFamily: 'monospace' })
    await expect(desktop.page.locator('html')).toHaveAttribute('data-theme-id', theme)
    await desktop.page.locator('[data-module-key="settings"]').click()
    await freeze()
    const after = await desktop.page.locator('.app-shell').screenshot({ animations: 'disabled' })
    await info.attach(`${theme}-after`, { body: after, contentType: 'image/png' })
    // Compare before/after on this OS even when no approved OS golden exists yet.
    const difference = await desktop.app.evaluate(({ nativeImage }, { before, after }) => {
      const left = nativeImage.createFromBuffer(Buffer.from(before, 'base64'))
      const right = nativeImage.createFromBuffer(Buffer.from(after, 'base64'))
      if (JSON.stringify(left.getSize()) !== JSON.stringify(right.getSize())) return 1
      const a = left.toBitmap()
      const b = right.toBitmap()
      let changed = 0
      for (let i = 0; i < a.length; i += 4) {
        if ([0, 1, 2, 3].some((channel) => Math.abs(a[i + channel] - b[i + channel]) > 16)) changed++
      }
      return changed / (a.length / 4)
    }, { before: before.toString('base64'), after: after.toString('base64') })
    // Gradient thumbnail edge rasterization can vary slightly between GPU processes.
    expect(difference, 'Theme/settings visual state changed after restart').toBeLessThanOrEqual(0.0005)
    if (approved) await expect(desktop.page.locator('.app-shell')).toHaveScreenshot(`${theme}.png`)
    await desktop.localTerminal()
    const metrics = await desktop.page.locator('.terminal-pane.active').evaluate((element) => {
      const host = element.querySelector('.xterm-host')!
      return { width: host.clientWidth, height: host.clientHeight, canvasCount: host.querySelectorAll('canvas').length }
    })
    expect(metrics.width).toBeGreaterThan(100)
    expect(metrics.height).toBeGreaterThan(100)
  })
}

test('terminal font controls change real grid metrics and survive restart @visual', async ({ desktop }, info) => {
  await desktop.localTerminal()
  const columns = () => desktop.page.evaluate(() => (window as any).__AIOPSTERM_THREADED_TERMINAL_DEBUG__.stats().hosts.find((host: any) => host.visible)?.cols || 0)
  const measurements: Array<{ size: number; columns: number }> = []
  for (const size of [12, 18, 24]) {
    await desktop.page.locator('[data-module-key="settings"]').click()
    await desktop.page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
    const field = desktop.page.locator('.settings-form-row').filter({ hasText: '字体大小' }).locator('input')
    await field.fill(String(size))
    await field.press('Tab')
    await expect.poll(async () => (await desktop.api('getConfig')).terminal.fontSize).toBe(size)
    await desktop.page.locator('[data-module-key="workspace"]').click()
    await expect.poll(columns).toBeGreaterThan(0)
    if (measurements.length) await expect.poll(columns).toBeLessThan(measurements.at(-1)!.columns)
    measurements.push({ size, columns: await columns() })
    await info.attach(`font-${size}`, { body: await desktop.page.locator('.terminal-grid').screenshot(), contentType: 'image/png' })
  }
  await desktop.page.locator('[data-module-key="settings"]').click()
  await desktop.page.locator('.settings-nav-item').filter({ hasText: '终端' }).click()
  const family = desktop.page.locator('.settings-form-row').filter({ hasText: '字体' }).locator('select')
  const options = await family.locator('option').evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value))
  expect(options.length).toBeGreaterThan(1)
  await family.selectOption(options[1])
  await expect.poll(async () => (await desktop.api('getConfig')).terminal.fontFamily).toBe(options[1])
  await desktop.restart()
  expect((await desktop.api('getConfig')).terminal).toMatchObject({ fontSize: 24, fontFamily: options[1] })
  await info.attach('grid-metrics', { body: JSON.stringify(measurements), contentType: 'application/json' })
})
