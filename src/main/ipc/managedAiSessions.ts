import type { IpcMain } from 'electron'
import {
  bulkManagedAiSessions,
  clearManagedAiNotifications,
  clearManagedAiSession,
  deleteManagedAiSessionContentRecord,
  dismissManagedAiNotification,
  getAgentHibernationConfig,
  getManagedAiSessionContentRecord,
  hibernateManagedAiSession,
  jumpToUnreadManagedAiNotification,
  listManagedAiSessionContent,
  listManagedAiNotifications,
  listManagedAiSessions,
  markManagedAiNotificationRead,
  openManagedAiNotification,
  publishAiAgentSessionEvent,
  renameManagedAiSession,
  replyManagedAiSession,
  setAgentHibernationConfig,
  updateManagedAiSessionContentRecord,
  wakeManagedAiSession
} from '../backend/agent/agentSessions'
import type { AiAgentSessionEventInput, ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'

type RegisterManagedAiSessionsIpcInput = {
  emitAgentSessionEvent: Parameters<typeof publishAiAgentSessionEvent>[1]
  focusManagedAiSession: (request: ManagedAiSessionFocusRequest) => void
}

export const registerManagedAiSessionsIpc = (ipcMain: IpcMain, input: RegisterManagedAiSessionsIpcInput) => {
  ipcMain.handle('ai-agent:session-event', (_event, eventInput: AiAgentSessionEventInput) =>
    publishAiAgentSessionEvent(eventInput, input.emitAgentSessionEvent)
  )
  ipcMain.handle('ai-agent:sessions:list', () => listManagedAiSessions())
  ipcMain.handle('ai-agent:hibernation:config:get', () => getAgentHibernationConfig())
  ipcMain.handle('ai-agent:hibernation:config:set', (_event, configInput) => setAgentHibernationConfig(configInput))
  ipcMain.handle('ai-agent:sessions:hibernate', (_event, sessionInput) => hibernateManagedAiSession(sessionInput))
  ipcMain.handle('ai-agent:sessions:wake', (_event, sessionInput) => wakeManagedAiSession(sessionInput))
  ipcMain.handle('ai-agent:sessions:reply', (_event, replyInput) => replyManagedAiSession(replyInput))
  ipcMain.handle('ai-agent:sessions:rename', (_event, renameInput) => renameManagedAiSession(renameInput))
  ipcMain.handle('ai-agent:sessions:clear', (_event, clearInput) => clearManagedAiSession(clearInput))
  ipcMain.handle('ai-agent:sessions:bulk', (_event, bulkInput) => bulkManagedAiSessions(bulkInput))
  ipcMain.handle('ai-agent:sessions:content:list', (_event, listInput) => listManagedAiSessionContent(listInput))
  ipcMain.handle('ai-agent:sessions:content:get-record', (_event, recordInput) => getManagedAiSessionContentRecord(recordInput))
  ipcMain.handle('ai-agent:sessions:content:update-record', (_event, updateInput) => updateManagedAiSessionContentRecord(updateInput))
  ipcMain.handle('ai-agent:sessions:content:delete-record', (_event, deleteInput) => deleteManagedAiSessionContentRecord(deleteInput))
  ipcMain.handle('ai-agent:notifications:list', (_event, listInput) => listManagedAiNotifications(listInput))
  ipcMain.handle('ai-agent:notifications:mark-read', (_event, markReadInput) => markManagedAiNotificationRead(markReadInput))
  ipcMain.handle('ai-agent:notifications:dismiss', (_event, dismissInput) => dismissManagedAiNotification(dismissInput))
  ipcMain.handle('ai-agent:notifications:clear', () => clearManagedAiNotifications())
  ipcMain.handle('ai-agent:notifications:open', async (_event, openInput) => {
    const result = await openManagedAiNotification(openInput)
    if (result.ok && result.data?.focusRequest) input.focusManagedAiSession(result.data.focusRequest)
    return result
  })
  ipcMain.handle('ai-agent:notifications:jump-unread', async () => {
    const result = await jumpToUnreadManagedAiNotification()
    if (result.ok && result.data?.focusRequest) input.focusManagedAiSession(result.data.focusRequest)
    return result
  })
}
