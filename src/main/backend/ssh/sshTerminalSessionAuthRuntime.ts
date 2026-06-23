import type {
  TerminalKeyboardInteractivePrompt,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'
import {
  createPasswordPrompt,
  keyboardInteractiveTimeoutMs,
  maxKeyboardInteractiveAttempts,
  normalizeKeyboardInteractivePrompts,
  terminalAuthLabel
} from './sshTerminalAuthRuntime'
import { cleanText } from './sshTerminalRuntimeConfig'
import type { SshAuthScope, SshTerminalClient, SshTerminalEventSink, SshTerminalTarget } from './sshTerminalTypes'

type SshSessionAuthRuntimeInput = {
  id: string
  target: SshTerminalTarget
  sink: SshTerminalEventSink
  lifecycleBase: Omit<TerminalLifecycleEvent, 'id' | 'stage' | 'at'>
  sendLifecycle: (event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }) => TerminalLifecycleEvent
  rememberPassword?: (assetId: string, password: string) => void | Promise<void>
}

type PasswordRequestInput = {
  attempt?: number
  rejected?: boolean
}

type KeyboardInteractiveFinish = (responses: string[]) => void

const normalizeKeyboardResponse = (value: string[] | TerminalKeyboardInteractiveResponse): TerminalKeyboardInteractiveResponse => {
  if (Array.isArray(value)) {
    return { responses: value.map((item) => String(item || '')).slice(0, 8) }
  }
  if (typeof value === 'object' && value) {
    return {
      responses: Array.isArray(value.responses) ? value.responses.map((item) => String(item || '')).slice(0, 8) : [],
      ...(value.rememberPassword === true ? { rememberPassword: true } : {})
    }
  }
  return { responses: [] }
}

export const createSshTerminalSessionAuthRuntime = (input: SshSessionAuthRuntimeInput) => {
  const keyboardInteractiveStates = new Map<string, { attempts: number; activeRequestId: string }>()
  const pendingRememberPasswords = new Map<string, { assetId: string; password: string }>()

  const keyboardState = (scope: string) => {
    const existing = keyboardInteractiveStates.get(scope)
    if (existing) return existing
    const created = { attempts: 0, activeRequestId: '' }
    keyboardInteractiveStates.set(scope, created)
    return created
  }

  const keyboardRequestId = (scope: string, attempt: number) => (scope === 'target' ? `${input.id}-keyboard-${attempt}` : `${input.id}-${scope}-keyboard-${attempt}`)

  const passwordRequestId = (scope: string, attempt: number) => {
    const suffix = attempt <= 1 ? 'password' : 'password-retry'
    return scope === 'target' ? `${input.id}-${suffix}` : `${input.id}-${scope}-${suffix}`
  }

  const sendActiveKeyboardResult = (scope: SshAuthScope, result: Omit<TerminalKeyboardInteractiveResult, 'id' | 'attempts' | 'authScope'>) => {
    const state = keyboardState(scope)
    if (!state.activeRequestId) return
    input.sink.keyboardInteractiveResult?.({
      id: state.activeRequestId,
      authScope: scope,
      attempts: state.attempts,
      ...result
    })
    state.activeRequestId = ''
  }

  const rememberableAssetId = (authTarget: SshTerminalTarget) => cleanText(authTarget.asset?.id)

  const rememberPasswordWhenReady = (scope: SshAuthScope, authTarget: SshTerminalTarget, password: string, rememberPassword?: boolean) => {
    const assetId = rememberableAssetId(authTarget)
    if (rememberPassword && assetId && password) {
      pendingRememberPasswords.set(scope, { assetId, password })
      return
    }
    pendingRememberPasswords.delete(scope)
  }

  const commitRememberedPassword = (scope: SshAuthScope) => {
    const pending = pendingRememberPasswords.get(scope)
    if (!pending) return
    pendingRememberPasswords.delete(scope)
    void input.rememberPassword?.(pending.assetId, pending.password)
  }

  const emitKeyboardFailure = (requestId: string, scope: SshAuthScope, attempts: number, error: unknown) => {
    const isTimeout = error instanceof Error && /timed out|timeout/i.test(error.message)
    const isCancel = error instanceof Error && /cancel/i.test(error.message)
    input.sink.keyboardInteractiveResult?.({
      id: requestId,
      authScope: scope,
      status: isTimeout ? 'timeout' : isCancel ? 'canceled' : 'failed',
      attempts,
      final: true,
      errorMessage: error instanceof Error ? error.message : 'Two-factor authentication failed.'
    })
  }

  const attachKeyboardInteractive = (authClient: SshTerminalClient, authTarget: SshTerminalTarget, scope: SshAuthScope) => {
    authClient.on('keyboard-interactive', (name, instructions, _instructionsLang, prompts: TerminalKeyboardInteractivePrompt[], finishKeyboardInteractive: KeyboardInteractiveFinish) => {
      const state = keyboardState(scope)
      const requestId = keyboardRequestId(scope, state.attempts + 1)
      const maxAttempts = maxKeyboardInteractiveAttempts()
      if (state.attempts >= maxAttempts) {
        input.sink.keyboardInteractiveResult?.({
          id: requestId,
          authScope: scope,
          status: 'failed',
          attempts: state.attempts,
          final: true,
          errorMessage: 'Maximum two-factor authentication attempts reached.'
        })
        finishKeyboardInteractive([])
        return
      }
      state.attempts += 1
      state.activeRequestId = requestId
      input.sendLifecycle({
        ...input.lifecycleBase,
        stage: 'connecting',
        authScope: scope,
        authPurpose: 'keyboard-interactive',
        message: `Two-factor authentication required for ${terminalAuthLabel(authTarget)}`
      })
      void (async () => {
        try {
          if (!input.sink.keyboardInteractive) throw new Error('Two-factor authentication prompt service is unavailable.')
          const response = normalizeKeyboardResponse(
            await input.sink.keyboardInteractive({
              id: requestId,
              connectionId: `ssh-${input.id}`,
              host: authTarget.host,
              port: authTarget.port,
              username: authTarget.username,
              purpose: 'keyboard-interactive',
              authScope: scope,
              ...(authTarget.title ? { title: authTarget.title } : {}),
              ...(cleanText(name) ? { name: cleanText(name) } : {}),
              ...(cleanText(instructions) ? { instructions: cleanText(instructions) } : {}),
              prompts: normalizeKeyboardInteractivePrompts(prompts),
              attempts: state.attempts,
              maxAttempts,
              timeoutMs: keyboardInteractiveTimeoutMs()
            })
          )
          finishKeyboardInteractive(response.responses)
        } catch (error) {
          state.activeRequestId = ''
          emitKeyboardFailure(requestId, scope, state.attempts, error)
          finishKeyboardInteractive([])
        }
      })()
    })
  }

  const requestPassword = async (authTarget: SshTerminalTarget, scope: SshAuthScope, requestInput: PasswordRequestInput = {}) => {
    const attempt = Math.max(1, Math.trunc(Number(requestInput.attempt || 1)))
    const requestId = passwordRequestId(scope, attempt)
    if (!input.sink.keyboardInteractive) {
      throw new Error(`SSH password is required for ${terminalAuthLabel(authTarget)}.`)
    }
    input.sendLifecycle({
      ...input.lifecycleBase,
      stage: 'connecting',
      authScope: scope,
      authPurpose: 'password',
      message: `SSH password required for ${terminalAuthLabel(authTarget)}`
    })
    try {
      const response = normalizeKeyboardResponse(
        await input.sink.keyboardInteractive({
          id: requestId,
          connectionId: `ssh-${input.id}`,
          host: authTarget.host,
          port: authTarget.port,
          username: authTarget.username,
          purpose: 'password',
          authScope: scope,
          ...(rememberableAssetId(authTarget) ? { assetId: rememberableAssetId(authTarget), canRememberPassword: true } : {}),
          ...(authTarget.title ? { title: authTarget.title } : {}),
          name: 'SSH password',
          instructions: requestInput.rejected
            ? 'The saved SSH password was rejected. Enter a new password to retry this connection.'
            : 'Enter the SSH password to continue this connection.',
          prompts: createPasswordPrompt(authTarget),
          attempts: attempt,
          maxAttempts: requestInput.rejected ? 2 : 1,
          timeoutMs: keyboardInteractiveTimeoutMs()
        })
      )
      const password = String(response.responses[0] || '')
      if (!password) throw new Error(`SSH password is required for ${terminalAuthLabel(authTarget)}.`)
      authTarget.password = password
      rememberPasswordWhenReady(scope, authTarget, password, response.rememberPassword)
      input.sink.keyboardInteractiveResult?.({ id: requestId, authScope: scope, status: 'success', attempts: attempt, final: true })
    } catch (error) {
      const isTimeout = error instanceof Error && /timed out|timeout/i.test(error.message)
      const isCancel = error instanceof Error && /cancel/i.test(error.message)
      input.sink.keyboardInteractiveResult?.({
        id: requestId,
        authScope: scope,
        status: isTimeout ? 'timeout' : isCancel ? 'canceled' : 'failed',
        attempts: attempt,
        final: true,
        errorMessage: error instanceof Error ? error.message : 'SSH password prompt failed.'
      })
      throw error
    }
  }

  return {
    attachKeyboardInteractive,
    commitRememberedPassword,
    requestPassword,
    sendActiveKeyboardResult
  }
}
