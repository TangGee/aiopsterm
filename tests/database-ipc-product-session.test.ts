import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { DatabaseAiDrawerResponseInput, DatabaseAiPaneStateSnapshot } from '@shared/contracts/database'

const backend = vi.hoisted(() => ({
  getDatabaseAiPaneState: vi.fn(),
  saveDatabaseAiPaneState: vi.fn(),
  generateDatabaseAiDrawerResponse: vi.fn()
}))

vi.mock('../src/main/backend/database/database', async (importOriginal) => ({
  ...await importOriginal<any>(),
  getDatabaseAiPaneState: backend.getDatabaseAiPaneState,
  saveDatabaseAiPaneState: backend.saveDatabaseAiPaneState,
  generateDatabaseAiDrawerResponse: backend.generateDatabaseAiDrawerResponse
}))

type Handler = (event: unknown, ...args: any[]) => unknown

const state = (patch: Partial<DatabaseAiPaneStateSnapshot> = {}): DatabaseAiPaneStateSnapshot => ({
  conversationId: 'dbai-ipc-state',
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

describe('database IPC product session synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backend.getDatabaseAiPaneState.mockReturnValue({ ok: true, data: state() })
    backend.saveDatabaseAiPaneState.mockImplementation((snapshot) => ({ ok: true, data: snapshot }))
    backend.generateDatabaseAiDrawerResponse.mockResolvedValue({
      ok: true,
      data: {
        request: {},
        text: 'Generated SQL',
        reasoning: 'Reasoning',
        sql: 'select 1',
        provider: 'openai',
        durationMs: 1
      }
    })
  })

  it('keeps pane state reads pure and syncs only successful writes', async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
    } as unknown as IpcMain
    const modulePath = '../src/main/ipc/database'
    const { registerDatabaseIpc } = await import(modulePath)
    const syncProductSessionState = vi.fn()
    registerDatabaseIpc(ipcMain, {
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      syncProductSessionState
    })

    await expect(handlers.get('database:ai-pane-state:get')?.({})).toEqual({ ok: true, data: state() })
    expect(syncProductSessionState).not.toHaveBeenCalled()

    const saved = state({ conversationId: 'dbai-written', open: true })
    await expect(handlers.get('database:ai-pane-state:save')?.({}, saved)).toEqual({ ok: true, data: saved })
    expect(syncProductSessionState).toHaveBeenCalledWith(saved)
  })

  it('offers explicit drawer conversations to the Product Session binder', async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
    } as unknown as IpcMain
    const modulePath = '../src/main/ipc/database'
    const { registerDatabaseIpc } = await import(modulePath)
    const bindDrawerProductSession = vi.fn()
    registerDatabaseIpc(ipcMain, {
      showSaveDialog: vi.fn(async () => ({ canceled: true })),
      bindDrawerProductSession
    })
    const request: DatabaseAiDrawerResponseInput = {
      conversationId: 'dbai-product-session-drawer',
      requestId: 'drawer-request-1',
      action: 'optimize',
      sourceSql: 'select 1',
      context: { connectionId: 'connection-1', databaseName: 'orders', schemaName: 'public' }
    }
    const event = { sender: { id: 7 } }

    const result = await handlers.get('database:ai-drawer-response')?.(event, request)

    expect(backend.generateDatabaseAiDrawerResponse).toHaveBeenCalledWith(request)
    expect(bindDrawerProductSession).toHaveBeenCalledWith(request, result)
  })
})
