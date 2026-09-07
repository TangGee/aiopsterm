import { mkdir } from 'node:fs/promises'
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
})
