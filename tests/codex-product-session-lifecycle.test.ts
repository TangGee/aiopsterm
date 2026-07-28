import { describe, expect, it, vi } from 'vitest'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

const currentSession = (patch: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'product-codex-lifecycle',
  surface: 'codex',
  title: 'Codex',
  isOpen: true,
  projectRoot: '/srv/app',
  lastKnownCwd: '/srv/app/services/api',
  target: {
    kind: 'ssh',
    panelId: 'panel-current',
    terminalSessionId: 'terminal-current',
    assetId: 'asset-current',
    connectionId: 'connection-current',
    host: 'current.internal',
    username: 'deploy'
  },
  nativeBinding: {
    engine: 'codex',
    nativeSessionId: 'thread-before-switch',
    profile: 'embedded-tui'
  },
  createdAt: 1,
  updatedAt: 2,
  ...patch
})

describe('Codex product session lifecycle', () => {
  it('keeps a resume launch when the native rollout is durable', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { prepareCodexProductSessionLaunch } = await import(modulePath)
    const session = currentSession({
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-durable', profile: 'embedded-tui' }
    })
    const registry = {
      get: vi.fn(() => session),
      update: vi.fn()
    }
    const options = {
      productSessionId: 'product-codex-lifecycle',
      launch: { mode: 'resume' as const, threadId: 'thread-durable' }
    }

    await expect(prepareCodexProductSessionLaunch({
      registry,
      options,
      findSavedSessionRolloutPath: vi.fn(async () => '/codex/sessions/rollout-thread-durable.jsonl')
    })).resolves.toEqual({ options })

    expect(registry.get).toHaveBeenCalledWith('product-codex-lifecycle')
    expect(registry.update).not.toHaveBeenCalled()
  })

  it('detaches a matching missing native binding before recovering with a new launch', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { prepareCodexProductSessionLaunch } = await import(modulePath)
    const session = currentSession({
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'thread-missing',
        profile: 'embedded-tui'
      }
    })
    const detached = { ...session, nativeBinding: undefined, updatedAt: 3 }
    const registry = {
      get: vi.fn(() => session),
      update: vi.fn(() => detached)
    }
    const options = {
      productSessionId: session.id,
      projectRoot: '/srv/app',
      launch: { mode: 'resume' as const, threadId: 'thread-missing' }
    }

    await expect(prepareCodexProductSessionLaunch({
      registry,
      options,
      findSavedSessionRolloutPath: vi.fn(async () => null)
    })).resolves.toEqual({
      options: {
        ...options,
        launch: { mode: 'new' }
      },
      recoveredFromThreadId: 'thread-missing'
    })

    expect(registry.update).toHaveBeenCalledWith({ id: session.id, nativeBinding: null })
  })

  it('fails closed when the product session binding changed during missing-session recovery', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { prepareCodexProductSessionLaunch } = await import(modulePath)
    const staleSession = currentSession({
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-stale' }
    })
    const currentOwner = currentSession({
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-new-owner' }
    })
    const registry = {
      get: vi.fn()
        .mockReturnValueOnce(staleSession)
        .mockReturnValueOnce(currentOwner),
      update: vi.fn()
    }

    await expect(prepareCodexProductSessionLaunch({
      registry,
      options: {
        productSessionId: 'product-codex-lifecycle',
        launch: { mode: 'resume', threadId: 'thread-stale' }
      },
      findSavedSessionRolloutPath: vi.fn(async () => null)
    })).rejects.toMatchObject({ code: 'CODEX_PRODUCT_SESSION_RECOVERY_FAILED' })

    expect(registry.update).not.toHaveBeenCalled()
  })

  it('fails closed when detaching the missing native binding is not confirmed', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { prepareCodexProductSessionLaunch } = await import(modulePath)
    const session = currentSession({
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-missing' }
    })
    const registry = {
      get: vi.fn(() => session),
      update: vi.fn(() => session)
    }

    await expect(prepareCodexProductSessionLaunch({
      registry,
      options: {
        productSessionId: session.id,
        launch: { mode: 'resume', threadId: 'thread-missing' }
      },
      findSavedSessionRolloutPath: vi.fn(async () => null)
    })).rejects.toMatchObject({ code: 'CODEX_PRODUCT_SESSION_RECOVERY_FAILED' })
  })

  it('does not detach a native binding when saved-session lookup fails', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { prepareCodexProductSessionLaunch } = await import(modulePath)
    const registry = {
      get: vi.fn(),
      update: vi.fn()
    }
    const lookupError = Object.assign(new Error('rollout directory is unreadable'), { code: 'EACCES' })

    await expect(prepareCodexProductSessionLaunch({
      registry,
      options: {
        productSessionId: 'product-codex-lifecycle',
        launch: { mode: 'resume', threadId: 'thread-unreadable' }
      },
      findSavedSessionRolloutPath: vi.fn(async () => {
        throw lookupError
      })
    })).rejects.toBe(lookupError)

    expect(registry.get).toHaveBeenCalledWith('product-codex-lifecycle')
    expect(registry.update).not.toHaveBeenCalled()
  })

  it('keeps the current target and cwd when a running TUI switches native threads', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { bindCodexProductSessionThread } = await import(modulePath)
    const session = currentSession()
    const registry = {
      get: vi.fn(() => session),
      create: vi.fn(),
      update: vi.fn((input) => ({ ...session, ...input }))
    }
    const stopRuntime = vi.fn(() => ({ ok: true as const, data: { id: 'runtime-current' } }))

    await expect(bindCodexProductSessionThread({
      registry,
      productSessionId: session.id,
      event: {
        id: 'runtime-current',
        threadId: 'thread-after-switch',
        reason: 'switch',
        at: 3,
        title: 'Investigate deploy rollback'
      },
      options: {
        projectRoot: '/srv/old-launch-root',
        target: {
          kind: 'ssh',
          panelId: 'panel-launch',
          sessionId: 'terminal-launch',
          assetId: 'asset-launch',
          connectionId: 'connection-launch',
          host: 'launch.internal',
          cwd: '/srv/old-launch-root'
        }
      },
      stopRuntime,
      clearRuntimeTarget: vi.fn()
    })).resolves.toEqual({ status: 'bound' })

    expect(registry.update).toHaveBeenCalledWith({
      id: session.id,
      isOpen: true,
      title: 'Investigate deploy rollback',
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: 'thread-after-switch',
        profile: 'embedded-tui',
        scopeKey: 'embedded-tui\0/srv/app\0ssh\0asset-current\0current.internal\0\0deploy'
      }
    })
    expect(stopRuntime).not.toHaveBeenCalled()
  })

  it('deletes a thread published after permanent product session deletion starts', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { bindCodexProductSessionThread } = await import(modulePath)
    const registry = {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
    const deleteNativeSession = vi.fn(async () => undefined)
    const stopRuntime = vi.fn(() => ({ ok: true as const, data: { id: 'runtime-late' } }))

    await expect(bindCodexProductSessionThread({
      registry,
      productSessionId: 'product-deleting',
      event: {
        id: 'runtime-late',
        threadId: '0197f123-4567-7890-abcd-ef0123456789',
        reason: 'new',
        at: 3
      },
      options: {},
      stopRuntime,
      clearRuntimeTarget: vi.fn(),
      isProductSessionDeleting: () => true,
      deleteNativeSession
    })).resolves.toEqual({ status: 'closed' })

    expect(deleteNativeSession).toHaveBeenCalledWith('0197f123-4567-7890-abcd-ef0123456789')
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(registry.get).toHaveBeenCalledTimes(1)
    expect(registry.create).not.toHaveBeenCalled()
    expect(registry.update).not.toHaveBeenCalled()
  })

  it('rejects a stale runtime after the Product Session moved to another Codex thread', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { bindCodexProductSessionThread } = await import(modulePath)
    const session = currentSession({
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-current', profile: 'embedded-tui' }
    })
    const registry = {
      get: vi.fn(() => session),
      create: vi.fn(),
      update: vi.fn()
    }
    const clearRuntimeTarget = vi.fn()
    const stopRuntime = vi.fn(() => ({ ok: true as const, data: { id: 'runtime-stale' } }))

    await expect(bindCodexProductSessionThread({
      registry,
      productSessionId: session.id,
      event: {
        id: 'runtime-stale',
        threadId: 'thread-stale',
        previousThreadId: 'thread-stale',
        reason: 'resume',
        at: 3,
        title: 'Stale title'
      },
      options: { launch: { mode: 'resume', threadId: 'thread-stale' } },
      stopRuntime,
      clearRuntimeTarget
    })).resolves.toEqual({
      status: 'failed',
      errorMessage: 'Codex product session binding changed before thread publication: expected thread-stale, found thread-current.'
    })

    expect(registry.update).not.toHaveBeenCalled()
    expect(clearRuntimeTarget).toHaveBeenCalledWith('runtime-stale')
    expect(stopRuntime).toHaveBeenCalledWith('runtime-stale')
  })

  it('clears the runtime target and stops the PTY when registry binding fails', async () => {
    const modulePath = '../src/main/backend/agent/codexProductSessionLifecycle'
    const { bindCodexProductSessionThread } = await import(modulePath)
    const session = currentSession()
    const registry = {
      get: vi.fn(() => session),
      create: vi.fn(),
      update: vi.fn(() => {
        throw new Error('native binding conflict')
      })
    }
    const clearRuntimeTarget = vi.fn()
    const stopRuntime = vi.fn(() => ({ ok: true as const, data: { id: 'runtime-conflict' } }))

    await expect(bindCodexProductSessionThread({
      registry,
      productSessionId: session.id,
      event: {
        id: 'runtime-conflict',
        threadId: 'thread-conflict',
        reason: 'switch',
        at: 3
      },
      options: {},
      stopRuntime,
      clearRuntimeTarget
    })).resolves.toEqual({ status: 'failed', errorMessage: 'native binding conflict' })

    expect(clearRuntimeTarget).toHaveBeenCalledWith('runtime-conflict')
    expect(stopRuntime).toHaveBeenCalledWith('runtime-conflict')
  })
})
