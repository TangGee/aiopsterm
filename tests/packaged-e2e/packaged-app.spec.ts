import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const defaultExecutablePath = () => {
  if (process.platform === 'win32') return 'dist/win-unpacked/aiopsterm.exe'
  if (process.platform === 'darwin') {
    return `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/aiopsterm.app/Contents/MacOS/aiopsterm`
  }
  return 'dist/linux-unpacked/aiopsterm'
}

const controlSocketPath = async (userDataDir: string, pid: number) => {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\aiopsterm-control-${pid}`
  }
  const controlDir = join(userDataDir, 'control')
  const entries = await readdir(controlDir)
  const socket = entries.find((entry) => entry.endsWith('.sock'))
  if (!socket) throw new Error(`Control socket was not created under ${controlDir}`)
  return join(controlDir, socket)
}

const socketJsonRequest = <T extends Record<string, any> = Record<string, any>>(socketPath: string, request: Record<string, any>) =>
  new Promise<T>((resolveRequest, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(10_000)
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      socket.end()
      try {
        resolveRequest(JSON.parse(buffer.slice(0, newlineIndex).trim()) as T)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`socket request timed out: ${socketPath}`))
    })
    socket.on('error', reject)
  })

test('packaged app starts, opens interactive local and Codex terminals, browses local files, and accepts notification control requests', async () => {
  const executablePath = resolve(process.env.AIOPSTERM_PACKAGED_APP || defaultExecutablePath())
  const testTempDir = process.platform === 'darwin' ? '/tmp' : tmpdir()
  const userDataDir = join(testTempDir, `aiops-e2e-${Date.now()}`)
  const localFilesDir = join(testTempDir, `aiops-files-${Date.now()}`)
  await mkdir(userDataDir, { recursive: true })
  await mkdir(localFilesDir, { recursive: true })
  await writeFile(join(localFilesDir, 'packaged-e2e.txt'), 'packaged e2e local file\n', 'utf-8')

  const app = await electron.launch({
    executablePath,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_FILES_ENABLE_SEED: '1',
      AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED: '1',
      AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
      AIOPSTERM_E2E_DIALOG_FIXTURES: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })

  try {
    const page = await app.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText('aiopsterm', { exact: true })).toBeVisible()
    if (process.platform === 'darwin') {
      await expect(page.locator('.top-bar')).toHaveClass(/platform-macos/)
      const topLeftBox = await page.locator('.top-left').boundingBox()
      expect(topLeftBox?.x).toBeGreaterThanOrEqual(78)
    }
    await page.getByText('127.0.0.1', { exact: true }).dblclick()
    await expect(page.locator('.terminal-tab').first()).toBeVisible({ timeout: 30_000 })
    const terminalMirror = page.locator('.terminal-output-mirror').first()
    await expect(terminalMirror).toBeVisible()
    const socketPath = process.env.AIOPSTERM_PACKAGED_CONTROL_SOCKET || (await controlSocketPath(userDataDir, app.process().pid || 0))
    const panelId = await page.locator('.terminal-tab.active').getAttribute('data-panel-id')
    expect(panelId).toBeTruthy()
    await expect
      .poll(async () => {
        const listed = await socketJsonRequest(socketPath, {
          id: 'packaged-e2e-terminal-list',
          method: 'terminal.list',
          params: {}
        })
        return listed.data?.terminals?.find((terminal: Record<string, unknown>) => terminal.panelId === panelId)?.connected === true
      })
      .toBe(true)
    const terminalInput = page.locator('.terminal-pane.active .threaded-terminal-input, .terminal-pane.active .xterm-helper-textarea').first()
    await terminalInput.focus()
    await page.keyboard.type(
      `printf '__AIOPSTERM_COLOR_ENV__=%s|%s|%s|%s\\n' "$TERM" "$COLORTERM" "$CLICOLOR" "$TERM_PROGRAM"`
    )
    await page.keyboard.press('Enter')
    let terminalOutput = ''
    await expect
      .poll(async () => {
        const replay = await socketJsonRequest(socketPath, {
          id: 'packaged-e2e-terminal-color-env',
          method: 'terminal.replay',
          params: { surface_id: panelId, tail_lines: 30 }
        })
        terminalOutput = String(replay.data?.snapshot_text || '')
        return terminalOutput
      })
      .toContain('__AIOPSTERM_COLOR_ENV__=xterm-256color|truecolor|')
    if (process.platform === 'darwin') {
      expect(terminalOutput).toContain('__AIOPSTERM_COLOR_ENV__=xterm-256color|truecolor|1|aiopsterm')
    }
    const embeddedCodex = await page.evaluate(async () => {
      const api = (window as unknown as {
        aiops: {
          createCodexSession: (options: Record<string, unknown>) => Promise<Record<string, any>>
          killCodexSession: (id: string) => Promise<unknown>
        }
      }).aiops
      const session = await api.createCodexSession({ cols: 80, rows: 24, launch: { mode: 'new' } })
      await api.killCodexSession(String(session.id))
      return {
        binaryPath: session.binaryPath,
        runtimeKind: session.runtimeKind,
        lifecycleStage: session.lifecycle?.stage
      }
    })
    expect(embeddedCodex).toEqual(expect.objectContaining({ runtimeKind: 'pty', lifecycleStage: 'ready' }))
    expect(embeddedCodex.binaryPath).toMatch(/[\\/]resources[\\/]codex[\\/]bin[\\/]codex(?:\.exe)?$/)

    await page.locator('button[data-module-key="files"]').click()
    await expect(page.locator('.files-workspace')).toBeVisible()
    await expect(page.locator('.file-browser').first()).toBeVisible()

    const created = await socketJsonRequest(socketPath, {
      id: 'packaged-e2e-notification',
      method: 'notification.create',
      params: {
        id: 'packaged-e2e-notification',
        title: 'Packaged E2E notification',
        source: 'packaged-e2e',
        level: 'success'
      }
    })
    expect(created).toEqual(expect.objectContaining({ ok: true }))
    const listed = await socketJsonRequest(socketPath, {
      id: 'packaged-e2e-notification-list',
      method: 'notification.list',
      params: { source: 'packaged-e2e', unread: true }
    })
    expect(listed.data?.count).toBeGreaterThanOrEqual(1)
  } finally {
    await app.close()
    await rm(userDataDir, { recursive: true, force: true })
    await rm(localFilesDir, { recursive: true, force: true })
  }
})
