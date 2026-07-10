<template>
  <aside
    class="module-panel"
    :class="{
      'module-panel-native':
        workspace.activeModule === 'workspace' ||
        workspace.activeModule === 'aiSessions' ||
        workspace.activeModule === 'assets' ||
        workspace.activeModule === 'files' ||
        workspace.activeModule === 'knowledge' ||
        workspace.activeModule === 'extensions' ||
        workspace.activeModule === 'kubernetes' ||
        workspace.activeModule === 'settings'
    }"
  >
    <WorkspacePanel v-if="workspace.activeModule === 'workspace'" />
    <KeepAlive>
      <AiSessionsPanel v-if="workspace.activeModule === 'aiSessions'" />
    </KeepAlive>
    <AssetsPanel
      v-if="workspace.activeModule === 'assets'"
      :query="query"
    />
    <FilesPanel v-if="workspace.activeModule === 'files'" />
    <KnowledgePanel
      v-if="workspace.activeModule === 'knowledge'"
      :query="query"
    />
    <ExtensionsPanel v-if="workspace.activeModule === 'extensions'" />
    <KubernetesPanel v-if="workspace.activeModule === 'kubernetes'" />
    <SettingsPanel v-if="workspace.activeModule === 'settings'" />
    <template v-if="fallbackPanelVisible">
      <header class="panel-header">
        <div>
          <p class="eyebrow">{{ activeMeta ? t(activeMeta.labelKey) : '' }}</p>
          <h2>{{ title }}</h2>
        </div>
        <button class="compact-button">{{ t('common.new') }}</button>
      </header>

      <div class="panel-search">
        <Search />
        <input
          v-model="query"
          :placeholder="t('common.search')"
        />
      </div>

      <SnippetsPanel v-if="workspace.activeModule === 'snippets'" />
      <UserPanel v-else />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from 'lucide-vue-next'
import { menuItems } from '@/config/navigation'
import { useI18n } from '@/i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import WorkspacePanel from '@/components/panels/WorkspacePanel.vue'
import AiSessionsPanel from '@/components/panels/AiSessionsPanel.vue'
import AssetsPanel from '@/components/panels/AssetsPanel.vue'
import FilesPanel from '@/components/panels/FilesPanel.vue'
import SnippetsPanel from '@/components/panels/SnippetsPanel.vue'
import KnowledgePanel from '@/components/panels/KnowledgePanel.vue'
import ExtensionsPanel from '@/components/panels/ExtensionsPanel.vue'
import KubernetesPanel from '@/components/panels/KubernetesPanel.vue'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import UserPanel from '@/components/panels/UserPanel.vue'

const workspace = useWorkspaceStore()
const { t } = useI18n()
const query = ref('')
const activeMeta = computed(() => menuItems.find((item) => item.key === workspace.activeModule))
const title = computed(() => (activeMeta.value ? t(activeMeta.value.labelKey) : t('module.workspace')))
const nativePanelModules = new Set(['workspace', 'aiSessions', 'assets', 'files', 'knowledge', 'extensions', 'kubernetes', 'settings'])
const fallbackPanelVisible = computed(() => !nativePanelModules.has(workspace.activeModule))
</script>
