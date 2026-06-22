import { createWorkspaceAgentHookInstallerRuntime } from '@/services/workspaceAgentHookInstallerRuntime'
import { createWorkspaceManagedAiAttentionRuntime } from '@/services/workspaceManagedAiAttentionRuntime'
import { createWorkspaceManagedAiHibernationRuntime } from '@/services/workspaceManagedAiHibernationRuntime'
import { createWorkspaceManagedAiSessionRuntime } from '@/services/workspaceManagedAiSessionRuntime'
import type {
  WorkspaceManagedAiControllerDeps,
  WorkspaceManagedAiControllerState
} from '@/services/workspaceManagedAiTypes'

export type {
  AiAttentionFocusRequest,
  AiAttentionInput,
  AiAttentionItem,
  AiAttentionKind,
  AiAttentionSource,
  ManagedAiSession,
  ManagedAiSessionState
} from '@/services/workspaceManagedAiTypes'
export { defaultAgentHibernationConfig } from '@/services/workspaceManagedAiTypes'

export const createWorkspaceManagedAiController = (
  state: WorkspaceManagedAiControllerState,
  deps: WorkspaceManagedAiControllerDeps
) => {
  const {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    aiAttentionFocusRequest
  } = state
  const { setTopNotice, i18nText, runTerminalCommand } = deps

  const agentHookRuntime = createWorkspaceAgentHookInstallerRuntime({
    state: {
      agentHookInstallers: state.agentHookInstallers,
      agentHookInstallersLoading: state.agentHookInstallersLoading,
      agentHookInstallerBusySource: state.agentHookInstallerBusySource,
      agentHookInstallerError: state.agentHookInstallerError
    },
    setTopNotice,
    i18nText
  })

  const attentionRuntime = createWorkspaceManagedAiAttentionRuntime({
    state: {
      mode: state.mode,
      activeModule: state.activeModule,
      activePanelId: state.activePanelId,
      panels: state.panels,
      notificationSettings: state.notificationSettings,
      aiAttentionItems: state.aiAttentionItems,
      controlNotifications: state.controlNotifications
    },
    setTopNotice
  })

  const sessionRuntime = createWorkspaceManagedAiSessionRuntime({
    state: {
      mode: state.mode,
      activeModule: state.activeModule,
      leftPanelOpen: state.leftPanelOpen,
      activePanelId: state.activePanelId,
      panels: state.panels,
      aiAttentionItems: state.aiAttentionItems,
      managedAiSessions: state.managedAiSessions,
      managedAiSessionsLoading: state.managedAiSessionsLoading,
      managedAiSessionsError: state.managedAiSessionsError,
      managedAiSessionFocusRequest: state.managedAiSessionFocusRequest,
      selectedManagedAiSessionKey: state.selectedManagedAiSessionKey
    },
    attention: attentionRuntime,
    setTopNotice,
    i18nText
  })

  const hibernationRuntime = createWorkspaceManagedAiHibernationRuntime({
    state: {
      agentHibernationConfig: state.agentHibernationConfig,
      managedAiSessions: state.managedAiSessions,
      panels: state.panels
    },
    setTopNotice,
    i18nText,
    applyManagedAiSessionSnapshot: sessionRuntime.applyManagedAiSessionSnapshot,
    focusManagedAiSession: sessionRuntime.focusManagedAiSession,
    runTerminalCommand
  })

  const jumpToNextAiAttention = () => {
    const item = attentionRuntime.currentAiAttentionItem.value
    if (!item) {
      mode.value = 'terminal'
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
      setTopNotice(i18nText('aiSessions.notice.noPendingMessages'))
      return null
    }
    const managedSession = item.id.startsWith('managed-ai:') && item.sessionId ? sessionRuntime.focusManagedAiSession(item.sessionId) : null
    if (managedSession) {
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
    } else if (item.notificationId) {
      void attentionRuntime.openControlNotification(item.notificationId)
    } else if (item.surfaceId === 'terminal-ai-panel') {
      mode.value = 'terminal'
      activeModule.value = 'workspace'
      rightPanelOpen.value = true
    } else {
      mode.value = 'agents'
      agentsLeftOpen.value = true
    }
    aiAttentionFocusRequest.value = {
      sequence: aiAttentionFocusRequest.value.sequence + 1,
      item
    }
    return item
  }

  return {
    pendingAiAttentionItems: attentionRuntime.pendingAiAttentionItems,
    aiAttentionUnreadCount: attentionRuntime.aiAttentionUnreadCount,
    currentAiAttentionItem: attentionRuntime.currentAiAttentionItem,
    sortedManagedAiSessions: sessionRuntime.sortedManagedAiSessions,
    managedAiNeedsInputSessions: sessionRuntime.managedAiNeedsInputSessions,
    selectedManagedAiSession: sessionRuntime.selectedManagedAiSession,
    upsertAiAttentionItem: attentionRuntime.upsertAiAttentionItem,
    removeAiAttentionItem: attentionRuntime.removeAiAttentionItem,
    markAiAttentionHandled: attentionRuntime.markAiAttentionHandled,
    clearAiAttentionForConversation: attentionRuntime.clearAiAttentionForConversation,
    refreshControlNotificationAttentionItems: attentionRuntime.refreshControlNotificationAttentionItems,
    applyControlNotificationSnapshot: attentionRuntime.applyControlNotificationSnapshot,
    focusControlNotification: attentionRuntime.focusControlNotification,
    openControlNotification: attentionRuntime.openControlNotification,
    jumpToNextAiAttention,
    refreshAgentHookInstallers: agentHookRuntime.refreshAgentHookInstallers,
    installAgentHookInstaller: agentHookRuntime.installAgentHookInstaller,
    uninstallAgentHookInstaller: agentHookRuntime.uninstallAgentHookInstaller,
    refreshManagedAiSessions: sessionRuntime.refreshManagedAiSessions,
    refreshManagedAiSessionsDebounced: sessionRuntime.refreshManagedAiSessionsDebounced,
    applyManagedAiSessionSnapshot: sessionRuntime.applyManagedAiSessionSnapshot,
    upsertManagedAiSession: sessionRuntime.upsertManagedAiSession,
    markManagedAiSessionHandled: sessionRuntime.markManagedAiSessionHandled,
    replyManagedAiSession: sessionRuntime.replyManagedAiSession,
    renameManagedAiSession: sessionRuntime.renameManagedAiSession,
    clearManagedAiSession: sessionRuntime.clearManagedAiSession,
    bulkManagedAiSessions: sessionRuntime.bulkManagedAiSessions,
    refreshAgentHibernationConfig: hibernationRuntime.refreshAgentHibernationConfig,
    updateAgentHibernationConfig: hibernationRuntime.updateAgentHibernationConfig,
    setAgentHibernationEnabled: hibernationRuntime.setAgentHibernationEnabled,
    hibernateManagedAiSession: hibernationRuntime.hibernateManagedAiSession,
    managedAiSessionNeedsAttentionForPanel: sessionRuntime.managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession: sessionRuntime.focusManagedAiSession,
    focusManagedAiSessionRequest: sessionRuntime.focusManagedAiSessionRequest,
    resumeManagedAiSession: hibernationRuntime.resumeManagedAiSession,
    touchManagedAiTerminalActivity: sessionRuntime.touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle: sessionRuntime.applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit: sessionRuntime.applyManagedAiTerminalExit
  }
}
