<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <p class="eyebrow">AI Sessions</p>
        <h2>AI 会话</h2>
      </div>
      <div class="ai-sessions-header-actions">
        <button
          class="ai-sessions-settings"
          title="打开 AI 设置"
          @click="workspace.openAiSessionSettings"
        >
          <Settings />
        </button>
        <button
          class="ai-sessions-settings"
          title="刷新 AI 会话"
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
        placeholder="搜索会话"
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
        <span>Agent</span>
        <select v-model="sourceFilter">
          <option value="all">全部</option>
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
        <span>项目</span>
        <select v-model="projectFilter">
          <option value="all">全部</option>
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
      <button @click="selectSession(attentionQueue[0].id)">
        <strong>{{ attentionQueue.length }} 个待处理</strong>
        <span>{{ attentionQueue[0].title }} · {{ attentionQueue[0].summary || requestKindLabel(attentionQueue[0].requestKind) }}</span>
      </button>
    </section>

    <div class="ai-sessions-filter">
      <button
        v-for="option in filters"
        :key="option.key"
        :class="{ active: filter === option.key }"
        @click="filter = option.key"
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
        全部已处理
      </button>
      <button @click="workspace.bulkManagedAiSessions({ operation: 'clear-ended' })">
        <ArchiveX />
        清理已结束
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
          @click="selectSession(session.id)"
          @dblclick="workspace.focusManagedAiSession(session.id)"
          @keydown.enter.prevent="selectSession(session.id)"
          @keydown.space.prevent="selectSession(session.id)"
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
              {{ formatRelativeTime(session.lastActivityAt) }}{{ session.resumeCommand ? ' · 可恢复' : '' }}{{ session.hibernated ? ' · 已休眠' : '' }}
            </small>
          </span>
          <button
            v-if="session.state === 'needsInput'"
            class="ai-session-handle"
            title="标记已处理"
            @click.stop="workspace.markManagedAiSessionHandled(session.source, session.id)"
          >
            <Check />
          </button>
        </div>
        <div
          v-if="visibleSessions.length === 0"
          class="ai-sessions-empty"
        >
          <p>暂无 AI 会话</p>
          <small>安装并启用 Agent Hook 后，通过 aiopsterm 本地连接启动的 Codex / Claude Code / Cursor / Gemini 等会显示在这里。</small>
          <button
            class="ai-sessions-empty-action"
            @click="workspace.openAiSessionSettings"
          >
            <Settings />
            打开 AI 设置
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
              title="恢复会话"
              @click="workspace.resumeManagedAiSession(selectedSession.source, selectedSession.id)"
            >
              <RotateCcw />
            </button>
            <button
              title="定位终端"
              @click="workspace.focusManagedAiSession(selectedSession.id)"
            >
              <LocateFixed />
            </button>
          </div>
        </header>

        <dl class="ai-session-meta">
          <div>
            <dt>路径</dt>
            <dd>{{ selectedSession.cwd || '-' }}</dd>
          </div>
          <div>
            <dt>会话</dt>
            <dd>{{ selectedSession.id }}</dd>
          </div>
          <div v-if="selectedSession.agentLifecycle">
            <dt>Agent 状态</dt>
            <dd>{{ lifecycleLabel(selectedSession.agentLifecycle) }}</dd>
          </div>
          <div>
            <dt>请求类型</dt>
            <dd>{{ requestKindLabel(selectedSession.requestKind) }}</dd>
          </div>
          <div>
            <dt>处理模式</dt>
            <dd>{{ decisionModeLabel(selectedSession.decisionMode) }}</dd>
          </div>
          <div v-if="selectedSession.waitTimeoutMs">
            <dt>等待超时</dt>
            <dd>{{ Math.round(selectedSession.waitTimeoutMs / 1000) }}s</dd>
          </div>
          <div v-if="selectedSession.toolName">
            <dt>工具</dt>
            <dd>{{ selectedSession.toolName }}</dd>
          </div>
          <div v-if="selectedSession.processId">
            <dt>Agent PID</dt>
            <dd>{{ selectedSession.processId }}</dd>
          </div>
          <div v-if="selectedSession.parentProcessId">
            <dt>父进程</dt>
            <dd>{{ selectedSession.parentProcessId }}</dd>
          </div>
          <div v-if="selectedSession.processGroupId">
            <dt>进程组</dt>
            <dd>{{ selectedSession.processGroupId }}</dd>
          </div>
          <div v-if="selectedSession.terminalProcessId">
            <dt>终端 PID</dt>
            <dd>{{ selectedSession.terminalProcessId }}</dd>
          </div>
          <div v-if="selectedSession.terminalActivityAt">
            <dt>终端活动</dt>
            <dd>{{ formatTime(selectedSession.terminalActivityAt) }}</dd>
          </div>
          <div v-if="selectedSession.transcriptPath">
            <dt>记录</dt>
            <dd>{{ selectedSession.transcriptPath }}</dd>
          </div>
          <div v-if="selectedSession.launchCommand">
            <dt>启动命令</dt>
            <dd class="ai-session-command">{{ selectedSession.launchCommand }}</dd>
          </div>
          <div v-if="selectedSession.resumeCommand">
            <dt>恢复命令</dt>
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
            提交回答
          </button>
          <button
            v-if="selectedSession.requestKind !== 'question' && selectedSession.requestKind !== 'notification'"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'allow')"
          >
            <Check />
            允许
          </button>
          <button
            v-if="selectedSession.requestKind === 'permission' && selectedSession.actionable"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'always')"
          >
            <CheckCheck />
            持续允许
          </button>
          <button
            v-if="selectedSession.requestKind === 'permission' && selectedSession.actionable"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'bypass')"
          >
            <ShieldCheck />
            本会话绕过
          </button>
          <button @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'deny', replyText.trim() || undefined)">
            <Ban />
            拒绝
          </button>
          <button @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'handled')">
            <CheckCheck />
            已处理
          </button>
        </div>

        <div class="ai-session-reply">
          <textarea
            v-model="replyText"
            rows="2"
            :placeholder="selectedSession.requestKind === 'question' ? '输入要回复给 AI 的答案' : '可选：拒绝原因或处理说明'"
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
            <h3>事件流</h3>
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
              title="复制事件"
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
          <h3>处理记录</h3>
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
          清理此会话
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
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/preload'

const workspace = useWorkspaceStore()
const query = ref('')
const filter = ref<'all' | ManagedAiSessionState>('all')
const eventFilter = ref<'all' | ManagedAiSession['events'][number]['requestKind']>('all')
const sourceFilter = ref<'all' | AiAgentSessionSource>('all')
const projectFilter = ref('all')
const hibernatedOnly = ref(false)
const replyText = ref('')
const renameTitle = ref('')
type CockpitFilterKey = 'all' | 'needsInput' | 'working' | 'idle' | 'ended' | 'hibernated'
const filters: Array<{ key: 'all' | ManagedAiSessionState; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'needsInput', label: '待处理' },
  { key: 'working', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'ended', label: '已结束' }
]
const eventFilters: Array<{ key: 'all' | ManagedAiSession['events'][number]['requestKind']; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'permission', label: '权限' },
  { key: 'question', label: '提问' },
  { key: 'plan', label: '计划' },
  { key: 'notification', label: '通知' },
  { key: 'telemetry', label: '遥测' }
]

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
  if (state === 'needsInput') return '待处理'
  if (state === 'working') return '运行中'
  if (state === 'idle') return '空闲'
  if (state === 'ended') return '已结束'
  return '未知'
}

const lifecycleLabel = (lifecycle: NonNullable<ManagedAiSession['agentLifecycle']>) => {
  if (lifecycle === 'running') return '运行中'
  if (lifecycle === 'idle') return '空闲'
  if (lifecycle === 'needsInput') return '待处理'
  if (lifecycle === 'ended') return '已结束'
  return '未知'
}

const requestKindLabel = (kind: ManagedAiSession['requestKind']) => {
  if (kind === 'permission') return '权限审批'
  if (kind === 'question') return '用户提问'
  if (kind === 'plan') return '计划确认'
  if (kind === 'notification') return '通知'
  return '遥测'
}

const decisionModeLabel = (mode: ManagedAiSession['decisionMode']) => {
  if (mode === 'blocking') return '等待响应'
  if (mode === 'local') return '本地处理'
  return '仅记录'
}

const eventLabel = (event: AiAgentSessionEventName) => {
  if (event === 'session_start') return '会话开始'
  if (event === 'prompt_submit') return '提交提示'
  if (event === 'pre_tool_use') return '工具调用'
  if (event === 'permission_request') return '权限请求'
  if (event === 'question') return '提问'
  if (event === 'notification') return '通知'
  if (event === 'lifecycle') return '生命周期'
  if (event === 'stop') return '轮次结束'
  return '会话结束'
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
  if (kind === 'allow') return '允许'
  if (kind === 'always') return '持续允许'
  if (kind === 'bypass') return '本会话绕过'
  if (kind === 'deny') return '拒绝'
  if (kind === 'reply') return '回复'
  return '已处理'
}

const sessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

const projectKeyFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  return normalized || '__unknown__'
}

const projectLabelFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  if (!normalized) return '未知路径'
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
  { key: 'all', label: '总会话', value: workspace.managedAiSessions.length, active: filter.value === 'all' && !hibernatedOnly.value },
  { key: 'needsInput', label: '待处理', value: attentionQueue.value.length, active: filter.value === 'needsInput' && !hibernatedOnly.value },
  { key: 'working', label: '运行中', value: workspace.managedAiSessions.filter((session) => session.state === 'working').length, active: filter.value === 'working' && !hibernatedOnly.value },
  { key: 'idle', label: '空闲', value: workspace.managedAiSessions.filter((session) => session.state === 'idle').length, active: filter.value === 'idle' && !hibernatedOnly.value },
  { key: 'ended', label: '已结束', value: workspace.managedAiSessions.filter((session) => session.state === 'ended').length, active: filter.value === 'ended' && !hibernatedOnly.value },
  { key: 'hibernated', label: '已休眠', value: hibernatedSessions.value.length, active: hibernatedOnly.value }
])

const applyCockpitFilter = (key: CockpitFilterKey) => {
  if (key === 'hibernated') {
    filter.value = 'all'
    hibernatedOnly.value = true
    return
  }
  filter.value = key
  hibernatedOnly.value = false
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

const selectedSession = computed(() => workspace.selectedManagedAiSession || visibleSessions.value[0] || null)

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

const selectSession = (sessionId: string) => {
  workspace.focusManagedAiSession(sessionId)
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
  workspace.setTopNotice(copied ? 'AI 会话事件已复制' : 'AI 会话事件复制失败')
}

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))

const formatRelativeTime = (timestamp: number) => {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s 前`
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) return `${deltaMinutes}m 前`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h 前`
  return `${Math.round(deltaHours / 24)}d 前`
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
