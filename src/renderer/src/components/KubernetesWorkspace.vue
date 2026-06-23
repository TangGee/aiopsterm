<template>
  <KubernetesWorkspacePresentation />
</template>

<script setup lang="ts">
import KubernetesWorkspacePresentation from '@/components/kubernetes/KubernetesWorkspacePresentation.vue'
import { provideKubernetesWorkspaceRuntime } from '@/services/kubernetes/kubernetesWorkspaceContext'
import { useKubernetesWorkspaceRuntime } from '@/services/kubernetes/kubernetesWorkspaceRuntime'

provideKubernetesWorkspaceRuntime(useKubernetesWorkspaceRuntime())
</script>
