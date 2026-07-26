import type { IpcMain } from 'electron'
import {
  cancelExtensionAssetProvider,
  cancelExtensionInstall,
  downloadExtensionPackage,
  installExtensionPackage,
  installExtensionPlugin,
  installExtensionPluginFromUrl,
  executePluginCommand,
  getPluginConfiguration,
  listExtensionVersions,
  listExtensionBastions,
  listPluginContexts,
  listPluginTreeChildren,
  listExtensionPlugins,
  openExtensionSubscription,
  runExtensionBastionAction,
  runExtensionRuntimeAction,
  savePluginConfiguration,
  syncExtensionAssetProvider,
  uninstallExtensionPlugin,
  updateExtensionPlugin
} from '../backend/extensions/extensions'
import { sendWebContentsEvent } from '@shared/windowEvents'
import type {
  ExtensionAssetProviderCancelInput,
  ExtensionAssetProviderSyncInput,
  ExtensionCommandExecuteInput,
  ExtensionConfigurationUpdateInput,
  ExtensionInstallProgress,
  ExtensionPackageDownloadInput,
  ExtensionPackageInstallInput,
  ExtensionPluginOperationInput,
  ExtensionPluginUrlInstallInput,
  ExtensionRuntimeActionInput,
  ExtensionSubscriptionInput,
  ExtensionTreeChildrenInput
} from '@shared/contracts/extensions'

type RegisterExtensionsIpcInput = {
  openExternal: (url: string) => Promise<void> | void
}

export const registerExtensionsIpc = (ipcMain: IpcMain, input: RegisterExtensionsIpcInput) => {
  ipcMain.handle('extensions:list', () => listExtensionPlugins())
  ipcMain.handle('extensions:provider:sync-assets', (_event, syncInput: ExtensionAssetProviderSyncInput) =>
    syncExtensionAssetProvider(syncInput)
  )
  ipcMain.handle('extensions:provider:cancel', (_event, cancelInput: ExtensionAssetProviderCancelInput) =>
    cancelExtensionAssetProvider(cancelInput)
  )
  ipcMain.handle('extensions:install-plugin', (event, installInput: ExtensionPluginOperationInput) => {
    const emit = (progress: ExtensionInstallProgress) => sendWebContentsEvent(event.sender, 'extensions:install-progress', progress)
    return installExtensionPlugin(installInput, emit)
  })
  ipcMain.handle('extensions:update-plugin', (event, updateInput: ExtensionPluginOperationInput) => {
    const emit = (progress: ExtensionInstallProgress) => sendWebContentsEvent(event.sender, 'extensions:install-progress', progress)
    return updateExtensionPlugin(updateInput, emit)
  })
  ipcMain.handle('extensions:install-package', (event, packageInput: ExtensionPackageInstallInput) => {
    const emit = (progress: ExtensionInstallProgress) => sendWebContentsEvent(event.sender, 'extensions:install-progress', progress)
    return installExtensionPackage(packageInput, emit)
  })
  ipcMain.handle('extensions:download-package', (_event, downloadInput: ExtensionPackageDownloadInput) => downloadExtensionPackage(downloadInput))
  ipcMain.handle('extensions:install-plugin-from-url', (event, urlInput: ExtensionPluginUrlInstallInput) => {
    const emit = (progress: ExtensionInstallProgress) => sendWebContentsEvent(event.sender, 'extensions:install-progress', progress)
    return installExtensionPluginFromUrl(urlInput, emit)
  })
  ipcMain.handle('extensions:uninstall-plugin', (_event, uninstallInput: ExtensionPluginOperationInput) => uninstallExtensionPlugin(uninstallInput))
  ipcMain.handle('extensions:open-subscription', (_event, subscriptionInput: ExtensionSubscriptionInput) =>
    openExtensionSubscription(subscriptionInput, input.openExternal)
  )
  ipcMain.handle('extensions:cancel-install', (_event, pluginId: string) => cancelExtensionInstall(pluginId))
  ipcMain.handle('extensions:runtime-action', (_event, actionInput: ExtensionRuntimeActionInput) => runExtensionRuntimeAction(actionInput))
  ipcMain.handle('extensions:execute-command', (_event, commandInput: ExtensionCommandExecuteInput) => executePluginCommand(commandInput))
  ipcMain.handle('extensions:tree-children', (_event, treeInput: ExtensionTreeChildrenInput) => listPluginTreeChildren(treeInput))
  ipcMain.handle('extensions:contexts', () => listPluginContexts())
  ipcMain.handle('extensions:configuration:get', (_event, pluginId: string) => getPluginConfiguration(pluginId))
  ipcMain.handle('extensions:configuration:save', (_event, configInput: ExtensionConfigurationUpdateInput) =>
    savePluginConfiguration(configInput)
  )
  ipcMain.handle('extensions:versions', () => listExtensionVersions())
  ipcMain.handle('extensions:bastions', () => listExtensionBastions())
  ipcMain.handle(
    'extensions:bastion:invoke',
    (_event, type: string, method: 'connect' | 'openShell' | 'write' | 'resize' | 'disconnect' | 'refreshAssets', args: Record<string, unknown>) =>
      runExtensionBastionAction(type, method, args)
  )
}
