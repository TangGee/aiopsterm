import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { KubernetesClusterRecord, KubernetesResourceKind } from '@shared/contracts/kubernetes'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

export const k8sResourceKinds: Array<{ key: KubernetesResourceKind; label: string }> = [
  { key: 'pods', label: 'Pods' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'services', label: 'Services' },
  { key: 'nodes', label: 'Nodes' }
]

export const useKubernetesWorkspaceInteractionRuntime = (workspace: WorkspaceStore) => {
  const command = ref('')
  const detailForm = reactive({
    name: '',
    contextName: '',
    serverUrl: '',
    defaultNamespace: ''
  })

  const editingCluster = computed(() => workspace.k8sClusters.find((cluster) => cluster.id === workspace.k8sEditingClusterId) || null)

  const syncDetailForm = (cluster: KubernetesClusterRecord | null) => {
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

  onMounted(() => {
    void workspace.refreshKubernetesCatalog()
  })

  const jumpserverClusters = (bastionUuid: string) =>
    workspace.filteredK8sClusters.filter((cluster) => cluster.source_type === 'jumpserver' && cluster.bastion_uuid === bastionUuid)

  const createTerminalTab = () => {
    void workspace.createNewK8sTerminalTab()
  }

  const syncActiveTerminalSize = () => {
    const terminal = workspace.k8sActiveTerminal
    if (!terminal) return
    void workspace.resizeK8sTerminal(terminal.id, terminal.cols + 8, terminal.rows + 2)
  }

  const sendAiCommand = () => {
    const terminal = workspace.k8sActiveTerminal
    if (!terminal) return
    const text = command.value.trim() || terminal.lastCommand
    void workspace.executeK8sTerminalAiCommand(text, terminal.id)
    command.value = ''
  }

  const sendCommand = () => {
    workspace.sendK8sTerminalCommand(command.value)
    command.value = ''
  }

  const handleK8sNamespaceChange = (event: Event) => {
    workspace.setK8sResourceNamespace((event.target as HTMLSelectElement).value)
  }

  const handleK8sAgentClusterChange = (event: Event) => {
    workspace.setK8sAgentCluster((event.target as HTMLSelectElement).value || null)
  }

  const runAgentCommand = () => {
    workspace.runK8sAgentKubectl()
  }

  const saveDetail = async () => {
    const cluster = workspace.k8sSelectedCluster
    if (!cluster) return
    await workspace.updateK8sCluster(cluster.id, {
      name: detailForm.name,
      defaultNamespace: detailForm.defaultNamespace
    })
  }

  const resetDetail = () => syncDetailForm(workspace.k8sSelectedCluster)

  return {
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
    resetDetail
  }
}
