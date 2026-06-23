import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type KubernetesBridge = Pick<
  AiopsPreloadApi,
  | 'listKubernetesCatalog'
  | 'switchKubernetesContext'
  | 'addKubernetesCluster'
  | 'updateKubernetesCluster'
  | 'testKubernetesClusterConnection'
  | 'importKubernetesKubeconfig'
  | 'deleteKubernetesCluster'
  | 'connectKubernetesCluster'
  | 'disconnectKubernetesCluster'
  | 'syncKubernetesBastion'
  | 'createKubernetesTerminal'
  | 'writeKubernetesTerminal'
  | 'resizeKubernetesTerminal'
  | 'closeKubernetesTerminal'
  | 'executeKubernetesCommand'
  | 'planKubernetesResourceAction'
  | 'executeKubernetesResourceAction'
  | 'refreshKubernetesResources'
  | 'getKubernetesAgentProxyConfig'
  | 'saveKubernetesAgentProxyConfig'
  | 'cleanupKubernetesAgent'
  | 'onKubernetesTerminalData'
  | 'onKubernetesTerminalExit'
>

const bridgeMethod = createBridgeMethod<KubernetesBridge>()

export const kubernetesClient = {
  listKubernetesCatalog: () => bridgeMethod('listKubernetesCatalog'),
  switchKubernetesContext: () => bridgeMethod('switchKubernetesContext'),
  addKubernetesCluster: () => bridgeMethod('addKubernetesCluster'),
  updateKubernetesCluster: () => bridgeMethod('updateKubernetesCluster'),
  testKubernetesClusterConnection: () => bridgeMethod('testKubernetesClusterConnection'),
  importKubernetesKubeconfig: () => bridgeMethod('importKubernetesKubeconfig'),
  deleteKubernetesCluster: () => bridgeMethod('deleteKubernetesCluster'),
  connectKubernetesCluster: () => bridgeMethod('connectKubernetesCluster'),
  disconnectKubernetesCluster: () => bridgeMethod('disconnectKubernetesCluster'),
  syncKubernetesBastion: () => bridgeMethod('syncKubernetesBastion'),
  createKubernetesTerminal: () => bridgeMethod('createKubernetesTerminal'),
  writeKubernetesTerminal: () => bridgeMethod('writeKubernetesTerminal'),
  resizeKubernetesTerminal: () => bridgeMethod('resizeKubernetesTerminal'),
  closeKubernetesTerminal: () => bridgeMethod('closeKubernetesTerminal'),
  executeKubernetesCommand: () => bridgeMethod('executeKubernetesCommand'),
  planKubernetesResourceAction: () => bridgeMethod('planKubernetesResourceAction'),
  executeKubernetesResourceAction: () => bridgeMethod('executeKubernetesResourceAction'),
  refreshKubernetesResources: () => bridgeMethod('refreshKubernetesResources'),
  getKubernetesAgentProxyConfig: () => bridgeMethod('getKubernetesAgentProxyConfig'),
  saveKubernetesAgentProxyConfig: () => bridgeMethod('saveKubernetesAgentProxyConfig'),
  cleanupKubernetesAgent: () => bridgeMethod('cleanupKubernetesAgent'),
  onKubernetesTerminalData: () => bridgeMethod('onKubernetesTerminalData'),
  onKubernetesTerminalExit: () => bridgeMethod('onKubernetesTerminalExit')
}
