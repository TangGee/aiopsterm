<template>
  <div
    class="project-files-dialog-backdrop"
    @mousedown.self="$emit('cancel')"
  >
    <form
      class="project-files-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      @submit.prevent="$emit('confirm')"
    >
      <header>
        <strong>{{ title }}</strong>
      </header>
      <div class="project-files-dialog-body">
        <p v-if="message">{{ message }}</p>
        <label v-if="kind !== 'delete-file'">
          <span>Name</span>
          <input
            ref="inputRef"
            :value="value"
            autocomplete="off"
            spellcheck="false"
            @input="$emit('update:value', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <small v-if="error">{{ error }}</small>
      </div>
      <footer>
        <button type="button" :disabled="busy" @click="$emit('cancel')">Cancel</button>
        <button
          type="submit"
          class="primary"
          :class="{ danger: kind === 'delete-file' }"
          :disabled="busy"
        >
          {{ busy ? 'Working' : confirmLabel }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  kind: 'create-file' | 'rename' | 'delete-file'
  value: string
  message: string
  error: string
  busy: boolean
}>()

defineEmits<{
  'update:value': [value: string]
  confirm: []
  cancel: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const title = computed(() => ({
  'create-file': 'Create file',
  rename: 'Rename',
  'delete-file': 'Delete file'
}[props.kind]))
const confirmLabel = computed(() => ({
  'create-file': 'Create',
  rename: 'Rename',
  'delete-file': 'Delete'
}[props.kind]))

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})
</script>
