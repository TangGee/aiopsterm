import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { testSocketPath } from './helpers/testSocketPath'

const helperPath = join(process.cwd(), 'resources', 'aiopsterm-agent-hook.js')

let cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs = []
})

const startSocketServer = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-hook-'))
  cleanupDirs.push(dir)
  const socketPath = testSocketPath('aiopsterm-agent-hook', dir)
  const received: unknown[] = []
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      if (line) {
        const parsed = JSON.parse(line)
        received.push(parsed?.method === 'agent.hook' ? parsed.params : parsed)
      }
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

const startDecisionSocketServer = async (response: Record<string, unknown>) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-agent-hook-decision-'))
  cleanupDirs.push(dir)
  const socketPath = testSocketPath('aiopsterm-agent-hook-decision', dir)
  const received: unknown[] = []
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = buffer.slice(0, newlineIndex).trim()
      if (line) {
        const parsed = JSON.parse(line)
        received.push(parsed?.method === 'agent.hook' ? parsed.params : parsed)
      }
      socket.write(`${JSON.stringify(response)}\n`)
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

const runHelper = (args: string[], input: string | Buffer, env: NodeJS.ProcessEnv) =>
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
  it.each([
    ['kimi-code', 'Kimi Code · project'],
    ['deepseek-harness', 'DeepSeek Harness · project']
  ])('uses the product label for %s notifications', async (source, title) => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', source, '--event', 'Stop'],
        JSON.stringify({ session_id: `${source}-session`, cwd: '/work/project' }),
        {
          ...process.env,
          AIOPSTERM_MANAGED_TERMINAL: '1',
          AIOPSTERM_AGENT_SOCKET_PATH: server.socketPath
        }
      )

      expect(result.code).toBe(0)
      expect(server.received).toEqual([expect.objectContaining({ source, title })])
    } finally {
      await server.close()
    }
  })

  it('posts hook stdin with managed terminal context to the agent socket', async () => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', 'codex', '--event', 'PermissionRequest', '--strict', '--print-response'],
        JSON.stringify({
          session_id: 'codex-session-1',
          tool_name: 'shell',
          tool_input: { command: 'npm test' },
          cwd: '/work/project',
          transcript_path: '/tmp/codex.jsonl',
          turn_id: 'turn-1'
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
          title: 'Codex · project',
          panelId: 'panel-1',
          terminalSessionId: 'terminal-1',
          workspaceId: 'workspace-1',
          cwd: '/work/project',
          summary: 'shell: npm test',
          toolName: 'shell',
          tool_name: 'shell',
          tool_input: { command: 'npm test' },
          transcriptPath: '/tmp/codex.jsonl',
          turnId: 'turn-1',
          turn_id: 'turn-1'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('recovers the real session id from Windows-style encoded hook input', async () => {
    const server = await startSocketServer()
    try {
      const payload = JSON.stringify({
        session_id: 'codex-windows-session-1',
        cwd: 'C:\\Users\\Ops\\project',
        tool_name: 'apply_patch',
        tool_input: { patch: '*** Begin Patch\\n*** End Patch' }
      })
      const result = await runHelper(
        ['--source', 'codex', '--event', 'Stop'],
        Buffer.from(`hook output\n${payload}\n`, 'utf16le'),
        {
          ...process.env,
          AIOPSTERM_MANAGED_TERMINAL: '1',
          AIOPSTERM_AGENT_SOCKET_PATH: server.socketPath,
          AIOPSTERM_AGENT_SESSION_ID: 'terminal-fallback-id',
          AIOPSTERM_TERMINAL_SESSION_ID: 'terminal-1'
        }
      )

      expect(result.code).toBe(0)
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'codex',
          event: 'Stop',
          sessionId: 'codex-windows-session-1',
          terminalSessionId: 'terminal-1'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('recovers identity from a malformed JSON hook payload instead of using the terminal id', async () => {
    const server = await startSocketServer()
    try {
      const malformedPayload = '{"session_id":"agent-real-session-1","turn_id":"turn-1","cwd":"C:\\\\work\\\\project","last_assistant_message":"中文消息。}'
      const result = await runHelper(
        ['--source', 'codex', '--event', 'Stop'],
        malformedPayload,
        {
          ...process.env,
          AIOPSTERM_MANAGED_TERMINAL: '1',
          AIOPSTERM_AGENT_SOCKET_PATH: server.socketPath,
          AIOPSTERM_AGENT_SESSION_ID: 'terminal-fallback-id',
          AIOPSTERM_TERMINAL_SESSION_ID: 'terminal-fallback-id'
        }
      )

      expect(result.code).toBe(0)
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'codex',
          event: 'Stop',
          sessionId: 'agent-real-session-1',
          terminalSessionId: 'terminal-fallback-id',
          cwd: 'C:\\work\\project',
          turnId: 'turn-1'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('posts events in the default installed-hook mode before returning the fail-open response', async () => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', 'codex', '--event', 'PermissionRequest'],
        JSON.stringify({
          session_id: 'codex-installed-mode-1',
          cwd: '/work/project',
          tool_name: 'shell',
          tool_input: { command: 'npm run build' }
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
      expect(result.stdout.trim()).toBe('{}')
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'codex',
          event: 'PermissionRequest',
          sessionId: 'codex-installed-mode-1',
          title: 'Codex · project',
          summary: 'shell: npm run build',
          toolName: 'shell',
          tool_input: { command: 'npm run build' }
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('posts launch and resume command metadata when hook payloads provide it', async () => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', 'codex', '--event', 'SessionStart', '--launch-command', 'codex -m gpt-5 --approval on-request -p secret prompt'],
        JSON.stringify({
          session_id: 'codex-resume-metadata-1',
          cwd: '/work/project',
          resume_command: 'codex resume codex-resume-metadata-1'
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
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'codex',
          event: 'SessionStart',
          sessionId: 'codex-resume-metadata-1',
          launchCommand: 'codex -m gpt-5 --approval on-request -p secret prompt',
          resumeCommand: 'codex resume codex-resume-metadata-1'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('posts process and lifecycle metadata for managed agent sessions', async () => {
    const server = await startSocketServer()
    try {
      const result = await runHelper(
        ['--source', 'amp', '--event', 'Lifecycle', '--pid', '4242', '--ppid', '41', '--pgid', '4200', '--status', 'running'],
        JSON.stringify({
          session_id: 'amp-lifecycle-1',
          cwd: '/work/project'
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
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'amp',
          event: 'Lifecycle',
          sessionId: 'amp-lifecycle-1',
          processId: 4242,
          parentProcessId: 41,
          processGroupId: 4200,
          agentLifecycle: 'running'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('derives project titles, cwd, transcript path, and question summaries from real hook payloads', async () => {
    const server = await startSocketServer()
    const projectDir = join(tmpdir(), 'aiopsterm-hook-project')
    try {
      const result = await runHelper(
        ['--source', 'claude-code', '--event', 'AskUserQuestion', '--strict', '--print-response'],
        JSON.stringify({
          session_id: 'claude-session-1',
          project_dir: projectDir,
          transcript_path: '/tmp/claude-transcript.jsonl',
          tool_name: 'ask_user_question',
          tool_input: {
            questions: [{ question: 'Which environment should be deployed?', options: [{ label: 'staging' }, { label: 'prod' }] }]
          }
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
          source: 'claude-code',
          event: 'AskUserQuestion',
          sessionId: 'claude-session-1',
          title: 'Claude Code · aiopsterm-hook-project',
          summary: 'Which environment should be deployed?',
          toolName: 'ask_user_question',
          tool_input: {
            questions: [{ question: 'Which environment should be deployed?', options: [{ label: 'staging' }, { label: 'prod' }] }]
          },
          cwd: projectDir,
          transcriptPath: '/tmp/claude-transcript.jsonl'
        })
      ])
    } finally {
      await server.close()
    }
  })

  it('prints backend agentOutput for blocking Claude hook decisions', async () => {
    const agentOutput = {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: {
            answers: {
              'Which environment?': 'staging'
            }
          }
        }
      }
    }
    const server = await startDecisionSocketServer({
      ok: true,
      status: 'resolved',
      agentOutput
    })
    try {
      const result = await runHelper(
        ['--source', 'claude-code', '--event', 'AskUserQuestion', '--wait-decision', '--wait-timeout-ms', '5000'],
        JSON.stringify({
          session_id: 'claude-decision-1',
          request_id: 'request-1',
          project_dir: '/work/project',
          tool_input: {
            questions: [{ question: 'Which environment?', options: [{ label: 'staging' }, { label: 'prod' }] }]
          }
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
      expect(JSON.parse(result.stdout.trim())).toEqual(agentOutput)
      expect(server.received).toEqual([
        expect.objectContaining({
          source: 'claude-code',
          event: 'AskUserQuestion',
          sessionId: 'claude-decision-1',
          requestId: 'request-1',
          actionable: true,
          waitForDecision: true,
          waitTimeoutMs: 5000
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
