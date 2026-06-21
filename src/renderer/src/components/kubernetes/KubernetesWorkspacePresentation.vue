<template>
  <section class="k8s-workspace">
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
        class="empty-state"
      >
        暂无 Kubernetes contexts
      </div>
    </div>

    <div class="k8s-main-grid">
      <section class="k8s-terminal-surface">
        <div class="k8s-terminal-tabs">
          <div class="k8s-tabs-list">
            <div
              v-for="tab in workspace.k8sTerminalTabs"
              :key="tab.id"
              class="k8s-tab-item"
              :class="{ active: tab.id === workspace.k8sActiveTerminalId }"
              @click="workspace.setActiveK8sTerminal(tab.id)"
            >
              <span class="k8s-tab-name">{{ tab.name }}</span>
              <small>{{ tab.namespace }} · {{ tab.status }}</small>
              <button
                title="关闭"
              @click.stop="void workspace.closeK8sTerminalTab(tab.id)"
              >
                <X />
              </button>
            </div>
          </div>
          <button
            class="k8s-workspace-button"
            title="新增终端"
            @click="createTerminalTab"
          >
            <Plus />
          </button>
        </div>
        <div
          v-if="workspace.k8sActiveTerminal"
          class="k8s-terminal-meta"
        >
          <span>Session: {{ workspace.k8sActiveTerminal.sessionId }}</span>
          <span>Namespace: {{ workspace.k8sActiveTerminal.namespace }}</span>
          <span>Size: {{ workspace.k8sActiveTerminal.cols }}x{{ workspace.k8sActiveTerminal.rows }}</span>
          <span>Status: {{ workspace.k8sActiveTerminal.status }}</span>
          <button
            title="同步尺寸"
            @click="syncActiveTerminalSize"
          >
            Resize
          </button>
          <button
            title="采集命令输出到 AI"
            :disabled="workspace.k8sActiveTerminal.status !== 'connected'"
            @click="sendAiCommand"
          >
            AI Command
          </button>
          <button
            title="结束会话"
            :disabled="workspace.k8sActiveTerminal.status === 'ended'"
            @click="void workspace.endK8sTerminalSession(workspace.k8sActiveTerminal.id)"
          >
            End
          </button>
        </div>
        <div class="k8s-terminal-container">
          <pre v-if="workspace.k8sActiveTerminal">{{ workspace.k8sActiveTerminal.output }}</pre>
          <div
            v-else
            class="empty-state"
          >
            选择集群打开 Kubernetes 终端
          </div>
        </div>
        <form
          class="k8s-command-line"
          @submit.prevent="sendCommand"
        >
          <span>$</span>
          <input
            v-model="command"
            placeholder="输入 kubectl 命令"
            :disabled="workspace.k8sActiveTerminal?.status !== 'connected'"
          />
        </form>
        <div
          v-if="workspace.k8sActiveTerminal?.commandHistory.length"
          class="k8s-terminal-history"
        >
          <button
            v-for="history in workspace.k8sActiveTerminal.commandHistory.slice(0, 4)"
            :key="history"
            @click="command = history"
          >
            {{ history }}
          </button>
        </div>
      </section>

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
    </div>

    <section class="k8s-resource-workspace">
      <header class="k8s-resource-header">
        <div>
          <h3>资源概览</h3>
          <p>
            {{ workspace.k8sResourceCluster?.name || '未选择集群' }}
            <span v-if="workspace.k8sResourceCluster">/ {{ workspace.k8sResourceCluster.context_name }}</span>
          </p>
        </div>
        <button
          class="k8s-workspace-button"
          :disabled="workspace.k8sResourceLoading"
          @click="workspace.refreshK8sResources"
        >
          <LoaderCircle v-if="workspace.k8sResourceLoading" />
          <RefreshCw v-else />
          刷新
        </button>
      </header>

      <div class="k8s-agent-bar">
        <div class="k8s-agent-current">
          <strong>Agent</strong>
          <span>{{ workspace.k8sAgentCluster?.name || 'No cluster' }}</span>
          <small>{{ workspace.k8sAgentCurrentCluster.contextName || '-' }}</small>
          <em :class="workspace.k8sAgentStatus">{{ workspace.k8sAgentStatus }}</em>
        </div>
        <select
          :value="workspace.k8sAgentClusterId || ''"
          @change="handleK8sAgentClusterChange"
        >
          <option value="">No cluster</option>
          <option
            v-for="cluster in workspace.k8sClusters"
            :key="cluster.id"
            :value="cluster.id"
          >
            {{ cluster.name }}
          </option>
        </select>
        <button
          :disabled="workspace.k8sAgentTesting"
          @click="workspace.testK8sAgentConnection"
        >
          <LoaderCircle v-if="workspace.k8sAgentTesting" />
          Test
        </button>
        <button @click="workspace.refreshK8sAgentNamespaces">Namespaces</button>
        <form
          class="k8s-agent-command"
          @submit.prevent="runAgentCommand"
        >
          <input
            v-model="workspace.k8sAgentCommandDraft"
            placeholder="kubectl command"
          />
          <button type="submit">Run</button>
        </form>
        <button @click="workspace.cleanupK8sAgent">Cleanup</button>
      </div>

      <div
        v-if="workspace.k8sAgentCommandHistory.length"
        class="k8s-agent-history"
      >
        <button
          v-for="history in workspace.k8sAgentCommandHistory.slice(0, 5)"
          :key="history"
          @click="workspace.k8sAgentCommandDraft = history"
        >
          {{ history }}
        </button>
      </div>

      <div class="k8s-resource-toolbar">
        <label class="k8s-resource-filter">
          <span>Namespace</span>
          <select
            :value="workspace.k8sResourceNamespace"
            :disabled="workspace.k8sResourceKind === 'nodes'"
            @change="handleK8sNamespaceChange"
          >
            <option value="all">All namespaces</option>
            <option
              v-for="namespace in workspace.k8sActiveNamespaces"
              :key="namespace"
              :value="namespace"
            >
              {{ namespace }}
            </option>
          </select>
        </label>

        <div class="k8s-resource-kind-tabs">
          <button
            v-for="kind in k8sResourceKinds"
            :key="kind.key"
            :class="{ active: workspace.k8sResourceKind === kind.key }"
            @click="workspace.setK8sResourceKind(kind.key)"
          >
            {{ kind.label }}
            <span>{{ workspace.k8sResourceSummary[kind.key] }}</span>
          </button>
        </div>

        <label class="k8s-search k8s-resource-search">
          <input
            v-model="workspace.k8sResourceQuery"
            placeholder="搜索资源"
          />
          <Search />
        </label>
      </div>

      <div class="k8s-resource-layout">
        <div class="k8s-resource-table-wrap">
          <table class="k8s-resource-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Namespace</th>
                <th>状态</th>
                <th>Ready / IP</th>
                <th>Node / Ports</th>
                <th>Age</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="resource in workspace.filteredK8sResources"
                :key="resource.id"
              >
                <td>
                  <strong>{{ resource.name }}</strong>
                  <small>{{ resource.detail }}</small>
                </td>
                <td>{{ resource.kind === 'nodes' ? '-' : resource.namespace }}</td>
                <td>
                  <span
                    class="k8s-resource-status"
                    :class="resource.status.toLowerCase()"
                  >
                    {{ resource.status }}
                  </span>
                </td>
                <td>{{ resource.ready }}</td>
                <td>{{ resource.node || resource.ports || resource.selector || '-' }}</td>
                <td>{{ resource.age }}</td>
                <td>
                  <div class="k8s-resource-actions">
                    <button
                      title="Describe"
                      @click="workspace.describeK8sResource(resource.id)"
                    >
                      <FileText />
                    </button>
                    <button
                      title="Logs"
                      :disabled="resource.kind !== 'pods'"
                      @click="workspace.showK8sPodLogs(resource.id)"
                    >
                      <ScrollText />
                    </button>
                    <button
                      title="复制 kubectl 命令"
                      @click="workspace.copyK8sResourceCommand(resource.id, resource.kind === 'pods' ? 'logs' : 'describe')"
                    >
                      <Clipboard />
                    </button>
                    <button
                      title="发送到终端"
                      @click="workspace.sendK8sResourceCommand(resource.id, 'describe')"
                    >
                      <Terminal />
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="workspace.filteredK8sResources.length === 0">
                <td
                  colspan="7"
                  class="k8s-resource-empty"
                >
                  暂无匹配资源
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside class="k8s-resource-output">
          <header>
            <strong>{{ workspace.k8sResourceOutputTitle }}</strong>
            <span v-if="workspace.k8sCopiedCommand">已复制: {{ workspace.k8sCopiedCommand }}</span>
            <div class="k8s-resource-output-actions">
              <button
                title="复制输出"
                @click="workspace.copyK8sResourceOutput"
              >
                <Clipboard />
              </button>
              <button
                title="发送输出命令到终端"
                @click="workspace.sendK8sCurrentOutputToTerminal"
              >
                <Terminal />
              </button>
              <button
                title="发送输出到 AI"
                @click="workspace.sendK8sCurrentOutputToAi"
              >
                <Bot />
              </button>
              <button
                title="清空输出"
                @click="workspace.clearK8sResourceOutput"
              >
                <X />
              </button>
            </div>
          </header>
          <pre>{{ workspace.k8sResourceOutput }}</pre>
        </aside>
      </div>
    </section>

    <K8sAddClusterModal v-if="workspace.k8sAddModalOpen" />
    <K8sEditClusterModal v-if="workspace.k8sEditModalOpen && editingCluster" />
    <K8sProxyConfigModal v-if="workspace.k8sProxyConfigOpen" />
    <K8sDeleteConfirmModal v-if="workspace.k8sDeleteConfirmCluster" />
  </section>
</template>

<script setup lang="ts">
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetesWorkspaceContext'

const {
  workspace,
  command,
  k8sResourceKinds,
  detailForm,
  editingCluster,
  jumpserverClusters,
  createTerminalTab,
  syncActiveTerminalSize,
  sendAiCommand,
  sendCommand,
  handleK8sNamespaceChange,
  handleK8sAgentClusterChange,
  runAgentCommand,
  saveDetail,
  resetDetail,
  K8sStatusTag,
  K8sAddClusterModal,
  K8sEditClusterModal,
  K8sProxyConfigModal,
  K8sDeleteConfirmModal,
  Bot,
  ChevronRight,
  Clipboard,
  Cloud,
  FileText,
  Link,
  LoaderCircle,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  Terminal,
  Trash2,
  Unplug,
  X
} = useKubernetesWorkspaceRuntimeContext()
</script>
