<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <h2>{{ t('module.aiSessions') }}</h2>
      </div>
      <div class="ai-sessions-header-actions">
        <button
          class="ai-sessions-icon-button"
          :title="t('aiSessions.refresh')"
          @click="workspace.refreshManagedAiSessions()"
        >
          <RefreshCw />
        </button>
      </div>
    </header>

    <section
      v-if="workspace.managedAiSessions.length"
      class="ai-sessions-mode-nav"
      :aria-label="t('aiSessions.mode.navigation')"
    >
      <button
        v-for="option in modeButtons"
        :key="option.key"
        type="button"
        class="ai-sessions-mode-button"
        :class="[`mode-${option.key}`, { active: option.active }]"
        :aria-label="option.label"
        :aria-pressed="option.active"
        :aria-current="option.active ? 'page' : undefined"
        @mouseenter="showModeTooltip(option, $event)"
        @mouseleave="hideModeTooltip"
        @focus="showModeTooltip(option, $event)"
        @blur="hideModeTooltip"
        @click="selectMode(option.key)"
      >
        <Inbox v-if="option.key === 'pending'" />
        <Activity v-else-if="option.key === 'running'" />
        <Archive v-else />
        <span
          v-if="option.count"
          class="ai-sessions-mode-count"
        >
          {{ option.count }}
        </span>
      </button>
    </section>

    <Teleport to="body">
      <span
        v-if="modeTooltip"
        class="ai-sessions-mode-tooltip"
        :style="{ left: `${modeTooltip.left}px`, top: `${modeTooltip.top}px` }"
      >
        <strong>{{ modeTooltip.label }}</strong>
        {{ modeTooltip.tooltip }}
      </span>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="ai-session-context-menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <button
          type="button"
          @click="openContextSessionContent"
        >
          <FileText />
          <span>{{ t('aiSessions.openContent') }}</span>
        </button>
        <button
          type="button"
          @click="locateContextSession"
        >
          <LocateFixed />
          <span>{{ contextMenuSession && contextMenuSession.state !== 'working' && contextMenuSession.resumeCommand ? t('aiSessions.resume') : t('aiSessions.locateTerminal') }}</span>
        </button>
        <button
          v-if="contextMenuSession?.state === 'needsInput'"
          type="button"
          @click="markContextSessionHandled"
        >
          <Check />
          <span>{{ t('aiSessions.markHandled') }}</span>
        </button>
        <button
          type="button"
          class="danger"
          @click="clearContextSession"
        >
          <Trash2 />
          <span>{{ t('aiSessions.clearSession') }}</span>
        </button>
      </div>
    </Teleport>

    <div class="panel-search">
      <Search />
      <input
        v-model="query"
        :placeholder="searchPlaceholder"
      />
    </div>

    <div
      v-if="workspace.managedAiSessionsError"
      class="ai-sessions-error"
    >
      {{ workspace.managedAiSessionsError }}
    </div>

    <div class="ai-sessions-content">
      <div
        v-if="workspace.managedAiSessions.length"
        class="ai-sessions-section-header"
      >
        <span class="ai-sessions-section-title">
          <Inbox v-if="mode === 'pending'" />
          <Activity v-else-if="mode === 'running'" />
          <Archive v-else />
          <strong>{{ activeModeLabel }}</strong>
        </span>
        <span
          v-if="mode === 'pending'"
          class="ai-sessions-scope-label"
        >{{ activeScopeLabel }}</span>
        <span
          v-else
          class="ai-sessions-library-grouping"
          :aria-label="t('aiSessions.grouping')"
        >
          <button
            type="button"
            :class="{ active: libraryGrouping === 'project' }"
            :title="t('aiSessions.groupByProject')"
            :aria-label="t('aiSessions.groupByProject')"
            @click="selectLibraryGrouping('project')"
          >
            <FolderTree />
          </button>
          <button
            type="button"
            :class="{ active: libraryGrouping === 'agent' }"
            :title="t('aiSessions.groupByAgent')"
            :aria-label="t('aiSessions.groupByAgent')"
            @click="selectLibraryGrouping('agent')"
          >
            <Bot />
          </button>
        </span>
      </div>
      <div
        ref="sessionListElement"
        class="ai-sessions-list"
      >
        <template v-if="mode === 'running'">
          <section
            v-for="section in runningSections"
            :key="section.key"
            class="ai-session-library-section"
            :class="{ collapsed: isLibrarySectionCollapsed(section.key) }"
          >
            <button
              type="button"
              class="ai-session-library-section-header"
              :aria-expanded="!isLibrarySectionCollapsed(section.key)"
              @click="toggleLibrarySection(section.key)"
            >
              <span>
                <ChevronDown class="ai-session-library-chevron" />
                <FolderTree v-if="libraryGrouping === 'project'" />
                <Bot v-else />
                <strong>{{ section.label }}</strong>
              </span>
              <small>{{ section.count }}</small>
            </button>
            <template v-if="!isLibrarySectionCollapsed(section.key)">
              <div
                v-for="session in section.sessions"
                :key="`${session.source}:${session.id}`"
                class="ai-session-row library"
                role="button"
                tabindex="0"
                :title="sessionRowTooltip(session)"
                :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey, attention: session.state === 'needsInput' }"
                @click="selectSession(session)"
                @dblclick="resumeOrFocusSession(session)"
                @contextmenu.prevent="openSessionContextMenu(session, $event)"
                @keydown.enter.prevent="selectSession(session)"
                @keydown.space.prevent="selectSession(session)"
              >
                <span class="ai-session-row-side">
                  <span :class="`ai-session-state dot-${sessionDotState(session)}`"></span>
                  <button
                    v-if="session.state === 'needsInput'"
                    type="button"
                    class="ai-session-handle"
                    :title="t('aiSessions.markHandled')"
                    :aria-label="t('aiSessions.markHandled')"
                    @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
                  >
                    <Check />
                  </button>
                </span>
                <span class="ai-session-row-body">
                  <span class="ai-session-row-title">{{ sessionRowTitle(session) }}</span>
                  <span
                    v-if="sessionRowDetail(session)"
                    class="ai-session-row-detail"
                  >{{ sessionRowDetail(session) }}</span>
                  <span class="ai-session-row-meta">
                    <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(session) }}</span>
                  </span>
                </span>
              </div>
            </template>
          </section>
        </template>
        <template v-else-if="mode === 'library'">
          <section
            v-for="section in librarySections"
            :key="section.key"
            class="ai-session-library-section"
            :class="{ collapsed: isLibrarySectionCollapsed(section.key) }"
          >
            <button
              type="button"
              class="ai-session-library-section-header"
              :aria-expanded="!isLibrarySectionCollapsed(section.key)"
              @click="toggleLibrarySection(section.key)"
            >
              <span>
                <ChevronDown class="ai-session-library-chevron" />
                <FolderTree v-if="libraryGrouping === 'project'" />
                <Bot v-else />
                <strong>{{ section.label }}</strong>
              </span>
              <small>{{ section.count }}</small>
            </button>
            <template v-if="!isLibrarySectionCollapsed(section.key)">
              <div
                v-for="session in section.sessions"
                :key="`${session.source}:${session.id}`"
                class="ai-session-row library"
                role="button"
                tabindex="0"
                :title="sessionRowTooltip(session)"
                :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey, attention: session.state === 'needsInput' }"
                @click="selectSession(session)"
                @dblclick="resumeOrFocusSession(session)"
                @contextmenu.prevent="openSessionContextMenu(session, $event)"
                @keydown.enter.prevent="selectSession(session)"
                @keydown.space.prevent="selectSession(session)"
              >
                <span class="ai-session-row-side">
                  <span :class="`ai-session-state dot-${sessionDotState(session)}`"></span>
                  <button
                    v-if="session.state === 'needsInput'"
                    type="button"
                    class="ai-session-handle"
                    :title="t('aiSessions.markHandled')"
                    :aria-label="t('aiSessions.markHandled')"
                    @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
                  >
                    <Check />
                  </button>
                </span>
                <span class="ai-session-row-body">
                  <span class="ai-session-row-title">{{ sessionRowTitle(session) }}</span>
                  <span
                    v-if="sessionRowDetail(session)"
                    class="ai-session-row-detail"
                  >{{ sessionRowDetail(session) }}</span>
                  <span class="ai-session-row-meta">
                    <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(session) }}</span>
                  </span>
                </span>
              </div>
            </template>
          </section>
        </template>
        <template v-else>
          <div
            v-for="session in visibleSessions"
            :key="`${session.source}:${session.id}`"
            class="ai-session-row"
            role="button"
            tabindex="0"
            :title="sessionRowTooltip(session)"
            :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey, attention: session.state === 'needsInput' }"
            @click="selectSession(session)"
            @dblclick="resumeOrFocusSession(session)"
            @contextmenu.prevent="openSessionContextMenu(session, $event)"
            @keydown.enter.prevent="selectSession(session)"
            @keydown.space.prevent="selectSession(session)"
          >
            <span class="ai-session-row-side">
              <span :class="`ai-session-state dot-${sessionDotState(session)}`"></span>
              <button
                v-if="session.state === 'needsInput'"
                type="button"
                class="ai-session-handle"
                :title="t('aiSessions.markHandled')"
                :aria-label="t('aiSessions.markHandled')"
                @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
              >
                <Check />
              </button>
            </span>
            <span class="ai-session-row-body">
              <span class="ai-session-row-title">{{ sessionRowTitle(session) }}</span>
              <span
                v-if="sessionRowDetail(session)"
                class="ai-session-row-detail"
              >{{ sessionRowDetail(session) }}</span>
              <span class="ai-session-row-meta">
                <span class="ai-session-row-meta-main">{{ adaptiveSessionRowMeta(session) }}</span>
              </span>
            </span>
          </div>
        </template>
        <div
          v-if="visibleSessions.length === 0"
          class="ai-sessions-empty"
        >
          <p>{{ t('aiSessions.emptyTitle') }}</p>
          <small>{{ t('aiSessions.emptyDescription') }}</small>
          <button
            class="ai-sessions-empty-action"
            @click="workspace.refreshManagedAiSessions()"
          >
            <RefreshCw />
            {{ t('aiSessions.refresh') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, Archive, Bot, Check, ChevronDown, FileText, FolderTree, Inbox, LocateFixed, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import type { ManagedAiPanelModeButton } from '@/services/ai/aiSessionsPanelViewRuntime'
import { useAiSessionsPanelRuntime } from '@/services/ai/aiSessionsPanelRuntime'

const {
  workspace,
  t,
  query,
  mode,
  libraryGrouping,
  modeButtons,
  contextMenu,
  contextMenuSession,
  activeModeLabel,
  searchPlaceholder,
  sessionKey,
  selectMode,
  openSessionContextMenu,
  closeSessionContextMenu,
  openContextSessionContent,
  locateContextSession,
  markContextSessionHandled,
  clearContextSession,
  selectLibraryGrouping,
  isLibrarySectionCollapsed,
  toggleLibrarySection,
  visibleSessions,
  librarySections,
  runningSections,
  activeScopeLabel,
  selectSession,
  resumeOrFocusSession,
  sessionRowTooltip,
  sessionRowTitle,
  sessionRowDetail,
  sessionRowMeta,
  sessionRowMetaCandidates,
  sessionDotState
} = useAiSessionsPanelRuntime()

const sessionListElement = ref<HTMLElement | null>(null)
const rowMetaWidth = ref(0)
let measureCanvasContext: CanvasRenderingContext2D | null = null
let listResizeObserver: ResizeObserver | null = null

const rowMetaSignature = computed(() => workspace.sortedManagedAiSessions.map((session) => `${sessionKey(session)}:${session.gitBranch || ''}:${session.gitDirty ? 1 : 0}:${session.canonicalCwd || session.cwd || ''}:${session.lastActivityAt}`).join('|'))

const measureRowMetaText = (text: string) => {
  if (!measureCanvasContext && typeof document !== 'undefined') {
    measureCanvasContext = document.createElement('canvas').getContext('2d')
  }
  if (!measureCanvasContext) return text.length * 7
  measureCanvasContext.font = '10px sans-serif'
  return measureCanvasContext.measureText(text).width
}

const updateRowMetaWidth = () => {
  const width = sessionListElement.value?.clientWidth || sessionListElement.value?.getBoundingClientRect().width || 0
  const nextWidth = Math.max(0, Math.floor(width - 64))
  if (rowMetaWidth.value !== nextWidth) rowMetaWidth.value = nextWidth
}

const adaptiveSessionRowMeta = (session: Parameters<typeof sessionRowMeta>[0]) => {
  const candidates = sessionRowMetaCandidates(session)
  const fallback = candidates.at(-1) || sessionRowMeta(session)
  const width = rowMetaWidth.value
  if (width <= 0) return fallback
  return candidates.find((candidate) => measureRowMetaText(candidate) <= width) || fallback
}

watch(rowMetaSignature, () => {
  void nextTick(updateRowMetaWidth)
})

onMounted(() => {
  updateRowMetaWidth()
  document.addEventListener('click', closeSessionContextMenu)
  document.addEventListener('keydown', closeContextMenuOnEscape)
  if (typeof ResizeObserver === 'undefined' || !sessionListElement.value) return
  listResizeObserver = new ResizeObserver(updateRowMetaWidth)
  listResizeObserver.observe(sessionListElement.value)
})

onBeforeUnmount(() => {
  listResizeObserver?.disconnect()
  listResizeObserver = null
  document.removeEventListener('click', closeSessionContextMenu)
  document.removeEventListener('keydown', closeContextMenuOnEscape)
})

const closeContextMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeSessionContextMenu()
}

const modeTooltip = ref<{ label: string; tooltip: string; left: number; top: number } | null>(null)

const showModeTooltip = (option: ManagedAiPanelModeButton, event: Event) => {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  const tooltipWidth = 190
  const viewportPadding = 8
  const left = Math.min(
    Math.max(rect.right + 10, viewportPadding),
    Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding)
  )
  const top = Math.min(
    Math.max(rect.top + rect.height / 2, viewportPadding),
    Math.max(viewportPadding, window.innerHeight - 48)
  )
  modeTooltip.value = {
    label: option.label,
    tooltip: option.tooltip,
    left,
    top
  }
}

const hideModeTooltip = () => {
  modeTooltip.value = null
}
</script>
