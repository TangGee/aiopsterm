import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type QuickCommandsBridge = Pick<
  AiopsPreloadApi,
  | 'getQuickCommands'
  | 'saveQuickCommandGroup'
  | 'deleteQuickCommandGroup'
  | 'saveQuickCommandSnippet'
  | 'saveQuickCommandMacro'
  | 'deleteQuickCommandSnippet'
  | 'reorderQuickCommands'
  | 'planQuickCommandScript'
>

const bridgeMethod = createBridgeMethod<QuickCommandsBridge>()

export const quickCommandsClient = {
  getQuickCommands: () => bridgeMethod('getQuickCommands'),
  saveQuickCommandGroup: () => bridgeMethod('saveQuickCommandGroup'),
  deleteQuickCommandGroup: () => bridgeMethod('deleteQuickCommandGroup'),
  saveQuickCommandSnippet: () => bridgeMethod('saveQuickCommandSnippet'),
  saveQuickCommandMacro: () => bridgeMethod('saveQuickCommandMacro'),
  deleteQuickCommandSnippet: () => bridgeMethod('deleteQuickCommandSnippet'),
  reorderQuickCommands: () => bridgeMethod('reorderQuickCommands'),
  planQuickCommandScript: () => bridgeMethod('planQuickCommandScript')
}
