import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext,
  UserConfig
} from '@shared/preload'

type TerminalSuggestionsBackend = {
  configureTerminalSuggestionsRuntime: (config?: {
    databasePath?: string
    now?: () => number
    fetch?: typeof fetch
    getConfig?: () => UserConfig
  }) => void
  generateTerminalCommand: (input: TerminalCommandGenerationInput) => Promise<TerminalCommandGenerationResult>
  getTerminalCommandSuggestions: (query: string, context?: TerminalCommandSuggestionContext) => Promise<TerminalCommandSuggestion[]>
  recordTerminalCommandHistory: (command: string, context?: Pick<TerminalCommandSuggestionContext, 'host'>) => void
}

let backend: TerminalSuggestionsBackend

beforeAll(async () => {
  const modulePath = '../src/main/backend/terminalSuggestions'
  backend = (await import(modulePath)) as TerminalSuggestionsBackend
})

beforeEach(() => {
  backend.configureTerminalSuggestionsRuntime({
    databasePath: ':memory:',
    now: () => 1_780_488_000_000
  })
})

afterEach(() => {
  backend.configureTerminalSuggestionsRuntime()
  vi.restoreAllMocks()
})

describe('terminal command backend boundary', () => {
  it('generates local command records behind the main-process boundary', async () => {
    const result = await backend.generateTerminalCommand({
      panelId: 'panel-ssh',
      instruction: '检查磁盘空间',
      modelName: 'aiopsterm-local-agent',
      context: {
        host: '10.8.0.9',
        username: 'deploy',
        cwd: '/home/deploy',
        shell: 'bash',
        connectionType: 'ssh'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^terminal-command-/),
        panelId: 'panel-ssh',
        instruction: '检查磁盘空间',
        command: 'df -h',
        modelName: 'aiopsterm-local-agent',
        provider: 'aiopsterm-local',
        context: expect.objectContaining({ host: '10.8.0.9', username: 'deploy', connectionType: 'ssh' })
      })
    )
  })

  it('calls the configured live model provider for terminal command generation', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```bash\njournalctl -u nginx --since "30 minutes ago"\n```'
            }
          }
        ]
      })
    })) as unknown as typeof fetch

    backend.configureTerminalSuggestionsRuntime({
      databasePath: ':memory:',
      now: () => 1_780_488_000_000,
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'ops-terminal',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-terminal', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4010',
                apiKey: 'sk-test',
                modelId: 'ops-terminal',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as UserConfig
    })

    const result = await backend.generateTerminalCommand({
      panelId: 'panel-ssh',
      instruction: '查看 nginx 最近日志',
      modelName: 'ops-terminal',
      context: {
        host: '10.8.0.9',
        username: 'deploy',
        cwd: '/srv/app',
        shell: 'bash',
        connectionType: 'ssh'
      }
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          command: 'journalctl -u nginx --since "30 minutes ago"',
          modelName: 'ops-terminal',
          provider: 'openai'
        })
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        body: expect.stringContaining('查看 nginx 最近日志')
      })
    )
  })

  it('rejects unsafe commands returned by the command generation provider', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'rm -rf /'
            }
          }
        ]
      })
    })) as unknown as typeof fetch

    backend.configureTerminalSuggestionsRuntime({
      databasePath: ':memory:',
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'ops-terminal',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-terminal', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4010',
                apiKey: 'sk-test',
                modelId: 'ops-terminal',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as UserConfig
    })

    await expect(
      backend.generateTerminalCommand({
        panelId: 'panel-ssh',
        instruction: '清理系统',
        modelName: 'ops-terminal',
        context: {
          host: '10.8.0.9',
          username: 'deploy',
          cwd: '/srv/app',
          shell: 'bash',
          connectionType: 'ssh'
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'TERMINAL_COMMAND_UNSAFE'
      })
    )
  })

  it('persists executed command history and ranks same-host matches first', async () => {
    backend.recordTerminalCommandHistory('systemctl status nginx', { host: '10.8.0.9' })
    backend.recordTerminalCommandHistory('systemctl restart nginx', { host: '10.8.0.8' })
    backend.recordTerminalCommandHistory('rm -rf /', { host: '10.8.0.9' })

    const suggestions = await backend.getTerminalCommandSuggestions('sys', { mode: 'base', host: '10.8.0.9' })

    expect(suggestions.slice(0, 2)).toEqual([
      expect.objectContaining({ command: 'systemctl status nginx', source: 'history', explanation: 'history on this host' }),
      expect.objectContaining({ command: 'systemctl restart nginx', source: 'history', explanation: 'history from 10.8.0.8' })
    ])
    expect(suggestions.some((item) => item.command === 'rm -rf /')).toBe(false)
  })

  it('loads command syntax suggestions from the packaged Fig spec catalog', async () => {
    const suggestions = await backend.getTerminalCommandSuggestions('kubectl ge', { mode: 'base', host: '10.8.0.9' })

    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'kubectl get',
          source: 'base'
        })
      ])
    )
  })

  it('calls the configured live model provider for AI suggestions instead of fabricating --help rows', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'CMD: git log --oneline -10\nEXP: recent commits'
            }
          }
        ]
      })
    })) as unknown as typeof fetch

    backend.configureTerminalSuggestionsRuntime({
      databasePath: ':memory:',
      now: () => 1_780_488_000_000,
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'ops-terminal',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-terminal', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4010',
                apiKey: 'sk-test',
                modelId: 'ops-terminal',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as UserConfig
    })

    const suggestions = await backend.getTerminalCommandSuggestions('git lo', {
      mode: 'ai',
      host: '10.8.0.9',
      shell: 'bash',
      modelName: 'ops-terminal'
    })

    expect(suggestions).toEqual([{ command: 'git log --oneline -10', source: 'ai', explanation: 'recent commits' }])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        body: expect.stringContaining('git lo')
      })
    )
  })

  it('returns local backend AI suggestions when the local backend model is selected', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    backend.configureTerminalSuggestionsRuntime({
      databasePath: ':memory:',
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'aiopsterm-local-agent',
          modelProvider: 'local',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'aiopsterm-local-agent', locked: false, checked: true, apiProvider: 'default' }],
            providers: {}
          }
        }) as UserConfig
    })

    await expect(backend.getTerminalCommandSuggestions('kubectl', { mode: 'ai' })).resolves.toEqual([
      {
        command: 'kubectl get pods -A',
        source: 'ai',
        explanation: 'local backend: list Kubernetes pods'
      }
    ])
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(backend.getTerminalCommandSuggestions('rm ', { mode: 'ai' })).resolves.toEqual([])
  })

  it('does not silently fall back to local AI suggestions for unknown non-local models', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    backend.configureTerminalSuggestionsRuntime({
      databasePath: ':memory:',
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'aiopsterm-local-agent',
          modelProvider: 'local',
          modelSettings: {
            addModelSwitch: true,
            options: [
              { name: 'aiopsterm-local-agent', locked: false, checked: true, apiProvider: 'default' },
              { name: 'ops-missing', locked: false, checked: false, apiProvider: 'openai' }
            ],
            providers: {}
          }
        }) as UserConfig
    })

    await expect(backend.getTerminalCommandSuggestions('kubectl', { mode: 'ai', modelName: 'ops-missing' })).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
