import { test, expect } from './support/desktop'
import { startResponsesProvider } from './support/responses-provider'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Run against an installed npm CLI through PowerShell, separate from the AI panel.
const cli = process.env.AIOPSTERM_TEST_CODEX_PS1
for (const scale of [1, 1.25, 1.5, 2]) {
  test(`PowerShell Codex input and cursor stay aligned at scale ${scale} @codex`, async ({ desktop }, info) => {
    test.skip(process.platform !== 'win32' || !cli, 'Requires Windows and AIOPSTERM_TEST_CODEX_PS1.')
    test.setTimeout(180000)
    await desktop.restart({ REGRESSION_SCALE: String(scale) })
    const provider = await startResponsesProvider()
    try {
      const home = join(desktop.root, 'home', '.codex')
      await mkdir(home, { recursive: true })
      await writeFile(join(home, 'config.toml'), [
        'model = "gpt-5.1"', 'model_provider = "regression"',
        'check_for_update_on_startup = false',
        '[model_providers.regression]', 'name = "Regression"',
        `base_url = ${JSON.stringify(provider.baseUrl)}`, 'wire_api = "responses"',
        '[windows]', 'sandbox = "unelevated"',
        `[projects.${JSON.stringify(desktop.root)}]`, 'trust_level = "trusted"'
      ].join('\n'))
      await desktop.page.addInitScript(() => {
        const state = (window as any).__localCursorProbe = { terminals: {} as Record<string, any>, output: '', protocol: [] as any[] }
        const OriginalWorker = window.Worker
        window.Worker = class extends OriginalWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options)
            this.addEventListener('message', ({ data }) => {
              if (data.type === 'data') state.protocol.push({ direction: 'terminal-input', at: performance.now(), data: data.data })
              if (data.type !== 'screen') return
              const snapshot = data.snapshot
              const terminal = state.terminals[snapshot.terminalId]
              if (!terminal) return
              if (snapshot.full) terminal.lines = {}
              for (const line of snapshot.lines) terminal.lines[line.y] = line
              terminal.snapshot = snapshot
            })
          }
          postMessage(message: any, transfer?: any) {
            if (message.type === 'create') state.terminals[message.options.terminalId] = { options: message.options, lines: {} }
            const id = message.terminalId || message.options?.terminalId
            const geometry = message.geometry || message.options?.geometry
            if (id && geometry && state.terminals[id]) state.terminals[id].geometry = geometry
            super.postMessage(message, transfer)
          }
        }
      })
      await desktop.page.reload()
      await desktop.page.evaluate(() => {
        ;(window as any).aiops.onTerminalData((event: any) => {
          const state = (window as any).__localCursorProbe
          state.protocol.push({ direction: 'pty-output', at: performance.now(), data: event.data })
          state.output += event.data
          state.lastOutputAt = Date.now()
        })
      })
      console.log('Opening PowerShell')
      await desktop.localTerminal()
      const terminal = desktop.page.locator('.terminal-pane.active .xterm-host')
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
      await desktop.page.keyboard.type(`Set-Location -LiteralPath ${quote(desktop.root)}; & ${quote(cli!)}`)
      await desktop.page.keyboard.press('Enter')
      const output = () => desktop.page.evaluate(() => (window as any).__localCursorProbe.output as string)
      await expect.poll(output).toContain('OpenAI Codex')
      const read = () => desktop.page.evaluate(() => {
        const state = (window as any).__localCursorProbe
        const terminal: any = Object.values(state.terminals).find((item: any) => item.options.surface === 'workspace')
        const input = document.querySelector('.terminal-pane.active .threaded-terminal-input') as HTMLElement | null
        const cursorModes = Array.from(state.output.matchAll(/\x1b\[\?([\d;]+)([hl])/g)).filter((match: any) => match[1].split(';').includes('25')) as RegExpMatchArray[]
        const expectedCursorVisible = cursorModes.at(-1)?.[2] !== 'l'
        return { ...terminal, expectedCursorVisible, outputLength: state.output.length, input: input ? { left: input.style.left, top: input.style.top } : null, dpr: window.devicePixelRatio }
      })
      const screenText = async () => Object.values((await read()).lines).map((line: any) => line.text).join('\n')
      const checks: any[] = []
      const capture = async (stage: string, suffix: string) => {
        console.log('Checking cursor:', stage)
        await expect.poll(screenText).toContain(suffix)
        await expect.poll(() => desktop.page.evaluate(() => Date.now() - (window as any).__localCursorProbe.lastOutputAt)).toBeGreaterThanOrEqual(500)
        const current = await read()
        const text = current.lines[current.snapshot.cursorY]?.text || ''
        const index = text.indexOf(suffix) + suffix.length
        const expectedX = Array.from(text.slice(0, index) as string).reduce((total: number, char: string) => total + (/[\u3400-\u9fff]/.test(char) ? 2 : 1), 0)
        checks.push({ stage, ...current, expectedX })
        await desktop.page.screenshot({ path: info.outputPath(stage + '.png') })
        await writeFile(info.outputPath('cursor-checks.json'), JSON.stringify(checks, null, 2))
        await writeFile(info.outputPath('terminal-output.txt'), await output())
        expect.soft(current.snapshot.cursorVisible, stage).toBe(current.expectedCursorVisible)
        expect.soft(text, stage).toContain(suffix)
        expect.soft(current.dpr, stage).toBe(scale)
        expect.soft(current.snapshot.cursorX, stage).toBe(expectedX)
        expect.soft(parseFloat(current.input.left), stage).toBeCloseTo(current.geometry.paddingLeft + expectedX * current.geometry.cellWidth, 1)
        expect.soft(parseFloat(current.input.top), stage).toBeCloseTo(current.geometry.paddingTop + current.snapshot.cursorY * current.geometry.cellHeight, 1)
      }
      const captureIdle = async (stage: string) => {
        console.log('Checking idle cursor:', stage)
        await expect.poll(screenText).toMatch(/^\s*\u203a /m)
        await expect.poll(() => desktop.page.evaluate(() => Date.now() - (window as any).__localCursorProbe.lastOutputAt)).toBeGreaterThanOrEqual(500)
        // Catch delayed footer updates that can move the cursor after a redraw.
        for (const sample of [0, 1]) {
          await desktop.page.waitForTimeout(1000)
          const current = await read()
          const prompt: any = Object.values(current.lines).filter((line: any) => /^\s*\u203a /.test(line.text)).at(-1)
          const expectedX = prompt.text.indexOf('\u203a') + 2
          checks.push({ stage, sample, ...current, expectedX, expectedY: prompt.y })
          await writeFile(info.outputPath('cursor-checks.json'), JSON.stringify(checks, null, 2))
          await desktop.page.screenshot({ path: info.outputPath(`${stage}-${sample}.png`) })
          expect.soft(current.snapshot.cursorVisible, stage).toBe(current.expectedCursorVisible)
          if (!current.expectedCursorVisible) continue
          expect.soft(current.snapshot.cursorY, stage).toBe(prompt.y)
          expect.soft(current.snapshot.cursorX, stage).toBe(expectedX)
          expect.soft(parseFloat(current.input.left), stage).toBeCloseTo(current.geometry.paddingLeft + expectedX * current.geometry.cellWidth, 1)
          expect.soft(parseFloat(current.input.top), stage).toBeCloseTo(current.geometry.paddingTop + prompt.y * current.geometry.cellHeight, 1)
        }
      }
      await terminal.click()
      await captureIdle('startup-idle')
      await desktop.page.keyboard.type('CLEAR_ME', { delay: 60 })
      await desktop.page.keyboard.press('Control+u')
      await captureIdle('cleared-idle')
      await desktop.page.keyboard.type('CURSOR_abc123', { delay: 60 })
      await capture('ascii', 'CURSOR_abc123')
      await desktop.page.keyboard.press('ArrowLeft')
      await desktop.page.keyboard.press('Backspace')
      await desktop.page.keyboard.type('X')
      await desktop.page.keyboard.press('End')
      await capture('edit', 'CURSOR_abc1X3')
      await desktop.page.keyboard.insertText('\u4e2d\u6587XYZ')
      await capture('mixed', 'XYZ')
      await desktop.page.keyboard.type(' abcdefghijklmnopqrstuvwxyz'.repeat(8) + ' WRAP_END', { delay: 15 })
      await capture('wrapped', 'WRAP_END')
      expect.soft(await screenText(), 'The multiline prompt must retain its first line').toContain('CURSOR_abc1X3')
      await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
      await desktop.page.keyboard.type('_RESIZED', { delay: 60 })
      await capture('resized', 'IZED')
      console.log('Submitting prompt')
      await desktop.page.keyboard.press('Enter')
      await expect.poll(() => provider.requests.length).toBeGreaterThan(0)
      await expect.poll(screenText).toContain('REGRESSION_CODEX_ANSWER')
      await captureIdle('response-idle')
      await desktop.page.keyboard.type('AFTER_RESPONSE', { delay: 60 })
      await capture('after-response', 'AFTER_RESPONSE')
      await desktop.page.keyboard.press('Control+u')
      console.log('Returning to PowerShell')
      await desktop.page.keyboard.type('/quit', { delay: 100 })
      await desktop.page.keyboard.press('Enter')
      await desktop.shellReady()
      await desktop.page.keyboard.type('echo SHELL_AFTER_CODEX')
      await desktop.page.keyboard.press('Enter')
      await expect.poll(() => desktop.replay()).toMatch(/[\r\n]SHELL_AFTER_CODEX[\r\n]/)
    } finally {
      const finalOutput = await desktop.page.evaluate(() => (window as any).__localCursorProbe?.output || '').catch(() => '')
      await writeFile(info.outputPath('terminal-output.txt'), finalOutput)
      const protocol = await desktop.page.evaluate(() => (window as any).__localCursorProbe?.protocol || []).catch(() => [])
      await writeFile(info.outputPath('protocol.json'), JSON.stringify(protocol, null, 2))
      const terminals = await desktop.api('invokeControlRequest', 'terminal.list', {}).catch(() => null)
      for (const terminal of terminals?.data?.terminals || []) {
        if (terminal.sessionId) await desktop.api('killTerminal', terminal.sessionId)
      }
      console.log('Closing local response provider')
      await provider.close()
      console.log('Stopping disposable Codex daemons')
      // Stop the disposable daemon and its plugin fetches before removing the
      // test home. Detached git children can otherwise keep Windows files open.
      const prefix = join(desktop.root, 'home', '.codex') + '\\'
      const script = `$prefix = '${prefix.replace(/'/g, "''")}'; Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.Replace('\\\\?\\','').StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -match '^git' -and $_.CommandLine -and $_.CommandLine.Replace('/','\\').Contains($prefix)) } | ForEach-Object { if (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue) { taskkill.exe /PID $_.ProcessId /T /F | Out-Null } }; exit 0`
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 })
    }
  })
}
