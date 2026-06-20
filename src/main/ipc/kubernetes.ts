import type { IpcMain } from 'electron'
import {
  addKubernetesCluster,
  cleanupKubernetesAgent,
  closeKubernetesTerminal,
  connectKubernetesCluster,
  createKubernetesTerminal,
  deleteKubernetesCluster,
  disconnectKubernetesCluster,
  executeKubernetesCommand,
  executeKubernetesResourceAction,
  getKubernetesAgentProxyConfig,
  importKubernetesKubeconfig,
  listKubernetesCatalog,
  planKubernetesResourceAction,
  refreshKubernetesResources,
  resizeKubernetesTerminal,
  saveKubernetesAgentProxyConfig,
  switchKubernetesContext,
  syncKubernetesBastion,
  testKubernetesClusterConnection,
  updateKubernetesCluster,
  writeKubernetesTerminal
} from '../backend/kubernetes'
import type {
  KubernetesAgentProxyConfigInput,
  KubernetesClusterInput,
  KubernetesClusterTestInput,
  KubernetesClusterUpdateInput,
  KubernetesCommandInput,
  KubernetesKubeconfigImportInput,
  KubernetesResourceActionInput,
  KubernetesResourceRefreshInput,
  KubernetesTerminalCreateInput
} from '@shared/contracts/kubernetes'

export const registerKubernetesIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('kubernetes:catalog', () => listKubernetesCatalog())
  ipcMain.handle('kubernetes:context:switch', (_event, contextName: string) => switchKubernetesContext(contextName))
  ipcMain.handle('kubernetes:cluster:add', (_event, input: KubernetesClusterInput) => addKubernetesCluster(input))
  ipcMain.handle('kubernetes:cluster:update', (_event, id: string, input: KubernetesClusterUpdateInput) => updateKubernetesCluster(id, input))
  ipcMain.handle('kubernetes:cluster:test', (_event, input: KubernetesClusterTestInput) => testKubernetesClusterConnection(input))
  ipcMain.handle('kubernetes:kubeconfig:import', (_event, input: KubernetesKubeconfigImportInput) => importKubernetesKubeconfig(input))
  ipcMain.handle('kubernetes:cluster:delete', (_event, id: string) => deleteKubernetesCluster(id))
  ipcMain.handle('kubernetes:cluster:connect', (_event, id: string) => connectKubernetesCluster(id))
  ipcMain.handle('kubernetes:cluster:disconnect', (_event, id: string) => disconnectKubernetesCluster(id))
  ipcMain.handle('kubernetes:bastion:sync', (_event, bastionUuid: string) => syncKubernetesBastion(bastionUuid))
  ipcMain.handle('kubernetes:terminal:create', (_event, input: KubernetesTerminalCreateInput) => createKubernetesTerminal(input))
  ipcMain.handle('kubernetes:terminal:write', (_event, id: string, data: string) => writeKubernetesTerminal(id, data))
  ipcMain.handle('kubernetes:terminal:resize', (_event, id: string, cols: number, rows: number) => resizeKubernetesTerminal(id, cols, rows))
  ipcMain.handle('kubernetes:terminal:close', (_event, id: string, exitCode?: number) => closeKubernetesTerminal(id, exitCode))
  ipcMain.handle('kubernetes:execute-command', (_event, input: KubernetesCommandInput) => executeKubernetesCommand(input))
  ipcMain.handle('kubernetes:resource-action:plan', (_event, input: KubernetesResourceActionInput) => planKubernetesResourceAction(input))
  ipcMain.handle('kubernetes:resource-action:execute', (_event, input: KubernetesResourceActionInput) => executeKubernetesResourceAction(input))
  ipcMain.handle('kubernetes:resources:refresh', (_event, input: KubernetesResourceRefreshInput) => refreshKubernetesResources(input))
  ipcMain.handle('kubernetes:agent:proxy:get', () => getKubernetesAgentProxyConfig())
  ipcMain.handle('kubernetes:agent:proxy:save', (_event, input: KubernetesAgentProxyConfigInput) => saveKubernetesAgentProxyConfig(input))
  ipcMain.handle('kubernetes:agent:cleanup', () => cleanupKubernetesAgent())
}
