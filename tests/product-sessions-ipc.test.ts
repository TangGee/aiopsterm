import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

type Handler = (event: unknown, ...args: any[]) => unknown

const harness = () => {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const session = (patch: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'product-1',
  surface: 'classic',
  title: 'Session',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
  isOpen: patch.isOpen ?? true
})

const registry = () => {
  const records = new Map<string, ProductSessionRecord>([['product-1', session()]])
  const projection = new Map<string, Array<{ messageId: string; payload: unknown }>>()
  return {
    create: vi.fn((input: any) => {
      const record = session({ ...input, id: input.id || 'generated' })
      records.set(record.id, record)
      return record
    }),
    get: vi.fn((id: string) => records.get(id) || null),
    list: vi.fn(() => [...records.values()]),
    update: vi.fn((input: any) => {
      const current = records.get(input.id)
      if (!current) return null
      const record = { ...current, ...input, updatedAt: current.updatedAt + 1 }
      records.set(record.id, record)
      return record
    }),
    delete: vi.fn((id: string) => records.delete(id)),
    findByNativeBinding: vi.fn(() => null),
    replaceProjectionMessages: vi.fn((id: string, messages: Array<{ messageId: string; payload: unknown }>) => {
      projection.set(id, messages.map((message) => ({ ...message })))
      return messages.length
    }),
    upsertProjectionMessages: vi.fn((id: string, messages: Array<{ messageId: string; payload: unknown }>) => {
      const stored = projection.get(id) || []
      const byId = new Map(stored.map((message) => [message.messageId, message]))
      messages.forEach((message) => byId.set(message.messageId, { ...message }))
      projection.set(id, [...byId.values()])
      return messages.length
    }),
    reviseProjectionMessages: vi.fn((id: string, input: {
      fromMessageId: string
      replacementMessages: Array<{ messageId: string; payload: unknown }>
    }) => {
      const stored = projection.get(id) || []
      const targetIndex = stored.findIndex((message) => message.messageId === input.fromMessageId)
      if (targetIndex < 0) throw new Error('missing revision target')
      const next = [...stored.slice(0, targetIndex), ...input.replacementMessages]
      projection.set(id, next)
      return {
        deletedMessages: stored.length - targetIndex,
        appendedMessages: input.replacementMessages.length,
        totalMessages: next.length,
        seedMessages: stored.slice(0, targetIndex).map((message, ordinal) => ({
          ...message,
          ordinal,
          createdAt: 1,
          updatedAt: 1
        })),
        seedTotalMessages: targetIndex,
        seedOmittedMessages: 0,
        seedPayloadBytes: 0
      }
    }),
    listProjectionMessages: vi.fn((id: string) => {
      const stored = projection.get(id) || []
      return {
        messages: stored.map((message, ordinal) => ({ ...message, ordinal, createdAt: 1, updatedAt: 1 })),
        hasMore: false,
        nextBeforeOrdinal: null,
        totalMessages: stored.length
      }
    }),
    subscribe: vi.fn((_listener: (event: any) => void) => () => undefined),
    close: vi.fn()
  }
}

describe('product session IPC', () => {
  it('exposes metadata CRUD and bounded Product Session projection channels', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    registerProductSessionsIpc(ipcMain, { registry: store })

    expect([...handlers.keys()]).toEqual([
      'product-session:list',
      'product-session:get',
      'product-session:projection:list',
      'product-session:projection:replace',
      'product-session:projection:upsert',
      'product-session:projection:revise',
      'product-session:create',
      'product-session:update',
      'product-session:delete',
      'product-session:close'
    ])
    expect(await handlers.get('product-session:list')?.({}, { surface: 'classic' })).toEqual({
      ok: true,
      data: { sessions: [session()] }
    })
    expect(await handlers.get('product-session:create')?.({}, {
      id: 'database-1',
      surface: 'database',
      database: { connectionId: 'db-1', databaseName: 'main' }
    })).toEqual(expect.objectContaining({ ok: true }))
    expect(JSON.stringify(await handlers.get('product-session:get')?.({}, 'database-1'))).not.toMatch(
      /prompt|message|transcript/i
    )
    expect(await handlers.get('product-session:projection:replace')?.({}, 'product-1', [
      { messageId: 'message-1', payload: { id: 'message-1', text: 'first' } }
    ])).toEqual({ ok: true, data: { count: 1 } })
    expect(await handlers.get('product-session:projection:upsert')?.({}, 'product-1', [
      { messageId: 'message-2', payload: { id: 'message-2', text: 'second' } }
    ])).toEqual({ ok: true, data: { count: 1 } })
    expect(await handlers.get('product-session:projection:replace')?.({}, 'product-1', [
      { messageId: 'message-late', payload: { id: 'message-late', text: 'must not overwrite' } }
    ])).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'PRODUCT_SESSION_PROJECTION_REPLACE_DENIED'
    }))
    expect(await handlers.get('product-session:projection:list')?.({}, 'product-1', { limit: 40 })).toEqual({
      ok: true,
      data: expect.objectContaining({ totalMessages: 2 })
    })
    expect(await handlers.get('product-session:projection:revise')?.({}, 'product-1', {
      fromMessageId: 'message-2',
      replacementMessages: [{ messageId: 'message-3', payload: { id: 'message-3', text: 'replacement' } }]
    })).toEqual({
      ok: true,
      data: expect.objectContaining({
        deletedMessages: 1,
        appendedMessages: 1,
        totalMessages: 2,
        seedTotalMessages: 1
      })
    })
  })

  it('stops native runtime on close and preserves the registry row', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    store.update({
      id: 'product-1',
      nativeBinding: { engine: 'cline', nativeSessionId: 'cline-native-1' }
    })
    let releaseStop!: () => void
    const stopNativeBinding = vi.fn(() => new Promise<void>((resolve) => {
      releaseStop = resolve
    }))
    registerProductSessionsIpc(ipcMain, { registry: store, stopNativeBinding })

    const closePromise = handlers.get('product-session:close')?.({}, 'product-1') as Promise<unknown>
    await Promise.resolve()
    expect(store.get('product-1')).toMatchObject({ isOpen: false })
    expect(stopNativeBinding).toHaveBeenCalledWith('cline', 'cline-native-1')
    releaseStop()

    expect(await closePromise).toEqual({
      ok: true,
      data: { id: 'product-1', stopped: true }
    })
    expect(store.get('product-1')).toMatchObject({ isOpen: false })
  })

  it('permanently deletes the native session before deleting product metadata', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    store.update({
      id: 'product-1',
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-1' }
    })
    const deleteNativeBinding = vi.fn(async () => undefined)
    registerProductSessionsIpc(ipcMain, { registry: store, deleteNativeBinding })

    expect(await handlers.get('product-session:delete')?.({}, 'product-1')).toEqual({
      ok: true,
      data: { id: 'product-1', deleted: true }
    })
    expect(deleteNativeBinding).toHaveBeenCalledWith({ engine: 'codex', nativeSessionId: 'thread-1' })
    expect(store.get('product-1')).toBeNull()
  })

  it('forwards registry changes to the product-session preload event broadcaster', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain } = harness()
    const store = registry()
    const broadcastChange = vi.fn()
    registerProductSessionsIpc(ipcMain, { registry: store, broadcastChange })

    expect(store.subscribe).toHaveBeenCalledTimes(1)
    const listener = store.subscribe.mock.calls[0][0]
    if (!listener) throw new Error('Missing product session registry listener.')
    const event = { type: 'updated' as const, id: 'product-1', session: session({ title: 'Renamed' }) }
    listener(event)
    expect(broadcastChange).toHaveBeenCalledWith(event)
  })

  it('reports when the surface owns native shutdown after product close', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    store.update({
      id: 'product-1',
      nativeBinding: { engine: 'codex', nativeSessionId: 'thread-1' }
    })
    const stopNativeBinding = vi.fn(async () => false)
    registerProductSessionsIpc(ipcMain, { registry: store, stopNativeBinding })

    expect(await handlers.get('product-session:close')?.({}, 'product-1')).toEqual({
      ok: true,
      data: { id: 'product-1', stopped: false }
    })
    expect(store.get('product-1')).toMatchObject({ isOpen: false })
  })

  it('rolls a product session open when native shutdown fails', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    store.update({
      id: 'product-1',
      nativeBinding: { engine: 'cline', nativeSessionId: 'cline-native-failing' }
    })
    const stopNativeBinding = vi.fn(async () => {
      throw new Error('native stop rejected')
    })
    registerProductSessionsIpc(ipcMain, { registry: store, stopNativeBinding })

    expect(await handlers.get('product-session:close')?.({}, 'product-1')).toEqual({
      ok: false,
      errorCode: 'PRODUCT_SESSION_OPERATION_FAILED',
      errorMessage: 'native stop rejected'
    })
    expect(store.get('product-1')).toMatchObject({ isOpen: true })
  })

  it('rejects create, update, and close mutations after permanent deletion starts', async () => {
    const modulePath = '../src/main/ipc/productSessions'
    const { registerProductSessionsIpc } = await import(modulePath)
    const { ipcMain, handlers } = harness()
    const store = registry()
    registerProductSessionsIpc(ipcMain, {
      registry: store,
      isMutationBlocked: (id: string) => id === 'product-1'
    })

    expect(await handlers.get('product-session:update')?.({}, { id: 'product-1', title: 'late' })).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' })
    )
    expect(await handlers.get('product-session:close')?.({}, 'product-1')).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' })
    )
    expect(await handlers.get('product-session:create')?.({}, { id: 'product-1', surface: 'classic' })).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' })
    )
    expect(await handlers.get('product-session:projection:replace')?.({}, 'product-1', [])).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' })
    )
    expect(await handlers.get('product-session:projection:upsert')?.({}, 'product-1', [])).toEqual(
      expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' })
    )
    expect(await handlers.get('product-session:projection:revise')?.({}, 'product-1', {
      fromMessageId: 'message-1',
      replacementMessages: [{ messageId: 'message-2', payload: {} }]
    })).toEqual(expect.objectContaining({ ok: false, errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS' }))
    expect(store.update).not.toHaveBeenCalled()
    expect(store.replaceProjectionMessages).not.toHaveBeenCalled()
    expect(store.upsertProjectionMessages).not.toHaveBeenCalled()
    expect(store.reviseProjectionMessages).not.toHaveBeenCalled()
  })
})
