import { EventEmitter } from 'events'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexSessionCreateOptions, CodexSessionThreadEvent } from '@shared/contracts/codexSessions'
import type { UserConfig } from '@shared/contracts/userConfig'

type CodexLifecycleEvent = {
  id: string
  stage: 'starting' | 'ready' | 'error' | 'closed'
  at: number
  binaryPath?: string
  codexHome?: string
  cwd?: string
  runtimeKind?: 'pty' | 'process'
  code?: number | null
  errorCode?: string
  errorMessage?: string
  message?: string
}

type CodexCreateOptionsForTest = CodexSessionCreateOptions & { cwd?: string }

class MockPtyProcess {
  writes: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  killed = false
  private dataListeners: Array<(data: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number }) => void> = []

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }

  onData(callback: (data: string) => void) {
    this.dataListeners.push(callback)
  }

  onExit(callback: (event: { exitCode: number }) => void) {
    this.exitListeners.push(callback)
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data))
  }

  emitExit(exitCode: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode }))
  }
}

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  writes: Array<string | Buffer> = []
  killed = false

  constructor() {
    super()
    this.stdin.write = ((chunk: string | Buffer | Uint8Array, _encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
      this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk))
      const done = typeof _encoding === 'function' ? _encoding : callback
      done?.()
      return true
    }) as typeof this.stdin.write
  }

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

const createRecorder = () => ({
  lifecycle: [] as CodexLifecycleEvent[],
  data: [] as Array<{ id: string; chunk: string | Buffer }>,
  thread: [] as CodexSessionThreadEvent[],
  exit: [] as Array<{ event: CodexLifecycleEvent; code?: number | null }>,
  closed: [] as string[]
})

const createSink = (events: ReturnType<typeof createRecorder>) => ({
  lifecycle: (event: CodexLifecycleEvent) => events.lifecycle.push(event),
  data: (id: string, chunk: string | Buffer) => events.data.push({ id, chunk }),
  thread: (event: CodexSessionThreadEvent) => events.thread.push(event),
  exit: (event: CodexLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
  closed: (id: string) => events.closed.push(id)
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/codex/codexCli'
  return import(modulePath)
}

const loadConfigBackend = async () => {
  const modulePath = '../src/main/backend/codex/codexConfig'
  return import(modulePath)
}

const createConfigWithModelProvider = (patch: Partial<UserConfig> = {}): UserConfig =>
  ({
    modelProvider: 'openai-compatible',
    modelName: 'ark-code-latest',
    modelSettings: {
      addModelSwitch: true,
      providers: {
        openai: {
          baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3#',
          apiKey: 'ark-secret-token',
          modelId: 'ark-code-latest',
          apiFormat: 'responses'
        },
        litellm: { baseUrl: '', apiKey: '', modelId: '' },
        bedrock: { baseUrl: '', apiKey: '', modelId: '' },
        deepseek: { baseUrl: '', apiKey: '', modelId: '' },
        anthropic: { baseUrl: '', apiKey: '', modelId: '' },
        ollama: { baseUrl: '', apiKey: '', modelId: '' },
        lmstudio: { baseUrl: '', apiKey: '', modelId: '' }
      },
      options: [{ name: 'ark-code-latest', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
    },
    ...patch
  }) as UserConfig

const CODEX_PACKAGE_ROOT = '/repo/codex/codex-rs/target/x86_64-unknown-linux-gnu/aiopsterm-codex-dev-package'
const CODEX_PACKAGE_BINARY = `${CODEX_PACKAGE_ROOT}/bin/codex`
const codexPackageExists = (path: string) =>
  path === CODEX_PACKAGE_BINARY ||
  path === `${CODEX_PACKAGE_ROOT}/codex-package.json` ||
  path === '/repo/resources/codex-aiopsterm-mcp.js'

const temporaryDirectories: string[] = []

const createTemporaryUserData = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aiopsterm-codex-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('Codex CLI backend runtime', () => {
  it('normalizes canonical Codex thread titles without splitting Unicode code points', async () => {
    const backend = await loadBackend()
    expect(backend.normalizeCodexThreadTitle('## My request for Codex:\n  Investigate   deploy\nrollback  '))
      .toBe('Investigate deploy rollback')
    expect(backend.normalizeCodexThreadTitle('<environment_context>internal</environment_context>')).toBe('')
    expect(backend.normalizeCodexThreadTitle(`${'a'.repeat(255)}🙂`)).toBe('a'.repeat(255))
  })

  beforeEach(async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime()
  })

  it('uses stable and isolated working directories for Codex targets', async () => {
    const backend = await loadBackend()
    const home = '/tmp/codex-home'
    const first = backend.codexWorkspaceDirectory(home, {
      target: { kind: 'ssh', username: 'root', host: 'prod/example', port: 22 }
    })
    const same = backend.codexWorkspaceDirectory(home, {
      target: { kind: 'ssh', username: 'root', host: 'prod/example', port: 22 }
    })
    const other = backend.codexWorkspaceDirectory(home, {
      target: { kind: 'ssh', username: 'root', host: 'prod/example', port: 2202 }
    })
    expect(first).toBe(same)
    expect(other).not.toBe(first)
    expect(first).toMatch(/^\/tmp\/codex-home\/workspaces\/[a-z0-9._-]+$/)
    expect(backend.codexWorkspaceDirectory(home, { target: { kind: 'local' } })).toBe('/tmp/codex-home/workspaces/local')
  })

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('starts Codex in a PTY with aiopsterm-owned CODEX_HOME', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    const mkdirCalls: Array<string> = []
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getConfig: () => createConfigWithModelProvider(),
      getEnv: () => ({ PATH: '/usr/bin', CODEX_HOME: '/should/not/reuse' }),
      getBridgeSocketPath: () => '/tmp/aiopsterm-user-data/codex-agent/bridge.sock',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async (path: string) => {
        mkdirCalls.push(String(path))
        return undefined
      },
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    const createOptions = {
        cwd: '/tmp/forged-client-cwd',
        cols: 120,
        rows: 40,
        target: {
          kind: 'ssh',
          sessionId: 'terminal-1',
          label: 'prod-web',
          host: '10.0.0.8',
          port: 22,
          username: 'root'
        }
      } as CodexCreateOptionsForTest
    const expectedCwd = backend.codexWorkspaceDirectory('/tmp/aiopsterm-user-data/codex-agent', createOptions)
    const session = await backend.createCodexSession(
      'codex-test-1',
      createOptions,
      createSink(events)
    )
    const write = backend.writeCodexSession(session.id, 'hello\n')
    backend.resizeCodexSession(session.id, 132, 44)
    pty.emitData('codex tui\n')
    pty.emitExit(0)

    expect(session).toEqual(
      expect.objectContaining({
        id: 'codex-test-1',
        binaryPath: CODEX_PACKAGE_BINARY,
        cwd: expectedCwd,
        codexHome: '/tmp/aiopsterm-user-data/codex-agent',
        runtimeKind: 'pty'
      })
    )
    expect(mkdirCalls).toEqual([
      '/tmp/aiopsterm-user-data/codex-agent',
      expectedCwd,
      '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-pending-context',
      '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-thread-info'
    ])
    expect(writeFileCalls).toHaveLength(2)
    expect(writeFileCalls[0]).toEqual({
      path: '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-pending-context/codex-test-1.txt',
      content: ''
    })
    expect(writeFileCalls[1]).toEqual(
      expect.objectContaining({
        path: '/tmp/aiopsterm-user-data/codex-agent/config.toml'
      })
    )
    const configToml = writeFileCalls[1].content
    expect(configToml).toContain('include_environment_context = false')
    expect(configToml).toContain('model = "ark-code-latest"')
    expect(configToml).toContain('model_provider = "aiopsterm_openai_responses"')
    expect(configToml).toContain('[model_providers.aiopsterm_openai_responses]')
    expect(configToml).toContain('base_url = "https://ark.cn-beijing.volces.com/api/coding/v3"')
    expect(configToml).toContain('env_key = "AIOPSTERM_CODEX_API_KEY"')
    expect(configToml).toContain('wire_api = "responses"')
    expect(configToml).not.toContain('ark-secret-token')
    expect(configToml).toContain('instructions = "You are aiopsterm Agent')
    expect(configToml).toContain('project_doc_max_bytes = 0')
    expect(configToml).toContain('web_search = "disabled"')
    expect(configToml).toContain('check_for_update_on_startup = false')
    expect(configToml).toContain('shell_tool = false')
    expect(configToml).toContain('unified_exec = false')
    expect(configToml).toContain('image_generation = false')
    expect(configToml).toContain('browser_use = false')
    expect(configToml).toContain('computer_use = false')
    expect(configToml).toContain('[tools.experimental_request_user_input]')
    expect(configToml).toContain('enabled = false')
    expect(configToml).toContain('include_collaboration_mode_instructions = false')
    expect(configToml).toContain('multi_agent = false')
    expect(configToml).toContain('hooks = false')
    expect(configToml).toContain('[skills]')
    expect(configToml).toContain('include_instructions = false')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote]')
    expect(configToml).toContain('default_tools_approval_mode = "prompt"')
    expect(configToml).toContain('enabled_tools = ["list_terminals", "run_command", "read_terminal_output", "read_file", "glob_search", "grep_search", "target_context"]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.list_terminals]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.target_context]')
    expect(configToml).toContain('approval_mode = "approve"')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.read_terminal_output]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.read_file]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.glob_search]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.grep_search]')
    expect(configToml).toContain('[mcp_servers.aiopsterm_remote.tools.run_command]')
    expect(configToml).toContain('approval_mode = "prompt"')
    expect(configToml).toContain('AIOPSTERM_CODEX_BRIDGE_SOCKET = "/tmp/aiopsterm-user-data/codex-agent/bridge.sock"')
    expect(configToml).toContain('protect data, minimize service disruption')
    expect(configToml).toContain('Call `target_context` before the first command')
    expect(configToml).toContain('Use `list_terminals` when you need to understand available aiopsterm terminal targets')
    expect(configToml).toContain('read_terminal_output` reads recent visible terminal output')
    expect(configToml).toContain('mode: \\"return_immediately\\"')
    expect(configToml).toContain('execution: \\"background\\"')
    expect(configToml).toContain('visible terminal is occupied')
    expect(configToml).toContain('Do not send naked shell-state or shell-lifecycle commands')
    expect(configToml).toContain('aiopsterm disables Codex environment-context injection')
    expect(configToml).toContain('current date/time, timezone, hostname')
    expect(configToml).toContain('Never invent command output')
    expect(configToml).toContain('command_blocked')
    expect(configToml).toContain('Do not fabricate terminal output or host state')
    expect(configToml).toContain('terminal_session_id: terminal-1')
    expect(configToml).toContain('host: 10.0.0.8')
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        file: CODEX_PACKAGE_BINARY,
        args: [],
        options: expect.objectContaining({
          cwd: expectedCwd,
          cols: 120,
          rows: 40,
          env: expect.objectContaining({
            CODEX_HOME: '/tmp/aiopsterm-user-data/codex-agent',
            CODEX_MANAGED_PACKAGE_ROOT: CODEX_PACKAGE_ROOT,
            AIOPSTERM_CODEX_API_KEY: 'ark-secret-token',
            AIOPSTERM_CODEX_FLAT_MCP_TOOLS: '1',
            AIOPSTERM_CODEX_PENDING_CONTEXT_FILE: '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-pending-context/codex-test-1.txt',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor'
          })
        })
      })
    ])
    expect(write).toEqual({ ok: true, data: { id: 'codex-test-1', bytes: 6 } })
    expect(pty.writes).toEqual(['hello\n'])
    expect(pty.resizes).toEqual([{ cols: 132, rows: 44 }])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'closed'])
    expect(events.data.map((entry) => entry.chunk.toString())).toEqual(['codex tui\n'])
    expect(events.exit).toEqual([expect.objectContaining({ code: 0 })])
    expect(events.closed).toEqual(['codex-test-1'])
    expect(backend.__getCodexSessionCountForTests()).toBe(0)
  })

  it('permanently deletes a validated thread through the embedded Codex CLI without a shell', async () => {
    const backend = await loadBackend()
    const execFile = vi.fn(async () => undefined)
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getEnv: () => ({ PATH: '/usr/bin', CODEX_HOME: '/must-not-be-used' }),
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      execFile
    })

    const threadId = '123e4567-e89b-12d3-a456-426614174000'
    await expect(backend.deleteCodexNativeThread(threadId.toUpperCase())).resolves.toBe(true)
    expect(execFile).toHaveBeenCalledWith(
      CODEX_PACKAGE_BINARY,
      ['delete', '--force', threadId],
      {
        timeout: 120_000,
        env: {
          PATH: '/usr/bin',
          CODEX_HOME: '/tmp/aiopsterm-user-data/codex-agent',
          NO_COLOR: '1'
        }
      }
    )
  })

  it('treats an already missing Codex thread as an idempotent native deletion', async () => {
    const backend = await loadBackend()
    const threadId = '123e4567-e89b-12d3-a456-426614174009'
    const execFile = vi.fn(async () => {
      throw Object.assign(new Error('Codex delete command failed'), {
        stderr: `Error: invalid request: thread not found: ${threadId}`
      })
    })
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      execFile
    })

    await expect(backend.deleteCodexNativeThread(threadId)).resolves.toBe(false)
    expect(execFile).toHaveBeenCalledWith(
      CODEX_PACKAGE_BINARY,
      ['delete', '--force', threadId],
      expect.any(Object)
    )
  })

  it('treats a generic Codex delete failure as already absent when no native persistence remains', async () => {
    const backend = await loadBackend()
    const userDataPath = await createTemporaryUserData()
    const execFile = vi.fn(async () => {
      throw new Error('Command failed\nError: failed to delete session')
    })
    backend.configureCodexCliRuntime({
      getUserDataPath: () => userDataPath,
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      execFile
    })

    await expect(
      backend.deleteCodexNativeThread('123e4567-e89b-12d3-a456-426614174011')
    ).resolves.toBe(false)
  })

  it('preserves Codex thread deletion failures that are not missing-thread responses', async () => {
    const backend = await loadBackend()
    const userDataPath = await createTemporaryUserData()
    const threadId = '123e4567-e89b-12d3-a456-426614174010'
    const rolloutDirectory = join(userDataPath, 'codex-agent', 'sessions', '2026', '07', '28')
    const rolloutPath = join(
      rolloutDirectory,
      `rollout-2026-07-28T00-00-00-${threadId}.jsonl`
    )
    await mkdir(rolloutDirectory, { recursive: true })
    await writeFile(rolloutPath, '{"type":"session_meta"}\n', 'utf8')
    const execFile = vi.fn(async () => {
      throw Object.assign(new Error('Codex delete command failed'), {
        stderr: 'Error: database is locked'
      })
    })
    backend.configureCodexCliRuntime({
      getUserDataPath: () => userDataPath,
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: (path: string) => codexPackageExists(path) || path === rolloutPath,
      execFile
    })

    await expect(
      backend.deleteCodexNativeThread(threadId)
    ).rejects.toMatchObject({ code: 'CODEX_THREAD_DELETE_FAILED' })
  })

  it('stops a running Codex thread before permanently deleting it', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const threadId = '123e4567-e89b-12d3-a456-426614174001'
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'delete') expect(pty.killed).toBe(true)
    })
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      execFile,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => ({ spawn: () => pty })
    })
    await backend.createCodexSession(
      'codex-delete-running',
      { launch: { mode: 'resume', threadId } },
      createSink(createRecorder())
    )

    await expect(backend.deleteCodexNativeThread(threadId)).resolves.toBe(true)
    expect(pty.killed).toBe(true)
    expect(execFile).toHaveBeenCalledWith(
      CODEX_PACKAGE_BINARY,
      ['delete', '--force', threadId],
      expect.any(Object)
    )
    pty.emitExit(0)
  })

  it('stops a Codex runtime by product id before a native thread binding exists', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => ({ spawn: () => pty })
    })
    await backend.createCodexSession(
      'codex-unbound-native-thread',
      { productSessionId: 'product-before-thread-binding' },
      createSink(createRecorder())
    )

    await expect(backend.stopCodexProductSessionRuntimes('product-before-thread-binding')).resolves.toBe(true)
    expect(pty.killed).toBe(true)
    pty.emitExit(0)
  })

  it('rejects unsafe Codex thread identifiers before invoking the binary', async () => {
    const backend = await loadBackend()
    const execFile = vi.fn(async () => undefined)
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      execFile
    })

    await expect(backend.deleteCodexNativeThread('thread; rm -rf /')).rejects.toMatchObject({
      code: 'CODEX_THREAD_ID_INVALID'
    })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('starts embedded Codex with a color-capable terminal environment', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getEnv: () => ({
        PATH: '/usr/bin',
        TERM: 'dumb',
        COLORTERM: '',
        NO_COLOR: '1'
      }),
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    await backend.createCodexSession('codex-color-env', {}, createSink(createRecorder()))

    expect(spawnCalls[0].options).toEqual(
      expect.objectContaining({
        name: 'xterm-256color',
        env: expect.objectContaining({
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          CLICOLOR: '1'
        })
      })
    )
    expect((spawnCalls[0].options as { env: NodeJS.ProcessEnv }).env).not.toHaveProperty('NO_COLOR')
  })

  it('reports a nonzero Codex PTY exit as a structured lifecycle error', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => ({ spawn: () => pty })
    })

    await backend.createCodexSession('codex-pty-nonzero', {}, createSink(events))
    pty.emitExit(17)

    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'error'])
    expect(events.lifecycle.at(-1)).toEqual(expect.objectContaining({
      code: 17,
      errorCode: 'CODEX_CLI_EXIT_NONZERO',
      errorMessage: 'Codex CLI exited with code 17.'
    }))
    expect(events.exit).toEqual([expect.objectContaining({
      code: 17,
      event: expect.objectContaining({ stage: 'error', errorCode: 'CODEX_CLI_EXIT_NONZERO' })
    })])
    expect(events.closed).toEqual(['codex-pty-nonzero'])
  })

  it('uses explicit thread ids for resume and never falls back to --last', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<{ args: string[]; options: Record<string, unknown> }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => ({
        spawn: (_file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ args, options })
          return pty
        }
      })
    })

    await backend.createCodexSession(
      'codex-resume-runtime',
      {
        productSessionId: 'product-codex-1',
        projectRoot: '/srv/app',
        launch: { mode: 'resume', threadId: '0197f123-4567-7890-abcd-ef0123456789' }
      },
      createSink(createRecorder())
    )

    expect(spawnCalls[0].args).toEqual(['resume', '0197f123-4567-7890-abcd-ef0123456789'])
    expect(spawnCalls[0].args).not.toContain('--last')
    expect(spawnCalls[0].options.env).toEqual(expect.objectContaining({
      AIOPSTERM_CODEX_RUNTIME_ID: 'codex-resume-runtime',
      AIOPSTERM_CODEX_THREAD_REASON: 'resume',
      AIOPSTERM_CODEX_THREAD_INFO_FILE:
        '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-thread-info/codex-resume-runtime.json'
    }))
    pty.emitExit(0)

    await expect(backend.createCodexSession(
      'codex-invalid-resume',
      { launch: { mode: 'resume', threadId: 'bad\nthread' } },
      createSink(createRecorder())
    )).rejects.toMatchObject({ code: 'CODEX_THREAD_ID_INVALID' })
  })

  it('finds only non-empty saved rollouts that belong to the requested Codex thread', async () => {
    const backend = await loadBackend()
    const userData = await createTemporaryUserData()
    const codexHome = join(userData, 'codex-agent')
    const activeThreadId = '019f51d7-e98e-7f20-ab09-b83241c2a226'
    const archivedThreadId = '019f51d7-e98e-7f20-ab09-b83241c2a227'
    const emptyThreadId = '019f51d7-e98e-7f20-ab09-b83241c2a228'
    const outsideThreadId = '019f51d7-e98e-7f20-ab09-b83241c2a229'
    const activePath = join(codexHome, 'sessions/2026/07/11', `rollout-2026-07-11T23-42-12-${activeThreadId}.jsonl`)
    const archivedPath = join(codexHome, 'archived_sessions', `rollout-2026-07-11T23-42-13-${archivedThreadId}.jsonl.zst`)
    const emptyPath = join(codexHome, 'sessions/2026/07/11', `rollout-2026-07-11T23-42-14-${emptyThreadId}.jsonl`)
    const outsidePath = join(userData, `rollout-2026-07-11T23-42-15-${outsideThreadId}.jsonl`)

    await Promise.all([mkdir(dirname(activePath), { recursive: true }), mkdir(dirname(archivedPath), { recursive: true })])
    await Promise.all([
      writeFile(activePath, '{"type":"session_meta"}\n'),
      writeFile(archivedPath, Buffer.from([1, 2, 3])),
      writeFile(emptyPath, ''),
      writeFile(outsidePath, '{"type":"session_meta"}\n')
    ])
    backend.configureCodexCliRuntime({ getUserDataPath: () => userData })

    await expect(backend.findCodexSavedSessionRolloutPath(activeThreadId, activePath)).resolves.toBe(activePath)
    await expect(backend.findCodexSavedSessionRolloutPath(activeThreadId, activePath, { scanFallback: false })).resolves.toBe(activePath)
    await expect(backend.findCodexSavedSessionRolloutPath(activeThreadId, undefined, { scanFallback: false })).resolves.toBeNull()
    await expect(backend.findCodexSavedSessionRolloutPath(archivedThreadId)).resolves.toBe(archivedPath)
    await expect(backend.findCodexSavedSessionRolloutPath(emptyThreadId, emptyPath)).resolves.toBeNull()
    await expect(backend.findCodexSavedSessionRolloutPath(outsideThreadId, outsidePath)).resolves.toBeNull()
    await expect(backend.findCodexSavedSessionRolloutPath(archivedThreadId, activePath)).resolves.toBe(archivedPath)
  })

  it('waits for a new Codex rollout to become durable before publishing thread info', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()
    const userData = await createTemporaryUserData()
    const codexHome = join(userData, 'codex-agent')
    const runtimeId = 'codex-durable-thread'
    const threadId = '019f51d7-e98e-7f20-ab09-b83241c2a230'
    const rolloutPath = join(codexHome, 'sessions/2026/07/11', `rollout-2026-07-11T23-42-16-${threadId}.jsonl`)
    let canonicalTitle = ''

    backend.configureCodexCliRuntime({
      getUserDataPath: () => userData,
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      resolveThreadTitle: () => canonicalTitle,
      loadPty: () => ({ spawn: () => pty })
    })
    await backend.createCodexSession(runtimeId, {}, createSink(events))
    await writeFile(
      backend.codexThreadInfoPath(codexHome, runtimeId),
      JSON.stringify({ threadId, reason: 'new', cwd: codexHome, rolloutPath })
    )

    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(events.thread).toEqual([])

    await mkdir(dirname(rolloutPath), { recursive: true })
    await writeFile(rolloutPath, '{"type":"session_meta"}\n')
    await vi.waitFor(() => expect(events.thread).toEqual([
      expect.objectContaining({ id: runtimeId, threadId, previousThreadId: null, reason: 'new', rolloutPath })
    ]))
    canonicalTitle = 'Investigate deploy rollback'
    await vi.waitFor(() => expect(events.thread).toHaveLength(2), { timeout: 2500 })
    expect(events.thread.at(-1)).toEqual(expect.objectContaining({
      id: runtimeId,
      threadId,
      title: 'Investigate deploy rollback',
      rolloutPath
    }))
    pty.emitExit(0)
  })

  it('waits for an in-flight thread publication before product runtime stop completes', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const userData = await createTemporaryUserData()
    const codexHome = join(userData, 'codex-agent')
    const runtimeId = 'codex-thread-stop-drain'
    const productSessionId = 'product-thread-stop-drain'
    const threadId = '019f51d7-e98e-7f20-ab09-b83241c2a231'
    const rolloutPath = join(codexHome, 'sessions/2026/07/11', `rollout-2026-07-11T23-42-17-${threadId}.jsonl`)
    let publishStarted!: () => void
    let releasePublish!: () => void
    const started = new Promise<void>((resolve) => {
      publishStarted = resolve
    })
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })

    backend.configureCodexCliRuntime({
      getUserDataPath: () => userData,
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      loadPty: () => ({ spawn: () => pty })
    })
    const events = createRecorder()
    await backend.createCodexSession(runtimeId, { productSessionId }, {
      ...createSink(events),
      thread: async (event: CodexSessionThreadEvent) => {
        events.thread.push(event)
        publishStarted()
        await publishGate
      }
    })
    await mkdir(dirname(rolloutPath), { recursive: true })
    await writeFile(rolloutPath, '{"type":"session_meta"}\n')
    await writeFile(
      backend.codexThreadInfoPath(codexHome, runtimeId),
      JSON.stringify({ threadId, reason: 'new', cwd: codexHome, rolloutPath })
    )
    await started

    let stopped = false
    const stopPromise = backend.stopCodexProductSessionRuntimes(productSessionId).then((result: boolean) => {
      stopped = true
      return result
    })
    await Promise.resolve()
    expect(pty.killed).toBe(true)
    expect(stopped).toBe(false)

    releasePublish()
    await expect(stopPromise).resolves.toBe(true)
    pty.emitExit(0)
  })

  it('stores pending Codex context per session and replaces prior content', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => ({
        spawn: () => pty
      })
    })

    const session = await backend.createCodexSession('codex-pending-1', {}, createSink(createRecorder()))
    const first = await backend.setCodexSessionPendingContext(session.id, '[aiopsterm target changed]\nCurrent target: first')
    const second = await backend.setCodexSessionPendingContext(session.id, '[aiopsterm target changed]\nCurrent target: second')
    const missing = await backend.setCodexSessionPendingContext('missing', 'unused')

    expect(first).toEqual({ ok: true, data: { id: 'codex-pending-1', bytes: expect.any(Number), cleared: false } })
    expect(second.ok).toBe(true)
    expect(writeFileCalls.at(-1)).toEqual({
      path: '/tmp/aiopsterm-user-data/codex-agent/aiopsterm-pending-context/codex-pending-1.txt',
      content: '[aiopsterm target changed]\nCurrent target: second'
    })
    expect(missing).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'CODEX_SESSION_NOT_FOUND'
      })
    )
  })

  it('reports missing binary before spawning', async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      existsSync: () => false,
      loadPty: () => null
    })

    await expect(backend.createCodexSession('missing-codex', {}, createSink(createRecorder()))).rejects.toMatchObject({
      code: 'CODEX_BINARY_NOT_FOUND'
    })
  })

  it('reports an unusable Codex binary before spawning', async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: () => {
        throw Object.assign(new Error('libssl.so.1.1: cannot open shared object file'), {
          code: 'CODEX_BINARY_UNUSABLE'
        })
      },
      existsSync: codexPackageExists,
      loadPty: () => null
    })

    await expect(backend.createCodexSession('bad-codex', {}, createSink(createRecorder()))).rejects.toMatchObject({
      code: 'CODEX_BINARY_UNUSABLE'
    })
  })

  it('checks the Codex binary with the default startup timeout', async () => {
    const backend = await loadBackend()
    const execCalls: Array<{ file: string; args: string[]; options: { timeout: number; env: NodeJS.ProcessEnv } }> = []

    backend.configureCodexCliRuntime({
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      existsSync: codexPackageExists,
      execFile: async (file: string, args: string[], options: { timeout: number; env: NodeJS.ProcessEnv }) => {
        execCalls.push({ file, args, options })
        return { stdout: 'codex-cli 0.0.0', stderr: '' }
      }
    })

    const binaryPath = backend.resolveCodexBinaryPath()
    expect(binaryPath).toBe(CODEX_PACKAGE_BINARY)
    await backend.checkCodexBinary(binaryPath)
    expect(execCalls).toEqual([
      {
        file: CODEX_PACKAGE_BINARY,
        args: ['--version'],
        options: expect.objectContaining({
          timeout: 30000,
          env: expect.objectContaining({
            CODEX_HOME: process.env.CODEX_HOME || ''
          })
        })
      }
    ])
  })

  it('reports Codex binary health check timeouts with the command and timeout', async () => {
    const backend = await loadBackend()
    const timeoutError = Object.assign(new Error(`spawn ${CODEX_PACKAGE_BINARY} ETIMEDOUT`), {
      code: 'ETIMEDOUT'
    })

    backend.configureCodexCliRuntime({
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      existsSync: codexPackageExists,
      execFile: async () => {
        throw timeoutError
      }
    })

    await expect(backend.checkCodexBinary(backend.resolveCodexBinaryPath())).rejects.toThrow(
      `Codex binary failed health check: timed out after 30000ms running ${CODEX_PACKAGE_BINARY} --version`
    )
  })

  it('falls back to subprocess when node-pty is unavailable', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const child = new MockChildProcess()

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      loadPty: () => null,
      processRuntime: {
        spawn: () => child as never
      }
    })

    const session = await backend.createCodexSession('codex-process-1', {}, createSink(events))
    backend.writeCodexSession(session.id, 'status\n')
    child.stdout.write('stdout\n')
    child.stderr.write('stderr\n')
    child.emit('exit', 3)

    expect(session.runtimeKind).toBe('process')
    expect(child.writes).toEqual(['status\n'])
    expect(events.data.map((entry) => entry.chunk.toString())).toEqual(['stdout\n', 'stderr\n'])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'error'])
    expect(events.lifecycle.at(-1)).toEqual(expect.objectContaining({
      code: 3,
      errorCode: 'CODEX_CLI_EXIT_NONZERO',
      errorMessage: 'Codex CLI exited with code 3.'
    }))
    expect(events.exit).toEqual([expect.objectContaining({
      code: 3,
      event: expect.objectContaining({ stage: 'error', errorCode: 'CODEX_CLI_EXIT_NONZERO' })
    })])
  })

  it('does not configure Codex provider for non-Responses aiopsterm model settings', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getConfig: () =>
        createConfigWithModelProvider({
          modelSettings: {
            ...createConfigWithModelProvider().modelSettings!,
            providers: {
              ...createConfigWithModelProvider().modelSettings!.providers,
              openai: {
                ...createConfigWithModelProvider().modelSettings!.providers.openai,
                apiFormat: 'chat-completions'
              }
            }
          }
      }),
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    await backend.createCodexSession('codex-chat-provider', {}, createSink(createRecorder()))

    const configToml = writeFileCalls.at(-1)?.content || ''
    expect(configToml).not.toContain('model_provider = "aiopsterm_openai_responses"')
    expect(configToml).not.toContain('[model_providers.aiopsterm_openai_responses]')
    expect(spawnCalls[0].options).toEqual(
      expect.objectContaining({
        env: expect.not.objectContaining({
          AIOPSTERM_CODEX_API_KEY: 'ark-secret-token'
        })
      })
    )
  })

  it('normalizes Codex Responses base URLs from aiopsterm OpenAI-compatible settings', async () => {
    const configBackend = await loadConfigBackend()

    expect(configBackend.normalizeCodexResponsesBaseUrl('https://ark.cn-beijing.volces.com/api/coding/v3#')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3'
    )
    expect(configBackend.normalizeCodexResponsesBaseUrl('https://gateway.local/api')).toBe('https://gateway.local/api/v1')
    expect(configBackend.normalizeCodexResponsesBaseUrl('https://gateway.local/api/v1/responses')).toBe('https://gateway.local/api/v1')
    expect(configBackend.normalizeCodexResponsesBaseUrl('https://gateway.local/api/v1/chat/completions')).toBe('https://gateway.local/api/v1')
  })

  it('merges aiopsterm Codex config without removing user-owned settings', async () => {
    const configBackend = await loadConfigBackend()
    const merged = configBackend.mergeAiopstermCodexConfigToml(
      [
        '# Generated by aiopsterm. Do not edit while aiopsterm is running.',
        'instructions = "old aiopsterm prompt"',
        'user_root_setting = "keep-root"',
        '',
        '[features]',
        'hooks = true',
        'user_feature = true',
        '',
        '[mcp_servers.aiopsterm_remote]',
        'enabled_tools = ["list_terminals", "run_command"]',
        '',
        '[projects."/home/tlinux/.config/aiopsterm/codex-agent"]',
        'trust_level = "trusted"',
        '',
        '[tui.model_availability_nux]',
        '"gpt-5.5" = 1'
      ].join('\n'),
      {
        bridgeScriptPath: '/repo/resources/codex-aiopsterm-mcp.js',
        bridgeSocketPath: '/tmp/aiopsterm-user-data/codex-agent/bridge.sock',
        target: {
          kind: 'local',
          sessionId: 'terminal-merged',
          label: 'Local terminal'
        },
        provider: configBackend.resolveAiopstermCodexProviderConfig(createConfigWithModelProvider())
      }
    )

    expect(merged).toContain('user_root_setting = "keep-root"')
    expect(merged).toContain('user_feature = true')
    expect(merged).toContain('[projects."/home/tlinux/.config/aiopsterm/codex-agent"]')
    expect(merged).toContain('trust_level = "trusted"')
    expect(merged).toContain('[tui.model_availability_nux]')
    expect(merged).toContain('"gpt-5.5" = 1')
    expect(merged).toContain('enabled_tools = ["list_terminals", "run_command", "read_terminal_output", "read_file", "glob_search", "grep_search", "target_context"]')
    expect(merged).toContain('[mcp_servers.aiopsterm_remote.tools.read_terminal_output]')
    expect(merged).toContain('terminal_session_id: terminal-merged')
    expect(merged).not.toContain('old aiopsterm prompt')
    expect((merged.match(/\[features\]/g) || [])).toHaveLength(1)
    expect((merged.match(/\[mcp_servers\.aiopsterm_remote\]/g) || [])).toHaveLength(1)

    const mergedAgain = configBackend.mergeAiopstermCodexConfigToml(merged, {
      bridgeScriptPath: '/repo/resources/codex-aiopsterm-mcp.js',
      bridgeSocketPath: '/tmp/aiopsterm-user-data/codex-agent/bridge.sock'
    })
    expect((mergedAgain.match(/\[mcp_servers\.aiopsterm_remote\.tools\.read_terminal_output\]/g) || [])).toHaveLength(1)
    expect((mergedAgain.match(/# aiopsterm root managed begin/g) || [])).toHaveLength(1)
    expect((mergedAgain.match(/# aiopsterm tables managed begin/g) || [])).toHaveLength(1)
  })

  it('refreshes Codex config before a session is created', async () => {
    const backend = await loadBackend()
    const mkdirCalls: Array<string> = []
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getConfig: () => createConfigWithModelProvider(),
      getBridgeSocketPath: () => '/tmp/aiopsterm-user-data/codex-agent/bridge.sock',
      existsSync: codexPackageExists,
      mkdir: async (path: string) => {
        mkdirCalls.push(String(path))
        return undefined
      },
      readFile: async () => '[projects."/tmp/manual"]\ntrust_level = "trusted"\n',
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => null
    })

    const refreshed = await backend.refreshCodexConfig({
      target: {
        kind: 'local',
        sessionId: 'terminal-refresh',
        label: 'Local terminal',
        cwd: '/home/tlinux'
      }
    })

    expect(refreshed).toEqual({
      codexHome: '/tmp/aiopsterm-user-data/codex-agent',
      configPath: '/tmp/aiopsterm-user-data/codex-agent/config.toml'
    })
    expect(mkdirCalls).toEqual(['/tmp/aiopsterm-user-data/codex-agent'])
    expect(writeFileCalls).toHaveLength(1)
    expect(writeFileCalls[0].path).toBe('/tmp/aiopsterm-user-data/codex-agent/config.toml')
    expect(writeFileCalls[0].content).toContain('[projects."/tmp/manual"]')
    expect(writeFileCalls[0].content).toContain('enabled_tools = ["list_terminals", "run_command", "read_terminal_output", "read_file", "glob_search", "grep_search", "target_context"]')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.read_terminal_output]')
    expect(writeFileCalls[0].content).toContain('terminal_session_id: terminal-refresh')
  })

  it('uses configured OpenAI-compatible Responses provider as Codex fallback when the selected chat model is local', async () => {
    const configBackend = await loadConfigBackend()
    const provider = configBackend.resolveAiopstermCodexProviderConfig(
      createConfigWithModelProvider({
        modelProvider: 'local',
        modelName: 'aiopsterm-local-agent'
      })
    )

    expect(provider).toEqual(
      expect.objectContaining({
        providerId: 'aiopsterm_openai_responses',
        model: 'ark-code-latest',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        apiKeyEnv: 'AIOPSTERM_CODEX_API_KEY',
        apiKey: 'ark-secret-token'
      })
    )
  })

  it('configures Codex built-in Ollama provider from selected aiopsterm Ollama settings', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getConfig: () =>
        createConfigWithModelProvider({
          modelProvider: 'ollama',
          modelName: 'qwen2.5-coder',
          modelSettings: {
            ...createConfigWithModelProvider().modelSettings!,
            providers: {
              ...createConfigWithModelProvider().modelSettings!.providers,
              ollama: {
                baseUrl: 'http://127.0.0.1:11434',
                apiKey: '',
                modelId: 'qwen2.5-coder'
              }
            },
            options: [{ name: 'qwen2.5-coder', locked: false, checked: true, type: 'custom', apiProvider: 'ollama' }]
          }
        }),
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    await backend.createCodexSession('codex-ollama-provider', {}, createSink(createRecorder()))

    const configToml = writeFileCalls.at(-1)?.content || ''
    expect(configToml).toContain('model = "qwen2.5-coder"')
    expect(configToml).toContain('model_provider = "ollama"')
    expect(configToml).not.toContain('[model_providers.ollama]')
    expect(spawnCalls[0].options).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_OSS_BASE_URL: 'http://127.0.0.1:11434/v1'
        })
      })
    )
  })

  it('configures Codex built-in LM Studio provider from selected aiopsterm LM Studio settings', async () => {
    const configBackend = await loadConfigBackend()
    const provider = configBackend.resolveAiopstermCodexProviderConfig(
      createConfigWithModelProvider({
        modelProvider: 'lmstudio',
        modelName: 'openai/gpt-oss-20b',
        modelSettings: {
          ...createConfigWithModelProvider().modelSettings!,
          providers: {
            ...createConfigWithModelProvider().modelSettings!.providers,
            lmstudio: {
              baseUrl: 'http://127.0.0.1:1234',
              apiKey: '',
              modelId: 'openai/gpt-oss-20b'
            }
          },
          options: [{ name: 'openai/gpt-oss-20b', locked: false, checked: true, type: 'custom', apiProvider: 'lmstudio' }]
        }
      })
    )

    expect(provider).toEqual(
      expect.objectContaining({
        providerId: 'lmstudio',
        model: 'openai/gpt-oss-20b',
        env: expect.objectContaining({
          CODEX_OSS_BASE_URL: 'http://127.0.0.1:1234/v1'
        })
      })
    )
  })

  it('configures Codex Amazon Bedrock only for supported OpenAI Bedrock models', async () => {
    const backend = await loadBackend()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    const writeFileCalls: Array<{ path: string; content: string }> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getConfig: () =>
        createConfigWithModelProvider({
          modelProvider: 'bedrock',
          modelName: 'openai.gpt-5.5',
          modelSettings: {
            ...createConfigWithModelProvider().modelSettings!,
            providers: {
              ...createConfigWithModelProvider().modelSettings!.providers,
              bedrock: {
                baseUrl: '',
                apiKey: 'bedrock-api-key',
                modelId: 'openai.gpt-5.5',
                awsAccessKey: 'AKIA-CODEX',
                awsSecretKey: 'aws-secret',
                awsSessionToken: 'session-token',
                awsRegion: 'us-east-2'
              }
            },
            options: [{ name: 'openai.gpt-5.5', locked: false, checked: true, type: 'custom', apiProvider: 'bedrock' }]
          }
        }),
      binaryPath: CODEX_PACKAGE_BINARY,
      binaryHealthCheck: false,
      existsSync: codexPackageExists,
      mkdir: async () => undefined,
      writeFile: async (path: string, content: string) => {
        writeFileCalls.push({ path: String(path), content: String(content) })
      },
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    await backend.createCodexSession('codex-bedrock-provider', {}, createSink(createRecorder()))

    const configToml = writeFileCalls.at(-1)?.content || ''
    expect(configToml).toContain('model = "openai.gpt-5.5"')
    expect(configToml).toContain('model_provider = "amazon-bedrock"')
    expect(configToml).toContain('[model_providers.amazon-bedrock.aws]')
    expect(configToml).toContain('region = "us-east-2"')
    expect(configToml).not.toContain('bedrock-api-key')
    expect(configToml).not.toContain('aws-secret')
    expect(spawnCalls[0].options).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          AWS_BEARER_TOKEN_BEDROCK: 'bedrock-api-key',
          AWS_ACCESS_KEY_ID: 'AKIA-CODEX',
          AWS_SECRET_ACCESS_KEY: 'aws-secret',
          AWS_SESSION_TOKEN: 'session-token',
          AWS_REGION: 'us-east-2'
        })
      })
    )
  })

  it('falls back to OpenAI Responses for non-Codex Bedrock Runtime models', async () => {
    const configBackend = await loadConfigBackend()
    const provider = configBackend.resolveAiopstermCodexProviderConfig(
      createConfigWithModelProvider({
        modelProvider: 'bedrock',
        modelName: 'anthropic.claude-3-haiku-20240307-v1:0',
        modelSettings: {
          ...createConfigWithModelProvider().modelSettings!,
          providers: {
            ...createConfigWithModelProvider().modelSettings!.providers,
            bedrock: {
              baseUrl: '',
              apiKey: '',
              modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
              awsAccessKey: 'AKIA-CODEX',
              awsSecretKey: 'aws-secret',
              awsRegion: 'us-east-2'
            }
          },
          options: [{ name: 'anthropic.claude-3-haiku-20240307-v1:0', locked: false, checked: true, type: 'custom', apiProvider: 'bedrock' }]
        }
      })
    )

    expect(provider).toEqual(
      expect.objectContaining({
        providerId: 'aiopsterm_openai_responses',
        model: 'ark-code-latest'
      })
    )
  })
})
