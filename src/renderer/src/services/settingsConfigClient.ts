import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof SettingsConfigBridge>(name: Name): SettingsConfigBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as SettingsConfigBridge[Name]) : undefined
}

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
