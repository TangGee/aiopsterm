<template>
  <div
    v-if="workspace.recentPanelsOpen"
    class="recent-workspace-panels-backdrop"
    data-testid="recent-workspace-panels"
    @mousedown.self="close"
  >
    <section
      ref="dialogElement"
      class="recent-workspace-panels-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('workspace.recentPanels.title')"
      @keydown="handleDialogKeydown"
    >
      <header>
        <h2>{{ t('workspace.recentPanels.title') }}</h2>
        <button type="button" :title="t('common.close')" @click="close">
          <X />
        </button>
      </header>
      <label class="recent-workspace-panels-search">
        <Search aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('workspace.recentPanels.searchPlaceholder')"
        />
      </label>
      <div class="recent-workspace-panels-list" role="listbox">
        <button
          v-for="(panel, index) in filteredPanels"
          :key="panel.id"
          type="button"
          class="recent-workspace-panels-row"
          :class="{ 'is-selected': index === selectedIndex }"
          :aria-selected="index === selectedIndex"
          :data-panel-id="panel.id"
          role="option"
          @mouseenter="selectedIndex = index"
          @click="activate(panel.id, 'pointer')"
        >
          <span class="recent-workspace-panels-icon" aria-hidden="true">
            <FileCode2 v-if="panel.kind === 'project-file' || panel.kind === 'local-file'" />
            <BookOpenText v-else-if="panel.kind === 'knowledge'" />
            <Bot v-else-if="panel.kind === 'managed-ai-session'" />
            <Server v-else-if="panel.sshSession" />
            <Terminal v-else />
          </span>
          <span class="recent-workspace-panels-content">
            <span class="recent-workspace-panels-title">
              <strong>{{ panel.title }}</strong>
              <span v-if="panel.id === workspace.activePanelId">{{ t('workspace.recentPanels.current') }}</span>
            </span>
            <small>{{ panelSecondaryText(panel) }}</small>
          </span>
          <span class="recent-workspace-panels-kind">{{ panelKindLabel(panel) }}</span>
        </button>
        <div v-if="!filteredPanels.length" class="recent-workspace-panels-empty">
          {{ t('workspace.recentPanels.empty') }}
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpenText, Bot, FileCode2, Search, Server, Terminal, X } from 'lucide-vue-next'
import { useI18n } from '@/i18n'
import { useWorkspaceStore, type TerminalPanel } from '@/stores/workspace'
import { matchesWorkspacePanelQuery } from '@/services/workspace/workspacePanelNavigationRuntime'
import { captureUiFocus, restoreUiFocus, type UiFocusCause } from '@/services/app/uiFocusCoordinator'
import { terminalPanelSwitchTelemetry } from '@/services/terminal/terminalPanelSwitchTelemetry'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const query = ref('')
const selectedIndex = ref(-1)
const searchInput = ref<HTMLInputElement | null>(null)
const dialogElement = ref<HTMLElement | null>(null)
let focusSnapshot: ReturnType<typeof captureUiFocus> | null = null

const filteredPanels = computed(() =>
  workspace.recentWorkspacePanels.filter((panel) => matchesWorkspacePanelQuery(panel, query.value))
)

const resetSelection = () => {
  selectedIndex.value = filteredPanels.value.findIndex((panel) => panel.id !== workspace.activePanelId)
  if (selectedIndex.value < 0 && filteredPanels.value.length) selectedIndex.value = 0
}

const focusSearch = () => {
  nextTick(() => {
    searchInput.value?.focus()
    searchInput.value?.select()
  })
}

const close = () => workspace.closeRecentPanels()

const activate = (panelId: string, cause: UiFocusCause) => workspace.activateRecentPanel(panelId, cause)

const moveSelection = (offset: number) => {
  const count = filteredPanels.value.length
  if (!count) return
  selectedIndex.value = (selectedIndex.value + offset + count) % count
  nextTick(() => {
    const selectedRow = dialogElement.value
      ?.querySelector<HTMLElement>('.recent-workspace-panels-row.is-selected')
    selectedRow?.scrollIntoView?.({ block: 'nearest' })
  })
}

const handleDialogKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelection(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelection(-1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    selectedIndex.value = filteredPanels.value.length ? 0 : -1
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    selectedIndex.value = filteredPanels.value.length - 1
    return
  }
  if (event.key === 'Enter') {
    const panel = filteredPanels.value[selectedIndex.value]
    if (!panel) return
    event.preventDefault()
    activate(panel.id, 'keyboard')
  }
}

const panelKindLabel = (panel: TerminalPanel) => {
  if (panel.kind === 'project-file') return t('workspace.recentPanels.projectFile')
  if (panel.kind === 'local-file') return t('workspace.recentPanels.localFile')
  if (panel.kind === 'knowledge') return t('workspace.recentPanels.knowledge')
  if (panel.kind === 'managed-ai-session') return t('workspace.recentPanels.aiSession')
  if (panel.sshSession) return t('workspace.recentPanels.ssh')
  return t('workspace.recentPanels.terminal')
}

const panelSecondaryText = (panel: TerminalPanel) => {
  if (panel.projectFile) {
    return `${panel.projectFile.projectRoot.replace(/[\\/]+$/, '')}/${panel.projectFile.relativePath}`
  }
  if (panel.localFile) return panel.localFile.filePath
  if (panel.knowledge) return panel.knowledge.relPath
  if (panel.managedAiSession) return `${panel.managedAiSession.source} - ${panel.managedAiSession.sessionId}`
  if (panel.sshSession) {
    return `${panel.sshSession.username}@${panel.sshSession.host}:${panel.sshSession.port} - ${panel.cwd}`
  }
  return panel.cwd
}

watch(query, resetSelection)

watch(
  () => workspace.recentWorkspacePanels.map((panel) => panel.id).join('|'),
  resetSelection
)

watch(
  () => workspace.recentPanelsFocusRequest,
  () => {
    if (workspace.recentPanelsOpen) focusSearch()
  }
)

watch(
  () => workspace.recentPanelsOpen,
  (open) => {
    if (open) {
      const pickerSequence = terminalPanelSwitchTelemetry.activePickerSequence()
      focusSnapshot = captureUiFocus()
      query.value = ''
      resetSelection()
      focusSearch()
      nextTick(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            terminalPanelSwitchTelemetry.pickerReady(pickerSequence, {
              panelCount: filteredPanels.value.length,
              searchFocused: document.activeElement === searchInput.value
            })
          })
        })
      })
      return
    }
    if (workspace.recentPanelsCloseReason === 'activate') {
      focusSnapshot = null
      return
    }
    const snapshot = focusSnapshot
    focusSnapshot = null
    nextTick(() => restoreUiFocus(snapshot))
  }
)
</script>
