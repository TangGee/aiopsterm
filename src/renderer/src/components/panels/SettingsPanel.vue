<template>
  <nav class="settings-side-panel">
    <button
      v-for="item in settingsNavItems"
      :key="item.key"
      class="settings-nav-item"
      :class="{ active: workspace.activeSettingsSection === item.key }"
      :data-onboarding-id="
        item.key === 'general'
          ? 'settings-side-nav'
          : item.key === 'terminal'
            ? 'settings-terminal-tab'
            : item.key === 'ai'
              ? 'settings-ai-preferences-tab'
              : undefined
      "
      :title="item.label"
      @click="workspace.setActiveSettingsSection(item.key)"
    >
      <component
        :is="item.icon"
        class="settings-nav-icon"
      />
      <span>{{ item.label }}</span>
      <ExternalLink
        v-if="item.external"
        class="settings-nav-external"
      />
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import { settingsNavItems } from '@/data/mockData'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
</script>
