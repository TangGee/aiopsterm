import type { IpcMain } from 'electron'
import {
  confirmAssetImport,
  deleteAsset,
  deleteAssetGroup,
  deleteAssetFolder,
  deleteKeychain,
  exportAssets,
  getAssetEditableSecret,
  getKeychain,
  listAssets,
  listAssetGroups,
  listKeychains,
  listSshAgentKeychainOptions,
  previewAssetImport,
  refreshOrganizationAssets,
  renameAssetGroup,
  saveAsset,
  saveAssetFolder,
  saveKeychain,
  testAssetConnection
} from '../backend/assets'
import { startSshTunnel, stopSshTunnel } from '../backend/sshTunnels'
import type {
  AiopsAssetExportInput,
  AiopsAssetGroupDeleteInput,
  AiopsAssetGroupListInput,
  AiopsAssetGroupRenameInput,
  AiopsAssetInput,
  AiopsCustomFolderSaveInput,
  AiopsKeychainInput,
  AiopsOrganizationAssetRefreshInput,
  AiopsSshTunnelStartInput,
  AiopsSshTunnelStopInput
} from '@shared/preload'

type RegisterAssetsIpcInput = {
  showSaveDialog: (options: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>
}

export const registerAssetsIpc = (ipcMain: IpcMain, input: RegisterAssetsIpcInput) => {
  ipcMain.handle('assets:list', () => listAssets())
  ipcMain.handle('assets:groups:list', (_event, listInput?: AiopsAssetGroupListInput) => listAssetGroups(listInput))
  ipcMain.handle('assets:groups:rename', (_event, groupInput: AiopsAssetGroupRenameInput) => renameAssetGroup(groupInput))
  ipcMain.handle('assets:groups:delete', (_event, groupInput: AiopsAssetGroupDeleteInput) => deleteAssetGroup(groupInput))
  ipcMain.handle('assets:save', (_event, assetInput: AiopsAssetInput) => saveAsset(assetInput))
  ipcMain.handle('assets:editable-secret:get', (_event, id: string) => getAssetEditableSecret(id))
  ipcMain.handle('assets:test-connection', (_event, connectionInput) => testAssetConnection(connectionInput))
  ipcMain.handle('assets:delete', (_event, id: string) => deleteAsset(id))
  ipcMain.handle('assets:organization:refresh', (_event, refreshInput?: AiopsOrganizationAssetRefreshInput) => refreshOrganizationAssets(refreshInput))
  ipcMain.handle('assets:import:preview', (_event, importInput) => previewAssetImport(importInput))
  ipcMain.handle('assets:import:confirm', (_event, importInput) => confirmAssetImport(importInput))
  ipcMain.handle('assets:export', (_event, exportInput: AiopsAssetExportInput) => exportAssets(exportInput, { showSaveDialog: input.showSaveDialog }))
  ipcMain.handle('ssh:tunnel:start', (_event, tunnelInput: AiopsSshTunnelStartInput) => startSshTunnel(tunnelInput))
  ipcMain.handle('ssh:tunnel:stop', (_event, tunnelInput: AiopsSshTunnelStopInput) => stopSshTunnel(tunnelInput))
  ipcMain.handle('assets:folder:save', (_event, folderInput: AiopsCustomFolderSaveInput) => saveAssetFolder(folderInput))
  ipcMain.handle('assets:folder:delete', (_event, uuid: string) => deleteAssetFolder(uuid))
  ipcMain.handle('assets:keychains:list', () => listKeychains())
  ipcMain.handle('assets:keychains:ssh-agent-options', () => listSshAgentKeychainOptions())
  ipcMain.handle('assets:keychains:get', (_event, id: string) => getKeychain(id))
  ipcMain.handle('assets:keychains:save', (_event, keychainInput: AiopsKeychainInput) => saveKeychain(keychainInput))
  ipcMain.handle('assets:keychains:delete', (_event, id: string) => deleteKeychain(id))
}
