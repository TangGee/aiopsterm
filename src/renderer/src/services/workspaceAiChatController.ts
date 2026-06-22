import { computed, type Ref } from 'vue'
import { malformedAiBackendResultMessage } from '@/services/aiBackendGuards'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatExchangeRequestDataForRequest,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest
} from '@/services/aiChatBackendGuards'
import { aiChatClient } from '@/services/aiChatClient'
import {
  hasStructuredAiContentParts,
  plainTextFromAiContentParts,
  sendableAiContentParts
} from '@/services/aiPanelInputRuntime'
import {
  buildAgentCommandOutputMessagesForRequest,
  buildAgentCommandOutputPrompt,
  createAgentCommandOutputMessages
} from '@/services/terminalAgentLoopRuntime'
import { createWorkspaceAiChatCatalogRuntime } from '@/services/workspaceAiChatCatalogRuntime'
import {
  chatHistoryMessageToChatMessage,
  cloneStructuredValue,
  createWorkspaceAiChatHistoryRuntime
} from '@/services/workspaceAiChatHistoryRuntime'
import { createWorkspaceAiChatMcpRuntime } from '@/services/workspaceAiChatMcpRuntime'
import { createWorkspaceAiChatSummaryRuntime } from '@/services/workspaceAiChatSummaryRuntime'
import type {
  AiContextUsage,
  ChatMessage,
  ConversationItem,
  SendChatOptions,
  TodoItem,
  WorkspaceAiChatControllerDeps,
  WorkspaceAiChatControllerState
} from '@/services/workspaceAiChatTypes'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type {
  AiChatExchangeRequestInput,
  AiChatMessageInput,
  AiChatResponseInput,
  AiCommandChipRef,
  AiContentPart,
  AiContextOption
} from '@shared/contracts/aiChat'

export type { ChatMessage, ConversationItem, TodoItem } from '@/services/workspaceAiChatTypes'

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
