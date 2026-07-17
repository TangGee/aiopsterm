import type { IpcMain } from 'electron'
import {
  ProductSessionRegistryError,
  type ProductSessionRegistry
} from '../backend/agent/productSessionRegistry'
import {
  createProductSessionPermanentDelete,
  type ProductSessionNativeDelete,
  type ProductSessionPermanentDeleteOutcome
} from '../backend/agent/productSessionDeletionLifecycle'
import type {
  ProductSessionChangeEvent,
  ProductSessionCreateInput,
  ProductSessionListInput,
  ProductSessionProjectionMessageInput,
  ProductSessionProjectionPageInput,
  ProductSessionProjectionRevisionInput,
  ProductSessionUpdateInput
} from '@shared/contracts/productSessions'

type RegisterProductSessionsIpcInput = {
  registry: ProductSessionRegistry
  stopNativeBinding?: (engine: string, nativeSessionId: string) => Promise<boolean | void> | boolean | void
  deleteNativeBinding?: ProductSessionNativeDelete
  permanentlyDelete?: (id: string) => Promise<ProductSessionPermanentDeleteOutcome>
  isMutationBlocked?: (id: string) => boolean
  broadcastChange?: (event: ProductSessionChangeEvent) => void
}

const failure = (error: unknown) => ({
  ok: false as const,
  errorCode: error instanceof ProductSessionRegistryError ? error.code : 'PRODUCT_SESSION_OPERATION_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error || 'Product session operation failed.')
})

export const registerProductSessionsIpc = (ipcMain: IpcMain, input: RegisterProductSessionsIpcInput) => {
  const permanentlyDelete = input.permanentlyDelete || createProductSessionPermanentDelete({
    registry: input.registry,
    deleteNativeBinding: input.deleteNativeBinding
  })
  if (input.broadcastChange) input.registry.subscribe(input.broadcastChange)
  const mutationBlocked = (id: unknown) => Boolean(id && input.isMutationBlocked?.(String(id)))
  const deletionInProgress = () => failure(new ProductSessionRegistryError(
    'PRODUCT_SESSION_DELETE_IN_PROGRESS',
    'Product session mutation is blocked because permanent deletion is in progress.'
  ))

  ipcMain.handle('product-session:list', (_event, listInput?: ProductSessionListInput) => {
    try {
      return { ok: true as const, data: { sessions: input.registry.list(listInput) } }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle('product-session:get', (_event, id: string) => {
    try {
      return { ok: true as const, data: { session: input.registry.get(id) } }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    'product-session:projection:list',
    (_event, id: string, pageInput?: ProductSessionProjectionPageInput) => {
      try {
        return { ok: true as const, data: input.registry.listProjectionMessages(id, pageInput) }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    'product-session:projection:replace',
    (_event, id: string, messages: ProductSessionProjectionMessageInput[]) => {
      try {
        if (mutationBlocked(id)) return deletionInProgress()
        if (input.registry.listProjectionMessages(id, { limit: 1 }).totalMessages > 0) {
          return failure(new ProductSessionRegistryError(
            'PRODUCT_SESSION_PROJECTION_REPLACE_DENIED',
            'A non-empty Product Session projection must be changed through atomic revision or bounded upsert.'
          ))
        }
        return { ok: true as const, data: { count: input.registry.replaceProjectionMessages(id, messages) } }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    'product-session:projection:upsert',
    (_event, id: string, messages: ProductSessionProjectionMessageInput[]) => {
      try {
        if (mutationBlocked(id)) return deletionInProgress()
        return { ok: true as const, data: { count: input.registry.upsertProjectionMessages(id, messages) } }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(
    'product-session:projection:revise',
    (_event, id: string, revisionInput: ProductSessionProjectionRevisionInput) => {
      try {
        if (mutationBlocked(id)) return deletionInProgress()
        return { ok: true as const, data: input.registry.reviseProjectionMessages(id, revisionInput) }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle('product-session:create', (_event, createInput: ProductSessionCreateInput) => {
    try {
      if (mutationBlocked(createInput?.id)) return deletionInProgress()
      return { ok: true as const, data: { session: input.registry.create(createInput) } }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle('product-session:update', (_event, updateInput: ProductSessionUpdateInput) => {
    try {
      if (mutationBlocked(updateInput?.id)) return deletionInProgress()
      const session = input.registry.update(updateInput)
      if (!session) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_NOT_FOUND',
          errorMessage: 'Product session was not found.'
        }
      }
      return { ok: true as const, data: { session } }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle('product-session:delete', async (_event, id: string) => {
    try {
      return { ok: true as const, data: await permanentlyDelete(id) }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle('product-session:close', async (_event, id: string) => {
    try {
      if (mutationBlocked(id)) return deletionInProgress()
      const existing = input.registry.get(id)
      if (!existing) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_NOT_FOUND',
          errorMessage: 'Product session was not found.'
        }
      }
      const binding = existing.nativeBinding
      const closed = input.registry.update({ id, isOpen: false })
      if (!closed) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_NOT_FOUND',
          errorMessage: 'Product session was not found.'
        }
      }
      let stopped = false
      if (binding && input.stopNativeBinding) {
        try {
          stopped = (await input.stopNativeBinding(binding.engine, binding.nativeSessionId)) !== false
        } catch (error) {
          try {
            input.registry.update({ id, isOpen: true })
          } catch (rollbackError) {
            const failureResult = failure(error)
            return {
              ...failureResult,
              errorMessage: `${failureResult.errorMessage} Product session rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
            }
          }
          return failure(error)
        }
      }
      return { ok: true as const, data: { id, stopped } }
    } catch (error) {
      return failure(error)
    }
  })
}
