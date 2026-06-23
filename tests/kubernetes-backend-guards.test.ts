import { describe, expect, it } from 'vitest'
import {
  expectedK8sResourceNamespace,
  isK8sAgentCleanupData,
  isK8sBackendCommandForRequest,
  isK8sBackendResourceActionData,
  isK8sBackendResourceRefreshData,
  isK8sBastionSyncData,
  isK8sCatalogSnapshot,
  isK8sClusterDeleteData,
  isK8sClusterMutationData,
  isK8sClusterTestDataForRequest,
  isK8sContextSwitchData,
  isK8sKubeconfigImportDataForRequest,
  isK8sProxyConfigData,
  isK8sResourceActionPlanData,
  isK8sTerminalCloseData,
  isK8sTerminalDataEvent,
  isK8sTerminalExitEvent,
  isK8sTerminalRecord,
  isK8sTerminalWriteDataForRequest,
  k8sCommandDisplayOutput,
  normalizeK8sCommandText
} from '@/services/kubernetes/kubernetesBackendGuards'
import type { KubernetesCatalog, KubernetesClusterRecord, KubernetesResource, KubernetesTerminalRecord } from '@shared/contracts/kubernetes'

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

const cluster: KubernetesClusterRecord = {
  id: 'cluster-1',
  name: 'Production',
  kubeconfig_path: null,
  kubeconfig_content: null,
  context_name: 'prod',
  server_url: 'https://127.0.0.1:6443',
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
  bastion_asset_id_last: null
}

const podResource: KubernetesResource = {
  id: 'resource-pod-1',
  clusterId: cluster.id,
  kind: 'pods',
  name: 'api-0',
  namespace: 'default',
  status: 'Running',
  ready: '1/1',
  age: '1d',
  detail: 'app=api',
  restarts: 0
}

const nodeResource: KubernetesResource = {
  id: 'resource-node-1',
  clusterId: cluster.id,
  kind: 'nodes',
  name: 'worker-1',
  namespace: '',
  status: 'Ready',
  ready: '1/1',
  age: '3d',
  detail: 'node'
}

const catalog: KubernetesCatalog = {
  contexts: [
    {
      name: 'prod',
      cluster: 'production',
      namespace: 'default',
      server: cluster.server_url,
      isActive: true
    }
  ],
  currentContext: 'prod',
  clusters: [cluster],
  bastions: [{ uuid: 'bastion-1', label: 'Jumpserver', ip: '127.0.0.1' }],
  namespaces: [
    {
      id: 'namespace-1',
      clusterId: cluster.id,
      name: 'default',
      status: 'Active',
      age: '1d'
    }
  ],
  resources: [podResource, nodeResource],
  importContexts: [{ name: 'prod', cluster: 'production', server: cluster.server_url, namespace: 'default' }],
  activeClusterId: cluster.id,
  selectedClusterId: cluster.id,
  agentProxyConfig: proxyConfig
}

const terminalRecord: KubernetesTerminalRecord = {
  id: 'terminal-1',
  sessionId: 'k8s-session-1',
  clusterId: cluster.id,
  name: 'prod',
  namespace: 'default',
  output: '',
  status: 'connected',
  cols: 120,
  rows: 32,
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z'
}

const commandData = {
  runId: 'run-1',
  command: 'kubectl get pods',
  output: 'pod/api-0',
  terminalOutput: '$ kubectl get pods\npod/api-0',
  success: true,
  error: '',
  durationMs: 12,
  startedAt: '2026-06-20T00:00:00.000Z',
  clusterId: cluster.id,
  contextName: cluster.context_name,
  namespace: 'default',
  source: 'resource' as const
}

describe('kubernetesBackendGuards', () => {
  it('validates catalog snapshots and rejects cross-catalog references', () => {
    expect(isK8sCatalogSnapshot(catalog)).toBe(true)
    expect(isK8sCatalogSnapshot({ ...catalog, activeClusterId: 'missing' })).toBe(false)
    expect(isK8sCatalogSnapshot({ ...catalog, selectedClusterId: 'missing' })).toBe(false)
    expect(isK8sCatalogSnapshot({ ...catalog, namespaces: [{ ...catalog.namespaces[0], clusterId: 'missing' }] })).toBe(false)
    expect(isK8sCatalogSnapshot({ ...catalog, resources: [{ ...podResource, clusterId: 'missing' }] })).toBe(false)
    expect(isK8sCatalogSnapshot({ ...catalog, agentProxyConfig: { ...proxyConfig, type: 'TCP' } })).toBe(false)
  })

  it('validates catalog mutation, deletion, context switch, proxy, cleanup, and bastion sync results', () => {
    expect(isK8sContextSwitchData(catalog, 'prod')).toBe(true)
    expect(isK8sContextSwitchData({ ...catalog, contexts: [{ ...catalog.contexts[0], isActive: false }] }, 'prod')).toBe(false)
    expect(isK8sClusterMutationData({ ...catalog, cluster }, cluster.id, 'connected')).toBe(true)
    expect(isK8sClusterMutationData({ ...catalog, cluster: { ...cluster, connection_status: 'disconnected' } }, cluster.id, 'connected')).toBe(false)
    expect(isK8sClusterDeleteData({ ...catalog, clusters: [], activeClusterId: null, selectedClusterId: null, namespaces: [], resources: [] }, cluster.id)).toBe(true)
    expect(isK8sClusterDeleteData(catalog, cluster.id)).toBe(false)
    expect(isK8sBastionSyncData({ ...catalog, syncedCount: 1, updatedCount: 0 })).toBe(true)
    expect(isK8sBastionSyncData({ ...catalog, syncedCount: -1, updatedCount: 0 })).toBe(false)
    expect(isK8sProxyConfigData({ proxyConfig, message: 'saved' })).toBe(true)
    expect(isK8sProxyConfigData({ proxyConfig: { ...proxyConfig, port: Number.NaN }, message: 'saved' })).toBe(false)
    expect(isK8sAgentCleanupData({ cleared: true, cleanedAt: '2026-06-20T00:00:00.000Z' })).toBe(true)
    expect(isK8sAgentCleanupData({ cleared: false, cleanedAt: '2026-06-20T00:00:00.000Z' })).toBe(false)
  })

  it('validates terminal records, write acknowledgements, data events, and exit events', () => {
    expect(isK8sTerminalRecord(terminalRecord)).toBe(true)
    expect(isK8sTerminalRecord({ ...terminalRecord, cols: 0 })).toBe(false)
    expect(isK8sTerminalCloseData({ ...terminalRecord, status: 'ended', exitCode: 0 })).toBe(true)
    expect(isK8sTerminalCloseData({ ...terminalRecord, status: 'connected', exitCode: 0 })).toBe(false)
    expect(
      isK8sTerminalWriteDataForRequest(
        {
          id: terminalRecord.sessionId,
          sessionId: terminalRecord.sessionId,
          bytes: new TextEncoder().encode('kubectl get pods\n').byteLength,
          command: 'kubectl   get   pods',
          output: commandData.output,
          success: true,
          error: '',
          terminalOutput: commandData.terminalOutput,
          updatedAt: terminalRecord.updatedAt
        },
        { id: terminalRecord.sessionId, data: 'kubectl get pods\n', command: 'kubectl get pods' }
      )
    ).toBe(true)
    expect(
      isK8sTerminalWriteDataForRequest(
        {
          id: terminalRecord.sessionId,
          sessionId: terminalRecord.sessionId,
          bytes: 1,
          command: 'kubectl get pods',
          output: commandData.output,
          success: true,
          error: '',
          terminalOutput: commandData.terminalOutput,
          updatedAt: terminalRecord.updatedAt
        },
        { id: terminalRecord.sessionId, data: 'kubectl get pods\n', command: 'kubectl get pods' }
      )
    ).toBe(false)
    expect(isK8sTerminalDataEvent({ ...commandData, id: terminalRecord.id, sessionId: terminalRecord.sessionId, data: 'pod/api-0', emittedAt: terminalRecord.updatedAt })).toBe(true)
    expect(isK8sTerminalExitEvent({ id: terminalRecord.id, sessionId: terminalRecord.sessionId, clusterId: cluster.id, exitCode: 0, reason: 'closed', emittedAt: terminalRecord.updatedAt })).toBe(true)
    expect(isK8sTerminalExitEvent({ id: terminalRecord.id, sessionId: terminalRecord.sessionId, clusterId: cluster.id, exitCode: 0, reason: 'bad', emittedAt: terminalRecord.updatedAt })).toBe(false)
  })

  it('validates command results and normalizes command display output', () => {
    expect(normalizeK8sCommandText(' kubectl   get\tpods ')).toBe('kubectl get pods')
    expect(isK8sBackendCommandForRequest(commandData, { command: 'kubectl   get pods', clusterId: cluster.id, namespace: 'default', source: 'resource' })).toBe(true)
    expect(isK8sBackendCommandForRequest({ ...commandData, output: '', error: '', terminalOutput: '' }, { command: commandData.command })).toBe(false)
    expect(isK8sBackendCommandForRequest({ ...commandData, terminalOutput: 'unrelated output' }, { command: commandData.command })).toBe(false)
    expect(isK8sBackendCommandForRequest({ ...commandData, command: '<empty>', terminalOutput: '<empty>\nbackend rejected empty command' }, { command: '' })).toBe(true)
    expect(k8sCommandDisplayOutput({ command: 'kubectl get pods', output: 'pod/api-0' })).toBe('kubectl get pods\n\npod/api-0')
    expect(k8sCommandDisplayOutput({ command: 'kubectl get pods', output: '', error: 'boom' })).toBe('kubectl get pods\n\nboom')
    expect(k8sCommandDisplayOutput({ command: 'kubectl get pods' })).toBe('kubectl get pods')
  })

  it('validates resource action plans, resource action execution, and refresh results', () => {
    const plan = {
      resourceId: podResource.id,
      resourceName: podResource.name,
      resourceKind: podResource.kind,
      action: 'describe' as const,
      title: 'kubectl describe pod/api-0',
      command: 'kubectl describe pod api-0 -n default',
      clusterId: cluster.id,
      clusterName: cluster.name,
      contextName: cluster.context_name,
      namespace: 'default'
    }
    expect(isK8sResourceActionPlanData(plan, { resourceId: podResource.id, action: 'describe', resource: podResource })).toBe(true)
    expect(isK8sResourceActionPlanData({ ...plan, namespace: 'wrong' }, { resource: podResource })).toBe(false)
    expect(expectedK8sResourceNamespace(nodeResource)).toBe('all')
    expect(
      isK8sResourceActionPlanData(
        {
          ...plan,
          resourceId: nodeResource.id,
          resourceName: nodeResource.name,
          resourceKind: nodeResource.kind,
          action: 'get',
          namespace: 'all'
        },
        { resourceId: nodeResource.id, action: 'get', resource: nodeResource }
      )
    ).toBe(true)
    const actionData = {
      ...commandData,
      resourceId: podResource.id,
      resourceName: podResource.name,
      resourceKind: podResource.kind,
      action: 'describe' as const,
      title: 'kubectl describe pod/api-0'
    }
    expect(isK8sBackendResourceActionData(actionData, { resourceId: podResource.id, action: 'describe', resource: podResource })).toBe(true)
    expect(isK8sBackendResourceActionData({ ...actionData, resourceName: 'wrong' }, { resource: podResource })).toBe(false)
    const refreshData = {
      ...catalog,
      ...commandData,
      refreshedClusterId: cluster.id,
      refreshedKind: 'pods' as const,
      refreshedResources: 2,
      refreshedNamespaces: 1,
      message: 'refreshed'
    }
    expect(isK8sBackendResourceRefreshData(refreshData, { clusterId: cluster.id, kind: 'pods', namespace: 'default' })).toBe(true)
    expect(isK8sBackendResourceRefreshData({ ...refreshData, refreshedClusterId: 'other' }, { clusterId: cluster.id, kind: 'pods', namespace: 'default' })).toBe(false)
  })

  it('validates kubeconfig import and cluster test request matching', () => {
    const importData = {
      requestId: 'import-1',
      contexts: catalog.importContexts,
      kubeconfigPath: '/tmp/config',
      kubeconfigContent: '',
      currentContext: 'prod'
    }
    expect(isK8sKubeconfigImportDataForRequest(importData, { requestId: 'import-1', kubeconfigPath: '/tmp/config' })).toBe(true)
    expect(isK8sKubeconfigImportDataForRequest({ ...importData, requestId: 'import-2' }, { requestId: 'import-1', kubeconfigPath: '/tmp/config' })).toBe(false)
    expect(isK8sKubeconfigImportDataForRequest({ ...importData, currentContext: 'missing' }, { requestId: 'import-1', kubeconfigPath: '/tmp/config' })).toBe(false)
    expect(
      isK8sClusterTestDataForRequest(
        {
          success: true,
          isValid: true,
          contextName: 'prod',
          serverUrl: cluster.server_url,
          message: 'connected',
          durationMs: 10
        },
        { contextName: 'prod', serverUrl: ` ${cluster.server_url} ` }
      )
    ).toBe(true)
    expect(
      isK8sClusterTestDataForRequest(
        {
          success: true,
          isValid: false,
          contextName: 'prod',
          serverUrl: cluster.server_url,
          message: 'connected'
        },
        { contextName: 'prod' }
      )
    ).toBe(false)
  })
})
