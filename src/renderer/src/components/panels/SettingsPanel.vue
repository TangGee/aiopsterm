<template>
  <nav class="settings-side-panel">
    <button
      v-for="item in settingsNavItems"
      :key="item.key"
      class="settings-nav-item"
      :class="{ active: isSettingsNavItemActive(item.key) }"
      :data-settings-key="item.key"
      :data-onboarding-id="
        item.key === 'general'
          ? 'settings-side-nav'
          : item.key === 'terminal'
            ? 'settings-terminal-tab'
            : item.key === 'aiRemoteHostManagement'
              ? 'settings-ai-remote-host-management-tab'
              : undefined
      "
      :title="t(item.labelKey)"
      @click="workspace.setActiveSettingsSection(item.key)"
    >
      <component
        :is="item.icon"
        class="settings-nav-icon"
      />
      <span>{{ t(item.labelKey) }}</span>
      <ExternalLink
        v-if="item.external"
        class="settings-nav-external"
      />
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import { settingsNavItems, type SettingSectionKey } from '@/config/settings'
import { useI18n } from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const { t } = useI18n()

const aiAgentSettingsSections = new Set<SettingSectionKey>(['aiRemoteHostManagement', 'mcp', 'skills', 'rules'])
const isSettingsNavItemActive = (key: SettingSectionKey) =>
  workspace.activeSettingsSection === key || (key === 'aiRemoteHostManagement' && aiAgentSettingsSections.has(workspace.activeSettingsSection))
</script>
