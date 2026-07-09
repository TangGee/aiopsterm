import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ManagedAiBridge = Pick<
  AiopsPreloadApi,
  | 'listManagedAiSessions'
  | 'replyManagedAiSession'
  | 'renameManagedAiSession'
  | 'clearManagedAiSession'
  | 'bulkManagedAiSessions'
  | 'listManagedAiSessionContent'
  | 'getManagedAiSessionContentRecord'
  | 'updateManagedAiSessionContentRecord'
  | 'getAgentHibernationConfig'
  | 'setAgentHibernationConfig'
  | 'hibernateManagedAiSession'
  | 'wakeManagedAiSession'
  | 'onAiAgentSessionEvent'
  | 'onManagedAiSessionEvent'
  | 'onManagedAiSessionFocusRequest'
>

const bridgeMethod = createBridgeMethod<ManagedAiBridge>()

export const managedAiClient = {
  listManagedAiSessions: () => bridgeMethod('listManagedAiSessions'),
  replyManagedAiSession: () => bridgeMethod('replyManagedAiSession'),
  renameManagedAiSession: () => bridgeMethod('renameManagedAiSession'),
  clearManagedAiSession: () => bridgeMethod('clearManagedAiSession'),
  bulkManagedAiSessions: () => bridgeMethod('bulkManagedAiSessions'),
  listManagedAiSessionContent: () => bridgeMethod('listManagedAiSessionContent'),
  getManagedAiSessionContentRecord: () => bridgeMethod('getManagedAiSessionContentRecord'),
  updateManagedAiSessionContentRecord: () => bridgeMethod('updateManagedAiSessionContentRecord'),
  getAgentHibernationConfig: () => bridgeMethod('getAgentHibernationConfig'),
  setAgentHibernationConfig: () => bridgeMethod('setAgentHibernationConfig'),
  hibernateManagedAiSession: () => bridgeMethod('hibernateManagedAiSession'),
  wakeManagedAiSession: () => bridgeMethod('wakeManagedAiSession'),
  onAiAgentSessionEvent: () => bridgeMethod('onAiAgentSessionEvent'),
  onManagedAiSessionEvent: () => bridgeMethod('onManagedAiSessionEvent'),
  onManagedAiSessionFocusRequest: () => bridgeMethod('onManagedAiSessionFocusRequest')
}
