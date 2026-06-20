import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof ExtensionsBridge>(name: Name): ExtensionsBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ExtensionsBridge[Name]) : undefined
}

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
