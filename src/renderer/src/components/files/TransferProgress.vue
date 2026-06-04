<template>
  <div
    v-if="total > 0 && collapsed"
    class="transfer-fab"
    title="展开传输列表"
    role="button"
    tabindex="0"
    @click="collapsed = false"
    @keydown.enter.space.prevent="collapsed = false"
  >
    <svg viewBox="0 0 36 36">
      <path
        class="ring-bg"
        d="M18 2a16 16 0 1 1 0 32a16 16 0 0 1 0-32"
      />
      <path
        class="ring-value"
        :stroke-dasharray="`${overall}, 100`"
        d="M18 2a16 16 0 1 1 0 32a16 16 0 0 1 0-32"
      />
    </svg>
    <span>{{ total > 99 ? '99+' : total }}</span>
    <component
      :is="fabIcon"
      class="transfer-fab-kind"
    />
  </div>

  <aside
    v-else-if="total > 0"
    class="transfer-progress-panel"
  >
    <header>
      <strong>任务列表</strong>
      <button
        title="折叠传输列表"
        @click="collapsed = true"
      >
        <Minus />
      </button>
    </header>
    <div class="transfer-progress-body">
      <section
        v-for="group in groups"
        v-show="group.tasks.length"
        :key="group.key"
        class="transfer-task-group"
      >
        <label>{{ group.label }}：</label>
        <article
          v-for="task in group.tasks"
          :key="task.id"
          class="transfer-task"
        >
          <small v-if="group.key === 'r2r'">{{ r2rTitle(task) }}</small>
          <div class="transfer-task-meta">
            <strong :title="task.target || task.source">{{ task.name }}</strong>
            <em>{{ taskSummary(task) }}</em>
          </div>
          <div class="transfer-task-progress">
            <button
              v-if="task.children?.length"
              @click="toggleExpand(task.id)"
            >
              <ChevronDown v-if="expandedTaskId === task.id" />
              <ChevronRight v-else />
            </button>
            <span v-else></span>
            <div class="progress">
              <span :style="{ width: `${task.progress}%` }"></span>
            </div>
            <button
              class="danger"
              title="取消"
              @click="store.cancelFileTransferTask(task.id)"
            >
              <X />
            </button>
          </div>
          <div
            v-if="task.children?.length && expandedTaskId === task.id"
            class="transfer-task-children"
          >
            <div
              v-for="child in task.children"
              :key="child.id"
            >
              <span>{{ child.name }}</span>
              <em>{{ taskSummary(child) }}</em>
              <div class="progress">
                <span :style="{ width: `${child.progress}%` }"></span>
              </div>
              <button
                class="danger"
                title="取消"
                @click="store.cancelFileTransferTask(child.id)"
              >
                <X />
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ChevronsLeftRight, ChevronDown, ChevronRight, Minus, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileTransferTask } from '@/data/mockData'

const store = useWorkspaceStore()
const collapsed = ref(false)
const expandedTaskId = ref('')
const overall = computed(() => store.transferOverallPercent)
const total = computed(() => store.transferTaskCount)
const groups = computed(() => [
  { key: 'download', label: '下载', tasks: store.transferTaskGroups.download },
  { key: 'upload', label: '上传', tasks: store.transferTaskGroups.upload },
  { key: 'r2r', label: '拖拽传输', tasks: store.transferTaskGroups.r2r }
])
const fabIcon = computed(() => {
  const hasDownload = store.transferTaskGroups.download.length > 0
  const hasUpload = store.transferTaskGroups.upload.length > 0
  const hasR2r = store.transferTaskGroups.r2r.length > 0
  if (hasR2r && !hasDownload && !hasUpload) return ChevronsLeftRight
  if (hasUpload && !hasDownload) return ArrowUp
  if (hasDownload && !hasUpload) return ArrowDown
  return ChevronsLeftRight
})

const taskSummary = (task: FileTransferTask) => {
  if (task.stage === 'scanning') return '扫描中...'
  if (task.stage === 'pending' || task.speed === 'pending') return '等待中...'
  if (task.isGroup) return `${task.finishedFiles || 0}/${task.totalFiles || task.children?.length || 0}`
  return task.speed || '0 KB/s'
}

const toggleExpand = (taskId: string) => {
  expandedTaskId.value = expandedTaskId.value === taskId ? '' : taskId
}

const r2rTitle = (task: FileTransferTask) => `${task.fromHost || task.source} -> ${task.toHost || task.target}`
</script>
