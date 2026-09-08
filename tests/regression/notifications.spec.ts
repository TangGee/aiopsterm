import { test, expect } from './support/desktop'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

for (const source of ['codex', 'claude-code']) {
  test(`installed ${source} hook traverses real terminal and notification UI @core`, async ({ desktop }) => {
    const installed = await desktop.api('installAgentHook', { source })
    expect(installed.ok, JSON.stringify(installed)).toBe(true)
    const configPath = join(desktop.root, 'home', source === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    const commands: string[] = []
    const collect = (value: any) => {
      if (!value || typeof value !== 'object') return
      if (typeof value.command === 'string') commands.push(value.command)
      for (const nested of Object.values(value)) collect(nested)
    }
    collect(config.hooks.Stop)
    expect(commands.length).toBeGreaterThan(0)
    await desktop.localTerminal()
    const path = join(desktop.root, 'emit-hook.cjs')
    const sessionId = `regression-hook-${source}`
    const payload = { session_id: sessionId, cwd: desktop.root, project_dir: desktop.root, last_assistant_message: 'REGRESSION_HOOK_FINISHED' }
    // Execute the installed command with the real terminal's managed environment.
    await writeFile(path, `const {spawnSync}=require('node:child_process');const r=spawnSync(${JSON.stringify(commands[0])},{shell:true,input:${JSON.stringify(JSON.stringify(payload))},encoding:'utf8',env:process.env});if(r.status!==0)throw new Error(r.stderr);console.log('REGRESSION_HOOK_SENT');\n`)
    const quote = (value: string) => `'${value.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")}'`
    let completed = 0
    const send = async () => {
      await desktop.page.locator('[data-module-key="workspace"]').click()
      await desktop.page.locator('.terminal-pane.active .xterm-host').click()
      await desktop.page.keyboard.type(`${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(path)}`)
      await desktop.page.keyboard.press('Enter')
      completed++
      await expect.poll(async () => (await desktop.replay()).split(/\r?\n/).filter((line: string) => line.trim() === 'REGRESSION_HOOK_SENT').length).toBe(completed)
    }
    await send()
    await expect(desktop.page.getByTestId('ai-attention-count')).toHaveText('1')
    await desktop.page.getByTestId('ai-attention-bell').click()
    const row = desktop.page.locator('.ai-session-row').filter({ hasText: 'REGRESSION_HOOK_FINISHED' })
    await expect(row).toHaveCount(1)
    await send()
    await expect(desktop.page.getByTestId('ai-attention-count')).toHaveText('1')
    await desktop.page.getByTestId('ai-attention-bell').click()
    await row.locator('.ai-session-handle').click()
    await expect(desktop.page.getByTestId('ai-attention-count')).toHaveCount(0)
    expect((await desktop.api('uninstallAgentHook', { source })).ok).toBe(true)
  })
}
