<template>
  <div class="db-workspace-tabs">
    <div
      class="db-workspace-tab-scroll"
      role="tablist"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :ref="(el) => registerWorkspaceTabRef(tab.id, el)"
        class="db-workspace-tab"
        :class="{ active: activeTabId === tab.id }"
        role="tab"
        tabindex="0"
        :aria-selected="activeTabId === tab.id"
        @click="emit('update:activeTabId', tab.id)"
        @keydown.enter.prevent="emit('update:activeTabId', tab.id)"
        @keydown.space.prevent="emit('update:activeTabId', tab.id)"
      >
        <LayoutDashboard v-if="tab.kind === 'overview'" />
        <Table2 v-else-if="tab.kind === 'data'" />
        <SquareTerminal v-else />
        <span>{{ tab.title }}</span>
        <button
          v-if="tab.kind !== 'overview'"
          class="db-workspace-tab-close"
          type="button"
          title="Close"
          :aria-label="`Close ${tab.title}`"
          @click.stop="emit('closeTab', tab.id)"
        >
          <X />
        </button>
      </div>
    </div>
    <button
      class="db-workspace-add-tab"
      type="button"
      title="New SQL"
      @click="emit('openSqlConsole')"
    >
      <Plus />
    </button>
    <div class="db-tab-overflow">
      <button
        type="button"
        class="db-ai-pane-toggle"
        :class="{ active: dbAiPaneOpen }"
        title="Toggle DB AI Pane"
        :disabled="!canToggleDbAiPane"
        @click="emit('toggleDbAiPane')"
      >
        <BrainCircuit />
      </button>
      <button
        type="button"
        title="Tabs"
        @click.stop="emit('update:overflowOpen', !overflowOpen)"
      >
        <MoreHorizontal />
      </button>
      <div
        v-if="overflowOpen"
        class="db-tab-menu"
        @click.stop
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :title="tab.title"
          @click="selectOverflowTab(tab.id)"
        >
          {{ tab.title }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, type ComponentPublicInstance } from 'vue'
import {
  BrainCircuit,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  SquareTerminal,
  Table2,
  X
} from 'lucide-vue-next'
import type { DatabaseWorkspaceTabsApi } from '@/components/database/databaseMainWorkspaceTypes'
import type { WorkspaceTab } from '@/services/database/databaseWorkspaceTypes'

defineProps<{
  tabs: WorkspaceTab[]
  activeTabId: string
  overflowOpen: boolean
  dbAiPaneOpen: boolean
  canToggleDbAiPane: boolean
}>()

const emit = defineEmits<{
  'update:activeTabId': [value: string]
  'update:overflowOpen': [value: boolean]
  closeTab: [tabId: string]
  openSqlConsole: []
  toggleDbAiPane: []
}>()

const workspaceTabRefs = new Map<string, HTMLElement>()

function registerWorkspaceTabRef(tabId: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLElement) workspaceTabRefs.set(tabId, el)
  else workspaceTabRefs.delete(tabId)
}

function scrollActiveWorkspaceTabIntoView(tabId: string) {
  void nextTick(() => {
    const tabEl = workspaceTabRefs.get(tabId)
    if (typeof tabEl?.scrollIntoView === 'function') {
      tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
}

function selectOverflowTab(tabId: string) {
  emit('update:activeTabId', tabId)
  scrollActiveWorkspaceTabIntoView(tabId)
  emit('update:overflowOpen', false)
}

defineExpose<DatabaseWorkspaceTabsApi>({
  scrollActiveWorkspaceTabIntoView
})
</script>
