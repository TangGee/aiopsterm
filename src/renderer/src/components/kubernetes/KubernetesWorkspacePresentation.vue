<template>
  <section
    class="k8s-workspace"
    data-ui-focus-scope="kubernetes"
    data-ui-focus-primary
    tabindex="-1"
  >
    <KubernetesContextStrip />
    <div class="k8s-main-grid">
      <KubernetesTerminalSurface />
      <KubernetesClusterConfigPanel />
    </div>
    <KubernetesResourceWorkspace />
    <KubernetesWorkspaceOverlays />
  </section>
</template>

<script setup lang="ts">
import KubernetesClusterConfigPanel from '@/components/kubernetes/KubernetesClusterConfigPanel.vue'
import KubernetesContextStrip from '@/components/kubernetes/KubernetesContextStrip.vue'
import KubernetesResourceWorkspace from '@/components/kubernetes/KubernetesResourceWorkspace.vue'
import KubernetesTerminalSurface from '@/components/kubernetes/KubernetesTerminalSurface.vue'
import KubernetesWorkspaceOverlays from '@/components/kubernetes/KubernetesWorkspaceOverlays.vue'
</script>
