<template>
  <KubernetesWorkspacePresentation />
</template>

<script setup lang="ts">
import KubernetesWorkspacePresentation from '@/components/kubernetes/KubernetesWorkspacePresentation.vue'
import { provideKubernetesWorkspaceRuntime } from '@/services/kubernetesWorkspaceContext'
import { useKubernetesWorkspaceRuntime } from '@/services/kubernetesWorkspaceRuntime'

provideKubernetesWorkspaceRuntime(useKubernetesWorkspaceRuntime())
</script>
