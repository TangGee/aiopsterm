import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type AliasBridge = Pick<AiopsPreloadApi, 'listAliasCommands' | 'saveAliasCommand' | 'deleteAliasCommand'>

const bridgeMethod = createBridgeMethod<AliasBridge>()

export const aliasClient = {
  listAliasCommands: () => bridgeMethod('listAliasCommands'),
  saveAliasCommand: () => bridgeMethod('saveAliasCommand'),
  deleteAliasCommand: () => bridgeMethod('deleteAliasCommand')
}
