<template>
  <section class="right-assistant-panel">
    <nav class="right-assistant-tabs" role="tablist" aria-label="Right panel">
      <button
        type="button"
        :class="{ active: activeTab === 'ai' }"
        role="tab"
        :aria-selected="activeTab === 'ai'"
        @click="selectTab('ai')"
      >
        AI
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'files' }"
        role="tab"
        :aria-selected="activeTab === 'files'"
        @click="selectTab('files')"
      >
        Files
      </button>
    </nav>
    <AiPanel
      v-show="activeTab === 'ai'"
      class="right-assistant-content"
      :agent-mode="agentMode"
      :product-session-request="productSessionRequest"
      @product-session-request-consumed="$emit('productSessionRequestConsumed', $event)"
    />
    <ProjectFilesPanel
      v-show="activeTab === 'files'"
      class="right-assistant-content"
    />
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import AiPanel from '@/components/AiPanel.vue'
import ProjectFilesPanel from '@/components/files/ProjectFilesPanel.vue'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'

const props = defineProps<{
  agentMode?: boolean
  productSessionRequest?: ProductSessionUiRequest | null
}>()
defineEmits<{
  productSessionRequestConsumed: [sequence: number]
}>()

const storedTab = localStorage.getItem('aiopsterm.rightAssistantTab')
const activeTab = ref<'ai' | 'files'>(storedTab === 'files' ? 'files' : 'ai')

const selectTab = async (tab: 'ai' | 'files') => {
  activeTab.value = tab
  localStorage.setItem('aiopsterm.rightAssistantTab', tab)
  if (tab === 'ai') {
    await nextTick()
    window.dispatchEvent(new Event('resize'))
  }
}

watch(
  () => props.productSessionRequest?.sequence,
  (sequence) => {
    if (sequence) void selectTab('ai')
  }
)
</script>
