import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type AiCatalogBridge = Pick<AiopsPreloadApi, 'listAiContextCatalog' | 'listAiCommandCatalog' | 'listAiTodoSnapshot'>

const bridgeMethod = <Name extends keyof AiCatalogBridge>(name: Name): AiCatalogBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as AiCatalogBridge[Name]) : undefined
}

export const aiCatalogClient = {
  listAiContextCatalog: () => bridgeMethod('listAiContextCatalog'),
  listAiCommandCatalog: () => bridgeMethod('listAiCommandCatalog'),
  listAiTodoSnapshot: () => bridgeMethod('listAiTodoSnapshot')
}
