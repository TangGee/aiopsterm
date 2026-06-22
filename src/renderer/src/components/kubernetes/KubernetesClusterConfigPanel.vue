<template>
  <section class="k8s-cluster-config-container">
    <div class="k8s-split-layout">
      <div class="k8s-left-section">
        <div class="k8s-tab-bar">
          <button
            :class="{ active: workspace.k8sConfigTab === 'local' }"
            @click="workspace.k8sConfigTab = 'local'"
          >
            本地集群
          </button>
          <button
            :class="{ active: workspace.k8sConfigTab === 'jumpserver' }"
            @click="workspace.k8sConfigTab = 'jumpserver'"
          >
            堡垒机资源
          </button>
        </div>

        <div class="k8s-search-header">
          <label class="k8s-search">
            <input
              v-model="workspace.k8sSearchQuery"
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
            v-if="workspace.k8sConfigTab === 'local'"
            class="k8s-action-button"
            @click="workspace.k8sAddModalOpen = true"
          >
            <Plus />
            添加集群
          </button>
        </div>

        <div
          v-if="workspace.k8sConfigTab === 'local'"
          class="k8s-config-list"
        >
          <button
            v-for="cluster in workspace.localK8sClusters"
            :key="cluster.id"
            class="k8s-config-cluster-item"
            :class="{ active: cluster.id === workspace.k8sSelectedClusterId }"
            @click="workspace.selectK8sCluster(cluster.id)"
          >
            <Cloud />
            <span>
              <strong>
                {{ cluster.name }}
                <em v-if="cluster.is_active === 1">Active</em>
              </strong>
              <small>{{ cluster.server_url }}</small>
            </span>
            <K8sStatusTag :status="cluster.connection_status" />
          </button>
          <div
            v-if="workspace.localK8sClusters.length === 0"
            class="empty-state"
          >
            暂无本地集群
          </div>
        </div>

        <div
          v-else
          class="k8s-config-list"
        >
          <div
            v-for="bastion in workspace.filteredK8sBastions"
            :key="bastion.uuid"
            class="k8s-cluster-group"
          >
            <div
              class="k8s-group-header"
              @click="workspace.toggleK8sBastionCollapsed(bastion.uuid)"
            >
              <ChevronRight :class="{ expanded: !workspace.k8sCollapsedBastionIds.includes(bastion.uuid) }" />
              <span>
                <strong>{{ bastion.label }}</strong>
                <small>{{ bastion.ip }}</small>
              </span>
              <button
                title="同步"
                :disabled="workspace.k8sSyncingBastionIds.includes(bastion.uuid)"
                @click.stop="workspace.syncK8sBastion(bastion.uuid)"
              >
                <LoaderCircle v-if="workspace.k8sSyncingBastionIds.includes(bastion.uuid)" />
                <RefreshCw v-else />
              </button>
            </div>
            <div v-if="!workspace.k8sCollapsedBastionIds.includes(bastion.uuid)">
              <button
                v-for="cluster in jumpserverClusters(bastion.uuid)"
                :key="cluster.id"
                class="k8s-config-cluster-item jumpserver"
                :class="{ active: cluster.id === workspace.k8sSelectedClusterId }"
                @click="workspace.selectK8sCluster(cluster.id)"
              >
                <Cloud />
                <span>
                  <strong>{{ cluster.name }}</strong>
                  <small>{{ cluster.server_url }}</small>
                </span>
                <K8sStatusTag :status="cluster.connection_status" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        class="k8s-right-section"
        :class="{ collapsed: !workspace.k8sSelectedCluster }"
      >
        <div
          v-if="workspace.k8sSelectedCluster"
          class="k8s-cluster-detail"
        >
          <header>
            <h3>{{ workspace.k8sSelectedCluster.name }}</h3>
            <button @click="workspace.selectK8sCluster(null)">
              <X />
            </button>
          </header>

          <div class="k8s-detail-form">
            <label>
              <span>集群名称</span>
              <input
                v-model="detailForm.name"
                :disabled="workspace.k8sSelectedCluster.source_type === 'jumpserver'"
              />
            </label>
            <label>
              <span>Context Name</span>
              <input
                v-model="detailForm.contextName"
                disabled
              />
            </label>
            <label>
              <span>Server URL</span>
              <input
                v-model="detailForm.serverUrl"
                disabled
              />
            </label>
            <label v-if="workspace.k8sSelectedCluster.source_type !== 'jumpserver'">
              <span>默认 Namespace</span>
              <input v-model="detailForm.defaultNamespace" />
            </label>
            <div class="k8s-form-status">
              <span>连接状态</span>
              <K8sStatusTag :status="workspace.k8sSelectedCluster.connection_status" />
            </div>
            <div class="k8s-form-actions inline">
              <button
                v-if="workspace.k8sSelectedCluster.connection_status !== 'connected'"
                :disabled="workspace.k8sConnectingClusterIds.includes(workspace.k8sSelectedCluster.id)"
                @click="workspace.connectK8sCluster(workspace.k8sSelectedCluster.id)"
              >
                <LoaderCircle v-if="workspace.k8sConnectingClusterIds.includes(workspace.k8sSelectedCluster.id)" />
                <Link v-else />
                {{ workspace.k8sConnectingClusterIds.includes(workspace.k8sSelectedCluster.id) ? '连接中' : '连接' }}
              </button>
              <button
                v-else
                @click="workspace.disconnectK8sCluster(workspace.k8sSelectedCluster.id)"
              >
                <Unplug />
                断开
              </button>
              <button @click="void workspace.openK8sTerminal(workspace.k8sSelectedCluster.id)">
                <Terminal />
                打开终端
              </button>
              <button @click="workspace.openK8sProxyConfig">
                <Settings />
                Agent 代理
              </button>
            </div>
            <div
              v-if="workspace.k8sSelectedCluster.source_type !== 'jumpserver'"
              class="k8s-form-actions"
            >
              <button
                class="primary"
                @click="saveDetail"
              >
                保存
              </button>
              <button @click="resetDetail">重置</button>
            </div>
          </div>

          <div class="k8s-danger-zone">
            <div>
              <h4>危险区域</h4>
              <p>删除这个集群，此操作不可撤销。</p>
            </div>
            <button
              title="删除"
              @click="workspace.requestDeleteK8sCluster(workspace.k8sSelectedCluster.id)"
            >
              <Trash2 />
            </button>
          </div>
        </div>
        <div
          v-else
          class="empty-state"
        >
          选择集群查看和编辑详情
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetesWorkspaceContext'

const {
  workspace,
  detailForm,
  jumpserverClusters,
  saveDetail,
  resetDetail,
  K8sStatusTag,
  ChevronRight,
  Cloud,
  Link,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  Unplug,
  X
} = useKubernetesWorkspaceRuntimeContext()
</script>
