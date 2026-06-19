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
            <small>{{ sourceLabel(session.source) }} · {{ stateLabel(session.state) }}{{ session.summary ? ` · ${session.summary}` : '' }}</small>
            <small
              v-if="session.cwd"
              class="ai-session-cwd"
            >{{ session.cwd }}</small>
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
            <p>{{ sourceLabel(selectedSession.source) }} · {{ stateLabel(selectedSession.state) }}</p>
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
            v-if="selectedSession.lastEvent === 'question'"
            @click="submitQuestionReply"
          >
            <Send />
            提交回答
          </button>
          <button
            v-if="selectedSession.lastEvent !== 'question'"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'allow')"
          >
            <Check />
            允许
          </button>
          <button
            v-if="selectedSession.lastEvent === 'permission_request' && selectedSession.actionable"
            @click="workspace.replyManagedAiSession(selectedSession.source, selectedSession.id, 'always')"
          >
            <CheckCheck />
            持续允许
          </button>
          <button
            v-if="selectedSession.lastEvent === 'permission_request' && selectedSession.actionable"
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
            :placeholder="selectedSession.lastEvent === 'question' ? '输入要回复给 AI 的答案' : '可选：拒绝原因或处理说明'"
          ></textarea>
          <button
            v-if="selectedSession.lastEvent === 'question'"
            :disabled="replyText.trim() === ''"
            @click="submitReply"
          >
            <Send />
          </button>
        </div>

        <section class="ai-session-timeline">
          <h3>事件流</h3>
          <div
            v-for="event in selectedSession.events.slice().reverse()"
            :key="event.id"
            class="ai-session-event"
          >
            <span :class="`ai-session-state state-${eventState(event.event)}`"></span>
            <div>
              <strong>{{ eventLabel(event.event) }}</strong>
              <small>{{ formatTime(event.receivedAt) }}</small>
              <p v-if="event.summary">{{ event.summary }}</p>
            </div>
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
import { ArchiveX, Ban, Check, CheckCheck, LocateFixed, RefreshCw, RotateCcw, Search, Send, Settings, ShieldCheck, Trash2 } from 'lucide-vue-next'
import { useWorkspaceStore, type ManagedAiSession, type ManagedAiSessionState } from '@/stores/workspace'
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/preload'

const workspace = useWorkspaceStore()
const query = ref('')
const filter = ref<'all' | ManagedAiSessionState>('all')
const replyText = ref('')
const renameTitle = ref('')
const filters: Array<{ key: 'all' | ManagedAiSessionState; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'needsInput', label: '待处理' },
  { key: 'working', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'ended', label: '已结束' }
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

const eventLabel = (event: AiAgentSessionEventName) => {
  if (event === 'session_start') return '会话开始'
  if (event === 'prompt_submit') return '提交提示'
  if (event === 'pre_tool_use') return '工具调用'
  if (event === 'permission_request') return '权限请求'
  if (event === 'question') return '提问'
  if (event === 'notification') return '通知'
  if (event === 'stop') return '轮次结束'
  return '会话结束'
}

const eventState = (event: AiAgentSessionEventName): ManagedAiSessionState => {
  if (event === 'permission_request' || event === 'question' || event === 'notification') return 'needsInput'
  if (event === 'prompt_submit' || event === 'pre_tool_use') return 'working'
  if (event === 'session_end') return 'ended'
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

const visibleSessions = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return workspace.sortedManagedAiSessions.filter((session) => {
    if (filter.value !== 'all' && session.state !== filter.value) return false
    if (!needle) return true
    return [session.title, session.summary, session.source, session.cwd, session.id].some((value) => String(value || '').toLowerCase().includes(needle))
  })
})

const selectedSession = computed(() => workspace.selectedManagedAiSession || visibleSessions.value[0] || null)

watch(
  selectedSession,
  (session) => {
    renameTitle.value = session?.title || ''
    replyText.value = ''
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

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))
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

.ai-session-timeline h3,
.ai-session-decisions h3 {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.ai-session-event {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
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
