import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type AgentHookBridge = Pick<AiopsPreloadApi, 'listAgentHookInstallers' | 'installAgentHook' | 'uninstallAgentHook'>

const bridgeMethod = <Name extends keyof AgentHookBridge>(name: Name): AgentHookBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as AgentHookBridge[Name]) : undefined
}

export const agentHookClient = {
  listAgentHookInstallers: () => bridgeMethod('listAgentHookInstallers'),
  installAgentHook: () => bridgeMethod('installAgentHook'),
  uninstallAgentHook: () => bridgeMethod('uninstallAgentHook')
}
