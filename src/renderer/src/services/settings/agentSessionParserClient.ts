import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type AgentSessionParserBridge = Pick<
  AiopsPreloadApi,
  'listAgentSessionParsers' | 'importAgentSessionParser' | 'removeAgentSessionParser'
>

const bridgeMethod = createBridgeMethod<AgentSessionParserBridge>()

export const agentSessionParserClient = {
  list: () => bridgeMethod('listAgentSessionParsers'),
  import: () => bridgeMethod('importAgentSessionParser'),
  remove: () => bridgeMethod('removeAgentSessionParser')
}
