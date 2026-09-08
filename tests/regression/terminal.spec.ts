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
    if (action === '清屏') {
      await expect(desktop.page.locator('.terminal-pane.active .terminal-output-mirror')).not.toContainText('REGRESSION_READY')
    }
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
  await desktop.menu('输入命令')
  await desktop.page.keyboard.press('Escape')
  const search = desktop.page.locator('.workspace-search input')
  await search.click()
  await desktop.page.keyboard.type('FOCUS_MUST_STAY_IN_SEARCH')
  await expect(search).toBeFocused()
  await expect(search).toHaveValue(/FOCUS_MUST_STAY_IN_SEARCH/)
})

test('terminal multiline Unicode paste and composition do not submit premature Enter @core', async ({ desktop }) => {
  await desktop.localTerminal()
  const terminal = desktop.page.locator('.terminal-pane.active .threaded-terminal-input, .terminal-pane.active .xterm-helper-textarea').first()
  await desktop.page.keyboard.type('echo REGRESSION_COMPOSITION_GUARD')
  await terminal.dispatchEvent('compositionstart', { data: '' })
  await terminal.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true })
  // Observe the negative condition for long enough to allow a PTY round trip.
  await desktop.page.waitForTimeout(200)
  expect(await desktop.replay()).not.toMatch(/[\r\n]REGRESSION_COMPOSITION_GUARD[\r\n]/)
  await terminal.dispatchEvent('compositionend', { data: '' })
  await desktop.page.keyboard.press('Enter')
  await expect.poll(() => desktop.replay()).toMatch(/[\r\n]REGRESSION_COMPOSITION_GUARD[\r\n]/)
  const value = 'echo REGRESSION_UNICODE_中文\necho REGRESSION_SECOND_LINE'
  await desktop.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), value)
  await desktop.menu('粘贴')
  await desktop.terminalFocused()
  await desktop.page.keyboard.press('Enter')
  await expect.poll(() => desktop.replay()).toMatch(/[\r\n]REGRESSION_UNICODE_中文[\r\n]/)
  await expect.poll(() => desktop.replay()).toMatch(/[\r\n]REGRESSION_SECOND_LINE[\r\n]/)
})

test('delayed clipboard completion does not steal focus from another input @core', async ({ desktop }) => {
  await desktop.localTerminal()
  // Delay only the OS clipboard boundary; keep the menu, command and focus paths real.
  await desktop.page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: () => new Promise<string>((resolve) => {
      ;(window as any).__completeRegressionClipboard = () => resolve('echo REGRESSION_DELAYED_PASTE')
    }) })
  })
  await desktop.menu('粘贴')
  await expect.poll(() => desktop.page.evaluate(() => typeof (window as any).__completeRegressionClipboard)).toBe('function')
  const search = desktop.page.locator('.workspace-search input')
  await search.click()
  await desktop.page.evaluate(() => (window as any).__completeRegressionClipboard())
  await expect.poll(() => desktop.replay()).toContain('REGRESSION_DELAYED_PASTE')
  await expect(search).toBeFocused()
  await desktop.page.keyboard.type('REGRESSION_SEARCH_OWNS_FOCUS')
  await expect(search).toHaveValue(/REGRESSION_SEARCH_OWNS_FOCUS/)
  expect(await desktop.replay()).not.toContain('REGRESSION_SEARCH_OWNS_FOCUS')
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
