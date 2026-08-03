<template>
  <section class="k8s-sidebar-container">
    <div class="k8s-manage">
      <label class="k8s-search">
        <input
          :value="workspace.k8sSearchQuery"
          @input="workspace.updateK8sUiState({ searchQuery: ($event.target as HTMLInputElement).value })"
          placeholder="搜索"
          @keydown.esc="workspace.clearK8sSearch"
        />
        <button
          v-if="workspace.k8sSearchQuery"
          class="k8s-search-clear"
          title="清除搜索"
          @click="workspace.clearK8sSearch"
        >
          <X />
        </button>
        <Search />
      </label>
      <button
        class="k8s-workspace-button"
        title="添加集群"
        @click="openAddCluster"
      >
        <Plus />
      </button>
      <button
        class="k8s-workspace-button"
        title="刷新"
        @click="workspace.reloadK8sConfig"
      >
        <RefreshCw />
      </button>
      <button
        class="k8s-workspace-button"
        title="设置"
        @click="openConfig"
      >
        <Settings />
      </button>
    </div>

    <div class="k8s-cluster-list">
      <button
        v-for="cluster in workspace.filteredK8sClusters"
        :key="cluster.id"
        class="k8s-cluster-item"
        :class="{
          active: cluster.id === workspace.k8sActiveClusterId,
          connected: cluster.connection_status === 'connected',
          connecting: workspace.k8sConnectingClusterIds.includes(cluster.id)
        }"
        @click="void workspace.openK8sTerminal(cluster.id)"
      >
        <span class="k8s-cluster-icon">
          <Cloud />
          <i :class="cluster.connection_status"></i>
        </span>
        <span class="k8s-cluster-info">
          <strong>
            <i v-if="cluster.connection_status === 'connected'"></i>
            {{ cluster.name }}
          </strong>
          <small>{{ cluster.context_name }}</small>
        </span>
        <span
          class="k8s-cluster-actions"
          @click.stop
        >
          <button
            title="更多"
            @click="toggleMenu(cluster.id)"
          >
            <LoaderCircle v-if="workspace.k8sConnectingClusterIds.includes(cluster.id)" />
            <MoreHorizontal v-else />
          </button>
          <div
            v-if="workspace.k8sClusterActionMenuId === cluster.id"
            class="k8s-cluster-menu"
          >
            <button
              v-if="cluster.connection_status !== 'connected'"
              :disabled="workspace.k8sConnectingClusterIds.includes(cluster.id)"
              @click="workspace.connectK8sCluster(cluster.id)"
            >
              <Link />
              <span>{{ workspace.k8sConnectingClusterIds.includes(cluster.id) ? '连接中' : '连接' }}</span>
            </button>
            <button
              v-else
              @click="workspace.disconnectK8sCluster(cluster.id)"
            >
              <Unplug />
              <span>断开</span>
            </button>
            <button @click="openEdit(cluster.id)">
              <Pencil />
              <span>编辑</span>
            </button>
            <button
              class="danger"
              @click="workspace.requestDeleteK8sCluster(cluster.id)"
            >
              <Trash2 />
              <span>删除</span>
            </button>
          </div>
        </span>
      </button>

      <div
        v-if="workspace.filteredK8sClusters.length === 0"
        class="empty-state"
      >
        暂无集群
      </div>
    </div>

    <div
      v-if="workspace.k8sClusterNotice"
      class="k8s-notice"
    >
      {{ workspace.k8sClusterNotice }}
    </div>

  </section>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Cloud, Link, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings, Trash2, Unplug, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

onMounted(() => {
  void workspace.refreshKubernetesCatalog()
})

const openAddCluster = () => {
  workspace.updateK8sUiState({ addMode: 'import', testResult: null, addModalOpen: true })
}

const openConfig = () => {
  workspace.updateK8sUiState({
    selectedClusterId: workspace.k8sSelectedClusterId || workspace.filteredK8sClusters[0]?.id || null,
    configTab: 'local'
  })
  workspace.setActiveModule('kubernetes')
}

const toggleMenu = (clusterId: string) => {
  workspace.setK8sActionMenu(workspace.k8sClusterActionMenuId === clusterId ? null : clusterId)
}

const openEdit = (clusterId: string) => {
  workspace.setK8sActionMenu(null)
  workspace.updateK8sUiState({ editingClusterId: clusterId, editModalOpen: true })
}
</script>
