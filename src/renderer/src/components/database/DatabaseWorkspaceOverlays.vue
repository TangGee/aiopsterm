<template>
  <DatabaseAiPanels
    ref="databaseAiPanelsRef"
    v-model:db-ai-pane-draft="dbAiPaneDraftModel"
    :db-ai-pane-open="dbAiPaneOpen"
    :db-ai-pane-width="dbAiPaneWidth"
    :db-ai-pane-min-width="dbAiPaneMinWidth"
    :db-ai-pane-max-width="dbAiPaneMaxWidth"
    :db-ai-pane-context-summary="dbAiPaneContextSummary"
    :db-ai-pane-context-title="dbAiPaneContextTitle"
    :db-ai-pane-context="dbAiPaneContext"
    :connections="connections"
    :db-ai-pane-connection="dbAiPaneConnection"
    :db-ai-pane-catalog-options="dbAiPaneCatalogOptions"
    :db-ai-pane-schema-options="dbAiPaneSchemaOptions"
    :db-ai-pane-requires-schema="dbAiPaneRequiresSchema"
    :db-ai-pane-connection-needs-connect="dbAiPaneConnectionNeedsConnect"
    :db-ai-pane-messages="dbAiPaneMessages"
    :db-ai-pane-is-streaming="dbAiPaneIsStreaming"
    :db-ai-pane-can-send="dbAiPaneCanSend"
    :active-sql-available="activeSqlAvailable"
    :db-ai-open="dbAiOpen"
    :db-ai-active-req-id="dbAiActiveReqId"
    :db-ai-action-label="dbAiActionLabel"
    :db-ai-request-list="dbAiRequestList"
    :db-ai-status="dbAiStatus"
    :db-ai-status-label="dbAiStatusLabel"
    :db-ai-context-summary="dbAiContextSummary"
    :db-ai-is-convert-action="dbAiIsConvertAction"
    :db-ai-target-dialect="dbAiTargetDialect"
    :db-ai-dialect-options="dbAiDialectOptions"
    :db-ai-is-executable-dialect="dbAiIsExecutableDialect"
    :db-ai-reasoning-text="dbAiReasoningText"
    :db-ai-content-text="dbAiContentText"
    :db-ai-empty-state="dbAiEmptyState"
    :db-ai-sql="dbAiSql"
    :db-ai-can-run-read-only="dbAiCanRunReadOnly"
    :db-ai-can-cancel="dbAiCanCancel"
    :format-db-ai-request-time="formatDbAiRequestTime"
    :db-ai-pane-status-label="dbAiPaneStatusLabel"
    @start-db-ai-pane-resize="emit('startDbAiPaneResize', $event)"
    @reset-db-ai-pane-width="emit('resetDbAiPaneWidth')"
    @close-db-ai-pane="emit('closeDbAiPane')"
    @use-active-db-ai-pane-context="emit('useActiveDbAiPaneContext')"
    @update-db-ai-pane-connection="emit('updateDbAiPaneConnection', $event)"
    @update-db-ai-pane-catalog="emit('updateDbAiPaneCatalog', $event)"
    @update-db-ai-pane-schema="emit('updateDbAiPaneSchema', $event)"
    @connect-db-ai-pane-connection="emit('connectDbAiPaneConnection')"
    @handle-db-ai-pane-draft-keydown="emit('handleDbAiPaneDraftKeydown', $event)"
    @send-db-ai-pane-quick-prompt="emit('sendDbAiPaneQuickPrompt', $event)"
    @reset-db-ai-pane-conversation="emit('resetDbAiPaneConversation')"
    @cancel-db-ai-pane-response="emit('cancelDbAiPaneResponse')"
    @send-db-ai-pane-message="emit('sendDbAiPaneMessage')"
    @close-db-ai-drawer="emit('closeDbAiDrawer')"
    @set-active-db-ai-request="emit('setActiveDbAiRequest', $event)"
    @update-db-ai-target-dialect="emit('updateDbAiTargetDialect', $event)"
    @copy-db-ai-sql="emit('copyDbAiSql')"
    @replace-db-ai-sql-selection="emit('replaceDbAiSqlSelection')"
    @insert-db-ai-sql="emit('insertDbAiSql')"
    @run-db-ai-readonly="emit('runDbAiReadonly')"
    @cancel-db-ai-request="emit('cancelDbAiRequest')"
    @clear-db-ai-request="emit('clearDbAiRequest')"
  />

  <DatabaseWorkspaceMenus
    :add-menu-open="addMenuOpen"
    :add-menu-position="addMenuPosition"
    :context-menu="contextMenu"
    :context-submenu="contextSubmenu"
    :database-engines="databaseEngines"
    :group-root-move-disabled="groupRootMoveDisabled"
    :group-move-targets="groupMoveTargets"
    :context-connection-connected="contextConnectionConnected"
    :context-connection-can-create-database="contextConnectionCanCreateDatabase"
    :connection-root-move-disabled="connectionRootMoveDisabled"
    :connection-move-targets="connectionMoveTargets"
    :default-group-id="defaultGroupId"
    @add-group="emit('addGroup', $event)"
    @open-connection-modal-from-engine="(engine, groupId) => emit('openConnectionModalFromEngine', engine, groupId)"
    @update-context-submenu="emit('update:contextSubmenu', $event)"
    @close-context-submenu-soon="emit('closeContextSubmenuSoon')"
    @start-group-rename="emit('startGroupRename', $event)"
    @copy-context-name="emit('copyContextName')"
    @move-group-to="(groupId, targetId) => emit('moveGroupTo', groupId, targetId)"
    @request-delete-group="emit('requestDeleteGroup', $event)"
    @connect-from-menu="emit('connectFromMenu', $event)"
    @open-sql-console="emit('openSqlConsole', $event)"
    @open-create-database-modal="emit('openCreateDatabaseModal', $event)"
    @edit-connection="emit('editConnection', $event)"
    @move-connection-to-group="(connectionId, groupId) => emit('moveConnectionToGroup', connectionId, groupId)"
    @refresh-connection-from-menu="emit('refreshConnectionFromMenu', $event)"
    @request-remove-connection="emit('requestRemoveConnection', $event)"
    @open-context-table="emit('openContextTable')"
    @open-context-sql="emit('openContextSql')"
    @open-ddl-modal-from-context="emit('openDdlModalFromContext')"
    @copy-select-sql="emit('copySelectSql')"
    @copy-table-ddl-from-context="emit('copyTableDdlFromContext')"
    @request-dangerous-table-action="emit('requestDangerousTableAction', $event)"
  />

  <DatabaseConnectionModal
    v-model:connection-url="connectionUrlModel"
    v-model:password-visible="passwordVisibleModel"
    :open="connectionModalOpen"
    :mode="connectionModalMode"
    :connection-draft="connectionDraft"
    :connection-errors="connectionErrors"
    :groups="groups"
    :connection-feedback="connectionFeedback"
    :connection-feedback-kind="connectionFeedbackKind"
    :connection-testing="connectionTesting"
    :connection-saving="connectionSaving"
    :database-proxy-available="databaseProxyAvailable"
    :database-ssh-proxy-options="databaseSshProxyOptions"
    :postgres-ssl-mode-options="postgresSslModeOptions"
    :engine-accent="engineAccent"
    :engine-name="engineName"
    @close="emit('closeConnectionModal')"
    @save="emit('saveConnectionDraft')"
    @test="emit('testConnectionDraft')"
    @pick-sqlite-file="emit('pickSqliteFile')"
    @mark-connection-url-auto="emit('markConnectionUrlAuto')"
    @open-ssh-proxy-config="emit('openSshProxyConfigFromConnectionModal')"
  />

  <DatabaseWorkspaceModals
    v-model:create-database-sql="createDatabaseSqlModel"
    :create-database-modal="createDatabaseModal"
    :create-database-name-error="createDatabaseNameError"
    :create-database-can-submit="createDatabaseCanSubmit"
    :chart-modal="chartModal"
    :comment-modal="commentModal"
    :ddl-modal="ddlModal"
    :danger-confirm="dangerConfirm"
    :operation-confirm="operationConfirm"
    @create-database="emit('createDatabase')"
    @close-create-database="emit('closeCreateDatabase')"
    @update-create-database-name="emit('updateCreateDatabaseName', $event)"
    @close-chart="emit('closeChart')"
    @close-comment="emit('closeComment')"
    @update-comment-draft="emit('updateCommentDraft', $event)"
    @save-comment="emit('saveComment')"
    @close-ddl="emit('closeDdl')"
    @copy-ddl="emit('copyDdl')"
    @cancel-danger="emit('cancelDanger')"
    @update-danger-confirm-text="emit('updateDangerConfirmText', $event)"
    @confirm-danger="emit('confirmDanger')"
    @cancel-operation="emit('cancelOperation')"
    @confirm-operation="emit('confirmOperation')"
  />

  <div
    v-if="notice"
    class="db-toast"
  >
    {{ notice }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import DatabaseAiPanels from '@/components/database/DatabaseAiPanels.vue'
import DatabaseConnectionModal from '@/components/database/DatabaseConnectionModal.vue'
import DatabaseWorkspaceMenus from '@/components/database/DatabaseWorkspaceMenus.vue'
import DatabaseWorkspaceModals from '@/components/database/DatabaseWorkspaceModals.vue'
import type {
  DbAiPaneContext,
  DbAiPaneMessage,
  DbAiPaneMessageStatus,
  DbAiRequest,
  DbAiStatus,
  DbAiTargetDialect
} from '@/services/database/databaseBackendGuards'
import type {
  ContextMenu,
  ContextSubmenu,
  DatabaseChartModalState,
  DatabaseCommentModalState,
  DatabaseConnectionDraft,
  DatabaseCreateDatabaseModalState,
  DatabaseDangerConfirmState,
  DatabaseDdlModalState,
  DatabaseOperationConfirmState,
  DbAiPaneQuickPrompt
} from '@/services/database/databaseWorkspaceTypes'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo, DatabaseEngineCode, DatabaseEngineInfo, DatabaseGroupInfo } from '@shared/contracts/database'

type MoveTarget = { id: string; name: string }

const props = defineProps<{
  dbAiPaneDraft: string
  dbAiPaneOpen: boolean
  dbAiPaneWidth: number
  dbAiPaneMinWidth: number
  dbAiPaneMaxWidth: number
  dbAiPaneContextSummary: string
  dbAiPaneContextTitle: string
  dbAiPaneContext: DbAiPaneContext
  connections: DatabaseConnectionInfo[]
  dbAiPaneConnection: DatabaseConnectionInfo | null
  dbAiPaneCatalogOptions: DatabaseCatalogInfo[]
  dbAiPaneSchemaOptions: NonNullable<DatabaseCatalogInfo['schemas']>
  dbAiPaneRequiresSchema: boolean
  dbAiPaneConnectionNeedsConnect: boolean
  dbAiPaneMessages: DbAiPaneMessage[]
  dbAiPaneIsStreaming: boolean
  dbAiPaneCanSend: boolean
  activeSqlAvailable: boolean
  dbAiOpen: boolean
  dbAiActiveReqId: string | null
  dbAiActionLabel: string
  dbAiRequestList: DbAiRequest[]
  dbAiStatus: DbAiStatus | 'idle'
  dbAiStatusLabel: string
  dbAiContextSummary: string
  dbAiIsConvertAction: boolean
  dbAiTargetDialect: DbAiTargetDialect
  dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }>
  dbAiIsExecutableDialect: boolean
  dbAiReasoningText: string
  dbAiContentText: string
  dbAiEmptyState: boolean
  dbAiSql: string
  dbAiCanRunReadOnly: boolean
  dbAiCanCancel: boolean
  formatDbAiRequestTime: (time: number) => string
  dbAiPaneStatusLabel: (status: DbAiPaneMessageStatus) => string
  addMenuOpen: boolean
  addMenuPosition: { x: number; y: number }
  contextMenu: ContextMenu | null
  contextSubmenu: ContextSubmenu
  databaseEngines: DatabaseEngineInfo[]
  groupRootMoveDisabled: boolean
  groupMoveTargets: MoveTarget[]
  contextConnectionConnected: boolean
  contextConnectionCanCreateDatabase: boolean
  connectionRootMoveDisabled: boolean
  connectionMoveTargets: MoveTarget[]
  defaultGroupId: string
  connectionUrl: string
  passwordVisible: boolean
  connectionModalOpen: boolean
  connectionModalMode: 'create' | 'edit'
  connectionDraft: DatabaseConnectionDraft
  connectionErrors: string[]
  groups: DatabaseGroupInfo[]
  connectionFeedback: string
  connectionFeedbackKind: 'info' | 'error'
  connectionTesting: boolean
  connectionSaving: boolean
  databaseProxyAvailable: boolean
  databaseSshProxyOptions: SshProxyConfig[]
  postgresSslModeOptions: readonly string[]
  engineAccent: (code: DatabaseEngineCode) => string
  engineName: (code: DatabaseEngineCode) => string
  createDatabaseSql: string
  createDatabaseModal: DatabaseCreateDatabaseModalState
  createDatabaseNameError: boolean
  createDatabaseCanSubmit: boolean
  chartModal: DatabaseChartModalState
  commentModal: DatabaseCommentModalState
  ddlModal: DatabaseDdlModalState
  dangerConfirm: DatabaseDangerConfirmState
  operationConfirm: DatabaseOperationConfirmState
  notice: string
}>()

const emit = defineEmits<{
  'update:dbAiPaneDraft': [value: string]
  'update:contextSubmenu': [value: ContextSubmenu]
  'update:connectionUrl': [value: string]
  'update:passwordVisible': [value: boolean]
  'update:createDatabaseSql': [value: string]
  startDbAiPaneResize: [event: PointerEvent]
  resetDbAiPaneWidth: []
  closeDbAiPane: []
  useActiveDbAiPaneContext: []
  updateDbAiPaneConnection: [event: Event]
  updateDbAiPaneCatalog: [event: Event]
  updateDbAiPaneSchema: [event: Event]
  connectDbAiPaneConnection: []
  handleDbAiPaneDraftKeydown: [event: KeyboardEvent]
  sendDbAiPaneQuickPrompt: [kind: DbAiPaneQuickPrompt]
  resetDbAiPaneConversation: []
  cancelDbAiPaneResponse: []
  sendDbAiPaneMessage: []
  closeDbAiDrawer: []
  setActiveDbAiRequest: [reqId: string]
  updateDbAiTargetDialect: [value: DbAiTargetDialect]
  copyDbAiSql: []
  replaceDbAiSqlSelection: []
  insertDbAiSql: []
  runDbAiReadonly: []
  cancelDbAiRequest: []
  clearDbAiRequest: []
  addGroup: [parentGroupId?: string | null]
  openConnectionModalFromEngine: [engine: DatabaseEngineInfo, groupId?: string]
  closeContextSubmenuSoon: []
  startGroupRename: [groupId: string]
  copyContextName: []
  moveGroupTo: [groupId: string, targetGroupId: string | null]
  requestDeleteGroup: [groupId: string]
  connectFromMenu: [connectionId: string]
  openSqlConsole: [connectionId?: string]
  openCreateDatabaseModal: [connectionId: string]
  editConnection: [connectionId: string]
  moveConnectionToGroup: [connectionId: string, groupId: string]
  refreshConnectionFromMenu: [connectionId: string]
  requestRemoveConnection: [connectionId: string]
  openContextTable: []
  openContextSql: []
  openDdlModalFromContext: []
  copySelectSql: []
  copyTableDdlFromContext: []
  requestDangerousTableAction: [action: 'drop' | 'truncate']
  closeConnectionModal: []
  saveConnectionDraft: []
  testConnectionDraft: []
  pickSqliteFile: []
  markConnectionUrlAuto: []
  openSshProxyConfigFromConnectionModal: []
  createDatabase: []
  closeCreateDatabase: []
  updateCreateDatabaseName: [event: Event]
  closeChart: []
  closeComment: []
  updateCommentDraft: [value: string]
  saveComment: []
  closeDdl: []
  copyDdl: []
  cancelDanger: []
  updateDangerConfirmText: [value: string]
  confirmDanger: []
  cancelOperation: []
  confirmOperation: []
}>()

const databaseAiPanelsRef = ref<{ scrollPaneMessagesToBottom: () => void } | null>(null)

const dbAiPaneDraftModel = computed({
  get: () => props.dbAiPaneDraft,
  set: (value: string) => emit('update:dbAiPaneDraft', value)
})

const connectionUrlModel = computed({
  get: () => props.connectionUrl,
  set: (value: string) => emit('update:connectionUrl', value)
})

const passwordVisibleModel = computed({
  get: () => props.passwordVisible,
  set: (value: boolean) => emit('update:passwordVisible', value)
})

const createDatabaseSqlModel = computed({
  get: () => props.createDatabaseSql,
  set: (value: string) => emit('update:createDatabaseSql', value)
})

function scrollPaneMessagesToBottom() {
  databaseAiPanelsRef.value?.scrollPaneMessagesToBottom()
}

defineExpose({ scrollPaneMessagesToBottom })
</script>
