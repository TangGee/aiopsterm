<template>
  <template v-if="selectedGroupUuid === null && !searchQuery && editingGroupId !== undefined">
    <div class="snippet-item group-folder editing">
      <div class="snippet-info">
        <Folder />
        <input
          ref="groupInput"
          :value="editingGroupName"
          placeholder="命令组"
          @input="$emit('update:editing-group-name', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('confirm-group')"
          @keydown.esc="$emit('cancel-group')"
        />
      </div>
      <div class="edit-actions">
        <button
          title="确定"
          @click="$emit('confirm-group')"
        >
          <Check />
        </button>
        <button
          title="取消"
          @click="$emit('cancel-group')"
        >
          <X />
        </button>
      </div>
    </div>
  </template>

  <template v-if="selectedGroupUuid === null && !searchQuery">
    <div
      v-for="group in groups"
      :key="group.uuid"
      class="snippet-item group-folder"
      @click="$emit('select-group', group.uuid)"
      @contextmenu.prevent="$emit('open-group-menu', $event, group.uuid)"
    >
      <div class="snippet-info">
        <Folder />
        <strong>{{ group.group_name }}</strong>
      </div>
      <span class="group-count">
        <FileTerminal />
        {{ groupCount(group.uuid) }}
      </span>
    </div>
  </template>

  <div
    v-for="(command, index) in commands"
    :key="command.id"
    class="snippet-item"
    draggable="true"
    :class="{
      'drag-over-up': dragOverIndex === index && dragDirection === 'up' && !searchQuery,
      'drag-over-down': dragOverIndex === index && dragDirection === 'down' && !searchQuery
    }"
    @click="$emit('run-command', command.id, true)"
    @contextmenu.prevent="$emit('open-command-menu', $event, command.id)"
    @dragstart="$emit('drag-start', command.id, index)"
    @dragover.prevent="$emit('drag-over', index)"
    @dragleave="$emit('clear-drag')"
    @drop.prevent="$emit('drop-command', command.id)"
    @dragend="$emit('clear-drag')"
  >
    <div class="snippet-info">
      <span class="snippet-name">
        <FileTerminal />
        {{ command.snippet_name }}
      </span>
      <span class="snippet-preview">{{ command.snippet_content }}</span>
    </div>
    <div
      class="snippet-actions"
      @click.stop
    >
      <button
        title="运行"
        @click="$emit('run-command', command.id, true)"
      >
        <PlayCircle />
      </button>
      <button
        title="粘贴"
        @click="$emit('run-command', command.id, false)"
      >
        <Copy />
      </button>
    </div>
  </div>

  <div
    v-if="totalCommandCount === 0"
    class="empty-state"
  >
    暂无数据
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy, FileTerminal, Folder, PlayCircle, X } from 'lucide-vue-next'
import type { QuickCommandSnippet, SnippetGroup } from '@/services/quick-commands/quickCommandsRuntime'

defineProps<{
  groups: SnippetGroup[]
  commands: QuickCommandSnippet[]
  selectedGroupUuid: string | null
  searchQuery: string
  editingGroupId: string | null | undefined
  editingGroupName: string
  dragOverIndex: number | null
  dragDirection: 'up' | 'down' | null
  totalCommandCount: number
  groupCount: (uuid: string) => number
}>()

defineEmits<{
  'update:editing-group-name': [value: string]
  'confirm-group': []
  'cancel-group': []
  'select-group': [uuid: string]
  'open-group-menu': [event: MouseEvent, uuid: string]
  'run-command': [id: number, autoExecute: boolean]
  'open-command-menu': [event: MouseEvent, id: number]
  'drag-start': [id: number, index: number]
  'drag-over': [index: number]
  'drop-command': [id: number]
  'clear-drag': []
}>()

const groupInput = ref<HTMLInputElement | null>(null)

defineExpose({
  groupInput
})
</script>
