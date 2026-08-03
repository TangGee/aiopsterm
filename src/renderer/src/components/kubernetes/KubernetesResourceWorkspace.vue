<template>
  <section class="k8s-resource-workspace">
    <header class="k8s-resource-header">
      <div>
        <h3>资源概览</h3>
        <p>
          {{ workspace.k8sResourceCluster?.name || '未选择集群' }}
          <span v-if="workspace.k8sResourceCluster">/ {{ workspace.k8sResourceCluster.context_name }}</span>
        </p>
      </div>
      <div class="k8s-resource-header-actions">
        <button
          class="k8s-workspace-button"
          :class="{ active: outputOpen }"
          :aria-expanded="outputOpen"
          @click="outputOpen = !outputOpen"
        >
          输出
        </button>
        <button
          class="k8s-workspace-button"
          :disabled="workspace.k8sResourceLoading"
          @click="workspace.refreshK8sResources"
        >
          <LoaderCircle v-if="workspace.k8sResourceLoading" />
          <RefreshCw v-else />
          刷新
        </button>
      </div>
    </header>

    <div class="k8s-agent-bar">
      <div class="k8s-agent-current">
        <strong>Agent</strong>
        <span>{{ workspace.k8sAgentCluster?.name || '未选择集群' }}</span>
        <small>{{ workspace.k8sAgentCurrentCluster.contextName || '-' }}</small>
        <em :class="workspace.k8sAgentStatus">{{ agentStatusLabels[workspace.k8sAgentStatus] }}</em>
      </div>
      <select
        :value="workspace.k8sAgentClusterId || ''"
        @change="handleK8sAgentClusterChange"
      >
        <option value="">未选择集群</option>
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
        测试
      </button>
      <button @click="workspace.refreshK8sAgentNamespaces">命名空间</button>
      <form
        class="k8s-agent-command"
        @submit.prevent="runAgentCommand"
      >
        <input
          :value="workspace.k8sAgentCommandDraft"
          @input="workspace.updateK8sUiState({ agentCommandDraft: ($event.target as HTMLInputElement).value })"
          placeholder="输入 kubectl 命令"
        />
        <button type="submit">执行</button>
      </form>
      <button @click="workspace.cleanupK8sAgent">清理</button>
    </div>

    <div
      v-if="workspace.k8sAgentCommandHistory.length"
      class="k8s-agent-history"
    >
      <button
        v-for="history in workspace.k8sAgentCommandHistory.slice(0, 5)"
        :key="history"
        @click="workspace.updateK8sUiState({ agentCommandDraft: history })"
      >
        {{ history }}
      </button>
    </div>

    <div class="k8s-resource-toolbar">
      <label class="k8s-resource-filter">
        <span>命名空间</span>
        <select
          :value="workspace.k8sResourceNamespace"
          :disabled="workspace.k8sResourceKind === 'nodes'"
          @change="handleK8sNamespaceChange"
        >
          <option value="all">全部命名空间</option>
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
          :value="workspace.k8sResourceQuery"
          @input="workspace.updateK8sUiState({ resourceQuery: ($event.target as HTMLInputElement).value })"
          placeholder="搜索资源"
        />
        <Search />
      </label>
    </div>

    <div
      class="k8s-resource-layout"
      :class="{ 'output-open': outputOpen }"
    >
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

      <aside
        v-if="outputOpen"
        class="k8s-resource-output"
      >
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
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useKubernetesWorkspaceRuntimeContext } from '@/services/kubernetes/kubernetesWorkspaceContext'

const {
  workspace,
  k8sResourceKinds,
  handleK8sNamespaceChange,
  handleK8sAgentClusterChange,
  runAgentCommand,
  Bot,
  Clipboard,
  FileText,
  LoaderCircle,
  RefreshCw,
  ScrollText,
  Search,
  Terminal,
  X
} = useKubernetesWorkspaceRuntimeContext()

const outputOpen = ref(workspace.k8sResourceOutputTitle !== '资源输出')
const agentStatusLabels = {
  idle: '空闲',
  ready: '就绪',
  running: '运行中',
  error: '错误'
} as const

watch(
  () => workspace.k8sResourceOutputTitle,
  (title) => {
    outputOpen.value = title !== '资源输出'
  }
)
</script>
