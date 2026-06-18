import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

const helperPath = join(process.cwd(), 'resources', 'aiopsterm-agent-hook.js')

let cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs = []
})

const startSocketServer = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-hook-'))
  cleanupDirs.push(dir)
  const socketPath = join(dir, 'agent.sock')
  const received: unknown[] = []
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      if (line) received.push(JSON.parse(line))
      socket.write(`${JSON.stringify({ ok: true })}\n`)
      socket.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    socketPath,
    received,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

const runHelper = (args: string[], input: string, env: NodeJS.ProcessEnv) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })

describe('aiopsterm agent hook helper', () => {
  it('posts hook stdin with managed terminal context to the agent socket', async () => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', 'codex', '--event', 'PermissionRequest', '--strict', '--print-response'],
        JSON.stringify({
          session_id: 'codex-session-1',
          tool_name: 'shell',
          tool_input: { command: 'npm test' },
          transcript_path: '/tmp/codex.jsonl'
        }),
        {
          ...process.env,
          AIOPSTERM_MANAGED_TERMINAL: '1',
          AIOPSTERM_AGENT_SOCKET_PATH: server.socketPath,
          AIOPSTERM_TERMINAL_SESSION_ID: 'terminal-1',
          AIOPSTERM_PANEL_ID: 'panel-1',
          AIOPSTERM_WORKSPACE_ID: 'workspace-1'
        }
      )

      expect(result.code).toBe(0)
      expect(result.stdout.trim()).toBe(JSON.stringify({ ok: true }))
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'codex',
          event: 'PermissionRequest',
          sessionId: 'codex-session-1',
          panelId: 'panel-1',
          terminalSessionId: 'terminal-1',
          workspaceId: 'workspace-1',
          summary: 'shell: npm test',
          transcriptPath: '/tmp/codex.jsonl'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('fails open outside managed aiopsterm terminals', async () => {
    const result = await runHelper(['--source', 'codex', '--event', 'Stop'], JSON.stringify({ session_id: 'codex-session-1' }), {
      ...process.env,
      AIOPSTERM_MANAGED_TERMINAL: '0',
      AIOPSTERM_AGENT_SOCKET_PATH: ''
    })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('{}')
  })
})
