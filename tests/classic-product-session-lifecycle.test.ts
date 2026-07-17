import { describe, expect, it, vi } from 'vitest'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

const existingSession = (isOpen: boolean): ProductSessionRecord => ({
  id: 'classic-closed',
  surface: 'classic',
  title: 'Closed session',
  isOpen,
  nativeBinding: {
    engine: 'cline',
    nativeSessionId: 'cline-native-old',
    profile: 'classic-agent'
  },
  createdAt: 1,
  updatedAt: 2
})

describe('Classic product session lifecycle', () => {
  it('does not register a native binding before a Cline turn succeeds', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const registry = {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
    const stopNativeSession = vi.fn()

    await bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'request-failed', conversationId: 'classic-failed', prompt: 'inspect' },
      result: {
        ok: false,
        errorCode: 'AI_CHAT_CLINE_FAILED',
        errorMessage: 'Cline turn failed before persistence.'
      },
      stopNativeSession
    })

    expect(registry.get).not.toHaveBeenCalled()
    expect(registry.create).not.toHaveBeenCalled()
    expect(registry.update).not.toHaveBeenCalled()
    expect(stopNativeSession).not.toHaveBeenCalled()
  })

  it('keeps a closed session closed, records the completed binding, and stops the late native runtime', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const current = existingSession(false)
    const registry = {
      get: vi.fn(() => current),
      create: vi.fn(),
      update: vi.fn((input) => ({ ...current, ...input }))
    }
    const stopNativeSession = vi.fn(async () => undefined)

    await bindClassicProductSessionResponse({
      registry,
      request: {
        requestId: 'request-1',
        conversationId: current.id,
        prompt: 'inspect',
        productContext: {
          projectRoot: '/srv/orders',
          lastKnownCwd: '/srv/orders/api'
        }
      },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId: 'cline-native-late',
          nativeProfile: 'classic-agent',
          nativeScopeKey: 'classic-scope'
        }
      },
      stopNativeSession
    })

    expect(registry.update).toHaveBeenCalledWith(expect.objectContaining({
      id: current.id,
      isOpen: false,
      projectRoot: '/srv/orders',
      lastKnownCwd: '/srv/orders/api',
      nativeBinding: {
        engine: 'cline',
        nativeSessionId: 'cline-native-late',
        profile: 'classic-agent',
        scopeKey: 'classic-scope'
      }
    }))
    expect(registry.create).not.toHaveBeenCalled()
    expect(stopNativeSession).toHaveBeenCalledWith('cline-native-late')
  })

  it('keeps an open session open and releases its replaced native runtime', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const current = existingSession(true)
    const registry = {
      get: vi.fn(() => current),
      create: vi.fn(),
      update: vi.fn((input) => ({ ...current, ...input }))
    }
    const stopNativeSession = vi.fn(async () => undefined)

    await bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'request-2', conversationId: current.id, prompt: 'inspect' },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId: 'cline-native-current'
        }
      },
      stopNativeSession
    })

    expect(registry.update).toHaveBeenCalledWith(expect.objectContaining({ id: current.id, isOpen: true }))
    expect(stopNativeSession).toHaveBeenCalledTimes(1)
    expect(stopNativeSession).toHaveBeenCalledWith('cline-native-old')
    expect(stopNativeSession).not.toHaveBeenCalledWith('cline-native-current')
  })

  it('does not stop an open session when the native identity did not change', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const current = existingSession(true)
    const registry = {
      get: vi.fn(() => current),
      create: vi.fn(),
      update: vi.fn((input) => ({ ...current, ...input }))
    }
    const stopNativeSession = vi.fn(async () => undefined)

    await bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'request-same', conversationId: current.id, prompt: 'inspect' },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId: 'cline-native-old',
          nativeProfile: 'classic-agent'
        }
      },
      stopNativeSession
    })

    expect(stopNativeSession).not.toHaveBeenCalled()
  })

  it('stops the completed native runtime when an open session binding cannot be stored', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const current = existingSession(true)
    const registry = {
      get: vi.fn(() => current),
      create: vi.fn(),
      update: vi.fn(() => {
        throw new Error('PRODUCT_SESSION_UPDATE_CONFLICT')
      })
    }
    const stopNativeSession = vi.fn(async () => undefined)

    await bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'request-open-conflict', conversationId: current.id, prompt: 'inspect' },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId: 'cline-native-unindexed'
        }
      },
      stopNativeSession
    })

    expect(stopNativeSession).toHaveBeenCalledTimes(1)
    expect(stopNativeSession).toHaveBeenCalledWith('cline-native-unindexed')
  })

  it('still attempts closed-late cleanup when the registry update conflicts and records a stop failure', async () => {
    const modulePath = '../src/main/backend/agent/classicProductSessionLifecycle'
    const { bindClassicProductSessionResponse } = await import(modulePath)
    const current = existingSession(false)
    const registry = {
      get: vi.fn(() => current),
      create: vi.fn(),
      update: vi.fn(() => {
        throw new Error('PRODUCT_SESSION_UPDATE_CONFLICT')
      })
    }
    const stopNativeSession = vi.fn(async () => {
      throw new Error('session.stop failed')
    })
    const logFailure = vi.fn()

    await expect(bindClassicProductSessionResponse({
      registry,
      request: { requestId: 'request-conflict', conversationId: current.id, prompt: 'inspect' },
      result: {
        ok: true,
        data: {
          text: 'done',
          provider: 'provider',
          model: 'model',
          durationMs: 1,
          nativeSessionId: 'cline-native-late'
        }
      },
      stopNativeSession,
      logFailure
    })).resolves.toBeUndefined()

    expect(stopNativeSession).toHaveBeenCalledWith('cline-native-late')
    expect(logFailure).toHaveBeenCalledWith(
      'product-session.classic-bind-failed',
      expect.objectContaining({
        productSessionId: current.id,
        nativeSessionId: 'cline-native-late',
        errorMessage: 'PRODUCT_SESSION_UPDATE_CONFLICT'
      })
    )
    expect(logFailure).toHaveBeenCalledWith(
      'product-session.classic-stop-failed',
      expect.objectContaining({
        productSessionId: current.id,
        nativeSessionId: 'cline-native-late',
        stopReason: 'closed-late-binding',
        errorMessage: 'session.stop failed'
      })
    )
  })
})
