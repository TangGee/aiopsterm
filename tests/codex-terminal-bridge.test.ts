import { createConnection } from 'net'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'

type BridgeResponse = {
  id?: string
  ok: boolean
  errorCode?: string
  errorMessage?: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
}

type McpResponse = {
  jsonrpc: '2.0'
  id: string | number
  result?: {
    tools?: Array<Record<string, unknown>>
    content?: Array<{ type: string; text: string }>
    structuredContent?: BridgeResponse
    isError?: boolean
  }
  error?: {
    code: number
    message: string
  }
}

const socketRequest = (socketPath: string, request: Record<string, unknown>) =>
  new Promise<BridgeResponse>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(5000)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex)
      socket.end()
      try {
        resolve(JSON.parse(line) as BridgeResponse)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('bridge test socket timed out'))
    })
    socket.on('error', reject)
  })

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition was not met')
}

const startMcpScript = (socketPath: string) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'resources', 'codex-aiopsterm-mcp.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AIOPSTERM_CODEX_BRIDGE_SOCKET: socketPath
    },
    stdio: 'pipe'
  }) as ChildProcessWithoutNullStreams
  const pending = new Map<string, { resolve: (response: McpResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let buffer = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue
      const response = JSON.parse(line) as McpResponse
      const waiter = pending.get(String(response.id))
      if (!waiter) continue
      clearTimeout(waiter.timer)
      pending.delete(String(response.id))
      waiter.resolve(response)
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('exit', (code) => {
    for (const [id, waiter] of pending.entries()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`MCP script exited before response ${id}: ${code}; stderr=${stderr}`))
    }
    pending.clear()
  })
  return {
    child,
    request: (message: Record<string, unknown>) =>
      new Promise<McpResponse>((resolve, reject) => {
        const id = Object.prototype.hasOwnProperty.call(message, 'id') ? String(message.id) : ''
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`MCP response timed out for ${id}; stderr=${stderr}`))
        }, 5000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify(message)}\n`)
      })
  }
}

const loadBridge = async () => {
  const modulePath = '../src/main/backend/codexTerminalBridge'
  return import(modulePath)
}

describe('Codex terminal bridge runtime', () => {
  afterEach(async () => {
    const bridge = await loadBridge()
    bridge.closeCodexTerminalBridgeServer()
  })

  it('runs commands through the selected aiopsterm terminal session and captures marked output', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-1',
        kind: 'ssh',
        host: '10.0.0.8',
        cwd: '/root',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-1',
          label: 'prod-web',
          host: '10.0.0.8',
          port: 22,
          username: 'root',
          cwd: '/root'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-1')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const responsePromise = socketRequest(socketPath, {
        id: 'request-1',
        method: 'run_command',
        params: {
          command: 'pwd',
          commandId: 'cmd-1',
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 1)
      expect(writes[0]).toContain("echo '__AIOPSTERM_CODEX_START_cmd-1__'")
      expect(writes[0]).toContain('pwd')
      expect(writes[0]).toContain("echo '__AIOPSTERM_CODEX_END_cmd-1__':$__aiopsterm_status")

      bridge.appendCodexTerminalBridgeData(
        'terminal-1',
        [
          "__AIOPSTERM_CODEX_START_cmd-1__\r\n",
          '/root\r\n',
          "__AIOPSTERM_CODEX_END_cmd-1__:0\r\n",
          'root@prod-web:~# '
        ].join('')
      )
      const response = await responsePromise

      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-1',
          ok: true,
          target: expect.objectContaining({
            sessionId: 'terminal-1',
            host: '10.0.0.8',
            username: 'root'
          }),
          data: expect.objectContaining({
            commandId: 'cmd-1',
            command: 'pwd',
            output: '/root',
            exitCode: 0
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns target context without running local commands', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-ctx',
        kind: 'local',
        cwd: '/home/ops',
        window: {} as never,
        target: {
          kind: 'local',
          sessionId: 'terminal-ctx',
          label: 'Local terminal',
          cwd: '/home/ops'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-ctx')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)
      const response = await socketRequest(socketPath, {
        id: 'request-ctx',
        method: 'target_context',
        params: {}
      })

      expect(writes).toEqual([])
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-ctx',
          ok: true,
          target: expect.objectContaining({
            kind: 'local',
            sessionId: 'terminal-ctx',
            label: 'Local terminal',
            cwd: '/home/ops'
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exposes the aiopsterm bridge as an MCP stdio server', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    let mcp: ReturnType<typeof startMcpScript> | null = null
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-mcp',
        kind: 'ssh',
        host: 'prod.internal',
        cwd: '/srv/app',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-mcp',
          label: 'prod.internal',
          host: 'prod.internal',
          username: 'deploy',
          cwd: '/srv/app'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-mcp')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)
      mcp = startMcpScript(socketPath)

      const listResponse = await mcp.request({ jsonrpc: '2.0', id: 0, method: 'tools/list' })
      expect(listResponse.result?.tools?.map((tool) => tool.name)).toEqual(['run_command', 'target_context'])

      const callPromise = mcp.request({
        jsonrpc: '2.0',
        id: 'mcp-run',
        method: 'tools/call',
        params: {
          name: 'run_command',
          arguments: {
            command: 'hostname',
            timeoutMs: 5000
          }
        }
      })
      await waitFor(() => writes.length === 1)
      const commandIdMatch = writes[0].match(/__AIOPSTERM_CODEX_START_([a-zA-Z0-9_-]+)__/)
      expect(commandIdMatch?.[1]).toBeTruthy()
      const commandId = commandIdMatch?.[1] || ''
      bridge.appendCodexTerminalBridgeData(
        'terminal-mcp',
        [
          `__AIOPSTERM_CODEX_START_${commandId}__\n`,
          'prod.internal\n',
          `__AIOPSTERM_CODEX_END_${commandId}__:0\n`
        ].join('')
      )
      const callResponse = await callPromise

      expect(callResponse.result).toEqual(
        expect.objectContaining({
          isError: false,
          structuredContent: expect.objectContaining({
            ok: true,
            target: expect.objectContaining({
              sessionId: 'terminal-mcp',
              host: 'prod.internal'
            }),
            data: expect.objectContaining({
              command: 'hostname',
              output: 'prod.internal',
              exitCode: 0
            })
          })
        })
      )
    } finally {
      mcp?.child.kill()
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })
})
