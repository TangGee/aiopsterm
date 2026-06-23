import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { useKubernetesWorkspaceInteractionRuntime } from '@/services/kubernetes/kubernetesWorkspaceInteractionRuntime'
import type { useWorkspaceStore } from '@/stores/workspace'
import type { KubernetesClusterRecord } from '@shared/contracts/kubernetes'

type WorkspaceStore = ReturnType<typeof useWorkspaceStore>

const cluster = (input: Partial<KubernetesClusterRecord> & Pick<KubernetesClusterRecord, 'id' | 'name'>): KubernetesClusterRecord => ({
  kubeconfig_path: null,
  kubeconfig_content: null,
  context_name: input.id,
  server_url: `https://${input.id}.k8s.local:6443`,
  auth_type: 'kubeconfig',
  is_active: 1,
  connection_status: 'connected',
  auto_connect: 0,
  default_namespace: 'default',
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
  source_type: 'local',
  bastion_uuid: null,
  bastion_asset_address: null,
  bastion_asset_name: null,
  bastion_asset_id_last: null,
  ...input
})

const createWorkspace = () => {
  const prodCluster = cluster({ id: 'prod', name: 'Production', context_name: 'prod/admin', default_namespace: 'ops' })
  const jumpCluster = cluster({
    id: 'jump-prod',
    name: 'Jump Production',
    context_name: 'jump/prod',
    source_type: 'jumpserver',
    bastion_uuid: 'bastion-1'
  })

  return reactive({
    k8sClusters: [prodCluster, jumpCluster],
    filteredK8sClusters: [prodCluster, jumpCluster],
    k8sEditingClusterId: 'prod',
    k8sSelectedCluster: prodCluster,
    k8sActiveTerminal: {
      id: 'terminal-prod',
      cols: 120,
      rows: 32,
      lastCommand: 'kubectl get pods'
    },
    refreshKubernetesCatalog: vi.fn(async () => undefined),
    createNewK8sTerminalTab: vi.fn(async () => undefined),
    resizeK8sTerminal: vi.fn(async () => undefined),
    executeK8sTerminalAiCommand: vi.fn(async () => undefined),
    sendK8sTerminalCommand: vi.fn(),
    setK8sResourceNamespace: vi.fn(),
    setK8sAgentCluster: vi.fn(),
    runK8sAgentKubectl: vi.fn(),
    updateK8sCluster: vi.fn(async () => undefined)
  }) as unknown as WorkspaceStore
}

describe('kubernetesWorkspaceInteractionRuntime', () => {
  it('keeps workspace interaction state and commands outside the composition runtime', async () => {
    const workspace = createWorkspace()
    let runtime: ReturnType<typeof useKubernetesWorkspaceInteractionRuntime>

    const Harness = defineComponent({
      setup() {
        runtime = useKubernetesWorkspaceInteractionRuntime(workspace)
        return () => null
      }
    })

    const wrapper = mount(Harness)
    await nextTick()

    expect(workspace.refreshKubernetesCatalog).toHaveBeenCalledTimes(1)
    expect(runtime!.detailForm).toMatchObject({
      name: 'Production',
      contextName: 'prod/admin',
      serverUrl: 'https://prod.k8s.local:6443',
      defaultNamespace: 'ops'
    })
    expect(runtime!.editingCluster.value?.id).toBe('prod')
    expect(runtime!.jumpserverClusters('bastion-1').map((item) => item.id)).toEqual(['jump-prod'])

    runtime!.syncActiveTerminalSize()
    expect(workspace.resizeK8sTerminal).toHaveBeenCalledWith('terminal-prod', 128, 34)

    runtime!.sendAiCommand()
    expect(workspace.executeK8sTerminalAiCommand).toHaveBeenCalledWith('kubectl get pods', 'terminal-prod')

    runtime!.command.value = 'kubectl get deploy'
    runtime!.sendCommand()
    expect(workspace.sendK8sTerminalCommand).toHaveBeenCalledWith('kubectl get deploy')
    expect(runtime!.command.value).toBe('')

    runtime!.handleK8sNamespaceChange({ target: { value: 'ops' } } as unknown as Event)
    expect(workspace.setK8sResourceNamespace).toHaveBeenCalledWith('ops')

    runtime!.handleK8sAgentClusterChange({ target: { value: '' } } as unknown as Event)
    expect(workspace.setK8sAgentCluster).toHaveBeenCalledWith(null)

    runtime!.runAgentCommand()
    expect(workspace.runK8sAgentKubectl).toHaveBeenCalledTimes(1)

    runtime!.detailForm.name = 'Renamed'
    runtime!.detailForm.defaultNamespace = 'platform'
    await runtime!.saveDetail()
    expect(workspace.updateK8sCluster).toHaveBeenCalledWith('prod', {
      name: 'Renamed',
      defaultNamespace: 'platform'
    })

    runtime!.resetDetail()
    expect(runtime!.detailForm.name).toBe('Production')

    wrapper.unmount()
  })
})
