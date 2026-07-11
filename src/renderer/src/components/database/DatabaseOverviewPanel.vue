<template>
  <section class="db-overview">
    <div class="db-overview-hero">
      <div class="db-overview-header">
        <span class="db-overview-eyebrow">{{ t('database.overview.title') }}</span>
        <h2>{{ t('database.overview.title') }}</h2>
        <p>{{ t('database.overview.description') }}</p>
      </div>
      <div class="db-overview-tips">
        <button
          type="button"
          @click="emit('toggleAddMenu')"
        >
          <strong>+</strong>
          <span>{{ t('database.overview.createConnection') }}</span>
        </button>
        <button
          type="button"
          @click="emit('focusDatabaseSearch')"
        >
          <strong>/</strong>
          <span>{{ t('database.overview.exploreSchemas') }}</span>
        </button>
        <button
          type="button"
          @click="emit('openSqlConsole')"
        >
          <strong>SQL</strong>
          <span>{{ t('database.overview.queryConsole') }}</span>
        </button>
      </div>
    </div>
    <div class="db-overview-panel">
      <header>
        <div>
          <strong>{{ t('database.overview.newConnection') }}</strong>
          <p>{{ t('database.overview.chooseEngine') }}</p>
        </div>
        <em :title="t('database.overview.engines')">{{ databaseEngines.length }}</em>
      </header>
      <div class="db-engine-grid">
        <button
          v-for="engine in databaseEngines"
          :key="`${engine.name}-${engine.code}`"
          type="button"
          :title="t('database.overview.newEngineConnection', { name: engine.name })"
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
import { useI18n } from '@/i18n'
import type { DatabaseEngineInfo } from '@shared/contracts/database'

const { t } = useI18n()

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
