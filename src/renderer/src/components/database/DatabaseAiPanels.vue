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
      title="Resize DB AI pane"
      @pointerdown="$emit('startDbAiPaneResize', $event)"
      @dblclick="$emit('resetDbAiPaneWidth')"
    />
    <div class="db-ai-pane-shell">
      <header class="db-ai-pane-header">
        <div class="db-ai-pane-title">
          <BrainCircuit />
          <div>
            <strong>DB AI</strong>
            <span>Database workspace</span>
          </div>
        </div>
        <button
          type="button"
          title="Close DB AI Pane"
          @click="$emit('closeDbAiPane')"
        >
          <X />
        </button>
      </header>

      <section class="db-ai-pane-context-card">
        <div class="db-ai-pane-context-head">
          <span>{{ dbAiPaneContextSummary }}</span>
          <button
            type="button"
            title="Use active tab context"
            @click="$emit('useActiveDbAiPaneContext')"
          >
            <RefreshCw />
            <span>Use Active</span>
          </button>
        </div>
        <div class="db-ai-pane-pickers">
          <label>
            Connection
            <select
              class="db-ai-pane-connection"
              :value="dbAiPaneContext.connectionId"
              @change="$emit('updateDbAiPaneConnection', $event)"
            >
              <option
                value=""
                disabled
              >
                Connection
              </option>
              <option
                v-for="connection in connections"
                :key="connection.id"
                :value="connection.id"
              >
                {{ connection.name }}{{ connection.status === 'testing' ? ' [connecting...]' : '' }}
              </option>
            </select>
          </label>
          <label>
            Database
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
                Database
              </option>
              <option
                v-for="catalog in dbAiPaneCatalogOptions"
                :key="catalog.name"
                :value="catalog.name"
              >
                {{ catalog.name }}
              </option>
            </select>
          </label>
          <label v-if="dbAiPaneRequiresSchema">
            Schema
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
                Schema
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
          <span>{{ dbAiPaneConnection?.name }} is not connected.</span>
          <button
            type="button"
            @click="$emit('connectDbAiPaneConnection')"
          >
            <Zap />
            <span>Connect</span>
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
          <strong>{{ dbAiPaneContextTitle }}</strong>
          <span>Ask about schema, SQL, optimization, or generated read-only queries.</span>
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
            <strong>{{ message.role === 'user' ? 'You' : 'DB AI' }}</strong>
            <small>{{ formatDbAiRequestTime(message.createdAt) }}</small>
            <span
              v-if="message.role === 'assistant'"
              class="db-ai-pane-message-status"
            >
              {{ dbAiPaneStatusLabel(message.status) }}
            </span>
          </header>
          <p
            v-if="message.contextSummary"
            class="db-ai-pane-message-context"
          >
            {{ message.contextSummary }}
          </p>
          <pre>{{ message.content }}</pre>
        </article>
      </section>

      <footer class="db-ai-pane-composer">
        <div class="db-ai-pane-quick-actions">
          <button
            type="button"
            :disabled="!activeSqlAvailable"
            @click="$emit('sendDbAiPaneQuickPrompt', 'explainActive')"
          >
            Explain SQL
          </button>
          <button
            type="button"
            @click="$emit('sendDbAiPaneQuickPrompt', 'schemaSummary')"
          >
            Schema Summary
          </button>
          <button
            type="button"
            @click="$emit('sendDbAiPaneQuickPrompt', 'selectSample')"
          >
            Generate SELECT
          </button>
        </div>
        <textarea
          :value="dbAiPaneDraft"
          rows="3"
          placeholder="Ask DB AI"
          @input="$emit('update:dbAiPaneDraft', ($event.target as HTMLTextAreaElement).value)"
          @keydown="$emit('handleDbAiPaneDraftKeydown', $event)"
        />
        <div class="db-ai-pane-composer-actions">
          <button
            type="button"
            title="Reset conversation"
            @click="$emit('resetDbAiPaneConversation')"
          >
            <RefreshCw />
          </button>
          <button
            v-if="dbAiPaneIsStreaming"
            type="button"
            title="Stop response"
            @click="$emit('cancelDbAiPaneResponse')"
          >
            <X />
            <span>Stop</span>
          </button>
          <button
            type="button"
            class="primary"
            :disabled="!dbAiPaneCanSend"
            @click="$emit('sendDbAiPaneMessage')"
          >
            <Play />
            <span>Send</span>
          </button>
        </div>
      </footer>
    </div>
  </aside>

  <aside
    v-if="dbAiOpen"
    class="db-ai-drawer"
    :data-request-id="dbAiActiveReqId || undefined"
  >
    <header>
      <div>
        <strong>DB AI</strong>
        <span>{{ dbAiActionLabel }}</span>
      </div>
      <button
        type="button"
        title="Close"
        @click="$emit('closeDbAiDrawer')"
      >
        <X />
      </button>
    </header>
    <nav
      v-if="dbAiRequestList.length > 1"
      class="db-ai-request-list"
    >
      <button
        v-for="request in dbAiRequestList"
        :key="request.id"
        type="button"
        :data-request-id="request.id"
        :class="{ active: request.id === dbAiActiveReqId }"
        @click="$emit('setActiveDbAiRequest', request.id)"
      >
        <span :class="request.status"></span>
        <strong>{{ request.label }}</strong>
        <small>{{ formatDbAiRequestTime(request.updatedAt) }}</small>
      </button>
    </nav>
    <section>
      <p class="db-ai-status">
        <span :class="dbAiStatus"></span>
        {{ dbAiStatusLabel }}
      </p>
      <div
        v-if="dbAiContextSummary"
        class="db-ai-context"
      >
        {{ dbAiContextSummary }}
      </div>
      <div
        v-if="dbAiIsConvertAction"
        class="db-ai-dialect-row"
      >
        <label>
          Target Dialect
          <select
            :value="dbAiTargetDialect"
            @change="$emit('updateDbAiTargetDialect', ($event.target as HTMLSelectElement).value as DbAiTargetDialect)"
          >
            <option
              v-for="dialect in dbAiDialectOptions"
              :key="dialect.value"
              :value="dialect.value"
            >
              {{ dialect.label }}
            </option>
          </select>
        </label>
        <span
          v-if="!dbAiIsExecutableDialect"
          class="db-ai-hint"
        >
          Text-only conversion: target dialect does not match the active connection.
        </span>
      </div>
      <div
        v-if="dbAiReasoningText"
        class="db-ai-section"
      >
        <header>Reasoning</header>
        <pre>{{ dbAiReasoningText }}</pre>
      </div>
      <div
        v-if="dbAiContentText"
        class="db-ai-section"
      >
        <header>Response</header>
        <pre>{{ dbAiContentText }}</pre>
      </div>
      <div
        v-if="dbAiEmptyState"
        class="db-ai-empty"
      >
        No DB AI response is active.
      </div>
    </section>
    <section
      v-if="dbAiSql"
      class="db-ai-sql-actions"
    >
      <header>
        <span>Generated SQL</span>
        <button
          type="button"
          @click="$emit('copyDbAiSql')"
        >
          Copy
        </button>
        <button
          type="button"
          :disabled="!activeSqlAvailable"
          @click="$emit('replaceDbAiSqlSelection')"
        >
          Replace Selection
        </button>
        <button
          type="button"
          :disabled="!activeSqlAvailable"
          @click="$emit('insertDbAiSql')"
        >
          Insert Into Editor
        </button>
        <button
          type="button"
          :disabled="!dbAiCanRunReadOnly"
          @click="$emit('runDbAiReadonly')"
        >
          Run ReadOnly
        </button>
      </header>
      <pre>{{ dbAiSql }}</pre>
    </section>
    <footer>
      <button
        v-if="dbAiCanCancel"
        type="button"
        @click="$emit('cancelDbAiRequest')"
      >
        Cancel
      </button>
      <button
        type="button"
        @click="$emit('clearDbAiRequest')"
      >
        Clear
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { BrainCircuit, Play, RefreshCw, X, Zap } from 'lucide-vue-next'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'
import type {
  DbAiPaneContext,
  DbAiPaneMessage,
  DbAiPaneMessageStatus,
  DbAiRequest,
  DbAiStatus,
  DbAiTargetDialect
} from '@/services/database/databaseBackendGuards'
import type { DbAiPaneQuickPrompt } from '@/services/database/databaseWorkspaceTypes'

defineProps<{
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
}>()

defineEmits<{
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
}>()

const dbAiPaneMessageListRef = ref<HTMLElement | null>(null)

function scrollPaneMessagesToBottom() {
  void nextTick(() => {
    const el = dbAiPaneMessageListRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

defineExpose({ scrollPaneMessagesToBottom })
</script>
