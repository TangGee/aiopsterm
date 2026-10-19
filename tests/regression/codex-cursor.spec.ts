import { test, expect } from './support/desktop'
import { startResponsesProvider } from './support/responses-provider'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

for (const scale of [1, 1.25, 1.5, 2]) {
  test(`Codex input and cursor stay aligned at scale ${scale} @codex`, async ({ desktop }, info) => {
    test.setTimeout(180000)
    await desktop.restart({ REGRESSION_SCALE: String(scale) })
    const provider = await startResponsesProvider()
    try {
      const config = await desktop.api('getConfig')
      await desktop.api('saveConfig', {
        modelProvider: 'openai', modelName: 'gpt-5.1',
        modelSettings: { ...config.modelSettings,
          providers: { ...config.modelSettings?.providers, openai: { apiFormat: 'responses', baseUrl: provider.baseUrl, apiKey: 'regression-local-only', modelId: 'gpt-5.1' } },
          options: [{ name: 'gpt-5.1', checked: true, locked: false, type: 'custom', apiProvider: 'openai' }]
        }
      })
      if (process.platform === 'win32') {
        const home = join(desktop.root, 'state', 'codex-agent')
        await mkdir(home, { recursive: true })
        await writeFile(join(home, 'config.toml'), '[windows]\nsandbox = "unelevated"\n')
      }
      await desktop.page.addInitScript(() => {
        const state = (window as any).__cursorProbe = { terminals: {} as Record<string, any>, output: '' }
        const OriginalWorker = window.Worker
        window.Worker = class extends OriginalWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options)
            this.addEventListener('message', ({ data }) => {
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
            if (message.type === 'create') {
              state.terminals[message.options.terminalId] = { options: message.options, lines: {} }
            }
            const id = message.terminalId || message.options?.terminalId
            const geometry = message.geometry || message.options?.geometry
            if (id && geometry && state.terminals[id]) state.terminals[id].geometry = geometry
            super.postMessage(message, transfer)
          }
        }
      })
      await desktop.page.reload()
      await desktop.localTerminal()
      await desktop.page.evaluate(() => {
        ;(window as any).aiops.onCodexSessionLifecycle((event: any) => { (window as any).__cursorProbe.sessionId = event.id })
        ;(window as any).aiops.onCodexSessionData((event: any) => {
          const state = (window as any).__cursorProbe
          state.output += event.data
          state.lastOutputAt = Date.now()
        })
      })
      await desktop.page.getByTestId('ai-panel-mode-open').click()
      await desktop.page.getByTestId('ai-mode-codex').click()
      await desktop.page.getByTestId('ai-codex-bind-open').click()
      await desktop.page.getByTestId('ai-codex-bind-current').click()
      const terminal = desktop.page.getByTestId('ai-codex-xterm').filter({ visible: true })
      const output = () => desktop.page.evaluate(() => (window as any).__cursorProbe.output as string)
      await expect.poll(output).toContain('Press enter to continue')
      if (process.platform === 'win32') {
        const requirements = join(process.env.ProgramData || 'C:\\ProgramData', 'OpenAI', 'Codex', 'requirements.toml')
        const policy = await readFile(requirements, 'utf8').catch(() => '')
        if (/hooks\s*=\s*true/.test(policy)) {
          const configPath = join(desktop.root, 'state', 'codex-agent', 'config.toml')
          const generated = await readFile(configPath, 'utf8')
          await writeFile(configPath, generated.replace(/^hooks = false$/m, 'hooks = true'))
          await info.attach('managed-hooks-policy', { body: 'Disposable test profile honors the machine requirement hooks=true.', contentType: 'text/plain' })
        }
      }
      await terminal.click()
      await desktop.page.keyboard.press('Enter')
      await expect.poll(output).toContain('/model')
      const read = () => desktop.page.evaluate(() => {
        const state = (window as any).__cursorProbe
        const terminal: any = Object.values(state.terminals).find((item: any) => item.options.surface === 'codex')
        const input = document.querySelector('[data-testid="ai-codex-xterm"] .threaded-terminal-input') as HTMLElement | null
        return { ...terminal, input: input ? { left: input.style.left, top: input.style.top } : null, dpr: window.devicePixelRatio }
      })
      const checks: any[] = []
      const capture = async (stage: string, suffix: string) => {
        await expect.poll(async () => JSON.stringify((await read()).lines)).toContain(suffix)
        await expect.poll(() => desktop.page.evaluate(() => (window as any).__AIOPSTERM_THREADED_TERMINAL_DEBUG__.stats().renderDebug.frames)).toBeGreaterThan(0)
        const current = await read()
        const line = current.lines[current.snapshot.cursorY]
        const text = line?.text || ''
        const index = text.indexOf(suffix) + suffix.length
        const expectedX = Array.from(text.slice(0, index) as string).reduce((total: number, char: string) => total + (/[\u3400-\u9fff]/.test(char) ? 2 : 1), 0)
        checks.push({ stage, ...current, expectedX })
        await desktop.page.screenshot({ path: info.outputPath(stage + '.png') })
        await writeFile(info.outputPath('cursor-checks.json'), JSON.stringify(checks, null, 2))
        await writeFile(info.outputPath('terminal-output.txt'), await output())
        expect.soft(text, stage).toContain(suffix)
        expect.soft(current.dpr, stage).toBe(scale)
        expect.soft(current.snapshot.cursorX, stage).toBe(expectedX)
        expect.soft(parseFloat(current.input.left), stage).toBeCloseTo(current.geometry.paddingLeft + expectedX * current.geometry.cellWidth, 1)
        expect.soft(parseFloat(current.input.top), stage).toBeCloseTo(current.geometry.paddingTop + current.snapshot.cursorY * current.geometry.cellHeight, 1)
      }
      await terminal.click()
      await desktop.page.keyboard.type('CURSOR_abc123', { delay: 60 })
      await capture('ascii', 'CURSOR_abc123')
      await desktop.page.keyboard.press('ArrowLeft')
      await desktop.page.keyboard.press('Backspace')
      await desktop.page.keyboard.type('X')
      await desktop.page.keyboard.press('End')
      await capture('edit', 'CURSOR_abc1X3')
      await desktop.page.keyboard.insertText('\u4e2d\u6587XYZ')
      await capture('mixed', 'XYZ')
      await desktop.page.keyboard.type(' abcdefghijklmnopqrstuvwxyz'.repeat(5) + ' WRAP_END', { delay: 15 })
      await capture('wrapped', 'WRAP_END')
      expect.soft(JSON.stringify((await read()).lines), 'The multiline prompt must retain its first line').toContain('CURSOR_abc1X3')
      await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750))
      await desktop.page.keyboard.type('_RESIZED', { delay: 60 })
      await capture('resized', 'IZED')
      await expect.poll(() => desktop.page.evaluate(() => Date.now() - (window as any).__cursorProbe.lastOutputAt)).toBeGreaterThanOrEqual(500)
      await desktop.page.keyboard.press('Enter')
      await expect.poll(() => provider.requests.length).toBeGreaterThan(0)
      await expect.poll(output).toContain('REGRESSION_CODEX_ANSWER')
    } finally {
      const sessionId = await desktop.page.evaluate(() => (window as any).__cursorProbe?.sessionId).catch(() => undefined)
      if (sessionId) await desktop.api('killCodexSession', sessionId)
      await provider.close()
    }
  })
}
