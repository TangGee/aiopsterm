import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isolatedEnvironment } from '../regression/support/environment'

test('bound terminal reads scrollback and captures a background menu', async ({}, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'aiops-screen-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      executablePath: resolve(process.env.AIOPSTERM_PACKAGED_APP || join(process.env.AIOPSTERM_DIST_DIR || 'dist', 'linux-unpacked/aiopsterm')),
      args: ['--no-sandbox'], env: { ...await isolatedEnvironment(root), NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: join(root, 'data') }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const directory = join(root, 'data', 'control')
    let socketPath = ''
    await expect.poll(async () => {
      const name = (await readdir(directory).catch(() => [])).find(name => name.endsWith('.sock'))
      socketPath = name ? join(directory, name) : ''
      return Boolean(name)
    }).toBe(true)
    const invoke = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const socket = createConnection(socketPath)
      let data = ''
      socket.setEncoding('utf8'); socket.setTimeout(15000, () => socket.destroy(new Error('control timeout')))
      socket.on('error', reject)
      socket.on('connect', () => socket.write(JSON.stringify({ id: 'screen-test', method, params }) + '\n'))
      socket.on('data', chunk => { data += chunk; if (data.includes('\n')) { socket.end(); resolve(JSON.parse(data.split('\n')[0])) } })
    })
    const created = await invoke('surface.create', { type: 'local', focus: true, autoConnect: true })
    expect(created.ok).toBe(true)
    const panelId = created.data.surfaceId
    let sessionId = ''
    await expect.poll(async () => {
      const terminals = await invoke('terminal.list')
      sessionId = terminals.data?.terminals.find((item: any) => item.panelId === panelId)?.sessionId || ''
      return Boolean(sessionId)
    }).toBe(true)
    await invoke('terminal.send_text', { sessionId, text: "printf 'history\\n%.0s' {1..100}; printf 'PWD_RESULT /work/test\\nLS_RESULT file.txt\\n'\r" })
    await expect.poll(async () => (await invoke('terminal.read_screen', { panelId, sessionId, tailLines: 5 })).data?.text).toContain('LS_RESULT file.txt')
    await invoke('terminal.send_text', { sessionId, text: "printf '\\033[?1049h\\033[2J\\033[HUpdate available\\r\\n\\033[7m1. Update now\\033[0m\\r\\n2. Skip\\r\\nenter continue / esc skip'; sleep 60\r" })
    await expect.poll(async () => (await invoke('terminal.read_screen', { panelId, sessionId })).data?.text).toContain('enter continue / esc skip')
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
