import { computed, watch, type Ref } from 'vue'
import { malformedAiBackendResultMessage } from '@/services/ai/aiBackendGuards'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatExchangeRequestDataForRequest,
  isAiChatHistoryMessage,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest
} from '@/services/ai/aiChatBackendGuards'
import { aiChatClient } from '@/services/ai/aiChatClient'
import { createClineTaskEventLifecycle } from '@/services/ai/clineTaskEventLifecycleRuntime'
import { productSessionClient } from '@/services/ai/productSessionClient'
import {
  applyClassicClineTaskEvent,
  exactClassicApprovalHostTarget,
  isActiveClassicClineTaskMessage
} from '@/services/ai/classicClineTaskRuntime'
import {
  classicHostTargetId,
  classicSessionContextRefs,
  restoreClassicSessionContexts,
  sendableClassicSessionContexts
} from '@/services/ai/classicSessionContextRuntime'
import {
  hasStructuredAiContentParts,
  plainTextFromAiContentParts,
  sendableAiContentParts
} from '@/services/ai/aiPanelInputRuntime'
import { createWorkspaceAiChatCatalogRuntime } from '@/services/ai/workspaceAiChatCatalogRuntime'
import {
  chatHistoryMessageToChatMessage,
  chatMessageToHistoryMessage,
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
import {
  chatImageAttachmentBase64ByteLength,
  MAX_CHAT_IMAGE_ATTACHMENT_BYTES,
  MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE,
  validateChatImageAttachment
} from '@shared/chatImageAttachment'
import type {
  AiChatExchangeRequestInput,
  AiChatMessageInput,
  AiChatResponseInput,
  AiCommandChipRef,
  AiContentPart,
  AiContextOption
} from '@shared/contracts/aiChat'
import {
  CLINE_AGENT_MAX_HOST_TARGETS,
  type ClineAgentHostTarget,
  type ClineAgentTaskEvent
} from '@shared/contracts/clineAgent'
import {
  clineAgentTaskIdentityKey,
  type ClineAgentTaskIdentity
} from '@shared/clineAgentTaskIdentity'
import type {
  ProductSessionClassicContext,
  ProductSessionRecord
} from '@shared/contracts/productSessions'

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
    openedHostContexts = () => [],
    activeHostContext = () => null,
    resolveActiveWritableTerminalPanel,
    resolveClassicHostTerminalPanel,
    openTerminalForAiHostContext,
    activateTerminalPanel,
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

  let restoreClassicContextProjection: (id: string) => Promise<void> = async () => undefined

  const chatHistoryRuntime = createWorkspaceAiChatHistoryRuntime({
    state: {
      conversations,
      selectedConversationId,
      chatMessages,
      aiContextUsage
    },
    setTopNotice,
    i18nText,
    afterConversationRestored: (id) => restoreClassicContextProjection(id)
  })

  const {
    clearAiContextUsage,
    currentChatHistoryMessages,
    currentClineSeedMessages,
    applyProjectionRevisionWindow,
    restoreChatMessagesFromBackend,
    loadOlderConversationMessages,
    loadChatConversationsFromBackend,
    deselectConversation: deselectConversationHistory,
    updateCurrentConversationSnapshot,
    syncCurrentConversationSnapshot,
    createConversation: createConversationHistory,
    deleteConversation: deleteConversationHistory,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation: restoreConversationHistory,
    updateConversationSnapshot,
    setMessageFeedback,
    toggleMessageFavorite
  } = chatHistoryRuntime

  const clineMessagesByConversationId = new Map<string, ChatMessage[]>()
  const clineConversationRouteByTask = new Map<string, ClineAgentTaskIdentity & {
    conversationId: string
    responseMode?: NonNullable<AiChatResponseInput['mode']>
  }>()
  const clineSnapshotQueues = new Map<string, Promise<boolean>>()
  const clineSnapshotGenerations = new Map<string, number>()
  const clineSnapshotBlocked = new Set<string>()
  const shouldPersistClineEvent = (event: ClineAgentTaskEvent) =>
    event.type === 'tool-call' ||
    event.type === 'approval-requested' ||
    event.type === 'tool-result' ||
    event.type === 'done' ||
    event.type === 'cancelled' ||
    event.type === 'error'

  const persistClineConversationSnapshot = (conversationId: string, messages: ChatMessage[]) => {
    if (clineSnapshotBlocked.has(conversationId)) return Promise.resolve(false)
    const snapshot = cloneStructuredValue(messages)
    const generation = clineSnapshotGenerations.get(conversationId) || 0
    const previous = clineSnapshotQueues.get(conversationId) || Promise.resolve(true)
    const pending = previous
      .catch(() => false)
      .then(() => {
        if (
          clineSnapshotBlocked.has(conversationId) ||
          (clineSnapshotGenerations.get(conversationId) || 0) !== generation
        ) return false
        return updateConversationSnapshot(conversationId, snapshot, undefined, { preserveSelection: true })
      })
      .finally(() => {
        if (clineSnapshotQueues.get(conversationId) === pending) clineSnapshotQueues.delete(conversationId)
      })
    clineSnapshotQueues.set(conversationId, pending)
    return pending
  }

  const registerClineConversationMessages = (
    conversationId: string,
    identity: ClineAgentTaskIdentity,
    messages: ChatMessage[],
    responseMode?: NonNullable<AiChatResponseInput['mode']>
  ) => {
    const taskId = identity.taskId.trim()
    const turnId = identity.turnId.trim()
    if (!taskId || !turnId) return
    clineMessagesByConversationId.set(conversationId, messages)
    clineConversationRouteByTask.set(clineAgentTaskIdentityKey({ taskId, turnId }), {
      conversationId,
      taskId,
      turnId,
      ...(responseMode ? { responseMode } : {})
    })
  }

  const forgetClineTaskRoute = (identity: ClineAgentTaskIdentity) => {
    clineConversationRouteByTask.delete(clineAgentTaskIdentityKey(identity))
    clineTaskEventLifecycle.forget(identity)
  }

  const forgetClineTaskRoutesForTurn = (turnIdInput: string) => {
    const turnId = turnIdInput.trim()
    if (!turnId) return
    for (const [key, route] of clineConversationRouteByTask) {
      if (route.turnId !== turnId) continue
      clineConversationRouteByTask.delete(key)
      clineTaskEventLifecycle.forget(route)
    }
    clineTaskEventLifecycle.forgetTurn(turnId)
  }

  const forgetClineConversation = (conversationId: string) => {
    clineMessagesByConversationId.delete(conversationId)
    clineSnapshotQueues.delete(conversationId)
    clineSnapshotGenerations.delete(conversationId)
    clineSnapshotBlocked.delete(conversationId)
    for (const [key, route] of clineConversationRouteByTask) {
      if (route.conversationId !== conversationId) continue
      clineConversationRouteByTask.delete(key)
      clineTaskEventLifecycle.forget(route)
    }
  }

  const beginClineProjectionRevision = async (conversationId: string, removedMessages: ChatMessage[]) => {
    clineSnapshotBlocked.add(conversationId)
    clineSnapshotGenerations.set(conversationId, (clineSnapshotGenerations.get(conversationId) || 0) + 1)
    for (const message of removedMessages) {
      const turnId = message.agentTask?.turnId || (message.role === 'assistant' ? message.id : '')
      if (!turnId) continue
      forgetClineTaskRoutesForTurn(turnId)
    }
    const pending = clineSnapshotQueues.get(conversationId)
    if (pending) await pending.catch(() => false)
  }

  const endClineProjectionRevision = (conversationId: string) => {
    clineSnapshotBlocked.delete(conversationId)
  }

  const clineConversationForEvent = (event: ClineAgentTaskEvent) => {
    const identityKey = clineAgentTaskIdentityKey(event)
    const mappedRoute = clineConversationRouteByTask.get(identityKey)
    if (mappedRoute) {
      const mappedMessages = clineMessagesByConversationId.get(mappedRoute.conversationId)
      if (mappedMessages) return { conversationId: mappedRoute.conversationId, messages: mappedMessages }
    }
    const belongsToExactTask = (message: ChatMessage) =>
      message.agentTask?.taskId === event.taskId && message.agentTask.turnId === event.turnId
    const currentConversationId = selectedConversationId.value.trim()
    if (currentConversationId && chatMessages.value.some(belongsToExactTask)) {
      registerClineConversationMessages(currentConversationId, event, chatMessages.value)
      return { conversationId: currentConversationId, messages: chatMessages.value }
    }
    for (const [conversationId, messages] of clineMessagesByConversationId) {
      if (!messages.some(belongsToExactTask)) continue
      registerClineConversationMessages(conversationId, event, messages)
      return { conversationId, messages }
    }
    return null
  }

  const clineTaskEventLifecycle = createClineTaskEventLifecycle({
    resolveTarget: clineConversationForEvent,
    // Agent tool events own their timeline and can bind agentTask as soon as
    // the registered turn row exists. Chat and Command retain their bridge
    // completion behavior because Command proposals are returned as a card.
    isTargetReady: (target, event) => {
      const root = target.messages.find((message) => message.id === event.turnId)
      const route = clineConversationRouteByTask.get(clineAgentTaskIdentityKey(event))
      const rootMatchesTask = root?.agentTask?.taskId === event.taskId && root.agentTask.turnId === event.turnId
      return Boolean(root && (route?.responseMode === 'agent' || rootMatchesTask))
    },
    applyEvent: (target, event) => applyClassicClineTaskEvent(target.messages, event),
    afterEvent: (target, event, applied) => {
      if (applied && shouldPersistClineEvent(event)) {
        void persistClineConversationSnapshot(target.conversationId, target.messages)
      }
      if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
        clineConversationRouteByTask.delete(clineAgentTaskIdentityKey(event))
      }
    }
  })

  const catalogRuntime = createWorkspaceAiChatCatalogRuntime({
    state: {
      aiContextCatalog,
      aiCommandOptions,
      selectedContexts,
      todoItems
    },
    setTopNotice,
    loadChatConversationsFromBackend,
    openedHostContexts
  })

  const {
    refreshAiContextCatalog: refreshAiContextCatalogFromBackend,
    syncOpenedHostContexts,
    refreshAiCommandCatalog,
    refreshAiTodoSnapshot,
    hydrateClassicChatData
  } = catalogRuntime

  const classicContextByConversationId = new Map<string, ProductSessionClassicContext | null>()
  const classicProductSessionById = new Map<string, ProductSessionRecord>()
  const classicContextPersistQueues = new Map<string, Promise<boolean>>()
  const classicHostOpenQueues = new Map<string, Promise<ReturnType<typeof resolveClassicHostTerminalPanel>>>()
  let classicContextRestoreGeneration = 0
  let applyingClassicContextProjection = false
  let classicAutoFollowActiveHost = true
  let stopSelectedContextsWatch: () => void = () => undefined
  let stopOpenedHostsWatch: () => void = () => undefined
  let stopActiveHostWatch: () => void = () => undefined

  const onProductSessionChanged = productSessionClient.onChanged()
  const stopProductSessionChanged = onProductSessionChanged?.((event) => {
    if (event.type === 'deleted') {
      forgetClineConversation(event.id)
      classicContextByConversationId.delete(event.id)
      classicProductSessionById.delete(event.id)
      if (!conversations.value.some((conversation) => conversation.id === event.id) && selectedConversationId.value !== event.id) return
      conversations.value = conversations.value.filter((conversation) => conversation.id !== event.id)
      if (selectedConversationId.value === event.id) {
        selectedConversationId.value = ''
        chatMessages.value = []
        classicAutoFollowActiveHost = true
        applyClassicContexts([])
        syncAutoFollowHostContext()
        clearAiContextUsage()
      }
      return
    }
    if (event.id !== event.session.id || event.session.surface !== 'classic') return
    classicProductSessionById.set(event.id, cloneStructuredValue(event.session))
    classicContextByConversationId.set(
      event.id,
      event.session.classicContext ? cloneStructuredValue(event.session.classicContext) : null
    )
  })
  const disposeClassicContextProjection = () => {
    stopSelectedContextsWatch()
    stopOpenedHostsWatch()
    stopActiveHostWatch()
    stopProductSessionChanged?.()
    clineTaskEventLifecycle.dispose()
  }

  const cloneClassicContext = (context: ProductSessionClassicContext): ProductSessionClassicContext => ({
    contexts: context.contexts.map((item) => ({ ...item })),
    ...(context.autoFollowActiveHost !== undefined ? { autoFollowActiveHost: context.autoFollowActiveHost } : {})
  })

  const readClassicProductSession = async (
    id: string,
    options: { notifyFailure?: boolean } = {}
  ): Promise<ProductSessionRecord | null | undefined> => {
    const getProductSession = productSessionClient.get()
    if (!getProductSession) {
      if (options.notifyFailure) setTopNotice(i18nText('ai.productSessionStateUnavailable'))
      return undefined
    }
    try {
      const result = await getProductSession(id)
      const session = result?.data?.session
      if (!result?.ok || !result.data || !Object.prototype.hasOwnProperty.call(result.data, 'session')) {
        if (options.notifyFailure) setTopNotice(result?.errorMessage || i18nText('ai.productSessionStateUnavailable'))
        return undefined
      }
      if (session && (session.id !== id || session.surface !== 'classic' || !session.isOpen)) {
        if (options.notifyFailure) setTopNotice(i18nText('ai.productSessionStateUnavailable'))
        return undefined
      }
      if (session) classicProductSessionById.set(id, cloneStructuredValue(session))
      else classicProductSessionById.delete(id)
      return session || null
    } catch {
      if (options.notifyFailure) setTopNotice(i18nText('ai.productSessionStateUnavailable'))
      return undefined
    }
  }

  const applyClassicContexts = (contexts: AiContextOption[]) => {
    applyingClassicContextProjection = true
    try {
      selectedContexts.value = contexts.map((context) => ({ ...context }))
    } finally {
      applyingClassicContextProjection = false
    }
  }

  const hostContextSignature = (contexts: AiContextOption[]) =>
    contexts
      .filter((context) => context.kind === 'hosts')
      .map((context) => classicHostTargetId(context))
      .join('\u0000')

  const hasClassicUserMessage = () => chatMessages.value.some((message) => message.role === 'user')

  const applyAutoFollowHostContext = () => {
    if (!classicAutoFollowActiveHost || hasClassicUserMessage()) return false
    const host = activeHostContext()
    const nonHosts = selectedContexts.value.filter((context) => context.kind !== 'hosts')
    const nextContexts = host ? [{ ...host }, ...nonHosts] : nonHosts
    if (hostContextSignature(nextContexts) === hostContextSignature(selectedContexts.value)) return false
    applyClassicContexts(nextContexts)
    return true
  }

  const persistClassicContextProjection = (
    id: string,
    input: { contexts?: AiContextOption[]; autoFollowActiveHost?: boolean; notifyFailure?: boolean } = {}
  ) => {
    const conversationId = id.trim()
    if (!conversationId) return Promise.resolve(false)
    const contextRefs = classicSessionContextRefs(input.contexts || selectedContexts.value)
    const autoFollowActiveHost = input.autoFollowActiveHost ?? classicAutoFollowActiveHost
    const previous = classicContextPersistQueues.get(conversationId) || Promise.resolve(true)
    const pending = previous
      .catch(() => false)
      .then(async () => {
        if (!classicContextByConversationId.has(conversationId)) {
          const session = await readClassicProductSession(conversationId, { notifyFailure: input.notifyFailure })
          if (!session) return false
          classicContextByConversationId.set(
            conversationId,
            session.classicContext ? cloneClassicContext(session.classicContext) : null
          )
        }
        const classicContext: ProductSessionClassicContext = {
          contexts: contextRefs.map((context) => ({ ...context })),
          autoFollowActiveHost
        }
        const updateProductSession = productSessionClient.update()
        if (!updateProductSession) {
          if (input.notifyFailure) setTopNotice(i18nText('ai.productSessionStateUnavailable'))
          return false
        }
        try {
          const result = await updateProductSession({ id: conversationId, classicContext })
          if (!result?.ok || result.data?.session?.id !== conversationId || result.data.session.surface !== 'classic') {
            if (input.notifyFailure) setTopNotice(result?.errorMessage || i18nText('ai.productSessionStateUnavailable'))
            return false
          }
          classicContextByConversationId.set(conversationId, cloneClassicContext(result.data.session.classicContext || classicContext))
          classicProductSessionById.set(conversationId, cloneStructuredValue(result.data.session))
          return true
        } catch {
          if (input.notifyFailure) setTopNotice(i18nText('ai.productSessionStateUnavailable'))
          return false
        }
      })
      .finally(() => {
        if (classicContextPersistQueues.get(conversationId) === pending) classicContextPersistQueues.delete(conversationId)
      })
    classicContextPersistQueues.set(conversationId, pending)
    return pending
  }

  const syncAutoFollowHostContext = () => {
    if (!applyAutoFollowHostContext()) return
    const id = selectedConversationId.value.trim()
    if (id) void persistClassicContextProjection(id)
  }

  const resolveClassicHostTargets = async (
    hostContexts: AiContextOption[],
    options: { isCurrent?: () => boolean } = {}
  ) => {
    if (hostContexts.length > CLINE_AGENT_MAX_HOST_TARGETS) return []
    const originalPanel = resolveActiveWritableTerminalPanel()
    const targets: ClineAgentHostTarget[] = []
    const seenTargetIds = new Set<string>()
    const seenTerminalSessionIds = new Set<string>()
    try {
      for (const context of hostContexts) {
        if (options.isCurrent && !options.isCurrent()) break
        const expectedTargetId = classicHostTargetId(context)
        if (!expectedTargetId || seenTargetIds.has(expectedTargetId) || context.unavailable === true) continue
        const exactCanonicalTarget = (candidate: ReturnType<typeof resolveClassicHostTerminalPanel>) => {
          const terminalSessionId = candidate?.sessionId?.trim()
          const canonicalTarget = candidate?.classicTarget
          const expectedKind = candidate?.sshSession ? 'ssh' : 'local'
          if (
            !candidate ||
            !terminalSessionId ||
            candidate.status === 'closed' ||
            candidate.status === 'error' ||
            !canonicalTarget ||
            canonicalTarget.targetId.trim() !== expectedTargetId ||
            canonicalTarget.terminalSessionId.trim() !== terminalSessionId ||
            canonicalTarget.kind !== expectedKind ||
            !canonicalTarget.label.trim()
          ) return null
          return canonicalTarget
        }
        let panel = resolveClassicHostTerminalPanel(context)
        let canonicalTarget = exactCanonicalTarget(panel)
        if (!canonicalTarget) {
          let pendingOpen = classicHostOpenQueues.get(expectedTargetId)
          if (!pendingOpen) {
            pendingOpen = Promise.resolve(openTerminalForAiHostContext(context))
              .finally(() => {
                if (classicHostOpenQueues.get(expectedTargetId) === pendingOpen) {
                  classicHostOpenQueues.delete(expectedTargetId)
                }
              })
            classicHostOpenQueues.set(expectedTargetId, pendingOpen)
          }
          panel = await pendingOpen
          canonicalTarget = exactCanonicalTarget(panel)
        }
        const terminalSessionId = panel?.sessionId?.trim()
        if (
          !panel ||
          !terminalSessionId ||
          !canonicalTarget ||
          seenTerminalSessionIds.has(terminalSessionId)
        ) continue
        seenTargetIds.add(expectedTargetId)
        seenTerminalSessionIds.add(terminalSessionId)
        targets.push({ ...canonicalTarget })
      }
    } finally {
      if (originalPanel?.id) activateTerminalPanel(originalPanel.id)
    }
    return targets
  }

  restoreClassicContextProjection = async (id: string) => {
    const generation = ++classicContextRestoreGeneration
    const [session, catalogRefreshed] = await Promise.all([
      readClassicProductSession(id),
      refreshAiContextCatalogFromBackend({ hydrateSelection: false })
    ])
    if (generation !== classicContextRestoreGeneration || selectedConversationId.value !== id || session === undefined) return
    if (!session) {
      classicContextByConversationId.set(id, null)
      classicAutoFollowActiveHost = !hasClassicUserMessage()
      applyClassicContexts([])
      syncAutoFollowHostContext()
      return
    }
    const projection = session.classicContext ? cloneClassicContext(session.classicContext) : null
    classicContextByConversationId.set(id, projection)
    if (projection) {
      const catalog = catalogRefreshed
        ? aiContextCatalog.value
        : { categories: [], openedHosts: [] }
      const restoredContexts = restoreClassicSessionContexts(projection.contexts, catalog)
      const legacyEmptyProjection = projection.autoFollowActiveHost === undefined && projection.contexts.length === 0
      classicAutoFollowActiveHost = (projection.autoFollowActiveHost === true || legacyEmptyProjection) && !hasClassicUserMessage()
      applyClassicContexts(restoredContexts)
      syncAutoFollowHostContext()
      return
    }
    classicAutoFollowActiveHost = !hasClassicUserMessage()
    applyClassicContexts([])
    syncAutoFollowHostContext()
    void persistClassicContextProjection(id, { autoFollowActiveHost: classicAutoFollowActiveHost })
  }

  const refreshAiContextCatalog = async (options: { hydrateSelection?: boolean } = { hydrateSelection: false }) => {
    const id = selectedConversationId.value.trim()
    const hasProjection = Boolean(id && classicContextByConversationId.has(id))
    const refs = hasProjection ? classicSessionContextRefs(selectedContexts.value) : []
    const refreshed = await refreshAiContextCatalogFromBackend({
      hydrateSelection: hasProjection ? false : options.hydrateSelection
    })
    if (refreshed && hasProjection && selectedConversationId.value === id) {
      applyClassicContexts(restoreClassicSessionContexts(refs, aiContextCatalog.value))
      syncAutoFollowHostContext()
    }
    return refreshed
  }

  stopSelectedContextsWatch = watch(
    selectedContexts,
    (contexts, previousContexts) => {
      if (
        !applyingClassicContextProjection &&
        hostContextSignature(contexts) !== hostContextSignature(previousContexts || [])
      ) {
        classicAutoFollowActiveHost = false
      }
      const id = selectedConversationId.value.trim()
      if (!id || applyingClassicContextProjection) return
      void persistClassicContextProjection(id, { contexts })
    },
    { deep: true, flush: 'sync' }
  )
  stopOpenedHostsWatch = watch(
    openedHostContexts,
    () => syncOpenedHostContexts(),
    { deep: true, immediate: true }
  )
  stopActiveHostWatch = watch(
    activeHostContext,
    () => syncAutoFollowHostContext(),
    { deep: true, immediate: true }
  )

  const createConversation = async () => {
    const startsFromExistingConversation = Boolean(selectedConversationId.value.trim())
    const activeHost = startsFromExistingConversation ? activeHostContext() : null
    const initialContexts = startsFromExistingConversation
      ? (activeHost ? [{ ...activeHost }] : [])
      : selectedContexts.value.map((context) => ({ ...context }))
    const previousAutoFollowActiveHost = classicAutoFollowActiveHost
    const created = await createConversationHistory()
    if (!created) return null
    if (startsFromExistingConversation) classicAutoFollowActiveHost = true
    classicContextByConversationId.set(created.id, null)
    applyClassicContexts(initialContexts)
    void persistClassicContextProjection(created.id, {
      contexts: initialContexts,
      autoFollowActiveHost: startsFromExistingConversation ? true : previousAutoFollowActiveHost
    })
    return created
  }

  const restoreConversation = async (id: string) => {
    const pendingSnapshot = clineSnapshotQueues.get(id)
    if (pendingSnapshot) await pendingSnapshot.catch(() => false)
    const cachedMessages = clineMessagesByConversationId.get(id)
    const restored = await restoreConversationHistory(id)
    if (restored && cachedMessages) chatMessages.value = cachedMessages
    return restored
  }

  const deselectConversation = async (expectedConversationId: string) => {
    const deselected = await deselectConversationHistory(expectedConversationId)
    if (deselected && !selectedConversationId.value) {
      classicAutoFollowActiveHost = true
      applyClassicContexts([])
      syncAutoFollowHostContext()
    }
    return deselected
  }

  const deleteConversation = async (id: string) => {
    const deleted = await deleteConversationHistory(id)
    if (deleted) {
      forgetClineConversation(id)
      // Deleting a conversation makes the history runtime restore the backend's
      // selected conversation. Reattach its live projection when a Cline turn
      // is still running there; otherwise late task events would update an
      // orphaned cache while the visible chat stays on the restored snapshot.
      const selectedId = selectedConversationId.value.trim()
      const cachedMessages = selectedId ? clineMessagesByConversationId.get(selectedId) : undefined
      if (cachedMessages) chatMessages.value = cachedMessages
    }
    return deleted
  }

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) => plainTextFromAiContentParts(parts, { mode: 'exchange' })

  const clineSeedInputFromMessage = (message: Pick<ChatMessage, 'role' | 'text' | 'ask' | 'say' | 'action' | 'commandExecution' | 'agentTask'>): AiChatMessageInput => ({
    role: message.role,
    text: message.text,
    ask: message.ask,
    say: message.say,
    action: message.action,
    commandExecution: message.commandExecution ? { ...message.commandExecution } : undefined,
    agentTask: message.agentTask ? { ...message.agentTask } : undefined
  })

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

  const generateAiResponseForMessage = async (conversationId: string, assistantId: string, input: AiChatResponseInput) => {
    const targetMessages = clineMessagesByConversationId.get(conversationId)
    if (!targetMessages) return
    const requestId = input.requestId?.trim() || aiChatRequestIdFromAssistantMessageId(assistantId)
    const taskIdentity = requestId ? { taskId: requestId, turnId: assistantId } : null
    const releaseTaskRoute = () => {
      if (taskIdentity) forgetClineTaskRoute(taskIdentity)
      else forgetClineTaskRoutesForTurn(assistantId)
    }
    const hasPendingApproval = () => Boolean(taskIdentity && targetMessages.some((item) =>
      item.agentTask?.taskId === taskIdentity.taskId &&
      item.agentTask.turnId === taskIdentity.turnId &&
      item.agentTask.status === 'waiting-approval'
    ))
    const responseBridge = aiChatClient.generateAiChatResponse()
    const failGeneration = (messageText: string) => {
      const message = targetMessages.find((item) => item.id === assistantId)
      if (message && message.state === 'streaming') {
        message.state = 'error'
        message.text = messageText
        void persistClineConversationSnapshot(conversationId, targetMessages)
      }
      releaseTaskRoute()
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
    const message = targetMessages.find((item) => item.id === assistantId)
    const assistantMessageId = input.assistantMessageId?.trim() || assistantId
    if (!message) {
      releaseTaskRoute()
      void refreshAiTodoSnapshot()
      return
    }
    const data = result?.data
    if (message.state !== 'streaming') {
      if (requestId && isAiContextUsageForRequest(data?.contextUsage, requestId, assistantMessageId)) {
        if (selectedConversationId.value === conversationId) applyAiContextUsage(data.contextUsage)
      }
      void refreshAiTodoSnapshot()
      void persistClineConversationSnapshot(conversationId, targetMessages)
      if (!hasPendingApproval()) releaseTaskRoute()
      return
    }
    const responseTask = data?.agentTask
    let replayResponseText = false
    let approvalResponseMessage: ChatMessage | undefined
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
      const responseMessage = chatHistoryMessageToChatMessage(data.message)
      const approvalTask = responseMessage.agentTask
      const isAgentApproval = input.mode === 'agent' &&
        (
          responseMessage.ask === 'command' ||
          responseMessage.ask === 'mcp_tool_call' ||
          responseMessage.ask === 'mcp_resource_access'
        ) &&
        approvalTask?.status === 'waiting-approval' &&
        Boolean(approvalTask.toolCallId)
      if (!isAgentApproval || !approvalTask) {
        Object.assign(message, responseMessage)
      } else {
        // Events own the transcript order. Bind the synthetic request row to
        // the turn, replay those events below, and use this snapshot only when
        // the approval event was not delivered to the renderer.
        approvalResponseMessage = responseMessage
        message.state = 'streaming'
        message.agentTask = {
          taskId: approvalTask.taskId,
          turnId: approvalTask.turnId,
          ...(approvalTask.targetId ? { targetId: approvalTask.targetId } : {}),
          ...(approvalTask.targetLabel ? { targetLabel: approvalTask.targetLabel } : {}),
          ...(approvalTask.terminalSessionId ? { terminalSessionId: approvalTask.terminalSessionId } : {}),
          ...(approvalTask.toolCallId ? { toolCallId: approvalTask.toolCallId } : {}),
          ...(approvalTask.toolName ? { toolName: approvalTask.toolName } : {}),
          status: approvalTask.status
        }
      }
    } else {
      if (data.agentTask) {
        // Cline emits the useful timeline events while this bridge promise is
        // pending. Bind the task first and replay those events before using
        // the bridge text; otherwise the final text lands in the placeholder
        // root above the command cards.
        message.state = 'streaming'
        message.agentTask = cloneStructuredValue(data.agentTask)
        replayResponseText = true
      } else {
        message.state = 'done'
        message.text = data.text
      }
    }
    if (data?.agentTask && !message.agentTask) message.agentTask = cloneStructuredValue(data.agentTask)
    if (message.agentTask) {
      clineTaskEventLifecycle.replay(message.agentTask)
      const approvalTask = approvalResponseMessage?.agentTask
      if (approvalResponseMessage && approvalTask?.toolCallId) {
        const command = approvalResponseMessage.commandExecution?.command || approvalResponseMessage.text.trim()
        let approvalCard = targetMessages.find((item) =>
          item.agentTask?.taskId === approvalTask.taskId &&
          item.agentTask.turnId === approvalTask.turnId &&
          item.agentTask.toolCallId === approvalTask.toolCallId
        )
        const hasProjectedApprovalCard = approvalCard?.agentTask?.status === 'waiting-approval' && (
          (approvalTask.toolName === 'run_host_command' && approvalCard.ask === 'command') ||
          (
            (approvalTask.toolName === 'read_host_file' || approvalTask.toolName === 'search_host_files') &&
            approvalCard.ask === 'mcp_tool_call'
          ) ||
          (approvalTask.toolName === 'access_mcp_resource' && approvalCard.ask === 'mcp_resource_access')
        )
        if (!hasProjectedApprovalCard && approvalTask.toolName) {
          const hostBoundTool = approvalTask.toolName === 'run_host_command' ||
            approvalTask.toolName === 'read_host_file' ||
            approvalTask.toolName === 'search_host_files'
          const exactTarget = hostBoundTool ? exactClassicApprovalHostTarget(approvalTask, input.hostTargets) : null
          const resource = approvalResponseMessage.mcpResourceAccess
          const toolInput = approvalTask.toolName === 'run_host_command'
            ? (command ? { targetId: exactTarget?.targetId, command } : null)
            : approvalTask.toolName === 'read_host_file' || approvalTask.toolName === 'search_host_files'
              ? {
                  targetId: exactTarget?.targetId,
                  ...(approvalResponseMessage.mcpToolCall?.arguments || {})
                }
              : approvalTask.toolName === 'access_mcp_resource' && resource
                ? { serverName: resource.serverName, uri: resource.uri }
                : null
          if (toolInput && ((!hostBoundTool && resource) || exactTarget)) {
            applyClassicClineTaskEvent(targetMessages, {
              protocolVersion: 1,
              sessionId: 'renderer-response-fallback',
              taskId: approvalTask.taskId,
              turnId: approvalTask.turnId,
              seq: Number.MAX_SAFE_INTEGER,
              at: new Date().toISOString(),
              type: 'approval-requested',
              toolCallId: approvalTask.toolCallId,
              toolName: approvalTask.toolName,
              ...(exactTarget
                ? {
                    targetId: exactTarget.targetId,
                    targetLabel: exactTarget.label,
                    terminalSessionId: exactTarget.terminalSessionId
                  }
                : {}),
              ...(resource ? { serverName: resource.serverName, resourceUri: resource.uri } : {}),
              input: toolInput,
              iteration: 1,
              autoApprovable: approvalResponseMessage.commandExecution?.requiresApproval !== true,
              reason: approvalResponseMessage.commandExecutionMessage
            })
            approvalCard = targetMessages.find((item) =>
              item.agentTask?.taskId === approvalTask.taskId &&
              item.agentTask.turnId === approvalTask.turnId &&
              item.agentTask.toolCallId === approvalTask.toolCallId
            )
          } else {
            message.state = 'error'
            message.text = i18nText('ai.classicHostTargetsRequired')
            message.agentTask = { ...message.agentTask, status: 'error' }
          }
        }
        if (approvalCard?.ask === 'command') {
          approvalCard.commandExecution = approvalResponseMessage.commandExecution
            ? cloneStructuredValue(approvalResponseMessage.commandExecution)
            : approvalCard.commandExecution
          approvalCard.commandExecutionMessage = approvalResponseMessage.commandExecutionMessage || approvalCard.commandExecutionMessage
        }
      }
      if (replayResponseText && data && responseTask) {
        const fallbackEvent: ClineAgentTaskEvent = {
          protocolVersion: 1,
          sessionId: data.nativeSessionId || 'renderer-response-fallback',
          taskId: responseTask.taskId,
          turnId: responseTask.turnId,
          seq: Number.MAX_SAFE_INTEGER,
          at: new Date().toISOString(),
          type: 'done',
          text: data.text,
          finishReason: 'stop',
          iterations: 0
        }
        applyClassicClineTaskEvent(targetMessages, fallbackEvent)
      }
    }
    else if (message.state === 'error' || message.state === 'cancelled') {
      releaseTaskRoute()
    }
    if (!hasPendingApproval()) releaseTaskRoute()
    if (requestId && isAiContextUsageForRequest(data?.contextUsage, requestId, assistantMessageId)) {
      if (selectedConversationId.value === conversationId) applyAiContextUsage(data.contextUsage)
    }
    void refreshAiTodoSnapshot()
    void persistClineConversationSnapshot(conversationId, targetMessages)
  }

  const cancelStreamingAiChatResponse = async () => {
    const conversationId = selectedConversationId.value.trim()
    const targetMessages = (conversationId && clineMessagesByConversationId.get(conversationId)) || chatMessages.value
    const message = [...targetMessages].reverse().find((item) =>
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
      for (const item of targetMessages) {
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
      if (conversationId) void persistClineConversationSnapshot(conversationId, targetMessages)
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

  const resolveClassicProductContext = async (
    conversationId: string,
    responseMode: NonNullable<AiChatResponseInput['mode']>,
    requestedHostContexts: AiContextOption[],
    configuredContexts: AiContextOption[]
  ): Promise<{
    conversationId: string
    hostContexts: AiContextOption[]
    hostTargets: ClineAgentHostTarget[]
  } | null> => {
    let existing: ProductSessionRecord | null = null
    const recoverMissingProductSession = async (): Promise<{ id: string; session: ProductSessionRecord } | null> => {
      const created = await createConversation()
      const id = created?.id?.trim() || ''
      if (!id) {
        setTopNotice(i18nText('ai.productSessionStateUnavailable'))
        return null
      }
      const loaded = classicProductSessionById.get(id) || await readClassicProductSession(id, { notifyFailure: true })
      if (!loaded) {
        setTopNotice(i18nText('ai.productSessionStateUnavailable'))
        return null
      }
      setTopNotice(i18nText('ai.classicSessionStateRotated'))
      return { id, session: loaded }
    }
    const loaded = await readClassicProductSession(conversationId, { notifyFailure: true })
    if (loaded === undefined) return null
    existing = loaded
    if (!existing && chatMessages.value.length > 0) {
      const rotated = await recoverMissingProductSession()
      if (!rotated) return null
      conversationId = rotated.id
      existing = rotated.session
    }
    classicContextByConversationId.set(
      conversationId,
      existing?.classicContext ? cloneClassicContext(existing.classicContext) : null
    )

    const hostContexts = requestedHostContexts.map((context) => ({ ...context }))
    const configuredHostContexts = configuredContexts.filter((context) => context.kind === 'hosts')
    const expectedTargetIds = hostContexts.map(classicHostTargetId).filter(Boolean)
    const expectedTargetCount = new Set(expectedTargetIds).size
    const invalidConfiguredHosts = configuredHostContexts.length !== hostContexts.length ||
      configuredHostContexts.length > CLINE_AGENT_MAX_HOST_TARGETS ||
      expectedTargetIds.length !== hostContexts.length ||
      expectedTargetCount !== hostContexts.length
    if (responseMode !== 'chat' && invalidConfiguredHosts) {
      setTopNotice(i18nText('ai.classicHostTargetsRequired'))
      return null
    }
    const hostTargets = responseMode === 'chat' ? [] : await resolveClassicHostTargets(hostContexts)
    if (responseMode !== 'chat' && hostTargets.length !== expectedTargetCount) {
      setTopNotice(i18nText('ai.classicHostTargetsRequired'))
      return null
    }
    return { conversationId, hostContexts, hostTargets }
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
    const autoFollowActiveHostAtSend = classicAutoFollowActiveHost
    const classicContextsAtSend = selectedContexts.value.map((context) => ({ ...context }))
    const originatingMessages = chatMessages.value.map((message) => cloneStructuredValue(message))
    const responseMode = options.mode || (mode.value === 'agents' ? 'agent' : 'command')
    const initialSelectedContexts = sendableClassicSessionContexts(selectedContexts.value)
    const initialOverrideHosts = overrideHosts ? sendableClassicSessionContexts(overrideHosts) : undefined
    const initialHostContexts = initialOverrideHosts ?? initialSelectedContexts.filter((item) => item.kind === 'hosts')
    const configuredHostContexts = overrideHosts ?? selectedContexts.value
    const conversationIdBeforeProductResolution = conversationId
    const productSession = await resolveClassicProductContext(
      conversationId,
      responseMode,
      initialHostContexts,
      configuredHostContexts
    )
    if (!productSession) return false
    conversationId = productSession.conversationId
    const sendableSelectedContexts = initialSelectedContexts
    const sendableOverrideHosts = initialOverrideHosts
    const baseMessageContexts = sendableOverrideHosts
      ? [...sendableOverrideHosts, ...sendableSelectedContexts.filter((item) => item.kind !== 'hosts')]
      : [...sendableSelectedContexts]
    const autoKnowledgeContexts = options.skipKnowledgeSearch ? [] : await resolveAiKnowledgeSearchContexts(prompt, baseMessageContexts)
    const messageContexts = sendableClassicSessionContexts([...baseMessageContexts, ...autoKnowledgeContexts])
    const requestImages = [
      ...safeContentParts.filter((part): part is Extract<AiContentPart, { type: 'image' }> => part.type === 'image'),
      ...messageContexts
        .filter((context) => context.kind === 'images' && context.data)
        .map((context) => ({ type: 'image' as const, mediaType: context.mediaType, data: context.data!, name: context.label }))
    ]
    if (requestImages.length > MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE) {
      setTopNotice(i18nText('ai.imageAttachmentCountLimit', { count: MAX_CHAT_IMAGE_ATTACHMENTS_PER_MESSAGE }))
      return false
    }
    for (const image of requestImages) {
      const imageBytes = chatImageAttachmentBase64ByteLength(image.data)
      const validation = validateChatImageAttachment({
        mediaType: image.mediaType,
        name: image.name,
        size: imageBytes ?? MAX_CHAT_IMAGE_ATTACHMENT_BYTES + 1
      })
      if (!validation.ok || imageBytes === null) {
        setTopNotice(`图片上传失败：${validation.errorMessage || validation.errorCode || '图片数据格式无效。'}`)
        return false
      }
    }
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const revisionFromMessageId = options.revisionFromMessageId?.trim() || ''
    const replaceNativeTranscript = revisionFromMessageId ? true : options.replaceNativeTranscript === true
    const historyForBackend: AiChatMessageInput[] = productSession.conversationId === conversationIdBeforeProductResolution
      ? originatingMessages.map(clineSeedInputFromMessage)
      : []
    const hostContexts = productSession.hostContexts
    const hostTargets = productSession.hostTargets
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
        replaceNativeTranscript: replaceNativeTranscript || undefined,
        hostTargets,
        hosts: hostContexts.map(hostContextForExchangeRequest).filter(Boolean) as AiChatExchangeRequestInput['hosts'],
        messages: historyForBackend,
        contentParts: safeContentParts,
        contexts: messageContexts.map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          detail: item.detail,
          relPath: item.relPath,
          mediaType: item.mediaType,
          contextSource: item.contextSource,
          startLine: item.startLine,
          endLine: item.endLine,
          chatSessionId: item.chatSessionId
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
    if (revisionFromMessageId) {
      const reviseProjection = productSessionClient.reviseProjectionMessages()
      if (!reviseProjection) {
        setTopNotice(i18nText('ai.productSessionStateUnavailable'))
        return false
      }
      const replacementMessages = [userMessage, assistantMessage]
        .map(chatMessageToHistoryMessage)
        .filter((message): message is NonNullable<typeof message> => Boolean(message))
      if (replacementMessages.length !== 2) {
        setTopNotice(i18nText('ai.productSessionStateUnavailable'))
        return false
      }
      try {
        const revised = await reviseProjection(conversationId, {
          fromMessageId: revisionFromMessageId,
          replacementMessages: replacementMessages.map((message) => ({ messageId: message.id, payload: message }))
        })
        if (!revised?.ok || !revised.data) {
          setTopNotice(revised?.errorMessage || i18nText('ai.productSessionStateUnavailable'))
          return false
        }
        const seedMessages = revised.data.seedMessages
          .map((message) => message.payload)
          .filter(isAiChatHistoryMessage)
        request.data.responseInput.messages = [
          ...seedMessages.map(clineSeedInputFromMessage),
          { role: 'user', text: request.data.responseInput.prompt }
        ]
      } catch (error) {
        setTopNotice(aiBridgeErrorMessage(error, i18nText('ai.productSessionStateUnavailable')))
        return false
      }
    }
    const conversationMessages = selectedConversationId.value === conversationId
      ? chatMessages.value
      : originatingMessages
    if (autoFollowActiveHostAtSend) {
      if (selectedConversationId.value === conversationId) classicAutoFollowActiveHost = false
      void persistClassicContextProjection(conversationId, {
        contexts: selectedConversationId.value === conversationId ? selectedContexts.value : classicContextsAtSend,
        autoFollowActiveHost: false
      })
    }
    conversationMessages.push(userMessage)
    conversationMessages.push(assistantMessage)
    if (revisionFromMessageId && selectedConversationId.value === conversationId) applyProjectionRevisionWindow()
    const responseRequestId = request.data.responseInput.requestId?.trim() || request.data.requestId
    registerClineConversationMessages(
      conversationId,
      { taskId: responseRequestId, turnId: assistantMessage.id },
      conversationMessages,
      responseMode
    )
    void refreshAiTodoSnapshot()
    void generateAiResponseForMessage(conversationId, assistantMessage.id, {
      ...request.data.responseInput,
      requestId: request.data.responseInput.requestId || request.data.requestId,
      assistantMessageId: request.data.responseInput.assistantMessageId || assistantMessage.id
    })
    await updateConversationSnapshot(conversationId, conversationMessages, prompt, {
      notifyFailure: true,
      notifyUnavailable: true,
      preserveSelection: true
    })
    return true
  }

  const sendChat = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[], options?: SendChatOptions) => {
    return appendChatExchange(text, contentParts, overrideHosts, options)
  }

  const resendUserMessageFromParts = async (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const conversationId = selectedConversationId.value.trim()
    if (!conversationId) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = hasStructuredAiContentParts(contentParts)
    if (!prompt && !hasStructuredParts) return false
    const removedMessages = chatMessages.value.splice(index)
    clearAiContextUsage()
    await beginClineProjectionRevision(conversationId, removedMessages)
    let sent = false
    try {
      sent = await appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts, {
        replaceNativeTranscript: true,
        revisionFromMessageId: messageId
      })
    } finally {
      endClineProjectionRevision(conversationId)
    }
    if (!sent && chatMessages.value.length === index) chatMessages.value.splice(index, 0, ...removedMessages)
    return sent
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
      : chatMessages.value.length
    if (messageId && assistantIndex < 0) return false
    let userIndex = Math.min(assistantIndex, chatMessages.value.length) - 1
    while (userIndex >= 0 && chatMessages.value[userIndex]?.role !== 'user') userIndex -= 1
    if (userIndex < 0) return false
    const lastUserMessage = chatMessages.value[userIndex]
    const conversationId = selectedConversationId.value.trim()
    if (!conversationId) return false
    const removedMessages = chatMessages.value.splice(userIndex)
    clearAiContextUsage()
    void (async () => {
      await beginClineProjectionRevision(conversationId, removedMessages)
      let sent = false
      try {
        sent = await sendChat(
          lastUserMessage.text,
          lastUserMessage.contentParts,
          lastUserMessage.hosts,
          { replaceNativeTranscript: true, revisionFromMessageId: lastUserMessage.id }
        )
      } finally {
        endClineProjectionRevision(conversationId)
      }
      if (!sent && chatMessages.value.length === userIndex && selectedConversationId.value === conversationId) {
        chatMessages.value.splice(userIndex, 0, ...removedMessages)
      }
    })()
    return true
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
    loadOlderConversationMessages,
    loadChatConversationsFromBackend,
    deselectConversation,
    refreshAiContextCatalog,
    persistClassicContextProjection,
    restoreClassicContextProjection,
    disposeClassicContextProjection,
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
