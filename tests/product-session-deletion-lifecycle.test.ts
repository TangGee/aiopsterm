import { describe, expect, it, vi } from 'vitest'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

const loadLifecycle = async () => {
  const modulePath = '../src/main/backend/agent/productSessionDeletionLifecycle'
  return import(modulePath)
}

const record = (patch: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'product-1',
  surface: 'classic',
  title: 'Session',
  isOpen: false,
  createdAt: 1,
  updatedAt: 2,
  ...patch
})

describe('product session permanent deletion lifecycle', () => {
  it('coalesces concurrent permanent deletes and removes metadata only after native deletion', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    let current: ProductSessionRecord | null = record({
      nativeBinding: { engine: 'cline', nativeSessionId: 'cline-native-1', profile: 'classic-chat' }
    })
    let releaseNative!: () => void
    const deleteNativeBinding = vi.fn(() => new Promise<void>((resolve) => {
      releaseNative = resolve
    }))
    const stopRuntime = vi.fn(async () => true)
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => {
        current = null
        return true
      })
    }
    const deleteProjection = vi.fn(async () => undefined)
    const permanentlyDelete = createProductSessionPermanentDelete({ registry, stopRuntime, deleteNativeBinding, deleteProjection })

    const first = permanentlyDelete('product-1')
    const second = permanentlyDelete('product-1')
    await vi.waitFor(() => expect(deleteNativeBinding).toHaveBeenCalledTimes(1))
    expect(first).toBe(second)
    expect(permanentlyDelete.isDeleting('product-1')).toBe(true)
    expect(permanentlyDelete.isDeleting('other-product')).toBe(false)
    expect(stopRuntime).toHaveBeenCalledWith(expect.objectContaining({ id: 'product-1' }))
    expect(deleteNativeBinding).toHaveBeenCalledWith({
      engine: 'cline',
      nativeSessionId: 'cline-native-1',
      profile: 'classic-chat'
    })
    expect(registry.delete).not.toHaveBeenCalled()
    expect(deleteProjection).not.toHaveBeenCalled()

    releaseNative()
    await expect(first).resolves.toEqual({ id: 'product-1', deleted: true })
    await expect(second).resolves.toEqual({ id: 'product-1', deleted: true })
    expect(permanentlyDelete.isDeleting('product-1')).toBe(false)
    expect(deleteProjection).toHaveBeenCalledWith(expect.objectContaining({ id: 'product-1', surface: 'classic' }))
    expect(registry.delete).toHaveBeenCalledTimes(1)
  })

  it('is idempotent when product metadata or native data is already absent', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    const deleteNativeBinding = vi.fn(async () => false)
    const missingRegistry = { get: vi.fn(() => null), delete: vi.fn(() => false) }
    const deleteMissing = createProductSessionPermanentDelete({ registry: missingRegistry, deleteNativeBinding })
    await expect(deleteMissing('missing')).resolves.toEqual({ id: 'missing', deleted: false })
    expect(deleteNativeBinding).not.toHaveBeenCalled()

    let current: ProductSessionRecord | null = record({ nativeBinding: { engine: 'codex', nativeSessionId: 'thread-1' } })
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => {
        current = null
        return true
      })
    }
    const permanentlyDelete = createProductSessionPermanentDelete({ registry, deleteNativeBinding })
    await expect(permanentlyDelete('product-1')).resolves.toEqual({ id: 'product-1', deleted: true })
    expect(deleteNativeBinding).toHaveBeenCalledTimes(1)
  })

  it('preserves a product session that changes while native deletion is pending', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    let current = record({ nativeBinding: { engine: 'cline', nativeSessionId: 'cline-native-1' } })
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => true)
    }
    const permanentlyDelete = createProductSessionPermanentDelete({
      registry,
      deleteNativeBinding: async () => {
        current = { ...current, title: 'Renamed concurrently', updatedAt: current.updatedAt + 1 }
      }
    })

    await expect(permanentlyDelete('product-1')).rejects.toMatchObject({ code: 'PRODUCT_SESSION_DELETE_CONFLICT' })
    expect(registry.delete).not.toHaveBeenCalled()
  })

  it('keeps product metadata when native deletion fails', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    const current = record({ nativeBinding: { engine: 'cline', nativeSessionId: 'cline-native-1' } })
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => true)
    }
    const permanentlyDelete = createProductSessionPermanentDelete({
      registry,
      deleteNativeBinding: async () => {
        throw new Error('native delete failed')
      }
    })

    await expect(permanentlyDelete('product-1')).rejects.toThrow('native delete failed')
    expect(registry.delete).not.toHaveBeenCalled()
  })

  it('keeps product metadata when projection deletion fails', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    const current = record()
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => true)
    }
    const permanentlyDelete = createProductSessionPermanentDelete({
      registry,
      deleteProjection: async () => {
        throw new Error('projection delete failed')
      }
    })

    await expect(permanentlyDelete('product-1')).rejects.toThrow('projection delete failed')
    expect(registry.delete).not.toHaveBeenCalled()
  })

  it('detects a registry update that arrives while projection deletion is pending', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    let current = record()
    let releaseProjection!: () => void
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => true)
    }
    const permanentlyDelete = createProductSessionPermanentDelete({
      registry,
      deleteProjection: () => new Promise<void>((resolve) => {
        releaseProjection = resolve
      })
    })

    const deletion = permanentlyDelete(current.id)
    await vi.waitFor(() => expect(releaseProjection).toBeTypeOf('function'))
    current = { ...current, title: 'Updated during projection delete', updatedAt: current.updatedAt + 1 }
    releaseProjection()

    await expect(deletion).rejects.toMatchObject({ code: 'PRODUCT_SESSION_DELETE_CONFLICT' })
    expect(registry.delete).not.toHaveBeenCalled()
  })

  it('retains and retries a failed late native cleanup before deleting metadata', async () => {
    const { createProductSessionPermanentDelete } = await loadLifecycle()
    let current: ProductSessionRecord | null = record()
    let releaseStop!: () => void
    let stopAttempt = 0
    let cleanupShouldFail = true
    const cleanup = vi.fn(async () => {
      if (cleanupShouldFail) throw new Error('late native delete failed')
    })
    const registry = {
      get: vi.fn(() => current),
      delete: vi.fn(() => {
        current = null
        return true
      })
    }
    const permanentlyDelete = createProductSessionPermanentDelete({
      registry,
      stopRuntime: () => {
        stopAttempt += 1
        if (stopAttempt > 1) return true
        return new Promise<void>((resolve) => {
          releaseStop = resolve
        })
      }
    })

    const first = permanentlyDelete('product-1')
    await vi.waitFor(() => expect(permanentlyDelete.isDeleting('product-1')).toBe(true))
    await expect(permanentlyDelete.registerLateCleanup('product-1', cleanup)).rejects.toThrow('late native delete failed')
    releaseStop()
    await expect(first).rejects.toThrow('late native delete failed')
    expect(current).not.toBeNull()
    expect(registry.delete).not.toHaveBeenCalled()
    expect(permanentlyDelete.blocksBinding('product-1')).toBe(true)

    cleanupShouldFail = false
    await expect(permanentlyDelete('product-1')).resolves.toEqual({ id: 'product-1', deleted: true })
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(registry.delete).toHaveBeenCalledTimes(1)
  })
})
