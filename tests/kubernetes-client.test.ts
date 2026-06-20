import { afterEach, describe, expect, it, vi } from 'vitest'
import { kubernetesClient } from '@/services/kubernetesClient'

const originalAiops = window.aiops

const proxyConfig = {
  enabled: false,
  type: 'HTTP' as const,
  host: '',
  port: 8080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: '2026-06-20T00:00:00.000Z'
}

const cluster = {
  id: 'cluster-1',
  name: 'Production',
  kubeconfig_path: null,
  kubeconfig_content: null,
  context_name: 'prod',
  server_url: 'https://127.0.0.1:6443',
  auth_type: 'kubeconfig',
  is_active: 1,
  connection_status: 'connected' as const,
  auto_connect: 0,
  default_namespace: 'default',
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
  source_type: 'local' as const,
  bastion_uuid: null,
  bastion_asset_address: null,
  bastion_asset_name: null,
  bastion_asset_id_last: null
}

const namespace = {
  id: 'namespace-1',
  clusterId: cluster.id,
  name: 'default',
  status: 'Active',
  age: '1d'
}

const resource = {
  id: 'resource-1',
  clusterId: cluster.id,
  kind: 'pods' as const,
  name: 'api-0',
  namespace: 'default',
  status: 'Running',
  ready: '1/1',
  age: '1d',
  detail: 'app=api'
}

const catalog = {
  contexts: [
    {
      name: 'prod',
      cluster: 'production',
      namespace: 'default',
      server: 'https://127.0.0.1:6443',
      isActive: true
    }
  ],
  currentContext: 'prod',
  clusters: [cluster],
  bastions: [{ uuid: 'bastion-1', label: 'Jumpserver', ip: '127.0.0.1' }],
  namespaces: [namespace],
  resources: [resource],
  importContexts: [{ name: 'prod', cluster: 'production', server: 'https://127.0.0.1:6443', namespace: 'default' }],
  activeClusterId: cluster.id,
  selectedClusterId: cluster.id,
  agentProxyConfig: proxyConfig
}

const terminalRecord = {
  id: 'terminal-1',
  sessionId: 'k8s-session-1',
  clusterId: cluster.id,
  name: 'prod',
  namespace: 'default',
  output: '',
  status: 'connected' as const,
  cols: 120,
  rows: 32,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z'
}

const commandData = {
  runId: 'run-1',
  command: 'kubectl get pods',
  output: 'pod/api-0',
  terminalOutput: 'pod/api-0',
  success: true,
  error: '',
  durationMs: 12,
  startedAt: '2026-06-20T00:00:00.000Z',
  clusterId: cluster.id,
  contextName: cluster.context_name,
  namespace: 'default',
  source: 'resource' as const
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('kubernetesClient', () => {
  it('returns undefined for unavailable bridge methods and binds Kubernetes bridge methods', async () => {
    const unsubscribeData = vi.fn()
    const unsubscribeExit = vi.fn()
    window.aiops = {
      ...originalAiops,
      listKubernetesCatalog: vi.fn(async () => ({ ok: true, data: catalog })),
      switchKubernetesContext: vi.fn(async () => ({ ok: true, data: { ...catalog, currentContext: 'prod' } })),
      addKubernetesCluster: vi.fn(async () => ({ ok: true, data: { ...catalog, cluster } })),
      updateKubernetesCluster: vi.fn(async () => ({ ok: true, data: { ...catalog, cluster } })),
      testKubernetesClusterConnection: vi.fn(async () => ({
        ok: true,
        data: {
          success: true,
          isValid: true,
          contextName: 'prod',
          serverUrl: cluster.server_url,
          message: 'connected'
        }
      })),
      importKubernetesKubeconfig: vi.fn(async () => ({
        ok: true,
        data: {
          requestId: 'import-1',
          contexts: catalog.importContexts,
          kubeconfigPath: '/tmp/config',
          kubeconfigContent: '',
          currentContext: 'prod'
        }
      })),
      deleteKubernetesCluster: vi.fn(async () => ({ ok: true, data: { ...catalog, cluster } })),
      connectKubernetesCluster: vi.fn(async () => ({ ok: true, data: { ...catalog, cluster } })),
      disconnectKubernetesCluster: vi.fn(async () => ({ ok: true, data: { ...catalog, cluster: { ...cluster, connection_status: 'disconnected' as const } } })),
      syncKubernetesBastion: vi.fn(async () => ({ ok: true, data: { ...catalog, syncedCount: 1, updatedCount: 0 } })),
      createKubernetesTerminal: vi.fn(async () => ({ ok: true, data: terminalRecord })),
      writeKubernetesTerminal: vi.fn(async () => ({
        ok: true,
        data: {
          id: terminalRecord.sessionId,
          sessionId: terminalRecord.sessionId,
          bytes: 17,
          command: 'kubectl get pods',
          output: commandData.output,
          success: true,
          error: '',
          terminalOutput: commandData.terminalOutput,
          updatedAt: terminalRecord.updatedAt
        }
      })),
      resizeKubernetesTerminal: vi.fn(async () => ({ ok: true, data: { ...terminalRecord, cols: 100, rows: 24 } })),
      closeKubernetesTerminal: vi.fn(async () => ({ ok: true, data: { ...terminalRecord, status: 'ended' as const, exitCode: 0 } })),
      executeKubernetesCommand: vi.fn(async () => ({ ok: true, data: commandData })),
      planKubernetesResourceAction: vi.fn(async () => ({
        ok: true,
        data: {
          resourceId: resource.id,
          resourceName: resource.name,
          resourceKind: resource.kind,
          action: 'get' as const,
          title: 'kubectl get pods/api-0',
          command: 'kubectl get pod api-0 -n default',
          clusterId: cluster.id,
          clusterName: cluster.name,
          contextName: cluster.context_name,
          namespace: 'default'
        }
      })),
      executeKubernetesResourceAction: vi.fn(async () => ({
        ok: true,
        data: {
          ...commandData,
          resourceId: resource.id,
          resourceName: resource.name,
          resourceKind: resource.kind,
          action: 'describe' as const,
          title: 'kubectl describe pod/api-0'
        }
      })),
      refreshKubernetesResources: vi.fn(async () => ({
        ok: true,
        data: {
          ...catalog,
          ...commandData,
          refreshedClusterId: cluster.id,
          refreshedKind: 'pods' as const,
          refreshedResources: 1,
          refreshedNamespaces: 1,
          message: 'refreshed'
        }
      })),
      getKubernetesAgentProxyConfig: vi.fn(async () => ({ ok: true, data: { proxyConfig, message: 'loaded' } })),
      saveKubernetesAgentProxyConfig: vi.fn(async () => ({ ok: true, data: { proxyConfig: { ...proxyConfig, enabled: true }, message: 'saved' } })),
      cleanupKubernetesAgent: vi.fn(async () => ({ ok: true, data: { cleared: true, cleanedAt: '2026-06-20T00:00:00.000Z' } })),
      onKubernetesTerminalData: vi.fn(() => unsubscribeData),
      onKubernetesTerminalExit: vi.fn(() => unsubscribeExit)
    }

    await expect(kubernetesClient.listKubernetesCatalog()?.()).resolves.toEqual(expect.objectContaining({ ok: true, data: catalog }))
    await expect(kubernetesClient.switchKubernetesContext()?.('prod')).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.addKubernetesCluster()?.({ name: 'Production', contextName: 'prod', serverUrl: cluster.server_url })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.updateKubernetesCluster()?.(cluster.id, { defaultNamespace: 'default' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.testKubernetesClusterConnection()?.({ contextName: 'prod', serverUrl: cluster.server_url })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.importKubernetesKubeconfig()?.({ requestId: 'import-1', kubeconfigPath: '/tmp/config' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.deleteKubernetesCluster()?.(cluster.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.connectKubernetesCluster()?.(cluster.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.disconnectKubernetesCluster()?.(cluster.id)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.syncKubernetesBastion()?.('bastion-1')).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.createKubernetesTerminal()?.({ clusterId: cluster.id, cols: 120, rows: 32 })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.writeKubernetesTerminal()?.(terminalRecord.sessionId, 'kubectl get pods\n')).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.resizeKubernetesTerminal()?.(terminalRecord.sessionId, 100, 24)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.closeKubernetesTerminal()?.(terminalRecord.sessionId, 0)).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.executeKubernetesCommand()?.({ command: commandData.command, clusterId: cluster.id, namespace: 'default', source: 'resource' })).resolves.toEqual(
      expect.objectContaining({ ok: true })
    )
    await expect(kubernetesClient.planKubernetesResourceAction()?.({ resourceId: resource.id, action: 'get' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.executeKubernetesResourceAction()?.({ resourceId: resource.id, action: 'describe' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.refreshKubernetesResources()?.({ clusterId: cluster.id, namespace: 'default', kind: 'pods' })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.getKubernetesAgentProxyConfig()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.saveKubernetesAgentProxyConfig()?.({ enabled: true })).resolves.toEqual(expect.objectContaining({ ok: true }))
    await expect(kubernetesClient.cleanupKubernetesAgent()?.()).resolves.toEqual(expect.objectContaining({ ok: true }))

    const onData = vi.fn()
    const onExit = vi.fn()
    expect(kubernetesClient.onKubernetesTerminalData()?.(onData)).toBe(unsubscribeData)
    expect(kubernetesClient.onKubernetesTerminalExit()?.(onExit)).toBe(unsubscribeExit)

    expect(window.aiops.switchKubernetesContext).toHaveBeenCalledWith('prod')
    expect(window.aiops.addKubernetesCluster).toHaveBeenCalledWith({ name: 'Production', contextName: 'prod', serverUrl: cluster.server_url })
    expect(window.aiops.updateKubernetesCluster).toHaveBeenCalledWith(cluster.id, { defaultNamespace: 'default' })
    expect(window.aiops.testKubernetesClusterConnection).toHaveBeenCalledWith({ contextName: 'prod', serverUrl: cluster.server_url })
    expect(window.aiops.importKubernetesKubeconfig).toHaveBeenCalledWith({ requestId: 'import-1', kubeconfigPath: '/tmp/config' })
    expect(window.aiops.deleteKubernetesCluster).toHaveBeenCalledWith(cluster.id)
    expect(window.aiops.connectKubernetesCluster).toHaveBeenCalledWith(cluster.id)
    expect(window.aiops.disconnectKubernetesCluster).toHaveBeenCalledWith(cluster.id)
    expect(window.aiops.syncKubernetesBastion).toHaveBeenCalledWith('bastion-1')
    expect(window.aiops.createKubernetesTerminal).toHaveBeenCalledWith({ clusterId: cluster.id, cols: 120, rows: 32 })
    expect(window.aiops.writeKubernetesTerminal).toHaveBeenCalledWith(terminalRecord.sessionId, 'kubectl get pods\n')
    expect(window.aiops.resizeKubernetesTerminal).toHaveBeenCalledWith(terminalRecord.sessionId, 100, 24)
    expect(window.aiops.closeKubernetesTerminal).toHaveBeenCalledWith(terminalRecord.sessionId, 0)
    expect(window.aiops.executeKubernetesCommand).toHaveBeenCalledWith({ command: commandData.command, clusterId: cluster.id, namespace: 'default', source: 'resource' })
    expect(window.aiops.planKubernetesResourceAction).toHaveBeenCalledWith({ resourceId: resource.id, action: 'get' })
    expect(window.aiops.executeKubernetesResourceAction).toHaveBeenCalledWith({ resourceId: resource.id, action: 'describe' })
    expect(window.aiops.refreshKubernetesResources).toHaveBeenCalledWith({ clusterId: cluster.id, namespace: 'default', kind: 'pods' })
    expect(window.aiops.saveKubernetesAgentProxyConfig).toHaveBeenCalledWith({ enabled: true })
    expect(window.aiops.onKubernetesTerminalData).toHaveBeenCalledWith(onData)
    expect(window.aiops.onKubernetesTerminalExit).toHaveBeenCalledWith(onExit)

    window.aiops = {
      ...originalAiops,
      listKubernetesCatalog: undefined as any,
      switchKubernetesContext: undefined as any,
      addKubernetesCluster: undefined as any,
      updateKubernetesCluster: undefined as any,
      testKubernetesClusterConnection: undefined as any,
      importKubernetesKubeconfig: undefined as any,
      deleteKubernetesCluster: undefined as any,
      connectKubernetesCluster: undefined as any,
      disconnectKubernetesCluster: undefined as any,
      syncKubernetesBastion: undefined as any,
      createKubernetesTerminal: undefined as any,
      writeKubernetesTerminal: undefined as any,
      resizeKubernetesTerminal: undefined as any,
      closeKubernetesTerminal: undefined as any,
      executeKubernetesCommand: undefined as any,
      planKubernetesResourceAction: undefined as any,
      executeKubernetesResourceAction: undefined as any,
      refreshKubernetesResources: undefined as any,
      getKubernetesAgentProxyConfig: undefined as any,
      saveKubernetesAgentProxyConfig: undefined as any,
      cleanupKubernetesAgent: undefined as any,
      onKubernetesTerminalData: undefined as any,
      onKubernetesTerminalExit: undefined as any
    }
    expect(kubernetesClient.listKubernetesCatalog()).toBeUndefined()
    expect(kubernetesClient.switchKubernetesContext()).toBeUndefined()
    expect(kubernetesClient.addKubernetesCluster()).toBeUndefined()
    expect(kubernetesClient.updateKubernetesCluster()).toBeUndefined()
    expect(kubernetesClient.testKubernetesClusterConnection()).toBeUndefined()
    expect(kubernetesClient.importKubernetesKubeconfig()).toBeUndefined()
    expect(kubernetesClient.deleteKubernetesCluster()).toBeUndefined()
    expect(kubernetesClient.connectKubernetesCluster()).toBeUndefined()
    expect(kubernetesClient.disconnectKubernetesCluster()).toBeUndefined()
    expect(kubernetesClient.syncKubernetesBastion()).toBeUndefined()
    expect(kubernetesClient.createKubernetesTerminal()).toBeUndefined()
    expect(kubernetesClient.writeKubernetesTerminal()).toBeUndefined()
    expect(kubernetesClient.resizeKubernetesTerminal()).toBeUndefined()
    expect(kubernetesClient.closeKubernetesTerminal()).toBeUndefined()
    expect(kubernetesClient.executeKubernetesCommand()).toBeUndefined()
    expect(kubernetesClient.planKubernetesResourceAction()).toBeUndefined()
    expect(kubernetesClient.executeKubernetesResourceAction()).toBeUndefined()
    expect(kubernetesClient.refreshKubernetesResources()).toBeUndefined()
    expect(kubernetesClient.getKubernetesAgentProxyConfig()).toBeUndefined()
    expect(kubernetesClient.saveKubernetesAgentProxyConfig()).toBeUndefined()
    expect(kubernetesClient.cleanupKubernetesAgent()).toBeUndefined()
    expect(kubernetesClient.onKubernetesTerminalData()).toBeUndefined()
    expect(kubernetesClient.onKubernetesTerminalExit()).toBeUndefined()
  })
})
