import type { IpcMain } from 'electron'
import {
  cancelExtensionInstall,
  downloadExtensionPackage,
  installExtensionPackage,
  installExtensionPlugin,
  installExtensionPluginFromUrl,
  listExtensionPlugins,
  openExtensionSubscription,
  uninstallExtensionPlugin,
  updateExtensionPlugin
} from '../backend/extensions'
import { sendWebContentsEvent } from '@shared/windowEvents'
import type {
  ExtensionInstallProgress,
  ExtensionPackageDownloadInput,
  ExtensionPackageInstallInput,
  ExtensionPluginOperationInput,
  ExtensionPluginUrlInstallInput,
  ExtensionSubscriptionInput
} from '@shared/contracts/extensions'

type RegisterExtensionsIpcInput = {
  openExternal: (url: string) => Promise<void> | void
}

export const registerExtensionsIpc = (ipcMain: IpcMain, input: RegisterExtensionsIpcInput) => {
  ipcMain.handle('extensions:list', () => listExtensionPlugins())
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
}
