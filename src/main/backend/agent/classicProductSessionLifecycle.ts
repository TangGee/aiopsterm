import type { ProductSessionRegistry } from './productSessionRegistry'
import { bindProductSessionNativeBinding } from './productSessionBindingLifecycle'
import type { AiChatResponseInput, AiChatResponseResult } from '@shared/contracts/aiChat'

type ClassicProductSessionLifecycleInput = {
  registry: Pick<ProductSessionRegistry, 'create' | 'get' | 'update'>
  request: AiChatResponseInput
  result: AiChatResponseResult
  stopNativeSession: (nativeSessionId: string) => Promise<void> | void
  deleteNativeSession?: (nativeSessionId: string) => Promise<unknown> | unknown
  isProductSessionDeleting?: (productSessionId: string) => boolean
  logFailure?: (event: string, fields: Record<string, unknown>) => void
}

export const bindClassicProductSessionResponse = async (input: ClassicProductSessionLifecycleInput) => {
  const productSessionId = String(input.request.conversationId || '').trim()
  const binding = input.result.ok && input.result.data?.nativeSessionId
    ? {
        engine: 'cline',
        nativeSessionId: input.result.data.nativeSessionId,
        ...(input.result.data.nativeProfile ? { profile: input.result.data.nativeProfile } : {}),
        ...(input.result.data.nativeScopeKey ? { scopeKey: input.result.data.nativeScopeKey } : {})
      }
    : null
  if (!productSessionId || !binding) return

  const context = input.request.productContext || {}
  await bindProductSessionNativeBinding({
    registry: input.registry,
    createInput: { id: productSessionId, surface: 'classic', ...context },
    updateInput: { id: productSessionId, ...context },
    nativeBinding: binding,
    stopClosedNativeSession: () => input.stopNativeSession(binding.nativeSessionId),
    stopFailedNativeSession: () => input.stopNativeSession(binding.nativeSessionId),
    stopReplacedNativeSession: (replacedBinding) => {
      if (replacedBinding.engine === 'cline') return input.stopNativeSession(replacedBinding.nativeSessionId)
    },
    isProductSessionDeleting: () => Boolean(input.isProductSessionDeleting?.(productSessionId)),
    deleteDeletingNativeSession: input.deleteNativeSession
      ? () => input.deleteNativeSession?.(binding.nativeSessionId)
      : undefined,
    failureEvent: 'product-session.classic-bind-failed',
    stopFailureEvent: 'product-session.classic-stop-failed',
    logFailure: input.logFailure
  })
}
