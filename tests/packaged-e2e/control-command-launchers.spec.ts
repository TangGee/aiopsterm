import { _electron as electron, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isolatedEnvironment } from '../regression/support/environment'

const execute = promisify(execFile)
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

const namespaceProbes = [
  { name: 'available', exitCode: 0 },
  { name: 'restricted', exitCode: 1 },
  { name: 'unavailable', exitCode: 127 }
]

for (const format of ['unpacked', 'AppImage']) {
  for (const namespaceProbe of namespaceProbes) {
    test(`${format} control commands work with namespace probe ${namespaceProbe.name}`, async () => {
      test.skip(process.platform !== 'linux', 'AppImage launch regression requires Linux.')
      const version = JSON.parse(await readFile('package.json', 'utf8')).version
      const dist = resolve(process.env.AIOPSTERM_DIST_DIR || 'dist')
      const arch = process.arch === 'x64' ? 'x86_64' : process.arch
      const executablePath = format === 'AppImage'
        ? join(dist, `aiopsterm-${version}-linux-${arch}.AppImage`)
        : resolve(process.env.AIOPSTERM_PACKAGED_APP || join(dist, 'linux-unpacked/aiopsterm'))
      const root = await mkdtemp(join(tmpdir(), 'aiops-cli-'))
      const environmentPath = join(root, 'shell.env')
      const probeBin = join(root, 'probe-bin')
      await mkdir(probeBin)
      // Control only the OS capability probe; launchers and the packaged CLI stay real.
      await writeFile(join(probeBin, 'unshare'), `#!/bin/sh\nexit ${namespaceProbe.exitCode}\n`, { mode: 0o755 })
      const socketPath = join(root, 'control.sock')
      // Exercise real launchers and the packaged CLI; isolate action side effects at the socket boundary.
      const server = createServer((socket) => {
        let buffer = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk) => {
          buffer += chunk
          if (!buffer.includes('\n')) return
          const request = JSON.parse(buffer.split('\n')[0])
          socket.end(JSON.stringify({ id: request.id, ok: true, data: { method: request.method, params: request.params } }) + '\n')
        })
      })
      await new Promise<void>((done, reject) => {
        server.once('error', reject)
        server.listen(socketPath, done)
      })
      let app: Awaited<ReturnType<typeof electron.launch>> | undefined
      try {
        app = await electron.launch({
          executablePath,
          args: ['--no-sandbox'],
          env: {
            ...await isolatedEnvironment(root),
            // Playwright prepends debugger arguments, so select the runtime's
            // FUSE-free extraction mode through its environment switch.
            ...(format === 'AppImage' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
            NODE_ENV: 'test', AIOPSTERM_USER_DATA_DIR: join(root, 'data')
          }
        })
        if (format === 'AppImage') expect(await app.evaluate(() => process.env.APPIMAGE)).toBe(executablePath)
        const page = await app.firstWindow()
        await page.waitForLoadState('domcontentloaded')
        const session = await page.evaluate(() => window.aiops.createTerminal({ kind: 'local', shell: '/bin/bash' }))
        expect(session.lifecycle?.stage).toBe('shell-ready')
        const written = await page.evaluate(({ id, command }) => window.aiops.writeTerminal(id, command), {
          id: session.id, command: `env -0 > ${quote(environmentPath)}\n`
        })
        expect(written.ok).toBe(true)
        await expect.poll(async () => (await readFile(environmentPath).catch(() => Buffer.alloc(0))).length).toBeGreaterThan(0)
        const env = Object.fromEntries((await readFile(environmentPath, 'utf8')).split('\0').filter(Boolean).map((entry) => {
          const index = entry.indexOf('=')
          return [entry.slice(0, index), entry.slice(index + 1)]
        }))
        env.PATH = `${probeBin}:${env.PATH}`
        const ping = await execute('/bin/sh', ['-c', 'aio --json ping'], { env, timeout: 15_000 })
        expect(ping.stderr).toBe('')
        expect(JSON.parse(ping.stdout)).toMatchObject({ ok: true })
        const cases = [
          { name: 'aio', args: ['ping'], method: 'ping', params: {} },
          { name: 'aictl', args: ['ping'], method: 'ping', params: {} },
          { name: 'aiopsterm-control', args: ['ping'], method: 'ping', params: {} },
          { name: 'aiopen', args: [join(root, 'file with spaces.txt')], method: 'file.editor.open', params: { paths: [join(root, 'file with spaces.txt')] } },
          { name: 'aiossh', args: ['test-host'], method: 'asset.ssh.connect', params: { target: 'test-host', connect: true } },
          { name: 'aiswitch', args: ['test-host'], method: 'asset.ssh.connect', params: { target: 'test-host', connect: false, requireExisting: true } },
          { name: 'aioic', args: [], method: 'workspace.close_idle', params: {} },
          { name: 'aiobc', args: [], method: 'workspace.action', params: { action: 'close_others' } }
        ]
        for (const entry of cases) {
          await test.step(entry.name, async () => {
            const result = await execute('/bin/sh', ['-c', 'exec "$@"', 'control-regression', entry.name, '--socket', socketPath, '--json', ...entry.args], { env, timeout: 15_000 })
            expect(result.stderr).toBe('')
            expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { method: entry.method, params: entry.params } })
          })
        }
        const unknown = await execute('/bin/sh', ['-c', 'aio --json missing-command'], { env, timeout: 15_000 }).catch((error) => error)
        expect(unknown.code).toBe(2)
        expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false, errorCode: 'AIO_CONTROL_COMMAND_INVALID' })
        await page.evaluate((id) => window.aiops.killTerminal(id), session.id)
      } finally {
        await app?.close()
        await new Promise<void>((done) => server.close(() => done()))
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}
