<template>
  <aside
    v-if="dbAiPaneOpen"
    class="db-ai-pane"
  >
    <div
      class="db-ai-pane-resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-valuemin="dbAiPaneMinWidth"
      :aria-valuemax="dbAiPaneMaxWidth"
      :aria-valuenow="dbAiPaneWidth"
      :title="t('database.ai.resizePane')"
      @pointerdown="$emit('startDbAiPaneResize', $event)"
      @dblclick="$emit('resetDbAiPaneWidth')"
    />
    <div class="db-ai-pane-shell">
      <header class="db-ai-pane-header">
        <div class="db-ai-pane-title">
          <BrainCircuit />
          <div>
            <strong>DB AI</strong>
            <span>{{ t('database.ai.workspace') }}</span>
          </div>
        </div>
        <button
          type="button"
          :title="t('database.ai.closePane')"
          @click="$emit('closeDbAiPane')"
        >
          <X />
        </button>
      </header>

      <section class="db-ai-pane-context-card">
        <div class="db-ai-pane-context-head">
          <span>{{ localizeContextSummary(dbAiPaneContextSummary) }}</span>
          <button
            type="button"
            :title="t('database.ai.useActiveContext')"
            @click="$emit('useActiveDbAiPaneContext')"
          >
            <RefreshCw />
            <span>{{ t('database.ai.useActive') }}</span>
          </button>
        </div>
        <div class="db-ai-pane-pickers">
          <label>
            {{ t('database.field.connection') }}
            <select
              class="db-ai-pane-connection"
              :value="dbAiPaneContext.connectionId"
              @change="$emit('updateDbAiPaneConnection', $event)"
            >
              <option
                value=""
                disabled
              >
                {{ t('database.field.connection') }}
              </option>
              <option
                v-for="connection in connections"
                :key="connection.id"
                :value="connection.id"
              >
                {{ connection.name }}{{ connection.status === 'testing' ? ` [${t('database.connection.connecting')}]` : '' }}
              </option>
            </select>
          </label>
          <label>
            {{ localizedCatalogFieldLabel }}
            <select
              class="db-ai-pane-database"
              :value="dbAiPaneContext.catalogName"
              :disabled="dbAiPaneCatalogOptions.length === 0"
              @change="$emit('updateDbAiPaneCatalog', $event)"
            >
              <option
                value=""
                disabled
              >
                {{ localizedCatalogFieldLabel }}
              </option>
              <option
                v-for="catalog in dbAiPaneCatalogOptions"
                :key="catalog.name"
                :value="catalog.name"
              >
                {{ databaseCatalogDisplayName(dbAiPaneConnection, catalog) }}
              </option>
            </select>
          </label>
          <label v-if="dbAiPaneRequiresSchema">
            {{ t('database.field.schema') }}
            <select
              class="db-ai-pane-schema"
              :value="dbAiPaneContext.schemaName"
              :disabled="dbAiPaneSchemaOptions.length === 0"
              @change="$emit('updateDbAiPaneSchema', $event)"
            >
              <option
                value=""
                disabled
              >
                {{ t('database.field.schema') }}
              </option>
              <option
                v-for="schema in dbAiPaneSchemaOptions"
                :key="schema.name"
                :value="schema.name"
              >
                {{ schema.name }}
              </option>
            </select>
          </label>
        </div>
        <div
          v-if="dbAiPaneConnectionNeedsConnect"
          class="db-ai-pane-connect-row"
        >
          <span>{{ t('database.ai.connectionNotConnected', { name: dbAiPaneConnection?.name || '' }) }}</span>
          <button
            type="button"
            @click="$emit('connectDbAiPaneConnection')"
          >
            <Zap />
            <span>{{ t('database.connection.connect') }}</span>
          </button>
        </div>
      </section>

      <section
        ref="dbAiPaneMessageListRef"
        class="db-ai-pane-messages"
      >
        <div
          v-if="dbAiPaneMessages.length === 0"
          class="db-ai-pane-empty"
        >
          <strong>{{ localizeContextSummary(dbAiPaneContextTitle) }}</strong>
          <span>{{ t('database.ai.emptyDescription') }}</span>
        </div>
        <article
          v-for="message in dbAiPaneMessages"
          :key="message.id"
          class="db-ai-pane-message"
          :class="[message.role, message.status]"
          :data-message-id="message.id"
          :data-request-id="message.requestId"
        >
          <header>
            <strong>{{ message.role === 'user' ? dbAiUserLabel(message) : 'DB AI' }}</strong>
            <small>{{ formatDbAiRequestTime(message.createdAt) }}</small>
            <span
              v-if="message.role === 'assistant'"
              class="db-ai-pane-message-status"
            >
              <LoaderCircle
                v-if="message.status === 'queued' || message.status === 'streaming'"
                class="db-ai-pane-message-spinner"
              />
              {{ localizedDbAiPaneStatusLabel(message.status) }}
            </span>
          </header>
          <p
            v-if="message.contextSummary"
            class="db-ai-pane-message-context"
          >
            {{ message.contextSummary }}
          </p>
          <template v-if="message.role === 'user' && message.sqlAction">
            <p
              v-if="message.sqlAction.action === 'nl2sql'"
              class="db-ai-pane-action-prompt"
            >
              {{ message.sqlAction.sourceSql }}
            </p>
            <pre
              v-else-if="message.sqlAction.sourceSql"
              class="db-ai-pane-source-sql"
            >{{ message.sqlAction.sourceSql }}</pre>
          </template>
          <pre v-else-if="message.role === 'user'">{{ message.content }}</pre>
          <div
            v-else-if="dbAiPaneMessageContent(message)"
            class="db-ai-pane-message-content ai-markdown-content"
            v-html="renderMarkdownDocumentHtml(dbAiPaneMessageContent(message))"
          />
          <div
            v-else-if="message.status === 'queued' || message.status === 'streaming'"
            class="db-ai-pane-message-working"
          >
            {{ t('database.ai.workingOn', { action: dbAiMessageActionLabel(message) }) }}
          </div>
          <section
            v-if="message.role === 'assistant' && (dbAiPaneMessageGeneratedSql(message) || (message.sqlAction?.action === 'convert' && (message.status === 'queued' || message.status === 'streaming')))"
            class="db-ai-pane-sql-result"
          >
            <header>
              <span class="db-ai-pane-sql-title">
                <Code2 />
                <strong>SQL</strong>
              </span>
              <select
                v-if="message.sqlAction?.action === 'convert'"
                :value="message.sqlAction.targetDialect"
                :title="t('database.ai.targetDialect')"
                :aria-label="t('database.ai.targetDialect')"
                @change="emit('updateDbAiPaneMessageDialect', message, ($event.target as HTMLSelectElement).value as DbAiTargetDialect)"
              >
                <option
                  v-for="dialect in dbAiDialectOptions"
                  :key="dialect.value"
                  :value="dialect.value"
                >
                  {{ dialect.label }}
                </option>
              </select>
              <span class="db-ai-pane-sql-spacer" />
              <button
                type="button"
                :title="t('database.ai.copySql')"
                :aria-label="t('database.ai.copySql')"
                :disabled="!dbAiPaneMessageGeneratedSql(message)"
                @click="emit('copyDbAiSql', message)"
              >
                <Copy />
              </button>
              <button
                type="button"
                :title="t('database.ai.replaceSelectionOrStatement')"
                :aria-label="t('database.ai.replaceSelectionOrStatement')"
                :disabled="!activeSqlAvailable || !dbAiPaneMessageGeneratedSql(message)"
                @click="emit('replaceDbAiSqlSelection', message)"
              >
                <Replace />
              </button>
              <button
                type="button"
                :title="t('database.ai.insertSql')"
                :aria-label="t('database.ai.insertSql')"
                :disabled="!activeSqlAvailable || !dbAiPaneMessageGeneratedSql(message)"
                @click="emit('insertDbAiSql', message)"
              >
                <TextCursorInput />
              </button>
              <button
                type="button"
                class="db-ai-pane-sql-run"
                :title="canRunDbAiPaneMessageSql(message) ? t('database.ai.runReadOnlySql') : t('database.ai.runReadOnlySqlDisabled')"
                :aria-label="t('database.ai.runReadOnlySql')"
                :disabled="!canRunDbAiPaneMessageSql(message)"
                @click="emit('runDbAiReadonly', message)"
              >
                <Play />
                <span>{{ t('database.common.run') }}</span>
              </button>
            </header>
            <pre v-if="dbAiPaneMessageGeneratedSql(message)"><code>{{ dbAiPaneMessageGeneratedSql(message) }}</code></pre>
            <div
              v-else
              class="db-ai-pane-sql-pending"
            >
              {{ t('database.ai.regeneratingSql', { dialect: dbAiTargetDialectLabel(message) }) }}
            </div>
          </section>
        </article>
      </section>

      <footer class="db-ai-pane-composer">
        <div class="db-ai-pane-quick-actions">
          <button
            type="button"
            :disabled="!activeSqlExplainAvailable"
            @click="$emit('sendDbAiPaneQuickPrompt', 'explainActive')"
          >
            {{ t('database.ai.explainSql') }}
          </button>
          <button
            type="button"
            @click="$emit('sendDbAiPaneQuickPrompt', 'schemaSummary')"
          >
            {{ t('database.ai.schemaSummary') }}
          </button>
          <button
            type="button"
            @click="$emit('sendDbAiPaneQuickPrompt', 'selectSample')"
          >
            {{ t('database.ai.generateSelect') }}
          </button>
        </div>
        <div
          v-if="dbAiPaneComposerAction"
          class="db-ai-pane-composer-mode"
        >
          <FileSearch />
          <span>{{ dbAiActionLabel(dbAiPaneComposerAction) }}</span>
          <button
            type="button"
            :title="t('database.ai.cancelAction')"
            :aria-label="t('database.ai.cancelAction')"
            @click="emit('cancelDbAiPaneActionMode')"
          >
            <X />
          </button>
        </div>
        <textarea
          ref="dbAiPaneComposerRef"
          :value="dbAiPaneDraft"
          rows="3"
          :placeholder="localizedComposerPlaceholder"
          @input="$emit('update:dbAiPaneDraft', ($event.target as HTMLTextAreaElement).value)"
          @keydown="$emit('handleDbAiPaneDraftKeydown', $event)"
        />
        <div class="db-ai-pane-composer-actions">
          <button
            type="button"
            :title="t('database.ai.resetConversation')"
            @click="$emit('resetDbAiPaneConversation')"
          >
            <RefreshCw />
          </button>
          <button
            v-if="dbAiPaneIsStreaming"
            type="button"
            :title="t('database.ai.stopResponse')"
            @click="$emit('cancelDbAiPaneResponse')"
          >
            <X />
            <span>{{ t('database.common.stop') }}</span>
          </button>
          <button
            type="button"
            class="primary"
            :disabled="!dbAiPaneCanSend"
            @click="$emit('sendDbAiPaneMessage')"
          >
            <Play />
            <span>{{ t('database.common.send') }}</span>
          </button>
        </div>
      </footer>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { BrainCircuit, Code2, Copy, FileSearch, LoaderCircle, Play, RefreshCw, Replace, TextCursorInput, X, Zap } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'
import type {
  DbAiPaneContext,
  DbAiPaneMessage,
  DbAiPaneMessageStatus,
  DbAiAction,
  DbAiTargetDialect
} from '@/services/database/databaseBackendGuards'
import { dbAiPaneMessageContent, dbAiPaneMessageGeneratedSql } from '@/services/database/databaseAiRuntime'
import { renderMarkdownDocumentHtml } from '@/services/common/markdownRuntime'
import type { DbAiPaneQuickPrompt } from '@/services/database/databaseWorkspaceTypes'
import {
  databaseCatalogDisplayName,
  databaseCatalogFieldLabel
} from '@/services/database/databaseWorkspaceRuntime'

const props = defineProps<{
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
  dbAiPaneDraft: string
  dbAiPaneComposerAction: DbAiAction | null
  dbAiPaneComposerPlaceholder: string
  dbAiPaneIsStreaming: boolean
  dbAiPaneCanSend: boolean
  activeSqlAvailable: boolean
  activeSqlExplainAvailable: boolean
  dbAiDialectOptions: Array<{ value: DbAiTargetDialect; label: string }>
  formatDbAiRequestTime: (time: number) => string
  dbAiPaneStatusLabel: (status: DbAiPaneMessageStatus) => string
  canRunDbAiPaneMessageSql: (message: DbAiPaneMessage) => boolean
}>()

const emit = defineEmits<{
  startDbAiPaneResize: [event: PointerEvent]
  resetDbAiPaneWidth: []
  closeDbAiPane: []
  useActiveDbAiPaneContext: []
  updateDbAiPaneConnection: [event: Event]
  updateDbAiPaneCatalog: [event: Event]
  updateDbAiPaneSchema: [event: Event]
  connectDbAiPaneConnection: []
  'update:dbAiPaneDraft': [value: string]
  handleDbAiPaneDraftKeydown: [event: KeyboardEvent]
  cancelDbAiPaneActionMode: []
  sendDbAiPaneQuickPrompt: [kind: DbAiPaneQuickPrompt]
  resetDbAiPaneConversation: []
  cancelDbAiPaneResponse: []
  sendDbAiPaneMessage: []
  updateDbAiPaneMessageDialect: [message: DbAiPaneMessage, value: DbAiTargetDialect]
  copyDbAiSql: [message?: DbAiPaneMessage]
  replaceDbAiSqlSelection: [message?: DbAiPaneMessage]
  insertDbAiSql: [message?: DbAiPaneMessage]
  runDbAiReadonly: [message?: DbAiPaneMessage]
}>()

const { t } = useI18n()
const localizedCatalogFieldLabel = computed(() => {
  const label = databaseCatalogFieldLabel(props.dbAiPaneConnection)
  if (label === 'Catalog') return t('database.field.catalog')
  if (label === 'Service') return t('database.field.service')
  return t('database.field.database')
})
const localizedComposerPlaceholder = computed(() =>
  props.dbAiPaneComposerAction === 'nl2sql' ? t('database.ai.describeQuery') : t('database.ai.askPlaceholder')
)

const dbAiPaneMessageListRef = ref<HTMLElement | null>(null)
const dbAiPaneComposerRef = ref<HTMLTextAreaElement | null>(null)

function scrollPaneMessagesToBottom() {
  void nextTick(() => {
    const el = dbAiPaneMessageListRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function focusPaneComposer() {
  void nextTick(() => dbAiPaneComposerRef.value?.focus())
}

function dbAiTargetDialectLabel(message: DbAiPaneMessage) {
  const targetDialect = message.sqlAction?.targetDialect
  return props.dbAiDialectOptions.find((dialect) => dialect.value === targetDialect)?.label ?? targetDialect ?? t('database.ai.targetDialectFallback')
}

function localizeContextSummary(value: string) {
  return value === 'No database context selected' ? t('database.ai.noContext') : value
}

function localizedDbAiPaneStatusLabel(status: DbAiPaneMessageStatus) {
  if (status === 'queued') return t('database.ai.status.queued')
  if (status === 'streaming') return t('database.ai.status.streaming')
  if (status === 'cancelled') return t('database.ai.status.cancelled')
  if (status === 'error') return t('database.ai.status.error')
  return t('database.ai.status.done')
}

function dbAiActionLabel(action: DbAiAction) {
  if (action === 'nl2sql') return t('database.ai.action.nl2sql')
  if (action === 'explain') return t('database.ai.action.explain')
  if (action === 'optimize') return t('database.ai.action.optimize')
  if (action === 'convert') return t('database.ai.action.convert')
  if (action === 'complete') return t('database.ai.action.complete')
  if (action === 'diagnose') return t('database.ai.action.diagnose')
  if (action === 'drop') return t('database.ai.action.drop')
  return t('database.ai.action.truncate')
}

function dbAiMessageActionLabel(message: DbAiPaneMessage) {
  return message.sqlAction ? dbAiActionLabel(message.sqlAction.action) : t('database.ai.yourRequest')
}

function dbAiUserLabel(message: DbAiPaneMessage) {
  return message.sqlAction ? dbAiActionLabel(message.sqlAction.action) : t('database.ai.you')
}

defineExpose({ scrollPaneMessagesToBottom, focusPaneComposer })
</script>
