import { describe, expect, it, vi } from 'vitest'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

describe('Product session native binding lifecycle', () => {
  it('permanently deletes a native session that binds after product deletion starts', async () => {
    const modulePath = '../src/main/backend/agent/productSessionBindingLifecycle'
    const { bindProductSessionNativeBinding } = await import(modulePath)
    const registry = {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
    const stopClosedNativeSession = vi.fn()
    const deleteDeletingNativeSession = vi.fn(async () => undefined)

    await expect(bindProductSessionNativeBinding({
      registry,
      createInput: { id: 'codex-deleting', surface: 'codex' },
      updateInput: { id: 'codex-deleting' },
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'codex-thread-late',
        profile: 'embedded-tui'
      },
      stopClosedNativeSession,
      isProductSessionDeleting: () => true,
      deleteDeletingNativeSession,
      failureEvent: 'product-session.codex-bind-failed'
    })).resolves.toEqual({ status: 'closed' })

    expect(deleteDeletingNativeSession).toHaveBeenCalledTimes(1)
    expect(stopClosedNativeSession).not.toHaveBeenCalled()
    expect(registry.get).not.toHaveBeenCalled()
    expect(registry.create).not.toHaveBeenCalled()
    expect(registry.update).not.toHaveBeenCalled()
  })

  it('does not stop an open Codex runtime when no replacement cleanup callback was provided', async () => {
    const modulePath = '../src/main/backend/agent/productSessionBindingLifecycle'
    const { bindProductSessionNativeBinding } = await import(modulePath)
    const existing: ProductSessionRecord = {
      id: 'codex-product-1',
      surface: 'codex',
      title: 'Codex',
      isOpen: true,
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'codex-thread-old',
        profile: 'embedded-tui'
      },
      createdAt: 1,
      updatedAt: 2
    }
    const registry = {
      get: vi.fn(() => existing),
      create: vi.fn(),
      update: vi.fn((input) => ({ ...existing, ...input }))
    }
    const stopClosedNativeSession = vi.fn()

    const result = await bindProductSessionNativeBinding({
      registry,
      createInput: { id: existing.id, surface: 'codex' },
      updateInput: { id: existing.id },
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'codex-thread-new',
        profile: 'embedded-tui'
      },
      stopClosedNativeSession,
      failureEvent: 'product-session.codex-bind-failed'
    })

    expect(registry.update).toHaveBeenCalled()
    expect(stopClosedNativeSession).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'bound' })
  })

  it('reports a failed binding when an open product row cannot be updated', async () => {
    const modulePath = '../src/main/backend/agent/productSessionBindingLifecycle'
    const { bindProductSessionNativeBinding } = await import(modulePath)
    const existing: ProductSessionRecord = {
      id: 'codex-product-conflict',
      surface: 'codex',
      title: 'Codex',
      isOpen: true,
      createdAt: 1,
      updatedAt: 2
    }
    const registry = {
      get: vi.fn(() => existing),
      create: vi.fn(),
      update: vi.fn(() => {
        throw new Error('native binding conflict')
      })
    }
    const stopFailedNativeSession = vi.fn()

    await expect(bindProductSessionNativeBinding({
      registry,
      createInput: { id: existing.id, surface: 'codex' },
      updateInput: { id: existing.id },
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'codex-thread-conflict',
        profile: 'embedded-tui'
      },
      stopClosedNativeSession: vi.fn(),
      stopFailedNativeSession,
      failureEvent: 'product-session.codex-bind-failed'
    })).resolves.toEqual({ status: 'failed', errorMessage: 'native binding conflict' })

    expect(stopFailedNativeSession).toHaveBeenCalledTimes(1)
  })

  it('stops a native runtime when a new product row cannot be created', async () => {
    const modulePath = '../src/main/backend/agent/productSessionBindingLifecycle'
    const { bindProductSessionNativeBinding } = await import(modulePath)
    const stopFailedNativeSession = vi.fn(async () => undefined)
    const logFailure = vi.fn()
    const registry = {
      get: vi.fn(() => null),
      create: vi.fn(() => {
        throw new Error('registry create failed')
      }),
      update: vi.fn()
    }

    await expect(bindProductSessionNativeBinding({
      registry,
      createInput: { id: 'database-product-create-failed', surface: 'database' },
      updateInput: { id: 'database-product-create-failed' },
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'cline-database-unindexed',
        profile: 'database'
      },
      stopClosedNativeSession: vi.fn(),
      stopFailedNativeSession,
      failureEvent: 'product-session.database-bind-failed',
      stopFailureEvent: 'product-session.database-stop-failed',
      logFailure
    })).resolves.toEqual({ status: 'failed', errorMessage: 'registry create failed' })

    expect(stopFailedNativeSession).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledWith(
      'product-session.database-bind-failed',
      expect.objectContaining({
        productSessionId: 'database-product-create-failed',
        nativeSessionId: 'cline-database-unindexed',
        errorMessage: 'registry create failed'
      })
    )
  })
})
