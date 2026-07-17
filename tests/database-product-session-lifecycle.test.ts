import { describe, expect, it, vi } from 'vitest'
import type { DatabaseAiPaneStateSnapshot } from '@shared/contracts/database'
import type { ProductSessionCreateInput, ProductSessionRecord } from '@shared/contracts/productSessions'

const snapshot = (patch: Partial<DatabaseAiPaneStateSnapshot> = {}): DatabaseAiPaneStateSnapshot => ({
  conversationId: 'dbai-cold-state',
  open: false,
  width: 420,
  context: {
    connectionId: 'connection-1',
    catalogName: 'orders',
    schemaName: 'public',
    dbType: 'postgresql'
  },
  draft: '',
  messages: [],
  archivedSessions: [],
  ...patch
})

const record = (patch: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'dbai-cold-state',
  surface: 'database',
  title: 'orders / public',
  isOpen: false,
  database: { connectionId: 'connection-1', databaseName: 'orders', schemaName: 'public' },
  createdAt: 1,
  updatedAt: 2,
  ...patch
})

const projectionRegistryMethods = () => ({
  listProjectionMessages: vi.fn(() => ({
    messages: [],
    hasMore: false,
    nextBeforeOrdinal: null,
    totalMessages: 0
  })),
  replaceProjectionMessages: vi.fn((_id: string, messages: unknown[]) => messages.length),
  upsertProjectionMessages: vi.fn((_id: string, messages: unknown[]) => messages.length)
})

describe('database product session state lifecycle', () => {
  it('does not reopen a closed row or create a blank row from cold detached state', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const existing = record()
    const registry = {
      ...projectionRegistryMethods(),
      get: vi.fn(() => existing),
      update: vi.fn((input) => ({ ...existing, ...input })),
      create: vi.fn()
    }

    expect(syncDatabaseProductSessionState({ registry, state: snapshot() })).toBe(true)
    expect(registry.update).toHaveBeenCalledWith(expect.objectContaining({ id: existing.id, isOpen: false }))

    registry.get.mockReturnValue(null as any)
    expect(syncDatabaseProductSessionState({
      registry,
      state: snapshot({ conversationId: 'dbai-new-cold-blank' })
    })).toBe(false)
    expect(registry.create).not.toHaveBeenCalled()
  })

  it('creates or reopens only an explicitly open DB AI session', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const registry = {
      ...projectionRegistryMethods(),
      get: vi.fn(() => null),
      update: vi.fn(),
      create: vi.fn((input: ProductSessionCreateInput) => record({ ...input, id: input.id || 'generated' }))
    }

    expect(syncDatabaseProductSessionState({ registry, state: snapshot({ open: true }) })).toBe(true)
    expect(registry.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'dbai-cold-state',
      surface: 'database',
      isOpen: true,
      database: { connectionId: 'connection-1', databaseName: 'orders', schemaName: 'public' }
    }))
  })

  it('rejects projection writes that try to reuse a session for another database binding', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const existing = record()
    const projection = projectionRegistryMethods()
    const logFailure = vi.fn()
    const registry = {
      ...projection,
      get: vi.fn(() => existing),
      update: vi.fn(),
      create: vi.fn()
    }

    expect(syncDatabaseProductSessionState({
      registry,
      state: snapshot({
        context: {
          connectionId: 'connection-2',
          catalogName: 'billing',
          schemaName: 'finance',
          dbType: 'postgresql'
        },
        messages: [{
          id: 'db-message-mismatched',
          requestId: 'request-mismatched',
          role: 'assistant',
          content: 'wrong database projection',
          contextSummary: 'billing / finance',
          status: 'done',
          responseLanguage: 'zh-CN',
          createdAt: 10,
          updatedAt: 11
        }]
      }),
      logFailure
    })).toBe(false)

    expect(registry.update).not.toHaveBeenCalled()
    expect(projection.replaceProjectionMessages).not.toHaveBeenCalled()
    expect(projection.upsertProjectionMessages).not.toHaveBeenCalled()
    expect(logFailure).toHaveBeenCalledWith(
      'product-session.database-binding-mismatch',
      expect.objectContaining({
        productSessionId: existing.id,
        existingConnectionId: 'connection-1',
        incomingConnectionId: 'connection-2'
      })
    )
  })

  it('does not clear an established database binding from a detached state snapshot', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const existing = record()
    const projection = projectionRegistryMethods()
    const registry = {
      ...projection,
      get: vi.fn(() => existing),
      update: vi.fn(),
      create: vi.fn()
    }

    expect(syncDatabaseProductSessionState({
      registry,
      state: snapshot({ context: undefined })
    })).toBe(false)
    expect(registry.update).not.toHaveBeenCalled()
    expect(projection.replaceProjectionMessages).not.toHaveBeenCalled()
    expect(projection.upsertProjectionMessages).not.toHaveBeenCalled()
  })

  it('ignores state writes while permanent deletion blocks the session id', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const registry = { ...projectionRegistryMethods(), get: vi.fn(), update: vi.fn(), create: vi.fn() }

    expect(syncDatabaseProductSessionState({
      registry,
      state: snapshot({ open: true }),
      isMutationBlocked: () => true
    })).toBe(false)
    expect(registry.get).not.toHaveBeenCalled()
  })

  it('backfills archived JSON cache messages into the Product Session projection', async () => {
    const modulePath = '../src/main/backend/agent/databaseProductSessionLifecycle'
    const { syncDatabaseProductSessionState } = await import(modulePath)
    const existing = record({ id: 'dbai-archive' })
    const projection = projectionRegistryMethods()
    const registry = {
      ...projection,
      get: vi.fn((id: string) => id === 'dbai-archive' ? existing : record()),
      update: vi.fn((input) => ({ ...existing, ...input })),
      create: vi.fn()
    }
    const message = {
      id: 'db-message-1',
      requestId: 'request-1',
      role: 'assistant' as const,
      status: 'done' as const,
      content: 'done',
      contextSummary: 'orders',
      createdAt: 1,
      updatedAt: 2,
      responseLanguage: 'en-US' as const
    }

    expect(syncDatabaseProductSessionState({
      registry,
      state: snapshot({
        archivedSessions: [{
          conversationId: 'dbai-archive',
          context: snapshot().context,
          draft: '',
          messages: [message],
          createdAt: 1,
          updatedAt: 2
        }]
      })
    })).toBe(true)
    expect(projection.replaceProjectionMessages).toHaveBeenCalledWith('dbai-archive', [
      { messageId: message.id, payload: message }
    ])
  })
})
