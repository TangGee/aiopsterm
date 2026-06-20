import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

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

const bridgeMethod = <Name extends keyof QuickCommandsBridge>(name: Name): QuickCommandsBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as QuickCommandsBridge[Name]) : undefined
}

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
