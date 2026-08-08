<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="text-editor-context-menu"
      role="menu"
      data-testid="text-editor-context-menu"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @pointerdown.stop
      @click.stop
      @keydown="handleKeydown"
    >
      <template v-for="(item, index) in items" :key="item.id">
        <i v-if="index > 0 && items[index - 1]?.group !== item.group" aria-hidden="true" />
        <button
          type="button"
          role="menuitem"
          :data-action="item.id"
          :disabled="item.disabled"
          @pointerdown.prevent
          @click="emit('select', item.id)"
        >
          <component :is="icons[item.icon]" aria-hidden="true" />
          <span>{{ item.label }}</span>
          <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import {
  AlignLeft,
  ClipboardPaste,
  Copy,
  ListStart,
  Play,
  Redo2,
  Replace,
  Save,
  Scissors,
  Search,
  TextSelect,
  Undo2
} from 'lucide-vue-next'
import type { TextEditorContextMenuItem, TextEditorContextMenuPosition } from '@/services/common/textEditorContextMenuRuntime'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: TextEditorContextMenuItem[]
}>()

const emit = defineEmits<{
  select: [action: string]
  close: []
}>()

const icons = {
  align: AlignLeft,
  copy: Copy,
  cut: Scissors,
  paste: ClipboardPaste,
  play: Play,
  redo: Redo2,
  replace: Replace,
  runAll: ListStart,
  save: Save,
  search: Search,
  selectAll: TextSelect,
  undo: Undo2
}

const menuRef = ref<HTMLElement | null>(null)
const position = reactive<TextEditorContextMenuPosition>({ x: 0, y: 0 })

const placeMenu = async () => {
  if (!props.visible) return
  position.x = props.x
  position.y = props.y
  await nextTick()
  const menu = menuRef.value
  if (!menu) return
  const margin = 8
  const rect = menu.getBoundingClientRect()
  position.x = Math.max(margin, Math.min(props.x, window.innerWidth - rect.width - margin))
  position.y = Math.max(margin, Math.min(props.y, window.innerHeight - rect.height - margin))
  await nextTick()
  enabledButtons()[0]?.focus({ preventScroll: true })
}

const enabledButtons = () =>
  Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  const buttons = enabledButtons()
  if (!buttons.length) return
  event.preventDefault()
  const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Home') buttons[0].focus()
  else if (event.key === 'End') buttons.at(-1)?.focus()
  else if (event.key === 'ArrowDown') buttons[(activeIndex + 1 + buttons.length) % buttons.length].focus()
  else buttons[(activeIndex - 1 + buttons.length) % buttons.length].focus()
}

watch(
  () => [props.visible, props.x, props.y, props.items.length],
  () => void placeMenu(),
  { immediate: true }
)
</script>
