import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const backend = vi.hoisted(() => ({
  createChatConversation: vi.fn(),
  deleteChatConversation: vi.fn(),
  deselectChatConversation: vi.fn(),
  getChatConversationMessages: vi.fn(),
  listChatConversations: vi.fn(),
  restoreChatConversation: vi.fn(),
  saveChatMessageMetadata: vi.fn(),
  updateChatConversation: vi.fn()
}))

vi.mock('../src/main/backend/chat/chatHistory', () => backend)

type Handler = (event: unknown, ...args: any[]) => unknown

const harness = async () => {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
  } as unknown as IpcMain
  const modulePath = '../src/main/ipc/chatHistory'
  const { registerChatHistoryIpc } = await import(modulePath)
  return { handlers, ipcMain, registerChatHistoryIpc }
}

const conversations = [
  { id: 'classic-current', title: 'Current', updatedAt: 'now', ts: 2 },
  { id: 'classic-history', title: 'History', updatedAt: 'earlier', ts: 1 }
]

beforeEach(() => {
  vi.clearAllMocks()
  backend.listChatConversations.mockReturnValue({
    ok: true,
    data: { conversations: [], selectedConversationId: '' }
  })
})

describe('chat history IPC product sessions', () => {
  it('mirrors legacy Classic projections as closed sessions on cold startup', async () => {
    backend.listChatConversations.mockReturnValue({
      ok: true,
      data: { conversations, selectedConversationId: 'classic-current' }
    })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const syncProductSession = vi.fn()
    registerChatHistoryIpc(ipcMain, { syncProductSession })

    expect(syncProductSession).toHaveBeenNthCalledWith(1, conversations[0], { createIsOpen: false })
    expect(syncProductSession).toHaveBeenNthCalledWith(2, conversations[1], { createIsOpen: false })
    expect(await handlers.get('chat-history:list')?.({})).toEqual({
      ok: true,
      data: { conversations, selectedConversationId: 'classic-current' }
    })
    expect(syncProductSession).toHaveBeenCalledTimes(4)
  })

  it('marks a restored Classic history session open again', async () => {
    backend.restoreChatConversation.mockReturnValue({
      ok: true,
      data: { conversation: conversations[1], messages: [] }
    })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const syncProductSession = vi.fn()
    registerChatHistoryIpc(ipcMain, { syncProductSession })

    expect(await handlers.get('chat-history:restore')?.({}, 'classic-history')).toEqual({
      ok: true,
      data: { conversation: conversations[1], messages: [] }
    })
    expect(syncProductSession).toHaveBeenCalledWith(conversations[1], { isOpen: true })
  })

  it('syncs only the renderer projection submitted by an update', async () => {
    const projectionMessages = [
      { id: 'retained-user', role: 'user' as const, text: 'retained' },
      { id: 'replacement-assistant', role: 'assistant' as const, text: 'replacement', state: 'done' as const }
    ]
    backend.updateChatConversation.mockReturnValue({
      ok: true,
      data: { conversation: conversations[0], conversations, selectedConversationId: conversations[0].id }
    })
    backend.getChatConversationMessages.mockReturnValue({
      ok: true,
      data: {
        conversation: conversations[0],
        messages: [
          { id: 'older-branch', role: 'assistant', text: 'must not be re-upserted' },
          ...projectionMessages
        ]
      }
    })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const syncProductSession = vi.fn()
    registerChatHistoryIpc(ipcMain, { syncProductSession })

    const update = { id: conversations[0].id, messages: projectionMessages }
    expect(await handlers.get('chat-history:update')?.({}, update)).toEqual({
      ok: true,
      data: { conversation: conversations[0], conversations, selectedConversationId: conversations[0].id }
    })
    expect(syncProductSession).toHaveBeenCalledWith(conversations[0], { projectionMessages })
  })

  it('exposes selection clearing without deleting or reopening product history', async () => {
    backend.deselectChatConversation.mockReturnValue({
      ok: true,
      data: { conversations, selectedConversationId: '' }
    })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const syncProductSession = vi.fn()
    registerChatHistoryIpc(ipcMain, { syncProductSession })

    expect(await handlers.get('chat-history:deselect')?.({}, 'classic-current')).toEqual({
      ok: true,
      data: { conversations, selectedConversationId: '' }
    })
    expect(backend.deselectChatConversation).toHaveBeenCalledWith('classic-current')
    expect(syncProductSession).not.toHaveBeenCalled()
  })

  it('routes permanent deletion through the product lifecycle before reporting projection removal', async () => {
    backend.listChatConversations
      .mockReturnValueOnce({ ok: true, data: { conversations, selectedConversationId: 'classic-current' } })
      .mockReturnValueOnce({ ok: true, data: { conversations, selectedConversationId: 'classic-current' } })
      .mockReturnValueOnce({
        ok: true,
        data: { conversations: conversations.filter((conversation) => conversation.id !== 'classic-current'), selectedConversationId: '' }
      })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const syncProductSession = vi.fn()
    const deleteProductSession = vi.fn(async (id: string) => ({ id, deleted: true }))
    registerChatHistoryIpc(ipcMain, { syncProductSession, deleteProductSession })

    await expect(handlers.get('chat-history:delete')?.({}, 'classic-current')).resolves.toEqual({
      ok: true,
      data: {
        deletedId: 'classic-current',
        conversations: [conversations[1]],
        selectedConversationId: ''
      }
    })
    expect(syncProductSession).toHaveBeenCalledWith(conversations[0], { createIsOpen: false })
    expect(deleteProductSession).toHaveBeenCalledWith('classic-current')
    expect(backend.deleteChatConversation).not.toHaveBeenCalled()
  })

  it('preserves the Classic projection when native product deletion fails', async () => {
    backend.listChatConversations
      .mockReturnValueOnce({ ok: true, data: { conversations, selectedConversationId: 'classic-current' } })
      .mockReturnValueOnce({ ok: true, data: { conversations, selectedConversationId: 'classic-current' } })
    const { handlers, ipcMain, registerChatHistoryIpc } = await harness()
    const deleteProductSession = vi.fn(async () => {
      throw new Error('native delete failed')
    })
    registerChatHistoryIpc(ipcMain, { syncProductSession: vi.fn(), deleteProductSession })

    await expect(handlers.get('chat-history:delete')?.({}, 'classic-current')).resolves.toEqual({
      ok: false,
      errorCode: 'PRODUCT_SESSION_DELETE_FAILED',
      errorMessage: 'native delete failed'
    })
    expect(backend.deleteChatConversation).not.toHaveBeenCalled()
    expect(backend.listChatConversations).toHaveBeenCalledTimes(2)
  })
})
