import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isolatedEnvironment } from '../regression/support/environment'
import { controlSocketPath, defaultExecutablePath, socketJsonRequest } from './support/control'

test('bound terminal reads scrollback and captures a background menu', async ({}, testInfo) => {
  const root = await mkdtemp(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'aiops-screen-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      executablePath: resolve(process.env.AIOPSTERM_PACKAGED_APP || defaultExecutablePath()),
      args: ['--no-sandbox'], env: { ...await isolatedEnvironment(root), NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: join(root, 'data') }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const mainProcessId = await app.evaluate(() => process.pid)
    let socketPath = ''
    const invoke = (method: string, params = {}) => socketJsonRequest(socketPath, { id: 'screen-test', method, params })
    await expect.poll(async () => {
      try {
        socketPath = await controlSocketPath(join(root, 'data'), mainProcessId)
        return (await invoke('ping')).ok === true
      } catch { return false }
    }).toBe(true)
    const created = await invoke('surface.create', { type: 'local', focus: true, autoConnect: true })
    expect(created.ok).toBe(true)
    const panelId = created.data.surfaceId
    let sessionId = ''
    await expect.poll(async () => {
      const terminals = await invoke('terminal.list')
      sessionId = terminals.data?.terminals.find((item: any) => item.panelId === panelId)?.sessionId || ''
      return Boolean(sessionId)
    }).toBe(true)
    if (process.platform === 'win32') {
      await expect.poll(async () => (await invoke('terminal.read_screen', { panelId, sessionId })).data?.text, { timeout: 60_000 }).toMatch(/PS [\s\S]*>\s*$/)
    }
    const history = process.platform === 'win32'
      ? "1..100 | ForEach-Object { Write-Output 'history' }; Write-Output 'PWD_RESULT /work/test'; Write-Output 'LS_RESULT file.txt'"
      : "printf 'history\\n%.0s' {1..100}; printf 'PWD_RESULT /work/test\\nLS_RESULT file.txt\\n'"
    await invoke('terminal.send_text', { sessionId, text: `${history}\r` })
    await expect.poll(async () => (await invoke('terminal.read_screen', { panelId, sessionId, tailLines: 5 })).data?.text).toMatch(/(?:^|\n)LS_RESULT file\.txt\s*(?:\n|$)/)
    const menu = process.platform === 'win32'
      ? "[Console]::Write(([char]27)+'[?1049h'+([char]27)+'[2J'+([char]27)+\"[HUpdate available`r`n\"+([char]27)+'[7m1. Update now'+([char]27)+\"[0m`r`n2. Skip`r`nenter continue / esc skip\"); Start-Sleep -Seconds 60"
      : "printf '\\033[?1049h\\033[2J\\033[HUpdate available\\r\\n\\033[7m1. Update now\\033[0m\\r\\n2. Skip\\r\\nenter continue / esc skip'; sleep 60"
    await invoke('terminal.send_text', { sessionId, text: `${menu}\r` })
    await expect.poll(async () => (await invoke('terminal.read_screen', { panelId, sessionId })).data?.text).toMatch(/(?:^|\n)enter continue \/ esc skip\s*$/)
    await invoke('surface.create', { type: 'local', focus: true, autoConnect: true })
    const result = await invoke('terminal.screenshot', { panelId, sessionId })
    expect(result.ok).toBe(true)
    expect(result.data.terminal).toMatchObject({ panelId, sessionId })
    expect(result.data.image).toMatch(/^data:image\/png;base64,/)
    const image = Buffer.from(result.data.image.split(',')[1], 'base64')
    expect(image.subarray(1, 4).toString()).toBe('PNG')
    await writeFile(testInfo.outputPath('bound-terminal.png'), image)
    await testInfo.attach('bound-terminal', { body: image, contentType: 'image/png' })
    expect((await invoke('terminal.screenshot', { panelId, sessionId: 'wrong-session' })).ok).toBe(false)
  } finally {
    await app?.close()
    await rm(root, { recursive: true, force: true })
  }
})
