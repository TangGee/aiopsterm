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
          <span>{{ t('projectFiles.dialog.name') }}</span>
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
        <button type="button" :disabled="busy" @click="$emit('cancel')">{{ t('common.cancel') }}</button>
        <button
          type="submit"
          class="primary"
          :class="{ danger: kind === 'delete-file' }"
          :disabled="busy"
        >
          {{ busy ? t('projectFiles.dialog.working') : confirmLabel }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from '@/i18n'

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

const { t } = useI18n()
const inputRef = ref<HTMLInputElement | null>(null)
const title = computed(() => ({
  'create-file': t('projectFiles.dialog.createTitle'),
  rename: t('projectFiles.dialog.renameTitle'),
  'delete-file': t('projectFiles.dialog.deleteTitle')
}[props.kind]))
const confirmLabel = computed(() => ({
  'create-file': t('projectFiles.dialog.createAction'),
  rename: t('projectFiles.dialog.renameAction'),
  'delete-file': t('common.delete')
}[props.kind]))

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})
</script>
