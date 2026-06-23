import { computed, reactive, ref, type Ref } from 'vue'
import {
  canCreateDatabaseForConnection,
  collectDescendantGroupIds,
  DEFAULT_GROUP_ID,
  groupPathLabel
} from '@/services/database/databaseWorkspaceRuntime'
import type {
  ContextMenu,
  DatabaseConnectionDraft,
  DatabaseCreateDatabaseModalState,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  DatabaseOperationConfirmState
} from '@/services/database/databaseWorkspaceTypes'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type {
  DatabaseConnectionInfo,
  DatabaseEngineCode,
  DatabaseGroupInfo
} from '@shared/contracts/database'

type DatabaseWorkspaceConnectionStateInput = {
  connections: Ref<DatabaseConnectionInfo[]>
  groups: Ref<DatabaseGroupInfo[]>
  groupParentById: Record<string, string | null>
  contextMenu: Ref<ContextMenu | null>
  sshProxyConfigs: Readonly<Ref<SshProxyConfig[]>>
}

const createConnectionDraft = (): DatabaseConnectionDraft => ({
  id: '',
  dbType: 'mysql' as DatabaseEngineCode,
  name: '',
  env: 'Development',
  groupId: 'group-default',
  host: '127.0.0.1',
  port: 3306,
  authentication: 'UserAndPassword',
  user: 'root',
  password: '',
  database: '',
  filePath: '',
  readonly: false,
  sslMode: '',
  needProxy: false,
  proxyName: '',
  url: ''
})

const createCreateDatabaseModal = (): DatabaseCreateDatabaseModalState => ({
  open: false,
  connectionId: '',
  dbType: 'mysql',
  name: '',
  sql: '',
  userEditedSql: false,
  lastAppliedTemplate: '',
  submitting: false,
  feedback: '',
  feedbackKind: 'info'
})

const createDdlModal = (): DatabaseDdlModalState => ({
  open: false,
  tableName: '',
  ddl: '',
  connectionId: '',
  catalogName: '',
  schemaName: '',
  tableId: '',
  loading: false,
  error: '',
  errorCode: ''
})

const createDangerConfirm = (): DatabaseDangerConfirmState => ({
  open: false,
  action: 'drop',
  connectionId: '',
  catalogName: '',
  schemaName: '',
  tableId: '',
  tableName: '',
  sql: '',
  confirmText: ''
})

const createOperationConfirm = (): DatabaseOperationConfirmState => ({
  open: false,
  action: '',
  targetId: '',
  title: '',
  message: '',
  detail: '',
  confirmLabel: 'Delete'
})

export const createDatabaseWorkspaceConnectionStateRuntime = ({
  connections,
  groups,
  groupParentById,
  contextMenu,
  sshProxyConfigs
}: DatabaseWorkspaceConnectionStateInput) => {
  const connectionModalOpen = ref(false)
  const connectionModalMode = ref<'create' | 'edit'>('create')
  const connectionFeedback = ref('')
  const connectionFeedbackKind = ref<'info' | 'error'>('info')
  const connectionErrors = ref<string[]>([])
  const connectionUrlDirty = ref(false)
  const passwordVisible = ref(false)
  const connectionTesting = ref(false)
  const connectionSaving = ref(false)
  const postgresSslModeOptions = ['disable', 'require', 'verify-ca', 'verify-full'] as const
  const connectionDraft = reactive(createConnectionDraft())
  const createDatabaseModal = reactive(createCreateDatabaseModal())
  const ddlModal = reactive(createDdlModal())
  const dangerConfirm = reactive(createDangerConfirm())
  const operationConfirm = reactive(createOperationConfirm())

  const databaseSshProxyOptions = computed(() =>
    sshProxyConfigs.value.map((config) => ({ ...config })).sort((first, second) => first.name.localeCompare(second.name))
  )
  const databaseSshProxyNames = computed(() => new Set(databaseSshProxyOptions.value.map((config) => config.name)))

  const contextConnection = computed(() => {
    const menu = contextMenu.value
    return menu?.type === 'connection' ? (connections.value.find((connection) => connection.id === menu.connectionId) ?? null) : null
  })
  const contextConnectionConnected = computed(() => contextConnection.value?.status === 'connected')
  const contextConnectionCanCreateDatabase = computed(() => canCreateDatabaseForConnection(contextConnection.value))
  const connectionMoveTargets = computed(() => {
    const connection = contextConnection.value
    if (!connection) return []
    return groups.value
      .filter((group) => group.id !== connection.groupId)
      .filter((group) => group.id !== DEFAULT_GROUP_ID)
      .map((group) => ({ id: group.id, name: groupPathLabel(group.id, groups.value, groupParentById) }))
  })
  const connectionRootMoveDisabled = computed(() => contextConnection.value?.groupId === DEFAULT_GROUP_ID)

  const contextGroup = computed(() => {
    const menu = contextMenu.value
    return menu?.type === 'group' ? (groups.value.find((group) => group.id === menu.groupId) ?? null) : null
  })
  const groupRootMoveDisabled = computed(() => !contextGroup.value || groupParentById[contextGroup.value.id] === null)
  const groupMoveTargets = computed(() => {
    const group = contextGroup.value
    if (!group) return []
    const descendants = collectDescendantGroupIds(group.id, groups.value, groupParentById)
    return groups.value
      .filter((target) => target.id !== DEFAULT_GROUP_ID && target.id !== group.id && !descendants.has(target.id))
      .map((target) => ({ id: target.id, name: groupPathLabel(target.id, groups.value, groupParentById) }))
  })

  return {
    connectionModalOpen,
    connectionModalMode,
    connectionFeedback,
    connectionFeedbackKind,
    connectionErrors,
    connectionUrlDirty,
    passwordVisible,
    connectionTesting,
    connectionSaving,
    postgresSslModeOptions,
    connectionDraft,
    createDatabaseModal,
    ddlModal,
    dangerConfirm,
    operationConfirm,
    databaseSshProxyOptions,
    databaseSshProxyNames,
    contextConnection,
    contextConnectionConnected,
    contextConnectionCanCreateDatabase,
    connectionMoveTargets,
    connectionRootMoveDisabled,
    contextGroup,
    groupRootMoveDisabled,
    groupMoveTargets
  }
}

export type DatabaseWorkspaceConnectionStateRuntime = ReturnType<typeof createDatabaseWorkspaceConnectionStateRuntime>
