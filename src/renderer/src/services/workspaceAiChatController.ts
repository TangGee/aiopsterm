import { computed, type Ref } from 'vue'
import {
  isAiCommandCatalogData,
  isAiContextCatalogData,
  isAiTodoSnapshotData,
  malformedAiBackendResultMessage
} from '@/services/aiBackendGuards'
import { aiCatalogClient } from '@/services/aiCatalogClient'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatConversationDeleteData,
  isAiChatConversationMutationData,
  isAiChatConversationRestoreData,
  isAiChatExchangeRequestDataForRequest,
  isAiChatHistorySnapshotData,
  isAiChatMessageMetadataData,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest,
  isAiMcpResourceAccessActionData,
  isAiMcpToolCallActionData,
  type AiMcpResourceAccessActionData,
  type AiMcpToolCallActionData
} from '@/services/aiChatBackendGuards'
import { aiChatClient } from '@/services/aiChatClient'
import {
  hasStructuredAiContentParts,
  plainTextFromAiContentParts,
  sendableAiContentParts
} from '@/services/aiPanelInputRuntime'
import { chatHistoryClient } from '@/services/chatHistoryClient'
import {
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledgeClient'
import {
  buildAgentCommandOutputMessagesForRequest,
  buildAgentCommandOutputPrompt,
  createAgentCommandOutputMessages
} from '@/services/terminalAgentLoopRuntime'
import { normalizeMcpServersConfig, type AiPreferenceSettings } from '@/services/workspaceConfigRuntime'
import type { TerminalCommandSource, TerminalSecurityDecision } from '@/services/terminalExecutionRuntime'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'
import type { I18nKey } from '@/i18n/messages'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type {
  AiChatContextUsageSnapshot,
  AiChatConversationRecord,
  AiChatExchangeRequestInput,
  AiChatHistoryHostContext,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatMessageState,
  AiChatResponseInput,
  AiCommandCatalogOption,
  AiCommandChipRef,
  AiContentPart,
  AiContextCatalog,
  AiContextOption,
  AiTodoItem
} from '@shared/contracts/aiChat'
import type { KnowledgeBaseCreateResult, KnowledgeNode } from '@shared/contracts/knowledgeBase'

type SendChatOptions = {
  mode?: NonNullable<AiChatResponseInput['mode']>
  skipKnowledgeSearch?: boolean
}

type AiContextUsage = AiChatContextUsageSnapshot

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiContextOption[]
  state?: AiChatMessageState
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
  commandExecutionStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
  commandExecutionMessage?: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
}

export type TodoItem = AiTodoItem

export type ConversationItem = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

type WorkspaceAiChatControllerState = {
  mode: Ref<'terminal' | 'agents'>
  config: Ref<UserConfig>
  aiPreferences: Ref<AiPreferenceSettings>
  conversations: Ref<ConversationItem[]>
  selectedConversationId: Ref<string>
  aiContextCatalog: Ref<AiContextCatalog>
  aiCommandOptions: Ref<AiCommandCatalogOption[]>
  selectedContexts: Ref<AiContextOption[]>
  selectedCommandId: Ref<string | null>
  selectedCommandRef: Ref<AiCommandChipRef | null>
  todoItems: Ref<TodoItem[]>
  chatMessages: Ref<ChatMessage[]>
  aiContextUsage: Ref<AiContextUsage | null>
  mcpConfigEditorContent: Ref<string>
  kbSelectedKeys: Ref<string[]>
  settingsSkills: Ref<Array<{ name: string }>>
}

type WorkspaceAiChatControllerDeps = {
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
  createRendererLocalId: (prefix: 'aichat-agent-loop') => string
  resolveAiKnowledgeSearchContexts: (prompt: string, contexts: AiContextOption[]) => Promise<AiContextOption[]>
  applyMcpServersSnapshot: (snapshot: ReturnType<typeof normalizeMcpServersConfig>) => void
  resolveActiveWritableTerminalPanel: () => Pick<TerminalPanel, 'id' | 'output'> | null | undefined
  runActiveTerminalCommand: (command: string, source?: TerminalCommandSource) => Promise<TerminalSecurityDecision | null>
  waitForTerminalOutputAfter: (panelId: string, startLength: number, timeoutMs?: number) => Promise<string>
  findKnowledgeNode: (relPath: string) => KnowledgeNode | null
  backendKnowledgeEntryOrNotice: (result: unknown, notice: string) => KnowledgeBaseCreateResult | null
  uniqueKnowledgeFileName: (parentRelDir: string, name: string) => string
  refreshKnowledgeTree: () => Promise<boolean>
  openKnowledgeFile: (relPath: string) => void
  createSkill: (
    skill: { name: string; description: string; content: string },
    options?: { closeModal?: boolean; duplicateNotice?: boolean; successNotice?: string | false }
  ) => Promise<{ name: string } | null>
}

const autoNamedConversationTitles = new Set([
  '新会话',
  '新建会话',
  '未命名会话',
  '新建對話',
  '未命名對話',
  'New chat',
  'Untitled chat',
  'New Chat',
  'Untitled Chat',
  '新しいチャット',
  '無題のチャット',
  '새 채팅',
  '제목 없는 채팅',
  'Neuer Chat',
  'Unbenannter Chat',
  'Nouveau chat',
  'Chat sans titre',
  'Nuova chat',
  'Chat senza titolo',
  'Nova conversa',
  'Conversa sem título',
  'Новый чат',
  'Чат без названия',
  'محادثة جديدة',
  'محادثة بلا عنوان'
])
const isAutoNamedConversationTitle = (title: string) => autoNamedConversationTitles.has(title.trim())
const conversationTitleFromPrompt = (prompt: string) => {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized
}

const cloneStructuredValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const createWorkspaceAiChatController = (
  state: WorkspaceAiChatControllerState,
  deps: WorkspaceAiChatControllerDeps
) => {
  const {
    mode,
    config,
    aiPreferences,
    conversations,
    selectedConversationId,
    aiContextCatalog,
    aiCommandOptions,
    selectedContexts,
    selectedCommandId,
    selectedCommandRef,
    todoItems,
    chatMessages,
    aiContextUsage,
    mcpConfigEditorContent,
    kbSelectedKeys,
    settingsSkills
  } = state
  const {
    setTopNotice,
    i18nText,
    createRendererLocalId,
    resolveAiKnowledgeSearchContexts,
    applyMcpServersSnapshot,
    resolveActiveWritableTerminalPanel,
    runActiveTerminalCommand,
    waitForTerminalOutputAfter,
    findKnowledgeNode,
    backendKnowledgeEntryOrNotice,
    uniqueKnowledgeFileName,
    refreshKnowledgeTree,
    openKnowledgeFile,
    createSkill
  } = deps

  const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.ts - a.ts))
  const aiSkillContextOptions = computed<AiContextOption[]>(
    () => aiContextCatalog.value.categories.find((category) => category.id === 'skills')?.options.map((option) => ({ ...option })) || []
  )
  const todoProgress = computed(() => {
    const total = todoItems.value.length
    const completed = todoItems.value.filter((todo) => todo.status === 'completed').length
    const inProgress = todoItems.value.filter((todo) => todo.status === 'in_progress').length
    return {
      total,
      completed,
      inProgress,
      pending: total - completed - inProgress,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100)
    }
  })

  const clearAiContextUsage = () => {
    aiContextUsage.value = null
  }

  const applyAiContextUsage = (usage: AiContextUsage) => {
    aiContextUsage.value = cloneStructuredValue(usage)
  }

  const cloneConversationRecord = (conversation: AiChatConversationRecord): ConversationItem => ({
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    updatedAt: conversation.updatedAt,
    ts: conversation.ts,
    ipAddress: conversation.ipAddress,
    favorite: conversation.favorite
  })

  const applyChatHistorySnapshot = (snapshot: { conversations: AiChatConversationRecord[]; selectedConversationId: string }) => {
    conversations.value = snapshot.conversations.map(cloneConversationRecord)
    selectedConversationId.value = conversations.value.some((conversation) => conversation.id === snapshot.selectedConversationId)
      ? snapshot.selectedConversationId
      : conversations.value[0]?.id || ''
  }

  const historyHostToContext = (host: AiChatHistoryHostContext): AiContextOption => ({
    id: host.id,
    kind: 'hosts',
    label: host.label,
    detail: host.detail
  })

  const chatHistoryMessageToChatMessage = (message: AiChatHistoryMessage): ChatMessage => ({
    id: message.id,
    role: message.role,
    text: message.text,
    contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
    hosts: message.hosts?.map(historyHostToContext),
    state: message.state,
    favorite: message.favorite,
    feedback: message.feedback,
    executedCommand: message.executedCommand,
    commandExecutionStatus: message.commandExecutionStatus,
    commandExecutionMessage: message.commandExecutionMessage,
    ask: message.ask,
    say: message.say,
    action: message.action,
    commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
    mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
    mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
    followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
    selectedOption: message.selectedOption,
    partial: message.partial
  })

  const chatMessageToHistoryMessage = (message: ChatMessage): AiChatHistoryMessage | null => {
    const text = message.text.trim()
    if (!text) return null
    const hosts = message.hosts
      ?.filter((host) => host.kind === 'hosts' && host.label.trim())
      .map((host): AiChatHistoryHostContext => ({
        id: host.id,
        kind: 'hosts',
        label: host.label,
        detail: host.detail
      }))
    return {
      id: message.id,
      role: message.role,
      text,
      hosts: hosts?.length ? hosts : undefined,
      state: message.state,
      favorite: message.favorite,
      feedback: message.feedback,
      contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
      executedCommand: message.executedCommand,
      commandExecutionStatus: message.commandExecutionStatus,
      commandExecutionMessage: message.commandExecutionMessage,
      ask: message.ask,
      say: message.say,
      action: message.action,
      commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
      mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
      mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
      followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
      selectedOption: message.selectedOption,
      partial: message.partial
    }
  }

  const currentChatHistoryMessages = () => chatMessages.value.map(chatMessageToHistoryMessage).filter(Boolean) as AiChatHistoryMessage[]

  const restoreChatMessagesFromBackend = async (id: string) => {
    const restoreChatConversation = chatHistoryClient.restoreChatConversation()
    if (!restoreChatConversation) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await restoreChatConversation(id)
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatConversationRestoreData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    const data = result.data
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    chatMessages.value = data.messages.map(chatHistoryMessageToChatMessage)
    if (data.truncated) {
      setTopNotice(i18nText('ai.historyRestoreTruncated', { count: data.returnedMessages ?? data.messages.length }))
    }
    clearAiContextUsage()
    return true
  }

  const loadChatConversationsFromBackend = async (options: { restoreIfEmpty?: boolean } = {}) => {
    const listChatConversations = chatHistoryClient.listChatConversations()
    if (!listChatConversations) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await listChatConversations()
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatHistorySnapshotData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    applyChatHistorySnapshot(result.data)
    if (options.restoreIfEmpty !== false && chatMessages.value.length === 0 && selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    }
    return true
  }

  const refreshAiContextCatalog = async (options: { hydrateSelection?: boolean } = { hydrateSelection: false }) => {
    const listAiContextCatalog = aiCatalogClient.listAiContextCatalog()
    if (!listAiContextCatalog) {
      setTopNotice('AI 上下文加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiContextCatalog()
    } catch {
      setTopNotice('AI 上下文加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 上下文加载失败')
      return false
    }
    if (!isAiContextCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiContextCatalog.value = {
      categories: result.data.categories.map((category) => ({
        ...category,
        options: category.options.map((option) => ({ ...option }))
      })),
      openedHosts: result.data.openedHosts.map((host) => ({ ...host })),
      selectedDefaults: result.data.selectedDefaults.map((context) => ({ ...context }))
    }
    if (options.hydrateSelection === true && selectedContexts.value.length === 0) {
      selectedContexts.value = aiContextCatalog.value.selectedDefaults.map((context) => ({ ...context }))
    }
    return true
  }

  const refreshAiCommandCatalog = async () => {
    const listAiCommandCatalog = aiCatalogClient.listAiCommandCatalog()
    if (!listAiCommandCatalog) {
      setTopNotice('AI 命令加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiCommandCatalog()
    } catch {
      setTopNotice('AI 命令加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 命令加载失败')
      return false
    }
    if (!isAiCommandCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiCommandOptions.value = result.data.commands.map((command) => ({ ...command }))
    return true
  }

  const refreshAiTodoSnapshot = async () => {
    const listAiTodoSnapshot = aiCatalogClient.listAiTodoSnapshot()
    if (!listAiTodoSnapshot) return false
    let result
    try {
      result = await listAiTodoSnapshot()
    } catch {
      return false
    }
    if (!result?.ok) return false
    if (!isAiTodoSnapshotData(result.data)) return false
    todoItems.value = result.data.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
    }))
    return true
  }

  let classicChatHydrationPromise: Promise<boolean> | null = null
  const hydrateClassicChatData = async (options: { restoreIfEmpty?: boolean } = {}) => {
    if (classicChatHydrationPromise) return classicChatHydrationPromise
    classicChatHydrationPromise = Promise.all([
      loadChatConversationsFromBackend({ restoreIfEmpty: options.restoreIfEmpty !== false }),
      refreshAiTodoSnapshot(),
      refreshAiContextCatalog({ hydrateSelection: false }),
      refreshAiCommandCatalog()
    ])
      .then((results) => results.every(Boolean))
      .finally(() => {
        classicChatHydrationPromise = null
      })
    return classicChatHydrationPromise
  }

  const updateCurrentConversationSnapshot = async (summary?: string, options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) => {
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
      return false
    }
    let id = selectedConversationId.value
    if (!id || !conversations.value.some((conversation) => conversation.id === id)) {
      const createChatConversation = chatHistoryClient.createChatConversation()
      if (!createChatConversation) {
        if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
        return false
      }
      const created = await createChatConversation()
      if (!created?.ok || !isAiChatConversationMutationData(created.data)) {
        if (options.notifyFailure) setTopNotice(created?.errorMessage || '会话历史写入失败')
        return false
      }
      applyChatHistorySnapshot({
        conversations: created.data.conversations,
        selectedConversationId: created.data.selectedConversationId
      })
      id = created.data.conversation.id
    }
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextTitle = summary && isAutoNamedConversationTitle(conversation.title) ? conversationTitleFromPrompt(summary) || conversation.title : conversation.title
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: summary || conversation.summary,
      favorite: conversation.favorite,
      messages: currentChatHistoryMessages()
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) {
      if (options.notifyFailure) setTopNotice(result?.errorMessage || '会话历史写入失败')
      return false
    }
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const syncCurrentConversationSnapshot = (options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) =>
    updateCurrentConversationSnapshot(undefined, options)

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) => plainTextFromAiContentParts(parts, { mode: 'exchange' })

  const agentAutoRunCommandMessageIds = new Set<string>()
  const agentReadOnlyAutoRunConversationIds = new Set<string>()
  let agentReadOnlyAutoRunPendingWithoutConversation = false

  const isAgentReadOnlyCommandMessage = (message: ChatMessage) =>
    message.role === 'assistant' &&
    message.ask === 'command' &&
    message.state === 'done' &&
    message.action !== 'rejected' &&
    !message.commandExecutionStatus &&
    Boolean(message.commandExecution?.command.trim()) &&
    message.commandExecution?.requiresApproval === false &&
    message.commandExecution.interactive !== true

  const continueAgentCommandLoop = async (input: {
    commandMessageId: string
    command: string
    commandExecution?: ChatMessage['commandExecution']
    terminalPanelId: string
    outputStartLength: number
    outputTimeoutMs?: number
    output?: string
  }) => {
    const command = input.command.trim()
    const commandMessage = chatMessages.value.find((message) => message.id === input.commandMessageId)
    if (!command || !commandMessage) return { status: 'unavailable' as const, reason: '命令卡片不可用，无法继续 Agent 循环。' }
    const outputTimeoutMs = input.outputTimeoutMs ?? Math.max(1000, Math.round(aiPreferences.value.shellIntegrationTimeout * 1000))
    const output = (input.output ?? (await waitForTerminalOutputAfter(input.terminalPanelId, input.outputStartLength, outputTimeoutMs))).trimEnd()
    if (!output.trim()) {
      commandMessage.commandExecutionStatus = 'failed'
      commandMessage.commandExecutionMessage = '命令已发送，但未捕获到终端输出，未继续 Agent 循环。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return { status: 'no-output' as const, reason: commandMessage.commandExecutionMessage }
    }
    const requestId = createRendererLocalId('aichat-agent-loop')
    const { commandOutputMessage, assistantMessage } = createAgentCommandOutputMessages({
      requestId,
      command,
      output,
      commandExecution: input.commandExecution
    })
    chatMessages.value.push(commandOutputMessage, assistantMessage)
    const filterOptions = { enabled: aiPreferences.value.commandOutputFilteringEnabled }
    const prompt = buildAgentCommandOutputPrompt(command, output, filterOptions)
    const messages: AiChatMessageInput[] = buildAgentCommandOutputMessagesForRequest(chatMessages.value.slice(-16), commandOutputMessage.id, filterOptions)
    void refreshAiTodoSnapshot()
    void generateAiResponseForMessage(assistantMessage.id, {
      requestId,
      assistantMessageId: assistantMessage.id,
      prompt,
      messages,
      model: config.value.modelName,
      mode: 'agent'
    })
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    return { status: 'continued' as const, output, assistantMessageId: assistantMessage.id, requestId }
  }

  const autoRunAgentReadOnlyCommand = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message || !isAgentReadOnlyCommandMessage(message)) return
    if (agentAutoRunCommandMessageIds.has(message.id)) return
    agentAutoRunCommandMessageIds.add(message.id)
    const command = message.commandExecution!.command.trim()
    const terminalPanel = resolveActiveWritableTerminalPanel()
    const outputStartLength = terminalPanel?.output.length ?? 0
    const terminalPanelId = terminalPanel?.id || ''
    message.commandExecutionStatus = 'running'
    message.commandExecutionMessage = '查询类命令自动执行中...'
    void updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    const decision = await runActiveTerminalCommand(command, 'agent')
    if (!decision) {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '终端会话不可用，请先打开本地 shell 或连接 SSH。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'needs-approval') {
      message.commandExecutionStatus = 'pending'
      message.commandExecutionMessage = '命令已送入终端安全确认。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'blocked') {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '命令被安全策略拦截。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'unavailable') {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = decision.reason
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (!terminalPanelId) {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '终端会话不可用，请先打开本地 shell 或连接 SSH。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    message.executedCommand = command
    message.commandExecutionStatus = 'running'
    message.commandExecutionMessage = '查询类命令已发送，正在等待终端输出...'
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    const loopResult = await continueAgentCommandLoop({
      commandMessageId: message.id,
      command,
      commandExecution: {
        ...message.commandExecution!,
        command
      },
      terminalPanelId,
      outputStartLength
    })
    if (loopResult.status === 'continued') {
      message.commandExecutionStatus = 'succeeded'
      message.commandExecutionMessage = `命令输出已回传 Agent：${command}`
      message.executedCommand = command
    } else {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = loopResult.reason
    }
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
  }

  const scheduleAgentReadOnlyAutoRun = (message: ChatMessage, input: AiChatResponseInput) => {
    const conversationId = selectedConversationId.value.trim()
    if (conversationId && agentReadOnlyAutoRunPendingWithoutConversation) {
      agentReadOnlyAutoRunConversationIds.add(conversationId)
      agentReadOnlyAutoRunPendingWithoutConversation = false
    }
    const sessionAutoRunEnabled = conversationId ? agentReadOnlyAutoRunConversationIds.has(conversationId) : agentReadOnlyAutoRunPendingWithoutConversation
    if (input.mode !== 'agent' || (!aiPreferences.value.autoExecuteReadOnlyCommands && !sessionAutoRunEnabled) || !isAgentReadOnlyCommandMessage(message)) return
    void autoRunAgentReadOnlyCommand(message.id)
  }

  const enableAgentReadOnlyAutoRunForCurrentConversation = () => {
    const conversationId = selectedConversationId.value.trim()
    if (!conversationId) {
      agentReadOnlyAutoRunPendingWithoutConversation = true
      return true
    }
    agentReadOnlyAutoRunConversationIds.add(conversationId)
    agentReadOnlyAutoRunPendingWithoutConversation = false
    return true
  }

  const generateAiResponseForMessage = async (assistantId: string, input: AiChatResponseInput) => {
    const responseBridge = aiChatClient.generateAiChatResponse()
    const failGeneration = (messageText: string) => {
      const message = chatMessages.value.find((item) => item.id === assistantId)
      if (message && message.state === 'streaming') {
        message.state = 'error'
        message.text = messageText
        void updateCurrentConversationSnapshot()
      }
      void refreshAiTodoSnapshot()
    }
    if (typeof responseBridge !== 'function') {
      failGeneration('AI 响应生成服务不可用')
      return
    }
    let result: Awaited<ReturnType<AiopsPreloadApi['generateAiChatResponse']>> | undefined
    try {
      result = await responseBridge(input)
    } catch (error) {
      failGeneration(aiBridgeErrorMessage(error, 'AI 响应生成失败'))
      return
    }
    const message = chatMessages.value.find((item) => item.id === assistantId)
    if (!message || message.state !== 'streaming') {
      void refreshAiTodoSnapshot()
      return
    }
    const requestId = input.requestId?.trim() || aiChatRequestIdFromAssistantMessageId(assistantId)
    const assistantMessageId = input.assistantMessageId?.trim() || assistantId
    const data = result?.data
    if (!result?.ok) {
      message.state = 'error'
      message.text = result?.errorMessage || 'AI 响应生成失败'
    } else if (!requestId || !isAiChatResponseDataForRequest(data, requestId, assistantMessageId)) {
      message.state = 'error'
      message.text = 'AI 响应生成结果无效'
    } else if (data.status === 'cancelled') {
      message.state = 'cancelled'
      message.text = data.text
    } else if (data.message) {
      Object.assign(message, chatHistoryMessageToChatMessage(data.message))
    } else {
      message.state = 'done'
      message.text = data.text
    }
    if (requestId && isAiContextUsageForRequest(data?.contextUsage, requestId, assistantMessageId)) {
      applyAiContextUsage(data.contextUsage)
    }
    scheduleAgentReadOnlyAutoRun(message, input)
    void refreshAiTodoSnapshot()
    void updateCurrentConversationSnapshot()
  }

  const cancelStreamingAiChatResponse = async () => {
    const message = [...chatMessages.value].reverse().find((item) => item.role === 'assistant' && item.state === 'streaming')
    if (!message) return false
    const cancelBridge = aiChatClient.cancelAiChatResponse()
    if (typeof cancelBridge !== 'function') {
      setTopNotice('AI 生成取消服务不可用')
      return false
    }
    const requestId = aiChatRequestIdFromAssistantMessageId(message.id)
    if (!requestId) {
      setTopNotice('AI 生成取消失败')
      return false
    }
    const result = await cancelBridge({
      assistantMessageId: message.id,
      requestId
    }).catch((error) => {
      setTopNotice(aiBridgeErrorMessage(error, 'AI 生成取消失败'))
      return null
    })
    if (!result) return false
    if (!result?.ok || !isAiChatCancelDataForRequest(result.data, requestId, message.id)) {
      setTopNotice(result?.errorMessage || 'AI 生成取消失败')
      return false
    }
    if (message.state !== 'streaming') return true
    message.state = 'cancelled'
    message.text = result.data.text
    if (isAiContextUsageForRequest(result.data.contextUsage, requestId, message.id)) {
      applyAiContextUsage(result.data.contextUsage)
    }
    void refreshAiTodoSnapshot()
    void updateCurrentConversationSnapshot()
    return true
  }

  const hostContextForExchangeRequest = (context: AiContextOption): NonNullable<AiChatExchangeRequestInput['hosts']>[number] | null => {
    if (context.kind !== 'hosts' || !context.label.trim()) return null
    return {
      id: context.id,
      kind: 'hosts',
      label: context.label,
      detail: context.detail
    }
  }

  const appendChatExchange = async (
    text: string,
    contentParts?: AiContentPart[],
    overrideHosts?: AiContextOption[],
    options: SendChatOptions = {}
  ) => {
    const safeContentParts = sendableAiContentParts(contentParts)
    const hasStructuredParts = hasStructuredAiContentParts(safeContentParts)
    const prompt = text.trim() || buildPlainTextFromAiParts(safeContentParts).trim()
    if (!prompt && !hasStructuredParts) return false
    const baseMessageContexts = overrideHosts ? [...overrideHosts, ...selectedContexts.value.filter((item) => item.kind !== 'hosts')] : [...selectedContexts.value]
    const autoKnowledgeContexts = options.skipKnowledgeSearch ? [] : await resolveAiKnowledgeSearchContexts(prompt, baseMessageContexts)
    const messageContexts = [...baseMessageContexts, ...autoKnowledgeContexts]
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const historyForBackend: AiChatMessageInput[] = chatMessages.value.slice(-12).map((message) => ({ role: message.role, text: message.text }))
    const hostContexts = overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    const responseMode = options.mode || (mode.value === 'agents' ? 'agent' : 'command')
    const exchangeBridge = aiChatClient.createAiChatExchangeRequest()
    if (typeof exchangeBridge !== 'function') {
      setTopNotice('AI 请求创建服务不可用')
      return false
    }
    let request: Awaited<ReturnType<AiopsPreloadApi['createAiChatExchangeRequest']>> | undefined
    try {
      request = await exchangeBridge({
        text: prompt,
        hosts: hostContexts.map(hostContextForExchangeRequest).filter(Boolean) as AiChatExchangeRequestInput['hosts'],
        messages: historyForBackend,
        contexts: messageContexts.map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          detail: item.detail,
          relPath: item.relPath,
          mediaType: item.mediaType
        })),
        command: selectedCommandRef.value
          ? {
              id: selectedCommandId.value || undefined,
              label: selectedCommandRef.value.label,
              command: selectedCommandRef.value.command,
              path: selectedCommandRef.value.path
            }
          : commandDisplay
            ? { id: selectedCommandId.value || undefined, label: commandDisplay }
            : null,
        model: config.value.modelName,
        mode: responseMode
      })
    } catch (error) {
      setTopNotice(aiBridgeErrorMessage(error, 'AI 请求创建失败'))
      return false
    }
    if (!request?.ok || !isAiChatExchangeRequestDataForRequest(request.data)) {
      setTopNotice(request?.errorMessage || 'AI 请求创建失败')
      return false
    }
    if (isAiContextUsageForRequest(request.data.contextUsage, request.data.requestId, request.data.assistantMessage.id)) {
      applyAiContextUsage(request.data.contextUsage)
    }
    const userMessage = chatHistoryMessageToChatMessage(request.data.userMessage)
    userMessage.contentParts = safeContentParts.length || hasStructuredParts ? safeContentParts : undefined
    userMessage.hosts = hostContexts
    const assistantMessage = chatHistoryMessageToChatMessage(request.data.assistantMessage)
    chatMessages.value.push(userMessage)
    chatMessages.value.push(assistantMessage)
    void refreshAiTodoSnapshot()
    void generateAiResponseForMessage(assistantMessage.id, {
      ...request.data.responseInput,
      requestId: request.data.responseInput.requestId || request.data.requestId,
      assistantMessageId: request.data.responseInput.assistantMessageId || assistantMessage.id
    })
    await updateCurrentConversationSnapshot(prompt, { notifyFailure: true, notifyUnavailable: true })
    return true
  }

  const sendChat = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[], options?: SendChatOptions) => {
    return appendChatExchange(text, contentParts, overrideHosts, options)
  }

  const resendUserMessageFromParts = async (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = hasStructuredAiContentParts(contentParts)
    if (!prompt && !hasStructuredParts) return false
    chatMessages.value.splice(index)
    clearAiContextUsage()
    return appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts)
  }

  const createConversation = async () => {
    const createChatConversation = chatHistoryClient.createChatConversation()
    if (!createChatConversation) return null
    const result = await createChatConversation()
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return null
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    await restoreChatMessagesFromBackend(result.data.conversation.id)
    return conversations.value.find((conversation) => conversation.id === result.data!.conversation.id) || cloneConversationRecord(result.data.conversation)
  }

  const deleteConversation = async (id: string) => {
    const deleteChatConversation = chatHistoryClient.deleteChatConversation()
    if (!deleteChatConversation) return false
    const result = await deleteChatConversation(id)
    if (!result?.ok || !isAiChatConversationDeleteData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    if (selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    } else {
      chatMessages.value = []
      clearAiContextUsage()
    }
    return true
  }

  const selectConversation = (id: string) => {
    selectedConversationId.value = id
    clearAiContextUsage()
  }

  const renameConversation = async (id: string, title: string) => {
    const nextTitle = title.trim()
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation || !nextTitle) return false
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: conversation.summary,
      favorite: conversation.favorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const toggleConversationFavorite = async (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextFavorite = !conversation.favorite
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await updateChatConversation({
      id,
      title: conversation.title,
      summary: conversation.summary,
      favorite: nextFavorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const restoreConversation = async (id: string) => {
    const restored = await restoreChatMessagesFromBackend(id)
    if (restored) return true
    if (await loadChatConversationsFromBackend({ restoreIfEmpty: false })) {
      return restoreChatMessagesFromBackend(id)
    }
    return false
  }

  const toggleContext = (context: AiContextOption) => {
    selectedContexts.value = selectedContexts.value.some((item) => item.id === context.id)
      ? selectedContexts.value.filter((item) => item.id !== context.id)
      : [...selectedContexts.value, context]
  }

  const removeContext = (id: string) => {
    selectedContexts.value = selectedContexts.value.filter((item) => item.id !== id)
  }

  const applyCommandPreset = (id: string, prompt: string) => {
    selectedCommandId.value = id
    selectedCommandRef.value = null
    void sendChat(prompt)
  }

  const selectCommandPreset = (id: string | null, commandRef?: AiCommandChipRef | null) => {
    selectedCommandId.value = id
    selectedCommandRef.value = id && commandRef ? { ...commandRef } : null
  }

  const applyMessageMetadataSnapshot = (messageId: string, messages: AiChatHistoryMessage[]) => {
    const snapshot = messages.find((message) => message.id === messageId)
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!snapshot || !message) return false
    message.favorite = snapshot.favorite
    message.feedback = snapshot.feedback
    return true
  }

  const applyChatMessageSnapshot = (messages: AiChatHistoryMessage[]) => {
    chatMessages.value = messages.map(chatHistoryMessageToChatMessage)
    clearAiContextUsage()
  }

  const applyAiMcpToolCallResult = (data: AiMcpToolCallActionData) => {
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    applyChatMessageSnapshot(data.messages)
    if (data.mcpConfig) {
      applyMcpServersSnapshot(normalizeMcpServersConfig(data.mcpConfig.mcpServers, data.mcpConfig.mcpToolStates))
      mcpConfigEditorContent.value = JSON.stringify(data.mcpConfig.mcpConfig, null, 2)
    }
  }

  const applyAiMcpResourceAccessResult = (data: AiMcpResourceAccessActionData) => {
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    applyChatMessageSnapshot(data.messages)
  }

  const runAiMcpToolCallAction = async (messageId: string, action: 'approve' | 'reject', options: { autoApprove?: boolean } = {}) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message?.mcpToolCall || message.ask !== 'mcp_tool_call') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpToolCall() : aiChatClient.rejectAiMcpToolCall()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 工具审批服务不可用')
      return false
    }
    const synced = await updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId,
      autoApprove: options.autoApprove
    })
    if (!result?.ok || !isAiMcpToolCallActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 工具审批失败')
      return false
    }
    applyAiMcpToolCallResult(result.data)
    return result.data.status
  }

  const approveAiMcpToolCall = (messageId: string, options: { autoApprove?: boolean } = {}) => runAiMcpToolCallAction(messageId, 'approve', options)

  const rejectAiMcpToolCall = (messageId: string) => runAiMcpToolCallAction(messageId, 'reject')

  const runAiMcpResourceAccessAction = async (messageId: string, action: 'approve' | 'reject') => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message?.mcpResourceAccess || message.ask !== 'mcp_resource_access') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpResourceAccess() : aiChatClient.rejectAiMcpResourceAccess()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 资源审批服务不可用')
      return false
    }
    const synced = await updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId
    })
    if (!result?.ok || !isAiMcpResourceAccessActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 资源审批失败')
      return false
    }
    applyAiMcpResourceAccessResult(result.data)
    return result.data.status
  }

  const approveAiMcpResourceAccess = (messageId: string) => runAiMcpResourceAccessAction(messageId, 'approve')

  const rejectAiMcpResourceAccess = (messageId: string) => runAiMcpResourceAccessAction(messageId, 'reject')

  const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    const saveChatMessageMetadata = chatHistoryClient.saveChatMessageMetadata()
    if (!saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const nextFeedback = message.feedback === feedback ? null : feedback
    const result = await saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      feedback: nextFeedback
    })
    if (!result?.ok || !isAiChatMessageMetadataData(result.data)) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const toggleMessageFavorite = async (id: string) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    const saveChatMessageMetadata = chatHistoryClient.saveChatMessageMetadata()
    if (!saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const result = await saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      favorite: !message.favorite
    })
    if (!result?.ok || !isAiChatMessageMetadataData(result.data)) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const retryAssistantMessage = (messageId?: string) => {
    const assistantIndex = messageId
      ? chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'assistant')
      : -1
    const history = assistantIndex >= 0 ? chatMessages.value.slice(0, assistantIndex) : chatMessages.value
    const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) {
      void sendChat(lastUserMessage.text, lastUserMessage.contentParts, lastUserMessage.hosts)
      return true
    }
    return false
  }

  const retryLastAssistantMessage = () => {
    return retryAssistantMessage()
  }

  const messagePlainText = (message: ChatMessage) =>
    message.contentParts?.length ? buildPlainTextFromAiParts(message.contentParts).trim() : message.text.trim()

  const messageSummaryContent = (message: ChatMessage) => {
    const body = messagePlainText(message)
    const hosts = message.hosts?.length ? `\n\nHosts: ${message.hosts.map((host) => host.label).join(', ')}` : ''
    return `# AI Message Summary\n\nRole: ${message.role}\nMessage ID: ${message.id}\n\n${body}${hosts}\n`
  }

  const knowledgeFileNameForMessage = (message: ChatMessage) => {
    const safeId = message.id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'message'
    return `ai-message-${safeId}.md`
  }

  const ensureLocalKnowledgeDir = async (title: string) => {
    const relPath = title
    const existing = findKnowledgeNode(relPath)
    if (existing?.type === 'dir') return existing
    const kbMkdir = knowledgeClient.kbMkdir()
    if (!kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbMkdir('', title)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const createdRelPath = entry.relPath.trim()
    if (createdRelPath !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    if (entry.type !== 'dir') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    return created?.type === 'dir' ? created : null
  }

  const summarizeMessageToKnowledge = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const content = messageSummaryContent(message)
    const summaryDir = await ensureLocalKnowledgeDir('summary')
    if (!summaryDir) return null
    const fileName = uniqueKnowledgeFileName('summary', knowledgeFileNameForMessage(message))
    const kbCreateFile = knowledgeClient.kbCreateFile()
    const kbWriteFile = knowledgeClient.kbWriteFile()
    if (!kbCreateFile || !kbWriteFile) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbCreateFile('summary', fileName, content)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    if (!isKnowledgeRelPathInParentWithRequestedName(relPath, 'summary', fileName) || entry.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const writeResult = await kbWriteFile(relPath, content)
    if (!isKnowledgeWriteResultData(writeResult) || writeResult.relPath.trim() !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    if (!created || created.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }

    kbSelectedKeys.value = [relPath]
    openKnowledgeFile(relPath)
    return { relPath, content }
  }

  const alphaSuffix = (index: number) => {
    let value = index
    let suffix = ''
    do {
      suffix = String.fromCharCode(97 + (value % 26)) + suffix
      value = Math.floor(value / 26) - 1
    } while (value >= 0)
    return suffix
  }

  const skillNameForMessage = (message: ChatMessage) => {
    const words = messagePlainText(message)
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.filter((word) => word.length > 2)
      .slice(0, 3)
    const rawBase = words?.length ? `${words.join('-')}-skill` : 'ai-message-skill'
    let candidate = rawBase.replace(/[^a-z-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'ai-message-skill'
    let index = 0
    while (settingsSkills.value.some((skill) => skill.name === candidate)) {
      candidate = `${rawBase}-${alphaSuffix(index)}`
      index += 1
    }
    return candidate
  }

  const summarizeMessageToSkill = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const name = skillNameForMessage(message)
    const plainText = messagePlainText(message)
    const skill = {
      name,
      description: `Summarized from AI message ${message.id}`,
      content: `Use this runbook when a similar operations context appears.\n\nSource message:\n${plainText}`,
      enabled: true,
      editable: true
    }
    return createSkill(skill, { successNotice: false })
  }

  return {
    sortedConversations,
    todoProgress,
    aiSkillContextOptions,
    clearAiContextUsage,
    applyAiContextUsage,
    currentChatHistoryMessages,
    restoreChatMessagesFromBackend,
    loadChatConversationsFromBackend,
    refreshAiContextCatalog,
    refreshAiCommandCatalog,
    refreshAiTodoSnapshot,
    hydrateClassicChatData,
    updateCurrentConversationSnapshot,
    syncCurrentConversationSnapshot,
    continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation,
    sendChat,
    cancelStreamingAiChatResponse,
    resendUserMessageFromParts,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    toggleContext,
    removeContext,
    applyCommandPreset,
    selectCommandPreset,
    approveAiMcpToolCall,
    rejectAiMcpToolCall,
    approveAiMcpResourceAccess,
    rejectAiMcpResourceAccess,
    setMessageFeedback,
    toggleMessageFavorite,
    retryAssistantMessage,
    retryLastAssistantMessage,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  }
}
