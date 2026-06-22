<template>
  <div class="db-sql-toolbar">
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-run"
      title="Run all"
      :disabled="!activeSqlCanRun"
      @click="emit('runSql', 'all')"
    >
      <Play />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-run-current"
      title="Run current statement"
      :disabled="!activeSqlCanRun"
      @click="emit('runSql', 'current')"
    >
      <CornerDownRight />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-explain"
      title="Explain"
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
      :title="activeSqlSaveTitle"
      @click="emit('saveActiveSql', false)"
    >
      <Save />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-save-as"
      :disabled="!activeSqlTab || activeSqlSaving"
      title="Save As"
      @click="emit('saveActiveSql', true)"
    >
      <SaveAll />
    </button>
    <button
      type="button"
      class="db-sql-toolbar-btn db-sql-toolbar-format"
      :disabled="!activeSqlTab.connectionId"
      title="Format"
      @click="emit('formatSql')"
    >
      <AlignLeft />
    </button>
    <span class="db-toolbar-divider" />
    <span class="db-ai-toolbar">
      <button
        type="button"
        title="AI Explain SQL"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'explain')"
      >
        <BrainCircuit />
      </button>
      <button
        type="button"
        title="AI Optimize SQL"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'optimize')"
      >
        <WandSparkles />
      </button>
      <button
        type="button"
        title="AI Convert SQL"
        :disabled="!activeSqlHasText"
        @click="emit('openDbAiFromToolbar', 'convert')"
      >
        <Languages />
      </button>
      <button
        type="button"
        title="AI Complete SQL"
        :disabled="!activeSqlTab"
        @click="emit('openDbAiFromToolbar', 'complete')"
      >
        <TextCursorInput />
      </button>
      <button
        type="button"
        title="AI NL2SQL"
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
        Database
      </option>
      <option
        v-for="catalog in currentSqlCatalogs"
        :key="catalog.name"
        :value="catalog.name"
      >
        {{ catalog.name }}
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
        Schema
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
import type { DbAiToolbarAction, SqlTab } from '@/components/database/databaseMainWorkspaceTypes'
import type { DatabaseCatalogInfo, DatabaseConnectionInfo } from '@shared/contracts/database'

defineProps<{
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
