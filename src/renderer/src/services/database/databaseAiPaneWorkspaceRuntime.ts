import { computed, nextTick, onScopeDispose, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import { createClineTaskEventLifecycle } from '@/services/ai/clineTaskEventLifecycleRuntime'
import { databaseClient } from '@/services/database/databaseClient'
import { productSessionClient } from '@/services/ai/productSessionClient'
import { currentSqlStatement, extractFencedSql } from '@/services/database/databaseSqlEditorRuntime'
import {
  applyDbAiPaneStateSnapshot as applyRuntimeDbAiPaneStateSnapshot,
  clampDbAiPaneWidth,
  currentDbAiPaneStateSnapshot as currentRuntimeDbAiPaneStateSnapshot,
  dbAiActionLabel,
  dbAiLocalizedBackendMessage,
  dbAiPaneCanSend as runtimeDbAiPaneCanSend,
  dbAiPaneContextSummary as runtimeDbAiPaneContextSummary,
  dbAiPaneIsStreaming as runtimeDbAiPaneIsStreaming,
  dbAiPaneRequestInput,
  dbAiPaneStatusLabel as runtimeDbAiPaneStatusLabel,
  dbAiQuickPromptText,
  dbAiSql,
  dbAiDialectLabel,
  normalizeDbAiTargetDialect,
  normalizeDbAiPaneContext as normalizeRuntimeDbAiPaneContext,
  type SqlTab
} from '@/services/database/databaseAiRuntime'
import {
  isDbAiDrawerRequestRecord,
  isDbAiPaneLifecycleData,
  isDbAiPaneMessageRecord,
  isDbAiPaneRequestData,
  isDbAiPaneResponseData,
  isDbAiPaneStateSnapshot,
  type DbAiBackendContext,
  type DbAiPaneContext,
  type DbAiPaneMessage,
  type DbAiAction,
  type DbAiRequest
} from '@/services/database/databaseBackendGuards'
import { DB_AI_PANE_DEFAULT_WIDTH, sqlConnectionRequiresSchema } from '@/services/database/databaseWorkspaceRuntime'
import type { DbAiPaneQuickPrompt, SqlConsoleContext } from '@/services/database/databaseWorkspaceTypes'
import type {
  DatabaseAiPaneLifecycleResult,
  DatabaseAiPaneRequestResult,
  DatabaseAiPaneResponseResult,
  DatabaseAiResponseLanguage,
  DatabaseAiPaneSessionSnapshot,
  DatabaseAiPaneStateSnapshot,
  DatabaseConnectionInfo
} from '@shared/contracts/database'
import type { ClineAgentTaskEvent } from '@shared/contracts/clineAgent'
import {
  clineAgentTaskIdentityKey,
  databaseClineAgentTaskIdentity
} from '@shared/clineAgentTaskIdentity'
import { databaseAiNl2SqlPrompt } from '@shared/databaseAiSqlRuntime'
import { DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS } from '@shared/databaseAiStateRuntime'

type DatabaseAiPaneWorkspaceRuntimeState = {
  connections: Ref<DatabaseConnectionInfo[]>
  expandedConnections: Ref<string[]>
  activeSqlTab: ComputedRef<SqlTab | null>
  databaseAiPanelsRef: Ref<{ scrollPaneMessagesToBottom: () => void; focusPaneComposer?: () => void } | null>
}

type DatabaseAiPaneWorkspaceRuntimeDeps = {
  showNotice: (message: string) => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  defaultSqlContextForConnection: (connection: DatabaseConnectionInfo) => SqlConsoleContext
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  connectConnection: (connectionId: string) => Promise<boolean>
  getResponseLanguage: () => DatabaseAiResponseLanguage
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
}

type DbAiPaneClineTurnTarget = {
  messageId: string
  requestId: string
  conversationId: string
  conversationGeneration: number
}

const createDbAiPaneConversationId = () => {
  const id = globalThis.crypto?.randomUUID?.()
  return `dbai-pane-conversation-${id || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export const DB_AI_PANE_CANCEL_BRIDGE_TIMEOUT_MS = 1_000

export const createDatabaseAiPaneWorkspaceRuntime = (
  state: DatabaseAiPaneWorkspaceRuntimeState,
  deps: DatabaseAiPaneWorkspaceRuntimeDeps
) => {
  const { connections, expandedConnections, activeSqlTab, databaseAiPanelsRef } = state
  const {
    showNotice,
    bridgeErrorMessage,
    findConnection,
    defaultSqlContextForConnection,
    resolveSqlConsoleContext,
    connectConnection,
    getResponseLanguage,
    getSelectedSqlText,
    getSqlCursorOffset
  } = deps
  const i18nText = (key: I18nKey) => translateWithLocale(getResponseLanguage(), key)
  const localizedBackendMessage = (
    errorCode: unknown,
    errorMessage: unknown,
    fallback: string,
    responseLanguage: DatabaseAiResponseLanguage = getResponseLanguage()
  ) => dbAiLocalizedBackendMessage({ responseLanguage, errorCode, errorMessage, fallback })

  const dbAiPaneOpen = ref(false)
  const dbAiPaneWidth = ref(DB_AI_PANE_DEFAULT_WIDTH)
  const dbAiPaneResizing = ref(false)
  const dbAiPaneContext = reactive<DbAiPaneContext>({
    connectionId: '',
    catalogName: '',
    schemaName: '',
    dbType: ''
  })
  const dbAiPaneDraft = ref('')
  const dbAiPaneComposerAction = ref<DbAiAction | null>(null)
  const dbAiPaneMessages = ref<DbAiPaneMessage[]>([])
  const dbAiPaneArchivedSessions = ref<DatabaseAiPaneSessionSnapshot[]>([])
  const dbAiPaneRestoreIssues = ref<string[]>([])
  const dbAiPaneConversationId = ref(createDbAiPaneConversationId())
  const dbAiPaneRequestStarting = ref(false)
  const dbAiPaneSessionRestoring = ref(false)
  let dbAiPaneResizeStartX = 0
  let dbAiPaneResizeStartWidth = DB_AI_PANE_DEFAULT_WIDTH
  let dbAiPaneContextTouched = false
  let dbAiPaneStateHydrating = false
  let dbAiPaneStateNoticeShown = false
  let dbAiPaneConversationGeneration = 0
  let dbAiPaneProductBacked = false
  let dbAiPaneStateSaveQueue: Promise<void> = Promise.resolve()
  let dbAiPaneStateSavePending = 0
  let dbAiPaneStateSaveSuspended = false
  let dbAiPaneRestorePromise: Promise<boolean> | null = null
  let dbAiPaneProjectionBeforeOrdinal: number | null = null
  let dbAiPaneProjectionHasMore = false
  let dbAiPaneProjectionLoading = false
  let dbAiPaneSeedStartMessageId = ''
  const dbAiPaneSessionClosePromises = new Map<string, Promise<boolean>>()
  const dbAiPaneClineTurns = new Map<string, DbAiPaneClineTurnTarget>()

  const applyDbAiPaneClineEvent = (target: DbAiPaneClineTurnTarget, event: ClineAgentTaskEvent) => {
    if (
      target.conversationGeneration !== dbAiPaneConversationGeneration ||
      target.conversationId !== dbAiPaneConversationId.value
    ) return false
    if (
      event.type === 'tool-call' ||
      event.type === 'tool-update' ||
      event.type === 'tool-result' ||
      event.type === 'reasoning-delta' ||
      event.type === 'usage'
    ) return true
    let changed = false
    const nextMessages = dbAiPaneMessages.value.map((message): DbAiPaneMessage => {
      if (message.id !== target.messageId || message.requestId !== target.requestId || message.role !== 'assistant') return message
      if (message.status === 'cancelled' && event.type !== 'cancelled') return message
      const eventTime = Date.parse(event.at)
      const updatedAt = Number.isFinite(eventTime) ? eventTime : Date.now()
      if (event.type === 'text-delta') {
        changed = true
        return {
          ...message,
          status: 'streaming',
          content: typeof event.accumulated === 'string' ? event.accumulated : `${message.content}${event.text}`,
          updatedAt
        }
      }
      if (event.type === 'done') {
        changed = true
        return { ...message, status: 'done', content: event.text || message.content, updatedAt }
      }
      if (event.type === 'cancelled') {
        changed = true
        return {
          ...message,
          status: 'cancelled',
          content: event.reason
            ? localizedBackendMessage('', event.reason, i18nText('database.ai.notice.requestCancelled'), message.responseLanguage)
            : message.content || i18nText('database.ai.notice.requestCancelled'),
          updatedAt
        }
      }
      if (event.type === 'error') {
        changed = true
        return {
          ...message,
          status: 'error',
          content: localizedBackendMessage(
            event.errorCode,
            event.errorMessage,
            i18nText('database.ai.notice.paneResponseFailed'),
            message.responseLanguage
          ),
          updatedAt
        }
      }
      if (message.status === 'queued') {
        changed = true
        return { ...message, status: 'streaming', updatedAt }
      }
      return message
    })
    if (changed) {
      dbAiPaneMessages.value = nextMessages
      scrollDbAiPaneMessagesToBottom()
    }
    return true
  }

  const dbAiPaneClineEventLifecycle = createClineTaskEventLifecycle({
    resolveTarget: (event) => {
      const identity = databaseClineAgentTaskIdentity(event.turnId)
      if (identity.taskId !== event.taskId) return null
      return dbAiPaneClineTurns.get(clineAgentTaskIdentityKey(identity)) || null
    },
    isTargetReady: () => true,
    applyEvent: applyDbAiPaneClineEvent,
    afterEvent: (_target, event) => {
      if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
        dbAiPaneClineTurns.delete(clineAgentTaskIdentityKey(event))
      }
    }
  })

  const canToggleDbAiPane = computed(() => connections.value.length > 0)
  const dbAiPaneConnection = computed(() => findConnection(dbAiPaneContext.connectionId) ?? null)
  const dbAiPaneCatalogOptions = computed(() => dbAiPaneConnection.value?.catalogs ?? [])
  const dbAiPaneCatalog = computed(() => dbAiPaneCatalogOptions.value.find((catalog) => catalog.name === dbAiPaneContext.catalogName) ?? null)
  const dbAiPaneSchemaOptions = computed(() => dbAiPaneCatalog.value?.schemas ?? [])
  const dbAiPaneRequiresSchema = computed(() => !!dbAiPaneConnection.value && sqlConnectionRequiresSchema(dbAiPaneConnection.value))
  const dbAiPaneConnectionNeedsConnect = computed(() => {
    const connection = dbAiPaneConnection.value
    return !!connection && connection.status !== 'connected' && connection.status !== 'testing'
  })
  const dbAiPaneContextTitle = computed(() => dbAiPaneContextSummary.value || i18nText('database.ai.noContext'))
  const dbAiPaneContextSummary = computed(() => runtimeDbAiPaneContextSummary(
    dbAiPaneConnection.value,
    dbAiPaneContext,
    getResponseLanguage()
  ))
  const dbAiPaneStatusLabel = (status: DbAiPaneMessage['status']) =>
    runtimeDbAiPaneStatusLabel(status, getResponseLanguage())
  const dbAiPaneIsStreaming = computed(() => runtimeDbAiPaneIsStreaming(dbAiPaneMessages.value))
  const dbAiPaneCanSend = computed(() =>
    !dbAiPaneRequestStarting.value &&
    !dbAiPaneSessionRestoring.value &&
    dbAiPaneRestoreIssues.value.length === 0 &&
    runtimeDbAiPaneCanSend(dbAiPaneDraft.value, dbAiPaneContext, dbAiPaneIsStreaming.value)
  )
  const dbAiPaneComposerPlaceholder = computed(() => i18nText(
    dbAiPaneComposerAction.value === 'nl2sql' ? 'database.ai.describeQuery' : 'database.ai.askPlaceholder'
  ))

  const cloneDbAiPaneMessage = (message: DbAiPaneMessage): DbAiPaneMessage => ({
    ...message,
    ...(message.context ? { context: { ...message.context } } : {}),
    ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
  })

  const loadDbAiPaneProjectionPage = async (conversationId: string, beforeOrdinal?: number) => {
    const listProjectionMessages = productSessionClient.listProjectionMessages()
    if (!listProjectionMessages) return null
    try {
      const result = await listProjectionMessages(conversationId, {
        ...(beforeOrdinal === undefined ? {} : { beforeOrdinal }),
        limit: 80
      })
      if (!result?.ok || !result.data || !Array.isArray(result.data.messages)) return null
      const messages = result.data.messages.map((message) => message.payload)
      if (!messages.every((message) => isDbAiPaneMessageRecord(message))) return null
      return {
        ...result.data,
        messages: messages.map((message) => ({
          ...cloneDbAiPaneMessage(message),
          ...(
            message.status === 'queued' || message.status === 'streaming'
              ? { status: 'cancelled' as const, updatedAt: Math.max(message.updatedAt, Date.now()) }
              : {}
          )
        }))
      }
    } catch {
      return null
    }
  }

  const resetDbAiPaneProjectionCursor = () => {
    dbAiPaneProjectionBeforeOrdinal = null
    dbAiPaneProjectionHasMore = false
    dbAiPaneProjectionLoading = false
    dbAiPaneSeedStartMessageId = ''
  }

  const dbAiPaneMessagesForAgentContext = () => {
    if (!dbAiPaneSeedStartMessageId) return dbAiPaneMessages.value
    const start = dbAiPaneMessages.value.findIndex((message) => message.id === dbAiPaneSeedStartMessageId)
    return start < 0 ? dbAiPaneMessages.value : dbAiPaneMessages.value.slice(start)
  }

  const loadOlderDbAiPaneMessages = async () => {
    if (
      dbAiPaneProjectionLoading ||
      !dbAiPaneProjectionHasMore ||
      dbAiPaneProjectionBeforeOrdinal === null
    ) return 0
    const conversationId = dbAiPaneConversationId.value
    dbAiPaneProjectionLoading = true
    try {
      const page = await loadDbAiPaneProjectionPage(conversationId, dbAiPaneProjectionBeforeOrdinal)
      if (!page || conversationId !== dbAiPaneConversationId.value) return 0
      dbAiPaneProjectionBeforeOrdinal = page.nextBeforeOrdinal
      dbAiPaneProjectionHasMore = page.hasMore
      const existingIds = new Set(dbAiPaneMessages.value.map((message) => message.id))
      const older = page.messages.filter((message) => !existingIds.has(message.id))
      if (older.length) dbAiPaneMessages.value = [...older, ...dbAiPaneMessages.value]
      return older.length
    } finally {
      dbAiPaneProjectionLoading = false
    }
  }

  const activeDbAiPaneAssistant = () => [...dbAiPaneMessages.value]
    .reverse()
    .find((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))

  const cancelCapturedDbAiPaneResponse = async (assistantMessage: DbAiPaneMessage) => {
    if (assistantMessage.sqlAction?.transport === 'drawer') {
      const cancelDrawerBridge = databaseClient.cancelDatabaseAiDrawerResponse()
      if (!cancelDrawerBridge) {
        showNotice(i18nText('database.ai.notice.drawerCancelUnavailable'))
        return null
      }
      try {
        const result = await cancelDrawerBridge({ requestId: assistantMessage.requestId })
        if (!result.ok) {
          showNotice(localizedBackendMessage(
            result.errorCode,
            result.errorMessage,
            i18nText('database.ai.notice.requestCancelFailed'),
            assistantMessage.responseLanguage
          ))
          return null
        }
        if (!isDbAiDrawerRequestRecord(result.data, assistantMessage.requestId)) {
          showNotice(i18nText('database.ai.notice.drawerLifecycleMalformed'))
          return null
        }
        return {
          ...assistantMessage,
          status: result.data.status,
          content: result.data.text || assistantMessage.content,
          updatedAt: result.data.updatedAt
        }
      } catch (error) {
        showNotice(localizedBackendMessage(
          '',
          bridgeErrorMessage(error, i18nText('database.ai.notice.requestCancelFailed')),
          i18nText('database.ai.notice.requestCancelFailed'),
          assistantMessage.responseLanguage
        ))
        return null
      }
    }
    const cancelBridge = databaseClient.cancelDatabaseAiPaneResponse()
    if (!cancelBridge) {
      showNotice(i18nText('database.ai.notice.paneCancelUnavailable'))
      return null
    }
    try {
      const result = await cancelBridge({ requestId: assistantMessage.requestId, assistantMessageId: assistantMessage.id })
      if (!result.ok) {
        showNotice(localizedBackendMessage(
          result.errorCode,
          result.errorMessage,
          i18nText('database.ai.notice.paneCancelFailed'),
          assistantMessage.responseLanguage
        ))
        return null
      }
      if (!isDbAiPaneLifecycleData(result.data, { requestId: assistantMessage.requestId, assistantMessageId: assistantMessage.id })) {
        showNotice(i18nText('database.ai.notice.paneLifecycleMalformed'))
        return null
      }
      return result.data.assistantMessage
    } catch (error) {
      showNotice(localizedBackendMessage(
        '',
        bridgeErrorMessage(error, i18nText('database.ai.notice.paneCancelFailed')),
        i18nText('database.ai.notice.paneCancelFailed'),
        assistantMessage.responseLanguage
      ))
      return null
    }
  }

  const cancelCapturedDbAiPaneResponseWithTimeout = async (assistantMessage: DbAiPaneMessage) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<DbAiPaneMessage>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          ...cloneDbAiPaneMessage(assistantMessage),
          status: 'cancelled',
          updatedAt: Date.now()
        })
      }, DB_AI_PANE_CANCEL_BRIDGE_TIMEOUT_MS)
    })
    try {
      return await Promise.race([
        cancelCapturedDbAiPaneResponse(assistantMessage),
        timeout
      ])
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  const closeDbAiPaneProductSession = async (conversationId: string) => {
    const closeProductSession = productSessionClient.close()
    if (!closeProductSession) {
      showNotice(i18nText('database.ai.sessionCloseUnavailable'))
      return false
    }
    try {
      const result = await closeProductSession(conversationId)
      if (!result?.ok && result?.errorCode === 'PRODUCT_SESSION_NOT_FOUND') return true
      if (!result?.ok || result.data?.id !== conversationId) {
        showNotice(localizedBackendMessage(
          result?.errorCode,
          result?.errorMessage,
          i18nText('database.ai.sessionCloseFailed')
        ))
        return false
      }
      return true
    } catch (error) {
      showNotice(localizedBackendMessage(
        '',
        bridgeErrorMessage(error, i18nText('database.ai.sessionCloseFailed')),
        i18nText('database.ai.sessionCloseFailed')
      ))
      return false
    }
  }

  const beginDbAiPaneSessionClose = (
    conversationId: string,
    activeAssistant?: DbAiPaneMessage
  ) => {
    const existing = dbAiPaneSessionClosePromises.get(conversationId)
    if (existing) return existing
    const cancellation = activeAssistant
      ? cancelCapturedDbAiPaneResponseWithTimeout(activeAssistant)
      : Promise.resolve(null)
    const closing = dbAiPaneStateSavePending > 0
      ? dbAiPaneStateSaveQueue.then(() => closeDbAiPaneProductSession(conversationId))
      : closeDbAiPaneProductSession(conversationId)
    const operation = Promise.all([cancellation, closing]).then(([, closed]) => closed)
    let tracked: Promise<boolean>
    tracked = operation.finally(() => {
      if (dbAiPaneSessionClosePromises.get(conversationId) === tracked) {
        dbAiPaneSessionClosePromises.delete(conversationId)
      }
    })
    dbAiPaneSessionClosePromises.set(conversationId, tracked)
    return tracked
  }

  const markDbAiPaneProductSessionOpen = async (conversationId: string) => {
    const updateProductSession = productSessionClient.update()
    if (!updateProductSession) {
      showNotice(i18nText('database.ai.sessionUpdateUnavailable'))
      return false
    }
    try {
      const result = await updateProductSession({ id: conversationId, isOpen: true })
      if (!result?.ok || result.data?.session?.id !== conversationId || !result.data.session.isOpen) {
        showNotice(localizedBackendMessage(
          result?.errorCode,
          result?.errorMessage,
          i18nText('database.ai.sessionUpdateFailed')
        ))
        return false
      }
      return true
    } catch (error) {
      showNotice(localizedBackendMessage(
        '',
        bridgeErrorMessage(error, i18nText('database.ai.sessionUpdateFailed')),
        i18nText('database.ai.sessionUpdateFailed')
      ))
      return false
    }
  }

  const validateDbAiPaneBinding = async (context: DbAiPaneContext) => {
    const connection = findConnection(context.connectionId)
    if (!connection) return [i18nText('database.ai.restoreConnectionMissing')]
    if (connection.status !== 'connected') {
      const connected = await connectConnection(connection.id)
      if (!connected) return [i18nText('database.ai.restoreConnectionFailed')]
    }
    const refreshed = findConnection(context.connectionId) || connection
    const catalog = refreshed.catalogs.find((candidate) => candidate.name === context.catalogName)
    if (!catalog) return [i18nText('database.ai.restoreDatabaseMissing')]
    if (sqlConnectionRequiresSchema(refreshed)) {
      if (!context.schemaName || !(catalog.schemas || []).some((candidate) => candidate.name === context.schemaName)) {
        return [i18nText('database.ai.restoreSchemaMissing')]
      }
    }
    return []
  }

  const retryDbAiPaneBinding = async () => {
    if (dbAiPaneSessionRestoring.value) return false
    dbAiPaneSessionRestoring.value = true
    try {
      dbAiPaneRestoreIssues.value = await validateDbAiPaneBinding({ ...dbAiPaneContext })
      if (dbAiPaneRestoreIssues.value.length) {
        showNotice(dbAiPaneRestoreIssues.value[0])
        return false
      }
      showNotice(i18nText('database.ai.restoreReady'))
      return true
    } finally {
      dbAiPaneSessionRestoring.value = false
    }
  }

  const archiveCurrentDbAiPaneSession = () => {
    if (!dbAiPaneConversationId.value || (!dbAiPaneMessages.value.length && !dbAiPaneDraft.value.trim())) return
    const now = Date.now()
    const messages = dbAiPaneMessages.value.map((message) => ({
      ...cloneDbAiPaneMessage(message),
      ...(message.status === 'queued' || message.status === 'streaming' ? { status: 'cancelled' as const, updatedAt: now } : {})
    }))
    const timestamps = messages.map((message) => message.createdAt).filter(Number.isFinite)
    const updatedTimestamps = messages.map((message) => message.updatedAt).filter(Number.isFinite)
    const snapshot: DatabaseAiPaneSessionSnapshot = {
      conversationId: dbAiPaneConversationId.value,
      context: { ...dbAiPaneContext },
      draft: dbAiPaneDraft.value,
      messages,
      createdAt: timestamps.length ? Math.min(...timestamps) : now,
      updatedAt: updatedTimestamps.length ? Math.max(now, ...updatedTimestamps) : now
    }
    dbAiPaneArchivedSessions.value = [
      snapshot,
      ...dbAiPaneArchivedSessions.value.filter((session) => session.conversationId !== snapshot.conversationId)
    ].slice(0, DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS)
  }

  const resolveDbAiPaneSessionSnapshot = async (conversationId: string) => {
    const archived = dbAiPaneArchivedSessions.value.find((session) => session.conversationId === conversationId)
    const getProductSession = productSessionClient.get()
    if (!getProductSession) return null
    let snapshot: DatabaseAiPaneSessionSnapshot
    try {
      const result = await getProductSession(conversationId)
      const session = result?.data?.session
      if (!result?.ok || !session || session.id !== conversationId || session.surface !== 'database' || !session.database) {
        return null
      }
      const connection = findConnection(session.database.connectionId)
      const context: DbAiPaneContext = {
        connectionId: session.database.connectionId,
        catalogName: session.database.databaseName || '',
        schemaName: session.database.schemaName || '',
        dbType: connection?.dbType || ''
      }
      const archivedMatchesBinding = Boolean(
        archived &&
        archived.context.connectionId === context.connectionId &&
        archived.context.catalogName === context.catalogName &&
        (archived.context.schemaName || '') === (context.schemaName || '')
      )
      snapshot = {
        conversationId,
        context,
        draft: archivedMatchesBinding ? archived!.draft : '',
        messages: archivedMatchesBinding ? archived!.messages.map(cloneDbAiPaneMessage) : [],
        createdAt: archivedMatchesBinding ? archived!.createdAt : session.createdAt,
        updatedAt: Math.max(session.updatedAt, archivedMatchesBinding ? archived!.updatedAt : 0)
      }
    } catch {
      return null
    }
    const page = await loadDbAiPaneProjectionPage(conversationId)
    if (page?.messages.length) snapshot.messages = page.messages
    return {
      snapshot,
      projectionPage: page,
      projectionMissing: snapshot.messages.length === 0
    }
  }

  const sqlTabMatchesDbAiPaneContext = (tab: SqlTab, context: DbAiPaneContext) =>
    tab.connectionId === context.connectionId &&
    tab.catalogName === context.catalogName &&
    (tab.schemaName || '') === (context.schemaName || '')

  const dbAiPaneMessageMatchesContext = (
    message: DbAiPaneMessage,
    context: DbAiPaneContext,
    contextSummary: string
  ) => {
    if (message.context) {
      return (
        message.context.connectionId === context.connectionId &&
        message.context.catalogName === context.catalogName &&
        (message.context.schemaName || '') === (context.schemaName || '')
      )
    }
    const actionContext = message.sqlAction?.context
    if (!actionContext) return false
    if (!actionContext.connectionId || !actionContext.databaseName) return message.contextSummary === contextSummary
    return (
      actionContext.connectionId === context.connectionId &&
      actionContext.databaseName === context.catalogName &&
      (actionContext.schemaName || '') === (context.schemaName || '')
    )
  }

  const normalizeDbAiPaneContext = (input: Partial<DbAiPaneContext> | SqlConsoleContext): DbAiPaneContext => {
    return normalizeRuntimeDbAiPaneContext(input, connections.value)
  }

  const rotateDbAiPaneSession = (notice = false) => {
    const remainsOpen = dbAiPaneOpen.value
    const previousId = dbAiPaneConversationId.value
    const activeAssistant = activeDbAiPaneAssistant()
    if (previousId) {
      void beginDbAiPaneSessionClose(previousId, activeAssistant).then((closed) => {
        if (!closed) void markDbAiPaneProductSessionOpen(previousId)
      })
    }
    archiveCurrentDbAiPaneSession()
    dbAiPaneConversationGeneration += 1
    dbAiPaneConversationId.value = createDbAiPaneConversationId()
    resetDbAiPaneProjectionCursor()
    dbAiPaneMessages.value = []
    dbAiPaneDraft.value = ''
    dbAiPaneComposerAction.value = null
    dbAiPaneProductBacked = remainsOpen
    if (notice) showNotice(i18nText('database.ai.sessionRotated'))
  }

  const restoreDbAiPaneSession = (conversationId: string) => {
    if (dbAiPaneRestorePromise) {
      showNotice(i18nText('database.ai.sessionRestoreInProgress'))
      return Promise.resolve(false)
    }
    const restoreGeneration = dbAiPaneConversationGeneration
    const operation = (async () => {
      const pendingTargetClose = dbAiPaneSessionClosePromises.get(conversationId)
      if (pendingTargetClose && !(await pendingTargetClose)) return false
      if (restoreGeneration !== dbAiPaneConversationGeneration) return false
      if (conversationId === dbAiPaneConversationId.value) {
        dbAiPaneRestoreIssues.value = await validateDbAiPaneBinding({ ...dbAiPaneContext })
        if (!(await markDbAiPaneProductSessionOpen(conversationId))) return false
        dbAiPaneOpen.value = true
        dbAiPaneProductBacked = true
        if (dbAiPaneRestoreIssues.value.length) showNotice(dbAiPaneRestoreIssues.value[0])
        await persistDbAiPaneState()
        scrollDbAiPaneMessagesToBottom()
        return true
      }
      const resolved = await resolveDbAiPaneSessionSnapshot(conversationId)
      if (!resolved) return false
      const { snapshot: restored, projectionMissing, projectionPage } = resolved
      const restoreIssues = await validateDbAiPaneBinding(restored.context)
      if (restoreGeneration !== dbAiPaneConversationGeneration) return false
      const previousId = dbAiPaneConversationId.value
      const previousActiveAssistant = activeDbAiPaneAssistant()
      const previousClose = previousId
        ? beginDbAiPaneSessionClose(previousId, previousActiveAssistant)
        : Promise.resolve(true)
      if (!(await previousClose)) return false
      if (restoreGeneration !== dbAiPaneConversationGeneration) {
        if (previousId) await markDbAiPaneProductSessionOpen(previousId)
        return false
      }
      if (!(await markDbAiPaneProductSessionOpen(restored.conversationId))) {
        if (previousId) await markDbAiPaneProductSessionOpen(previousId)
        return false
      }
      if (restoreGeneration !== dbAiPaneConversationGeneration) {
        await closeDbAiPaneProductSession(restored.conversationId)
        return false
      }
      archiveCurrentDbAiPaneSession()
      dbAiPaneConversationGeneration += 1
      dbAiPaneConversationId.value = restored.conversationId
      dbAiPaneContext.connectionId = restored.context.connectionId
      dbAiPaneContext.catalogName = restored.context.catalogName
      dbAiPaneContext.schemaName = restored.context.schemaName
      dbAiPaneContext.dbType = restored.context.dbType
      dbAiPaneRestoreIssues.value = restoreIssues
      dbAiPaneContextTouched = true
      dbAiPaneDraft.value = restored.draft
      dbAiPaneMessages.value = restored.messages.map(cloneDbAiPaneMessage)
      dbAiPaneSeedStartMessageId = restored.messages[0]?.id || ''
      dbAiPaneProjectionBeforeOrdinal = projectionPage?.nextBeforeOrdinal ?? null
      dbAiPaneProjectionHasMore = projectionPage?.hasMore === true
      dbAiPaneComposerAction.value = null
      dbAiPaneArchivedSessions.value = dbAiPaneArchivedSessions.value.filter(
        (session) => session.conversationId !== restored.conversationId
      )
      dbAiPaneOpen.value = true
      dbAiPaneProductBacked = true
      await persistDbAiPaneState()
      if (restoreIssues.length) showNotice(restoreIssues[0])
      else if (projectionMissing) showNotice(i18nText('database.ai.restoreProjectionMissing'))
      scrollDbAiPaneMessagesToBottom()
      return true
    })()
    dbAiPaneSessionRestoring.value = true
    let tracked: Promise<boolean>
    tracked = operation.finally(() => {
      if (dbAiPaneRestorePromise === tracked) {
        dbAiPaneRestorePromise = null
        dbAiPaneSessionRestoring.value = false
      }
    })
    dbAiPaneRestorePromise = tracked
    return tracked
  }

  const applyDbAiPaneContext = (input: Partial<DbAiPaneContext> | SqlConsoleContext, touched = true) => {
    if (dbAiPaneSessionRestoring.value) return
    const next = normalizeDbAiPaneContext(input)
    const contextChanged = dbAiPaneContext.connectionId !== next.connectionId ||
      dbAiPaneContext.catalogName !== next.catalogName ||
      (dbAiPaneContext.schemaName || '') !== (next.schemaName || '')
    if (
      contextChanged &&
      dbAiPaneContext.connectionId &&
      !dbAiPaneStateHydrating &&
      (dbAiPaneMessages.value.length > 0 || dbAiPaneProductBacked)
    ) {
      rotateDbAiPaneSession(true)
    }
    if (contextChanged) dbAiPaneRestoreIssues.value = []
    dbAiPaneContext.connectionId = next.connectionId
    dbAiPaneContext.catalogName = next.catalogName
    dbAiPaneContext.schemaName = next.schemaName
    dbAiPaneContext.dbType = next.dbType
    dbAiPaneContextTouched = touched
  }

  const resolveDbAiPaneContextFromWorkspace = () => normalizeDbAiPaneContext(resolveSqlConsoleContext())

  const ensureDbAiPaneContextInitialized = (force = false) => {
    if (!force && dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
      applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
      return
    }
    applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
  }

  const syncDbAiPaneContextAfterActiveTabChange = () => {
    if (dbAiPaneOpen.value && !dbAiPaneContextTouched) applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
  }

  const syncDbAiPaneContextAfterCatalogChange = () => {
    if (dbAiPaneOpen.value || dbAiPaneContext.connectionId) {
      if (dbAiPaneContext.connectionId && findConnection(dbAiPaneContext.connectionId)) {
        applyDbAiPaneContext(dbAiPaneContext, dbAiPaneContextTouched)
      } else {
        ensureDbAiPaneContextInitialized(true)
      }
    }
  }

  const toggleDbAiPane = () => {
    if (dbAiPaneOpen.value) closeDbAiPane()
    else openDbAiPane()
  }

  const openDbAiPane = () => {
    if (!canToggleDbAiPane.value) return
    ensureDbAiPaneContextInitialized(false)
    dbAiPaneOpen.value = true
    dbAiPaneProductBacked = true
    scrollDbAiPaneMessagesToBottom()
  }

  const closeDbAiPane = async () => {
    const conversationId = dbAiPaneConversationId.value
    if (conversationId) {
      if (!(await beginDbAiPaneSessionClose(conversationId, activeDbAiPaneAssistant()))) return false
    }
    if (dbAiPaneMessages.value.length) archiveCurrentDbAiPaneSession()
    dbAiPaneConversationGeneration += 1
    dbAiPaneConversationId.value = createDbAiPaneConversationId()
    dbAiPaneMessages.value = []
    dbAiPaneDraft.value = ''
    dbAiPaneComposerAction.value = null
    dbAiPaneRestoreIssues.value = []
    dbAiPaneOpen.value = false
    dbAiPaneProductBacked = false
    await persistDbAiPaneState()
    return true
  }

  const useActiveDbAiPaneContext = () => {
    applyDbAiPaneContext(resolveDbAiPaneContextFromWorkspace(), false)
    showNotice(i18nText('database.ai.notice.contextSynced'))
  }

  const syncDbAiPaneContextToActiveSqlTab = () => {
    const tab = activeSqlTab.value
    if (!tab) return
    applyDbAiPaneContext({
      connectionId: tab.connectionId,
      catalogName: tab.catalogName,
      schemaName: tab.schemaName,
      dbType: findConnection(tab.connectionId)?.dbType ?? ''
    }, false)
  }

  const syncDbAiPaneContextForAction = (context: DbAiBackendContext) => {
    const connectionId = String(context.connectionId || '').trim()
    if (!connectionId || !findConnection(connectionId)) return
    applyDbAiPaneContext({
      connectionId,
      catalogName: String(context.databaseName || ''),
      schemaName: String(context.schemaName || ''),
      dbType: context.dbType || findConnection(connectionId)?.dbType || ''
    }, false)
  }

  const updateDbAiPaneConnection = (event: Event) => {
    const connectionId = (event.target as HTMLSelectElement).value
    const connection = findConnection(connectionId)
    if (!connection) return
    applyDbAiPaneContext(defaultSqlContextForConnection(connection), true)
  }

  const updateDbAiPaneCatalog = (event: Event) => {
    const catalogName = (event.target as HTMLSelectElement).value
    applyDbAiPaneContext({ ...dbAiPaneContext, catalogName, schemaName: '' }, true)
  }

  const updateDbAiPaneSchema = (event: Event) => {
    applyDbAiPaneContext({ ...dbAiPaneContext, schemaName: (event.target as HTMLSelectElement).value }, true)
  }

  const connectDbAiPaneConnection = async () => {
    const connection = dbAiPaneConnection.value
    if (!connection) return
    const connected = await connectConnection(connection.id)
    if (!connected) return
    expandedConnections.value = Array.from(new Set([...expandedConnections.value, connection.id]))
    showNotice(i18nText('database.ai.notice.contextConnectionOpened'))
  }

  const handleDbAiPaneDraftKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    event.preventDefault()
    sendDbAiPaneMessage()
  }

  const prepareDbAiPaneAction = (action: DbAiAction) => {
    openDbAiPane()
    dbAiPaneComposerAction.value = action
    void nextTick(() => databaseAiPanelsRef.value?.focusPaneComposer?.())
  }

  const cancelDbAiPaneActionMode = () => {
    dbAiPaneComposerAction.value = null
  }

  const sendDbAiPaneQuickPrompt = (kind: DbAiPaneQuickPrompt) => {
    if (dbAiPaneIsStreaming.value || dbAiPaneRequestStarting.value) return
    const responseLanguage = getResponseLanguage()
    if (kind === 'explainActive') {
      const tab = activeSqlTab.value
      if (!tab) return
      const sql = getSelectedSqlText().trim() || currentSqlStatement(tab.sql, getSqlCursorOffset()).trim() || tab.sql.trim()
      if (!sql) {
        showNotice(i18nText('database.ai.notice.sqlEmpty'))
        return
      }
      syncDbAiPaneContextToActiveSqlTab()
      openDbAiPane()
      sendDbAiPaneMessage(dbAiQuickPromptText(kind, sql, responseLanguage), { action: 'explain', sourceSql: sql })
      return
    }
    openDbAiPane()
    const prompt = dbAiQuickPromptText(kind, '', responseLanguage)
    sendDbAiPaneMessage(prompt, kind === 'selectSample' ? { action: 'nl2sql', sourceSql: prompt } : {})
  }

  const sendDbAiPaneMessage = async (
    promptOverride = '',
    options: { action?: DbAiAction; sourceSql?: string } = {}
  ) => {
    const responseLanguage = getResponseLanguage()
    const rawPrompt = (promptOverride || dbAiPaneDraft.value).trim()
    const action = options.action ?? (promptOverride ? undefined : dbAiPaneComposerAction.value ?? undefined)
    const prompt = action === 'nl2sql' && !promptOverride
      ? databaseAiNl2SqlPrompt(rawPrompt, responseLanguage)
      : rawPrompt
    if (!prompt || dbAiPaneIsStreaming.value || dbAiPaneRequestStarting.value) return
    dbAiPaneRequestStarting.value = true
    try {
      ensureDbAiPaneContextInitialized(false)
      if (!dbAiPaneContext.connectionId || !dbAiPaneContext.catalogName) {
        showNotice(i18nText('database.ai.notice.contextRequired'))
        return
      }
      if (dbAiPaneConnectionNeedsConnect.value) {
        await connectDbAiPaneConnection()
        if (dbAiPaneConnectionNeedsConnect.value) return
      }
      // Context/open-state watchers can otherwise overwrite lifecycle messages created by the next IPC call.
      await nextTick()
      await persistDbAiPaneState()
      dbAiPaneStateSaveSuspended = true
      try {
        const contextSummary = dbAiPaneContextSummary.value
        const contextSnapshot = { ...dbAiPaneContext }
        const activeTabSnapshot = activeSqlTab.value
        const activeSqlSnapshot = activeTabSnapshot && sqlTabMatchesDbAiPaneContext(activeTabSnapshot, contextSnapshot)
          ? activeTabSnapshot.sql
          : ''
        const activeTableNameSnapshot = activeTabSnapshot && sqlTabMatchesDbAiPaneContext(activeTabSnapshot, contextSnapshot)
          ? activeTabSnapshot.tableName || ''
          : ''
        const messageSnapshot = dbAiPaneMessagesForAgentContext()
          .filter((message) => message.responseLanguage === responseLanguage)
          .filter((message) => dbAiPaneMessageMatchesContext(message, contextSnapshot, contextSummary))
          .map((message) => ({
            ...message,
            ...(message.context ? { context: { ...message.context } } : {}),
            ...(message.sqlAction ? { sqlAction: { ...message.sqlAction, context: { ...message.sqlAction.context } } } : {})
          }))
        const conversationIdSnapshot = dbAiPaneConversationId.value
        const requestInput = dbAiPaneRequestInput({
          conversationId: conversationIdSnapshot,
          prompt,
          action,
          responseLanguage,
          context: contextSnapshot,
          contextSummary,
          activeSql: activeSqlSnapshot,
          tableName: activeTableNameSnapshot,
          messages: messageSnapshot
        })
        const createBridge = databaseClient.createDatabaseAiPaneRequest()
        if (!createBridge) {
          showNotice(i18nText('database.ai.notice.paneRequestUnavailable'))
          return
        }
        let created: DatabaseAiPaneRequestResult
        const conversationGeneration = dbAiPaneConversationGeneration
        try {
          created = await createBridge(requestInput)
        } catch (error) {
          showNotice(localizedBackendMessage(
            '',
            bridgeErrorMessage(error, i18nText('database.ai.notice.paneRequestFailed')),
            i18nText('database.ai.notice.paneRequestFailed'),
            responseLanguage
          ))
          return
        }
        if (conversationGeneration !== dbAiPaneConversationGeneration) return
        if (!created.ok) {
          showNotice(localizedBackendMessage(
            created.errorCode,
            created.errorMessage,
            i18nText('database.ai.notice.paneRequestFailed'),
            responseLanguage
          ))
          return
        }
        if (!isDbAiPaneRequestData(created.data)) {
          showNotice(i18nText('database.ai.notice.paneRequestMalformed'))
          return
        }
        const targetDialect = normalizeDbAiTargetDialect(contextSnapshot.dbType)
        const sqlAction = action
          ? {
              action,
              label: dbAiActionLabel(action, responseLanguage),
              sourceSql: options.sourceSql ?? (action === 'nl2sql' ? rawPrompt : activeSqlSnapshot),
              generatedSql: '',
              targetDialect,
              transport: 'pane' as const,
              context: {
                connectionId: contextSnapshot.connectionId,
                dbType: contextSnapshot.dbType,
                databaseName: contextSnapshot.catalogName,
                schemaName: contextSnapshot.schemaName || undefined,
                contextSummary
              }
            }
          : undefined
        const userMessage = {
          ...created.data.userMessage,
          context: { ...contextSnapshot },
          ...(sqlAction ? { sqlAction: { ...sqlAction, context: { ...sqlAction.context } } } : {})
        }
        const assistantMessage = {
          ...created.data.assistantMessage,
          context: { ...contextSnapshot },
          ...(sqlAction ? { sqlAction: { ...sqlAction, context: { ...sqlAction.context } } } : {})
        }
        dbAiPaneMessages.value = [...dbAiPaneMessages.value, userMessage, assistantMessage]
        if (!promptOverride) dbAiPaneDraft.value = ''
        dbAiPaneComposerAction.value = null
        void requestDbAiPaneResponse(
          assistantMessage.id,
          prompt,
          contextSnapshot,
          contextSummary,
          created.data.requestId,
          activeSqlSnapshot,
          activeTableNameSnapshot,
          messageSnapshot,
          sqlAction,
          responseLanguage,
          conversationGeneration,
          conversationIdSnapshot
        )
        scrollDbAiPaneMessagesToBottom()
      } finally {
        dbAiPaneStateSaveSuspended = false
        void persistDbAiPaneState()
      }
    } finally {
      dbAiPaneRequestStarting.value = false
    }
  }

  const failDbAiPaneMessage = (messageId: string, errorMessage: string) => {
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) =>
      message.id === messageId && message.status !== 'cancelled'
        ? { ...message, status: 'error', content: errorMessage, updatedAt: Date.now() }
        : message
    )
    showNotice(errorMessage)
    scrollDbAiPaneMessagesToBottom()
  }

  const requestDbAiPaneResponse = async (
    messageId: string,
    prompt: string,
    context: DbAiPaneContext,
    contextSummary: string,
    requestId: string,
    activeSql: string,
    tableName: string,
    messages: DbAiPaneMessage[],
    sqlAction: DbAiPaneMessage['sqlAction'] | undefined,
    responseLanguage: DatabaseAiResponseLanguage,
    conversationGeneration: number,
    conversationId: string
  ) => {
    const startBridge = databaseClient.startDatabaseAiPaneResponse()
    if (!startBridge) {
      failDbAiPaneMessage(messageId, i18nText('database.ai.notice.paneRequestUnavailable'))
      return
    }
    let started: DatabaseAiPaneLifecycleResult
    try {
      started = await startBridge({ requestId, assistantMessageId: messageId })
    } catch (error) {
      failDbAiPaneMessage(messageId, localizedBackendMessage(
        '',
        bridgeErrorMessage(error, i18nText('database.ai.notice.paneRequestStartFailed')),
        i18nText('database.ai.notice.paneRequestStartFailed'),
        responseLanguage
      ))
      return
    }
    if (!started.ok) {
      failDbAiPaneMessage(messageId, localizedBackendMessage(
        started.errorCode,
        started.errorMessage,
        i18nText('database.ai.notice.paneRequestStartFailed'),
        responseLanguage
      ))
      return
    }
    if (!isDbAiPaneLifecycleData(started.data, { requestId, assistantMessageId: messageId })) {
      failDbAiPaneMessage(messageId, i18nText('database.ai.notice.paneLifecycleMalformed'))
      return
    }
    if (conversationGeneration !== dbAiPaneConversationGeneration) {
      void persistDbAiPaneState()
      return
    }
    applyDbAiPaneAssistantMessage(started.data.assistantMessage, sqlAction)
    const generateBridge = databaseClient.generateDatabaseAiPaneResponse()
    if (!generateBridge) {
      failDbAiPaneMessage(messageId, i18nText('database.ai.notice.paneResponseUnavailable'))
      return
    }
    const taskIdentity = databaseClineAgentTaskIdentity(requestId)
    const taskKey = clineAgentTaskIdentityKey(taskIdentity)
    dbAiPaneClineTurns.set(taskKey, {
      messageId,
      requestId,
      conversationId,
      conversationGeneration
    })
    dbAiPaneClineEventLifecycle.replay(taskIdentity)
    try {
      const result = await generateBridge({
        ...dbAiPaneRequestInput({
          conversationId,
          prompt,
          action: sqlAction?.action,
          responseLanguage,
          context,
          contextSummary,
          activeSql,
          tableName,
          messages
        }),
        requestId,
        assistantMessageId: messageId
      })
      if (conversationGeneration !== dbAiPaneConversationGeneration) {
        void persistDbAiPaneState()
        return
      }
      finishDbAiPaneMessage(messageId, result, requestId)
    } catch (error) {
      if (conversationGeneration !== dbAiPaneConversationGeneration) {
        void persistDbAiPaneState()
        return
      }
      failDbAiPaneMessage(messageId, localizedBackendMessage(
        '',
        bridgeErrorMessage(error, i18nText('database.ai.notice.paneResponseFailed')),
        i18nText('database.ai.notice.paneResponseFailed'),
        responseLanguage
      ))
    } finally {
      dbAiPaneClineTurns.delete(taskKey)
      dbAiPaneClineEventLifecycle.forget(taskIdentity)
    }
  }

  const applyDbAiPaneAssistantMessage = (assistantMessage: DbAiPaneMessage, sqlAction?: DbAiPaneMessage['sqlAction']) => {
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== assistantMessage.id) return message
      const action = sqlAction ?? message.sqlAction
      const messageContext = assistantMessage.context ?? message.context
      return {
        ...assistantMessage,
        ...(messageContext ? { context: { ...messageContext } } : {}),
        ...(action ? { sqlAction: { ...action, context: { ...action.context } } } : {})
      }
    })
    scrollDbAiPaneMessagesToBottom()
  }

  const finishDbAiPaneMessage = (messageId: string, result: DatabaseAiPaneResponseResult, requestId: string) => {
    const hasValidResponseData = isDbAiPaneResponseData(result.data, { requestId, assistantMessageId: messageId })
    const responseData = hasValidResponseData ? result.data : null
    const pendingMessage = dbAiPaneMessages.value.find((message) => message.id === messageId)
    const responseLanguage = pendingMessage?.responseLanguage || getResponseLanguage()
    if (result.ok && !hasValidResponseData) {
      failDbAiPaneMessage(messageId, i18nText('database.ai.notice.paneResponseMalformed'))
      return
    }
    if (!result.ok && !hasValidResponseData) {
      failDbAiPaneMessage(messageId, localizedBackendMessage(
        result.errorCode,
        result.errorMessage,
        i18nText('database.ai.notice.paneResponseFailed'),
        responseLanguage
      ))
      return
    }
    dbAiPaneMessages.value = dbAiPaneMessages.value.map((message) => {
      if (message.id !== messageId || message.status === 'cancelled') return message
      if (responseData) {
        const sqlAction = message.sqlAction
        const messageContext = responseData.assistantMessage.context ?? message.context
        const assistantResponseLanguage = responseData.assistantMessage.responseLanguage || message.responseLanguage || responseLanguage
        const assistantMessage = responseData.assistantMessage.status === 'error' && assistantResponseLanguage === 'zh-CN'
          ? {
              ...responseData.assistantMessage,
              content: localizedBackendMessage(
                result.errorCode,
                responseData.assistantMessage.content || result.errorMessage,
                i18nText('database.ai.notice.paneResponseFailed'),
                assistantResponseLanguage
              )
            }
          : responseData.assistantMessage
        return {
          ...assistantMessage,
          ...(messageContext ? { context: { ...messageContext } } : {}),
          ...(sqlAction
            ? {
                sqlAction: {
                  ...sqlAction,
                  generatedSql: sqlAction.action === 'explain' ? '' : extractFencedSql(responseData.assistantMessage.content),
                  context: { ...sqlAction.context }
                }
              }
            : {})
        }
      }
      return message
    })
    scrollDbAiPaneMessagesToBottom()
  }

  const cancelDbAiPaneResponse = async () => {
    const activeAssistant = activeDbAiPaneAssistant()
    if (!activeAssistant) return
    const assistantMessage = await cancelCapturedDbAiPaneResponseWithTimeout(activeAssistant)
    if (!assistantMessage) return
    applyDbAiPaneAssistantMessage(assistantMessage)
    showNotice(i18nText('database.ai.notice.paneResponseStopped'))
  }

  const resetDbAiPaneConversation = () => {
    if (dbAiPaneSessionRestoring.value) {
      showNotice(i18nText('database.ai.sessionRestoreInProgress'))
      return false
    }
    rotateDbAiPaneSession()
    showNotice(i18nText('database.ai.notice.paneConversationReset'))
    return true
  }

  const syncDbAiPaneActionRequest = (request: DbAiRequest) => {
    const userId = `dbai-pane-action-${request.id}-user`
    const assistantId = `dbai-pane-action-${request.id}-assistant`
    const requestAlreadyMirrored = dbAiPaneMessages.value.some((message) => message.id === userId || message.id === assistantId)
    const connectionId = String(request.backendContext.connectionId || '')
    if (!requestAlreadyMirrored && connectionId && findConnection(connectionId)) {
      applyDbAiPaneContext({
        connectionId,
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      }, false)
    } else if (!requestAlreadyMirrored) {
      ensureDbAiPaneContextInitialized(false)
    }
    const contextSummary = request.contextSummary || dbAiPaneContextSummary.value
    const responseLanguage: DatabaseAiResponseLanguage = request.responseLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'
    const sqlAction = {
      action: request.action,
      label: request.label,
      sourceSql: request.sourceSql,
      generatedSql: dbAiSql(request),
      targetDialect: request.targetDialect,
      transport: 'drawer' as const,
      context: {
        ...request.backendContext,
        contextSummary: request.backendContext.contextSummary || contextSummary
      }
    }
    const userMessage: DbAiPaneMessage = {
      id: userId,
      requestId: request.id,
      role: 'user',
      status: 'done',
      content: request.label,
      contextSummary,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      responseLanguage,
      context: {
        connectionId: String(request.backendContext.connectionId || ''),
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      },
      sqlAction: { ...sqlAction, generatedSql: '', context: { ...sqlAction.context } }
    }
    const assistantMessage: DbAiPaneMessage = {
      id: assistantId,
      requestId: request.id,
      role: 'assistant',
      status: request.status,
      content: request.text,
      contextSummary,
      createdAt: request.createdAt + 1,
      updatedAt: request.updatedAt,
      responseLanguage,
      context: {
        connectionId: String(request.backendContext.connectionId || ''),
        catalogName: String(request.backendContext.databaseName || ''),
        schemaName: String(request.backendContext.schemaName || ''),
        dbType: request.backendContext.dbType || ''
      },
      sqlAction: { ...sqlAction, context: { ...sqlAction.context } }
    }
    const next = dbAiPaneMessages.value.filter((message) => message.id !== userId && message.id !== assistantId)
    dbAiPaneMessages.value = [...next, userMessage, assistantMessage]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-24)
    if (!requestAlreadyMirrored) dbAiPaneOpen.value = true
    scrollDbAiPaneMessagesToBottom()
  }

  const scrollDbAiPaneMessagesToBottom = () => {
    void nextTick(() => {
      databaseAiPanelsRef.value?.scrollPaneMessagesToBottom()
    })
  }

  const startDbAiPaneResize = (event: PointerEvent) => {
    event.preventDefault()
    dbAiPaneResizeStartX = event.clientX
    dbAiPaneResizeStartWidth = dbAiPaneWidth.value
    dbAiPaneResizing.value = true
    window.addEventListener('pointermove', handleDbAiPaneResizeMove)
    window.addEventListener('pointerup', stopDbAiPaneResize)
    window.addEventListener('mousemove', handleDbAiPaneResizeMove)
    window.addEventListener('mouseup', stopDbAiPaneResize)
  }

  const handleDbAiPaneResizeMove = (event: PointerEvent | MouseEvent) => {
    if (!dbAiPaneResizing.value) return
    dbAiPaneWidth.value = clampDbAiPaneWidth(dbAiPaneResizeStartWidth + dbAiPaneResizeStartX - event.clientX)
  }

  const stopDbAiPaneResize = () => {
    if (!dbAiPaneResizing.value) return
    dbAiPaneResizing.value = false
    window.removeEventListener('pointermove', handleDbAiPaneResizeMove)
    window.removeEventListener('pointerup', stopDbAiPaneResize)
    window.removeEventListener('mousemove', handleDbAiPaneResizeMove)
    window.removeEventListener('mouseup', stopDbAiPaneResize)
  }

  const resetDbAiPaneWidth = () => {
    dbAiPaneWidth.value = DB_AI_PANE_DEFAULT_WIDTH
  }

  const applyDbAiPaneStateSnapshot = (snapshot: DatabaseAiPaneStateSnapshot) => {
    const next = applyRuntimeDbAiPaneStateSnapshot(snapshot, normalizeDbAiPaneContext)
    const restoredConversationId = next.conversationId || createDbAiPaneConversationId()
    const restoredContext = normalizeDbAiPaneContext(next.context || {})
    const hasRestorableProjection = Boolean(next.messages.length || next.draft.trim())
    const timestamps = next.messages.map((message) => message.createdAt).filter(Number.isFinite)
    const updatedTimestamps = next.messages.map((message) => message.updatedAt).filter(Number.isFinite)
    const archivedCurrent: DatabaseAiPaneSessionSnapshot | null = hasRestorableProjection
      ? {
          conversationId: restoredConversationId,
          context: { ...restoredContext },
          draft: next.draft,
          messages: next.messages.map(cloneDbAiPaneMessage),
          createdAt: timestamps.length ? Math.min(...timestamps) : Date.now(),
          updatedAt: updatedTimestamps.length ? Math.max(...updatedTimestamps) : Date.now()
        }
      : null
    dbAiPaneConversationId.value = createDbAiPaneConversationId()
    // A process restart never reopens a session tab or pane.
    dbAiPaneOpen.value = false
    dbAiPaneProductBacked = false
    dbAiPaneWidth.value = next.width
    if (next.context) applyDbAiPaneContext(restoredContext, true)
    else ensureDbAiPaneContextInitialized(true)
    dbAiPaneDraft.value = ''
    dbAiPaneMessages.value = []
    dbAiPaneArchivedSessions.value = archivedCurrent
      ? [
          archivedCurrent,
          ...next.archivedSessions.filter((session) => session.conversationId !== archivedCurrent.conversationId)
        ].slice(0, DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS)
      : next.archivedSessions
    dbAiPaneRestoreIssues.value = []
    return hasRestorableProjection
  }

  const currentDbAiPaneStateSnapshot = (): DatabaseAiPaneStateSnapshot =>
    currentRuntimeDbAiPaneStateSnapshot({
      conversationId: dbAiPaneConversationId.value,
      open: dbAiPaneOpen.value,
      width: dbAiPaneWidth.value,
      context: dbAiPaneContext,
      draft: dbAiPaneDraft.value,
      messages: dbAiPaneMessages.value,
      archivedSessions: dbAiPaneArchivedSessions.value
    })

  const loadDbAiPaneState = async () => {
    dbAiPaneStateHydrating = true
    let detachedProjection = false
    try {
      const bridge = databaseClient.getDatabaseAiPaneState()
      if (!bridge) {
        ensureDbAiPaneContextInitialized(true)
        showNotice(i18nText('database.ai.notice.paneStateUnavailable'))
        return
      }
      const result = await bridge()
      if (!result.ok || !result.data) {
        ensureDbAiPaneContextInitialized(true)
        showNotice(localizedBackendMessage(
          result.errorCode,
          result.errorMessage,
          i18nText('database.ai.notice.paneStateLoadFailed')
        ))
        return
      }
      if (!isDbAiPaneStateSnapshot(result.data)) {
        ensureDbAiPaneContextInitialized(true)
        showNotice(i18nText('database.ai.notice.paneStateMalformed'))
        return
      }
      detachedProjection = applyDbAiPaneStateSnapshot(result.data)
    } catch {
      ensureDbAiPaneContextInitialized(true)
      showNotice(i18nText('database.ai.notice.paneStateLoadFailed'))
    } finally {
      dbAiPaneStateHydrating = false
    }
    if (detachedProjection) await persistDbAiPaneState()
  }

  const persistDbAiPaneState = () => {
    if (dbAiPaneStateHydrating || dbAiPaneStateSaveSuspended) return Promise.resolve()
    const snapshot = currentDbAiPaneStateSnapshot()
    const saveSnapshot = async () => {
      try {
        const bridge = databaseClient.saveDatabaseAiPaneState()
        if (!bridge) {
          if (!dbAiPaneStateNoticeShown) {
            dbAiPaneStateNoticeShown = true
            showNotice(i18nText('database.ai.notice.paneStateUnavailable'))
          }
          return
        }
        try {
          const result = await bridge(snapshot)
          if (!result.ok && !dbAiPaneStateNoticeShown) {
            dbAiPaneStateNoticeShown = true
            showNotice(localizedBackendMessage(
              result.errorCode,
              result.errorMessage,
              i18nText('database.ai.notice.paneStateSaveFailed')
            ))
            return
          }
          if (result.ok && !isDbAiPaneStateSnapshot(result.data) && !dbAiPaneStateNoticeShown) {
            dbAiPaneStateNoticeShown = true
            showNotice(i18nText('database.ai.notice.paneStateMalformed'))
          }
        } catch {
          if (!dbAiPaneStateNoticeShown) {
            dbAiPaneStateNoticeShown = true
            showNotice(i18nText('database.ai.notice.paneStateSaveFailed'))
          }
        }
      } finally {
        dbAiPaneStateSavePending = Math.max(0, dbAiPaneStateSavePending - 1)
      }
    }
    dbAiPaneStateSavePending += 1
    dbAiPaneStateSaveQueue = dbAiPaneStateSaveQueue.then(saveSnapshot, saveSnapshot)
    return dbAiPaneStateSaveQueue
  }

  const removeDeletedDbAiPaneSession = async (id: string) => {
    const archivedSessionExists = dbAiPaneArchivedSessions.value.some((session) => session.conversationId === id)
    const activeSessionDeleted = dbAiPaneConversationId.value === id
    if (!archivedSessionExists && !activeSessionDeleted) return
    if (activeSessionDeleted) await cancelDbAiPaneResponse()
    if (activeSessionDeleted && dbAiPaneConversationId.value !== id) return
    dbAiPaneStateSaveSuspended = true
    try {
      dbAiPaneArchivedSessions.value = dbAiPaneArchivedSessions.value.filter((session) => session.conversationId !== id)
      if (activeSessionDeleted) {
        dbAiPaneConversationGeneration += 1
        dbAiPaneConversationId.value = createDbAiPaneConversationId()
        resetDbAiPaneProjectionCursor()
        dbAiPaneMessages.value = []
        dbAiPaneDraft.value = ''
        dbAiPaneComposerAction.value = null
        dbAiPaneRestoreIssues.value = []
        dbAiPaneOpen.value = false
        dbAiPaneProductBacked = false
      }
    } finally {
      dbAiPaneStateSaveSuspended = false
    }
    await persistDbAiPaneState()
  }

  const onProductSessionChanged = productSessionClient.onChanged()
  const stopProductSessionChanged = onProductSessionChanged?.((event) => {
    if (event.type === 'deleted') void removeDeletedDbAiPaneSession(event.id)
  })
  onScopeDispose(() => {
    stopProductSessionChanged?.()
    dbAiPaneClineEventLifecycle.dispose()
    dbAiPaneClineTurns.clear()
  })

  watch(
    [
      dbAiPaneOpen,
      dbAiPaneWidth,
      dbAiPaneDraft,
      dbAiPaneConversationId,
      dbAiPaneMessages,
      dbAiPaneArchivedSessions,
      () => [dbAiPaneContext.connectionId, dbAiPaneContext.catalogName, dbAiPaneContext.schemaName, dbAiPaneContext.dbType].join('|')
    ],
    persistDbAiPaneState,
    { deep: true }
  )

  return {
    dbAiPaneOpen,
    dbAiPaneConversationId,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneComposerAction,
    dbAiPaneComposerPlaceholder,
    dbAiPaneMessages,
    dbAiPaneMessagesForAgentContext,
    dbAiPaneArchivedSessions,
    dbAiPaneRestoreIssues,
    canToggleDbAiPane,
    dbAiPaneConnection,
    dbAiPaneCatalogOptions,
    dbAiPaneSchemaOptions,
    dbAiPaneRequiresSchema,
    dbAiPaneConnectionNeedsConnect,
    dbAiPaneContextTitle,
    dbAiPaneContextSummary,
    dbAiPaneIsStreaming,
    dbAiPaneCanSend,
    dbAiPaneStatusLabel,
    syncDbAiPaneContextAfterActiveTabChange,
    syncDbAiPaneContextAfterCatalogChange,
    toggleDbAiPane,
    openDbAiPane,
    closeDbAiPane,
    useActiveDbAiPaneContext,
    syncDbAiPaneContextToActiveSqlTab,
    syncDbAiPaneContextForAction,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    retryDbAiPaneBinding,
    handleDbAiPaneDraftKeydown,
    prepareDbAiPaneAction,
    cancelDbAiPaneActionMode,
    sendDbAiPaneQuickPrompt,
    syncDbAiPaneActionRequest,
    resetDbAiPaneConversation,
    restoreDbAiPaneSession,
    loadOlderDbAiPaneMessages,
    cancelDbAiPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    stopDbAiPaneResize,
    resetDbAiPaneWidth,
    loadDbAiPaneState,
    persistDbAiPaneState
  }
}
