import { Server, type Connection } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isolatedEnvironment } from './environment'
import { spawn as spawnPty, type IPty } from 'node-pty'

export async function startSshTarget(root: string, options: { nativePty?: boolean } = {}) {
  const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'
  if (!existsSync(shell)) throw new Error(`The isolated SSH target requires Bash: ${shell}`)
  const env = { ...await isolatedEnvironment(root), SHELL: shell, PS1: 'regression-target> ', TERM: 'xterm-256color' }
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
  const connections = new Set<Connection>()
  let connectionCount = 0
  const children = new Set<ChildProcess>()
  const ptys = new Set<IPty>()
  const commands: string[] = []
  const server = new Server({ hostKeys: [key] }, (connection) => {
    connectionCount++
    connections.add(connection)
    connection.on('close', () => connections.delete(connection))
    connection.on('error', () => {})
    connection.on('authentication', (context) => context.method === 'password' && context.username === 'regression' && context.password === 'regression-only' ? context.accept() : context.reject())
    connection.on('ready', () => connection.on('session', (accept) => {
      const session = accept()
      let hasPty = false
      let cols = 100; let rows = 30
      session.on('pty', (acceptPty, _reject, info) => { hasPty = true; cols = info.cols; rows = info.rows; acceptPty?.() })
      const start = (stream: any, command?: string) => {
        if (command) commands.push(command)
        if (hasPty && options.nativePty) {
          const pty = spawnPty(shell, command ? ['--noprofile', '--norc', '-c', command] : ['--noprofile', '--norc', '-i'], { cwd: root, env, name: 'xterm-256color', cols, rows })
          ptys.add(pty)
          pty.onData((data) => stream.write(data))
          pty.onExit(({ exitCode }) => { ptys.delete(pty); stream.exit(exitCode); stream.end() })
          stream.on('data', (data: Buffer) => { commands.push(data.toString()); pty.write(data.toString()) })
          stream.on('close', () => { try { pty.kill() } catch {} })
          session.on('window-change', (_accept, _reject, info) => pty.resize(info.cols, info.rows))
          return
        }
        const child = spawn(shell, command ? ['--noprofile', '--norc', '-c', command] : ['--noprofile', '--norc', '-i'], { cwd: root, env, stdio: 'pipe' })
        children.add(child)
        child.stdout.on('data', (data) => stream.write(data))
        child.stderr.on('data', (data) => stream.stderr.write(data))
        stream.on('data', (data: Buffer) => {
          commands.push(data.toString())
          // Match the PTY's default ICRNL input translation for interactive shells.
          child.stdin.write(hasPty ? data.toString().replace(/\r/g, '\n') : data)
        })
        stream.on('close', () => child.kill())
        child.on('error', (error) => { stream.stderr.write(String(error)); stream.exit(1); stream.end() })
        child.on('exit', (code) => { children.delete(child); stream.exit(code || 0); stream.end() })
      }
      session.on('shell', (acceptShell) => start(acceptShell()))
      session.on('exec', (acceptExec, _reject, info) => start(acceptExec(), info.command))
    }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    port: (server.address() as { port: number }).port, commands,
    connectionCount: () => connectionCount,
    disconnect: () => { for (const connection of connections) connection.end() },
    async close() {
      for (const connection of connections) connection.end()
      for (const child of children) child.kill()
      for (const pty of ptys) { try { pty.kill() } catch {} }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
