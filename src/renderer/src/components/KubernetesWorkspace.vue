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
              <span>{{ tab.name }}</span>
              <button
                title="关闭"
                @click.stop="workspace.closeK8sTerminalTab(tab.id)"
              >
                <X />
              </button>
            </div>
          </div>
          <button
            class="k8s-workspace-button"
            title="新增终端"
            @click="workspace.k8sActiveCluster && workspace.openK8sTerminal(workspace.k8sActiveCluster.id)"
          >
            <Plus />
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
          />
        </form>
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
                />
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
          </header>
          <pre>{{ workspace.k8sResourceOutput }}</pre>
        </aside>
      </div>
    </section>

    <K8sAddClusterModal v-if="workspace.k8sAddModalOpen" />
    <K8sEditClusterModal v-if="workspace.k8sEditModalOpen && editingCluster" />
    <K8sDeleteConfirmModal v-if="workspace.k8sDeleteConfirmCluster" />
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, reactive, ref, watch } from 'vue'
import { ChevronRight, Clipboard, Cloud, FileSearch, FileText, LoaderCircle, Plus, RefreshCw, ScrollText, Search, Terminal, Trash2, X } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import type { K8sConnectionStatus, K8sResourceKind, MockK8sCluster } from '@/data/mockData'

const workspace = useWorkspaceStore()
const command = ref('')
const k8sResourceKinds: Array<{ key: K8sResourceKind; label: string }> = [
  { key: 'pods', label: 'Pods' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'services', label: 'Services' },
  { key: 'nodes', label: 'Nodes' }
]
const detailForm = reactive({
  name: '',
  contextName: '',
  serverUrl: '',
  defaultNamespace: ''
})

const editingCluster = computed(() => workspace.k8sClusters.find((cluster) => cluster.id === workspace.k8sEditingClusterId) || null)

const syncDetailForm = (cluster: MockK8sCluster | null) => {
  if (!cluster) return
  detailForm.name = cluster.name
  detailForm.contextName = cluster.context_name
  detailForm.serverUrl = cluster.server_url
  detailForm.defaultNamespace = cluster.default_namespace || 'default'
}

watch(
  () => workspace.k8sSelectedCluster,
  (cluster) => syncDetailForm(cluster),
  { immediate: true }
)

const jumpserverClusters = (bastionUuid: string) =>
  workspace.filteredK8sClusters.filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)

const sendCommand = () => {
  workspace.sendK8sTerminalCommand(command.value)
  command.value = ''
}

const handleK8sNamespaceChange = (event: Event) => {
  workspace.setK8sResourceNamespace((event.target as HTMLSelectElement).value)
}

const saveDetail = () => {
  const cluster = workspace.k8sSelectedCluster
  if (!cluster) return
  workspace.updateK8sCluster(cluster.id, {
    name: detailForm.name,
    defaultNamespace: detailForm.defaultNamespace
  })
}

const resetDetail = () => syncDetailForm(workspace.k8sSelectedCluster)

const K8sStatusTag = defineComponent({
  name: 'K8sStatusTag',
  props: {
    status: { type: String, required: true }
  },
  setup(props) {
    const label = () => {
      if (props.status === 'connected') return 'Connected'
      if (props.status === 'connecting') return 'Connecting'
      if (props.status === 'error') return 'Error'
      return 'Disconnected'
    }
    return () => h('span', { class: ['k8s-status-tag', props.status] }, label())
  }
})

const K8sAddClusterModal = defineComponent({
  name: 'K8sAddClusterModal',
  setup() {
    const store = useWorkspaceStore()
    const form = reactive({
      kubeconfigPath: '~/.kube/config',
      contextName: store.k8sImportContexts[0]?.name || 'new/context',
      name: store.k8sImportContexts[0]?.cluster || 'new-cluster',
      serverUrl: store.k8sImportContexts[0]?.server || 'https://new.k8s.local:6443',
      defaultNamespace: 'default',
      kubeconfigContent: ''
    })

    const applyContext = (contextName: string) => {
      const context = store.selectK8sImportContext(contextName)
      form.contextName = contextName
      if (!context) return
      form.name = context.cluster
      form.serverUrl = context.server
      form.defaultNamespace = context.namespace || 'default'
    }

    const browseKubeconfig = () => {
      form.kubeconfigPath = '/home/tlinux/.kube/config'
      const context = store.k8sImportContexts[0]
      if (context) applyContext(context.name)
      store.k8sTestResult = null
      store.k8sClusterNotice = '已选择 kubeconfig 文件'
    }

    const switchAddMode = (mode: 'import' | 'manual') => {
      store.k8sAddMode = mode
      store.k8sTestResult = null
      if (mode === 'import') {
        const context = store.k8sImportContexts[0]
        if (context) applyContext(context.name)
        return
      }
      form.contextName = 'new/context'
      form.name = 'new-cluster'
      form.serverUrl = 'https://new.k8s.local:6443'
      form.defaultNamespace = 'default'
      form.kubeconfigContent = ''
    }

    const submit = () => {
      store.addK8sCluster({
        name: form.name,
        contextName: form.contextName,
        serverUrl: form.serverUrl,
        defaultNamespace: form.defaultNamespace,
        kubeconfigPath: store.k8sAddMode === 'import' ? form.kubeconfigPath : null,
        kubeconfigContent: store.k8sAddMode === 'manual' ? form.kubeconfigContent : null
      })
    }

    return () =>
      h('div', { class: 'file-modal' }, [
        h('div', { class: 'file-modal-card k8s-add-cluster-modal' }, [
          h('header', [
            h('strong', '添加集群'),
            h(
              'button',
              {
                title: '关闭',
                onClick: () => {
                  store.k8sAddModalOpen = false
                }
              },
              [h(X)]
            )
          ]),
          h('div', { class: 'k8s-modal-tabs' }, [
            h(
              'button',
              {
                class: { active: store.k8sAddMode === 'import' },
                onClick: () => switchAddMode('import')
              },
              '导入 Kubeconfig'
            ),
            h(
              'button',
              {
                class: { active: store.k8sAddMode === 'manual' },
                onClick: () => switchAddMode('manual')
              },
              '手动配置'
            )
          ]),
          h('div', { class: 'k8s-modal-form' }, [
            store.k8sAddMode === 'import'
              ? h('div', { class: 'k8s-file-picker-row' }, [
                  h('label', [h('span', 'Kubeconfig 文件'), h('input', { value: form.kubeconfigPath, readonly: true })]),
                  h(
                    'button',
                    {
                      title: '浏览',
                      onClick: browseKubeconfig
                    },
                    [h(FileSearch), h('span', '浏览')]
                  )
                ])
              : h('label', [
                  h('span', 'Kubeconfig 内容'),
                  h('textarea', {
                    value: form.kubeconfigContent,
                    rows: 5,
                    onInput: (event: Event) => {
                      form.kubeconfigContent = (event.target as HTMLTextAreaElement).value
                    }
                  })
                ]),
            store.k8sAddMode === 'import' && store.k8sImportContexts.length
              ? h('label', [
                  h('span', 'Context'),
                  h(
                    'select',
                    {
                      value: form.contextName,
                      onChange: (event: Event) => applyContext((event.target as HTMLSelectElement).value)
                    },
                    store.k8sImportContexts.map((context) => h('option', { key: context.name, value: context.name }, `${context.name} (${context.cluster})`))
                  )
                ])
              : null,
            h('label', [
              h('span', '集群名称'),
              h('input', {
                value: form.name,
                onInput: (event: Event) => {
                  form.name = (event.target as HTMLInputElement).value
                }
              })
            ]),
            h('label', [
              h('span', 'Context Name'),
              h('input', {
                value: form.contextName,
                onInput: (event: Event) => {
                  form.contextName = (event.target as HTMLInputElement).value
                }
              })
            ]),
            h('label', [
              h('span', 'Server URL'),
              h('input', {
                value: form.serverUrl,
                onInput: (event: Event) => {
                  form.serverUrl = (event.target as HTMLInputElement).value
                }
              })
            ]),
            h('label', [
              h('span', '默认 Namespace'),
              h('input', {
                value: form.defaultNamespace,
                onInput: (event: Event) => {
                  form.defaultNamespace = (event.target as HTMLInputElement).value
                }
              })
            ])
          ]),
          h('div', { class: 'k8s-test-connection' }, [
            h(
              'button',
              {
                onClick: () => store.testK8sClusterConnection({ contextName: form.contextName, serverUrl: form.serverUrl })
              },
              '测试连接'
            ),
            store.k8sTestResult === null
              ? null
              : h('span', { class: store.k8sTestResult ? 'success' : 'error' }, store.k8sTestResult ? '连接成功' : '连接失败')
          ]),
          h('footer', [h('button', { onClick: () => (store.k8sAddModalOpen = false) }, '取消'), h('button', { class: 'primary', onClick: submit }, '保存')])
        ])
      ])
  }
})

const K8sEditClusterModal = defineComponent({
  name: 'K8sEditClusterModal',
  setup() {
    const store = useWorkspaceStore()
    const cluster = computed(() => store.k8sClusters.find((item) => item.id === store.k8sEditingClusterId) || null)
    const form = reactive({ name: '', defaultNamespace: '', autoConnect: false })
    watch(
      cluster,
      (value) => {
        if (!value) return
        form.name = value.name
        form.defaultNamespace = value.default_namespace
        form.autoConnect = value.auto_connect === 1
      },
      { immediate: true }
    )
    const submit = () => {
      if (!cluster.value) return
      store.updateK8sCluster(cluster.value.id, {
        name: form.name,
        defaultNamespace: form.defaultNamespace,
        autoConnect: form.autoConnect
      })
    }
    return () =>
      cluster.value
        ? h('div', { class: 'file-modal' }, [
            h('div', { class: 'file-modal-card k8s-edit-cluster-modal' }, [
              h('header', [
                h('strong', '集群设置'),
                h(
                  'button',
                  {
                    title: '关闭',
                    onClick: () => {
                      store.k8sEditModalOpen = false
                    }
                  },
                  [h(X)]
                )
              ]),
              h('div', { class: 'k8s-modal-form' }, [
                h('label', [
                  h('span', '集群名称'),
                  h('input', {
                    value: form.name,
                    onInput: (event: Event) => {
                      form.name = (event.target as HTMLInputElement).value
                    }
                  })
                ]),
                h('label', [h('span', 'Context Name'), h('input', { value: cluster.value.context_name, disabled: true })]),
                h('label', [h('span', 'Server URL'), h('input', { value: cluster.value.server_url, disabled: true })]),
                h('label', [
                  h('span', '默认 Namespace'),
                  h('input', {
                    value: form.defaultNamespace,
                    onInput: (event: Event) => {
                      form.defaultNamespace = (event.target as HTMLInputElement).value
                    }
                  })
                ]),
                h('label', { class: 'k8s-switch-row' }, [
                  h('span', '自动连接'),
                  h('input', {
                    type: 'checkbox',
                    checked: form.autoConnect,
                    onInput: (event: Event) => {
                      form.autoConnect = (event.target as HTMLInputElement).checked
                    }
                  })
                ]),
                h('div', { class: 'k8s-form-status' }, [h('span', '连接状态'), h(K8sStatusTag, { status: cluster.value.connection_status as K8sConnectionStatus })])
              ]),
              h('footer', [
                h('button', { onClick: () => (store.k8sEditModalOpen = false) }, '取消'),
                h('button', { class: 'primary', onClick: submit }, '保存')
              ])
            ])
          ])
        : null
  }
})

const K8sDeleteConfirmModal = defineComponent({
  name: 'K8sDeleteConfirmModal',
  setup() {
    const store = useWorkspaceStore()
    return () =>
      store.k8sDeleteConfirmCluster
        ? h('div', { class: 'file-modal' }, [
            h('div', { class: 'file-modal-card small k8s-delete-confirm' }, [
              h('header', [
                h('strong', '删除集群'),
                h(
                  'button',
                  {
                    title: '关闭',
                    onClick: store.cancelDeleteK8sCluster
                  },
                  [h(X)]
                )
              ]),
              h('p', [h('span', '确定删除集群 '), h('strong', store.k8sDeleteConfirmCluster.name), h('span', ' 吗？')]),
              h('p', '关联的 Kubernetes 终端标签和本地 context 记录会一并移除。'),
              h('footer', [
                h('button', { onClick: store.cancelDeleteK8sCluster }, '取消'),
                h('button', { class: 'danger', onClick: store.confirmDeleteK8sCluster }, '删除')
              ])
            ])
          ])
        : null
  }
})
</script>
