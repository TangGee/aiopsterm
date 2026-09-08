import { Server, type Connection } from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isolatedEnvironment } from './environment'

export async function startSshTarget(root: string) {
  const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'
  if (!existsSync(shell)) throw new Error(`The isolated SSH target requires Bash: ${shell}`)
  const env = { ...await isolatedEnvironment(root), SHELL: shell, PS1: 'regression-target> ', TERM: 'xterm-256color' }
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
  const connections = new Set<Connection>()
  const children = new Set<ChildProcess>()
  const commands: string[] = []
  const server = new Server({ hostKeys: [key] }, (connection) => {
    connections.add(connection)
    connection.on('close', () => connections.delete(connection))
    connection.on('error', () => {})
    connection.on('authentication', (context) => context.method === 'password' && context.username === 'regression' && context.password === 'regression-only' ? context.accept() : context.reject())
    connection.on('ready', () => connection.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty) => acceptPty?.())
      const start = (stream: any, command?: string) => {
        if (command) commands.push(command)
        const child = spawn(shell, command ? ['--noprofile', '--norc', '-c', command] : ['--noprofile', '--norc', '-i'], { cwd: root, env, stdio: 'pipe' })
        children.add(child)
        child.stdout.on('data', (data) => stream.write(data))
        child.stderr.on('data', (data) => stream.stderr.write(data))
        stream.on('data', (data: Buffer) => { commands.push(data.toString()); child.stdin.write(data) })
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
    async close() {
      for (const connection of connections) connection.end()
      for (const child of children) child.kill()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
