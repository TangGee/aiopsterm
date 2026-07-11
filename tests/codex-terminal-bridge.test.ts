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
  const modulePath = '../src/main/backend/codex/codexTerminalBridge'
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
      expect(writes[0]).toContain('if "${SHELL:-sh}" -c')
      expect(writes[0]).toContain("echo '__AIOPSTERM_CODEX_END_cmd-1__':$__aiopsterm_status")
      expect(
        bridge.filterCodexTerminalBridgeDisplayData(
          'terminal-1',
          [
            `root@prod-web:~# ${writes[0].trimEnd()}`,
            '> hidden heredoc content',
            '__AIOPSTERM_CODEX_START_cmd-1__'
          ].join('\r\n') + '\r\n'
        )
      ).toBe('root@prod-web:~# pwd\r\n')
      expect(bridge.filterCodexTerminalBridgeDisplayData('terminal-1', '/root\r\n')).toBe('/root\r\n')
      expect(
        bridge.filterCodexTerminalBridgeDisplayData(
          'terminal-1',
          "__AIOPSTERM_CODEX_END_cmd-1__:0\r\nroot@prod-web:~# "
        )
      ).toBe('root@prod-web:~# ')

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

  it('interrupts and resolves an in-flight command when its owner aborts', async () => {
    const bridge = await loadBridge()
    const writes: string[] = []
    bridge.registerCodexTerminalBridgeSession({
      id: 'terminal-abort',
      kind: 'ssh',
      window: {} as never,
      write: (data: string | Buffer) => writes.push(String(data))
    })
    bridge.setCodexTerminalBridgePreferredSession('terminal-abort')

    const responsePromise = bridge.callCodexTerminalBridgeTool('run_command', {
      sessionId: 'terminal-abort',
      commandId: 'cmd-abort',
      command: 'sleep 60',
      timeoutMs: 5000,
      mode: 'wait',
      execution: 'terminal'
    })
    await waitFor(() => writes.length === 1)
    bridge.appendCodexTerminalBridgeData('terminal-abort', '__AIOPSTERM_CODEX_START_cmd-abort__\npartial output\n')

    expect(bridge.cancelCodexTerminalBridgeCommand('cmd-abort', 'operator stopped the Agent')).toBe(true)
    await expect(responsePromise).resolves.toMatchObject({
      ok: false,
      errorCode: 'COMMAND_ABORTED',
      errorMessage: 'operator stopped the Agent',
      data: { commandId: 'cmd-abort', command: 'sleep 60', aborted: true }
    })
    expect(writes.at(-1)).toBe('\x03')
    expect(bridge.cancelCodexTerminalBridgeCommand('cmd-abort')).toBe(false)
  })

  it('filters wrapped command echoes that arrive after the start marker from display output', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-echo',
        kind: 'local',
        host: '127.0.0.1',
        cwd: '/home/tlinux',
        window: {} as never,
        target: {
          kind: 'local',
          sessionId: 'terminal-echo',
          label: '127.0.0.1',
          host: '127.0.0.1',
          cwd: '/home/tlinux'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-echo')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const responsePromise = socketRequest(socketPath, {
        id: 'request-echo',
        method: 'run_command',
        params: {
          command: 'echo "created:"; cat /home/tlinux/loop1111.sh',
          commandId: 'cmd-echo',
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 1)
      expect(bridge.filterCodexTerminalBridgeDisplayData('terminal-echo', '__AIOPSTERM_CODEX_START_cmd-echo__\r\n')).toBe('')
      expect(
        bridge.filterCodexTerminalBridgeDisplayData(
          'terminal-echo',
          'tlinux@tlinux:~$ if "${SHELL:-sh}" -c \'echo "created:"; cat /home/tlinux/loop1111.sh\'; then __aiopsterm_status=0; else __aiopsterm_status=$?; fi; echo \'__AIOPSTERM_CODEX_END_cmd-echo__\':$__aiopsterm_status\r\n'
        )
      ).toBe('tlinux@tlinux:~$ echo "created:"; cat /home/tlinux/loop1111.sh\r\n')
      expect(bridge.filterCodexTerminalBridgeDisplayData('terminal-echo', 'created:\r\n#!/bin/bash\r\n')).toBe('created:\r\n#!/bin/bash\r\n')
      expect(
        bridge.filterCodexTerminalBridgeDisplayData(
          'terminal-echo',
          "__AIOPSTERM_CODEX_END_cmd-echo__:0\r\ntlinux@tlinux:~$ "
        )
      ).toBe('tlinux@tlinux:~$ ')

      bridge.appendCodexTerminalBridgeData(
        'terminal-echo',
        [
          '__AIOPSTERM_CODEX_START_cmd-echo__',
          'created:',
          '#!/bin/bash',
          '__AIOPSTERM_CODEX_END_cmd-echo__:0'
        ].join('\r\n') + '\r\n'
      )
      const response = await responsePromise

      expect(response).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            output: 'created:\n#!/bin/bash',
            exitCode: 0
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('wraps wait commands in a command-local child shell so strict mode cannot exit the interactive shell', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-strict',
        kind: 'ssh',
        host: 'prod.internal',
        cwd: '/home/deploy',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-strict',
          label: 'prod.internal',
          host: 'prod.internal',
          username: 'deploy',
          cwd: '/home/deploy'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-strict')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const responsePromise = socketRequest(socketPath, {
        id: 'request-strict',
        method: 'run_command',
        params: {
          command: 'set -euo pipefail; python3 -m py_compile /tmp/missing.py',
          commandId: 'cmd-strict',
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 1)
      expect(writes[0]).toContain("if \"${SHELL:-sh}\" -c 'set -euo pipefail; python3 -m py_compile /tmp/missing.py'")
      expect(writes[0]).toContain('then __aiopsterm_status=0; else __aiopsterm_status=$?; fi')

      bridge.appendCodexTerminalBridgeData(
        'terminal-strict',
        [
          '__AIOPSTERM_CODEX_START_cmd-strict__',
          'sh: python3: command not found',
          '__AIOPSTERM_CODEX_END_cmd-strict__:127'
        ].join('\r\n') + '\r\n'
      )
      const response = await responsePromise

      expect(response).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            command: 'set -euo pipefail; python3 -m py_compile /tmp/missing.py',
            output: 'sh: python3: command not found',
            exitCode: 127
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('can write a command and return immediately without marker wrapping', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-immediate',
        kind: 'local',
        host: '127.0.0.1',
        cwd: '/home/tlinux',
        window: {} as never,
        target: {
          kind: 'local',
          sessionId: 'terminal-immediate',
          label: '127.0.0.1',
          host: '127.0.0.1',
          cwd: '/home/tlinux'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-immediate')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const response = await socketRequest(socketPath, {
        id: 'request-immediate',
        method: 'run_command',
        params: {
          command: '/home/tlinux/loop1111.sh',
          commandId: 'cmd-immediate',
          mode: 'return_immediately',
          timeoutMs: 5000
        }
      })

      expect(writes).toEqual(['/home/tlinux/loop1111.sh\n'])
      expect(writes[0]).not.toContain('__AIOPSTERM_CODEX_START')
      expect(writes[0]).not.toContain('__aiopsterm_status')
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-immediate',
          ok: true,
          target: expect.objectContaining({
            sessionId: 'terminal-immediate'
          }),
          data: expect.objectContaining({
            commandId: 'cmd-immediate',
            command: '/home/tlinux/loop1111.sh',
            mode: 'return_immediately',
            output: '',
            exitCode: null,
            bytes: 25
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs commands through the background executor without writing to the visible terminal', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    const backgroundCalls: Array<Record<string, unknown>> = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-background',
        kind: 'local',
        host: '127.0.0.1',
        cwd: '/home/tlinux/project',
        window: {} as never,
        target: {
          kind: 'local',
          sessionId: 'terminal-background',
          label: 'Local terminal',
          cwd: '/home/tlinux/project'
        },
        write: (data: string | Buffer) => writes.push(String(data)),
        runBackgroundCommand: async (options: Record<string, unknown>) => {
          backgroundCalls.push(options)
          return {
            output: 'background output\n',
            exitCode: 0,
            durationMs: 12,
            timedOut: false
          }
        }
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-background')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const response = await socketRequest(socketPath, {
        id: 'request-background',
        method: 'run_command',
        params: {
          command: 'pwd',
          commandId: 'cmd-background',
          execution: 'background',
          timeoutMs: 5000
        }
      })

      expect(writes).toEqual([])
      expect(backgroundCalls).toEqual([
        expect.objectContaining({
          command: 'pwd',
          cwd: '/home/tlinux/project',
          timeoutMs: 5000
        })
      ])
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-background',
          ok: true,
          data: expect.objectContaining({
            commandId: 'cmd-background',
            command: 'pwd',
            mode: 'wait',
            execution: 'background',
            output: 'background output',
            exitCode: 0,
            timedOut: false
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects return_immediately background commands because no visible lifecycle owns them', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-background-invalid',
        kind: 'local',
        cwd: '/home/tlinux',
        window: {} as never,
        target: {
          kind: 'local',
          sessionId: 'terminal-background-invalid',
          label: 'Local terminal',
          cwd: '/home/tlinux'
        },
        write: (data: string | Buffer) => writes.push(String(data)),
        runBackgroundCommand: async () => {
          throw new Error('should not run')
        }
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-background-invalid')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const response = await socketRequest(socketPath, {
        id: 'request-background-invalid',
        method: 'run_command',
        params: {
          command: 'sleep 60',
          mode: 'return_immediately',
          execution: 'background',
          timeoutMs: 5000
        }
      })

      expect(writes).toEqual([])
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-background-invalid',
          ok: false,
          errorCode: 'INVALID_COMMAND_EXECUTION_MODE'
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads recent visible terminal output with offset pagination', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-output',
        kind: 'ssh',
        host: 'logs.internal',
        cwd: '/srv/app',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-output',
          label: 'logs.internal',
          host: 'logs.internal',
          username: 'deploy',
          cwd: '/srv/app'
        },
        write: () => undefined
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-output')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      bridge.appendCodexTerminalBridgeDisplayData('terminal-output', 'deploy@logs:/srv/app$ ls\r\napp.log\r\nworker.log\r\npartial')
      let response = await socketRequest(socketPath, {
        id: 'request-output-1',
        method: 'read_terminal_output',
        params: {
          offset: 1,
          limit: 2
        }
      })
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-output-1',
          ok: true,
          data: expect.objectContaining({
            sessionId: 'terminal-output',
            offset: 1,
            startOffset: 1,
            nextOffset: 3,
            limit: 2,
            lines: ['app.log', 'worker.log'],
            content: 'app.log\nworker.log',
            lineCount: 2,
            totalLines: 4,
            availableStartOffset: 0,
            availableEndOffset: 4,
            maxCachedLines: 10000,
            truncated: false
          })
        })
      )

      bridge.appendCodexTerminalBridgeDisplayData('terminal-output', ' done\r\nnext line\r\n')
      response = await socketRequest(socketPath, {
        id: 'request-output-2',
        method: 'read_terminal_output',
        params: {
          offset: 3,
          limit: 5
        }
      })
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-output-2',
          ok: true,
          data: expect.objectContaining({
            startOffset: 3,
            nextOffset: 5,
            lines: ['partial done', 'next line'],
            content: 'partial done\nnext line',
            lineCount: 2,
            totalLines: 5,
            availableEndOffset: 5
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('updates the selected terminal target after a Codex session has started', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const firstWrites: string[] = []
    const secondWrites: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-old',
        kind: 'ssh',
        host: 'old.internal',
        cwd: '/root',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-old',
          label: 'old.internal',
          host: 'old.internal',
          username: 'root',
          cwd: '/root'
        },
        write: (data: string | Buffer) => firstWrites.push(String(data))
      })
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-new',
        kind: 'ssh',
        host: 'new.internal',
        cwd: '/srv',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-new',
          label: 'new.internal',
          host: 'new.internal',
          username: 'deploy',
          cwd: '/srv'
        },
        write: (data: string | Buffer) => secondWrites.push(String(data))
      })
      expect(
        bridge.updateCodexTerminalBridgeSessionTarget({
          kind: 'ssh',
          sessionId: 'terminal-old',
          label: 'old.internal',
          host: 'old.internal',
          username: 'root',
          cwd: '/root'
        })
      ).toEqual(expect.objectContaining({ registered: true, sessionId: 'terminal-old' }))
      expect(
        bridge.updateCodexTerminalBridgeSessionTarget({
          kind: 'ssh',
          sessionId: 'terminal-new',
          label: 'selected-new',
          host: 'new.internal',
          username: 'deploy',
          cwd: '/opt/app'
        })
      ).toEqual(
        expect.objectContaining({
          registered: true,
          sessionId: 'terminal-new',
          target: expect.objectContaining({ label: 'selected-new', cwd: '/opt/app' })
        })
      )
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const responsePromise = socketRequest(socketPath, {
        id: 'request-switch-target',
        method: 'run_command',
        params: {
          command: 'hostname',
          commandId: 'cmd-switch-target',
          timeoutMs: 5000
        }
      })
      await waitFor(() => secondWrites.length === 1)
      expect(firstWrites).toEqual([])
      expect(secondWrites[0]).toContain('hostname')

      bridge.appendCodexTerminalBridgeData(
        'terminal-new',
        [
          "__AIOPSTERM_CODEX_START_cmd-switch-target__\n",
          'new.internal\n',
          "__AIOPSTERM_CODEX_END_cmd-switch-target__:0\n"
        ].join('')
      )
      const response = await responsePromise

      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-switch-target',
          ok: true,
          target: expect.objectContaining({
            sessionId: 'terminal-new',
            label: 'selected-new',
            host: 'new.internal',
            cwd: '/opt/app'
          }),
          data: expect.objectContaining({
            command: 'hostname',
            output: 'new.internal',
            exitCode: 0
          })
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not fall back to another terminal when the selected Codex target has no live session', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-live',
        kind: 'ssh',
        host: 'live.internal',
        cwd: '/root',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-live',
          label: 'live.internal',
          host: 'live.internal',
          username: 'root',
          cwd: '/root'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      expect(
        bridge.updateCodexTerminalBridgeSessionTarget({
          kind: 'unknown',
          panelId: 'panel-welcome',
          label: 'Welcome'
        })
      ).toEqual(expect.objectContaining({ registered: false }))
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const response = await socketRequest(socketPath, {
        id: 'request-no-target',
        method: 'run_command',
        params: {
          command: 'pwd',
          commandId: 'cmd-no-target',
          timeoutMs: 5000
        }
      })

      expect(writes).toEqual([])
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-no-target',
          ok: false,
          errorCode: 'NO_TERMINAL_SESSION'
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

  it('lists registered visible terminal targets without writing to them', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-list-local',
        kind: 'local',
        cwd: '/home/ops',
        window: {} as never,
        target: {
          kind: 'local',
          panelId: 'panel-local',
          sessionId: 'terminal-list-local',
          label: 'Local shell',
          cwd: '/home/ops'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-list-ssh',
        kind: 'ssh',
        host: 'prod.internal',
        cwd: '/srv/app',
        window: {} as never,
        target: {
          kind: 'ssh',
          panelId: 'panel-ssh',
          sessionId: 'terminal-list-ssh',
          label: 'prod.internal',
          host: 'prod.internal',
          port: 22,
          username: 'deploy',
          assetId: 'asset-prod',
          assetName: 'Production',
          cwd: '/srv/app'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-list-ssh', { strict: true })
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)
      const response = await socketRequest(socketPath, {
        id: 'request-list-terminals',
        method: 'list_terminals',
        params: {}
      })

      expect(writes).toEqual([])
      expect(response).toEqual(
        expect.objectContaining({
          id: 'request-list-terminals',
          ok: true,
          data: {
            count: 2,
            selectedSessionId: 'terminal-list-ssh',
            strictSelected: true,
            terminals: [
              expect.objectContaining({
                sessionId: 'terminal-list-local',
                kind: 'local',
                panelId: 'panel-local',
                label: 'Local shell',
                selected: false,
                cwd: '/home/ops'
              }),
              expect.objectContaining({
                sessionId: 'terminal-list-ssh',
                kind: 'ssh',
                panelId: 'panel-ssh',
                label: 'prod.internal',
                selected: true,
                strictSelected: true,
                host: 'prod.internal',
                port: 22,
                username: 'deploy',
                assetId: 'asset-prod',
                assetName: 'Production',
                cwd: '/srv/app'
              })
            ]
          }
        })
      )
    } finally {
      bridge.closeCodexTerminalBridgeServer()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs structured read-only file and search tools through the selected terminal', async () => {
    const bridge = await loadBridge()
    const root = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-bridge-'))
    const writes: string[] = []
    try {
      bridge.registerCodexTerminalBridgeSession({
        id: 'terminal-files',
        kind: 'ssh',
        host: 'files.internal',
        cwd: '/srv/app',
        window: {} as never,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-files',
          label: 'files.internal',
          host: 'files.internal',
          username: 'deploy',
          cwd: '/srv/app'
        },
        write: (data: string | Buffer) => writes.push(String(data))
      })
      bridge.setCodexTerminalBridgePreferredSession('terminal-files')
      const socketPath = await bridge.ensureCodexTerminalBridgeServer(root)

      const readPromise = socketRequest(socketPath, {
        id: 'request-read-file',
        method: 'read_file',
        params: {
          path: '/etc/nginx/nginx.conf',
          offset: 1,
          limit: 2,
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 1)
      expect(writes[0]).toContain('LC_ALL=C sed -n')
      expect(writes[0]).toContain('/etc/nginx/nginx.conf')
      const readCommandId = writes[0].match(/__AIOPSTERM_CODEX_START_([a-zA-Z0-9_-]+)__/)?.[1] || ''
      bridge.appendCodexTerminalBridgeData(
        'terminal-files',
        [
          `__AIOPSTERM_CODEX_START_${readCommandId}__\n`,
          'user nginx;\n',
          'worker_processes auto;\n',
          `__AIOPSTERM_CODEX_END_${readCommandId}__:0\n`
        ].join('')
      )
      const readResponse = await readPromise
      expect(readResponse).toEqual(
        expect.objectContaining({
          id: 'request-read-file',
          ok: true,
          data: expect.objectContaining({
            path: '/etc/nginx/nginx.conf',
            offset: 1,
            limit: 2,
            content: 'user nginx;\nworker_processes auto;'
          })
        })
      )

      const globPromise = socketRequest(socketPath, {
        id: 'request-glob-search',
        method: 'glob_search',
        params: {
          path: '/srv/app',
          pattern: '*.log',
          limit: 5,
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 2)
      expect(writes[1]).toContain('find')
      expect(writes[1]).toContain('/srv/app')
      expect(writes[1]).toContain('/srv/app/*.log')
      const globCommandId = writes[1].match(/__AIOPSTERM_CODEX_START_([a-zA-Z0-9_-]+)__/)?.[1] || ''
      bridge.appendCodexTerminalBridgeData(
        'terminal-files',
        [
          `__AIOPSTERM_CODEX_START_${globCommandId}__\n`,
          '/srv/app/api.log\n',
          '/srv/app/worker.log\n',
          `__AIOPSTERM_CODEX_END_${globCommandId}__:0\n`
        ].join('')
      )
      const globResponse = await globPromise
      expect(globResponse).toEqual(
        expect.objectContaining({
          id: 'request-glob-search',
          ok: true,
          data: expect.objectContaining({
            pattern: '*.log',
            path: '/srv/app',
            entries: ['/srv/app/api.log', '/srv/app/worker.log'],
            count: 2
          })
        })
      )

      const grepPromise = socketRequest(socketPath, {
        id: 'request-grep-search',
        method: 'grep_search',
        params: {
          path: '/var/log',
          include: '*.log',
          pattern: 'error|warn',
          case_sensitive: false,
          max_matches: 10,
          timeoutMs: 5000
        }
      })
      await waitFor(() => writes.length === 3)
      expect(writes[2]).toContain('grep -R -n -I -E -m 10 -i')
      expect(writes[2]).toContain('--include=*.log')
      expect(writes[2]).toContain('error|warn')
      expect(writes[2]).toContain('/var/log')
      const grepCommandId = writes[2].match(/__AIOPSTERM_CODEX_START_([a-zA-Z0-9_-]+)__/)?.[1] || ''
      bridge.appendCodexTerminalBridgeData(
        'terminal-files',
        [
          `__AIOPSTERM_CODEX_START_${grepCommandId}__\n`,
          '/var/log/app.log:12:WARN disk high\n',
          '/var/log/app.log:20:ERROR failed request\n',
          `__AIOPSTERM_CODEX_END_${grepCommandId}__:0\n`
        ].join('')
      )
      const grepResponse = await grepPromise
      expect(grepResponse).toEqual(
        expect.objectContaining({
          id: 'request-grep-search',
          ok: true,
          data: expect.objectContaining({
            pattern: 'error|warn',
            path: '/var/log',
            include: '*.log',
            matches: [
              { path: '/var/log/app.log', line: 12, text: 'WARN disk high' },
              { path: '/var/log/app.log', line: 20, text: 'ERROR failed request' }
            ],
            count: 2
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
      expect(listResponse.result?.tools?.map((tool) => tool.name)).toEqual([
        'list_terminals',
        'run_command',
        'read_terminal_output',
        'read_file',
        'glob_search',
        'grep_search',
        'target_context'
      ])
      const listTerminalsTool = listResponse.result?.tools?.find((tool) => tool.name === 'list_terminals')
      const runCommandTool = listResponse.result?.tools?.find((tool) => tool.name === 'run_command')
      const readTerminalOutputTool = listResponse.result?.tools?.find((tool) => tool.name === 'read_terminal_output')
      const readFileTool = listResponse.result?.tools?.find((tool) => tool.name === 'read_file')
      const globSearchTool = listResponse.result?.tools?.find((tool) => tool.name === 'glob_search')
      const grepSearchTool = listResponse.result?.tools?.find((tool) => tool.name === 'grep_search')
      const targetContextTool = listResponse.result?.tools?.find((tool) => tool.name === 'target_context')
      expect(listTerminalsTool).toEqual(
        expect.objectContaining({
          description: expect.stringContaining('visible aiopsterm terminal sessions'),
          annotations: expect.objectContaining({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          })
        })
      )
      expect(runCommandTool).toEqual(
        expect.objectContaining({
          description: expect.stringContaining('managed host'),
          annotations: expect.objectContaining({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true
          }),
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              command: expect.objectContaining({
                description: expect.stringContaining('Avoid naked shell-state')
              }),
              mode: expect.objectContaining({
                enum: ['wait', 'return_immediately'],
                description: expect.stringContaining('isolated command-local child shell')
              }),
              execution: expect.objectContaining({
                enum: ['terminal', 'background'],
                description: expect.stringContaining('visible terminal is occupied')
              }),
              sessionId: expect.objectContaining({
                description: expect.stringContaining('fails if the selected terminal is not connected')
              })
            })
          })
        })
      )
      expect(targetContextTool).toEqual(
        expect.objectContaining({
          annotations: expect.objectContaining({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          })
        })
      )
      expect(readTerminalOutputTool).toEqual(
        expect.objectContaining({
          description: expect.stringContaining('visible output'),
          annotations: expect.objectContaining({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          }),
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              offset: expect.objectContaining({
                description: expect.stringContaining('Zero-based')
              }),
              limit: expect.objectContaining({
                description: expect.stringContaining('Maximum number')
              })
            })
          })
        })
      )
      ;[readFileTool, globSearchTool, grepSearchTool].forEach((tool) => {
        expect(tool).toEqual(
          expect.objectContaining({
            description: expect.stringContaining('selected'),
            annotations: expect.objectContaining({
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true
            })
          })
        )
      })

      const terminalListResponse = await mcp.request({
        jsonrpc: '2.0',
        id: 'mcp-list-terminals',
        method: 'tools/call',
        params: {
          name: 'list_terminals',
          arguments: {}
        }
      })
      expect(terminalListResponse.result).toEqual(
        expect.objectContaining({
          structuredContent: expect.objectContaining({
            ok: true,
            data: expect.objectContaining({
              selectedSessionId: 'terminal-mcp',
              terminals: [expect.objectContaining({ sessionId: 'terminal-mcp', selected: true })]
            })
          })
        })
      )

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
