import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type {
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '../src/shared/contracts/terminalSessions'

type SshTerminalTarget = {
  host: string
  port: number
  username: string
  title?: string
  asset?: { id?: string } | null
  password?: string
}

type SshSessionAuthRuntime = {
  attachKeyboardInteractive: (client: EventEmitter, target: SshTerminalTarget, scope: 'target' | 'jump') => void
  commitRememberedPassword: (scope: 'target' | 'jump') => void
  requestPassword: (target: SshTerminalTarget, scope: 'target' | 'jump', input?: { attempt?: number; rejected?: boolean }) => Promise<void>
  sendActiveKeyboardResult: (
    scope: 'target' | 'jump',
    result: Omit<TerminalKeyboardInteractiveResult, 'id' | 'attempts' | 'authScope'>
  ) => void
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/sshTerminalSessionAuthRuntime'
  return (await import(modulePath)) as {
    createSshTerminalSessionAuthRuntime: (input: {
      id: string
      target: SshTerminalTarget
      sink: {
        lifecycle: (event: TerminalLifecycleEvent) => void
        exit: (event: TerminalLifecycleEvent, code?: number | null) => void
        data: (chunk: string | Buffer) => void
        keyboardInteractive?: (request: TerminalKeyboardInteractiveRequest) => Promise<string[] | TerminalKeyboardInteractiveResponse>
        keyboardInteractiveResult?: (result: TerminalKeyboardInteractiveResult) => void
        closed?: (id: string) => void
      }
      lifecycleBase: Omit<TerminalLifecycleEvent, 'id' | 'stage' | 'at'>
      sendLifecycle: (event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }) => TerminalLifecycleEvent
      rememberPassword?: (assetId: string, password: string) => void | Promise<void>
    }) => SshSessionAuthRuntime
  }
}

const target = (overrides: Partial<SshTerminalTarget> = {}): SshTerminalTarget => ({
  host: '10.71.0.8',
  port: 2222,
  username: 'deploy',
  title: 'deploy-host',
  asset: { id: 'asset-deploy' },
  ...overrides
})

const createHarness = async (options: {
  keyboardInteractive?: (request: TerminalKeyboardInteractiveRequest) => Promise<string[] | TerminalKeyboardInteractiveResponse>
  rememberPassword?: (assetId: string, password: string) => void | Promise<void>
} = {}) => {
  const module = await loadRuntime()
  const lifecycle: TerminalLifecycleEvent[] = []
  const results: TerminalKeyboardInteractiveResult[] = []
  const authTarget = target()
  const lifecycleBase: Omit<TerminalLifecycleEvent, 'id' | 'stage' | 'at'> = {
    kind: 'ssh',
    shell: 'ssh',
    cwd: '/home/deploy',
    host: authTarget.host,
    port: authTarget.port,
    username: authTarget.username,
    connectionId: 'ssh-ssh-auth-unit'
  }
  const runtime = module.createSshTerminalSessionAuthRuntime({
    id: 'ssh-auth-unit',
    target: authTarget,
    sink: {
      lifecycle: (event) => lifecycle.push(event),
      exit: vi.fn(),
      data: vi.fn(),
      keyboardInteractive: options.keyboardInteractive,
      keyboardInteractiveResult: (result) => results.push(result)
    },
    lifecycleBase,
    sendLifecycle: (event) => {
      const payload: TerminalLifecycleEvent = {
        id: 'ssh-auth-unit',
        at: 1717200000000 + lifecycle.length,
        ...event
      }
      lifecycle.push(payload)
      return payload
    },
    rememberPassword: options.rememberPassword
  })
  return { runtime, target: authTarget, lifecycle, results }
}

const emitKeyboardInteractive = (
  client: EventEmitter,
  prompts: TerminalKeyboardInteractivePrompt[] = [{ prompt: ' OTP code: ', echo: false }],
  extra: { name?: string; instructions?: string } = {}
) =>
  new Promise<string[]>((resolve) => {
    client.emit(
      'keyboard-interactive',
      extra.name || ' Dynamic password ',
      extra.instructions || ' Enter MFA code ',
      '',
      prompts,
      (responses: string[]) => resolve(responses)
    )
  })

describe('sshTerminalSessionAuthRuntime', () => {
  it('bridges keyboard-interactive requests and active success results for target auth', async () => {
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const { runtime, target: authTarget, lifecycle, results } = await createHarness({
      keyboardInteractive: async (request) => {
        requests.push(request)
        return ['123456']
      }
    })
    const client = new EventEmitter()
    runtime.attachKeyboardInteractive(client, authTarget, 'target')

    await expect(emitKeyboardInteractive(client)).resolves.toEqual(['123456'])
    runtime.sendActiveKeyboardResult('target', { status: 'success' })

    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-auth-unit-keyboard-1',
        connectionId: 'ssh-ssh-auth-unit',
        host: '10.71.0.8',
        port: 2222,
        username: 'deploy',
        purpose: 'keyboard-interactive',
        authScope: 'target',
        title: 'deploy-host',
        name: 'Dynamic password',
        instructions: 'Enter MFA code',
        prompts: [{ prompt: 'OTP code:', echo: false }],
        attempts: 1,
        maxAttempts: 1,
        timeoutMs: 180000
      })
    ])
    expect(lifecycle).toEqual([
      expect.objectContaining({
        stage: 'connecting',
        authScope: 'target',
        authPurpose: 'keyboard-interactive',
        message: 'Two-factor authentication required for deploy@10.71.0.8:2222'
      })
    ])
    expect(results).toEqual([expect.objectContaining({ id: 'ssh-auth-unit-keyboard-1', authScope: 'target', status: 'success', attempts: 1 })])
  })

  it('fails closed when keyboard-interactive exceeds its configured attempt cap', async () => {
    const { runtime, target: authTarget, results } = await createHarness({
      keyboardInteractive: async () => ['first-code']
    })
    const client = new EventEmitter()
    runtime.attachKeyboardInteractive(client, authTarget, 'jump')

    await expect(emitKeyboardInteractive(client)).resolves.toEqual(['first-code'])
    await expect(emitKeyboardInteractive(client)).resolves.toEqual([])

    expect(results).toEqual([
      expect.objectContaining({
        id: 'ssh-auth-unit-jump-keyboard-2',
        authScope: 'jump',
        status: 'failed',
        attempts: 1,
        final: true,
        errorMessage: 'Maximum two-factor authentication attempts reached.'
      })
    ])
  })

  it('requests passwords, mutates the auth target, and commits remembered passwords after success', async () => {
    const requests: TerminalKeyboardInteractiveRequest[] = []
    const remembered: Array<{ assetId: string; password: string }> = []
    const { runtime, target: authTarget, lifecycle, results } = await createHarness({
      keyboardInteractive: async (request) => {
        requests.push(request)
        return { responses: ['pw1'], rememberPassword: true }
      },
      rememberPassword: (assetId, password) => {
        remembered.push({ assetId, password })
      }
    })

    await runtime.requestPassword(authTarget, 'target')
    runtime.commitRememberedPassword('target')

    expect(authTarget.password).toBe('pw1')
    expect(requests).toEqual([
      expect.objectContaining({
        id: 'ssh-auth-unit-password',
        purpose: 'password',
        authScope: 'target',
        assetId: 'asset-deploy',
        canRememberPassword: true,
        name: 'SSH password',
        instructions: 'Enter the SSH password to continue this connection.',
        prompts: [{ prompt: 'SSH password for deploy@10.71.0.8:2222:', echo: false }],
        attempts: 1,
        maxAttempts: 1,
        timeoutMs: 180000
      })
    ])
    expect(lifecycle).toEqual([expect.objectContaining({ stage: 'connecting', authScope: 'target', authPurpose: 'password' })])
    expect(results).toEqual([expect.objectContaining({ id: 'ssh-auth-unit-password', authScope: 'target', status: 'success', attempts: 1, final: true })])
    expect(remembered).toEqual([{ assetId: 'asset-deploy', password: 'pw1' }])
  })

  it('maps canceled or timed-out password prompts into structured auth results', async () => {
    const { runtime, target: authTarget, results } = await createHarness({
      keyboardInteractive: async () => {
        throw new Error('prompt timed out')
      }
    })

    await expect(runtime.requestPassword(authTarget, 'jump', { attempt: 2, rejected: true })).rejects.toThrow('prompt timed out')

    expect(results).toEqual([
      expect.objectContaining({
        id: 'ssh-auth-unit-jump-password-retry',
        authScope: 'jump',
        status: 'timeout',
        attempts: 2,
        final: true,
        errorMessage: 'prompt timed out'
      })
    ])
  })
})
