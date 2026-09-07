import { test, expect } from './support/desktop'

for (const action of ['粘贴', '清屏', '字体放大', '字体缩小', 'Escape']) {
  test(`terminal menu ${action} preserves keyboard ownership @core`, async ({ desktop }) => {
    await desktop.localTerminal()
    const { page, app } = desktop
    const columns = () => page.evaluate(() => (window as any).__AIOPSTERM_THREADED_TERMINAL_DEBUG__?.stats().hosts.find((host: any) => host.visible)?.cols || 0)
    await expect.poll(columns).toBeGreaterThan(0)
    const initialColumns = await columns()
    if (action === '粘贴') {
      await app.evaluate(({ clipboard }) => clipboard.writeText('echo REGRESSION_PASTE_OK'))
    }
    if (action === 'Escape') {
      await page.locator('.terminal-pane.active .xterm-host').click({ button: 'right' })
      await expect(page.locator('.terminal-context-menu')).toBeVisible()
      await page.keyboard.press('Escape')
    } else await desktop.menu(action)
    await desktop.terminalFocused()
    if (action === '字体放大') await expect.poll(columns).toBeLessThan(initialColumns)
    if (action === '字体缩小') await expect.poll(columns).toBeGreaterThan(initialColumns)
    // Do not click or focus the terminal after the action: that would hide the regression.
    if (action !== '粘贴') await page.keyboard.type('echo REGRESSION_KEYBOARD_OK')
    await page.keyboard.press('Enter')
    const marker = action === '粘贴' ? 'REGRESSION_PASTE_OK' : 'REGRESSION_KEYBOARD_OK'
    await expect.poll(() => desktop.replay()).toMatch(new RegExp(`(?:^|[\\r\\n])${marker}(?:[\\r\\n]|$)`))
  })
}

test('settings and command overlay return focus without stealing a later click @core', async ({ desktop }) => {
  await desktop.localTerminal()
  await desktop.menu('输入命令')
  const input = desktop.page.locator('.command-line.floating input')
  await expect(input).toBeFocused()
  await desktop.page.keyboard.press('Escape')
  await desktop.terminalFocused()
  await desktop.page.locator('[data-module-key="settings"]').click()
  await expect(desktop.page.locator('.settings-workspace-title')).toBeVisible()
  await desktop.page.locator('[data-module-key="workspace"]').click()
  await desktop.terminalFocused()
  await desktop.page.keyboard.type('echo REGRESSION_RETURN_OK')
  await desktop.page.keyboard.press('Enter')
  await expect.poll(() => desktop.replay()).toMatch(/[\r\n]REGRESSION_RETURN_OK[\r\n]/)
})

test('real terminal exit does not return reactive objects across the preload bridge @core', async ({ desktop }) => {
  await desktop.localTerminal()
  await desktop.page.locator('.terminal-pane.active .xterm-host').click()
  await desktop.page.keyboard.type('exit')
  await desktop.page.keyboard.press('Enter')
  await expect.poll(async () => {
    const result = await desktop.api('invokeControlRequest', 'terminal.list', {})
    return result.data?.terminals?.some((item: any) => item.connected) || false
  }).toBe(false)
  expect(desktop.errors).toEqual([])
})
