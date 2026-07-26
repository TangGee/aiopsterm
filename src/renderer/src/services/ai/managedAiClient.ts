import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/common/preloadBridgeClient'

type ManagedAiBridge = Pick<
  AiopsPreloadApi,
  | 'publishAiAgentSessionEvent'
  | 'listManagedAiSessions'
  | 'replyManagedAiSession'
  | 'renameManagedAiSession'
  | 'clearManagedAiSession'
  | 'bulkManagedAiSessions'
  | 'listManagedAiSessionContent'
  | 'getManagedAiSessionContentRecord'
  | 'updateManagedAiSessionContentRecord'
  | 'deleteManagedAiSessionContentRecord'
  | 'getAgentHibernationConfig'
  | 'setAgentHibernationConfig'
  | 'hibernateManagedAiSession'
  | 'wakeManagedAiSession'
  | 'bindManagedAiSessionTerminal'
  | 'onAiAgentSessionEvent'
  | 'onManagedAiSessionEvent'
  | 'onManagedAiSessionFocusRequest'
>

const bridgeMethod = createBridgeMethod<ManagedAiBridge>()

export const managedAiClient = {
  publishAiAgentSessionEvent: () => bridgeMethod('publishAiAgentSessionEvent'),
  listManagedAiSessions: () => bridgeMethod('listManagedAiSessions'),
  replyManagedAiSession: () => bridgeMethod('replyManagedAiSession'),
  renameManagedAiSession: () => bridgeMethod('renameManagedAiSession'),
  clearManagedAiSession: () => bridgeMethod('clearManagedAiSession'),
  bulkManagedAiSessions: () => bridgeMethod('bulkManagedAiSessions'),
  listManagedAiSessionContent: () => bridgeMethod('listManagedAiSessionContent'),
  getManagedAiSessionContentRecord: () => bridgeMethod('getManagedAiSessionContentRecord'),
  updateManagedAiSessionContentRecord: () => bridgeMethod('updateManagedAiSessionContentRecord'),
  deleteManagedAiSessionContentRecord: () => bridgeMethod('deleteManagedAiSessionContentRecord'),
  getAgentHibernationConfig: () => bridgeMethod('getAgentHibernationConfig'),
  setAgentHibernationConfig: () => bridgeMethod('setAgentHibernationConfig'),
  hibernateManagedAiSession: () => bridgeMethod('hibernateManagedAiSession'),
  wakeManagedAiSession: () => bridgeMethod('wakeManagedAiSession'),
  bindManagedAiSessionTerminal: () => bridgeMethod('bindManagedAiSessionTerminal'),
  onAiAgentSessionEvent: () => bridgeMethod('onAiAgentSessionEvent'),
  onManagedAiSessionEvent: () => bridgeMethod('onManagedAiSessionEvent'),
  onManagedAiSessionFocusRequest: () => bridgeMethod('onManagedAiSessionFocusRequest')
}
