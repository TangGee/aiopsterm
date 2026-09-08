import { describe, expect, it } from 'vitest'
import { Client, type ConnectConfig } from 'ssh2'
import { createServer, connect, type Socket } from 'node:net'
import type { TerminalLifecycleEvent } from '../src/shared/contracts/terminalSessions'

const enabled = process.env.AIOPSTERM_LIVE_SSH_RECOVERY_ENABLE === '1'
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
const until = async (condition: () => boolean, label: string, timeout = 20_000) => {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

const remoteExec = (client: Client, command: string) => new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Remote test command timed out.')), 15_000)
  client.exec(command, (error, channel) => {
    if (error) { clearTimeout(timer); reject(error); return }
    let output = ''
    channel.on('data', (data: Buffer) => { if (output.length < 64 * 1024) output += data.toString() })
    channel.stderr.resume()
    channel.on('error', (error: Error) => { clearTimeout(timer); reject(error) })
    channel.on('close', (code: number) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`Remote test command exited ${code}.`))
      else resolve(output)
    })
  })
})

// Only the test's TCP streams pass through this proxy. No host networking,
// firewall, sshd settings, or unrelated SSH connections are modified.
const createFaultProxy = async (host: string, port: number) => {
  const sockets = new Set<Socket>()
  let accepted = 0
  const server = createServer((local) => {
    accepted++
    const remote = connect({ host, port })
    sockets.add(local); sockets.add(remote)
    const close = () => { local.destroy(); remote.destroy(); sockets.delete(local); sockets.delete(remote) }
    local.on('error', close); remote.on('error', close)
    local.on('close', close); remote.on('close', close)
    local.pipe(remote); remote.pipe(local)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as { port: number }).port,
    count: () => accepted,
    cut: () => { for (const socket of sockets) socket.destroy() },
    blackhole: () => {
      for (const socket of sockets) {
        socket.unpipe()
        socket.on('data', () => {})
        socket.resume()
      }
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

// Prevent this test's interactive commands from being retained in the account's
// shell history. The application bootstrap itself remains the production code.
class TestClient extends Client {
  constructor() {
    super()
    const execute = this.exec.bind(this)
    this.exec = ((command: string, ...args: unknown[]) => {
      return (execute as (...args: unknown[]) => unknown)(`env HISTFILE=/dev/null /bin/sh -c ${quote(command)}`, ...args)
    }) as typeof this.exec
  }
}

describe.skipIf(!enabled)('public SSH recovery through an isolated fault proxy', () => {
  it('restores cwd after repeated disconnects and a keepalive timeout without Enter or input replay', async () => {
    const host = process.env.AIOPSTERM_LIVE_SSH_HOST || ''
    const username = process.env.AIOPSTERM_LIVE_SSH_USERNAME || ''
    const password = process.env.AIOPSTERM_LIVE_SSH_PASSWORD
    const port = Number(process.env.AIOPSTERM_LIVE_SSH_PORT || 22)
    if (!host || !username || !password || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Live SSH recovery requires host, username, password and a valid port.')
    const config: ConnectConfig = { host, port, username, password, readyTimeout: 15_000 }
    const admin = new Client()
    admin.on('error', () => {})
    let root = ''
    let proxy: Awaited<ReturnType<typeof createFaultProxy>> | undefined
    const modulePath = '../src/main/backend/ssh/sshTerminal'
    const backend = await import(modulePath)
    let terminal: ReturnType<typeof backend.createSshTerminalSession> | undefined
    const metrics: { fault: string; detectionMs: number; recoveryMs: number; pidChanged: boolean }[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        admin.once('ready', resolve); admin.once('error', reject); admin.connect(config)
      })
      const shell = (await remoteExec(admin, 'printf "%s" "$SHELL"')).trim()
      expect(shell.endsWith('/bash'), 'Live directory recovery requires a Bash account.').toBe(true)
      root = (await remoteExec(admin, 'mktemp -d /tmp/aiopsterm-recovery.XXXXXXXX')).trim()
      if (!/^\/tmp\/aiopsterm-recovery\.[A-Za-z0-9]+$/.test(root)) throw new Error('Unexpected remote temporary directory.')
      const cwd = root + "/project space's directory"
      const forbidden = root + '/unexpected-input'
      await remoteExec(admin, `mkdir -- ${quote(cwd)}`)
      console.info('Live SSH preflight passed; temporary directory created.')
      proxy = await createFaultProxy(host, port)
      backend.configureSshTerminalBackendRuntime({ ssh2Runtime: { Client: TestClient } as never, getConfig: () => ({ terminal: { sshAgentsStatus: false } }), getEnv: () => ({ SSH_AUTH_SOCK: '' }), readyTimeoutMs: 15_000 })
      const lifecycles: TerminalLifecycleEvent[] = []
      const exits: TerminalLifecycleEvent[] = []
      let output = ''
      terminal = backend.createSshTerminalSession('public-recovery-test', {
        kind: 'ssh', sshAutoReconnect: true, sshShellIntegration: true,
        ssh: { host: '127.0.0.1', port: proxy.port, username, password }
      }, {
        lifecycle: (event: TerminalLifecycleEvent) => lifecycles.push(event),
        exit: (event: TerminalLifecycleEvent) => exits.push(event),
        data: (data: Buffer | string) => { output += data.toString() }
      })
      await until(() => output.includes('CurrentDir='), 'initial Bash directory report')
      terminal.session!.write(`cd -- ${quote(cwd)}\r`)
      await until(() => lifecycles.some((event) => event.cwd === cwd && event.cwdVerified), 'verified cwd')
      const identity = async (label: string) => {
        terminal!.session!.write(`printf '\\nAIOPS_${label}=%s|%s\\n' "$$" "$PWD"\r`)
        const match = new RegExp(`\\r?\\nAIOPS_${label}=(\\d+)\\|([^\\r\\n]+)\\r?\\n`)
        await until(() => match.test(output), `interactive identity ${label}`)
        return match.exec(output)!.slice(1)
      }
      let previous = await identity('INITIAL')
      expect(previous[1]).toBe(cwd)
      for (const [index, fault] of ['cut', 'cut', 'cut', 'blackhole'].entries()) {
        const priorOutput = output
        const beforeEvents = lifecycles.length
        const beforeCount = proxy.count()
        const started = performance.now()
        if (fault === 'blackhole') {
          console.info('Live SSH blackhole started; waiting for the production keepalive timeout.')
          proxy.blackhole()
        } else proxy.cut()
        await until(() => lifecycles.slice(beforeEvents).some((event) => event.stage === 'connecting' && event.message?.includes('reconnecting')), 'automatic reconnect detection', 80_000)
        const detected = performance.now()
        expect(() => terminal!.session!.write(`printf wrong > ${quote(forbidden)}\r`)).toThrow('not sent')
        terminal.session!.resize(132, 43)
        await until(() => proxy!.count() > beforeCount && lifecycles.slice(beforeEvents).some((event) => event.stage === 'shell-ready'), 'replacement SSH shell')
        const current = await identity(`RECOVERED_${index}`)
        expect(current[1]).toBe(cwd)
        expect(current[0]).not.toBe(previous[0])
        expect(output.startsWith(priorOutput)).toBe(true)
        expect(exits).toHaveLength(0)
        expect((await remoteExec(admin, `test ! -e ${quote(forbidden)} && printf clean`)).trim()).toBe('clean')
        metrics.push({ fault, detectionMs: Math.round(detected - started), recoveryMs: Math.round(performance.now() - detected), pidChanged: true })
        console.info('Live SSH recovery passed:', JSON.stringify(metrics.at(-1)))
        previous = current
      }
      const dimensions = await terminal.session!.runBackgroundCommand!({ command: 'printf background-ok', timeoutMs: 10_000 })
      expect(dimensions.output).toContain('background-ok')
      const count = proxy.count()
      terminal.session!.write('exit\r')
      await until(() => exits.length === 1, 'normal exit')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(proxy.count()).toBe(count)
      expect(exits[0].reason).toBe('process')
      console.info('Live SSH normal exit passed:', JSON.stringify({ cycles: metrics.length, automaticReconnect: true, inputReplay: false }))
    } finally {
      terminal?.session?.kill()
      await proxy?.close()
      backend.configureSshTerminalBackendRuntime()
      try {
        if (/^\/tmp\/aiopsterm-recovery\.[A-Za-z0-9]+$/.test(root)) {
          await remoteExec(admin, `rm -rf -- ${quote(root)} && test ! -e ${quote(root)}`)
          console.info('Live SSH temporary directory cleanup verified.')
        }
      } finally { admin.end() }
    }
  }, 180_000)
})
