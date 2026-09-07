import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isolatedEnvironment } from './environment'

export class Desktop {
  app!: ElectronApplication
  page!: Page
  errors: string[] = []
  constructor(readonly root: string) {}
  async start(env: NodeJS.ProcessEnv = {}) {
    const home = join(this.root, 'home')
    await mkdir(home, { recursive: true })
    const bin = join(this.root, 'bin')
    await mkdir(bin, { recursive: true })
    const cli = join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    const installer = resolve('tests/regression/support/mcp-installer.cjs')
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
    await writeFile(cli, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${installer}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(installer)} "$@"\n`)
    if (process.platform !== 'win32') await chmod(cli, 0o700)
    // Start from a minimal OS environment. Never inherit model keys or live agent homes.
    const clean = await isolatedEnvironment(this.root)
    this.app = await electron.launch({
      ...(process.env.AIOPSTERM_PACKAGED_APP ? { executablePath: resolve(process.env.AIOPSTERM_PACKAGED_APP) } : {}),
      args: [...(process.env.AIOPSTERM_PACKAGED_APP ? [] : ['.']), '--lang=zh-CN', '--force-device-scale-factor=1',
        ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
      env: {
        ...clean, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${clean.PATH || clean.Path || ''}`,
        AIOPSTERM_REGRESSION_ROOT: this.root,
        HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'),
        APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
        CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
        NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: join(this.root, 'state'),
        AIOPSTERM_ASSETS_ENABLE_SEED: '1', AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED: '1',
        AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED: '1', AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED: '1',
        AIOPSTERM_MCP_DISCOVERY_DISABLE: '1', AIOPSTERM_E2E_DIALOG_FIXTURES: '1',
        AIOPSTERM_AI_CHAT_BACKEND_DOUBLE: '0', AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE: '0',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env
      }
    })
    this.page = await this.app.firstWindow()
    this.page.on('pageerror', (error) => this.errors.push(error.stack || error.message))
    await this.page.waitForLoadState('domcontentloaded')
    await this.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 900) })
    await expect(this.page.locator('.app-shell')).toBeVisible()
    if ((await this.api('getConfig')).language !== 'zh-CN') {
      await this.api('saveConfig', { language: 'zh-CN' })
      await this.page.reload()
      await expect(this.page.locator('.app-shell')).toBeVisible()
    }
    await this.page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' })
    return this
  }
  async api(method: string, ...args: unknown[]): Promise<any> {
    return this.page.evaluate(async ({ method, args }) => (window as any).aiops[method](...args), { method, args })
  }
  async restart() { await this.app.close(); await this.start() }
  async localTerminal() {
    await this.page.locator('[data-module-key="workspace"]').click()
    await this.page.locator('.workspace-search input').fill('127.0.0.1')
    await this.page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first().dblclick()
    await expect(this.page.locator('.terminal-pane.active .xterm-host')).toBeVisible()
    await expect.poll(async () => {
      const result = await this.api('invokeControlRequest', 'terminal.list', {})
      return result.data?.terminals?.some((item: any) => item.connected)
    }).toBe(true)
    await this.page.locator('.terminal-pane.active .xterm-host').click()
    await this.page.keyboard.type('echo REGRESSION_READY')
    await this.page.keyboard.press('Enter')
    await expect.poll(() => this.replay()).toMatch(/[\r\n]REGRESSION_READY[\r\n]/)
  }
  async replay() {
    const result = await this.api('invokeControlRequest', 'terminal.replay', { tailLines: 100 })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    return String(result.data?.text || result.data?.snapshot_text || '')
  }
  async menu(label: string) {
    await this.page.locator('.terminal-pane.active .xterm-host').click({ button: 'right' })
    await this.page.locator('.terminal-context-menu button').filter({ hasText: label }).click()
    await expect(this.page.locator('.terminal-context-menu')).toHaveCount(0)
  }
  async terminalFocused() {
    await expect.poll(() => this.page.evaluate(() => {
      const element = document.activeElement
      return !!element?.matches('.threaded-terminal-input, .xterm-helper-textarea')
    })).toBe(true)
  }
}

export const test = base.extend<{ desktop: Desktop }>({
  desktop: async ({}, use, info) => {
    const root = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'aio-reg-'))
    const desktop = new Desktop(root)
    try {
      await desktop.start()
      await use(desktop)
      expect(desktop.errors, 'Unhandled renderer errors').toEqual([])
    } finally {
      if (desktop.app) {
        if (info.status !== info.expectedStatus) {
          await info.attach('desktop', { body: await desktop.page.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' })
          await info.attach('renderer-errors', { body: JSON.stringify(desktop.errors), contentType: 'application/json' })
        }
        await desktop.app.close().catch(() => undefined)
      }
      await rm(root, { recursive: true, force: true })
    }
  }
})
export { expect }
