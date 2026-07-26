import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ExtensionsBridge = Pick<
  AiopsPreloadApi,
  | 'listExtensionPlugins'
  | 'syncExtensionAssetProvider'
  | 'cancelExtensionAssetProvider'
  | 'installExtensionPlugin'
  | 'updateExtensionPlugin'
  | 'installExtensionPackage'
  | 'downloadExtensionPackage'
  | 'installExtensionPluginFromUrl'
  | 'uninstallExtensionPlugin'
  | 'openExtensionSubscription'
  | 'cancelExtensionInstall'
  | 'runExtensionRuntimeAction'
  | 'executeExtensionCommand'
  | 'listExtensionTreeChildren'
  | 'listExtensionContexts'
  | 'getExtensionConfiguration'
  | 'saveExtensionConfiguration'
  | 'listExtensionVersions'
  | 'listExtensionBastions'
  | 'invokeExtensionBastion'
  | 'onExtensionRuntimeEvent'
  | 'onExtensionInstallProgress'
>

const bridgeMethod = createBridgeMethod<ExtensionsBridge>()

export const extensionsClient = {
  listExtensionPlugins: () => bridgeMethod('listExtensionPlugins'),
  syncExtensionAssetProvider: () => bridgeMethod('syncExtensionAssetProvider'),
  cancelExtensionAssetProvider: () => bridgeMethod('cancelExtensionAssetProvider'),
  installExtensionPlugin: () => bridgeMethod('installExtensionPlugin'),
  updateExtensionPlugin: () => bridgeMethod('updateExtensionPlugin'),
  installExtensionPackage: () => bridgeMethod('installExtensionPackage'),
  downloadExtensionPackage: () => bridgeMethod('downloadExtensionPackage'),
  installExtensionPluginFromUrl: () => bridgeMethod('installExtensionPluginFromUrl'),
  uninstallExtensionPlugin: () => bridgeMethod('uninstallExtensionPlugin'),
  openExtensionSubscription: () => bridgeMethod('openExtensionSubscription'),
  cancelExtensionInstall: () => bridgeMethod('cancelExtensionInstall'),
  runExtensionRuntimeAction: () => bridgeMethod('runExtensionRuntimeAction'),
  executeExtensionCommand: () => bridgeMethod('executeExtensionCommand'),
  listExtensionTreeChildren: () => bridgeMethod('listExtensionTreeChildren'),
  listExtensionContexts: () => bridgeMethod('listExtensionContexts'),
  getExtensionConfiguration: () => bridgeMethod('getExtensionConfiguration'),
  saveExtensionConfiguration: () => bridgeMethod('saveExtensionConfiguration'),
  listExtensionVersions: () => bridgeMethod('listExtensionVersions'),
  listExtensionBastions: () => bridgeMethod('listExtensionBastions'),
  invokeExtensionBastion: () => bridgeMethod('invokeExtensionBastion'),
  onExtensionRuntimeEvent: () => bridgeMethod('onExtensionRuntimeEvent'),
  onExtensionInstallProgress: () => bridgeMethod('onExtensionInstallProgress')
}
