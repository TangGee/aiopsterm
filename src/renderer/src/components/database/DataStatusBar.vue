<script setup lang="ts">
import { computed } from 'vue'
import type { ResultStatus } from '@/services/databaseGridRuntime'

const props = withDefaults(
  defineProps<{
    status?: ResultStatus
    error?: string
    message?: string
    durationMs?: number
    rowCount?: number
  }>(),
  {
    status: 'ok',
    error: '',
    message: 'Execution OK',
    durationMs: 0,
    rowCount: 0
  }
)

const hasError = computed(() => props.status === 'error' || !!props.error)
</script>

<template>
  <div
    class="db-status-bar"
    :class="{ error: hasError, running: status === 'running' }"
  >
    <template v-if="hasError">
      <span><b>【Result】</b>{{ error }}</span>
    </template>
    <template v-else-if="status === 'running'">
      <span><b>【Result】</b>Running</span>
      <span><b>【Time】</b>{{ durationMs }}ms</span>
      <span><b>【Rows】</b>{{ rowCount }} row</span>
    </template>
    <template v-else>
      <span><b>【Result】</b>{{ message }}</span>
      <span><b>【Time】</b>{{ durationMs }}ms</span>
      <span><b>【Rows】</b>{{ rowCount }} row</span>
    </template>
  </div>
</template>
