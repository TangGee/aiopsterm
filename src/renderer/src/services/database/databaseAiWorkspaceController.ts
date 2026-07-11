import type { ComputedRef, Ref } from 'vue'
import { createDatabaseAiDrawerWorkspaceRuntime } from '@/services/database/databaseAiDrawerWorkspaceRuntime'
import { createDatabaseAiPaneWorkspaceRuntime } from '@/services/database/databaseAiPaneWorkspaceRuntime'
import { dbAiDialectOptions, type SqlTab } from '@/services/database/databaseAiRuntime'
import type { SqlConsoleContext } from '@/services/database/databaseWorkspaceTypes'
import type { DatabaseAiResponseLanguage, DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'

type DatabaseAiWorkspaceControllerState = {
  connections: Ref<DatabaseConnectionInfo[]>
  expandedConnections: Ref<string[]>
  activeSqlTab: ComputedRef<SqlTab | null>
  activeSqlCanRun: ComputedRef<boolean>
  currentSqlCatalogs: ComputedRef<DatabaseCatalogInfo[]>
  responseLanguage: ComputedRef<DatabaseAiResponseLanguage>
  databaseAiPanelsRef: Ref<{ scrollPaneMessagesToBottom: () => void; focusPaneComposer?: () => void } | null>
}

type DatabaseAiWorkspaceControllerDeps = {
  showNotice: (message: string) => void
  closeMenus: () => void
  bridgeErrorMessage: (error: unknown, fallback: string) => string
  copyText: (value: string) => Promise<boolean>
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  defaultSqlContextForConnection: (connection: DatabaseConnectionInfo) => SqlConsoleContext
  resolveSqlConsoleContext: (connectionId?: string) => SqlConsoleContext
  connectConnection: (connectionId: string) => Promise<boolean>
  getSelectedSqlText: () => string
  getSqlCursorOffset: () => number
  getSqlSelectionRange: () => { start: number; end: number }
  getSqlTextUntilCursor: () => string
  renderDefaultSql: (connection: DatabaseConnectionInfo | undefined, catalog: DatabaseCatalogInfo | undefined, schemaName?: string) => string
  setEditorSql: (nextSql: string, selectionStart: number, selectionEnd?: number) => void
  appendSqlExecution: (tab: SqlTab, sql: string) => Promise<void>
}

export const createDatabaseAiWorkspaceController = (
  state: DatabaseAiWorkspaceControllerState,
  deps: DatabaseAiWorkspaceControllerDeps
) => {
  const {
    connections,
    expandedConnections,
    activeSqlTab,
    activeSqlCanRun,
    currentSqlCatalogs,
    responseLanguage,
    databaseAiPanelsRef
  } = state
  const {
    showNotice,
    closeMenus,
    bridgeErrorMessage,
    copyText,
    findConnection,
    defaultSqlContextForConnection,
    resolveSqlConsoleContext,
    connectConnection,
    getSelectedSqlText,
    getSqlCursorOffset,
    getSqlSelectionRange,
    getSqlTextUntilCursor,
    renderDefaultSql,
    setEditorSql,
    appendSqlExecution
  } = deps

  const {
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneComposerAction,
    dbAiPaneComposerPlaceholder,
    dbAiPaneMessages,
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
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    prepareDbAiPaneAction,
    cancelDbAiPaneActionMode,
    sendDbAiPaneQuickPrompt,
    syncDbAiPaneActionRequest,
    resetDbAiPaneConversation: resetPaneConversation,
    cancelDbAiPaneResponse: cancelPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    stopDbAiPaneResize,
    resetDbAiPaneWidth,
    loadDbAiPaneState,
    persistDbAiPaneState
  } = createDatabaseAiPaneWorkspaceRuntime(
    { connections, expandedConnections, activeSqlTab, databaseAiPanelsRef },
    {
      showNotice,
      bridgeErrorMessage,
      findConnection,
      defaultSqlContextForConnection,
      resolveSqlConsoleContext,
      connectConnection,
      getResponseLanguage: () => responseLanguage.value,
      getSelectedSqlText,
      getSqlCursorOffset
    }
  )

  const {
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
    dbAiRequestList,
    dbAiTargetDialect,
    dbAiActionLabel,
    dbAiStatus,
    dbAiContextSummary,
    dbAiIsConvertAction,
    dbAiReasoningText,
    dbAiContentText,
    dbAiEmptyState,
    dbAiSql,
    dbAiIsExecutableDialect,
    dbAiCanRunReadOnly,
    dbAiCanCancel,
    dbAiStatusLabel,
    openDbAiFromToolbar: openDbAiDrawerFromToolbar,
    openDbAi: openDbAiDrawer,
    setActiveDbAiRequest,
    copyDbAiSql,
    replaceDbAiSqlSelection,
    insertDbAiSql,
    runDbAiReadonly,
    canRunDbAiPaneMessageSql,
    updateDbAiPaneMessageDialect,
    cancelDbAiRequest: cancelDrawerRequest,
    clearDbAiRequest,
    clearAllDbAiRequests,
    formatDbAiRequestTime,
    clearSqlDiagnoseTimers,
    diagnoseSqlError
  } = createDatabaseAiDrawerWorkspaceRuntime(
    { activeSqlTab, activeSqlCanRun, currentSqlCatalogs },
    {
      showNotice,
      closeMenus,
      bridgeErrorMessage,
      copyText,
      findConnection,
      getSelectedSqlText,
      getSqlCursorOffset,
      getSqlSelectionRange,
      getSqlTextUntilCursor,
      renderDefaultSql,
      setEditorSql,
      appendSqlExecution,
      getResponseLanguage: () => responseLanguage.value,
      syncConversationRequest: syncDbAiPaneActionRequest
    }
  )

  const openDbAiFromToolbar = (action: 'explain' | 'nl2sql' | 'optimize' | 'convert' | 'complete') => {
    syncDbAiPaneContextToActiveSqlTab()
    if (action === 'explain') {
      sendDbAiPaneQuickPrompt('explainActive')
      return
    }
    if (action === 'nl2sql') {
      prepareDbAiPaneAction('nl2sql')
      return
    }
    openDbAiPane()
    openDbAiDrawerFromToolbar(action)
  }

  const openDbAi = (...args: Parameters<typeof openDbAiDrawer>) => {
    openDbAiPane()
    return openDbAiDrawer(...args)
  }

  const cancelDbAiPaneResponse = async () => {
    const activeAssistant = [...dbAiPaneMessages.value]
      .reverse()
      .find((message) => message.role === 'assistant' && (message.status === 'queued' || message.status === 'streaming'))
    if (activeAssistant?.sqlAction?.transport === 'drawer') {
      await cancelDrawerRequest(activeAssistant.requestId)
      return
    }
    await cancelPaneResponse()
  }

  const resetDbAiPaneConversation = async () => {
    await cancelDbAiPaneResponse()
    resetPaneConversation()
    clearAllDbAiRequests()
  }

  return {
    dbAiPaneOpen,
    dbAiPaneWidth,
    dbAiPaneResizing,
    dbAiPaneContext,
    dbAiPaneDraft,
    dbAiPaneComposerAction,
    dbAiPaneComposerPlaceholder,
    dbAiPaneMessages,
    dbAiOpen,
    dbAiActiveReqId,
    sqlDiagnose,
    dbAiDialectOptions,
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
    dbAiRequestList,
    dbAiTargetDialect,
    dbAiActionLabel,
    dbAiStatus,
    dbAiContextSummary,
    dbAiIsConvertAction,
    dbAiReasoningText,
    dbAiContentText,
    dbAiEmptyState,
    dbAiSql,
    dbAiIsExecutableDialect,
    dbAiCanRunReadOnly,
    dbAiCanCancel,
    dbAiStatusLabel,
    dbAiPaneStatusLabel,
    syncDbAiPaneContextAfterActiveTabChange,
    syncDbAiPaneContextAfterCatalogChange,
    toggleDbAiPane,
    closeDbAiPane,
    useActiveDbAiPaneContext,
    updateDbAiPaneConnection,
    updateDbAiPaneCatalog,
    updateDbAiPaneSchema,
    connectDbAiPaneConnection,
    handleDbAiPaneDraftKeydown,
    cancelDbAiPaneActionMode,
    sendDbAiPaneQuickPrompt,
    resetDbAiPaneConversation,
    cancelDbAiPaneResponse,
    sendDbAiPaneMessage,
    startDbAiPaneResize,
    stopDbAiPaneResize,
    resetDbAiPaneWidth,
    loadDbAiPaneState,
    persistDbAiPaneState,
    openDbAiFromToolbar,
    openDbAi,
    setActiveDbAiRequest,
    copyDbAiSql,
    replaceDbAiSqlSelection,
    insertDbAiSql,
    runDbAiReadonly,
    canRunDbAiPaneMessageSql,
    updateDbAiPaneMessageDialect,
    cancelDbAiRequest: cancelDrawerRequest,
    clearDbAiRequest,
    formatDbAiRequestTime,
    clearSqlDiagnoseTimers,
    diagnoseSqlError
  }
}
