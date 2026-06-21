<template>
  <AiPanelPresentation />
</template>

<script setup lang="ts">
import AiPanelPresentation from '@/components/ai/AiPanelPresentation.vue'
import { provideAiPanelRuntime } from '@/services/aiPanelContext'
import { useAiPanelContainerRuntime } from '@/services/aiPanelContainerRuntime'

const props = defineProps<{ agentMode?: boolean }>()

provideAiPanelRuntime(useAiPanelContainerRuntime(props))
</script>
