<template>
  <div class="k8s-context-strip">
    <header>
      <h2>Kubernetes</h2>
      <button
        class="k8s-workspace-button"
        @click="workspace.reloadK8sConfig"
      >
        <RefreshCw />
        刷新
      </button>
    </header>
    <div
      v-if="workspace.k8sHasContexts"
      class="k8s-contexts-list"
    >
      <button
        v-for="context in workspace.k8sContexts"
        :key="context.name"
        class="k8s-context-item"
        :class="{ active: context.isActive }"
        @click="!context.isActive && workspace.switchK8sContext(context.name)"
      >
        <strong>
          {{ context.name }}
          <span v-if="context.isActive">Active</span>
        </strong>
        <small>Cluster: {{ context.cluster }}</small>
        <small>Namespace: {{ context.namespace }}</small>
        <small>Server: {{ context.server }}</small>
      </button>
    </div>
    <div
      v-else
      class="k8s-context-empty"
    >
      <span>尚未添加 Kubernetes 集群</span>
      <button
        class="k8s-workspace-button"
        @click="workspace.k8sAddModalOpen = true"
      >
        <Plus />
        添加集群
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetes/kubernetesWorkspaceContext'

const { workspace, Plus, RefreshCw } = useKubernetesWorkspaceRuntimeContext()
</script>
