import { spawn } from 'node:child_process'
import { once } from 'node:events'

export function mcpClient(script: string, socket: string, token: string, scope: string) {
  const child = spawn(process.execPath, [script], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SOCKET: socket, AIOPSTERM_EXTERNAL_CODEX_MCP_TOKEN: token,
      AIOPSTERM_EXTERNAL_CODEX_MCP_SCOPE: scope }, stdio: 'pipe'
  })
  let sequence = 0
  let buffer = ''
  const waiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  const fail = (error: Error) => {
    for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    waiters.clear()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n')
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      try {
        const result = JSON.parse(line)
        const waiter = waiters.get(result.id)
        if (waiter) { clearTimeout(waiter.timer); waiters.delete(result.id); waiter.resolve(result) }
      } catch (error) { fail(error as Error) }
    }
  })
  child.stderr.resume()
  child.on('error', fail)
  child.on('exit', (code) => fail(new Error(`MCP exited: ${code}`)))
  return {
    request(method: string, params: Record<string, unknown> = {}) {
      const id = ++sequence
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`MCP timeout: ${method}`)) }, 15_000)
        waiters.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
}
