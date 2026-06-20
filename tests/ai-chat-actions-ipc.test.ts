import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { AiChatConversationRecord, AiChatHistoryMessage } from '../src/shared/contracts/aiChat'
import type { McpResourceReadContent, McpToolCallContent } from '../src/shared/contracts/mcp'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type AiChatActionsIpcBackend = {
  registerAiChatActionsIpc: (ipcMain: IpcMain, input: any) => void
}

const tempDirs: string[] = []

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/aiChatActions'
  return (await import(modulePath)) as AiChatActionsIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const createTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-chat-actions-ipc-'))
  tempDirs.push(dir)
  return dir
}

const conversation = (overrides: Partial<AiChatConversationRecord> = {}): AiChatConversationRecord => ({
  id: 'conv-1',
  title: 'MCP approvals',
  summary: 'MCP approvals',
  updatedAt: '刚刚',
  ts: 1780490000000,
  ...overrides
})

const toolMessage = (id = 'mcp-tool-1'): AiChatHistoryMessage => ({
  id,
  role: 'assistant',
  text: 'Approve tool?',
  ask: 'mcp_tool_call',
  state: 'done',
  mcpToolCall: {
    serverName: 'filesystem',
    toolName: 'read_file',
    arguments: { path: '/tmp/readme.md' }
  }
})

const resourceMessage = (id = 'mcp-resource-1'): AiChatHistoryMessage => ({
  id,
  role: 'assistant',
  text: 'Approve resource?',
  ask: 'mcp_resource_access',
  state: 'done',
  mcpResourceAccess: {
    serverName: 'filesystem',
    uri: 'file:///tmp/readme.md'
  }
})

const createRegistrationInput = (overrides: Record<string, unknown> = {}) => {
  const state = {
    conversation: conversation(),
    messages: [{ id: 'user-1', role: 'user', text: 'read file' } as AiChatHistoryMessage, toolMessage(), resourceMessage()]
  }

  return {
    getChatConversationMessages: vi.fn((conversationId: string) =>
      conversationId === state.conversation.id
        ? { ok: true, data: { conversation: state.conversation, messages: state.messages } }
        : { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
    ),
    replaceChatConversationMessages: vi.fn((conversationId: string, messages: AiChatHistoryMessage[]) => {
      if (conversationId !== state.conversation.id) {
        return { ok: false, errorCode: 'CHAT_HISTORY_NOT_FOUND', errorMessage: 'Conversation not found.' }
      }
      state.messages = messages
      return { ok: true, data: { conversation: state.conversation, messages } }
    }),
    setMcpToolAutoApprove: vi.fn(async () => ({
      ok: true,
      data: {
        mcpConfig: { mcpServers: {} },
        mcpServers: [{ name: 'filesystem', status: 'connected', disabled: false, tools: [{ name: 'read_file', enabled: true, autoApprove: true }], resources: [] }],
        mcpToolStates: { 'filesystem:read_file': true }
      }
    })),
    callMcpTool: vi.fn(async () => ({
      ok: true,
      data: {
        serverName: 'filesystem',
        toolName: 'read_file',
        arguments: { path: '/tmp/readme.md' },
        content: [{ type: 'text', text: 'file content' }] as McpToolCallContent[],
        isError: false,
        durationMs: 3
      }
    })),
    readMcpResource: vi.fn(async () => ({
      ok: true,
      data: {
        serverName: 'filesystem',
        uri: 'file:///tmp/readme.md',
        contents: [{ uri: 'file:///tmp/readme.md', text: 'resource content' }] as McpResourceReadContent[],
        durationMs: 2
      }
    })),
    formatMcpResourceReadContent: vi.fn((contents: McpResourceReadContent[]) => contents.map((item) => item.text || item.uri).join('\n\n')),
    showChatExportSaveDialog: vi.fn(async () => ({ canceled: true })),
    state,
    ...overrides
  }
}

describe('AI chat actions IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('registers stable AI chat action channels', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerAiChatActionsIpc(ipcMain, createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'ai:mcp-tool-call:approve',
      'ai:mcp-tool-call:reject',
      'ai:mcp-resource-access:approve',
      'ai:mcp-resource-access:reject',
      'chat:export'
    ])
  })

  it('approves MCP tool calls, optionally persists auto-approve, runs the tool, and saves the updated message', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAiChatActionsIpc(ipcMain, input)

    await expect(
      handlers.get('ai:mcp-tool-call:approve')?.({}, { conversationId: 'conv-1', messageId: 'mcp-tool-1', autoApprove: true })
    ).resolves.toEqual({
      ok: true,
      data: {
        status: 'approved',
        conversation: input.state.conversation,
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'mcp-tool-1',
            action: 'approved',
            say: 'command_output',
            state: 'done',
            text: 'file content'
          })
        ]),
        toolCall: expect.objectContaining({ serverName: 'filesystem', toolName: 'read_file', isError: false }),
        mcpConfig: expect.objectContaining({ mcpConfig: { mcpServers: {} } })
      }
    })
    expect(input.setMcpToolAutoApprove).toHaveBeenCalledWith('filesystem', 'read_file', true)
    expect(input.callMcpTool).toHaveBeenCalledWith({
      serverName: 'filesystem',
      toolName: 'read_file',
      arguments: { path: '/tmp/readme.md' }
    })
    expect(input.replaceChatConversationMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.arrayContaining([expect.objectContaining({ id: 'mcp-tool-1', text: 'file content' })])
    )
  })

  it('rejects MCP tool calls without executing the tool', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAiChatActionsIpc(ipcMain, input)

    await expect(handlers.get('ai:mcp-tool-call:reject')?.({}, { conversationId: 'conv-1', messageId: 'mcp-tool-1' })).resolves.toEqual({
      ok: true,
      data: {
        status: 'rejected',
        conversation: input.state.conversation,
        messages: expect.arrayContaining([expect.objectContaining({ id: 'mcp-tool-1', action: 'rejected', state: 'done' })])
      }
    })
    expect(input.callMcpTool).not.toHaveBeenCalled()
    expect(input.setMcpToolAutoApprove).not.toHaveBeenCalled()
  })

  it('returns stable failures for invalid or missing MCP tool call targets', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerAiChatActionsIpc(ipcMain, createRegistrationInput())

    await expect(handlers.get('ai:mcp-tool-call:approve')?.({}, { conversationId: '', messageId: 'mcp-tool-1' })).resolves.toEqual({
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_TARGET_REQUIRED',
      errorMessage: 'AI MCP tool call approval requires a conversation and message id.'
    })
    await expect(handlers.get('ai:mcp-tool-call:approve')?.({}, { conversationId: 'conv-1', messageId: 'missing' })).resolves.toEqual({
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_NOT_FOUND',
      errorMessage: 'AI MCP tool call message was not found.'
    })
  })

  it('approves and rejects MCP resource access with backend history persistence', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerAiChatActionsIpc(ipcMain, input)

    await expect(handlers.get('ai:mcp-resource-access:approve')?.({}, { conversationId: 'conv-1', messageId: 'mcp-resource-1' })).resolves.toEqual({
      ok: true,
      data: {
        status: 'approved',
        conversation: input.state.conversation,
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'mcp-resource-1',
            action: 'approved',
            say: 'command_output',
            state: 'done',
            text: 'resource content'
          })
        ]),
        resourceAccess: expect.objectContaining({ serverName: 'filesystem', uri: 'file:///tmp/readme.md' })
      }
    })
    expect(input.readMcpResource).toHaveBeenCalledWith({ serverName: 'filesystem', uri: 'file:///tmp/readme.md' })
    expect(input.formatMcpResourceReadContent).toHaveBeenCalledWith([{ uri: 'file:///tmp/readme.md', text: 'resource content' }])

    input.state.messages = [{ id: 'user-1', role: 'user', text: 'read file' }, resourceMessage('mcp-resource-reject')] as AiChatHistoryMessage[]
    await expect(handlers.get('ai:mcp-resource-access:reject')?.({}, { conversationId: 'conv-1', messageId: 'mcp-resource-reject' })).resolves.toEqual({
      ok: true,
      data: {
        status: 'rejected',
        conversation: input.state.conversation,
        messages: expect.arrayContaining([expect.objectContaining({ id: 'mcp-resource-reject', action: 'rejected', state: 'done' })])
      }
    })
  })

  it('exports chat through injected save dialog ownership and backend Markdown writer', async () => {
    const { registerAiChatActionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const outputDir = await createTempDir()
    const outputFile = join(outputDir, 'exported.md')
    const event = { sender: { id: 7 } }
    const input = createRegistrationInput({
      showChatExportSaveDialog: vi.fn(async (_event, options) => {
        expect(options).toEqual({ defaultPath: 'MCP approvals.md', filters: [{ name: 'Markdown Files', extensions: ['md'] }] })
        return { canceled: false, filePath: outputFile }
      })
    })

    registerAiChatActionsIpc(ipcMain, input)

    await expect(
      handlers.get('chat:export')?.(event, {
        title: 'MCP approvals',
        messages: [{ id: 'user-1', role: 'user', text: 'export this chat' }]
      })
    ).resolves.toEqual({
      ok: true,
      data: {
        exported: 1,
        fileName: 'MCP approvals.md',
        filePath: outputFile,
        bytes: expect.any(Number),
        markdown: expect.any(String)
      }
    })
    expect(input.showChatExportSaveDialog).toHaveBeenCalledWith(event, {
      defaultPath: 'MCP approvals.md',
      filters: [{ name: 'Markdown Files', extensions: ['md'] }]
    })
    expect(await readFile(outputFile, 'utf-8')).toContain('export this chat')
    await expect(stat(outputFile)).resolves.toMatchObject({ size: expect.any(Number) })
    expect(basename(outputFile)).toBe('exported.md')
  })
})
