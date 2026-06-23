import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type AssetsBridge = Pick<
  AiopsPreloadApi,
  | 'listAssets'
  | 'listAssetGroups'
  | 'renameAssetGroup'
  | 'deleteAssetGroup'
  | 'saveAsset'
  | 'getAssetEditableSecret'
  | 'testAssetConnection'
  | 'deleteAsset'
  | 'refreshOrganizationAssets'
  | 'previewAssetImport'
  | 'confirmAssetImport'
  | 'exportAssets'
  | 'startSshTunnel'
  | 'stopSshTunnel'
  | 'saveAssetFolder'
  | 'deleteAssetFolder'
  | 'listKeychains'
  | 'listSshAgentKeychainOptions'
  | 'getKeychain'
  | 'saveKeychain'
  | 'deleteKeychain'
>

const bridgeMethod = createBridgeMethod<AssetsBridge>()

export const assetsClient = {
  listAssets: () => bridgeMethod('listAssets'),
  listAssetGroups: () => bridgeMethod('listAssetGroups'),
  renameAssetGroup: () => bridgeMethod('renameAssetGroup'),
  deleteAssetGroup: () => bridgeMethod('deleteAssetGroup'),
  saveAsset: () => bridgeMethod('saveAsset'),
  getAssetEditableSecret: () => bridgeMethod('getAssetEditableSecret'),
  testAssetConnection: () => bridgeMethod('testAssetConnection'),
  deleteAsset: () => bridgeMethod('deleteAsset'),
  refreshOrganizationAssets: () => bridgeMethod('refreshOrganizationAssets'),
  previewAssetImport: () => bridgeMethod('previewAssetImport'),
  confirmAssetImport: () => bridgeMethod('confirmAssetImport'),
  exportAssets: () => bridgeMethod('exportAssets'),
  startSshTunnel: () => bridgeMethod('startSshTunnel'),
  stopSshTunnel: () => bridgeMethod('stopSshTunnel'),
  saveAssetFolder: () => bridgeMethod('saveAssetFolder'),
  deleteAssetFolder: () => bridgeMethod('deleteAssetFolder'),
  listKeychains: () => bridgeMethod('listKeychains'),
  listSshAgentKeychainOptions: () => bridgeMethod('listSshAgentKeychainOptions'),
  getKeychain: () => bridgeMethod('getKeychain'),
  saveKeychain: () => bridgeMethod('saveKeychain'),
  deleteKeychain: () => bridgeMethod('deleteKeychain')
}
