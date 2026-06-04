<template>
  <section class="k8s-sidebar-container">
    <div class="k8s-manage">
      <label class="k8s-search">
        <input
          v-model="workspace.k8sSearchQuery"
          placeholder="搜索"
        />
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
          connecting: cluster.connection_status === 'connecting'
        }"
        @click="workspace.openK8sTerminal(cluster.id)"
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
              <span>{{ cluster.connection_status === 'connecting' ? '连接中' : '连接' }}</span>
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

    <div
      v-if="workspace.k8sDeleteConfirmCluster"
      class="file-modal"
    >
      <div class="file-modal-card small k8s-delete-confirm">
        <header>
          <strong>删除集群</strong>
          <button
            title="关闭"
            @click="workspace.cancelDeleteK8sCluster"
          >
            ×
          </button>
        </header>
        <p>
          确定删除集群 <strong>{{ workspace.k8sDeleteConfirmCluster.name }}</strong> 吗？
        </p>
        <p>关联的 Kubernetes 终端标签和本地 context 记录会一并移除。</p>
        <footer>
          <button @click="workspace.cancelDeleteK8sCluster">取消</button>
          <button
            class="danger"
            @click="workspace.confirmDeleteK8sCluster"
          >
            删除
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Cloud, Link, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings, Trash2, Unplug } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()

const openAddCluster = () => {
  workspace.k8sAddMode = 'import'
  workspace.k8sTestResult = null
  workspace.k8sAddModalOpen = true
}

const openConfig = () => {
  workspace.k8sSelectedClusterId = workspace.k8sSelectedClusterId || workspace.filteredK8sClusters[0]?.id || null
  workspace.k8sConfigTab = 'local'
}

const toggleMenu = (clusterId: string) => {
  workspace.setK8sActionMenu(workspace.k8sClusterActionMenuId === clusterId ? null : clusterId)
}

const openEdit = (clusterId: string) => {
  workspace.setK8sActionMenu(null)
  workspace.k8sEditingClusterId = clusterId
  workspace.k8sEditModalOpen = true
}
</script>
