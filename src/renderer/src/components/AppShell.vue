<template>
  <div class="app-shell">
    <TopBar />
    <main
      class="app-body"
      :class="[`mode-${workspace.mode}`, `module-${workspace.activeModule}`]"
    >
      <template v-if="workspace.mode === 'agents'">
        <AgentsSidebar v-if="workspace.agentsLeftOpen" />
        <section class="agents-stage">
          <AiPanel agent-mode />
        </section>
      </template>

      <template v-else>
        <SideRail />
        <div
          v-if="workspace.isLeftVisible && workspace.activeModule !== 'settings' && workspace.activeModule !== 'database' && workspace.activeModule !== 'user'"
          data-onboarding-id="left-function-panel"
        >
          <ModulePanel />
        </div>
        <FilesWorkspace v-if="workspace.activeModule === 'files'" />
        <ExtensionsWorkspace v-else-if="workspace.activeModule === 'extensions'" />
        <KubernetesWorkspace v-else-if="workspace.activeModule === 'kubernetes'" />
        <SettingsWorkspace v-else-if="workspace.activeModule === 'settings'" />
        <UserPanel v-else-if="workspace.activeModule === 'user'" />
        <TerminalWorkspace v-else-if="workspace.activeModule !== 'database'" />
        <DatabaseWorkspace v-else />
        <div
          v-if="workspace.isRightVisible && workspace.activeModule !== 'database' && workspace.activeModule !== 'user'"
          data-onboarding-id="right-ai-sidebar"
        >
          <AiPanel />
        </div>
        <OnboardingSpotlight />
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import TopBar from '@/components/TopBar.vue'
import SideRail from '@/components/SideRail.vue'
import ModulePanel from '@/components/ModulePanel.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import AiPanel from '@/components/AiPanel.vue'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import UserPanel from '@/components/panels/UserPanel.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

onMounted(() => {
  workspace.hydrateConfig()
})
</script>
