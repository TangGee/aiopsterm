<template>
  <section
    class="files-transfer-side"
    :class="{ active: dropActive }"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handlePanelDrop"
  >
    <article
      v-if="session"
      class="files-session-card"
    >
      <header class="files-session-header">
        <button
          title="折叠"
          @click="collapsed = !collapsed"
        >
          <ChevronDown :class="{ rotated: collapsed }" />
        </button>
        <select v-model="selected">
          <option
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ option.label }}
          </option>
        </select>
        <button
          title="添加"
          @click="$emit('add')"
        >
          <Plus />
        </button>
        <button
          title="关闭"
          @click="closePanel"
        >
          <X />
        </button>
      </header>
      <FileBrowser
        v-show="!collapsed"
        :session="session"
        ui-mode="transfer"
        :panel-side="side"
        @open-file="$emit('openFile', $event)"
      />
    </article>

    <button
      v-else
      class="files-empty-drop"
      :class="{ active: dropActive }"
      @click="$emit('add')"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleEmptyDrop"
    >
      <Plus />
      <strong>新增连接 或 左侧拖拽至此</strong>
      <small>点击加号选择连接，或从左侧文件管理直接拖入</small>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Plus, X } from 'lucide-vue-next'
import FileBrowser from '@/components/files/FileBrowser.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import type { FileSessionInfo } from '@shared/contracts/files'

const props = defineProps<{
  side: 'left' | 'right'
  session: FileSessionInfo | null
}>()

defineEmits<{
  (event: 'add'): void
  (event: 'openFile', payload: { filePath: string; sessionId: string; sessionLabel: string; host: string }): void
}>()

const store = useWorkspaceStore()
const collapsed = ref(false)
const dropActive = ref(false)
const options = computed(() => {
  const otherSelectedId = props.side === 'left' ? store.selectedRightFileSessionId : store.selectedLeftFileSessionId
  return store.fileSessions.map((session) => ({
    value: session.id,
    label: session.label,
    disabled: session.id === otherSelectedId
  }))
})
const selected = computed({
  get: () => props.session?.id || '',
  set: (value: string) => {
    const otherSelectedId = props.side === 'left' ? store.selectedRightFileSessionId : store.selectedLeftFileSessionId
    if (value && value !== otherSelectedId) store.openFileSession(value, props.side)
  }
})

const closePanel = () => {
  store.closeFileSession(props.side)
}

const readSftpDragPayload = (event: DragEvent) => {
  const raw = event.dataTransfer?.getData('application/x-asset-sftp')
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

const isDuplicatePayload = (payload: Record<string, unknown>) => {
  const payloadId = String(payload.uuid || payload.id || '')
  const payloadHost = String(payload.host || payload.ip || '')
  return [store.selectedLeftFileSession, store.selectedRightFileSession].some((session) => {
    if (!session) return false
    if (payloadId && session.id === payloadId) return true
    return payloadHost && session.host === payloadHost
  })
}

const openDroppedSession = async (event: DragEvent) => {
  const payload = readSftpDragPayload(event)
  if (payload) {
    if (isDuplicatePayload(payload)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      return
    }
    const session = await store.addRemoteFileSessionFromSftpPayload(payload, props.side)
    if (!session && event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  const sessionId = event.dataTransfer?.getData('application/x-aiopsterm-file-session')
  if (!sessionId) return
  const otherSelectedId = props.side === 'left' ? store.selectedRightFileSessionId : store.selectedLeftFileSessionId
  if (sessionId !== otherSelectedId) store.openFileSession(sessionId, props.side)
}

const containsRelatedTarget = (event: DragEvent) => {
  const current = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  return Boolean(current && related && current.contains(related))
}

const handleDragEnter = () => {
  dropActive.value = true
}

const handleDragOver = (event: DragEvent) => {
  dropActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const handleDragLeave = (event: DragEvent) => {
  if (!containsRelatedTarget(event)) dropActive.value = false
}

const handleEmptyDrop = async (event: DragEvent) => {
  dropActive.value = false
  await openDroppedSession(event)
}

const handlePanelDrop = async (event: DragEvent) => {
  dropActive.value = false
  await openDroppedSession(event)
}
</script>
