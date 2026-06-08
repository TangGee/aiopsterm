<template>
  <aside
    class="module-panel"
    :class="{
      'module-panel-native':
        workspace.activeModule === 'workspace' ||
        workspace.activeModule === 'assets' ||
        workspace.activeModule === 'files' ||
        workspace.activeModule === 'knowledge' ||
        workspace.activeModule === 'extensions' ||
        workspace.activeModule === 'kubernetes' ||
        workspace.activeModule === 'settings'
    }"
  >
    <WorkspacePanel v-if="workspace.activeModule === 'workspace'" />
    <AssetsPanel
      v-else-if="workspace.activeModule === 'assets'"
      :query="query"
    />
    <FilesPanel v-else-if="workspace.activeModule === 'files'" />
    <KnowledgePanel
      v-else-if="workspace.activeModule === 'knowledge'"
      :query="query"
    />
    <ExtensionsPanel v-else-if="workspace.activeModule === 'extensions'" />
    <KubernetesPanel v-else-if="workspace.activeModule === 'kubernetes'" />
    <SettingsPanel v-else-if="workspace.activeModule === 'settings'" />
    <template v-else>
      <header class="panel-header">
        <div>
          <p class="eyebrow">{{ activeMeta?.label }}</p>
          <h2>{{ title }}</h2>
        </div>
        <button class="compact-button">新建</button>
      </header>

      <div class="panel-search">
        <Search />
        <input
          v-model="query"
          placeholder="搜索"
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
import { useWorkspaceStore } from '@/stores/workspace'
import WorkspacePanel from '@/components/panels/WorkspacePanel.vue'
import AssetsPanel from '@/components/panels/AssetsPanel.vue'
import FilesPanel from '@/components/panels/FilesPanel.vue'
import SnippetsPanel from '@/components/panels/SnippetsPanel.vue'
import KnowledgePanel from '@/components/panels/KnowledgePanel.vue'
import ExtensionsPanel from '@/components/panels/ExtensionsPanel.vue'
import KubernetesPanel from '@/components/panels/KubernetesPanel.vue'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import UserPanel from '@/components/panels/UserPanel.vue'

const workspace = useWorkspaceStore()
const query = ref('')
const activeMeta = computed(() => menuItems.find((item) => item.key === workspace.activeModule))
const title = computed(() => activeMeta.value?.label || '工作区')
</script>
