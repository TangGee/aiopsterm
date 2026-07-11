<template>
  <div
    v-if="createDatabaseModal.open"
    class="db-modal-overlay"
  >
    <form
      class="db-create-modal"
      @submit.prevent="$emit('createDatabase')"
    >
      <header>
        <h2>{{ t('database.modal.createDatabase') }}</h2>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('closeCreateDatabase')"
        >
          <X />
        </button>
      </header>
      <label>
        {{ t('database.field.name') }}:
        <input
          :value="createDatabaseModal.name"
          :class="{ error: createDatabaseNameError }"
          required
          @input="$emit('updateCreateDatabaseName', $event)"
        />
      </label>
      <p
        v-if="createDatabaseNameError"
        class="db-modal-feedback error"
      >
        {{ t('database.modal.invalidDatabaseName') }}
      </p>
      <strong>{{ t('database.modal.preview') }}</strong>
      <textarea
        :value="createDatabaseSql"
        spellcheck="false"
        @input="$emit('update:createDatabaseSql', ($event.target as HTMLTextAreaElement).value)"
      />
      <p
        v-if="createDatabaseModal.feedback"
        class="db-modal-feedback"
        :class="{ error: createDatabaseModal.feedbackKind === 'error' }"
      >
        {{ createDatabaseModal.feedback }}
      </p>
      <footer>
        <button
          type="button"
          @click="$emit('closeCreateDatabase')"
        >
          {{ t('database.common.cancel') }}
        </button>
        <button
          type="submit"
          :disabled="!createDatabaseCanSubmit"
        >
          {{ t('database.common.create') }}
        </button>
      </footer>
    </form>
  </div>

  <div
    v-if="chartModal.open"
    class="db-modal-overlay"
  >
    <section class="db-chart-modal">
      <header>
        <div>
          <h2>{{ chartModal.summary ? localizePageLabel(chartModal.summary.title) : t('database.modal.chart') }}</h2>
          <span>{{ chartModal.summary ? localizePageLabel(chartModal.summary.scopeLabel) : '' }}</span>
        </div>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('closeChart')"
        >
          <X />
        </button>
      </header>
      <div
        v-if="chartModal.summary"
        class="db-chart-body"
      >
        <div class="db-chart-metrics">
          <span><strong>{{ chartModal.summary.rowCount }}</strong> {{ t('database.modal.rows') }}</span>
          <span><strong>{{ chartModal.summary.valueColumn }}</strong> {{ t('database.modal.value') }}</span>
          <span><strong>{{ chartModal.summary.categoryColumn }}</strong> {{ t('database.modal.category') }}</span>
        </div>
        <div class="db-chart-bars">
          <div
            v-for="bar in chartModal.summary.bars"
            :key="bar.label"
            class="db-chart-bar-row"
          >
            <span :title="bar.label">{{ bar.label }}</span>
            <div class="db-chart-track">
              <i :style="{ width: `${bar.width}%` }" />
            </div>
            <strong>{{ formatChartNumber(bar.value) }}</strong>
          </div>
        </div>
        <p class="db-chart-footnote">
          {{ t('database.modal.numericColumns') }}: {{ chartModal.summary.numericColumns.join(', ') }}
        </p>
      </div>
      <p
        v-else
        class="db-chart-empty"
      >
        {{ localizeChartError(chartModal.error) }}
      </p>
    </section>
  </div>

  <div
    v-if="commentModal.open"
    class="db-modal-overlay"
  >
    <section class="db-comment-modal">
      <header>
        <div>
          <h2>{{ localizePageLabel(commentModal.title) }}</h2>
          <span>{{ localizePageLabel(commentModal.scopeLabel) }}</span>
        </div>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('closeComment')"
        >
          <X />
        </button>
      </header>
      <p
        v-if="commentModal.error"
        class="db-comment-error"
      >
        {{ commentModal.error }}
      </p>
      <textarea
        :value="commentModal.draft"
        :disabled="commentModal.loading || commentModal.saving"
        maxlength="5000"
        spellcheck="false"
        @input="$emit('updateCommentDraft', ($event.target as HTMLTextAreaElement).value)"
      />
      <footer>
        <span>{{ commentModal.updatedAt ? t('database.modal.savedAt', { time: formatCommentTime(commentModal.updatedAt) }) : t('database.modal.notSaved') }}</span>
        <div>
          <button
            type="button"
            :disabled="commentModal.loading || commentModal.saving"
            @click="$emit('closeComment')"
          >
            {{ t('database.common.cancel') }}
          </button>
          <button
            type="button"
            :disabled="commentModal.loading || commentModal.saving"
            @click="$emit('saveComment')"
          >
            {{ commentModal.saving ? t('database.common.saving') : t('database.common.save') }}
          </button>
        </div>
      </footer>
    </section>
  </div>

  <div
    v-if="ddlModal.open"
    class="db-modal-overlay"
  >
    <section class="db-ddl-modal">
      <header>
        <h2>DDL - {{ ddlModal.tableName }}</h2>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('closeDdl')"
        >
          <X />
        </button>
      </header>
      <div class="db-ddl-toolbar">
        <button
          type="button"
          :disabled="!ddlModal.ddl || ddlModal.loading"
          @click="$emit('copyDdl')"
        >
          {{ t('database.common.copy') }}
        </button>
      </div>
      <p
        v-if="ddlModal.error"
        class="db-ddl-error"
      >
        {{ ddlModal.error }}
      </p>
      <textarea
        v-else
        :value="ddlModal.loading ? t('database.modal.loadingDdl') : ddlModal.ddl"
        readonly
        spellcheck="false"
      />
    </section>
  </div>

  <div
    v-if="dangerConfirm.open"
    class="db-modal-overlay"
  >
    <section class="db-danger-confirm">
      <header>
        <h2>{{ dangerConfirm.action === 'drop' ? t('database.modal.dropTable') : t('database.modal.truncateTable') }}</h2>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('cancelDanger')"
        >
          <X />
        </button>
      </header>
      <p>
        {{ dangerConfirm.action === 'drop' ? t('database.modal.dropTableWarning') : t('database.modal.truncateTableWarning') }}
      </p>
      <code>{{ dangerConfirm.sql }}</code>
      <label>
        {{ t('database.modal.typeTableName') }}
        <input
          :value="dangerConfirm.confirmText"
          autocomplete="off"
          @input="$emit('updateDangerConfirmText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <footer>
        <button
          type="button"
          @click="$emit('cancelDanger')"
        >
          {{ t('database.common.cancel') }}
        </button>
        <button
          class="danger"
          type="button"
          :disabled="dangerConfirm.confirmText !== dangerConfirm.tableName"
          @click="$emit('confirmDanger')"
        >
          {{ t('database.common.confirm') }}
        </button>
      </footer>
    </section>
  </div>

  <div
    v-if="operationConfirm.open"
    class="db-modal-overlay"
  >
    <section class="db-operation-confirm">
      <header>
        <h2>{{ operationConfirmTitle }}</h2>
        <button
          type="button"
          :title="t('database.common.close')"
          @click="$emit('cancelOperation')"
        >
          <X />
        </button>
      </header>
      <p>{{ operationConfirmMessage }}</p>
      <code v-if="operationConfirm.detail">{{ operationConfirm.detail }}</code>
      <footer>
        <button
          type="button"
          @click="$emit('cancelOperation')"
        >
          {{ t('database.common.cancel') }}
        </button>
        <button
          class="danger"
          type="button"
          @click="$emit('confirmOperation')"
        >
          {{ operationConfirmConfirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { formatChartNumber, formatCommentTime, type DatabaseChartSummary } from '@/services/database/databaseWorkspaceRuntime'

type CreateDatabaseModalState = {
  open: boolean
  name: string
  feedback: string
  feedbackKind: 'info' | 'error'
}

type ChartModalState = {
  open: boolean
  summary: DatabaseChartSummary | null
  error: string
}

type CommentModalState = {
  open: boolean
  title: string
  scopeLabel: string
  draft: string
  updatedAt: number
  loading: boolean
  saving: boolean
  error: string
}

type DdlModalState = {
  open: boolean
  tableName: string
  ddl: string
  loading: boolean
  error: string
}

type DangerConfirmState = {
  open: boolean
  action: 'drop' | 'truncate'
  tableName: string
  sql: string
  confirmText: string
}

type OperationConfirmState = {
  open: boolean
  action: '' | 'deleteGroup' | 'removeConnection'
  title: string
  message: string
  detail: string
  confirmLabel: string
}

const props = defineProps<{
  createDatabaseModal: CreateDatabaseModalState
  createDatabaseSql: string
  createDatabaseNameError: boolean
  createDatabaseCanSubmit: boolean
  chartModal: ChartModalState
  commentModal: CommentModalState
  ddlModal: DdlModalState
  dangerConfirm: DangerConfirmState
  operationConfirm: OperationConfirmState
}>()

const { t } = useI18n()

const operationConfirmTitle = computed(() => {
  if (props.operationConfirm.action === 'deleteGroup') return t('database.modal.deleteGroup')
  if (props.operationConfirm.action === 'removeConnection') return t('database.modal.removeConnection')
  return props.operationConfirm.title
})

const operationConfirmMessage = computed(() => {
  if (props.operationConfirm.action === 'deleteGroup') {
    return t('database.modal.deleteGroupMessage', { name: props.operationConfirm.detail })
  }
  if (props.operationConfirm.action === 'removeConnection') {
    const count = Number(props.operationConfirm.message.match(/(\d+) related workspace tab/)?.[1] || 0)
    return count > 0
      ? t('database.modal.removeConnectionWithTabsMessage', { name: props.operationConfirm.detail, count })
      : t('database.modal.removeConnectionMessage', { name: props.operationConfirm.detail })
  }
  return props.operationConfirm.message
})

const operationConfirmConfirmLabel = computed(() => {
  if (props.operationConfirm.action === 'deleteGroup') return t('database.common.delete')
  if (props.operationConfirm.action === 'removeConnection') return t('database.common.remove')
  return props.operationConfirm.confirmLabel
})

function localizePageLabel(value: string) {
  return value
    .replace(/SQL page (\d+)/g, (_match, page) => t('database.modal.sqlPage', { page }))
    .replace(/SQL result/g, t('database.modal.sqlResult'))
    .replace(/ - page (\d+)$/g, (_match, page) => ` - ${t('database.modal.pageNumber', { page })}`)
}

function localizeChartError(value: string) {
  return !value || value === 'Current page does not contain a numeric column to chart.'
    ? t('database.modal.noNumericColumn')
    : value
}

defineEmits<{
  createDatabase: []
  closeCreateDatabase: []
  updateCreateDatabaseName: [event: Event]
  'update:createDatabaseSql': [value: string]
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
</script>
