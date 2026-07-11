<template>
  <div class="db-sql-toolbar">
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-run"
      :title="t('database.sql.toolbar.runAll')"
      :disabled="!activeSqlCanRun"
      @click="emit('runSql', 'all')"
    >
      <Play />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-run-current"
      :title="t('database.sql.toolbar.runCurrent')"
      :disabled="!activeSqlCanRun"
      @click="emit('runSql', 'current')"
    >
      <CornerDownRight />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-explain"
      :title="t('database.sql.toolbar.explain')"
      :disabled="!activeSqlCanRun"
      @click="emit('runSql', 'explain')"
    >
      <Lightbulb />
    </button>
    <span class="db-toolbar-divider" />
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-save"
      :disabled="!activeSqlTab || activeSqlSaving"
      :title="localizedActiveSqlSaveTitle"
      @click="emit('saveActiveSql', false)"
    >
      <Save />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-save-as"
      :disabled="!activeSqlTab || activeSqlSaving"
      :title="t('database.sql.toolbar.saveAs')"
      @click="emit('saveActiveSql', true)"
    >
      <SaveAll />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-format"
      :disabled="!activeSqlTab.connectionId"
      :title="t('database.sql.toolbar.format')"
      @click="emit('formatSql')"
    >
      <AlignLeft />
    </button>
    <span class="db-toolbar-divider" />
    <span class="db-ai-toolbar">
      <button
        type="button"
        :title="t('database.sql.toolbar.aiExplain')"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'explain')"
      >
        <BrainCircuit />
      </button>
      <button
        type="button"
        :title="t('database.sql.toolbar.aiOptimize')"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'optimize')"
      >
        <WandSparkles />
      </button>
      <button
        type="button"
        :title="t('database.sql.toolbar.aiConvert')"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'convert')"
      >
        <Languages />
      </button>
      <button
        type="button"
        :title="t('database.sql.toolbar.aiComplete')"
        :disabled="!activeSqlTab"
        @click="emit('openDbAiFromToolbar', 'complete')"
      >
        <TextCursorInput />
      </button>
      <button
        type="button"
        :title="t('database.sql.toolbar.aiNl2sql')"
        :disabled="!activeSqlTab"
        @click="emit('openDbAiFromToolbar', 'nl2sql')"
      >
        <FileSearch />
      </button>
    </span>
    <span class="db-toolbar-spacer" />
    <select
      class="db-picker db-picker--connection"
      :value="activeSqlTab.connectionId"
      :disabled="connections.length === 0"
      @change="emit('updateSqlTabConnection', $event)"
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
    <select
      class="db-picker db-picker--database"
      :value="activeSqlTab.catalogName"
      :disabled="currentSqlCatalogs.length === 0"
      @change="emit('updateSqlTabCatalog', $event)"
    >
      <option
        value=""
        disabled
      >
        {{ localizedCatalogFieldLabel }}
      </option>
      <option
        v-for="catalog in currentSqlCatalogs"
        :key="catalog.name"
        :value="catalog.name"
      >
        {{ databaseCatalogDisplayName(activeSqlConnection, catalog) }}
      </option>
    </select>
    <select
      v-if="activeSqlRequiresSchema"
      class="db-picker db-picker--schema"
      :value="activeSqlTab.schemaName"
      :disabled="currentSqlSchemas.length === 0"
      @change="emit('updateSqlTabSchema', $event)"
    >
      <option
        value=""
        disabled
      >
        {{ t('database.field.schema') }}
      </option>
      <option
        v-for="schema in currentSqlSchemas"
        :key="schema.name"
        :value="schema.name"
      >
        {{ schema.name }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  AlignLeft,
  BrainCircuit,
  CornerDownRight,
  FileSearch,
  Languages,
  Lightbulb,
  Play,
  Save,
  SaveAll,
  TextCursorInput,
  WandSparkles
} from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import type { DbAiToolbarAction, SqlTab } from '@/components/database/databaseMainWorkspaceTypes'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'
import {
  databaseCatalogDisplayName,
  databaseCatalogFieldLabel
} from '@/services/database/databaseWorkspaceRuntime'

const props = defineProps<{
  activeSqlTab: SqlTab
  activeSqlCanRun: boolean
  activeSqlSaving: boolean
  activeSqlSaveTitle: string
  activeSqlHasText: boolean
  connections: DatabaseConnectionInfo[]
  currentSqlCatalogs: DatabaseCatalogInfo[]
  currentSqlSchemas: NonNullable<DatabaseCatalogInfo['schemas']>
  activeSqlRequiresSchema: boolean
}>()

const activeSqlConnection = computed(() => props.connections.find((connection) => connection.id === props.activeSqlTab.connectionId) ?? null)
const { t } = useI18n()
const localizedActiveSqlSaveTitle = computed(() => {
  if (props.activeSqlSaveTitle === 'Save') return t('database.common.save')
  if (props.activeSqlSaveTitle === 'Saving') return t('database.common.saving')
  return props.activeSqlSaveTitle
})
const localizedCatalogFieldLabel = computed(() => {
  const label = databaseCatalogFieldLabel(activeSqlConnection.value)
  if (label === 'Catalog') return t('database.field.catalog')
  if (label === 'Service') return t('database.field.service')
  return t('database.field.database')
})

const emit = defineEmits<{
  runSql: [mode: 'all' | 'current' | 'explain']
  saveActiveSql: [forceSaveAs: boolean]
  formatSql: []
  openDbAiFromToolbar: [action: DbAiToolbarAction]
  updateSqlTabConnection: [event: Event]
  updateSqlTabCatalog: [event: Event]
  updateSqlTabSchema: [event: Event]
}>()
</script>
