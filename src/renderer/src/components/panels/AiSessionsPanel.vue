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
import { computed, ref, watch } from 'vue'
import { ArchiveX, Ban, Check, CheckCheck, Copy, LocateFixed, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { useWorkspaceStore, type ManagedAiSession, type ManagedAiSessionState } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { useI18n } from '@/i18n'
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const query = ref('')
const filter = ref<'all' | ManagedAiSessionState>('all')
const eventFilter = ref<'all' | ManagedAiSession['events'][number]['requestKind']>('all')
const sourceFilter = ref<'all' | AiAgentSessionSource>('all')
const projectFilter = ref('all')
const hibernatedOnly = ref(false)
const replyText = ref('')
const renameTitle = ref('')
type CockpitFilterKey = 'all' | 'needsInput' | 'working' | 'idle' | 'ended' | 'hibernated'
const filters = computed<Array<{ key: 'all' | ManagedAiSessionState; label: string }>>(() => [
  { key: 'all', label: t('aiSessions.filter.all') },
  { key: 'needsInput', label: t('aiSessions.filter.needsInput') },
  { key: 'working', label: t('aiSessions.filter.working') },
  { key: 'idle', label: t('aiSessions.filter.idle') },
  { key: 'ended', label: t('aiSessions.filter.ended') }
])
const eventFilters = computed<Array<{ key: 'all' | ManagedAiSession['events'][number]['requestKind']; label: string }>>(() => [
  { key: 'all', label: t('aiSessions.filter.all') },
  { key: 'permission', label: t('aiSessions.eventFilter.permission') },
  { key: 'question', label: t('aiSessions.eventFilter.question') },
  { key: 'plan', label: t('aiSessions.eventFilter.plan') },
  { key: 'notification', label: t('aiSessions.eventFilter.notification') },
  { key: 'telemetry', label: t('aiSessions.eventFilter.telemetry') }
])

const sourceLabel = (source: AiAgentSessionSource) => {
  const labels: Record<AiAgentSessionSource, string> = {
    'claude-code': 'Claude Code',
    antigravity: 'Antigravity',
    amp: 'Amp',
    codebuddy: 'CodeBuddy',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
    factory: 'Factory',
    gemini: 'Gemini',
    grok: 'Grok',
    'hermes-agent': 'Hermes Agent',
    kiro: 'Kiro',
    omp: 'OMP',
    opencode: 'OpenCode',
    pi: 'Pi',
    qoder: 'Qoder',
    rovodev: 'Rovo Dev'
  }
  return labels[source] || source
}

const stateLabel = (state: ManagedAiSessionState) => {
  if (state === 'needsInput') return t('aiSessions.filter.needsInput')
  if (state === 'working') return t('aiSessions.filter.working')
  if (state === 'idle') return t('aiSessions.filter.idle')
  if (state === 'ended') return t('aiSessions.filter.ended')
  return t('aiSessions.state.unknown')
}

const lifecycleLabel = (lifecycle: NonNullable<ManagedAiSession['agentLifecycle']>) => {
  if (lifecycle === 'running') return t('aiSessions.filter.working')
  if (lifecycle === 'idle') return t('aiSessions.filter.idle')
  if (lifecycle === 'needsInput') return t('aiSessions.filter.needsInput')
  if (lifecycle === 'ended') return t('aiSessions.filter.ended')
  return t('aiSessions.state.unknown')
}

const requestKindLabel = (kind: ManagedAiSession['requestKind']) => {
  if (kind === 'permission') return t('aiSessions.request.permission')
  if (kind === 'question') return t('aiSessions.request.question')
  if (kind === 'plan') return t('aiSessions.request.plan')
  if (kind === 'notification') return t('aiSessions.request.notification')
  return t('aiSessions.request.telemetry')
}

const decisionModeLabel = (mode: ManagedAiSession['decisionMode']) => {
  if (mode === 'blocking') return t('aiSessions.decision.blocking')
  if (mode === 'local') return t('aiSessions.decision.local')
  return t('aiSessions.decision.telemetry')
}

const eventLabel = (event: AiAgentSessionEventName) => {
  if (event === 'session_start') return t('aiSessions.event.sessionStart')
  if (event === 'prompt_submit') return t('aiSessions.event.promptSubmit')
  if (event === 'pre_tool_use') return t('aiSessions.event.toolUse')
  if (event === 'permission_request') return t('aiSessions.event.permissionRequest')
  if (event === 'question') return t('aiSessions.event.question')
  if (event === 'notification') return t('aiSessions.event.notification')
  if (event === 'lifecycle') return t('aiSessions.event.lifecycle')
  if (event === 'stop') return t('aiSessions.event.stop')
  return t('aiSessions.event.sessionEnd')
}

const timelineEventNeedsInput = (event: ManagedAiSession['events'][number]) => {
  if (event.source === 'codex' && event.event === 'permission_request') return false
  if (event.requestKind === 'telemetry') return false
  if (event.decisionMode === 'blocking') return true
  if (event.requestKind === 'notification') return true
  return event.actionable === true
}

const eventState = (event: ManagedAiSession['events'][number]): ManagedAiSessionState => {
  if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return timelineEventNeedsInput(event) ? 'needsInput' : 'working'
  if (event.event === 'prompt_submit' || event.event === 'pre_tool_use' || event.event === 'lifecycle') return 'working'
  if (event.event === 'session_end') return 'ended'
  return 'idle'
}

const decisionLabel = (kind: string) => {
  if (kind === 'allow') return t('aiSessions.decision.allow')
  if (kind === 'always') return t('aiSessions.decision.always')
  if (kind === 'bypass') return t('aiSessions.decision.bypass')
  if (kind === 'deny') return t('aiSessions.decision.deny')
  if (kind === 'reply') return t('aiSessions.decision.reply')
  return t('aiSessions.decision.handled')
}

const sessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

const projectKeyFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  return normalized || '__unknown__'
}

const projectLabelFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  if (!normalized) return t('aiSessions.unknownPath')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) || normalized
}

const sourceOptions = computed(() => {
  const sources = new Set<AiAgentSessionSource>()
  workspace.sortedManagedAiSessions.forEach((session) => sources.add(session.source))
  return [...sources].sort((first, second) => sourceLabel(first).localeCompare(sourceLabel(second)))
})

const projectOptions = computed(() => {
  const projects = new Map<string, { key: string; label: string; count: number; latest: number }>()
  workspace.sortedManagedAiSessions.forEach((session) => {
    const key = projectKeyFor(session.cwd)
    const existing = projects.get(key)
    projects.set(key, {
      key,
      label: existing?.label || projectLabelFor(session.cwd),
      count: (existing?.count || 0) + 1,
      latest: Math.max(existing?.latest || 0, session.lastActivityAt || 0)
    })
  })
  return [...projects.values()]
    .sort((first, second) => second.latest - first.latest || first.label.localeCompare(second.label))
    .map((project) => ({
      ...project,
      label: `${project.label} (${project.count})`
    }))
})

const attentionQueue = computed(() =>
  workspace.sortedManagedAiSessions.filter((session) => session.state === 'needsInput').sort((first, second) => second.lastActivityAt - first.lastActivityAt)
)

const hibernatedSessions = computed(() => workspace.sortedManagedAiSessions.filter((session) => session.hibernated))

const cockpitCards = computed<Array<{ key: CockpitFilterKey; label: string; value: number; active: boolean }>>(() => [
  { key: 'all', label: t('aiSessions.cockpit.total'), value: workspace.managedAiSessions.length, active: filter.value === 'all' && !hibernatedOnly.value },
  { key: 'needsInput', label: t('aiSessions.filter.needsInput'), value: attentionQueue.value.length, active: filter.value === 'needsInput' && !hibernatedOnly.value },
  { key: 'working', label: t('aiSessions.filter.working'), value: workspace.managedAiSessions.filter((session) => session.state === 'working').length, active: filter.value === 'working' && !hibernatedOnly.value },
  { key: 'idle', label: t('aiSessions.filter.idle'), value: workspace.managedAiSessions.filter((session) => session.state === 'idle').length, active: filter.value === 'idle' && !hibernatedOnly.value },
  { key: 'ended', label: t('aiSessions.filter.ended'), value: workspace.managedAiSessions.filter((session) => session.state === 'ended').length, active: filter.value === 'ended' && !hibernatedOnly.value },
  { key: 'hibernated', label: t('aiSessions.filter.hibernated'), value: hibernatedSessions.value.length, active: hibernatedOnly.value }
])

const applyStateFilter = (key: 'all' | ManagedAiSessionState) => {
  filter.value = key
  hibernatedOnly.value = false
}

const applyCockpitFilter = (key: CockpitFilterKey) => {
  if (key === 'hibernated') {
    filter.value = 'all'
    hibernatedOnly.value = true
    return
  }
  applyStateFilter(key)
}

const visibleSessions = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return workspace.sortedManagedAiSessions.filter((session) => {
    if (hibernatedOnly.value && session.hibernated !== true) return false
    if (filter.value !== 'all' && session.state !== filter.value) return false
    if (sourceFilter.value !== 'all' && session.source !== sourceFilter.value) return false
    if (projectFilter.value !== 'all' && projectKeyFor(session.cwd) !== projectFilter.value) return false
    if (!needle) return true
    return [session.title, session.summary, session.source, session.cwd, session.id].some((value) => String(value || '').toLowerCase().includes(needle))
  })
})

const visiblePendingSessions = computed(() => visibleSessions.value.filter((session) => session.state === 'needsInput'))

const activeScopeLabel = computed(() => {
  const parts: string[] = []
  if (filter.value !== 'all') parts.push(stateLabel(filter.value))
  if (hibernatedOnly.value) parts.push(t('aiSessions.filter.hibernated'))
  if (sourceFilter.value !== 'all') parts.push(sourceLabel(sourceFilter.value))
  if (projectFilter.value !== 'all') parts.push(projectOptions.value.find((project) => project.key === projectFilter.value)?.label || projectFilter.value)
  if (query.value.trim()) parts.push(t('aiSessions.scopeSearch', { query: query.value.trim() }))
  return parts.length ? parts.join(' / ') : t('aiSessions.scopeAll')
})

const selectedSession = computed(() => {
  const selected = workspace.selectedManagedAiSession
  if (selected && visibleSessions.value.some((session) => sessionKey(session) === sessionKey(selected))) return selected
  return visibleSessions.value[0] || null
})

const filteredTimelineEvents = computed(() => {
  const events = selectedSession.value?.events.slice().reverse() || []
  if (eventFilter.value === 'all') return events
  return events.filter((event) => event.requestKind === eventFilter.value)
})

watch(
  selectedSession,
  (session) => {
    renameTitle.value = session?.title || ''
    replyText.value = ''
    eventFilter.value = 'all'
  },
  { immediate: true }
)

const selectSession = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
  workspace.focusManagedAiSession(session.panelId || session.terminalSessionId || session.id)
  workspace.selectedManagedAiSessionKey = sessionKey(session)
}

const renameSelectedSession = () => {
  const session = selectedSession.value
  const title = renameTitle.value.trim()
  if (!session || !title || title === session.title) return
  void workspace.renameManagedAiSession(session.source, session.id, title)
}

const submitReply = async () => {
  const session = selectedSession.value
  const message = replyText.value.trim()
  if (!session || !message) return
  const ok = await workspace.replyManagedAiSession(session.source, session.id, 'reply', message)
  if (ok) replyText.value = ''
}

const submitQuestionReply = async () => {
  const session = selectedSession.value
  const message = replyText.value.trim()
  if (!session || !message) return
  const ok = await workspace.replyManagedAiSession(session.source, session.id, 'reply', message)
  if (ok) replyText.value = ''
}

const timelineEventCopyPayload = (event: ManagedAiSession['events'][number]) =>
  JSON.stringify(
    {
      id: event.id,
      source: event.source,
      event: event.event,
      sessionId: event.sessionId,
      title: event.title,
      summary: event.summary,
      receivedAt: event.receivedAt,
      requestKind: event.requestKind,
      decisionMode: event.decisionMode,
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : {}),
      ...(event.cwd ? { cwd: event.cwd } : {}),
      ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
      ...(event.agentLifecycle ? { agentLifecycle: event.agentLifecycle } : {})
    },
    null,
    2
  )

const copyTimelineEvent = async (event: ManagedAiSession['events'][number]) => {
  const copied = await copyTextToClipboard(timelineEventCopyPayload(event))
  workspace.setTopNotice(copied ? t('aiSessions.eventCopied') : t('aiSessions.eventCopyFailed'))
}

const visibleSessionSummaryPayload = () =>
  [
    t('aiSessions.queueHeader', { scope: activeScopeLabel.value }),
    t('aiSessions.queueCounts', { current: visibleSessions.value.length, pending: visiblePendingSessions.value.length }),
    '',
    ...visibleSessions.value.map((session, index) => {
      const status = `${stateLabel(session.state)} / ${requestKindLabel(session.requestKind)} / ${decisionModeLabel(session.decisionMode)}`
      const lines = [
        `${index + 1}. ${session.title}`,
        `   ${t('aiSessions.copy.agent')}: ${sourceLabel(session.source)} (${session.source})`,
        `   ${t('aiSessions.copy.status')}: ${status}`,
        `   ${t('aiSessions.copy.session')}: ${session.id}`,
        session.cwd ? `   ${t('aiSessions.copy.path')}: ${session.cwd}` : '',
        session.summary ? `   ${t('aiSessions.copy.summary')}: ${session.summary}` : '',
        session.resumeCommand ? `   ${t('aiSessions.copy.resume')}: ${session.resumeCommand}` : ''
      ].filter(Boolean)
      return lines.join('\n')
    })
  ].join('\n')

const copyVisibleSessionQueue = async () => {
  const copied = await copyTextToClipboard(visibleSessionSummaryPayload())
  workspace.setTopNotice(copied ? t('aiSessions.queueCopied') : t('aiSessions.queueCopyFailed'))
}

const focusNextVisiblePending = () => {
  const selectedKey = selectedSession.value ? sessionKey(selectedSession.value) : ''
  const selectedIndex = visiblePendingSessions.value.findIndex((session) => sessionKey(session) === selectedKey)
  const next = visiblePendingSessions.value[(selectedIndex + 1) % visiblePendingSessions.value.length]
  if (!next) return
  selectSession(next)
}

const markVisiblePendingHandled = async () => {
  const pending = visiblePendingSessions.value
  if (!pending.length) return
  const groups = new Map<AiAgentSessionSource, string[]>()
  pending.forEach((session) => groups.set(session.source, [...(groups.get(session.source) || []), session.id]))
  for (const [source, sessionIds] of groups) {
    await workspace.bulkManagedAiSessions({
      operation: 'mark-handled',
      sources: [source],
      sessionIds
    })
  }
  workspace.setTopNotice(t('aiSessions.visibleHandled', { count: pending.length }))
}

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))

const formatRelativeTime = (timestamp: number) => {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) return t('aiSessions.relative.secondsAgo', { count: deltaSeconds })
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) return t('aiSessions.relative.minutesAgo', { count: deltaMinutes })
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return t('aiSessions.relative.hoursAgo', { count: deltaHours })
  return t('aiSessions.relative.daysAgo', { count: Math.round(deltaHours / 24) })
}
</script>

<style scoped>
.ai-sessions-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.ai-sessions-count {
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.16);
  color: var(--accent-color);
  font-weight: 700;
}

.ai-sessions-header-actions,
.ai-sessions-bulk,
.ai-session-detail-actions,
.ai-session-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ai-sessions-settings,
.ai-session-detail header button,
.ai-session-reply button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  color: var(--text-secondary);
}

.ai-sessions-settings:hover,
.ai-session-detail header button:hover,
.ai-session-reply button:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.ai-sessions-settings svg,
.ai-session-detail button svg,
.ai-session-reply button svg,
.ai-sessions-bulk svg,
.ai-session-actions svg {
  width: 15px;
  height: 15px;
}

.ai-sessions-filter {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
}

.ai-sessions-cockpit {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 12px 0;
}

.ai-sessions-cockpit button {
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text-secondary);
  padding: 7px 8px;
  text-align: left;
}

.ai-sessions-cockpit button.active,
.ai-sessions-cockpit button:hover {
  border-color: var(--accent-color);
  color: var(--text-primary);
}

.ai-sessions-cockpit strong,
.ai-sessions-cockpit span {
  display: block;
}

.ai-sessions-cockpit strong {
  font-size: 16px;
  line-height: 1.1;
}

.ai-sessions-cockpit span {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-sessions-context {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 8px 12px 0;
}

.ai-sessions-context label {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.ai-sessions-context span {
  color: var(--text-muted);
  font-size: 11px;
}

.ai-sessions-context select {
  width: 100%;
  min-width: 0;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-secondary);
  outline: 0;
  padding: 0 7px;
}

.ai-sessions-context select:focus {
  border-color: var(--accent-color);
  color: var(--text-primary);
}

.ai-sessions-attention-strip {
  padding: 8px 12px 0;
}

.ai-sessions-attention-strip button {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(59, 130, 246, 0.38);
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.12);
  color: var(--text-primary);
  padding: 8px 10px;
  text-align: left;
}

.ai-sessions-attention-strip strong,
.ai-sessions-attention-strip span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-sessions-attention-strip span {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.ai-sessions-queue-bar {
  margin: 8px 12px 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-2);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
}

.ai-sessions-queue-bar strong,
.ai-sessions-queue-bar span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-sessions-queue-bar strong {
  color: var(--text-secondary);
  font-size: 12px;
}

.ai-sessions-queue-bar span {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
}

.ai-sessions-queue-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ai-sessions-queue-actions button {
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-1);
  color: var(--text-secondary);
}

.ai-sessions-queue-actions button:not(:disabled):hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.ai-sessions-queue-actions button:disabled {
  opacity: 0.45;
}

.ai-sessions-queue-actions svg {
  width: 14px;
  height: 14px;
}

.ai-sessions-filter button,
.ai-sessions-bulk button,
.ai-session-actions button,
.ai-session-clear {
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 5px 8px;
  white-space: nowrap;
}

.ai-sessions-filter button.active {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.ai-sessions-error {
  margin: 0 12px 8px;
  color: var(--danger);
  font-size: 12px;
}

.ai-sessions-bulk {
  padding: 0 12px 8px;
  overflow-x: auto;
}

.ai-sessions-bulk button,
.ai-session-actions button,
.ai-session-clear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ai-sessions-content {
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
}

.ai-sessions-list {
  min-height: 0;
}

.ai-session-row {
  width: 100%;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) 26px;
  gap: 10px;
  align-items: center;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  border-radius: 8px;
  padding: 9px 10px;
}

.ai-session-row:hover,
.ai-session-row.active {
  background: var(--surface-2);
  border-color: var(--border-color);
}

.ai-session-row.attention {
  border-color: rgba(59, 130, 246, 0.35);
}

.ai-session-row:not(.attention) {
  grid-template-columns: 10px minmax(0, 1fr);
}

.ai-session-row strong,
.ai-session-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-session-row small {
  color: var(--text-muted);
  margin-top: 3px;
}

.ai-session-cwd {
  color: var(--text-muted);
}

.ai-session-foot {
  color: var(--text-muted);
}

.ai-session-handle {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  color: var(--accent-color);
}

.ai-session-handle svg {
  width: 14px;
  height: 14px;
}

.ai-session-state {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--text-muted);
}

.state-working {
  background: #22c55e;
}

.state-needsInput {
  background: #3b82f6;
}

.state-ended {
  background: #71717a;
}

.state-idle {
  background: #f59e0b;
}

.ai-sessions-empty {
  color: var(--text-muted);
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-sessions-empty p {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.ai-sessions-empty small {
  line-height: 1.45;
}

.ai-sessions-empty-action {
  align-self: flex-start;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 6px 9px;
}

.ai-session-detail {
  margin-top: 10px;
  border-top: 1px solid var(--border-color);
  padding: 10px 4px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-session-detail header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.ai-session-detail header p,
.ai-session-meta,
.ai-session-event p,
.ai-session-decisions p {
  margin: 0;
}

.ai-session-detail header p,
.ai-session-event small,
.ai-session-decisions small {
  color: var(--text-muted);
  font-size: 11px;
}

.ai-session-detail input,
.ai-session-reply textarea {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 6px 7px;
  outline: 0;
}

.ai-session-detail input:focus,
.ai-session-reply textarea:focus {
  border-color: var(--accent-color);
}

.ai-session-meta {
  display: grid;
  gap: 6px;
}

.ai-session-meta div {
  min-width: 0;
}

.ai-session-meta dt {
  color: var(--text-muted);
  font-size: 11px;
}

.ai-session-meta dd {
  margin: 2px 0 0;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-session-meta dd.ai-session-command {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.4;
  white-space: normal;
  overflow-wrap: anywhere;
}

.ai-session-actions {
  overflow-x: auto;
}

.ai-session-reply {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}

.ai-session-reply textarea {
  resize: vertical;
  min-height: 44px;
  max-height: 120px;
}

.ai-session-reply button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.ai-session-timeline,
.ai-session-decisions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-session-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-session-timeline h3,
.ai-session-decisions h3 {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.ai-session-section-header span {
  color: var(--text-muted);
  font-size: 11px;
}

.ai-session-event-filters {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.ai-session-event-filters button {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  padding: 3px 6px;
  white-space: nowrap;
}

.ai-session-event-filters button.active {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.ai-session-event {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) 24px;
  gap: 8px;
  align-items: start;
  padding: 6px 0;
}

.ai-session-event strong,
.ai-session-decisions strong {
  color: var(--text-primary);
  font-size: 12px;
}

.ai-session-event p,
.ai-session-decisions p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.ai-session-event-copy {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-2);
  color: var(--text-muted);
}

.ai-session-event-copy:hover {
  color: var(--text-primary);
  border-color: var(--accent-color);
}

.ai-session-event-copy svg {
  width: 13px;
  height: 13px;
}

.ai-session-decisions > div {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 7px;
  background: var(--surface-2);
}

.ai-session-clear {
  justify-content: center;
  color: var(--danger);
}
</style>
