import type { ProductSessionRegistry } from './productSessionRegistry'
import type {
  ProductSessionCreateInput,
  ProductSessionNativeBinding,
  ProductSessionUpdateInput
} from '@shared/contracts/productSessions'

type ProductSessionBindingRegistry = Pick<ProductSessionRegistry, 'create' | 'get' | 'update'>

type ProductSessionBindingLifecycleInput = {
  registry: ProductSessionBindingRegistry
  createInput: Omit<ProductSessionCreateInput, 'isOpen' | 'nativeBinding'>
  updateInput: Omit<ProductSessionUpdateInput, 'isOpen' | 'nativeBinding'>
  nativeBinding: ProductSessionNativeBinding
  stopClosedNativeSession: () => Promise<void> | void
  stopFailedNativeSession?: () => Promise<void> | void
  stopReplacedNativeSession?: (binding: ProductSessionNativeBinding) => Promise<void> | void
  isProductSessionDeleting?: () => boolean
  deleteDeletingNativeSession?: () => Promise<unknown> | unknown
  failureEvent: string
  stopFailureEvent?: string
  failureFields?: Record<string, unknown>
  logFailure?: (event: string, fields: Record<string, unknown>) => void
}

export type ProductSessionNativeBindingResult =
  | { status: 'bound' }
  | { status: 'closed' }
  | { status: 'failed'; errorMessage: string }

const sameNativeSession = (left: ProductSessionNativeBinding, right: ProductSessionNativeBinding) =>
  left.engine === right.engine && left.nativeSessionId === right.nativeSessionId

export const bindProductSessionNativeBinding = async (
  input: ProductSessionBindingLifecycleInput
): Promise<ProductSessionNativeBindingResult> => {
  const productSessionId = String(input.updateInput.id || input.createInput.id || '').trim()
  if (!productSessionId) return { status: 'failed', errorMessage: 'Product session id is required.' } satisfies ProductSessionNativeBindingResult

  const emitFailure = (event: string, fields: Record<string, unknown>) => {
    try {
      input.logFailure?.(event, fields)
    } catch {
      // Runtime cleanup must not depend on the logging adapter.
    }
  }
  const logBindingFailure = (error: unknown) => {
    emitFailure(input.failureEvent, {
      productSessionId,
      nativeSessionId: input.nativeBinding.nativeSessionId,
      ...(input.failureFields || {}),
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    return {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error)
    } satisfies ProductSessionNativeBindingResult
  }
  const stopNativeSession = async (
    binding: ProductSessionNativeBinding,
    stopReason: 'binding-failed' | 'closed-late-binding' | 'permanent-delete-late-binding' | 'replaced-binding',
    stop: () => Promise<unknown> | unknown
  ): Promise<{ ok: true } | { ok: false; errorMessage: string }> => {
    try {
      await stop()
      return { ok: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      emitFailure(input.stopFailureEvent || input.failureEvent, {
        productSessionId,
        nativeSessionId: binding.nativeSessionId,
        nativeEngine: binding.engine,
        stopReason,
        ...(stopReason === 'replaced-binding'
          ? { replacementNativeSessionId: input.nativeBinding.nativeSessionId }
          : {}),
        ...(input.failureFields || {}),
        errorMessage
      })
      return { ok: false, errorMessage }
    }
  }
  const failBinding = async (error: unknown) => {
    const failure = logBindingFailure(error)
    if (input.stopFailedNativeSession) {
      await stopNativeSession(input.nativeBinding, 'binding-failed', input.stopFailedNativeSession)
    }
    return failure
  }

  if (input.isProductSessionDeleting?.()) {
    const stopped = await stopNativeSession(
      input.nativeBinding,
      'permanent-delete-late-binding',
      input.deleteDeletingNativeSession || input.stopClosedNativeSession
    )
    return stopped.ok
      ? { status: 'closed' }
      : { status: 'failed', errorMessage: stopped.errorMessage }
  }

  let existing
  try {
    existing = input.registry.get(productSessionId)
  } catch (error) {
    return failBinding(error)
  }

  if (existing) {
    if (!existing.isOpen) {
      try {
        const updated = input.registry.update({
          ...input.updateInput,
          id: productSessionId,
          isOpen: false,
          nativeBinding: input.nativeBinding
        })
        if (!updated) throw new Error('Product session disappeared while its native binding was being updated.')
      } catch (error) {
        logBindingFailure(error)
      }
      const stopped = await stopNativeSession(input.nativeBinding, 'closed-late-binding', input.stopClosedNativeSession)
      return stopped.ok
        ? { status: 'closed' }
        : { status: 'failed', errorMessage: stopped.errorMessage }
    }

    try {
      const updated = input.registry.update({
        ...input.updateInput,
        id: productSessionId,
        isOpen: true,
        nativeBinding: input.nativeBinding
      })
      if (!updated) throw new Error('Product session disappeared while its native binding was being updated.')
    } catch (error) {
      return failBinding(error)
    }
    const replacedBinding = existing.nativeBinding
    if (replacedBinding && !sameNativeSession(replacedBinding, input.nativeBinding) && input.stopReplacedNativeSession) {
      await stopNativeSession(
        replacedBinding,
        'replaced-binding',
        () => input.stopReplacedNativeSession?.(replacedBinding)
      )
    }
    return { status: 'bound' }
  }

  try {
    input.registry.create({
      ...input.createInput,
      id: productSessionId,
      isOpen: true,
      nativeBinding: input.nativeBinding
    })
  } catch (error) {
    return failBinding(error)
  }
  return { status: 'bound' }
}
