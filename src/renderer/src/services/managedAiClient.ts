import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type ManagedAiBridge = Pick<
  AiopsPreloadApi,
  | 'listManagedAiSessions'
  | 'replyManagedAiSession'
  | 'renameManagedAiSession'
  | 'clearManagedAiSession'
  | 'bulkManagedAiSessions'
  | 'getAgentHibernationConfig'
  | 'setAgentHibernationConfig'
  | 'hibernateManagedAiSession'
  | 'wakeManagedAiSession'
>

const bridgeMethod = <Name extends keyof ManagedAiBridge>(name: Name): ManagedAiBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ManagedAiBridge[Name]) : undefined
}

export const managedAiClient = {
  listManagedAiSessions: () => bridgeMethod('listManagedAiSessions'),
  replyManagedAiSession: () => bridgeMethod('replyManagedAiSession'),
  renameManagedAiSession: () => bridgeMethod('renameManagedAiSession'),
  clearManagedAiSession: () => bridgeMethod('clearManagedAiSession'),
  bulkManagedAiSessions: () => bridgeMethod('bulkManagedAiSessions'),
  getAgentHibernationConfig: () => bridgeMethod('getAgentHibernationConfig'),
  setAgentHibernationConfig: () => bridgeMethod('setAgentHibernationConfig'),
  hibernateManagedAiSession: () => bridgeMethod('hibernateManagedAiSession'),
  wakeManagedAiSession: () => bridgeMethod('wakeManagedAiSession')
}
