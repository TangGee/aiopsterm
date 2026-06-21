<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <p class="eyebrow">{{ t('aiSessions.eyebrow') }}</p>
        <h2>{{ t('module.aiSessions') }}</h2>
      </div>
      <div class="ai-sessions-header-actions">
        <button
          class="ai-sessions-settings"
          :title="t('aiSessions.openSettings')"
          @click="workspace.openAiSessionSettings"
        >
          <Settings />
        </button>
        <button
          class="ai-sessions-settings"
          :title="t('aiSessions.refresh')"
          @click="workspace.refreshManagedAiSessions()"
        >
          <RefreshCw />
        </button>
        <span class="ai-sessions-count">{{ workspace.managedAiNeedsInputSessions.length }}</span>
      </div>
    </header>

    <div class="panel-search">
      <Search />
      <input
        v-model="query"
        :placeholder="t('aiSessions.searchPlaceholder')"
      />
    </div>

    <section
      v-if="workspace.managedAiSessions.length"
      class="ai-sessions-cockpit"
    >
      <button
        v-for="card in cockpitCards"
        :key="card.key"
        :class="{ active: card.active }"
        @click="applyCockpitFilter(card.key)"
      >
        <strong>{{ card.value }}</strong>
        <span>{{ card.label }}</span>
      </button>
    </section>

    <section
      v-if="workspace.managedAiSessions.length"
      class="ai-sessions-context"
    >
      <label>
        <span>{{ t('aiSessions.agent') }}</span>
        <select v-model="sourceFilter">
          <option value="all">{{ t('common.all') }}</option>
          <option
            v-for="source in sourceOptions"
            :key="source"
            :value="source"
          >
            {{ sourceLabel(source) }}
          </option>
        </select>
      </label>
      <label>
        <span>{{ t('aiSessions.project') }}</span>
        <select v-model="projectFilter">
          <option value="all">{{ t('common.all') }}</option>
          <option
            v-for="project in projectOptions"
            :key="project.key"
            :value="project.key"
          >
            {{ project.label }}
          </option>
        </select>
      </label>
    </section>

    <section
      v-if="attentionQueue.length"
      class="ai-sessions-attention-strip"
    >
      <button @click="selectSession(attentionQueue[0])">
        <strong>{{ t('aiSessions.pendingCount', { count: attentionQueue.length }) }}</strong>
        <span>{{ attentionQueue[0].title }} · {{ attentionQueue[0].summary || requestKindLabel(attentionQueue[0].requestKind) }}</span>
      </button>
    </section>

    <section
      v-if="workspace.managedAiSessions.length"
      class="ai-sessions-queue-bar"
    >
      <div>
        <strong>{{ t('aiSessions.currentCount', { count: visibleSessions.length }) }}</strong>
        <span>{{ t('aiSessions.pendingScopedCount', { count: visiblePendingSessions.length, scope: activeScopeLabel }) }}</span>
      </div>
      <div class="ai-sessions-queue-actions">
        <button
          :title="t('aiSessions.nextPending')"
          :disabled="visiblePendingSessions.length === 0"
          @click="focusNextVisiblePending"
        >
          <LocateFixed />
        </button>
        <button
          :title="t('aiSessions.copyQueueSummary')"
          :disabled="visibleSessions.length === 0"
          @click="copyVisibleSessionQueue"
        >
          <Copy />
        </button>
        <button
          :title="t('aiSessions.handleFilteredPending')"
          :disabled="visiblePendingSessions.length === 0"
          @click="markVisiblePendingHandled"
        >
          <CheckCheck />
        </button>
      </div>
    </section>

    <div class="ai-sessions-filter">
      <button
        v-for="option in filters"
        :key="option.key"
        :class="{ active: filter === option.key && !hibernatedOnly }"
        @click="applyStateFilter(option.key)"
      >
        {{ option.label }}
      </button>
    </div>

    <div
      v-if="workspace.managedAiSessionsError"
      class="ai-sessions-error"
    >
      {{ workspace.managedAiSessionsError }}
    </div>

    <div class="ai-sessions-bulk">
      <button @click="workspace.bulkManagedAiSessions({ operation: 'mark-handled' })">
        <CheckCheck />
        {{ t('aiSessions.markAllHandled') }}
      </button>
      <button @click="workspace.bulkManagedAiSessions({ operation: 'clear-ended' })">
        <ArchiveX />
        {{ t('aiSessions.clearEnded') }}
      </button>
    </div>

    <div class="ai-sessions-content">
      <div class="ai-sessions-list">
        <div
          v-for="session in visibleSessions"
          :key="`${session.source}:${session.id}`"
          class="ai-session-row"
          role="button"
          tabindex="0"
          :class="{ active: sessionKey(session) === workspace.selectedManagedAiSessionKey, attention: session.state === 'needsInput' }"
          @click="selectSession(session)"
          @dblclick="workspace.focusManagedAiSession(session.id)"
          @keydown.enter.prevent="selectSession(session)"
          @keydown.space.prevent="selectSession(session)"
        >
          <span :class="`ai-session-state state-${session.state}`"></span>
          <span>
            <strong>{{ session.title }}</strong>
            <small>{{ sourceLabel(session.source) }} · {{ stateLabel(session.state) }} · {{ requestKindLabel(session.requestKind) }}{{ session.summary ? ` · ${session.summary}` : '' }}</small>
            <small
              v-if="session.cwd"
              class="ai-session-cwd"
            >{{ session.cwd }}</small>
            <small class="ai-session-foot">
              {{ formatRelativeTime(session.lastActivityAt) }}{{ session.resumeCommand ? ` · ${t('aiSessions.restorable')}` : '' }}{{ session.hibernated ? ` · ${t('aiSessions.hibernated')}` : '' }}
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
        </div>
        <div
          v-if="visibleSessions.length === 0"
          class="ai-sessions-empty"
        >
          <p>{{ t('aiSessions.emptyTitle') }}</p>
          <small>{{ t('aiSessions.emptyDescription') }}</small>
          <button
            class="ai-sessions-empty-action"
            @click="workspace.openAiSessionSettings"
          >
            <Settings />
            {{ t('aiSessions.openSettings') }}
          </button>
        </div>
      </div>

      <aside
        v-if="selectedSession"
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
import { ArchiveX, Ban, Check, CheckCheck, Copy, LocateFixed, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { useAiSessionsPanelRuntime } from '@/services/aiSessionsPanelRuntime'

const {
  workspace,
  t,
  query,
  filter,
  eventFilter,
  sourceFilter,
  projectFilter,
  hibernatedOnly,
  replyText,
  renameTitle,
  filters,
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
  sourceOptions,
  projectOptions,
  attentionQueue,
  cockpitCards,
  applyStateFilter,
  applyCockpitFilter,
  visibleSessions,
  visiblePendingSessions,
  activeScopeLabel,
  selectedSession,
  filteredTimelineEvents,
  selectSession,
  renameSelectedSession,
  submitReply,
  submitQuestionReply,
  copyTimelineEvent,
  copyVisibleSessionQueue,
  focusNextVisiblePending,
  markVisiblePendingHandled,
  formatTime,
  formatRelativeTime
} = useAiSessionsPanelRuntime()
</script>
