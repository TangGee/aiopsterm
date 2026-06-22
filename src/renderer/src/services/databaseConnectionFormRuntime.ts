import { computed, nextTick, watch, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import { localFilesClient } from '@/services/localFilesClient'
import {
  isDatabaseConnectionSaveDataForRequest,
  isDatabaseConnectionTestData,
  isDatabaseCreateDatabaseDataForRequest
} from '@/services/databaseBackendGuards'
import {
  buildConnectionUrl,
  canCreateDatabaseForConnection,
  DB_IDENT_RE,
  isCreateDatabaseSupportedDbType,
  parseCreateDatabaseName,
  renderCreateDatabaseTemplate
} from '@/services/databaseWorkspaceRuntime'
import type {
  DatabaseConnectionDraft,
  DatabaseCreateDatabaseModalState
} from '@/services/databaseWorkspaceTypes'
import type {
  DatabaseConnectionInfo,
  DatabaseConnectionSaveInput,
  DatabaseConnectionSaveResult,
  DatabaseConnectionTestInput,
  DatabaseConnectionTestResult,
  DatabaseCreateDatabaseResult,
  DatabaseEngineCode,
  DatabaseEngineInfo,
  DatabaseWorkspaceCatalog
} from '@shared/contracts/database'

const DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE = 'Database connection test backend returned malformed result data.'
const DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE = 'Database connection save backend returned malformed result data.'
const DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE = 'Create database backend returned malformed result data.'

type DatabaseConnectionFormState = {
  databaseEngines: Ref<DatabaseEngineInfo[]>
  connectionModalOpen: Ref<boolean>
  connectionModalMode: Ref<'create' | 'edit'>
  connectionFeedback: Ref<string>
  connectionFeedbackKind: Ref<'info' | 'error'>
  connectionErrors: Ref<string[]>
  connectionUrlDirty: Ref<boolean>
  passwordVisible: Ref<boolean>
  connectionTesting: Ref<boolean>
  connectionSaving: Ref<boolean>
  connectionDraft: DatabaseConnectionDraft
  createDatabaseModal: DatabaseCreateDatabaseModalState
  databaseSshProxyOptions: ComputedRef<Array<{ name: string }>>
  databaseSshProxyNames: ComputedRef<Set<string>>
}

type DatabaseConnectionFormDeps = {
  findConnection: (id: string) => DatabaseConnectionInfo | undefined
  applyDatabaseCatalog: (catalog: DatabaseWorkspaceCatalog) => void
  showNotice: (text: string) => void
  closeMenus: () => void
  openSshProxyConfig: () => void
  openAddSshProxyConfig: () => void
  testConnection: (input: DatabaseConnectionTestInput) => Promise<DatabaseConnectionTestResult>
  saveConnection: (input: DatabaseConnectionSaveInput) => Promise<DatabaseConnectionSaveResult>
  createDatabase: (connectionId: string, sql: string, requestedName: string) => Promise<DatabaseCreateDatabaseResult>
}

const defaultPortForDbType = (dbType: DatabaseEngineCode) =>
  dbType === 'postgresql'
    ? 5432
    : dbType === 'kingbase'
      ? 54321
      : dbType === 'oceanbase'
        ? 2881
        : dbType === 'oracle'
          ? 1521
          : dbType === 'sqlserver'
            ? 1433
            : dbType === 'clickhouse'
              ? 8123
              : dbType === 'presto'
                ? 8080
                : dbType === 'sqlite'
                  ? null
                  : 3306

const defaultUserForDbType = (dbType: DatabaseEngineCode) =>
  dbType === 'sqlite' ? '' : dbType === 'sqlserver' ? 'sa' : dbType === 'clickhouse' ? 'default' : dbType === 'presto' ? 'presto' : 'root'

export const createDatabaseConnectionFormRuntime = (
  state: DatabaseConnectionFormState,
  deps: DatabaseConnectionFormDeps
) => {
  const {
    databaseEngines,
    connectionModalOpen,
    connectionModalMode,
    connectionFeedback,
    connectionFeedbackKind,
    connectionErrors,
    connectionUrlDirty,
    passwordVisible,
    connectionTesting,
    connectionSaving,
    connectionDraft,
    createDatabaseModal,
    databaseSshProxyOptions,
    databaseSshProxyNames
  } = state
  const {
    findConnection,
    applyDatabaseCatalog,
    showNotice,
    closeMenus,
    openSshProxyConfig,
    openAddSshProxyConfig,
    testConnection,
    saveConnection,
    createDatabase: createDatabaseThroughBackend
  } = deps

  const databaseProxyAvailable = computed(() => connectionDraft.dbType !== 'sqlite' && databaseSshProxyOptions.value.length > 0)

  const connectionUrl = computed({
    get() {
      if (connectionUrlDirty.value && connectionDraft.url.trim()) return connectionDraft.url
      return buildConnectionUrl(connectionDraft)
    },
    set(value: string) {
      connectionUrlDirty.value = true
      connectionDraft.url = value
    }
  }) as WritableComputedRef<string>

  const createDatabaseSql = computed({
    get() {
      return createDatabaseModal.sql
    },
    set(value: string) {
      if (value !== createDatabaseModal.lastAppliedTemplate) createDatabaseModal.userEditedSql = true
      createDatabaseModal.sql = value
    }
  }) as WritableComputedRef<string>

  const createDatabaseNameError = computed(() => {
    const name = createDatabaseModal.name.trim()
    return createDatabaseModal.open && name.length > 0 && !DB_IDENT_RE.test(name)
  })

  const createDatabaseCanSubmit = computed(() => {
    if (!createDatabaseModal.open || createDatabaseModal.submitting) return false
    return DB_IDENT_RE.test(createDatabaseModal.name.trim()) && createDatabaseModal.sql.trim().length > 0
  })

  function engineName(code: DatabaseEngineCode) {
    return databaseEngines.value.find((engine) => engine.connectionCode === code)?.name ?? code
  }

  function resetConnectionFeedback() {
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
    connectionErrors.value = []
    connectionTesting.value = false
    connectionSaving.value = false
  }

  function clearConnectionFeedback() {
    connectionFeedback.value = ''
    connectionFeedbackKind.value = 'info'
  }

  function markConnectionUrlAuto() {
    if (!connectionUrlDirty.value) connectionDraft.url = ''
    clearConnectionFeedback()
  }

  function openConnectionModal(dbType: DatabaseEngineCode, groupId: string) {
    connectionModalMode.value = 'create'
    Object.assign(connectionDraft, {
      id: '',
      dbType,
      name: `${engineName(dbType).toLowerCase()}-connection`,
      env: 'Development',
      groupId,
      host: '127.0.0.1',
      port: defaultPortForDbType(dbType),
      authentication: 'UserAndPassword',
      user: defaultUserForDbType(dbType),
      password: '',
      database: '',
      filePath: '',
      readonly: dbType === 'sqlite',
      sslMode: '',
      needProxy: false,
      proxyName: '',
      url: ''
    })
    resetConnectionFeedback()
    connectionUrlDirty.value = false
    passwordVisible.value = false
    connectionModalOpen.value = true
    closeMenus()
  }

  function editConnection(connection: DatabaseConnectionInfo) {
    connectionModalMode.value = 'edit'
    Object.assign(connectionDraft, {
      id: connection.id,
      dbType: connection.dbType,
      name: connection.name,
      env: connection.env,
      groupId: connection.groupId,
      host: connection.host,
      port: connection.port,
      authentication: connection.authentication,
      user: connection.user,
      password: '',
      database: connection.database,
      filePath: connection.filePath ?? '',
      readonly: !!connection.readonly,
      sslMode: connection.sslMode ?? '',
      needProxy: !!connection.needProxy,
      proxyName: connection.proxyName ?? '',
      url: connection.url ?? ''
    })
    resetConnectionFeedback()
    connectionUrlDirty.value = !!(connection.url && connection.url !== buildConnectionUrl(connectionDraft))
    passwordVisible.value = false
    connectionModalOpen.value = true
    closeMenus()
  }

  function closeConnectionModal() {
    connectionModalOpen.value = false
    resetConnectionFeedback()
    connectionUrlDirty.value = false
    passwordVisible.value = false
  }

  function openSshProxyConfigFromConnectionModal() {
    openSshProxyConfig()
    openAddSshProxyConfig()
  }

  async function pickSqliteFile() {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'SQLite file picker service is unavailable.'
      return
    }
    let result: Awaited<ReturnType<typeof showOpenDialog>>
    try {
      result = await showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
    } catch {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'SQLite file picker failed.'
      return
    }
    const filePath = result && !result.canceled ? result.filePaths?.[0] : ''
    if (!filePath) return
    connectionDraft.filePath = filePath
    connectionDraft.url = `sqlite://${filePath}`
    connectionUrlDirty.value = true
    clearConnectionFeedback()
  }

  function validateConnectionDraft() {
    const errors: string[] = []
    if (!connectionDraft.name.trim()) errors.push('name')
    if (connectionDraft.dbType === 'sqlite') {
      if (!connectionDraft.filePath.trim()) errors.push('filePath')
    } else {
      const hasOracleConnectString = connectionDraft.dbType === 'oracle' && !!connectionDraft.url.trim()
      const hasHost = !!connectionDraft.host.trim()
      const hasPort = typeof connectionDraft.port === 'number' && Number.isFinite(connectionDraft.port) && connectionDraft.port > 0
      if (connectionDraft.dbType !== 'oracle' || !hasOracleConnectString) {
        if (!hasHost) errors.push('host')
        if (!hasPort) errors.push('port')
      }
      if (!connectionDraft.user.trim()) errors.push('user')
      if (connectionDraft.needProxy && (!connectionDraft.proxyName.trim() || !databaseSshProxyNames.value.has(connectionDraft.proxyName.trim()))) {
        errors.push('proxyName')
      }
    }
    connectionErrors.value = errors
    return errors.length === 0
  }

  function databaseConnectionTestInput(): DatabaseConnectionTestInput {
    return {
      dbType: connectionDraft.dbType,
      name: connectionDraft.name,
      host: connectionDraft.host,
      port: connectionDraft.port,
      user: connectionDraft.user,
      password: connectionDraft.password,
      database: connectionDraft.database,
      filePath: connectionDraft.filePath,
      readonly: connectionDraft.readonly,
      sslMode: connectionDraft.sslMode,
      needProxy: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy,
      proxyName: connectionDraft.dbType !== 'sqlite' && connectionDraft.needProxy ? connectionDraft.proxyName.trim() : '',
      url: connectionDraft.url || connectionUrl.value
    }
  }

  function databaseConnectionResultMessage(result: DatabaseConnectionTestResult) {
    if (!result.ok) return result.errorMessage || 'Database connection test failed.'
    if (!isDatabaseConnectionTestData(result.data)) return DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
    return result.data.serverVersion
  }

  async function testConnectionDraft() {
    if (connectionTesting.value || connectionSaving.value) return
    if (!validateConnectionDraft()) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'Fix required fields before testing.'
      return
    }
    connectionTesting.value = true
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = 'Testing connection through local backend...'
    await nextTick()
    const result = await testConnection(databaseConnectionTestInput())
    connectionTesting.value = false
    if (!result.ok) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = databaseConnectionResultMessage(result)
      return
    }
    if (!isDatabaseConnectionTestData(result.data)) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
      return
    }
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = `Connection successful. (${databaseConnectionResultMessage(result)})`
  }

  function databaseConnectionSaveInput(): DatabaseConnectionSaveInput {
    return {
      mode: connectionModalMode.value,
      id: connectionDraft.id || undefined,
      connection: {
        ...databaseConnectionTestInput(),
        env: connectionDraft.env,
        groupId: connectionDraft.groupId,
        authentication: connectionDraft.authentication
      }
    }
  }

  async function saveConnectionDraft() {
    if (connectionTesting.value || connectionSaving.value) return
    if (!validateConnectionDraft()) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = 'Fix required fields before saving.'
      return
    }
    connectionSaving.value = true
    connectionFeedbackKind.value = 'info'
    connectionFeedback.value = 'Saving connection through local backend...'
    await nextTick()
    const testResult = await testConnection(databaseConnectionTestInput())
    if (!testResult.ok) {
      connectionSaving.value = false
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = databaseConnectionResultMessage(testResult)
      return
    }
    if (!isDatabaseConnectionTestData(testResult.data)) {
      connectionSaving.value = false
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_TEST_MALFORMED_MESSAGE
      return
    }
    const saveInput = databaseConnectionSaveInput()
    const saveResult = await saveConnection(saveInput)
    connectionSaving.value = false
    if (!saveResult.ok) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = saveResult.errorMessage || 'Database connection save failed.'
      return
    }
    if (!isDatabaseConnectionSaveDataForRequest(saveResult.data, saveInput)) {
      connectionFeedbackKind.value = 'error'
      connectionFeedback.value = DATABASE_CONNECTION_SAVE_MALFORMED_MESSAGE
      return
    }
    applyDatabaseCatalog(saveResult.data)
    closeConnectionModal()
    showNotice(saveResult.data.message || 'Connection saved')
    return saveResult.data.connection
  }

  function syncCreateDatabaseTemplate() {
    if (createDatabaseModal.userEditedSql) return
    const next = renderCreateDatabaseTemplate(createDatabaseModal.name, createDatabaseModal.dbType)
    createDatabaseModal.lastAppliedTemplate = next
    createDatabaseModal.sql = next
  }

  function updateCreateDatabaseName(event: Event) {
    createDatabaseModal.name = (event.target as HTMLInputElement).value
    createDatabaseModal.feedback = ''
    syncCreateDatabaseTemplate()
  }

  function openCreateDatabaseModal(connectionId: string) {
    const connection = findConnection(connectionId)
    if (!connection) return
    if (!canCreateDatabaseForConnection(connection)) return
    const dbType = connection.dbType
    if (!isCreateDatabaseSupportedDbType(dbType)) return
    createDatabaseModal.open = true
    createDatabaseModal.connectionId = connectionId
    createDatabaseModal.dbType = dbType
    createDatabaseModal.name = ''
    createDatabaseModal.sql = ''
    createDatabaseModal.userEditedSql = false
    createDatabaseModal.lastAppliedTemplate = ''
    createDatabaseModal.submitting = false
    createDatabaseModal.feedback = ''
    createDatabaseModal.feedbackKind = 'info'
    closeMenus()
  }

  function closeCreateDatabaseModal() {
    createDatabaseModal.open = false
    createDatabaseModal.connectionId = ''
    createDatabaseModal.name = ''
    createDatabaseModal.sql = ''
    createDatabaseModal.userEditedSql = false
    createDatabaseModal.lastAppliedTemplate = ''
    createDatabaseModal.submitting = false
    createDatabaseModal.feedback = ''
    createDatabaseModal.feedbackKind = 'info'
  }

  async function createDatabase() {
    const connection = findConnection(createDatabaseModal.connectionId)
    if (!connection) return
    if (!createDatabaseCanSubmit.value) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = 'Fix the database name and SQL before creating.'
      return
    }
    const name = parseCreateDatabaseName(createDatabaseModal.sql) || createDatabaseModal.name.trim()
    if (connection.catalogs.some((catalog) => catalog.name.toLowerCase() === name.toLowerCase())) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = 'Database already exists.'
      return
    }
    createDatabaseModal.submitting = true
    const result = await createDatabaseThroughBackend(createDatabaseModal.connectionId, createDatabaseModal.sql, name)
    createDatabaseModal.submitting = false
    if (!result.ok) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = result.errorMessage || 'Create database failed.'
      return
    }
    if (!isDatabaseCreateDatabaseDataForRequest(result.data, createDatabaseModal.connectionId, name)) {
      createDatabaseModal.feedbackKind = 'error'
      createDatabaseModal.feedback = DATABASE_CREATE_DATABASE_MALFORMED_MESSAGE
      return
    }
    applyDatabaseCatalog(result.data)
    closeCreateDatabaseModal()
    showNotice(result.data.message || 'Database created in workspace catalog')
    return `${result.data.connection.id}:${result.data.catalog.name}`
  }

  watch(
    [() => connectionDraft.dbType, databaseSshProxyNames],
    () => {
      if (connectionDraft.dbType === 'sqlite') {
        connectionDraft.needProxy = false
        connectionDraft.proxyName = ''
        return
      }
      if (connectionDraft.proxyName && !databaseSshProxyNames.value.has(connectionDraft.proxyName)) {
        connectionDraft.proxyName = ''
      }
    }
  )

  return {
    databaseProxyAvailable,
    connectionUrl,
    createDatabaseSql,
    createDatabaseNameError,
    createDatabaseCanSubmit,
    markConnectionUrlAuto,
    openConnectionModal,
    editConnection,
    closeConnectionModal,
    openSshProxyConfigFromConnectionModal,
    pickSqliteFile,
    validateConnectionDraft,
    databaseConnectionTestInput,
    databaseConnectionSaveInput,
    testConnectionDraft,
    saveConnectionDraft,
    updateCreateDatabaseName,
    openCreateDatabaseModal,
    closeCreateDatabaseModal,
    createDatabase
  }
}
