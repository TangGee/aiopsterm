import { computed } from 'vue'
import { managedAiClient } from '@/services/ai/managedAiClient'
import {
  isManagedAiSessionBulkData,
  isManagedAiSessionMutationData,
  isManagedAiSessionSnapshot
} from '@/services/ai/managedAiBackendGuards'
import type { I18nKey } from '@/i18n/messages'
import type {
  AiAgentSessionEvent,
  AiAgentSessionSource,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionDecision,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionSnapshot,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import type { TerminalExitEvent, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type {
  AiAttentionKind,
  ManagedAiSession,
  ManagedAiSessionState,
  WorkspaceManagedAiControllerState
} from '@/services/ai/workspaceManagedAiTypes'
import type { WorkspaceManagedAiAttentionRuntime } from '@/services/ai/workspaceManagedAiAttentionRuntime'

export type WorkspaceManagedAiSessionRuntime = ReturnType<typeof createWorkspaceManagedAiSessionRuntime>

export const aiSessionAttentionId = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `managed-ai:${session.source}:${session.id}`
export const managedAiSessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

const managedAiRequestKindForEvent = (event: AiAgentSessionEvent): ManagedAiSession['requestKind'] => {
  if (event.requestKind) return event.requestKind
  if (event.event === 'permission_request') return 'permission'
  if (event.event === 'question') return 'question'
  if (event.event === 'notification') return 'notification'
  if (event.event === 'stop') return 'notification'
  return 'telemetry'
}

const managedAiDecisionModeForEvent = (event: AiAgentSessionEvent): ManagedAiSession['decisionMode'] => {
  if (event.decisionMode) return event.decisionMode
  if (event.actionable === true) return 'local'
  return managedAiRequestKindForEvent(event) === 'telemetry' ? 'telemetry' : 'local'
}

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
  if (event.event === 'session_end') return 'ended'
  if (event.event === 'stop') return 'needsInput'
  const lifecycle = event.agentLifecycle
  if (lifecycle === 'running') return 'working'
  if (lifecycle === 'idle') return 'idle'
  if (lifecycle === 'needsInput') return 'needsInput'
  if (lifecycle === 'ended') return 'ended'
  if (lifecycle === 'unknown') return 'unknown'
  if (event.event === 'session_start') return 'idle'
  if (event.event === 'prompt_submit' || event.event === 'pre_tool_use') return 'working'
  if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return managedAiSessionNeedsInputForEvent(event) ? 'needsInput' : 'working'
  return previous
}

const managedAiAttentionKindForSession = (session: Pick<ManagedAiSession, 'requestKind' | 'lastEvent'>): AiAttentionKind => {
  if (session.requestKind === 'plan') return 'plan'
  if (session.requestKind === 'permission' || session.lastEvent === 'permission_request') return 'approval'
  if (session.requestKind === 'notification') return 'done'
  return 'question'
}

export const createWorkspaceManagedAiSessionRuntime = (input: {
  state: Pick<
    WorkspaceManagedAiControllerState,
    | 'mode'
    | 'activeModule'
    | 'leftPanelOpen'
    | 'activePanelId'
    | 'panels'
    | 'aiAttentionItems'
    | 'managedAiSessions'
    | 'managedAiSessionsLoading'
    | 'managedAiSessionsError'
    | 'managedAiSessionFocusRequest'
    | 'selectedManagedAiSessionKey'
  >
  attention: Pick<WorkspaceManagedAiAttentionRuntime, 'upsertAiAttentionItem' | 'removeAiAttentionItem' | 'markAiAttentionHandled'>
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
}) => {
  const { state, attention, setTopNotice, i18nText } = input
  const {
    mode,
    activeModule,
    leftPanelOpen,
    activePanelId,
    panels,
    aiAttentionItems,
    managedAiSessions,
    managedAiSessionsLoading,
    managedAiSessionsError,
    managedAiSessionFocusRequest,
    selectedManagedAiSessionKey
  } = state
  const { upsertAiAttentionItem, removeAiAttentionItem, markAiAttentionHandled } = attention

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

  const managedAiLiveTerminalIds = () => {
    const ids = new Set<string>()
    panels.value.forEach((panel) => {
      if (panel.kind === 'knowledge' || !panel.sessionId || panel.status === 'closed' || panel.status === 'error') return
      ids.add(panel.id)
      ids.add(panel.sessionId)
    })
    return ids
  }

  const endedManagedAiSessionFromTerminalClose = (session: ManagedAiSession, summary = 'Terminal closed'): ManagedAiSession => {
    const now = Date.now()
    const event: ManagedAiSessionTimelineEvent = {
      source: session.source,
      event: 'session_end',
      sessionId: session.id,
      title: session.title,
      summary,
      receivedAt: now,
      ...(session.panelId ? { panelId: session.panelId } : {}),
      ...(session.terminalSessionId ? { terminalSessionId: session.terminalSessionId } : {}),
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      id: `${now}-terminal-close`
    }
    return {
      ...session,
      state: 'ended',
      lastEvent: 'session_end',
      summary,
      updatedAt: now,
      lastActivityAt: now,
      agentLifecycle: 'ended',
      pendingRequestId: undefined,
      events: [...session.events, event].slice(-200)
    }
  }

  const reconcileManagedAiSessionsWithLiveTerminals = () => {
    const liveIds = managedAiLiveTerminalIds()
    let changed = false
    managedAiSessions.value = managedAiSessions.value.map((session) => {
      if (session.state !== 'working' && session.state !== 'needsInput') return session
      const boundIds = [session.panelId, session.terminalSessionId].filter((value): value is string => Boolean(value))
      if (!boundIds.length || boundIds.some((id) => liveIds.has(id))) return session
      changed = true
      return endedManagedAiSessionFromTerminalClose(session)
    })
    if (changed) refreshManagedAiAttentionItems()
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
              : session.lastEvent === 'stop'
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
                : event.event === 'stop'
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
    reconcileManagedAiSessionsWithLiveTerminals()
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

  const applyManagedAiTerminalPanelClosed = (closedPanels: Array<Pick<TerminalPanel, 'id' | 'sessionId'>>) => {
    const closedIds = new Set<string>()
    closedPanels.forEach((panel) => {
      closedIds.add(panel.id)
      if (panel.sessionId) closedIds.add(panel.sessionId)
    })
    if (!closedIds.size) return
    let changed = false
    managedAiSessions.value = managedAiSessions.value.map((session) => {
      if (session.state === 'ended') return session
      if (!session.panelId && !session.terminalSessionId) return session
      if (!closedIds.has(session.panelId || '') && !closedIds.has(session.terminalSessionId || '')) return session
      changed = true
      return endedManagedAiSessionFromTerminalClose(session)
    })
    if (changed) refreshManagedAiAttentionItems()
  }

  return {
    sortedManagedAiSessions,
    managedAiNeedsInputSessions,
    selectedManagedAiSession,
    refreshManagedAiSessions,
    refreshManagedAiSessionsDebounced,
    applyManagedAiSessionSnapshot,
    upsertManagedAiSession,
    markManagedAiSessionHandled,
    replyManagedAiSession,
    renameManagedAiSession,
    clearManagedAiSession,
    bulkManagedAiSessions,
    managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession,
    focusManagedAiSessionRequest,
    touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit,
    applyManagedAiTerminalPanelClosed
  }
}
