import { createWorkspaceAgentHookInstallerRuntime } from '@/services/settings/workspaceAgentHookInstallerRuntime'
import { createWorkspaceExportMcpInstallerRuntime } from '@/services/settings/workspaceExportMcpInstallerRuntime'
import { createWorkspaceManagedAiAttentionRuntime } from '@/services/ai/workspaceManagedAiAttentionRuntime'
import { createWorkspaceManagedAiHibernationRuntime } from '@/services/ai/workspaceManagedAiHibernationRuntime'
import { createWorkspaceManagedAiSessionRuntime } from '@/services/ai/workspaceManagedAiSessionRuntime'
import type {
  WorkspaceManagedAiControllerDeps,
  WorkspaceManagedAiControllerState
} from '@/services/ai/workspaceManagedAiTypes'
import type { ManagedAiSessionFocusRequest } from '@shared/contracts/managedAiSessions'

export type {
  AiAttentionFocusRequest,
  AiAttentionInput,
  AiAttentionItem,
  AiAttentionKind,
  AiAttentionSource,
  ManagedAiSession,
  ManagedAiSessionState
} from '@/services/ai/workspaceManagedAiTypes'
export { defaultAgentHibernationConfig } from '@/services/ai/workspaceManagedAiTypes'

export const createWorkspaceManagedAiController = (
  state: WorkspaceManagedAiControllerState,
  deps: WorkspaceManagedAiControllerDeps
) => {
  const {
    mode,
    activeModule,
    activeCenterSurface,
    rightPanelOpen,
    agentsLeftOpen,
    aiAttentionFocusRequest
  } = state
  const { setTopNotice, i18nText, activatePanelSurface, runTerminalCommand } = deps
  let openLocalTerminalPanel = deps.openLocalTerminalPanel
  let focusManagedAiSessionFromNotification = (_request: ManagedAiSessionFocusRequest) => false

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

  const exportMcpRuntime = createWorkspaceExportMcpInstallerRuntime({
    state: {
      exportMcpInstallers: state.exportMcpInstallers,
      exportMcpInstallerBridge: state.exportMcpInstallerBridge,
      exportMcpInstallersLoading: state.exportMcpInstallersLoading,
      exportMcpInstallerBusySource: state.exportMcpInstallerBusySource,
      exportMcpInstallerError: state.exportMcpInstallerError
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
    setTopNotice,
    activatePanelSurface,
    focusManagedAiSession: (request) => focusManagedAiSessionFromNotification(request)
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
    i18nText,
    activatePanelSurface
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
    openLocalTerminalPanel: async (options) => openLocalTerminalPanel?.(options) ?? null,
    runTerminalCommand
  })

  focusManagedAiSessionFromNotification = (request) => {
    const focused =
      (request.sessionId ? sessionRuntime.focusManagedAiSession(request.sessionId) : null) ||
      (request.panelId ? sessionRuntime.focusManagedAiSession(request.panelId) : null) ||
      (request.terminalSessionId ? sessionRuntime.focusManagedAiSession(request.terminalSessionId) : null)
    if (!focused) return false
    activeModule.value = 'aiSessions'
    return true
  }

  let lastJumpedAiAttentionId = ''

  const nextManagedAiAttentionItem = () => {
    const pending = attentionRuntime.pendingAiAttentionItems.value
    const managedPending = pending.filter((item) => item.id.startsWith('managed-ai:'))
    const queue = managedPending.length ? managedPending : pending
    if (!queue.length) return null
    const selectedManagedId = sessionRuntime.selectedManagedAiSession.value ? `managed-ai:${sessionRuntime.selectedManagedAiSession.value.source}:${sessionRuntime.selectedManagedAiSession.value.id}` : ''
    const currentId = queue.some((item) => item.id === lastJumpedAiAttentionId) ? lastJumpedAiAttentionId : selectedManagedId
    const currentIndex = queue.findIndex((item) => item.id === currentId)
    return queue[(currentIndex + 1) % queue.length]
  }

  const jumpToNextAiAttention = () => {
    const item = nextManagedAiAttentionItem()
    if (!item) {
      mode.value = 'terminal'
      activeModule.value = 'aiSessions'
      setTopNotice(i18nText('aiSessions.notice.noPendingMessages'))
      return null
    }
    lastJumpedAiAttentionId = item.id
    const managedSession = item.id.startsWith('managed-ai:') && item.sessionId ? sessionRuntime.focusManagedAiSession(item.sessionId) : null
    if (managedSession) {
      activeModule.value = 'aiSessions'
    } else if (item.notificationId) {
      void attentionRuntime.openControlNotification(item.notificationId)
    } else if (item.surfaceId === 'terminal-ai-panel') {
      mode.value = 'terminal'
      activeCenterSurface.value = 'main-workspace'
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
    refreshExportMcpInstallers: exportMcpRuntime.refreshExportMcpInstallers,
    installExportMcpInstaller: exportMcpRuntime.installExportMcpInstaller,
    uninstallExportMcpInstaller: exportMcpRuntime.uninstallExportMcpInstaller,
    copyExportMcpConfig: exportMcpRuntime.copyExportMcpConfig,
    resetExportMcpToken: exportMcpRuntime.resetExportMcpToken,
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
    bindManagedAiSessionLocalTerminalOpener: (opener: typeof openLocalTerminalPanel) => {
      openLocalTerminalPanel = opener
    },
    touchManagedAiTerminalActivity: sessionRuntime.touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle: sessionRuntime.applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit: sessionRuntime.applyManagedAiTerminalExit,
    applyManagedAiTerminalPanelClosed: sessionRuntime.applyManagedAiTerminalPanelClosed
  }
}
