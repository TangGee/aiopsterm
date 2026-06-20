import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type AssetsBridge = Pick<AiopsPreloadApi, 'listSshAgentKeychainOptions'>

const bridgeMethod = <Name extends keyof AssetsBridge>(name: Name): AssetsBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as AssetsBridge[Name]) : undefined
}

export const assetsClient = {
  listSshAgentKeychainOptions: () => bridgeMethod('listSshAgentKeychainOptions')
}
