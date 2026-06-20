import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type AiCatalogBridge = Pick<AiopsPreloadApi, 'listAiContextCatalog' | 'listAiCommandCatalog' | 'listAiTodoSnapshot'>

const bridgeMethod = createBridgeMethod<AiCatalogBridge>()

export const aiCatalogClient = {
  listAiContextCatalog: () => bridgeMethod('listAiContextCatalog'),
  listAiCommandCatalog: () => bridgeMethod('listAiCommandCatalog'),
  listAiTodoSnapshot: () => bridgeMethod('listAiTodoSnapshot')
}
