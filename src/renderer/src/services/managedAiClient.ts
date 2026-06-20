import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type ManagedAiBridge = Pick<AiopsPreloadApi, 'listManagedAiSessions' | 'replyManagedAiSession'>

const bridgeMethod = <Name extends keyof ManagedAiBridge>(name: Name): ManagedAiBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as ManagedAiBridge[Name]) : undefined
}

export const managedAiClient = {
  listManagedAiSessions: () => bridgeMethod('listManagedAiSessions'),
  replyManagedAiSession: () => bridgeMethod('replyManagedAiSession')
}
