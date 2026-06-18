<template>
  <section class="ai-sessions-panel">
    <header class="panel-header">
      <div>
        <p class="eyebrow">AI Sessions</p>
        <h2>AI 会话</h2>
      </div>
      <span class="ai-sessions-count">{{ workspace.managedAiNeedsInputSessions.length }}</span>
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
          <small>{{ session.source }} · {{ stateLabel(session.state) }}{{ session.summary ? ` · ${session.summary}` : '' }}</small>
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
      <p
        v-if="visibleSessions.length === 0"
        class="ai-sessions-empty"
      >
        暂无 AI 会话
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Search } from 'lucide-vue-next'
import { useWorkspaceStore, type ManagedAiSession, type ManagedAiSessionState } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const query = ref('')
const filter = ref<'all' | ManagedAiSessionState>('all')
const filters: Array<{ key: 'all' | ManagedAiSessionState; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'needsInput', label: '待处理' },
  { key: 'working', label: '运行中' },
  { key: 'idle', label: '空闲' },
  { key: 'ended', label: '已结束' }
]

const stateLabel = (state: ManagedAiSessionState) => {
  if (state === 'needsInput') return '待处理'
  if (state === 'working') return '运行中'
  if (state === 'idle') return '空闲'
  if (state === 'ended') return '已结束'
  return '未知'
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

const selectSession = (sessionId: string) => {
  workspace.focusManagedAiSession(sessionId)
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

.ai-sessions-filter {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
}

.ai-sessions-filter button {
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

.ai-sessions-list {
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
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
}
</style>
