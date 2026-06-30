<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <p class="eyebrow">{{ t('aiSessions.eyebrow') }}</p>
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
        :title="option.tooltip"
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
        <span class="ai-sessions-mode-tooltip">
          <strong>{{ option.label }}</strong>
          {{ option.tooltip }}
        </span>
      </button>
    </section>

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
      <div class="ai-sessions-list">
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
                @click="focusSessionConversation(session)"
                @dblclick="focusSessionConversation(session)"
                @keydown.enter.prevent="focusSessionConversation(session)"
                @keydown.space.prevent="focusSessionConversation(session)"
              >
                <span :class="`ai-session-state state-${session.state}`"></span>
                <span class="ai-session-row-body">
                  <span class="ai-session-row-top">
                    <strong>{{ sessionDisplayTitle(session) }}</strong>
                    <small>{{ sourceLabel(session.source) }} · {{ formatRelativeTime(session.lastActivityAt) }}</small>
                  </span>
                  <small class="ai-session-summary">{{ session.summary || requestKindLabel(session.requestKind) }}</small>
                  <small class="ai-session-foot">
                    {{ stateLabel(session.state) }} · {{ requestKindLabel(session.requestKind) }}
                  </small>
                </span>
                <button
                  class="ai-session-row-action"
                  :title="t('aiSessions.locateTerminal')"
                  @click.stop="focusSessionConversation(session)"
                >
                  <LocateFixed />
                </button>
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
                @keydown.enter.prevent="selectSession(session)"
                @keydown.space.prevent="selectSession(session)"
              >
                <span :class="`ai-session-state state-${session.state}`"></span>
                <span class="ai-session-row-body">
                  <span class="ai-session-row-top">
                    <strong>{{ sessionDisplayTitle(session) }}</strong>
                    <small>{{ sourceLabel(session.source) }} · {{ formatRelativeTime(session.lastActivityAt) }}</small>
                  </span>
                  <small class="ai-session-summary">{{ session.summary || requestKindLabel(session.requestKind) }}</small>
                  <small class="ai-session-foot">
                    {{ stateLabel(session.state) }}{{ session.resumeCommand ? ` · ${t('aiSessions.restorable')}` : '' }}{{ session.hibernated ? ` · ${t('aiSessions.hibernated')}` : '' }}
                  </small>
                </span>
                <button
                  v-if="session.state === 'needsInput'"
                  class="ai-session-handle"
                  :title="t('aiSessions.markHandled')"
                  @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
                >
                  <Check />
                </button>
                <button
                  v-else-if="canResumeSession(session)"
                  class="ai-session-row-action"
                  :title="t('aiSessions.resume')"
                  @click.stop="workspace.resumeManagedAiSession(session.source, session.id)"
                >
                  <RotateCcw />
                </button>
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
            @keydown.enter.prevent="selectSession(session)"
            @keydown.space.prevent="selectSession(session)"
          >
            <span :class="`ai-session-state state-${session.state}`"></span>
            <span class="ai-session-row-body">
              <span class="ai-session-row-top">
                <strong>{{ projectLabel(session) }}</strong>
                <small>{{ sourceLabel(session.source) }} · {{ formatRelativeTime(session.lastActivityAt) }}</small>
              </span>
              <small class="ai-session-summary">{{ sessionDisplayTitle(session) }}</small>
              <small class="ai-session-foot">
                {{ stateLabel(session.state) }} · {{ requestKindLabel(session.requestKind) }}{{ session.resumeCommand ? ` · ${t('aiSessions.restorable')}` : '' }}{{ session.hibernated ? ` · ${t('aiSessions.hibernated')}` : '' }}
              </small>
            </span>
            <button
              v-if="session.state === 'needsInput'"
              class="ai-session-handle"
              :title="t('aiSessions.markHandled')"
              @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
            >
              <Check />
            </button>
            <button
              v-else-if="canResumeSession(session)"
              class="ai-session-row-action"
              :title="t('aiSessions.resume')"
              @click.stop="workspace.resumeManagedAiSession(session.source, session.id)"
            >
              <RotateCcw />
            </button>
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

      <aside
        v-if="selectedSession && mode !== 'running'"
        class="ai-session-detail"
      >
        <header>
          <div>
            <p>{{ sourceLabel(selectedSession.source) }} · {{ stateLabel(selectedSession.state) }} · {{ requestKindLabel(selectedSession.requestKind) }}</p>
            <input
              v-model="renameTitle"
              @keydown.enter.prevent="renameSelectedSession"
              @blur="renameSelectedSession"
            />
          </div>
          <div class="ai-session-detail-actions">
            <button
              v-if="selectedSession.resumeCommand"
              :title="t('aiSessions.resume')"
              @click="workspace.resumeManagedAiSession(selectedSession.source, selectedSession.id)"
            >
              <RotateCcw />
            </button>
            <button
              :title="t('aiSessions.locateTerminal')"
              @click="workspace.focusManagedAiSession(selectedSession.id)"
            >
              <LocateFixed />
            </button>
          </div>
        </header>

        <dl class="ai-session-meta">
          <div>
            <dt>{{ t('aiSessions.meta.path') }}</dt>
            <dd>{{ selectedSession.cwd || '-' }}</dd>
          </div>
          <div>
            <dt>{{ t('aiSessions.meta.session') }}</dt>
            <dd>{{ selectedSession.id }}</dd>
          </div>
          <div v-if="selectedSession.agentLifecycle">
            <dt>{{ t('aiSessions.meta.agentLifecycle') }}</dt>
            <dd>{{ lifecycleLabel(selectedSession.agentLifecycle) }}</dd>
          </div>
          <div>
            <dt>{{ t('aiSessions.meta.requestKind') }}</dt>
            <dd>{{ requestKindLabel(selectedSession.requestKind) }}</dd>
          </div>
          <div>
            <dt>{{ t('aiSessions.meta.decisionMode') }}</dt>
            <dd>{{ decisionModeLabel(selectedSession.decisionMode) }}</dd>
          </div>
          <div v-if="selectedSession.waitTimeoutMs">
            <dt>{{ t('aiSessions.meta.waitTimeout') }}</dt>
            <dd>{{ Math.round(selectedSession.waitTimeoutMs / 1000) }}s</dd>
          </div>
          <div v-if="selectedSession.toolName">
            <dt>{{ t('aiSessions.meta.tool') }}</dt>
            <dd>{{ selectedSession.toolName }}</dd>
          </div>
          <div v-if="selectedSession.processId">
            <dt>{{ t('aiSessions.meta.agentPid') }}</dt>
            <dd>{{ selectedSession.processId }}</dd>
          </div>
          <div v-if="selectedSession.parentProcessId">
            <dt>{{ t('aiSessions.meta.parentProcess') }}</dt>
            <dd>{{ selectedSession.parentProcessId }}</dd>
          </div>
          <div v-if="selectedSession.processGroupId">
            <dt>{{ t('aiSessions.meta.processGroup') }}</dt>
            <dd>{{ selectedSession.processGroupId }}</dd>
          </div>
          <div v-if="selectedSession.terminalProcessId">
            <dt>{{ t('aiSessions.meta.terminalPid') }}</dt>
            <dd>{{ selectedSession.terminalProcessId }}</dd>
          </div>
          <div v-if="selectedSession.terminalActivityAt">
            <dt>{{ t('aiSessions.meta.terminalActivity') }}</dt>
            <dd>{{ formatTime(selectedSession.terminalActivityAt) }}</dd>
          </div>
          <div v-if="selectedSession.transcriptPath">
            <dt>{{ t('aiSessions.meta.transcript') }}</dt>
            <dd>{{ selectedSession.transcriptPath }}</dd>
          </div>
          <div v-if="selectedSession.launchCommand">
            <dt>{{ t('aiSessions.meta.launchCommand') }}</dt>
            <dd class="ai-session-command">{{ selectedSession.launchCommand }}</dd>
          </div>
          <div v-if="selectedSession.resumeCommand">
            <dt>{{ t('aiSessions.meta.resumeCommand') }}</dt>
            <dd class="ai-session-command">{{ selectedSession.resumeCommand }}</dd>
          </div>
        </dl>

        <div
          v-if="selectedSession.state === 'needsInput'"
          class="ai-session-actions"
        >
          <button
            v-if="selectedSession.requestKind === 'question'"
            @click="submitQuestionReply"
          >
            <Send />
            {{ t('aiSessions.action.submitReply') }}
          </button>
          <button
            v-if="selectedSession.requestKind !== 'question' && selectedSession.requestKind !== 'notification'"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'allow')"
          >
            <Check />
            {{ t('aiSessions.action.allow') }}
          </button>
          <button
            v-if="selectedSession.requestKind === 'permission' && selectedSession.actionable"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'always')"
          >
            <CheckCheck />
            {{ t('aiSessions.action.alwaysAllow') }}
          </button>
          <button
            v-if="selectedSession.requestKind === 'permission' && selectedSession.actionable"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'bypass')"
          >
            <ShieldCheck />
            {{ t('aiSessions.action.bypassSession') }}
          </button>
          <button @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'deny', replyText.trim() || undefined)">
            <Ban />
            {{ t('aiSessions.action.deny') }}
          </button>
          <button @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'handled')">
            <CheckCheck />
            {{ t('aiSessions.action.handled') }}
          </button>
        </div>

        <div class="ai-session-reply">
          <textarea
            v-model="replyText"
            rows="2"
            :placeholder="selectedSession.requestKind === 'question' ? t('aiSessions.replyQuestionPlaceholder') : t('aiSessions.replyOptionalPlaceholder')"
          ></textarea>
          <button
            v-if="selectedSession.requestKind === 'question'"
            :disabled="replyText.trim() === ''"
            @click="submitReply"
          >
            <Send />
          </button>
        </div>

        <section class="ai-session-timeline">
          <div class="ai-session-section-header">
            <h3>{{ t('aiSessions.timeline') }}</h3>
            <span>{{ filteredTimelineEvents.length }} / {{ selectedSession.events.length }}</span>
          </div>
          <div class="ai-session-event-filters">
            <button
              v-for="option in eventFilters"
              :key="option.key"
              :class="{ active: eventFilter === option.key }"
              @click="eventFilter = option.key"
            >
              {{ option.label }}
            </button>
          </div>
          <div
            v-for="event in filteredTimelineEvents"
            :key="event.id"
            class="ai-session-event"
          >
            <span :class="`ai-session-state state-${eventState(event)}`"></span>
            <div>
              <strong>{{ eventLabel(event.event) }}</strong>
              <small>{{ formatTime(event.receivedAt) }} · {{ requestKindLabel(event.requestKind) }} · {{ decisionModeLabel(event.decisionMode) }}</small>
              <p v-if="event.summary">{{ event.summary }}</p>
            </div>
            <button
              class="ai-session-event-copy"
              :title="t('aiSessions.copyEvent')"
              @click="copyTimelineEvent(event)"
            >
              <Copy />
            </button>
          </div>
        </section>

        <section
          v-if="selectedSession.decisions.length"
          class="ai-session-decisions"
        >
          <h3>{{ t('aiSessions.decisions') }}</h3>
          <div
            v-for="decision in selectedSession.decisions.slice().reverse()"
            :key="decision.id"
          >
            <strong>{{ decisionLabel(decision.kind) }}</strong>
            <small>{{ formatTime(decision.createdAt) }}</small>
            <p v-if="decision.message">{{ decision.message }}</p>
          </div>
        </section>

        <button
          class="ai-session-clear"
          @click="workspace.clearManagedAiSession(selectedSession.source, selectedSession.id)"
        >
          <Trash2 />
          {{ t('aiSessions.clearSession') }}
        </button>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Activity, Archive, Ban, Bot, Check, CheckCheck, ChevronDown, Copy, FolderTree, Inbox, LocateFixed, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { useAiSessionsPanelRuntime } from '@/services/ai/aiSessionsPanelRuntime'

const {
  workspace,
  t,
  query,
  mode,
  libraryGrouping,
  eventFilter,
  replyText,
  renameTitle,
  modeButtons,
  activeModeLabel,
  searchPlaceholder,
  eventFilters,
  sourceLabel,
  stateLabel,
  lifecycleLabel,
  requestKindLabel,
  decisionModeLabel,
  eventLabel,
  eventState,
  decisionLabel,
  sessionKey,
  selectMode,
  selectLibraryGrouping,
  isLibrarySectionCollapsed,
  toggleLibrarySection,
  visibleSessions,
  librarySections,
  runningSections,
  activeScopeLabel,
  selectedSession,
  filteredTimelineEvents,
  selectSession,
  focusSessionConversation,
  renameSelectedSession,
  submitReply,
  submitQuestionReply,
  copyTimelineEvent,
  canResumeSession,
  resumeOrFocusSession,
  projectLabel,
  sessionDisplayTitle,
  sessionRowTooltip,
  formatTime,
  formatRelativeTime
} = useAiSessionsPanelRuntime()
</script>
