import type { ProductSessionNativeBinding, ProductSessionRecord } from '@shared/contracts/productSessions'
import { ProductSessionRegistryError, type ProductSessionRegistry } from './productSessionRegistry'

type ProductSessionDeletionRegistry = Pick<ProductSessionRegistry, 'get' | 'delete'> &
  Partial<Pick<ProductSessionRegistry, 'deleteIfUnchanged'>>

export type ProductSessionPermanentDeleteOutcome = {
  id: string
  deleted: boolean
}

export type ProductSessionNativeDelete = (
  binding: ProductSessionNativeBinding
) => Promise<boolean | void> | boolean | void

export type ProductSessionProjectionDelete = (
  session: ProductSessionRecord
) => Promise<boolean | void> | boolean | void

export type ProductSessionRuntimeStop = (
  session: ProductSessionRecord
) => Promise<boolean | void> | boolean | void

export type ProductSessionPermanentDelete = {
  (id: string): Promise<ProductSessionPermanentDeleteOutcome>
  isDeleting(id: string): boolean
  blocksBinding(id: string): boolean
  registerLateCleanup(id: string, cleanup: () => Promise<unknown> | unknown): Promise<unknown>
}

type ProductSessionLateCleanup = {
  run: () => Promise<unknown> | unknown
  pending: Promise<unknown> | null
  completed: boolean
}

const sameBinding = (
  left: ProductSessionNativeBinding | undefined,
  right: ProductSessionNativeBinding | undefined
) => left?.engine === right?.engine &&
  left?.nativeSessionId === right?.nativeSessionId &&
  left?.profile === right?.profile &&
  left?.scopeKey === right?.scopeKey

const unchangedSince = (current: ProductSessionRecord, snapshot: ProductSessionRecord) =>
  current.updatedAt === snapshot.updatedAt && sameBinding(current.nativeBinding, snapshot.nativeBinding)

export const createProductSessionPermanentDelete = (input: {
  registry: ProductSessionDeletionRegistry
  stopRuntime?: ProductSessionRuntimeStop
  deleteNativeBinding?: ProductSessionNativeDelete
  deleteProjection?: ProductSessionProjectionDelete
}) => {
  const inFlight = new Map<string, Promise<ProductSessionPermanentDeleteOutcome>>()
  const lateCleanups = new Map<string, Set<ProductSessionLateCleanup>>()
  const deletedIds = new Set<string>()

  const runLateCleanup = (cleanup: ProductSessionLateCleanup) => {
    if (cleanup.completed) return Promise.resolve()
    if (cleanup.pending) return cleanup.pending
    const pending = Promise.resolve()
      .then(cleanup.run)
      .then((result) => {
        cleanup.completed = true
        return result
      })
    cleanup.pending = pending
    return pending
  }

  const registerLateCleanup = (idInput: string, cleanup: () => Promise<unknown> | unknown) => {
    const id = String(idInput)
    const task: ProductSessionLateCleanup = { run: cleanup, pending: null, completed: false }
    if (inFlight.has(id) || deletedIds.has(id)) {
      const cleanups = lateCleanups.get(id) || new Set<ProductSessionLateCleanup>()
      cleanups.add(task)
      lateCleanups.set(id, cleanups)
    }
    return runLateCleanup(task)
  }

  const drainLateCleanups = async (id: string) => {
    const consumed = new Set<ProductSessionLateCleanup>()
    while (true) {
      const cleanups = [...(lateCleanups.get(id) || [])]
        .filter((cleanup) => !cleanup.completed && !consumed.has(cleanup))
      if (!cleanups.length) return
      cleanups.forEach((cleanup) => consumed.add(cleanup))
      await Promise.all(cleanups.map(runLateCleanup))
    }
  }

  const permanentlyDelete = ((idInput: string): Promise<ProductSessionPermanentDeleteOutcome> => {
    const id = String(idInput)
    const existingDelete = inFlight.get(id)
    if (existingDelete) return existingDelete
    for (const cleanup of lateCleanups.get(id) || []) {
      if (!cleanup.completed) cleanup.pending = null
    }

    let pending: Promise<ProductSessionPermanentDeleteOutcome>
    let completed = false
    pending = (async () => {
      const snapshot = input.registry.get(id)
      if (!snapshot) {
        await drainLateCleanups(id)
        completed = true
        return { id, deleted: false }
      }
      await input.stopRuntime?.({ ...snapshot })
      await drainLateCleanups(id)
      if (snapshot.nativeBinding && input.deleteNativeBinding) {
        await input.deleteNativeBinding({ ...snapshot.nativeBinding })
      }
      await drainLateCleanups(id)
      const current = input.registry.get(id)
      if (!current) return { id, deleted: false }
      if (!unchangedSince(current, snapshot)) {
        throw new ProductSessionRegistryError(
          'PRODUCT_SESSION_DELETE_CONFLICT',
          'Product session changed while its native session was being deleted.'
        )
      }
      await input.deleteProjection?.({ ...snapshot })
      await drainLateCleanups(id)
      const deleted = input.registry.deleteIfUnchanged
        ? input.registry.deleteIfUnchanged(id, snapshot.updatedAt)
        : (() => {
            const final = input.registry.get(id)
            if (!final || !unchangedSince(final, snapshot)) return false
            return input.registry.delete(id)
          })()
      if (!deleted) {
        const final = input.registry.get(id)
        if (final) {
          throw new ProductSessionRegistryError(
            'PRODUCT_SESSION_DELETE_CONFLICT',
            'Product session changed while its projection was being deleted.'
          )
        }
        return { id, deleted: false }
      }
      deletedIds.add(id)
      completed = true
      return { id, deleted: true }
    })().finally(() => {
      if (inFlight.get(id) === pending) inFlight.delete(id)
      if (completed) {
        lateCleanups.delete(id)
      } else {
        const retained = lateCleanups.get(id)
        if (retained) {
          for (const cleanup of retained) {
            if (cleanup.completed) retained.delete(cleanup)
          }
          if (!retained.size) lateCleanups.delete(id)
        }
      }
    })
    inFlight.set(id, pending)
    return pending
  }) as ProductSessionPermanentDelete
  permanentlyDelete.isDeleting = (id: string) => inFlight.has(String(id))
  permanentlyDelete.blocksBinding = (id: string) => {
    const normalized = String(id)
    return inFlight.has(normalized) || lateCleanups.has(normalized) || deletedIds.has(normalized)
  }
  permanentlyDelete.registerLateCleanup = registerLateCleanup
  return permanentlyDelete
}
