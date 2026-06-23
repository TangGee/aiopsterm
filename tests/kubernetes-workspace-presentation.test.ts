import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import KubernetesWorkspacePresentation from '@/components/kubernetes/KubernetesWorkspacePresentation.vue'
import { provideKubernetesWorkspaceRuntime } from '@/services/kubernetes/kubernetesWorkspaceContext'

const runtime = () => ({
  workspace: {
    reloadK8sConfig: vi.fn(),
    k8sHasContexts: true,
    k8sContexts: [{ name: 'prod/admin', cluster: 'prod-cluster', namespace: 'default', server: 'https://prod.k8s.local:6443', isActive: true }],
    switchK8sContext: vi.fn(),
    k8sTerminalTabs: [],
    k8sActiveTerminalId: null,
    setActiveK8sTerminal: vi.fn(),
    closeK8sTerminalTab: vi.fn(),
    k8sActiveTerminal: null,
    endK8sTerminalSession: vi.fn(),
    k8sConfigTab: 'local',
    k8sSearchQuery: '',
    clearK8sSearch: vi.fn(),
    k8sAddModalOpen: false,
    localK8sClusters: [],
    filteredK8sBastions: [],
    k8sCollapsedBastionIds: [],
    k8sSyncingBastionIds: [],
    syncK8sBastion: vi.fn(),
    k8sSelectedClusterId: null,
    selectK8sCluster: vi.fn(),
    k8sSelectedCluster: null,
    k8sConnectingClusterIds: [],
    connectK8sCluster: vi.fn(),
    disconnectK8sCluster: vi.fn(),
    openK8sTerminal: vi.fn(),
    openK8sProxyConfig: vi.fn(),
    requestDeleteK8sCluster: vi.fn(),
    k8sResourceCluster: null,
    k8sResourceLoading: false,
    refreshK8sResources: vi.fn(),
    k8sAgentCluster: null,
    k8sAgentCurrentCluster: { contextName: '' },
    k8sAgentStatus: 'idle',
    k8sAgentClusterId: null,
    k8sClusters: [],
    k8sAgentTesting: false,
    testK8sAgentConnection: vi.fn(),
    refreshK8sAgentNamespaces: vi.fn(),
    k8sAgentCommandDraft: '',
    cleanupK8sAgent: vi.fn(),
    k8sAgentCommandHistory: [],
    k8sResourceNamespace: 'all',
    k8sResourceKind: 'pods',
    k8sActiveNamespaces: [],
    setK8sResourceKind: vi.fn(),
    k8sResourceSummary: { pods: 0, deployments: 0, services: 0, nodes: 0 },
    k8sResourceQuery: '',
    filteredK8sResources: [],
    k8sResourceOutputTitle: '资源输出',
    k8sCopiedCommand: '',
    copyK8sResourceOutput: vi.fn(),
    sendK8sCurrentOutputToTerminal: vi.fn(),
    sendK8sCurrentOutputToAi: vi.fn(),
    clearK8sResourceOutput: vi.fn(),
    k8sResourceOutput: '',
    k8sEditModalOpen: false,
    k8sProxyConfigOpen: false,
    k8sDeleteConfirmCluster: null
  },
  command: ref(''),
  k8sResourceKinds: [
    { key: 'pods', label: 'Pods' },
    { key: 'deployments', label: 'Deployments' },
    { key: 'services', label: 'Services' },
    { key: 'nodes', label: 'Nodes' }
  ],
  detailForm: { name: '', contextName: '', serverUrl: '', defaultNamespace: '' },
  editingCluster: ref(null),
  jumpserverClusters: vi.fn(() => []),
  createTerminalTab: vi.fn(),
  syncActiveTerminalSize: vi.fn(),
  sendAiCommand: vi.fn(),
  sendCommand: vi.fn(),
  handleK8sNamespaceChange: vi.fn(),
  handleK8sAgentClusterChange: vi.fn(),
  runAgentCommand: vi.fn(),
  saveDetail: vi.fn(),
  resetDetail: vi.fn(),
  K8sStatusTag: defineComponent({ name: 'K8sStatusTag', setup: () => () => h('span') }),
  K8sAddClusterModal: defineComponent({ name: 'K8sAddClusterModal', setup: () => () => h('div') }),
  K8sEditClusterModal: defineComponent({ name: 'K8sEditClusterModal', setup: () => () => h('div') }),
  K8sProxyConfigModal: defineComponent({ name: 'K8sProxyConfigModal', setup: () => () => h('div') }),
  K8sDeleteConfirmModal: defineComponent({ name: 'K8sDeleteConfirmModal', setup: () => () => h('div') }),
  Bot: defineComponent({ name: 'Bot', setup: () => () => h('svg') }),
  ChevronRight: defineComponent({ name: 'ChevronRight', setup: () => () => h('svg') }),
  Clipboard: defineComponent({ name: 'Clipboard', setup: () => () => h('svg') }),
  Cloud: defineComponent({ name: 'Cloud', setup: () => () => h('svg') }),
  FileText: defineComponent({ name: 'FileText', setup: () => () => h('svg') }),
  Link: defineComponent({ name: 'Link', setup: () => () => h('svg') }),
  LoaderCircle: defineComponent({ name: 'LoaderCircle', setup: () => () => h('svg') }),
  Plus: defineComponent({ name: 'Plus', setup: () => () => h('svg') }),
  RefreshCw: defineComponent({ name: 'RefreshCw', setup: () => () => h('svg') }),
  ScrollText: defineComponent({ name: 'ScrollText', setup: () => () => h('svg') }),
  Search: defineComponent({ name: 'Search', setup: () => () => h('svg') }),
  Settings: defineComponent({ name: 'Settings', setup: () => () => h('svg') }),
  Terminal: defineComponent({ name: 'Terminal', setup: () => () => h('svg') }),
  Trash2: defineComponent({ name: 'Trash2', setup: () => () => h('svg') }),
  Unplug: defineComponent({ name: 'Unplug', setup: () => () => h('svg') }),
  X: defineComponent({ name: 'X', setup: () => () => h('svg') })
})

describe('KubernetesWorkspacePresentation', () => {
  it('composes Kubernetes workspace subdomain presenters through the shared runtime context', () => {
    const Harness = defineComponent({
      setup() {
        provideKubernetesWorkspaceRuntime(runtime() as any)
        return () => h(KubernetesWorkspacePresentation)
      }
    })

    const wrapper = mount(Harness)

    expect(wrapper.findComponent({ name: 'KubernetesContextStrip' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'KubernetesTerminalSurface' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'KubernetesClusterConfigPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'KubernetesResourceWorkspace' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'KubernetesWorkspaceOverlays' }).exists()).toBe(true)
    expect(wrapper.find('.k8s-context-strip').text()).toContain('prod/admin')
    expect(wrapper.find('.k8s-terminal-surface').exists()).toBe(true)
    expect(wrapper.find('.k8s-cluster-config-container').exists()).toBe(true)
    expect(wrapper.find('.k8s-resource-workspace').text()).toContain('资源概览')
  })
})
