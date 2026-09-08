import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '../regression/support/desktop'

test.skip(process.platform !== 'linux', 'Linux Bash and PTY recovery validation.')

test('terminal history and cwd survive reload and application restart', async ({ desktop }) => {
  await desktop.localTerminal()
  const cwd = join(desktop.root, 'recovered project')
  await mkdir(cwd)
  await desktop.page.keyboard.type(`cd '${cwd}'`)
  await desktop.page.keyboard.press('Enter')
  await desktop.page.keyboard.type('echo RECOVERY_HISTORY_MARKER')
  await desktop.page.keyboard.press('Enter')
  await expect.poll(() => desktop.replay()).toMatch(/[\r\n]RECOVERY_HISTORY_MARKER[\r\n]/)
  await expect.poll(async () => {
    const saved = await desktop.api('loadTerminalRecovery')
    return saved.snapshot?.tabs.some((tab: any) => tab.cwd === cwd && tab.history.includes('RECOVERY_HISTORY_MARKER'))
  }).toBe(true)
  const initial = (await desktop.api('invokeControlRequest', 'terminal.list', {})).data.terminals.find((tab: any) => tab.connected)
  expect(initial.processId).toBeGreaterThan(0)
  await desktop.page.reload()
  await expect.poll(async () => {
    const result = await desktop.api('invokeControlRequest', 'terminal.list', {})
    return result.data?.terminals?.find((tab: any) => tab.connected)?.sessionId
  }).toBe(initial.sessionId)
  await expect.poll(() => desktop.replay()).toContain('RECOVERY_HISTORY_MARKER')
  const reloaded = (await desktop.api('invokeControlRequest', 'terminal.list', {})).data.terminals.find((tab: any) => tab.connected)
  expect(reloaded.processId).toBe(initial.processId)
  await desktop.restart()
  await expect.poll(async () => {
    const result = await desktop.api('invokeControlRequest', 'terminal.list', {})
    return result.data?.terminals?.some((tab: any) => tab.connected && tab.cwd === cwd)
  }).toBe(true)
  await expect.poll(() => desktop.replay()).toContain('RECOVERY_HISTORY_MARKER')
  const restarted = (await desktop.api('invokeControlRequest', 'terminal.list', {})).data.terminals.find((tab: any) => tab.connected)
  expect(restarted.processId).not.toBe(initial.processId)
  await desktop.page.locator('.terminal-pane.active .xterm-host').click()
  await desktop.page.keyboard.type('printf "RESTORED_PWD=%s\\n" "$PWD"')
  await desktop.page.keyboard.press('Enter')
  await expect.poll(() => desktop.replay()).toContain(`RESTORED_PWD=${cwd}`)
  expect(desktop.errors).toEqual([])
})

test('disabled recovery does not reopen a saved terminal on restart', async ({ desktop }) => {
  await desktop.localTerminal()
  await expect.poll(async () => (await desktop.api('loadTerminalRecovery')).snapshot?.tabs.length).toBe(1)
  const config = await desktop.api('getConfig')
  await desktop.api('saveConfig', { terminal: { ...config.terminal, restoreTerminalTabs: false } })
  await desktop.restart()
  await expect.poll(async () => (await desktop.api('loadTerminalRecovery')).snapshot?.tabs.length).toBe(0)
  const listed = await desktop.api('invokeControlRequest', 'terminal.list', {})
  expect(listed.data.terminals.some((tab: any) => tab.connected || tab.sessionId)).toBe(false)
  expect(desktop.errors).toEqual([])
})

test('a corrupt recovery file leaves startup usable', async ({ desktop }) => {
  await desktop.app.close()
  await writeFile(join(desktop.root, 'state', 'terminal-recovery.json'), '{interrupted')
  await desktop.start()
  const listed = await desktop.api('invokeControlRequest', 'terminal.list', {})
  expect(listed.data.terminals.some((tab: any) => tab.connected || tab.sessionId)).toBe(false)
  await desktop.localTerminal()
  await expect.poll(() => desktop.replay()).toContain('REGRESSION_READY')
  expect(desktop.errors).toEqual([])
})

test('a normally exited shell restores its history without starting another process', async ({ desktop }) => {
  await desktop.localTerminal()
  await desktop.page.keyboard.type('exit')
  await desktop.page.keyboard.press('Enter')
  await expect.poll(async () => {
    const saved = (await desktop.api('loadTerminalRecovery')).snapshot
    return saved?.tabs.length === 1 && saved.tabs[0].resume === false && saved.tabs[0].history.includes('REGRESSION_READY')
  }).toBe(true)
  await desktop.restart()
  await expect.poll(() => desktop.replay()).toContain('REGRESSION_READY')
  const listed = await desktop.api('invokeControlRequest', 'terminal.list', {})
  expect(listed.data.terminals.some((tab: any) => tab.connected || tab.sessionId)).toBe(false)
  expect(desktop.errors).toEqual([])
})
