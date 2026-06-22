<template>
  <section class="db-overview">
    <div class="db-overview-hero">
      <div class="db-overview-header">
        <span class="db-overview-eyebrow">Overview</span>
        <h2>Overview</h2>
        <p>Manage connections, browse schema trees, open table data, and run SQL consoles from the Database workspace.</p>
      </div>
      <div class="db-overview-tips">
        <button
          type="button"
          @click="emit('toggleAddMenu')"
        >
          <strong>+</strong>
          <span>Create connection</span>
        </button>
        <button
          type="button"
          @click="emit('focusDatabaseSearch')"
        >
          <strong>/</strong>
          <span>Explore schemas</span>
        </button>
        <button
          type="button"
          @click="emit('openSqlConsole')"
        >
          <strong>SQL</strong>
          <span>Query console</span>
        </button>
      </div>
    </div>
    <div class="db-overview-panel">
      <header>
        <div>
          <strong>New Connection</strong>
          <p>Choose a database engine to start a connection profile.</p>
        </div>
        <em title="Database engines">{{ databaseEngines.length }}</em>
      </header>
      <div class="db-engine-grid">
        <button
          v-for="engine in databaseEngines"
          :key="`${engine.name}-${engine.code}`"
          type="button"
          :title="`New ${engine.name} connection`"
          @click="emit('openOverviewEngine', engine)"
        >
          <span
            class="db-engine-dot"
            :style="{ background: engine.accent }"
          />
          <span class="db-engine-name">{{ engine.name }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { DatabaseEngineInfo } from '@shared/contracts/database'

defineProps<{
  databaseEngines: DatabaseEngineInfo[]
}>()

const emit = defineEmits<{
  toggleAddMenu: []
  focusDatabaseSearch: []
  openSqlConsole: []
  openOverviewEngine: [engine: DatabaseEngineInfo]
}>()
</script>
