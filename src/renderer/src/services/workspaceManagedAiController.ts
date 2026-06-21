import { computed, type Ref } from 'vue'
import { agentHookClient } from '@/services/agentHookClient'
import { controlClient } from '@/services/controlClient'
import { managedAiClient } from '@/services/managedAiClient'
import {
  isAgentHibernationConfigData,
  isAgentHookInstallOperationData,
  isAgentHookInstallerSnapshot,
  isManagedAiSessionBulkData,
  isManagedAiSessionHibernateData,
  isManagedAiSessionMutationData,
  isManagedAiSessionSnapshot
} from '@/services/managedAiBackendGuards'
import { terminalClient } from '@/services/terminalClient'
import type { ModuleKey } from '@/config/navigation'
import type { I18nKey } from '@/i18n/messages'
import type { NotificationUserConfig } from '@shared/contracts/appRuntime'
import type {
  AiAgentSessionEvent,
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionDecision,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import type { ControlNotificationFocusRequest, ControlNotificationRecord } from '@shared/contracts/control'
import type { AgentHookInstallerSource, AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { TerminalExitEvent, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import type { TerminalCommandExecutionOptions, TerminalSecurityDecision } from '@/services/terminalExecutionRuntime'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'

export type AiAttentionKind = 'approval' | 'question' | 'plan' | 'error' | 'done'
export type AiAttentionSource = AiAgentSessionSource | 'classic-chat' | 'control-notification'
export type AiAttentionItem = {
  id: string
  source: AiAttentionSource
  kind: AiAttentionKind
  title: string
  summary: string
  priority: number
  createdAt: number
  conversationId?: string
  sessionId?: string
  surfaceId?: string
  notificationId?: string
  handledAt?: number
}
export type AiAttentionInput = Omit<AiAttentionItem, 'createdAt' | 'priority'> & {
  createdAt?: number
  priority?: number
}
export type AiAttentionFocusRequest = {
  sequence: number
  item: AiAttentionItem | null
}
export type ManagedAiSessionState = ManagedAiSessionRecord['state']
export type ManagedAiSession = ManagedAiSessionRecord

export const defaultAgentHibernationConfig: AgentHibernationConfig = {
  enabled: false,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}

type WorkspaceManagedAiControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
  notificationSettings: Ref<NotificationUserConfig>
  aiAttentionItems: Ref<AiAttentionItem[]>
  controlNotifications: Ref<ControlNotificationRecord[]>
  aiAttentionFocusRequest: Ref<AiAttentionFocusRequest>
  managedAiSessions: Ref<ManagedAiSession[]>
  agentHibernationConfig: Ref<AgentHibernationConfig>
  managedAiSessionsLoading: Ref<boolean>
  managedAiSessionsError: Ref<string>
  managedAiSessionFocusRequest: Ref<{ sequence: number; session: ManagedAiSession | null }>
  selectedManagedAiSessionKey: Ref<string>
  agentHookInstallers: Ref<AgentHookInstallerStatus[]>
  agentHookInstallersLoading: Ref<boolean>
  agentHookInstallerBusySource: Ref<AgentHookInstallerSource | ''>
  agentHookInstallerError: Ref<string>
}

type WorkspaceManagedAiControllerDeps = {
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
  runTerminalCommand: (
    panelId: string,
    command: string,
    options?: TerminalCommandExecutionOptions
  ) => Promise<TerminalSecurityDecision>
}

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
    activePanelId,
    panels,
    notificationSettings,
    aiAttentionItems,
    controlNotifications,
    aiAttentionFocusRequest,
    managedAiSessions,
    agentHibernationConfig,
    managedAiSessionsLoading,
    managedAiSessionsError,
    managedAiSessionFocusRequest,
    selectedManagedAiSessionKey,
    agentHookInstallers,
    agentHookInstallersLoading,
    agentHookInstallerBusySource,
    agentHookInstallerError
  } = state
  const { setTopNotice, i18nText, runTerminalCommand } = deps

  const applyAgentHookInstallerSnapshot = (snapshot: { installers: AgentHookInstallerStatus[] }) => {
    agentHookInstallers.value = snapshot.installers.map((installer) => ({
      ...installer,
      warnings: [...installer.warnings]
    }))
    agentHookInstallerError.value = ''
  }

  const refreshAgentHookInstallers = async (options: { silent?: boolean } = {}) => {
    const listAgentHookInstallers = agentHookClient.listAgentHookInstallers()
    if (!listAgentHookInstallers) {
      agentHookInstallerError.value = i18nText('settings.ai.agentHook.serviceUnavailable')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    }
    agentHookInstallersLoading.value = true
    try {
      const result = await listAgentHookInstallers()
      if (!result?.ok) {
        agentHookInstallerError.value = result?.errorMessage || i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      if (!isAgentHookInstallerSnapshot(result.data)) {
        agentHookInstallerError.value = i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('settings.ai.agentHook.statusRefreshed'))
      return true
    } catch (error) {
      agentHookInstallerError.value = error instanceof Error ? error.message : i18nText('settings.ai.agentHook.statusLoadFailed')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    } finally {
      agentHookInstallersLoading.value = false
    }
  }

  const runAgentHookInstallerOperation = async (source: AgentHookInstallerSource, operation: 'install' | 'uninstall') => {
    const runOperation = operation === 'install' ? agentHookClient.installAgentHook() : agentHookClient.uninstallAgentHook()
    if (!runOperation) {
      setTopNotice(i18nText('settings.ai.agentHook.serviceUnavailable'))
      return false
    }
    agentHookInstallerBusySource.value = source
    agentHookInstallerError.value = ''
    try {
      const result = await runOperation({ source })
      if (!result?.ok) {
        const message =
          result?.errorMessage ||
          (operation === 'install'
            ? i18nText('settings.ai.agentHook.installFailed')
            : i18nText('settings.ai.agentHook.uninstallFailed'))
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      if (!isAgentHookInstallOperationData(result.data)) {
        const message =
          operation === 'install'
            ? i18nText('settings.ai.agentHook.installMalformed')
            : i18nText('settings.ai.agentHook.uninstallMalformed')
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data.snapshot)
      setTopNotice(
        i18nText(operation === 'install' ? 'settings.ai.agentHook.installedNotice' : 'settings.ai.agentHook.uninstalledNotice', {
          label: result.data.status.label
        })
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : operation === 'install'
            ? i18nText('settings.ai.agentHook.installFailed')
            : i18nText('settings.ai.agentHook.uninstallFailed')
      agentHookInstallerError.value = message
      setTopNotice(message)
      return false
    } finally {
      agentHookInstallerBusySource.value = ''
    }
  }

  const installAgentHookInstaller = (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'install')
  const uninstallAgentHookInstaller = (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'uninstall')

  const attentionPriority = (kind: AiAttentionKind) => {
    if (kind === 'approval') return 100
    if (kind === 'question') return 90
    if (kind === 'plan') return 80
    if (kind === 'error') return 70
    return 40
  }

  const pendingAiAttentionItems = computed(() =>
    [...aiAttentionItems.value]
      .filter((item) => !item.handledAt)
      .sort((first, second) => {
        if (second.priority !== first.priority) return second.priority - first.priority
        return first.createdAt - second.createdAt
      })
  )
  const aiAttentionUnreadCount = computed(() => pendingAiAttentionItems.value.length)
  const currentAiAttentionItem = computed(() => pendingAiAttentionItems.value[0] || null)

  const upsertAiAttentionItem = (input: AiAttentionInput) => {
    const title = input.title.trim()
    const summary = input.summary.trim()
    const existing = aiAttentionItems.value.find((item) => item.id === input.id)
    const handledAt = 'handledAt' in input ? input.handledAt : undefined
    const next: AiAttentionItem = {
      id: input.id,
      source: input.source,
      kind: input.kind,
      title: title || input.source,
      summary,
      priority: input.priority ?? attentionPriority(input.kind),
      createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
      ...(handledAt ? { handledAt } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
      ...(input.notificationId ? { notificationId: input.notificationId } : {})
    }
    aiAttentionItems.value = existing ? aiAttentionItems.value.map((item) => (item.id === input.id ? next : item)) : [next, ...aiAttentionItems.value]
    return next
  }

  const removeAiAttentionItem = (id: string) => {
    const before = aiAttentionItems.value.length
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.id !== id)
    return aiAttentionItems.value.length !== before
  }

  const markAiAttentionHandled = (id: string) => {
    let changed = false
    aiAttentionItems.value = aiAttentionItems.value.map((item) => {
      if (item.id !== id || item.handledAt) return item
      changed = true
      return { ...item, handledAt: Date.now() }
    })
    return changed
  }

  const clearAiAttentionForConversation = (conversationId: string) => {
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.conversationId !== conversationId)
  }

  const controlNotificationAttentionId = (notification: Pick<ControlNotificationRecord, 'id'>) => `notification:${notification.id}`

  const refreshControlNotificationAttentionItems = () => {
    const notificationIds = new Set(controlNotifications.value.map(controlNotificationAttentionId))
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => !item.id.startsWith('notification:') || notificationIds.has(item.id))
    if (!notificationSettings.value.controlNotificationBell) {
      controlNotifications.value.forEach((notification) => removeAiAttentionItem(controlNotificationAttentionId(notification)))
      return
    }
    controlNotifications.value.forEach((notification) => {
      const id = controlNotificationAttentionId(notification)
      if (!notification.read) {
        upsertAiAttentionItem({
          id,
          source: 'control-notification',
          kind: notification.level === 'approval' ? 'approval' : notification.level === 'error' || notification.level === 'warning' ? 'error' : 'done',
          title: notification.source ? `${notification.source}: ${notification.title}` : notification.title,
          summary: [notification.group, notification.level && notification.level !== 'info' ? notification.level : '', notification.subtitle, notification.body].filter(Boolean).join(' · '),
          sessionId: notification.sessionId || notification.terminalSessionId,
          surfaceId: notification.panelId || notification.sessionId || notification.terminalSessionId,
          notificationId: notification.id,
          createdAt: notification.createdAt,
          priority: notification.level === 'approval' || notification.level === 'error' ? 60 : notification.level === 'warning' ? 45 : 30
        })
      } else {
        removeAiAttentionItem(id)
      }
    })
  }

  const applyControlNotificationSnapshot = (notifications: ControlNotificationRecord[] = []) => {
    controlNotifications.value = notifications.map((notification) => ({ ...notification }))
    refreshControlNotificationAttentionItems()
  }

  const focusControlNotification = (request: ControlNotificationFocusRequest | ControlNotificationRecord) => {
    const notification = 'notification' in request ? request.notification : request
    const panelId = 'panelId' in request && request.panelId ? request.panelId : notification.panelId
    const sessionId = 'sessionId' in request && request.sessionId ? request.sessionId : notification.sessionId || notification.terminalSessionId
    const target = panels.value.find((panel) => panel.kind !== 'knowledge' && (panel.id === panelId || panel.sessionId === sessionId))
    if (!target) {
      setTopNotice(`通知已打开：${notification.title}`)
      return false
    }
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    markAiAttentionHandled(controlNotificationAttentionId(notification))
    setTopNotice(`已定位通知：${notification.title}`)
    return true
  }

  const openControlNotification = async (notificationId: string) => {
    const bridge = controlClient.invokeControlRequest()
    if (!bridge) {
      const notification = controlNotifications.value.find((item) => item.id === notificationId)
      if (notification) return focusControlNotification(notification)
      return false
    }
    try {
      const result = await bridge('notification.open', { id: notificationId })
      if (!result?.ok) {
        setTopNotice(result?.errorMessage || '通知打开失败')
        return false
      }
      const data = result.data || {}
      if (Array.isArray(data.notifications)) applyControlNotificationSnapshot(data.notifications as ControlNotificationRecord[])
      const focusRequest = data.focusRequest as ControlNotificationFocusRequest | undefined
      if (focusRequest?.notification) focusControlNotification(focusRequest)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '通知打开失败')
      return false
    }
  }

  const aiSessionAttentionId = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `managed-ai:${session.source}:${session.id}`
  const managedAiSessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

  const managedAiSessionNeedsInputForEvent = (event: AiAgentSessionEvent) => {
    const requestKind = managedAiRequestKindForEvent(event)
    const decisionMode = managedAiDecisionModeForEvent(event)
    if (event.source === 'codex' && event.event === 'permission_request') return false
    if (requestKind === 'telemetry') return false
    if (decisionMode === 'blocking') return true
    if (requestKind === 'notification') return true
    return event.actionable === true
  }

  const managedAiSessionStateForEvent = (event: AiAgentSessionEvent, previous: ManagedAiSessionState = 'unknown'): ManagedAiSessionState => {
    const lifecycle = event.agentLifecycle
    if (lifecycle === 'running') return 'working'
    if (lifecycle === 'idle') return 'idle'
    if (lifecycle === 'needsInput') return 'needsInput'
    if (lifecycle === 'ended') return 'ended'
    if (lifecycle === 'unknown') return 'unknown'
    if (event.event === 'session_start') return 'idle'
    if (event.event === 'prompt_submit' || event.event === 'pre_tool_use') return 'working'
    if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return managedAiSessionNeedsInputForEvent(event) ? 'needsInput' : 'working'
    if (event.event === 'stop') return 'idle'
    if (event.event === 'session_end') return 'ended'
    return previous
  }

  const managedAiRequestKindForEvent = (event: AiAgentSessionEvent): ManagedAiSession['requestKind'] => {
    if (event.requestKind) return event.requestKind
    if (event.event === 'permission_request') return 'permission'
    if (event.event === 'question') return 'question'
    if (event.event === 'notification') return 'notification'
    return 'telemetry'
  }

  const managedAiDecisionModeForEvent = (event: AiAgentSessionEvent): ManagedAiSession['decisionMode'] => {
    if (event.decisionMode) return event.decisionMode
    if (event.actionable === true) return 'local'
    return managedAiRequestKindForEvent(event) === 'telemetry' ? 'telemetry' : 'local'
  }

  const managedAiAttentionKindForSession = (session: Pick<ManagedAiSession, 'requestKind' | 'lastEvent'>): AiAttentionKind => {
    if (session.requestKind === 'plan') return 'plan'
    if (session.requestKind === 'permission' || session.lastEvent === 'permission_request') return 'approval'
    if (session.requestKind === 'notification') return 'done'
    return 'question'
  }

  const sortedManagedAiSessions = computed(() => [...managedAiSessions.value].sort((first, second) => second.lastActivityAt - first.lastActivityAt))
  const managedAiNeedsInputSessions = computed(() => sortedManagedAiSessions.value.filter((session) => session.state === 'needsInput'))
  const selectedManagedAiSession = computed(() => sortedManagedAiSessions.value.find((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value) || null)
  const managedAiAttentionPanelIds = computed(() => {
    const ids = new Set<string>()
    managedAiNeedsInputSessions.value.forEach((session) => {
      if (session.panelId) ids.add(session.panelId)
      if (session.terminalSessionId) ids.add(session.terminalSessionId)
    })
    return ids
  })

  const refreshManagedAiAttentionItems = () => {
    const managedIds = new Set(managedAiSessions.value.map(aiSessionAttentionId))
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => !item.id.startsWith('managed-ai:') || managedIds.has(item.id))
    managedAiSessions.value.forEach((session) => {
      const id = aiSessionAttentionId(session)
      if (session.state === 'needsInput') {
        upsertAiAttentionItem({
          id,
          source: session.source,
          kind: managedAiAttentionKindForSession(session),
          title: session.title,
          summary: session.summary,
          sessionId: session.id,
          surfaceId: session.panelId || session.terminalSessionId,
          createdAt: session.lastActivityAt,
          ...(session.handledAt ? { handledAt: session.handledAt } : {})
        })
      } else {
        removeAiAttentionItem(id)
      }
    })
  }

  const applyManagedAiSessionSnapshot = (snapshot: ManagedAiSessionSnapshot) => {
    managedAiSessions.value = snapshot.sessions.map((session) => ({
      ...session,
      requestKind:
        session.requestKind ||
        (session.lastEvent === 'permission_request'
          ? 'permission'
          : session.lastEvent === 'question'
            ? 'question'
            : session.lastEvent === 'notification'
              ? 'notification'
              : 'telemetry'),
      decisionMode: session.decisionMode || (session.actionable === true ? 'local' : 'telemetry'),
      events: session.events.map((event) => {
        const requestKind =
          event.requestKind ||
          (event.event === 'permission_request'
            ? 'permission'
            : event.event === 'question'
              ? 'question'
              : event.event === 'notification'
                ? 'notification'
                : 'telemetry')
        return {
          ...event,
          requestKind,
          decisionMode: event.decisionMode || (event.actionable === true ? 'local' : requestKind === 'telemetry' ? 'telemetry' : 'local'),
          raw: event.raw ? { ...event.raw } : undefined
        }
      }),
      decisions: session.decisions.map((decision) => ({ ...decision }))
    }))
    managedAiSessionsError.value = ''
    if (selectedManagedAiSessionKey.value && !managedAiSessions.value.some((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value)) {
      selectedManagedAiSessionKey.value = ''
    }
    refreshManagedAiAttentionItems()
  }

  const refreshManagedAiSessions = async (options: { silent?: boolean } = {}) => {
    const listManagedAiSessions = managedAiClient.listManagedAiSessions()
    if (!listManagedAiSessions) {
      managedAiSessionsError.value = i18nText('aiSessions.notice.serviceUnavailable')
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    }
    managedAiSessionsLoading.value = true
    try {
      const result = (await listManagedAiSessions()) as ManagedAiSessionListResult
      if (!result?.ok || !isManagedAiSessionSnapshot(result.data)) {
        managedAiSessionsError.value = result?.errorMessage || i18nText('aiSessions.notice.listFailed')
        if (!options.silent) setTopNotice(managedAiSessionsError.value)
        return false
      }
      applyManagedAiSessionSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('aiSessions.notice.refreshed'))
      return true
    } catch (error) {
      managedAiSessionsError.value = error instanceof Error ? error.message : i18nText('aiSessions.notice.listFailed')
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    } finally {
      managedAiSessionsLoading.value = false
    }
  }

  let managedAiSessionRefreshQueued = false
  const refreshManagedAiSessionsDebounced = () => {
    if (managedAiSessionRefreshQueued) return
    managedAiSessionRefreshQueued = true
    queueMicrotask(() => {
      managedAiSessionRefreshQueued = false
      void refreshManagedAiSessions({ silent: true })
    })
  }

  const upsertManagedAiSession = (event: AiAgentSessionEvent) => {
    const existing = managedAiSessions.value.find((session) => session.source === event.source && session.id === event.sessionId)
    const now = Date.now()
    const requestKind = managedAiRequestKindForEvent(event)
    const decisionMode = event.decisionMode || (event.actionable === true ? 'local' : requestKind === 'telemetry' ? 'telemetry' : 'local')
    const timelineEvent: ManagedAiSessionTimelineEvent = {
      ...event,
      requestKind,
      decisionMode,
      id: `${event.receivedAt}-${event.event}`
    }
    const next: ManagedAiSession = {
      id: event.sessionId,
      source: event.source,
      title: existing?.userTitle || existing?.title || event.title || event.source,
      summary: event.summary || existing?.summary || '',
      state: managedAiSessionStateForEvent(event, existing?.state),
      lastEvent: event.event,
      lastActivityAt: event.receivedAt,
      createdAt: existing?.createdAt || event.receivedAt,
      updatedAt: now,
      ...(existing?.autoTitle ? { autoTitle: existing.autoTitle } : {}),
      ...(existing?.userTitle ? { userTitle: existing.userTitle } : {}),
      events: [...(existing?.events || []), timelineEvent].slice(-200),
      decisions: [...(existing?.decisions || [])],
      ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
      ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
      ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
      ...(event.cwd || existing?.cwd ? { cwd: event.cwd || existing?.cwd } : {}),
      ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
      ...(event.requestId && event.actionable ? { pendingRequestId: event.requestId } : {}),
      requestKind,
      decisionMode,
      ...(event.waitTimeoutMs || existing?.waitTimeoutMs ? { waitTimeoutMs: event.waitTimeoutMs || existing?.waitTimeoutMs } : {}),
      ...(event.toolName || existing?.toolName ? { toolName: event.toolName || existing?.toolName } : {}),
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
      ...(event.launchCommand || existing?.launchCommand ? { launchCommand: event.launchCommand || existing?.launchCommand } : {}),
      ...(event.resumeCommand || existing?.resumeCommand ? { resumeCommand: event.resumeCommand || existing?.resumeCommand } : {}),
      ...(event.processId || existing?.processId ? { processId: event.processId || existing?.processId } : {}),
      ...(event.parentProcessId || existing?.parentProcessId ? { parentProcessId: event.parentProcessId || existing?.parentProcessId } : {}),
      ...(event.processGroupId || existing?.processGroupId ? { processGroupId: event.processGroupId || existing?.processGroupId } : {}),
      ...(event.agentLifecycle || existing?.agentLifecycle ? { agentLifecycle: event.agentLifecycle || existing?.agentLifecycle } : {}),
      ...(typeof event.terminalProcessId === 'number'
        ? { terminalProcessId: event.terminalProcessId }
        : typeof existing?.terminalProcessId === 'number'
          ? { terminalProcessId: existing.terminalProcessId }
          : {}),
      ...(typeof event.terminalActivityAt === 'number'
        ? { terminalActivityAt: event.terminalActivityAt }
        : typeof existing?.terminalActivityAt === 'number'
          ? { terminalActivityAt: existing.terminalActivityAt }
          : {})
    }
    managedAiSessions.value = existing
      ? managedAiSessions.value.map((session) => (session.source === next.source && session.id === next.id ? next : session))
      : [next, ...managedAiSessions.value]

    refreshManagedAiAttentionItems()
    return next
  }

  const markManagedAiSessionHandled = (source: AiAgentSessionSource, sessionId: string) => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) return false
    const changed = markAiAttentionHandled(aiSessionAttentionId(session))
    const now = Date.now()
    if (session.state === 'needsInput') session.state = 'idle'
    session.handledAt = now
    session.updatedAt = now
    session.decisions = [...session.decisions, { id: `${now}-handled`, kind: 'handled', createdAt: now }]
    if (selectedManagedAiSessionKey.value === managedAiSessionKey(session)) selectedManagedAiSessionKey.value = ''
    const replyManagedAiSessionBridge = managedAiClient.replyManagedAiSession()
    if (replyManagedAiSessionBridge) {
      void replyManagedAiSessionBridge({ source, sessionId, kind: 'handled' }).then((result: ManagedAiSessionMutationResult) => {
        if (result?.ok && isManagedAiSessionMutationData(result.data)) applyManagedAiSessionSnapshot(result.data.snapshot)
      })
    }
    return changed
  }

  const replyManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, kind: ManagedAiSessionDecision['kind'], message?: string) => {
    const replyManagedAiSessionBridge = managedAiClient.replyManagedAiSession()
    if (!replyManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await replyManagedAiSessionBridge({ source, sessionId, kind, message })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.processFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(
        kind === 'allow'
          ? i18nText('aiSessions.notice.allowed')
          : kind === 'always'
            ? i18nText('aiSessions.notice.alwaysAllowed')
            : kind === 'bypass'
              ? i18nText('aiSessions.notice.bypassAllowed')
              : kind === 'deny'
                ? i18nText('aiSessions.notice.denied')
                : kind === 'reply'
                  ? i18nText('aiSessions.notice.replied')
                  : i18nText('aiSessions.notice.handled')
      )
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.processFailed'))
      return false
    }
  }

  const renameManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, title: string) => {
    const renameManagedAiSessionBridge = managedAiClient.renameManagedAiSession()
    if (!renameManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await renameManagedAiSessionBridge({ source, sessionId, title })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.renameFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.notice.renamed'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.renameFailed'))
      return false
    }
  }

  const clearManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const clearManagedAiSessionBridge = managedAiClient.clearManagedAiSession()
    if (!clearManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await clearManagedAiSessionBridge({ source, sessionId })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.clearFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.notice.cleared'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.clearFailed'))
      return false
    }
  }

  const bulkManagedAiSessions = async (input: ManagedAiSessionBulkInput) => {
    const bulkManagedAiSessionsBridge = managedAiClient.bulkManagedAiSessions()
    if (!bulkManagedAiSessionsBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await bulkManagedAiSessionsBridge(input)) as ManagedAiSessionBulkResult
      if (!result?.ok || !isManagedAiSessionBulkData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.bulkFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.visibleHandled', { count: result.data.changed }))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.bulkFailed'))
      return false
    }
  }

  const refreshAgentHibernationConfig = async () => {
    const getAgentHibernationConfig = managedAiClient.getAgentHibernationConfig()
    if (!getAgentHibernationConfig) return false
    try {
      const result = (await getAgentHibernationConfig()) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.loadFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.loadFailed'))
      return false
    }
  }

  const updateAgentHibernationConfig = async (patch: Partial<AgentHibernationConfig>) => {
    const setAgentHibernationConfig = managedAiClient.setAgentHibernationConfig()
    if (!setAgentHibernationConfig) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const nextConfig = { ...agentHibernationConfig.value, ...patch }
    try {
      const result = (await setAgentHibernationConfig(nextConfig)) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.saveFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      setTopNotice(i18nText('settings.ai.hibernation.saved'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.saveFailed'))
      return false
    }
  }

  const setAgentHibernationEnabled = async (enabled: boolean) => {
    const saved = await updateAgentHibernationConfig({ enabled })
    if (saved) setTopNotice(enabled ? i18nText('settings.ai.hibernation.enabledNotice') : i18nText('settings.ai.hibernation.disabledNotice'))
    return saved
  }

  const hibernateManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, reason = 'manual') => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    if (!agentHibernationConfig.value.enabled) {
      setTopNotice(i18nText('aiSessions.notice.hibernationDisabled'))
      return false
    }
    if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') {
      setTopNotice(i18nText('aiSessions.notice.cannotHibernateNeedsInput'))
      return false
    }
    if (!session.resumeCommand?.trim()) {
      setTopNotice(i18nText('aiSessions.notice.noResumeCommand'))
      return false
    }
    const targetId = session.panelId || session.terminalSessionId
    const panel = targetId ? panels.value.find((item) => item.id === targetId || item.sessionId === targetId) : null
    const terminalSessionId = panel?.sessionId || session.terminalSessionId
    const killTerminal = terminalClient.killTerminal()
    if (terminalSessionId && killTerminal) {
      const killResult = await killTerminal(terminalSessionId)
      if (!killResult?.ok) {
        setTopNotice(killResult?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
        return false
      }
      if (panel?.sessionId === terminalSessionId) {
        panel.sessionId = undefined
        panel.status = 'closed'
      }
    }
    const hibernateManagedAiSessionBridge = managedAiClient.hibernateManagedAiSession()
    if (!hibernateManagedAiSessionBridge) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const result = (await hibernateManagedAiSessionBridge({ source, sessionId, reason, terminalSessionId })) as ManagedAiSessionHibernateResult
    if (!result?.ok || !isManagedAiSessionHibernateData(result.data)) {
      setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
      return false
    }
    agentHibernationConfig.value = { ...result.data.config }
    applyManagedAiSessionSnapshot(result.data.snapshot)
    setTopNotice(i18nText('aiSessions.notice.hibernated'))
    return true
  }

  const managedAiSessionNeedsAttentionForPanel = (panelIdOrSessionId: string) => managedAiAttentionPanelIds.value.has(panelIdOrSessionId)

  const activateTerminalPanelForManagedAiSession = (panelIdOrSessionId: string) => {
    const target = panels.value.find((panel) => panel.id === panelIdOrSessionId || panel.sessionId === panelIdOrSessionId)
    if (!target || target.kind !== 'terminal') return null
    activePanelId.value = target.id
    return target
  }

  const focusManagedAiSession = (sessionIdOrPanelId: string) => {
    const session = managedAiSessions.value.find(
      (item) => item.id === sessionIdOrPanelId || item.panelId === sessionIdOrPanelId || item.terminalSessionId === sessionIdOrPanelId
    )
    if (!session) return null
    mode.value = 'terminal'
    selectedManagedAiSessionKey.value = managedAiSessionKey(session)
    const targetId = session.panelId || session.terminalSessionId
    if (targetId) activateTerminalPanelForManagedAiSession(targetId)
    managedAiSessionFocusRequest.value = {
      sequence: managedAiSessionFocusRequest.value.sequence + 1,
      session
    }
    return session
  }

  const findManagedAiSessionForFocusRequest = (request: ManagedAiSessionFocusRequest) =>
    managedAiSessions.value.find((item) => {
      if (request.source && item.source !== request.source) return false
      if (request.sessionId && item.id === request.sessionId) return true
      if (request.panelId && item.panelId === request.panelId) return true
      if (request.terminalSessionId && item.terminalSessionId === request.terminalSessionId) return true
      return false
    })

  const focusManagedAiSessionRequest = async (request: ManagedAiSessionFocusRequest) => {
    let session = findManagedAiSessionForFocusRequest(request)
    if (!session) {
      await refreshManagedAiSessions({ silent: true })
      session = findManagedAiSessionForFocusRequest(request)
    }
    if (!session) return null
    const focused = focusManagedAiSession(session.id)
    activeModule.value = 'aiSessions'
    leftPanelOpen.value = true
    return focused
  }

  const resumeManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    const command = session.resumeCommand?.trim()
    if (!command) {
      setTopNotice(i18nText('aiSessions.notice.noResumeCommand'))
      return false
    }
    const focused = focusManagedAiSession(session.id)
    const targetId = focused?.panelId || focused?.terminalSessionId || session.panelId || session.terminalSessionId
    const panel = targetId ? panels.value.find((item) => item.id === targetId || item.sessionId === targetId) : null
    if (!panel?.sessionId) {
      setTopNotice(i18nText('aiSessions.notice.resumeNeedsTerminal'))
      return false
    }
    const decision = await runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
    if (decision.status === 'allow') {
      const wakeManagedAiSession = managedAiClient.wakeManagedAiSession()
      if (session.hibernated && wakeManagedAiSession) {
        const result = (await wakeManagedAiSession({ source, sessionId, reason: 'resume' })) as ManagedAiSessionHibernateResult
        if (result?.ok && isManagedAiSessionHibernateData(result.data)) {
          agentHibernationConfig.value = { ...result.data.config }
          applyManagedAiSessionSnapshot(result.data.snapshot)
        }
      }
      setTopNotice(i18nText('aiSessions.notice.resumeCommandWritten'))
      return true
    }
    if (decision.status === 'needs-approval') {
      setTopNotice(i18nText('aiSessions.notice.resumeCommandNeedsApproval'))
      return false
    }
    return false
  }

  const jumpToNextAiAttention = () => {
    const item = currentAiAttentionItem.value
    if (!item) {
      mode.value = 'terminal'
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
      setTopNotice(i18nText('aiSessions.notice.noPendingMessages'))
      return null
    }
    const managedSession = item.id.startsWith('managed-ai:') && item.sessionId ? focusManagedAiSession(item.sessionId) : null
    if (managedSession) {
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
    } else if (item.notificationId) {
      void openControlNotification(item.notificationId)
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

  const touchManagedAiTerminalActivity = (panel: Pick<TerminalPanel, 'id' | 'sessionId'>, at = Date.now()) => {
    managedAiSessions.value = managedAiSessions.value.map((session) =>
      session.terminalSessionId === panel.sessionId || session.panelId === panel.id ? { ...session, terminalActivityAt: at, updatedAt: Date.now() } : session
    )
  }

  const applyManagedAiTerminalLifecycle = (panel: Pick<TerminalPanel, 'id'>, event: TerminalLifecycleEvent) => {
    if (event.processId) {
      managedAiSessions.value = managedAiSessions.value.map((session) =>
        session.terminalSessionId === event.id || session.panelId === panel.id
          ? { ...session, terminalProcessId: event.processId, terminalActivityAt: event.at, updatedAt: Date.now() }
          : session
      )
    }
    if (event.stage === 'closed' || event.stage === 'error') {
      managedAiSessions.value
        .filter((session) => session.terminalSessionId === event.id || session.panelId === panel.id)
        .forEach((session) =>
          upsertManagedAiSession({
            source: session.source,
            event: 'session_end',
            sessionId: session.id,
            title: session.title,
            summary: event.errorMessage || 'Terminal closed',
            receivedAt: event.at || Date.now(),
            ...(session.panelId ? { panelId: session.panelId } : {}),
            terminalSessionId: event.id
          })
        )
    }
  }

  const applyManagedAiTerminalExit = (panel: Pick<TerminalPanel, 'id'>, event: TerminalExitEvent) => {
    managedAiSessions.value
      .filter((session) => session.terminalSessionId === event.id || session.panelId === panel.id)
      .forEach((session) =>
        upsertManagedAiSession({
          source: session.source,
          event: 'session_end',
          sessionId: session.id,
          title: session.title,
          summary: event.errorMessage || 'Terminal closed',
          receivedAt: Date.now(),
          ...(session.panelId ? { panelId: session.panelId } : {}),
          terminalSessionId: event.id
        })
      )
  }

  return {
    pendingAiAttentionItems,
    aiAttentionUnreadCount,
    currentAiAttentionItem,
    sortedManagedAiSessions,
    managedAiNeedsInputSessions,
    selectedManagedAiSession,
    upsertAiAttentionItem,
    removeAiAttentionItem,
    markAiAttentionHandled,
    clearAiAttentionForConversation,
    refreshControlNotificationAttentionItems,
    applyControlNotificationSnapshot,
    focusControlNotification,
    openControlNotification,
    jumpToNextAiAttention,
    refreshAgentHookInstallers,
    installAgentHookInstaller,
    uninstallAgentHookInstaller,
    refreshManagedAiSessions,
    refreshManagedAiSessionsDebounced,
    applyManagedAiSessionSnapshot,
    upsertManagedAiSession,
    markManagedAiSessionHandled,
    replyManagedAiSession,
    renameManagedAiSession,
    clearManagedAiSession,
    bulkManagedAiSessions,
    refreshAgentHibernationConfig,
    updateAgentHibernationConfig,
    setAgentHibernationEnabled,
    hibernateManagedAiSession,
    managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession,
    focusManagedAiSessionRequest,
    resumeManagedAiSession,
    touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit
  }
}
