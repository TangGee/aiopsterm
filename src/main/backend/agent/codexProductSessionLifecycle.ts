import { bindProductSessionNativeBinding, type ProductSessionNativeBindingResult } from './productSessionBindingLifecycle'
import type { ProductSessionRegistry } from './productSessionRegistry'
import type {
  CodexSessionCreateOptions,
  CodexSessionKillResult,
  CodexSessionThreadEvent
} from '@shared/contracts/codexSessions'
import type { ProductSessionRecord, ProductSessionTarget } from '@shared/contracts/productSessions'

type CodexProductSessionRegistry = Pick<ProductSessionRegistry, 'create' | 'get' | 'update'>

type CodexProductSessionLaunchRegistry = Pick<ProductSessionRegistry, 'get' | 'update'>

type PrepareCodexProductSessionLaunchInput = {
  registry: CodexProductSessionLaunchRegistry
  options: CodexSessionCreateOptions
  findSavedSessionRolloutPath: (threadId: string) => Promise<string | null>
}

export type CodexProductSessionLaunchPreparation = {
  options: CodexSessionCreateOptions
  recoveredFromThreadId?: string
}

type BindCodexProductSessionThreadInput = {
  registry: CodexProductSessionRegistry
  productSessionId: string
  event: CodexSessionThreadEvent
  options: CodexSessionCreateOptions
  stopRuntime: (runtimeId: string) => CodexSessionKillResult
  clearRuntimeTarget: (runtimeId: string) => void
  deleteNativeSession?: (threadId: string) => Promise<unknown> | unknown
  isProductSessionDeleting?: (productSessionId: string) => boolean
  logFailure?: (event: string, fields: Record<string, unknown>) => void
}

const launchTargetFromOptions = (options: CodexSessionCreateOptions): ProductSessionTarget | undefined => {
  const target = options.target
  if (!target) return undefined
  return {
    kind: target.kind || 'unknown',
    ...(target.panelId ? { panelId: target.panelId } : {}),
    ...(target.sessionId ? { terminalSessionId: target.sessionId } : {}),
    ...(target.assetId ? { assetId: target.assetId } : {}),
    ...(target.connectionId ? { connectionId: target.connectionId } : {}),
    ...(target.host ? { host: target.host } : {}),
    ...(target.port ? { port: target.port } : {}),
    ...(target.username ? { username: target.username } : {}),
    ...(target.assetName ? { assetName: target.assetName } : {}),
    ...(target.label ? { label: target.label } : {})
  }
}

const currentProductContext = (
  storedSession: ProductSessionRecord | null,
  options: CodexSessionCreateOptions
) => {
  const target = storedSession?.target || launchTargetFromOptions(options)
  const projectRoot = storedSession?.projectRoot || String(options.projectRoot || options.target?.cwd || '').trim() || undefined
  const lastKnownCwd = storedSession?.lastKnownCwd || options.target?.cwd
  return {
    target,
    projectRoot,
    lastKnownCwd,
    scopeKey: [
      'embedded-tui',
      projectRoot || '',
      target?.kind || '',
      target?.assetId || '',
      target?.connectionId || '',
      target?.host || ''
    ].join('\0')
  }
}

const codexLaunchRecoveryError = (message: string, cause?: unknown) => {
  const error = Object.assign(new Error(message), { code: 'CODEX_PRODUCT_SESSION_RECOVERY_FAILED' })
  if (cause !== undefined) Object.assign(error, { cause })
  return error
}

export const prepareCodexProductSessionLaunch = async (
  input: PrepareCodexProductSessionLaunchInput
): Promise<CodexProductSessionLaunchPreparation> => {
  const launch = input.options.launch || { mode: 'new' as const }
  if (launch.mode === 'new') return { options: input.options }

  const threadId = String(launch.threadId || '').trim()
  if (!threadId) return { options: input.options }
  const productSessionId = String(input.options.productSessionId || '').trim()
  let session: ProductSessionRecord | null = null
  if (productSessionId) {
    try {
      session = input.registry.get(productSessionId)
    } catch (error) {
      throw codexLaunchRecoveryError('Codex session recovery could not read the product session.', error)
    }
    const binding = session?.nativeBinding
    if (binding && (binding.engine !== 'codex' || binding.nativeSessionId !== threadId)) {
      throw codexLaunchRecoveryError('Codex session recovery stopped because the native binding changed.')
    }
  }

  if (await input.findSavedSessionRolloutPath(threadId)) return { options: input.options }

  if (productSessionId) {
    try {
      session = input.registry.get(productSessionId)
    } catch (error) {
      throw codexLaunchRecoveryError('Codex session recovery could not revalidate the product session.', error)
    }
    const binding = session?.nativeBinding
    if (binding && (binding.engine !== 'codex' || binding.nativeSessionId !== threadId)) {
      throw codexLaunchRecoveryError('Codex session recovery stopped because the native binding changed.')
    }
    if (binding) {
      let updated: ProductSessionRecord | null
      try {
        updated = input.registry.update({ id: productSessionId, nativeBinding: null })
      } catch (error) {
        throw codexLaunchRecoveryError('Codex session recovery could not clear the missing native binding.', error)
      }
      if (!updated || updated.id !== productSessionId || updated.nativeBinding) {
        throw codexLaunchRecoveryError('Codex session recovery returned an invalid product session state.')
      }
    }
  }

  return {
    options: {
      ...input.options,
      launch: { mode: 'new' }
    },
    recoveredFromThreadId: threadId
  }
}

export const bindCodexProductSessionThread = async (
  input: BindCodexProductSessionThreadInput
): Promise<ProductSessionNativeBindingResult> => {
  let storedSession: ProductSessionRecord | null = null
  try {
    storedSession = input.registry.get(input.productSessionId)
  } catch {
    // The authoritative binding read below reports the failure.
  }
  const context = currentProductContext(storedSession, input.options)
  const expectedPreviousThreadId = input.event.previousThreadId
  const guardedRegistry: CodexProductSessionRegistry = {
    get: (id) => {
      const session = input.registry.get(id)
      if (id !== input.productSessionId || expectedPreviousThreadId === undefined) return session
      const binding = session?.nativeBinding
      const actualThreadId = binding?.engine === 'codex' ? binding.nativeSessionId : null
      if (actualThreadId !== expectedPreviousThreadId) {
        throw new Error(
          `Codex product session binding changed before thread publication: expected ${expectedPreviousThreadId || 'none'}, found ${actualThreadId || 'none'}.`
        )
      }
      return session
    },
    create: (createInput) => input.registry.create(createInput),
    update: (updateInput) => input.registry.update(updateInput)
  }
  const stopRuntime = () => {
    const stopped = input.stopRuntime(input.event.id)
    if (!stopped.ok) throw new Error(stopped.errorMessage || 'Codex runtime could not be stopped.')
  }
  const bindingResult = await bindProductSessionNativeBinding({
    registry: guardedRegistry,
    createInput: {
      id: input.productSessionId,
      surface: 'codex',
      title: input.event.title || 'Codex CLI',
      ...(context.projectRoot ? { projectRoot: context.projectRoot } : {}),
      ...(context.lastKnownCwd ? { lastKnownCwd: context.lastKnownCwd } : {}),
      ...(context.target ? { target: context.target } : {})
    },
    updateInput: {
      id: input.productSessionId,
      ...(input.event.title ? { title: input.event.title } : {})
    },
    nativeBinding: {
      engine: 'codex',
      nativeSessionId: input.event.threadId,
      profile: 'embedded-tui',
      scopeKey: context.scopeKey
    },
    stopClosedNativeSession: stopRuntime,
    isProductSessionDeleting: () => Boolean(input.isProductSessionDeleting?.(input.productSessionId)),
    deleteDeletingNativeSession: input.deleteNativeSession
      ? () => input.deleteNativeSession?.(input.event.threadId)
      : undefined,
    failureEvent: 'product-session.codex-bind-failed',
    stopFailureEvent: 'product-session.codex-stop-failed',
    failureFields: { threadId: input.event.threadId, codexRuntimeId: input.event.id },
    logFailure: input.logFailure
  })
  if (bindingResult.status !== 'failed') return bindingResult

  input.clearRuntimeTarget(input.event.id)
  const stopped = input.stopRuntime(input.event.id)
  if (!stopped.ok) {
    input.logFailure?.('product-session.codex-bind-cleanup-failed', {
      productSessionId: input.productSessionId,
      threadId: input.event.threadId,
      codexRuntimeId: input.event.id,
      errorCode: stopped.errorCode,
      errorMessage: stopped.errorMessage
    })
  }
  return bindingResult
}
