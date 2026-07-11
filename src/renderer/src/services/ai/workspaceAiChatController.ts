import { computed, type Ref } from 'vue'
import { malformedAiBackendResultMessage } from '@/services/ai/aiBackendGuards'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatExchangeRequestDataForRequest,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest
} from '@/services/ai/aiChatBackendGuards'
import { aiChatClient } from '@/services/ai/aiChatClient'
import {
  applyClassicClineTaskEvent,
  isActiveClassicClineTaskMessage
} from '@/services/ai/classicClineTaskRuntime'
import {
  hasStructuredAiContentParts,
  plainTextFromAiContentParts,
  sendableAiContentParts
} from '@/services/ai/aiPanelInputRuntime'
import { createWorkspaceAiChatCatalogRuntime } from '@/services/ai/workspaceAiChatCatalogRuntime'
import {
  chatHistoryMessageToChatMessage,
  cloneStructuredValue,
  createWorkspaceAiChatHistoryRuntime
} from '@/services/ai/workspaceAiChatHistoryRuntime'
import { createWorkspaceAiChatMcpRuntime } from '@/services/ai/workspaceAiChatMcpRuntime'
import { createWorkspaceAiChatSummaryRuntime } from '@/services/ai/workspaceAiChatSummaryRuntime'
import type {
  AiContextUsage,
  ChatMessage,
  ConversationItem,
  SendChatOptions,
  TodoItem,
  WorkspaceAiChatControllerDeps,
  WorkspaceAiChatControllerState
} from '@/services/ai/workspaceAiChatTypes'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type {
  AiChatExchangeRequestInput,
  AiChatMessageInput,
  AiChatResponseInput,
  AiCommandChipRef,
  AiContentPart,
  AiContextOption
} from '@shared/contracts/aiChat'
import type { ClineAgentTaskEvent } from '@shared/contracts/clineAgent'

export type { ChatMessage, ConversationItem, TodoItem } from '@/services/ai/workspaceAiChatTypes'

export const createWorkspaceAiChatController = (
  state: WorkspaceAiChatControllerState,
  deps: WorkspaceAiChatControllerDeps
) => {
  const {
    mode,
    config,
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
    resolveAiKnowledgeSearchContexts,
    applyMcpServersSnapshot,
    resolveActiveWritableTerminalPanel,
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

  const applyAiContextUsage = (usage: AiContextUsage) => {
    aiContextUsage.value = cloneStructuredValue(usage)
  }

  const chatHistoryRuntime = createWorkspaceAiChatHistoryRuntime({
    state: {
      conversations,
      selectedConversationId,
      chatMessages,
      aiContextUsage
    },
    setTopNotice,
    i18nText
  })

  const {
    clearAiContextUsage,
    currentChatHistoryMessages,
    restoreChatMessagesFromBackend,
    loadChatConversationsFromBackend,
    updateCurrentConversationSnapshot,
    syncCurrentConversationSnapshot,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    setMessageFeedback,
    toggleMessageFavorite
  } = chatHistoryRuntime

  const pendingClineEvents = new Map<string, ClineAgentTaskEvent[]>()
  const shouldPersistClineEvent = (event: ClineAgentTaskEvent) =>
    event.type === 'approval-requested' ||
    event.type === 'tool-result' ||
    event.type === 'done' ||
    event.type === 'cancelled' ||
    event.type === 'error'
  const applyClineEvent = (event: ClineAgentTaskEvent) => {
    const root = chatMessages.value.find((message) => message.id === event.turnId)
    if (!root?.agentTask) {
      const pending = pendingClineEvents.get(event.turnId) || []
      pending.push(event)
      pendingClineEvents.set(event.turnId, pending.slice(-128))
      return false
    }
    const applied = applyClassicClineTaskEvent(chatMessages.value, event)
    if (applied && shouldPersistClineEvent(event)) void updateCurrentConversationSnapshot()
    return applied
  }
  const flushPendingClineEvents = (turnId: string) => {
    const pending = pendingClineEvents.get(turnId) || []
    pendingClineEvents.delete(turnId)
    for (const event of pending) applyClassicClineTaskEvent(chatMessages.value, event)
    if (pending.some(shouldPersistClineEvent)) void updateCurrentConversationSnapshot()
  }
  aiChatClient.onClineAgentTaskEvent()?.(applyClineEvent)

  const catalogRuntime = createWorkspaceAiChatCatalogRuntime({
    state: {
      aiContextCatalog,
      aiCommandOptions,
      selectedContexts,
      todoItems
    },
    setTopNotice,
    loadChatConversationsFromBackend
  })

  const {
    refreshAiContextCatalog,
    refreshAiCommandCatalog,
    refreshAiTodoSnapshot,
    hydrateClassicChatData
  } = catalogRuntime

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) => plainTextFromAiContentParts(parts, { mode: 'exchange' })

  const continueAgentCommandLoop = async (input: {
    commandMessageId: string
    command: string
    commandExecution?: ChatMessage['commandExecution']
    terminalPanelId: string
    outputStartLength: number
    outputTimeoutMs?: number
    output?: string
  }) => {
    void input
    return { status: 'unavailable' as const, reason: 'Classic Agent 命令循环已由 Cline runtime 接管。' }
  }

  const enableAgentReadOnlyAutoRunForCurrentConversation = () => false

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
      message.agentTask = data.agentTask ? cloneStructuredValue(data.agentTask) : undefined
    }
    if (data?.agentTask && !message.agentTask) message.agentTask = cloneStructuredValue(data.agentTask)
    if (message.agentTask) flushPendingClineEvents(message.agentTask.turnId)
    else if (message.state === 'error' || message.state === 'cancelled') pendingClineEvents.delete(assistantId)
    if (requestId && isAiContextUsageForRequest(data?.contextUsage, requestId, assistantMessageId)) {
      applyAiContextUsage(data.contextUsage)
    }
    void refreshAiTodoSnapshot()
    void updateCurrentConversationSnapshot()
  }

  const cancelStreamingAiChatResponse = async () => {
    const message = [...chatMessages.value].reverse().find((item) =>
      item.role === 'assistant' && (item.state === 'streaming' || isActiveClassicClineTaskMessage(item))
    )
    if (!message) return false
    if (isActiveClassicClineTaskMessage(message) && message.agentTask) {
      const abortBridge = aiChatClient.abortClineAgentTask()
      if (typeof abortBridge !== 'function') {
        setTopNotice('Cline Agent 停止服务不可用')
        return false
      }
      const task = { ...message.agentTask }
      const result = await abortBridge({
        taskId: task.taskId,
        turnId: task.turnId,
        reason: 'The operator stopped the Classic Agent turn.'
      }).catch((error) => {
        setTopNotice(aiBridgeErrorMessage(error, 'Cline Agent 停止失败'))
        return null
      })
      if (!result?.ok) {
        setTopNotice(result?.errorMessage || 'Cline Agent 停止失败')
        return false
      }
      for (const item of chatMessages.value) {
        if (item.agentTask?.taskId !== task.taskId || item.agentTask.turnId !== task.turnId) continue
        item.agentTask = { ...item.agentTask, status: 'cancelled' }
        if (item.ask === 'command' && (item.commandExecutionStatus === 'pending' || item.commandExecutionStatus === 'running')) {
          item.commandExecutionStatus = 'failed'
          item.commandExecutionMessage = 'Cline Agent 命令已停止。'
        }
        if (item.state === 'streaming') {
          item.state = 'cancelled'
          if (!item.text.trim()) item.text = '已停止生成。'
        }
      }
      void refreshAiTodoSnapshot()
      void updateCurrentConversationSnapshot()
      return true
    }
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
    let conversationId = selectedConversationId.value.trim()
    if (!conversationId || !conversations.value.some((conversation) => conversation.id === conversationId)) {
      const created = await createConversation()
      conversationId = created?.id.trim() || ''
      if (!conversationId) {
        setTopNotice('会话创建失败')
        return false
      }
    }
    const baseMessageContexts = overrideHosts ? [...overrideHosts, ...selectedContexts.value.filter((item) => item.kind !== 'hosts')] : [...selectedContexts.value]
    const autoKnowledgeContexts = options.skipKnowledgeSearch ? [] : await resolveAiKnowledgeSearchContexts(prompt, baseMessageContexts)
    const messageContexts = [...baseMessageContexts, ...autoKnowledgeContexts]
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const historyForBackend: AiChatMessageInput[] = chatMessages.value.map((message) => ({
      role: message.role,
      text: message.text,
      ask: message.ask,
      say: message.say,
      action: message.action,
      commandExecution: message.commandExecution ? { ...message.commandExecution } : undefined,
      agentTask: message.agentTask ? { ...message.agentTask } : undefined
    }))
    const hostContexts = overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    const responseMode = options.mode || (mode.value === 'agents' ? 'agent' : 'command')
    const terminalSessionId = responseMode === 'agent' ? resolveActiveWritableTerminalPanel()?.sessionId?.trim() : undefined
    const exchangeBridge = aiChatClient.createAiChatExchangeRequest()
    if (typeof exchangeBridge !== 'function') {
      setTopNotice('AI 请求创建服务不可用')
      return false
    }
    let request: Awaited<ReturnType<AiopsPreloadApi['createAiChatExchangeRequest']>> | undefined
    try {
      request = await exchangeBridge({
        text: prompt,
        conversationId,
        terminalSessionId,
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

  const mcpRuntime = createWorkspaceAiChatMcpRuntime({
    state: {
      chatMessages,
      selectedConversationId,
      mcpConfigEditorContent
    },
    history: chatHistoryRuntime,
    setTopNotice,
    applyMcpServersSnapshot
  })

  const {
    approveAiMcpToolCall,
    rejectAiMcpToolCall,
    approveAiMcpResourceAccess,
    rejectAiMcpResourceAccess
  } = mcpRuntime

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

  const summaryRuntime = createWorkspaceAiChatSummaryRuntime({
    state: {
      chatMessages,
      kbSelectedKeys,
      settingsSkills
    },
    setTopNotice,
    findKnowledgeNode,
    backendKnowledgeEntryOrNotice,
    uniqueKnowledgeFileName,
    refreshKnowledgeTree,
    openKnowledgeFile,
    createSkill
  })

  const {
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  } = summaryRuntime

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
