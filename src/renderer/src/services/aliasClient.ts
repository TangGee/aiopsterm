import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type AliasBridge = Pick<AiopsPreloadApi, 'listAliasCommands' | 'saveAliasCommand' | 'deleteAliasCommand'>

const bridgeMethod = <Name extends keyof AliasBridge>(name: Name): AliasBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as AliasBridge[Name]) : undefined
}

export const aliasClient = {
  listAliasCommands: () => bridgeMethod('listAliasCommands'),
  saveAliasCommand: () => bridgeMethod('saveAliasCommand'),
  deleteAliasCommand: () => bridgeMethod('deleteAliasCommand')
}
