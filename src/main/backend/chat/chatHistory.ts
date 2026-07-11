import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { dirname, isAbsolute, resolve } from 'path'
import type {
  AiChatConversationDeleteResult,
  AiChatConversationMutationResult,
  AiChatConversationRecord,
  AiChatConversationRestoreResult,
  AiChatConversationUpdateInput,
  AiChatHistoryListResult,
  AiChatHistoryMessage,
  AiChatMessageMetadataInput,
  AiChatMessageMetadataResult
} from '@shared/contracts/aiChat'
import type { AiopsMutationResult } from '@shared/contracts/common'
import { shouldUseChatHistorySeedData } from '@shared/runtimeSwitches'

type ChatHistoryBackendRuntimeConfig = {
  stateFilePath?: string
  useSeedData?: boolean
}

type ChatHistoryPersistenceTestHooks = {
  writeFile?: (path: string, payload: string, encoding: BufferEncoding) => Promise<unknown>
}

type ChatHistoryStoreShape = {
  version: 1
  conversations: AiChatConversationRecord[]
  messagesByConversationId: Record<string, AiChatHistoryMessage[]>
  selectedConversationId: string
}

type ChatHistoryHostContext = NonNullable<AiChatHistoryMessage['hosts']>[number]

const nowText = () => '刚刚'

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cloneConversation = (conversation: AiChatConversationRecord): AiChatConversationRecord => ({ ...conversation })

const cloneMessage = (message: AiChatHistoryMessage): AiChatHistoryMessage => ({
  ...message,
  hosts: message.hosts ? message.hosts.map((host) => ({ ...host })) : undefined,
  contentParts: message.contentParts ? cloneJson(message.contentParts) : undefined,
  commandExecution: message.commandExecution ? cloneJson(message.commandExecution) : undefined,
  agentTask: message.agentTask ? cloneJson(message.agentTask) : undefined,
  mcpToolCall: message.mcpToolCall ? cloneJson(message.mcpToolCall) : undefined,
  mcpResourceAccess: message.mcpResourceAccess ? cloneJson(message.mcpResourceAccess) : undefined,
  followupOptions: message.followupOptions ? [...message.followupOptions] : undefined
})

const cloneMessages = (messages: AiChatHistoryMessage[]) => messages.map(cloneMessage)

export const chatHistoryRestoreMessageLimit = 200
export const chatHistoryRestorePayloadByteLimit = 2 * 1024 * 1024
export const chatHistoryTruncationMessageId = 'aiopsterm-history-truncated'

const seedTime = 1780488000000

const defaultChatHistoryStateFilePath = () => {
  const envPath = String(process.env.AIOPSTERM_CHAT_HISTORY_STATE_FILE || '').trim()
  return envPath ? (isAbsolute(envPath) ? envPath : resolve(envPath)) : resolve(process.cwd(), '.aiopsterm-chat-history.json')
}

const legacyChatHistoryStateFilePath = () => resolve(dirname(runtimeConfig.stateFilePath), 'aiopsterm-chat-history.json')

const defaultChatHistorySeedMode = shouldUseChatHistorySeedData

let runtimeConfig: Required<ChatHistoryBackendRuntimeConfig> = {
  stateFilePath: defaultChatHistoryStateFilePath(),
  useSeedData: defaultChatHistorySeedMode()
}

const emptyState = (): ChatHistoryStoreShape => ({
  version: 1,
  selectedConversationId: '',
  conversations: [],
  messagesByConversationId: {}
})

const seedState = (): ChatHistoryStoreShape => ({
  version: 1,
  selectedConversationId: 'conv-1',
  conversations: [
    {
      id: 'conv-1',
      title: '生产巡检',
      summary: '分析磁盘、负载和服务状态',
      updatedAt: '刚刚',
      ts: seedTime,
      ipAddress: '10.24.8.12'
    },
    {
      id: 'conv-2',
      title: 'K8s 发布失败',
      summary: '检查 Pod 事件和镜像拉取',
      updatedAt: '今天',
      ts: seedTime - 1000 * 60 * 45,
      ipAddress: 'prod-cluster'
    },
    {
      id: 'conv-3',
      title: '数据库慢查询',
      summary: '梳理慢日志和索引建议',
      updatedAt: '昨天',
      ts: seedTime - 1000 * 60 * 60 * 24,
      ipAddress: '10.32.6.9'
    }
  ],
  messagesByConversationId: {
    'conv-1': [
      { id: 'hist-conv-1-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-1-user', role: 'user', text: '分析磁盘、负载和服务状态', hosts: [{ id: 'history-host-conv-1', kind: 'hosts', label: '10.24.8.12', detail: '生产巡检' }] },
      { id: 'hist-conv-1-assistant', role: 'assistant', text: '生产巡检历史包含磁盘容量、负载趋势和核心服务状态检查记录。', state: 'done' }
    ],
    'conv-2': [
      { id: 'hist-conv-2-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-2-user', role: 'user', text: '检查 Pod 事件和镜像拉取', hosts: [{ id: 'history-host-conv-2', kind: 'hosts', label: 'prod-cluster', detail: 'K8s 发布失败' }] },
      { id: 'hist-conv-2-assistant', role: 'assistant', text: 'K8s 发布失败历史包含 Pod 事件、镜像拉取状态和回滚检查记录。', state: 'done' }
    ],
    'conv-3': [
      { id: 'hist-conv-3-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
      { id: 'hist-conv-3-user', role: 'user', text: '梳理慢日志和索引建议', hosts: [{ id: 'history-host-conv-3', kind: 'hosts', label: '10.32.6.9', detail: '数据库慢查询' }] },
      { id: 'hist-conv-3-assistant', role: 'assistant', text: '数据库慢查询历史包含慢日志摘要、疑似缺失索引和 SQL 优化建议。', state: 'done' }
    ]
  }
})

let chatHistoryState: ChatHistoryStoreShape = runtimeConfig.useSeedData ? seedState() : emptyState()
let chatHistoryStateLoaded = false
let loadedStateFilePath = ''
let persistenceTestHooks: ChatHistoryPersistenceTestHooks = {}

const normalizeText = (value: unknown) => String(value || '').trim()

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = stableValue(value[key])
      if (nextValue !== undefined) result[key] = nextValue
      return result
    }, {})
}

const stableJson = (value: unknown) => JSON.stringify(stableValue(value))

const utf8ByteLength = (value: string) => Buffer.byteLength(value, 'utf8')

const messagePayloadBytes = (message: AiChatHistoryMessage) => utf8ByteLength(JSON.stringify(message))

const createHistoryTruncationMessage = (omittedMessages: number, omittedBytes: number): AiChatHistoryMessage => ({
  id: chatHistoryTruncationMessageId,
  role: 'system',
  text: `已隐藏较早的 ${omittedMessages} 条 AI 历史消息，约 ${Math.ceil(Math.max(0, omittedBytes) / 1024)} KiB。当前只加载最近的历史用于渲染，完整历史仍保存在本地。`,
  say: 'context_truncated',
  partial: true
})

const isHistoryTruncationMessage = (message: AiChatHistoryMessage) => message.id === chatHistoryTruncationMessageId && message.say === 'context_truncated'

const hasHistoryTruncationMarker = (messages: AiChatHistoryMessage[]) => messages.some(isHistoryTruncationMessage)

const buildRestoreMessages = (messages: AiChatHistoryMessage[]) => {
  const normalizedMessages = cloneMessages(messages)
  if (normalizedMessages.length <= chatHistoryRestoreMessageLimit) {
    const bytes = normalizedMessages.reduce((total, message) => total + messagePayloadBytes(message), 0)
    if (bytes <= chatHistoryRestorePayloadByteLimit) {
      return {
        messages: normalizedMessages,
        totalMessages: normalizedMessages.length,
        returnedMessages: normalizedMessages.length,
        truncated: false
      }
    }
  }

  const selected: AiChatHistoryMessage[] = []
  let selectedBytes = 0
  for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
    if (selected.length >= chatHistoryRestoreMessageLimit) break
    const message = normalizedMessages[index]
    const bytes = messagePayloadBytes(message)
    if (selected.length && selectedBytes + bytes > chatHistoryRestorePayloadByteLimit) break
    selected.unshift(message)
    selectedBytes += bytes
  }
  if (!selected.length && normalizedMessages.length) {
    const latest = normalizedMessages.at(-1)!
    selected.push(latest)
    selectedBytes += messagePayloadBytes(latest)
  }
  const omittedMessages = Math.max(0, normalizedMessages.length - selected.length)
  const totalBytes = normalizedMessages.reduce((total, message) => total + messagePayloadBytes(message), 0)
  const omittedBytes = Math.max(0, totalBytes - selectedBytes)
  const truncated = omittedMessages > 0
  return {
    messages: truncated ? [createHistoryTruncationMessage(omittedMessages, omittedBytes), ...selected] : selected,
    totalMessages: normalizedMessages.length,
    returnedMessages: selected.length,
    truncated
  }
}

const mergeTruncatedMessageSnapshot = (existingMessages: AiChatHistoryMessage[], messages: AiChatHistoryMessage[]) => {
  if (!hasHistoryTruncationMarker(messages)) return messages
  const visibleMessages = messages.filter((message) => !isHistoryTruncationMessage(message))
  if (!visibleMessages.length) return existingMessages
  const firstVisibleId = visibleMessages[0].id
  const mergeIndex = existingMessages.findIndex((message) => message.id === firstVisibleId)
  if (mergeIndex < 0) {
    const existingIds = new Set(existingMessages.map((message) => message.id))
    return [...existingMessages, ...visibleMessages.filter((message) => !existingIds.has(message.id))]
  }
  return [...existingMessages.slice(0, mergeIndex), ...visibleMessages]
}

const normalizeMessages = (messages: unknown): AiChatHistoryMessage[] => {
  if (!Array.isArray(messages)) return []
  return messages
    .map((item, index): AiChatHistoryMessage | null => {
      if (!isRecord(item)) return null
      const role = item.role === 'user' || item.role === 'assistant' || item.role === 'system' ? item.role : null
      const text = normalizeText(item.text)
      if (!role || !text) return null
      const hosts = Array.isArray(item.hosts)
        ? item.hosts
            .map((host): ChatHistoryHostContext | null => {
              if (!isRecord(host)) return null
              const label = normalizeText(host.label)
              if (!label) return null
              return {
                id: normalizeText(host.id) || `history-host-${index}`,
                kind: 'hosts',
                label,
                detail: normalizeText(host.detail) || undefined
              }
            })
            .filter(Boolean) as AiChatHistoryMessage['hosts']
        : undefined
      const ask =
        item.ask === 'command' || item.ask === 'mcp_tool_call' || item.ask === 'mcp_resource_access' || item.ask === 'followup' ? item.ask : undefined
      const say =
        item.say === 'command' || item.say === 'command_output' || item.say === 'search_result' || item.say === 'context_truncated'
          ? item.say
          : undefined
      const action = item.action === 'approved' || item.action === 'rejected' ? item.action : undefined
      const contentParts = Array.isArray(item.contentParts) ? cloneJson(item.contentParts) : undefined
      const mcpToolCall = isRecord(item.mcpToolCall)
        ? {
            serverName: normalizeText(item.mcpToolCall.serverName),
            toolName: normalizeText(item.mcpToolCall.toolName),
            arguments: isRecord(item.mcpToolCall.arguments) ? cloneJson(item.mcpToolCall.arguments) : undefined
          }
        : undefined
      const commandExecution = isRecord(item.commandExecution)
        ? {
            ip: normalizeText(item.commandExecution.ip),
            command: normalizeText(item.commandExecution.command),
            requiresApproval: item.commandExecution.requiresApproval === true,
            interactive: item.commandExecution.interactive === true
          }
        : undefined
      const agentTask = isRecord(item.agentTask)
        ? {
            taskId: normalizeText(item.agentTask.taskId),
            turnId: normalizeText(item.agentTask.turnId),
            terminalSessionId: normalizeText(item.agentTask.terminalSessionId) || undefined,
            toolCallId: normalizeText(item.agentTask.toolCallId) || undefined,
            toolName: normalizeText(item.agentTask.toolName) || undefined,
            status:
              item.agentTask.status === 'starting' ||
              item.agentTask.status === 'running' ||
              item.agentTask.status === 'waiting-approval' ||
              item.agentTask.status === 'done' ||
              item.agentTask.status === 'cancelled' ||
              item.agentTask.status === 'error'
                ? item.agentTask.status
                : undefined
          }
        : undefined
      const mcpResourceAccess = isRecord(item.mcpResourceAccess)
        ? {
            serverName: normalizeText(item.mcpResourceAccess.serverName),
            uri: normalizeText(item.mcpResourceAccess.uri)
          }
        : undefined
      const followupOptions = Array.isArray(item.followupOptions) ? item.followupOptions.map(normalizeText).filter(Boolean) : undefined
      return {
        id: normalizeText(item.id) || `history-message-${index + 1}`,
        role,
        text,
        contentParts: contentParts?.length ? contentParts : undefined,
        hosts: hosts?.length ? hosts : undefined,
        state: item.state === 'streaming' || item.state === 'done' || item.state === 'cancelled' || item.state === 'error' ? item.state : undefined,
        favorite: item.favorite === true ? true : undefined,
        feedback: item.feedback === 'up' || item.feedback === 'down' ? item.feedback : undefined,
        executedCommand: normalizeText(item.executedCommand) || undefined,
        commandExecutionStatus:
          item.commandExecutionStatus === 'pending' ||
          item.commandExecutionStatus === 'running' ||
          item.commandExecutionStatus === 'succeeded' ||
          item.commandExecutionStatus === 'failed'
            ? item.commandExecutionStatus
            : undefined,
        commandExecutionMessage: normalizeText(item.commandExecutionMessage) || undefined,
        ask,
        say,
        action,
        commandExecution: commandExecution?.ip && commandExecution.command ? commandExecution : undefined,
        agentTask: agentTask?.taskId && agentTask.turnId && agentTask.status ? (agentTask as AiChatHistoryMessage['agentTask']) : undefined,
        mcpToolCall: mcpToolCall?.serverName && mcpToolCall.toolName ? mcpToolCall : undefined,
        mcpResourceAccess: mcpResourceAccess?.serverName && mcpResourceAccess.uri ? mcpResourceAccess : undefined,
        followupOptions: followupOptions?.length ? followupOptions : undefined,
        selectedOption: normalizeText(item.selectedOption) || undefined,
        partial: item.partial === true ? true : undefined
      }
    })
    .filter(Boolean) as AiChatHistoryMessage[]
}

const legacyWelcomeAssistantText = '请输入本次运维目标。'

const isLegacyWelcomeAssistantMessage = (message: AiChatHistoryMessage) =>
  message.role === 'assistant' && message.text === legacyWelcomeAssistantText && message.state === 'done'

const stripLegacyWelcomeAssistantMessages = (messages: AiChatHistoryMessage[]) => {
  if (runtimeConfig.useSeedData) return messages
  return messages.filter((message) => !isLegacyWelcomeAssistantMessage(message))
}

const uniqueId = (value: string, fallback: string, seenIds: Set<string>) => {
  let id = value || fallback
  let suffix = 2
  while (seenIds.has(id)) {
    id = `${value || fallback}-${suffix}`
    suffix += 1
  }
  seenIds.add(id)
  return id
}

const normalizeStateShape = (source?: Partial<ChatHistoryStoreShape> | null, fallback = runtimeConfig.useSeedData ? seedState() : emptyState()): ChatHistoryStoreShape => {
  const rawConversations = Array.isArray(source?.conversations) ? source.conversations : fallback.conversations
  const seenConversationIds = new Set<string>()
  const conversations = rawConversations
    .map((item, index): AiChatConversationRecord | null => {
      if (!isRecord(item)) return null
      const id = uniqueId(normalizeText(item.id), `conv-${index + 1}`, seenConversationIds)
      const title = normalizeText(item.title) || 'New Chat'
      return {
        id,
        title,
        summary: normalizeText(item.summary) || title,
        updatedAt: normalizeText(item.updatedAt) || nowText(),
        ts: typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now() - index,
        ipAddress: normalizeText(item.ipAddress) || undefined,
        favorite: item.favorite === true ? true : undefined
      }
    })
    .filter(Boolean) as AiChatConversationRecord[]
  const nextMessages: Record<string, AiChatHistoryMessage[]> = {}
  const rawMessages = isRecord(source?.messagesByConversationId) ? source.messagesByConversationId : fallback.messagesByConversationId
  conversations.forEach((conversation) => {
    const messages = stripLegacyWelcomeAssistantMessages(normalizeMessages(rawMessages[conversation.id]))
    nextMessages[conversation.id] = messages
  })
  const selectedConversationId = conversations.some((item) => item.id === source?.selectedConversationId)
    ? String(source?.selectedConversationId)
    : conversations[0]?.id || ''
  return { version: 1, conversations, messagesByConversationId: nextMessages, selectedConversationId }
}

const stripLegacySeedChatHistoryState = (state: ChatHistoryStoreShape): ChatHistoryStoreShape => {
  const normalizedSeedState = normalizeStateShape(seedState(), seedState())
  const seedConversations = new Map(normalizedSeedState.conversations.map((conversation) => [conversation.id, conversation]))
  const conversations = state.conversations.filter((conversation) => {
    const seedConversation = seedConversations.get(conversation.id)
    if (!seedConversation) return true
    return (
      stableJson(conversation) !== stableJson(seedConversation) ||
      stableJson(state.messagesByConversationId[conversation.id] || []) !== stableJson(normalizedSeedState.messagesByConversationId[conversation.id] || [])
    )
  })
  const messagesByConversationId: Record<string, AiChatHistoryMessage[]> = {}
  conversations.forEach((conversation) => {
    messagesByConversationId[conversation.id] = state.messagesByConversationId[conversation.id] || []
  })
  const selectedConversationId = conversations.some((conversation) => conversation.id === state.selectedConversationId) ? state.selectedConversationId : conversations[0]?.id || ''
  return { version: 1, conversations, messagesByConversationId, selectedConversationId }
}

const normalizeState = (source?: Partial<ChatHistoryStoreShape> | null): ChatHistoryStoreShape => {
  const normalized = normalizeStateShape(source)
  return runtimeConfig.useSeedData ? normalized : stripLegacySeedChatHistoryState(normalized)
}

const applyInitialState = () => {
  chatHistoryState = runtimeConfig.useSeedData ? seedState() : emptyState()
}

const readPersistedState = (stateFilePath: string) => {
  const parsed = JSON.parse(readFileSync(stateFilePath, 'utf-8')) as Partial<ChatHistoryStoreShape>
  return normalizeState(parsed)
}

const tempStatePathFor = (stateFilePath: string) => `${stateFilePath}.${process.pid}.${Date.now()}.tmp`

const writeStateToFilePath = (stateFilePath: string, state: ChatHistoryStoreShape) => {
  mkdirSync(dirname(stateFilePath), { recursive: true })
  const tempPath = tempStatePathFor(stateFilePath)
  writeFileSync(tempPath, JSON.stringify(state), 'utf-8')
  renameSync(tempPath, stateFilePath)
}

const removeTempStateFile = async (tempPath: string) => {
  try {
    await rm(tempPath, { force: true })
  } catch {
    /* Stale temp cleanup is best-effort. */
  }
}

const writeStatePayloadToFilePath = async (stateFilePath: string, payload: string, shouldCommit: () => boolean) => {
  await mkdir(dirname(stateFilePath), { recursive: true })
  const tempPath = tempStatePathFor(stateFilePath)
  let committed = false
  try {
    await (persistenceTestHooks.writeFile || writeFile)(tempPath, payload, 'utf-8')
    if (!shouldCommit()) return
    // Keep the generation check and final commit in the same JS turn. This prevents
    // a synchronous flush from interleaving after the check but before the rename.
    renameSync(tempPath, stateFilePath)
    committed = true
  } finally {
    if (!committed) await removeTempStateFile(tempPath)
  }
}

// 内存 state 是权威数据，磁盘写入按去抖窗口异步合并；进程退出与运行时重配置时同步兜底。
// 同步兜底写与异步队列写通过 persistGeneration 串接：同步写递增代数并作废所有已入队
// 的异步快照，防止旧快照在同步写之后落盘、把更新的内容覆盖回旧状态。
const persistDebounceMs = 400
let persistTimer: NodeJS.Timeout | null = null
let persistDirty = false
let persistQueue: Promise<void> = Promise.resolve()
let persistGeneration = 0
let pendingAsyncPersists = 0
let exitFlushArmed = false

const clearPersistTimer = () => {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
}

const armExitFlush = () => {
  if (exitFlushArmed) return
  exitFlushArmed = true
  process.once('exit', flushPendingPersistSync)
}

const disarmExitFlush = () => {
  if (!exitFlushArmed) return
  exitFlushArmed = false
  process.removeListener('exit', flushPendingPersistSync)
}

const flushPendingPersistSync = () => {
  clearPersistTimer()
  // 在途异步写在进程退出时不会再被事件循环推进，此处同样需要兜底落盘当前状态。
  const mustWrite = persistDirty || pendingAsyncPersists > 0
  persistDirty = false
  persistGeneration += 1
  disarmExitFlush()
  if (!mustWrite) return
  try {
    writeStateToFilePath(runtimeConfig.stateFilePath, chatHistoryState)
  } catch {
    /* Chat history persistence should not turn successful UI mutations into failures. */
  }
}

const enqueuePendingPersist = () => {
  clearPersistTimer()
  if (!persistDirty) return
  persistDirty = false
  const generation = persistGeneration
  const stateFilePath = runtimeConfig.stateFilePath
  const payload = JSON.stringify(chatHistoryState)
  pendingAsyncPersists += 1
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(() => (generation === persistGeneration ? writeStatePayloadToFilePath(stateFilePath, payload, () => generation === persistGeneration) : undefined))
    .catch(() => undefined)
    .then(() => {
      pendingAsyncPersists = Math.max(0, pendingAsyncPersists - 1)
      if (!persistDirty && pendingAsyncPersists === 0) disarmExitFlush()
    })
}

const schedulePersistState = () => {
  persistDirty = true
  armExitFlush()
  if (persistTimer) return
  persistTimer = setTimeout(enqueuePendingPersist, persistDebounceMs)
  persistTimer.unref()
}

const dropPendingPersist = () => {
  clearPersistTimer()
  persistDirty = false
  persistGeneration += 1
  disarmExitFlush()
}

export const flushChatHistoryWrites = async () => {
  enqueuePendingPersist()
  await persistQueue
}

const rewriteNormalizedStateFile = (stateFilePath: string) => {
  try {
    if (!existsSync(stateFilePath)) return
    writeStateToFilePath(stateFilePath, readPersistedState(stateFilePath))
  } catch {
    /* Legacy compatibility files are best-effort cleanup only. */
  }
}

const ensureStateLoaded = () => {
  if (chatHistoryStateLoaded && loadedStateFilePath === runtimeConfig.stateFilePath) return
  chatHistoryStateLoaded = true
  loadedStateFilePath = runtimeConfig.stateFilePath
  applyInitialState()
  const primaryStateExists = existsSync(runtimeConfig.stateFilePath)
  const legacyStateFilePath = legacyChatHistoryStateFilePath()
  const stateFilePath = primaryStateExists ? runtimeConfig.stateFilePath : legacyStateFilePath
  if (!existsSync(stateFilePath)) return
  try {
    chatHistoryState = readPersistedState(stateFilePath)
    // 启动迁移属于一次性写入，保持同步落盘，之后的运行时更新才走去抖。
    if (stateFilePath !== runtimeConfig.stateFilePath || !runtimeConfig.useSeedData) {
      try {
        writeStateToFilePath(runtimeConfig.stateFilePath, chatHistoryState)
      } catch {
        /* Chat history persistence should not turn successful UI mutations into failures. */
      }
    }
    if (!runtimeConfig.useSeedData && primaryStateExists) rewriteNormalizedStateFile(legacyStateFilePath)
  } catch {
    /* Keep the backend-owned empty or seed state when persisted chat history is corrupt. */
  }
}

// 加载时已全量 normalize，之后返回权威 state 引用，变更处只 normalize 被修改的数据。
const getState = () => {
  ensureStateLoaded()
  return chatHistoryState
}

const successSnapshot = (state: ChatHistoryStoreShape): AiChatHistoryListResult => ({
  ok: true,
  data: {
    conversations: state.conversations.map(cloneConversation),
    selectedConversationId: state.selectedConversationId
  }
})

const mutationResult = (state: ChatHistoryStoreShape, conversation: AiChatConversationRecord): AiChatConversationMutationResult => ({
  ok: true,
  data: {
    conversation: cloneConversation(conversation),
    conversations: state.conversations.map(cloneConversation),
    selectedConversationId: state.selectedConversationId
  }
})

const errorResult = <T>(errorCode: string, errorMessage: string): { ok: false; errorCode: string; errorMessage: string } => ({
  ok: false,
  errorCode,
  errorMessage
})

export const replaceChatConversationMessages = (conversationIdInput: string, messagesInput: AiChatHistoryMessage[]): AiChatMessageMetadataResult => {
  const conversationId = normalizeText(conversationIdInput)
  if (!conversationId) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatMessageMetadataResult
  const messages = normalizeMessages(messagesInput)
  if (!messages.length) return errorResult('CHAT_HISTORY_MESSAGES_REQUIRED', 'Conversation messages are required.') as AiChatMessageMetadataResult
  const state = getState()
  const conversation = state.conversations.find((item) => item.id === conversationId)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatMessageMetadataResult
  state.messagesByConversationId[conversationId] = messages
  state.selectedConversationId = conversationId
  conversation.updatedAt = nowText()
  conversation.ts = Math.max(Date.now(), ...state.conversations.map((item) => item.ts), 0) + 1
  schedulePersistState()
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: cloneMessages(messages)
    }
  }
}

export const getChatConversationMessages = (
  conversationIdInput: string
): AiopsMutationResult<{ conversation: AiChatConversationRecord; messages: AiChatHistoryMessage[] }> => {
  const conversationId = normalizeText(conversationIdInput)
  if (!conversationId) {
    return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiopsMutationResult<{
      conversation: AiChatConversationRecord
      messages: AiChatHistoryMessage[]
    }>
  }
  const state = getState()
  const conversation = state.conversations.find((item) => item.id === conversationId)
  if (!conversation) {
    return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiopsMutationResult<{
      conversation: AiChatConversationRecord
      messages: AiChatHistoryMessage[]
    }>
  }
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: cloneMessages(state.messagesByConversationId[conversationId] || [])
    }
  }
}

export const configureChatHistoryBackendRuntime = (config: ChatHistoryBackendRuntimeConfig = {}) => {
  flushPendingPersistSync()
  runtimeConfig = {
    stateFilePath: config.stateFilePath ? (isAbsolute(config.stateFilePath) ? config.stateFilePath : resolve(config.stateFilePath)) : defaultChatHistoryStateFilePath(),
    useSeedData: config.useSeedData ?? defaultChatHistorySeedMode()
  }
  chatHistoryStateLoaded = false
  loadedStateFilePath = ''
  applyInitialState()
}

export const resetChatHistoryForTests = () => {
  dropPendingPersist()
  applyInitialState()
  chatHistoryStateLoaded = true
  loadedStateFilePath = runtimeConfig.stateFilePath
}

export const configureChatHistoryPersistenceHooksForTests = (hooks: ChatHistoryPersistenceTestHooks = {}) => {
  persistenceTestHooks = hooks
}

export const listChatConversations = (): AiChatHistoryListResult => successSnapshot(getState())

export const createChatConversation = (): AiChatConversationMutationResult => {
  const state = getState()
  const conversation: AiChatConversationRecord = {
    id: `conv-${randomUUID()}`,
    title: '新会话',
    summary: '等待输入运维目标',
    updatedAt: nowText(),
    ts: Math.max(Date.now(), ...state.conversations.map((item) => item.ts), 0) + 1
  }
  state.conversations.unshift(conversation)
  state.selectedConversationId = conversation.id
  state.messagesByConversationId[conversation.id] = []
  schedulePersistState()
  return mutationResult(state, conversation)
}

export const updateChatConversation = (input: AiChatConversationUpdateInput): AiChatConversationMutationResult => {
  const id = normalizeText(input.id)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationMutationResult
  const state = getState()
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationMutationResult

  const existingMessages = state.messagesByConversationId[id] || []
  if (input.title !== undefined) {
    const title = normalizeText(input.title)
    if (!title) return errorResult('CHAT_HISTORY_TITLE_REQUIRED', 'Conversation title is required.') as AiChatConversationMutationResult
    conversation.title = title
  }
  if (input.summary !== undefined) conversation.summary = normalizeText(input.summary) || conversation.summary
  if (input.favorite !== undefined) conversation.favorite = Boolean(input.favorite)
  let savedMessages = false
  if (input.messages !== undefined) {
    const messages = mergeTruncatedMessageSnapshot(existingMessages, normalizeMessages(input.messages))
    if (messages.length) {
      state.messagesByConversationId[id] = messages
      savedMessages = true
    }
  }
  conversation.updatedAt = nowText()
  conversation.ts = Math.max(Date.now(), ...state.conversations.map((item) => item.ts), 0) + 1
  if (savedMessages) state.selectedConversationId = id
  schedulePersistState()
  return mutationResult(state, conversation)
}

export const deleteChatConversation = (idInput: string): AiChatConversationDeleteResult => {
  const id = normalizeText(idInput)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationDeleteResult
  const state = getState()
  if (!state.conversations.some((item) => item.id === id)) {
    return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationDeleteResult
  }
  state.conversations = state.conversations.filter((item) => item.id !== id)
  delete state.messagesByConversationId[id]
  if (state.selectedConversationId === id) state.selectedConversationId = state.conversations[0]?.id || ''
  schedulePersistState()
  return {
    ok: true,
    data: {
      deletedId: id,
      conversations: state.conversations.map(cloneConversation),
      selectedConversationId: state.selectedConversationId
    }
  }
}

export const restoreChatConversation = (idInput: string): AiChatConversationRestoreResult => {
  const id = normalizeText(idInput)
  if (!id) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatConversationRestoreResult
  const state = getState()
  const conversation = state.conversations.find((item) => item.id === id)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatConversationRestoreResult
  state.selectedConversationId = id
  schedulePersistState()
  const restoreMessages = buildRestoreMessages(state.messagesByConversationId[id] || [])
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: restoreMessages.messages,
      totalMessages: restoreMessages.totalMessages,
      returnedMessages: restoreMessages.returnedMessages,
      truncated: restoreMessages.truncated
    }
  }
}

export const saveChatMessageMetadata = (input: AiChatMessageMetadataInput): AiChatMessageMetadataResult => {
  const conversationId = normalizeText(input.conversationId)
  const messageId = normalizeText(input.messageId)
  if (!conversationId) return errorResult('CHAT_HISTORY_ID_REQUIRED', 'Conversation id is required.') as AiChatMessageMetadataResult
  if (!messageId) return errorResult('CHAT_HISTORY_MESSAGE_ID_REQUIRED', 'Message id is required.') as AiChatMessageMetadataResult
  const state = getState()
  const conversation = state.conversations.find((item) => item.id === conversationId)
  if (!conversation) return errorResult('CHAT_HISTORY_NOT_FOUND', 'Conversation not found.') as AiChatMessageMetadataResult
  const messages = state.messagesByConversationId[conversationId] || []
  const message = messages.find((item) => item.id === messageId)
  if (!message) return errorResult('CHAT_HISTORY_MESSAGE_NOT_FOUND', 'Message not found.') as AiChatMessageMetadataResult
  if (input.favorite !== undefined) message.favorite = Boolean(input.favorite)
  if (input.feedback !== undefined) {
    if (input.feedback === 'up' || input.feedback === 'down') {
      message.feedback = input.feedback
    } else {
      delete message.feedback
    }
  }
  state.messagesByConversationId[conversationId] = messages
  schedulePersistState()
  return {
    ok: true,
    data: {
      conversation: cloneConversation(conversation),
      messages: cloneMessages(messages)
    }
  }
}
