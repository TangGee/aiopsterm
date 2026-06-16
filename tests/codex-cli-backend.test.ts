import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CodexSessionCreateOptions, UserConfig } from '@shared/preload'

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
  exit: [] as Array<{ event: CodexLifecycleEvent; code?: number | null }>,
  closed: [] as string[]
})

const createSink = (events: ReturnType<typeof createRecorder>) => ({
  lifecycle: (event: CodexLifecycleEvent) => events.lifecycle.push(event),
  data: (id: string, chunk: string | Buffer) => events.data.push({ id, chunk }),
  exit: (event: CodexLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
  closed: (id: string) => events.closed.push(id)
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/codexCli'
  return import(modulePath)
}

const loadConfigBackend = async () => {
  const modulePath = '../src/main/backend/codexConfig'
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
        ollama: { baseUrl: '', apiKey: '', modelId: '' }
      },
      options: [{ name: 'ark-code-latest', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
    },
    ...patch
  }) as UserConfig

const CODEX_PACKAGE_ROOT = '/repo/codex/codex-rs/target/x86_64-unknown-linux-musl/aiopsterm-codex-package'
const CODEX_PACKAGE_BINARY = `${CODEX_PACKAGE_ROOT}/bin/codex`
const codexPackageExists = (path: string) =>
  path === CODEX_PACKAGE_BINARY ||
  path === `${CODEX_PACKAGE_ROOT}/codex-package.json` ||
  path === '/repo/resources/codex-aiopsterm-mcp.js'

describe('Codex CLI backend runtime', () => {
  beforeEach(async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime()
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

    const session = await backend.createCodexSession(
      'codex-test-1',
      {
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
      } as CodexCreateOptionsForTest,
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
        cwd: '/tmp/aiopsterm-user-data/codex-agent',
        codexHome: '/tmp/aiopsterm-user-data/codex-agent',
        runtimeKind: 'pty'
      })
    )
    expect(mkdirCalls).toEqual(['/tmp/aiopsterm-user-data/codex-agent'])
    expect(writeFileCalls).toHaveLength(1)
    expect(writeFileCalls[0]).toEqual(
      expect.objectContaining({
        path: '/tmp/aiopsterm-user-data/codex-agent/config.toml'
      })
    )
    expect(writeFileCalls[0].content).toContain('include_environment_context = false')
    expect(writeFileCalls[0].content).toContain('model = "ark-code-latest"')
    expect(writeFileCalls[0].content).toContain('model_provider = "aiopsterm_openai_responses"')
    expect(writeFileCalls[0].content).toContain('[model_providers.aiopsterm_openai_responses]')
    expect(writeFileCalls[0].content).toContain('base_url = "https://ark.cn-beijing.volces.com/api/coding/v3"')
    expect(writeFileCalls[0].content).toContain('env_key = "AIOPSTERM_CODEX_API_KEY"')
    expect(writeFileCalls[0].content).toContain('wire_api = "responses"')
    expect(writeFileCalls[0].content).not.toContain('ark-secret-token')
    expect(writeFileCalls[0].content).toContain('instructions = "You are aiopsterm Agent')
    expect(writeFileCalls[0].content).toContain('project_doc_max_bytes = 0')
    expect(writeFileCalls[0].content).toContain('web_search = "disabled"')
    expect(writeFileCalls[0].content).toContain('check_for_update_on_startup = false')
    expect(writeFileCalls[0].content).toContain('shell_tool = false')
    expect(writeFileCalls[0].content).toContain('unified_exec = false')
    expect(writeFileCalls[0].content).toContain('image_generation = false')
    expect(writeFileCalls[0].content).toContain('browser_use = false')
    expect(writeFileCalls[0].content).toContain('computer_use = false')
    expect(writeFileCalls[0].content).toContain('[tools.experimental_request_user_input]')
    expect(writeFileCalls[0].content).toContain('enabled = false')
    expect(writeFileCalls[0].content).toContain('include_collaboration_mode_instructions = false')
    expect(writeFileCalls[0].content).toContain('multi_agent = false')
    expect(writeFileCalls[0].content).toContain('hooks = false')
    expect(writeFileCalls[0].content).toContain('[skills]')
    expect(writeFileCalls[0].content).toContain('include_instructions = false')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote]')
    expect(writeFileCalls[0].content).toContain('default_tools_approval_mode = "prompt"')
    expect(writeFileCalls[0].content).toContain('enabled_tools = ["run_command", "read_file", "glob_search", "grep_search", "target_context"]')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.target_context]')
    expect(writeFileCalls[0].content).toContain('approval_mode = "approve"')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.read_file]')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.glob_search]')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.grep_search]')
    expect(writeFileCalls[0].content).toContain('[mcp_servers.aiopsterm_remote.tools.run_command]')
    expect(writeFileCalls[0].content).toContain('approval_mode = "prompt"')
    expect(writeFileCalls[0].content).toContain('AIOPSTERM_CODEX_BRIDGE_SOCKET = "/tmp/aiopsterm-user-data/codex-agent/bridge.sock"')
    expect(writeFileCalls[0].content).toContain('protect data, minimize service disruption')
    expect(writeFileCalls[0].content).toContain('Call `target_context` before the first command')
    expect(writeFileCalls[0].content).toContain('aiopsterm disables Codex environment-context injection')
    expect(writeFileCalls[0].content).toContain('current date/time, timezone, hostname')
    expect(writeFileCalls[0].content).toContain('Never invent command output')
    expect(writeFileCalls[0].content).toContain('command_blocked')
    expect(writeFileCalls[0].content).toContain('Do not fabricate terminal output or host state')
    expect(writeFileCalls[0].content).toContain('terminal_session_id: terminal-1')
    expect(writeFileCalls[0].content).toContain('host: 10.0.0.8')
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        file: CODEX_PACKAGE_BINARY,
        args: [],
        options: expect.objectContaining({
          cwd: '/tmp/aiopsterm-user-data/codex-agent',
          cols: 120,
          rows: 40,
          env: expect.objectContaining({
            CODEX_HOME: '/tmp/aiopsterm-user-data/codex-agent',
            CODEX_MANAGED_PACKAGE_ROOT: CODEX_PACKAGE_ROOT,
            AIOPSTERM_CODEX_API_KEY: 'ark-secret-token',
            AIOPSTERM_CODEX_FLAT_MCP_TOOLS: '1',
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
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'closed'])
    expect(events.exit).toEqual([expect.objectContaining({ code: 3 })])
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

    expect(writeFileCalls[0].content).not.toContain('model_provider = "aiopsterm_openai_responses"')
    expect(writeFileCalls[0].content).not.toContain('[model_providers.aiopsterm_openai_responses]')
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
})
