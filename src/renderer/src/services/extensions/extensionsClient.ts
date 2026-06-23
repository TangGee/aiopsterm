import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ExtensionsBridge = Pick<
  AiopsPreloadApi,
  | 'listExtensionPlugins'
  | 'installExtensionPlugin'
  | 'updateExtensionPlugin'
  | 'installExtensionPackage'
  | 'downloadExtensionPackage'
  | 'installExtensionPluginFromUrl'
  | 'uninstallExtensionPlugin'
  | 'openExtensionSubscription'
  | 'cancelExtensionInstall'
  | 'onExtensionInstallProgress'
>

const bridgeMethod = createBridgeMethod<ExtensionsBridge>()

export const extensionsClient = {
  listExtensionPlugins: () => bridgeMethod('listExtensionPlugins'),
  installExtensionPlugin: () => bridgeMethod('installExtensionPlugin'),
  updateExtensionPlugin: () => bridgeMethod('updateExtensionPlugin'),
  installExtensionPackage: () => bridgeMethod('installExtensionPackage'),
  downloadExtensionPackage: () => bridgeMethod('downloadExtensionPackage'),
  installExtensionPluginFromUrl: () => bridgeMethod('installExtensionPluginFromUrl'),
  uninstallExtensionPlugin: () => bridgeMethod('uninstallExtensionPlugin'),
  openExtensionSubscription: () => bridgeMethod('openExtensionSubscription'),
  cancelExtensionInstall: () => bridgeMethod('cancelExtensionInstall'),
  onExtensionInstallProgress: () => bridgeMethod('onExtensionInstallProgress')
}
