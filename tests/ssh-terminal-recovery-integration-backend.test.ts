import { describe, expect, it } from 'vitest'
import { Server, Client, type Connection } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type IPty } from 'node-pty'
import { configureSshTerminalBackendRuntime, createSshTerminalSession } from '../src/main/backend/ssh/sshTerminal'
import type { TerminalLifecycleEvent } from '../src/shared/contracts/terminalSessions'

const until = async (predicate: () => boolean, timeout = 6000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for SSH recovery.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(process.platform !== 'linux')('real SSH transport recovery', () => {
  it('reconnects a dropped SSH socket, restores bash cwd, retains output, and stops on exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aiopsterm-ssh-recovery-'))
    const cwd = join(root, "project space's 中文")
    mkdirSync(cwd)
    const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
    const connections: Connection[] = []
    const children = new Set<IPty>()
    const pids: number[] = []
    const lifecycles: TerminalLifecycleEvent[] = []
    const exits: unknown[] = []
    let output = ''
    const server = new Server({ hostKeys: [hostKey] }, (connection) => {
      connections.push(connection)
      connection.on('error', () => {})
      connection.on('authentication', (ctx) => ctx.method === 'password' && ctx.password === 'test-only' ? ctx.accept() : ctx.reject())
      connection.on('ready', () => connection.on('session', (accept) => {
        const session = accept()
        let cols = 100; let rows = 30
        session.on('pty', (acceptPty, _reject, info) => { cols = info.cols; rows = info.rows; acceptPty?.() })
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const pty = spawn('/bin/sh', ['-c', info.command], { name: 'xterm-256color', cols, rows, cwd: root, env: { ...process.env, HOME: root, SHELL: '/bin/bash' } })
          children.add(pty); pids.push(pty.pid)
          pty.onData((data) => stream.write(data))
          pty.onExit(({ exitCode }) => { children.delete(pty); try { stream.exit(exitCode); stream.end() } catch {} })
          stream.on('data', (data: Buffer) => pty.write(data.toString()))
          stream.on('close', () => { try { pty.kill() } catch {} })
          session.on('window-change', (_accept, _reject, info) => pty.resize(info.cols, info.rows))
        })
      }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    configureSshTerminalBackendRuntime({ ssh2Runtime: { Client } as never, getConfig: () => ({ terminal: { sshAgentsStatus: false } }), getEnv: () => ({ SSH_AUTH_SOCK: '' }), readyTimeoutMs: 1500, keepaliveIntervalMs: 200 })
    const terminal = createSshTerminalSession('real-recovery', { kind: 'ssh', sshAutoReconnect: true, sshShellIntegration: true, ssh: { host: '127.0.0.1', port: address.port, username: 'test', password: 'test-only' } }, {
      lifecycle: (event) => lifecycles.push(event), data: (data) => { output += data.toString() }, exit: (event) => exits.push(event)
    })
    try {
      await until(() => output.includes('CurrentDir='))
      terminal.session!.write("cd -- '" + cwd.replace(/'/g, "'\\''") + "'\r")
      await until(() => lifecycles.some((event) => event.cwd === cwd))
      terminal.session!.write('printf "BEFORE_DROP\\n"\r')
      await until(() => output.includes('BEFORE_DROP\r\n'))
      const beforeDrop = output
      const droppedAt = performance.now()
      connections[0].end()
      await until(() => lifecycles.some((event) => event.stage === 'connecting' && event.message?.includes('reconnecting')))
      expect(() => terminal.session!.write('must-not-replay\r')).toThrow('not sent')
      terminal.session!.resize(132, 43)
      await until(() => connections.length === 2 && lifecycles.filter((event) => event.stage === 'shell-ready' && event.cwd === cwd).length >= 2)
      terminal.session!.write('printf "AFTER_DROP=%s\\n" "$PWD"\r')
      await until(() => output.includes(`AFTER_DROP=${cwd}`))
      expect(performance.now() - droppedAt).toBeLessThan(5000)
      expect(output.startsWith(beforeDrop)).toBe(true)
      expect(output).not.toContain('must-not-replay')
      expect(pids).toHaveLength(2)
      expect(pids[0]).not.toBe(pids[1])
      expect(exits).toHaveLength(0)
      terminal.session!.write('exit\r')
      await until(() => exits.length === 1)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      expect(connections).toHaveLength(2)
    } finally {
      terminal.session?.kill()
      for (const connection of connections) connection.end()
      for (const child of children) { try { child.kill() } catch {} }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      configureSshTerminalBackendRuntime()
      rmSync(root, { recursive: true, force: true })
    }
  }, 15000)
})
