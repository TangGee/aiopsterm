import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type SettingsConfigBridge = Pick<
  AiopsPreloadApi,
  | 'getSecurityConfigPath'
  | 'readSecurityConfig'
  | 'writeSecurityConfig'
  | 'onSecurityConfigFileChanged'
  | 'getKeywordHighlightConfigPath'
  | 'readKeywordHighlightConfig'
  | 'writeKeywordHighlightConfig'
  | 'onKeywordHighlightConfigFileChanged'
>

const bridgeMethod = createBridgeMethod<SettingsConfigBridge>()

export const settingsConfigClient = {
  getSecurityConfigPath: () => bridgeMethod('getSecurityConfigPath'),
  readSecurityConfig: () => bridgeMethod('readSecurityConfig'),
  writeSecurityConfig: () => bridgeMethod('writeSecurityConfig'),
  onSecurityConfigFileChanged: () => bridgeMethod('onSecurityConfigFileChanged'),
  getKeywordHighlightConfigPath: () => bridgeMethod('getKeywordHighlightConfigPath'),
  readKeywordHighlightConfig: () => bridgeMethod('readKeywordHighlightConfig'),
  writeKeywordHighlightConfig: () => bridgeMethod('writeKeywordHighlightConfig'),
  onKeywordHighlightConfigFileChanged: () => bridgeMethod('onKeywordHighlightConfigFileChanged')
}
