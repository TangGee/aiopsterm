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
        <h2>Create Database</h2>
        <button
          type="button"
          title="Close"
          @click="$emit('closeCreateDatabase')"
        >
          <X />
        </button>
      </header>
      <label>
        Name:
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
        Use a valid identifier: start with a letter or underscore, then letters, numbers, or underscores.
      </p>
      <strong>Preview</strong>
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
          Cancel
        </button>
        <button
          type="submit"
          :disabled="!createDatabaseCanSubmit"
        >
          Create
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
          <h2>{{ chartModal.summary?.title || 'Chart' }}</h2>
          <span>{{ chartModal.summary?.scopeLabel }}</span>
        </div>
        <button
          type="button"
          title="Close"
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
          <span><strong>{{ chartModal.summary.rowCount }}</strong> Rows</span>
          <span><strong>{{ chartModal.summary.valueColumn }}</strong> Value</span>
          <span><strong>{{ chartModal.summary.categoryColumn }}</strong> Category</span>
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
          Numeric columns: {{ chartModal.summary.numericColumns.join(', ') }}
        </p>
      </div>
      <p
        v-else
        class="db-chart-empty"
      >
        {{ chartModal.error || 'Current page does not contain a numeric column to chart.' }}
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
          <h2>{{ commentModal.title }}</h2>
          <span>{{ commentModal.scopeLabel }}</span>
        </div>
        <button
          type="button"
          title="Close"
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
        <span>{{ commentModal.updatedAt ? `Saved ${formatCommentTime(commentModal.updatedAt)}` : 'Not saved' }}</span>
        <div>
          <button
            type="button"
            :disabled="commentModal.loading || commentModal.saving"
            @click="$emit('closeComment')"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="commentModal.loading || commentModal.saving"
            @click="$emit('saveComment')"
          >
            {{ commentModal.saving ? 'Saving' : 'Save' }}
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
          title="Close"
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
          Copy
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
        :value="ddlModal.loading ? 'Loading DDL...' : ddlModal.ddl"
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
        <h2>{{ dangerConfirm.action === 'drop' ? 'Drop Table' : 'Truncate Table' }}</h2>
        <button
          type="button"
          title="Close"
          @click="$emit('cancelDanger')"
        >
          <X />
        </button>
      </header>
      <p>
        {{ dangerConfirm.action === 'drop' ? 'This will remove the table in a real database.' : 'This will delete all table rows in a real database.' }}
      </p>
      <code>{{ dangerConfirm.sql }}</code>
      <label>
        Type table name to confirm
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
          Cancel
        </button>
        <button
          class="danger"
          type="button"
          :disabled="dangerConfirm.confirmText !== dangerConfirm.tableName"
          @click="$emit('confirmDanger')"
        >
          Confirm
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
        <h2>{{ operationConfirm.title }}</h2>
        <button
          type="button"
          title="Close"
          @click="$emit('cancelOperation')"
        >
          <X />
        </button>
      </header>
      <p>{{ operationConfirm.message }}</p>
      <code v-if="operationConfirm.detail">{{ operationConfirm.detail }}</code>
      <footer>
        <button
          type="button"
          @click="$emit('cancelOperation')"
        >
          Cancel
        </button>
        <button
          class="danger"
          type="button"
          @click="$emit('confirmOperation')"
        >
          {{ operationConfirm.confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { formatChartNumber, formatCommentTime, type DatabaseChartSummary } from '@/services/databaseWorkspaceRuntime'

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
  title: string
  message: string
  detail: string
  confirmLabel: string
}

defineProps<{
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
