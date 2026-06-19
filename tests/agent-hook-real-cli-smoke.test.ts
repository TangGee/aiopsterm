import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createSocketServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentHookInstallerSource } from '../src/shared/preload'

type AgentHookInstallerBackend = {
  configureAgentHookInstallerRuntime: (config?: {
    getHomeDir?: () => string
    getEnv?: () => NodeJS.ProcessEnv
    getAgentHookScriptPath?: () => string
  }) => void
  installAgentHook: (input: { source: AgentHookInstallerSource }) => Promise<{ ok: boolean; errorMessage?: string }>
}

const runRealSmoke = process.env.AIOPSTERM_REAL_AGENT_SMOKE === '1'
const helperPath = join(process.cwd(), 'resources', 'aiopsterm-agent-hook.js')
const cleanupDirs: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  cleanupDirs.length = 0
})

const commandExists = (command: string) =>
  new Promise<boolean>((resolve) => {
    const child = spawn('sh', ['-lc', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })

const loadInstaller = async () => {
  const modulePath = '../src/main/backend/agentHookInstaller'
  return (await import(modulePath)) as AgentHookInstallerBackend
}

const installHookInHome = async (home: string, source: AgentHookInstallerSource, env: NodeJS.ProcessEnv = {}) => {
  const installer = await loadInstaller()
  installer.configureAgentHookInstallerRuntime({
    getHomeDir: () => home,
    getEnv: () => ({ ...process.env, ...env, HOME: home }),
    getAgentHookScriptPath: () => helperPath
  })
  const result = await installer.installAgentHook({ source })
  installer.configureAgentHookInstallerRuntime()
  if (!result.ok) throw new Error(result.errorMessage || `${source} hook install failed`)
}

const spawnWithTimeout = (
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}
) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeoutMs = options.timeoutMs || 30_000
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref()
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      settled = true
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(options.input || '')
  })

const startAgentSocket = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-real-agent-socket-'))
  cleanupDirs.push(dir)
  const socketPath = join(dir, 'agent.sock')
  const received: Array<Record<string, unknown>> = []
  const server = createSocketServer((socket) => {
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

const startFakeResponsesServer = async () => {
  const requests: Array<{ method?: string; url?: string; body: string }> = []
  let responsesPostCount = 0
  const server = createHttpServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body })
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      responsesPostCount += 1
      const events =
        responsesPostCount === 1
          ? ([
              ['response.created', { type: 'response.created', response: { id: 'resp-1' } }],
              [
                'response.output_item.done',
                {
                  type: 'response.output_item.done',
                  item: {
                    type: 'function_call',
                    call_id: 'call-shell-1',
                    name: 'shell_command',
                    arguments: JSON.stringify({ command: 'printf aiopsterm-real-codex-hook' })
                  }
                }
              ],
              ['response.completed', { type: 'response.completed', response: { id: 'resp-1', usage: emptyUsage() } }]
            ] as const)
          : ([
              ['response.created', { type: 'response.created', response: { id: 'resp-2' } }],
              [
                'response.output_item.done',
                {
                  type: 'response.output_item.done',
                  item: {
                    type: 'message',
                    role: 'assistant',
                    id: 'msg-1',
                    content: [{ type: 'output_text', text: 'done' }]
                  }
                }
              ],
              ['response.completed', { type: 'response.completed', response: { id: 'resp-2', usage: emptyUsage() } }]
            ] as const)
      for (const [event, data] of events) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fake Responses server did not expose a TCP address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

const emptyUsage = () => ({
  input_tokens: 0,
  input_tokens_details: null,
  output_tokens: 0,
  output_tokens_details: null,
  total_tokens: 0
})

const readCodexHooksList = async (env: NodeJS.ProcessEnv) => {
  const child = spawn('codex', ['app-server', '--stdio'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  let stderr = ''
  let nextId = 1
  const send = (method: string, params: Record<string, unknown>) => {
    child.stdin.write(`${JSON.stringify({ id: nextId, method, params })}\n`)
    nextId += 1
  }
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`timed out waiting for Codex hooks/list response: ${stderr}`))
    }, 15_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
        if (!line) continue
        const message = JSON.parse(line)
        if (message.id === 1) {
          send('hooks/list', { cwds: [process.cwd()] })
        } else if (message.id === 2) {
          clearTimeout(timeout)
          child.kill('SIGTERM')
          resolve(message.result)
        }
      }
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      if (code && code !== 0) reject(new Error(`codex app-server exited ${code}: ${stderr}`))
    })
    send('initialize', { clientInfo: { name: 'aiopsterm-real-cli-smoke', version: '0.0.0' }, capabilities: { experimentalApi: true } })
  })
  return result as { data?: Array<{ hooks?: Array<Record<string, unknown>> }> }
}

describe.skipIf(!runRealSmoke)('real agent hook CLI smoke', () => {
  it('installs Codex hooks trusted by the real Codex registry and receives real Codex hook events', async () => {
    expect(await commandExists('codex')).toBe(true)
    const home = await mkdtemp(join(tmpdir(), 'aiopsterm-real-codex-home-'))
    cleanupDirs.push(home)
    const codexHome = join(home, '.codex')
    await mkdir(codexHome, { recursive: true })
    await installHookInHome(home, 'codex', { CODEX_HOME: codexHome })

    const listed = await readCodexHooksList({ HOME: home, CODEX_HOME: codexHome })
    const hooks = listed.data?.flatMap((entry) => entry.hooks || []) || []
    const aiopsHooks = hooks.filter((hook) => typeof hook.command === 'string' && hook.command.includes('aiopsterm-agent-hook-v1'))
    expect(aiopsHooks.map((hook) => hook.eventName).sort()).toEqual(['permissionRequest', 'preToolUse', 'sessionStart', 'stop', 'userPromptSubmit'])
    expect(aiopsHooks.every((hook) => hook.trustStatus === 'trusted')).toBe(true)

    const socket = await startAgentSocket()
    const responses = await startFakeResponsesServer()
    try {
      const run = await spawnWithTimeout(
        'codex',
        ['exec', '--skip-git-repo-check', '-c', `openai_base_url="${responses.baseUrl}/v1"`, '-C', process.cwd(), 'Run the shell smoke command.'],
        {
          env: {
            HOME: home,
            CODEX_HOME: codexHome,
            OPENAI_API_KEY: 'dummy',
            AIOPSTERM_MANAGED_TERMINAL: '1',
            AIOPSTERM_AGENT_SOCKET_PATH: socket.socketPath,
            AIOPSTERM_TERMINAL_SESSION_ID: 'real-codex-terminal-1',
            AIOPSTERM_PANEL_ID: 'real-codex-panel-1',
            AIOPSTERM_WORKSPACE_ID: 'real-codex-workspace-1'
          },
          timeoutMs: 30_000
        }
      )
      expect(run.code, run.stderr).toBe(0)
      expect(run.stdout).toContain('done')
      expect(responses.requests.filter((request) => request.method === 'POST' && request.url === '/v1/responses')).toHaveLength(2)
      expect(socket.received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'codex', event: 'SessionStart', terminalSessionId: 'real-codex-terminal-1' }),
          expect.objectContaining({ source: 'codex', event: 'UserPromptSubmit', terminalSessionId: 'real-codex-terminal-1' }),
          expect.objectContaining({ source: 'codex', event: 'PreToolUse', summary: expect.stringContaining('aiopsterm-real-codex-hook') }),
          expect.objectContaining({ source: 'codex', event: 'Stop', terminalSessionId: 'real-codex-terminal-1' })
        ])
      )
    } finally {
      await responses.close()
      await socket.close()
    }
  }, 45_000)

  it('receives lifecycle events from a real Claude Code print-mode run', async () => {
    expect(await commandExists('claude')).toBe(true)
    const home = await mkdtemp(join(tmpdir(), 'aiopsterm-real-claude-home-'))
    cleanupDirs.push(home)
    await installHookInHome(home, 'claude-code')
    const settings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf-8')) as Record<string, unknown>
    expect(JSON.stringify(settings)).toContain('aiopsterm-agent-hook-v1')

    const socket = await startAgentSocket()
    try {
      const run = await spawnWithTimeout(
        'claude',
        ['-p', '--output-format', 'json', '--include-hook-events', '--settings', join(home, '.claude', 'settings.json'), 'Reply with exactly: aiopsterm real claude smoke'],
        {
          env: {
            HOME: home,
            AIOPSTERM_MANAGED_TERMINAL: '1',
            AIOPSTERM_AGENT_SOCKET_PATH: socket.socketPath,
            AIOPSTERM_TERMINAL_SESSION_ID: 'real-claude-terminal-1',
            AIOPSTERM_PANEL_ID: 'real-claude-panel-1',
            AIOPSTERM_WORKSPACE_ID: 'real-claude-workspace-1'
          },
          timeoutMs: 90_000
        }
      )
      expect(run.code, run.stderr || run.stdout).toBe(0)
      expect(socket.received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'claude-code', event: 'SessionStart', terminalSessionId: 'real-claude-terminal-1' }),
          expect.objectContaining({ source: 'claude-code', event: 'UserPromptSubmit', terminalSessionId: 'real-claude-terminal-1' }),
          expect.objectContaining({ source: 'claude-code', event: 'Stop', terminalSessionId: 'real-claude-terminal-1' })
        ])
      )
    } finally {
      await socket.close()
    }
  }, 120_000)
})
