<template>
  <div
    v-if="jobs.length"
    class="kb-transfer"
  >
    <div
      v-for="job in jobs"
      :key="job.id"
      class="kb-transfer-item"
    >
      <div class="kb-transfer-title">{{ job.destRelPath }}</div>
      <div class="progress">
        <span :style="{ width: `${job.percent}%` }"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeImportJob } from '@/services/knowledge/knowledgeRuntime'

defineProps<{
  jobs: KnowledgeImportJob[]
}>()
</script>
