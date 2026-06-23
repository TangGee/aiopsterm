import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type AgentHookBridge = Pick<AiopsPreloadApi, 'listAgentHookInstallers' | 'installAgentHook' | 'uninstallAgentHook'>

const bridgeMethod = createBridgeMethod<AgentHookBridge>()

export const agentHookClient = {
  listAgentHookInstallers: () => bridgeMethod('listAgentHookInstallers'),
  installAgentHook: () => bridgeMethod('installAgentHook'),
  uninstallAgentHook: () => bridgeMethod('uninstallAgentHook')
}
