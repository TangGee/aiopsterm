import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type ChatHistoryBackend = {
  configureChatHistoryBackendRuntime: (config?: { stateFilePath?: string; useSeedData?: boolean }) => void
  resetChatHistoryForTests: () => void
  listChatConversations: () => any
  createChatConversation: () => any
  updateChatConversation: (input: any) => any
  deleteChatConversation: (id: string) => any
  restoreChatConversation: (id: string) => any
  saveChatMessageMetadata: (input: any) => any
}

let backend: ChatHistoryBackend
const tempDirs: string[] = []

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/chatHistory'
  backend = (await import(modulePath)) as ChatHistoryBackend
}

const useTempRuntime = async (options: { useSeedData: boolean; prefix?: string }) => {
  const dir = await mkdtemp(join(tmpdir(), options.prefix || 'aiopsterm-chat-history-'))
  tempDirs.push(dir)
  const stateFilePath = join(dir, 'chat-history.json')
  backend.configureChatHistoryBackendRuntime({ stateFilePath, useSeedData: options.useSeedData })
  backend.resetChatHistoryForTests()
  return stateFilePath
}

const expectOkData = (result: any) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as Record<string, any>
}

describe('AI chat history backend boundary', () => {
  beforeEach(async () => {
    await loadBackend()
    await useTempRuntime({ useSeedData: true })
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('lists backend-owned seed conversations only when seed mode is enabled', async () => {
    let data = expectOkData(backend.listChatConversations())

    expect(data.selectedConversationId).toBe('conv-1')
    expect(data.conversations.map((conversation: { id: string }) => conversation.id)).toEqual(['conv-1', 'conv-2', 'conv-3'])

    await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-chat-history-nonseed-' })
    data = expectOkData(backend.listChatConversations())

    expect(data.selectedConversationId).toBe('')
    expect(data.conversations).toEqual([])
  })

  it('validates rename input and persists title/favorite mutations', async () => {
    expect(backend.updateChatConversation({ id: 'conv-2', title: '   ' })).toEqual({
      ok: false,
      errorCode: 'CHAT_HISTORY_TITLE_REQUIRED',
      errorMessage: 'Conversation title is required.'
    })

    const renamed = backend.updateChatConversation({ id: 'conv-2', title: 'K8s 发布复盘', favorite: true })
    const renamedData = expectOkData(renamed)
    expect(renamedData.conversation).toMatchObject({ id: 'conv-2', title: 'K8s 发布复盘', favorite: true })
    expect(renamedData.selectedConversationId).toBe('conv-1')

    const list = expectOkData(backend.listChatConversations())
    expect(list.selectedConversationId).toBe('conv-1')
    expect(list.conversations.find((conversation: { id: string }) => conversation.id === 'conv-2')).toMatchObject({
      title: 'K8s 发布复盘',
      favorite: true
    })
  })

  it('restores backend message snapshots without renderer-generated summaries', async () => {
    const restored = expectOkData(backend.restoreChatConversation('conv-2'))

    expect(restored.conversation.id).toBe('conv-2')
    expect(restored.messages.at(0).text).toContain('历史会话已从 aiopsterm 后端恢复')
    expect(restored.messages.at(-1).text).toContain('K8s 发布失败历史包含 Pod 事件')
    expect(restored.messages.at(-1).text).not.toContain('本地历史摘要')
    expect(restored.messages.find((message: { role: string }) => message.role === 'user')?.hosts?.[0]).toMatchObject({
      kind: 'hosts',
      label: 'prod-cluster'
    })
  })

  it('creates, updates message snapshots, persists state, and deletes conversations behind the boundary', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-chat-history-create-' })
    const created = expectOkData(backend.createChatConversation())

    expect(created.conversation).toMatchObject({ title: '新会话', summary: '等待输入运维目标' })
    expect(created.selectedConversationId).toBe(created.conversation.id)

    const saved = expectOkData(
      backend.updateChatConversation({
        id: created.conversation.id,
        summary: '检查发布状态',
        messages: [
          { id: 'history-user', role: 'user', text: '检查发布状态', hosts: [{ id: 'history-host', kind: 'hosts', label: 'prod-cluster' }] },
          { id: 'history-assistant', role: 'assistant', text: '发布状态检查完成。', state: 'done' }
        ]
      })
    )
    expect(saved.selectedConversationId).toBe(created.conversation.id)

    let persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as {
      selectedConversationId: string
      conversations: Array<{ id: string; summary: string }>
      messagesByConversationId: Record<string, Array<{ id: string; text: string }>>
    }
    expect(persisted.conversations[0]).toMatchObject({ id: created.conversation.id, summary: '检查发布状态' })
    expect(persisted.messagesByConversationId[created.conversation.id]).toEqual([
      expect.objectContaining({ id: 'history-user', text: '检查发布状态' }),
      expect.objectContaining({ id: 'history-assistant', text: '发布状态检查完成。' })
    ])

    backend.configureChatHistoryBackendRuntime({ stateFilePath, useSeedData: false })
    const restored = expectOkData(backend.restoreChatConversation(created.conversation.id))
    expect(restored.messages).toEqual([
      { id: 'history-user', role: 'user', text: '检查发布状态', hosts: [{ id: 'history-host', kind: 'hosts', label: 'prod-cluster' }] },
      { id: 'history-assistant', role: 'assistant', text: '发布状态检查完成。', state: 'done' }
    ])

    const metadata = expectOkData(
      backend.saveChatMessageMetadata({
        conversationId: created.conversation.id,
        messageId: 'history-assistant',
        favorite: true,
        feedback: 'up'
      })
    )
    expect(metadata.messages.find((message: { id: string }) => message.id === 'history-assistant')).toMatchObject({
      favorite: true,
      feedback: 'up'
    })

    const clearedFeedback = expectOkData(
      backend.saveChatMessageMetadata({
        conversationId: created.conversation.id,
        messageId: 'history-assistant',
        feedback: null
      })
    )
    expect(clearedFeedback.messages.find((message: { id: string }) => message.id === 'history-assistant')).toMatchObject({
      favorite: true
    })
    expect(clearedFeedback.messages.find((message: { id: string }) => message.id === 'history-assistant')?.feedback).toBeUndefined()
    expect(expectOkData(backend.restoreChatConversation(created.conversation.id)).messages.at(-1)).toEqual({
      id: 'history-assistant',
      role: 'assistant',
      text: '发布状态检查完成。',
      state: 'done',
      favorite: true
    })

    const deleted = expectOkData(backend.deleteChatConversation(created.conversation.id))
    expect(deleted.conversations.some((conversation: { id: string }) => conversation.id === created.conversation.id)).toBe(false)
    expect(backend.restoreChatConversation(created.conversation.id)).toEqual({
      ok: false,
      errorCode: 'CHAT_HISTORY_NOT_FOUND',
      errorMessage: 'Conversation not found.'
    })

    persisted = JSON.parse(await readFile(stateFilePath, 'utf-8'))
    expect(persisted.conversations).toEqual([])
    expect(persisted.selectedConversationId).toBe('')
  })

  it('normalizes malformed persisted state and falls back on corrupt files', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-chat-history-malformed-' })
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        selectedConversationId: 'missing',
        conversations: [
          { id: 'dup', title: '  Saved Runbook  ', summary: '', updatedAt: '', ts: 'bad', favorite: 'yes', ipAddress: ' 10.0.0.5 ' },
          { id: 'dup', title: '', summary: 'fallback summary', updatedAt: 'Yesterday', ts: 1234, favorite: true }
        ],
        messagesByConversationId: {
          dup: [
            { id: '', role: 'user', text: '  hi  ', hosts: [{ id: '', kind: 'hosts', label: ' prod ' }] },
            { id: 'bad-role', role: 'tool', text: 'skip me' },
            { id: 'empty', role: 'assistant', text: '' }
          ]
        }
      }),
      'utf-8'
    )

    backend.configureChatHistoryBackendRuntime({ stateFilePath, useSeedData: false })
    let list = expectOkData(backend.listChatConversations())

    expect(list.selectedConversationId).toBe('dup')
    expect(list.conversations).toEqual([
      expect.objectContaining({ id: 'dup', title: 'Saved Runbook', summary: 'Saved Runbook', updatedAt: '刚刚', ipAddress: '10.0.0.5' }),
      expect.objectContaining({ id: 'dup-2', title: 'New Chat', summary: 'fallback summary', updatedAt: 'Yesterday', ts: 1234, favorite: true })
    ])
    expect(list.conversations[0].favorite).toBeUndefined()

    const restored = expectOkData(backend.restoreChatConversation('dup'))
    expect(restored.messages).toEqual([
      { id: 'history-message-1', role: 'user', text: 'hi', hosts: [{ id: 'history-host-0', kind: 'hosts', label: 'prod' }] }
    ])

    await writeFile(stateFilePath, '{bad json', 'utf-8')
    backend.configureChatHistoryBackendRuntime({ stateFilePath, useSeedData: false })
    list = expectOkData(backend.listChatConversations())

    expect(list.conversations).toEqual([])
    expect(list.selectedConversationId).toBe('')
  })

  it('migrates the legacy electron-store chat-history file when the new state file is empty', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-chat-history-legacy-' })
    const legacyStateFilePath = join(stateFilePath, '..', 'aiopsterm-chat-history.json')
    await writeFile(
      legacyStateFilePath,
      JSON.stringify({
        selectedConversationId: 'legacy-conv',
        conversations: [
          {
            id: 'legacy-conv',
            title: 'Legacy Incident',
            summary: 'restored from previous backend store',
            updatedAt: 'Yesterday',
            ts: 4567,
            ipAddress: '10.1.2.3'
          }
        ],
        messagesByConversationId: {
          'legacy-conv': [
            { id: 'legacy-user', role: 'user', text: 'legacy prompt' },
            { id: 'legacy-assistant', role: 'assistant', text: 'legacy response', state: 'done' }
          ]
        }
      }),
      'utf-8'
    )

    backend.configureChatHistoryBackendRuntime({ stateFilePath, useSeedData: false })
    const list = expectOkData(backend.listChatConversations())

    expect(list.selectedConversationId).toBe('legacy-conv')
    expect(list.conversations).toEqual([
      expect.objectContaining({
        id: 'legacy-conv',
        title: 'Legacy Incident',
        summary: 'restored from previous backend store',
        updatedAt: 'Yesterday',
        ts: 4567,
        ipAddress: '10.1.2.3'
      })
    ])
    expect(JSON.parse(await readFile(stateFilePath, 'utf-8'))).toMatchObject({
      selectedConversationId: 'legacy-conv',
      conversations: [expect.objectContaining({ id: 'legacy-conv' })]
    })
    expect(expectOkData(backend.restoreChatConversation('legacy-conv')).messages.at(-1)).toMatchObject({
      id: 'legacy-assistant',
      text: 'legacy response',
      state: 'done'
    })
  })
})
