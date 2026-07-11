<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/i18n'
import type { ResultStatus } from '@/services/database/databaseGridRuntime'

const { t } = useI18n()

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
    message: '',
    durationMs: 0,
    rowCount: 0
  }
)

const hasError = computed(() => props.status === 'error' || !!props.error)
const rowCountText = computed(() =>
  props.rowCount === 1
    ? t('database.status.rowCount.one', { count: props.rowCount })
    : t('database.status.rowCount.many', { count: props.rowCount })
)
const localizedMessage = computed(() => {
  if (!props.message) return t('database.status.executionOk')
  const rowSuffix = props.rowCount === 1 ? 'row' : 'rows'
  if (props.message === `Execution OK (${props.rowCount} ${rowSuffix})`) {
    return props.rowCount === 1
      ? t('database.status.executionOkRows.one', { count: props.rowCount })
      : t('database.status.executionOkRows.many', { count: props.rowCount })
  }
  if (props.message === `Execution OK (first ${props.rowCount} ${rowSuffix}, result truncated)`) {
    return props.rowCount === 1
      ? t('database.status.executionOkTruncated.one', { count: props.rowCount })
      : t('database.status.executionOkTruncated.many', { count: props.rowCount })
  }
  return props.message
})
</script>

<template>
  <div
    class="db-status-bar"
    :class="{ error: hasError, running: status === 'running' }"
  >
    <template v-if="hasError">
      <span><b>【{{ t('database.status.result') }}】</b>{{ error }}</span>
    </template>
    <template v-else-if="status === 'running'">
      <span><b>【{{ t('database.status.result') }}】</b>{{ t('database.status.running') }}</span>
      <span><b>【{{ t('database.status.time') }}】</b>{{ durationMs }}ms</span>
      <span><b>【{{ t('database.status.rows') }}】</b>{{ rowCountText }}</span>
    </template>
    <template v-else>
      <span><b>【{{ t('database.status.result') }}】</b>{{ localizedMessage }}</span>
      <span><b>【{{ t('database.status.time') }}】</b>{{ durationMs }}ms</span>
      <span><b>【{{ t('database.status.rows') }}】</b>{{ rowCountText }}</span>
    </template>
  </div>
</template>
