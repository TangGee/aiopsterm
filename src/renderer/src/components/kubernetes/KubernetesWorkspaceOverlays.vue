<template>
  <K8sAddClusterModal v-if="workspace.k8sAddModalOpen" />
  <K8sEditClusterModal v-if="workspace.k8sEditModalOpen && editingCluster" />
  <K8sProxyConfigModal v-if="workspace.k8sProxyConfigOpen" />
  <K8sDeleteConfirmModal v-if="workspace.k8sDeleteConfirmCluster" />
</template>

<script setup lang="ts">
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetesWorkspaceContext'

const { workspace, editingCluster, K8sAddClusterModal, K8sEditClusterModal, K8sProxyConfigModal, K8sDeleteConfirmModal } = useKubernetesWorkspaceRuntimeContext()
</script>
