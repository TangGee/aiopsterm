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
import { isTerminalWorkspacePanel, type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
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

const normalizedManagedAiToolName = (toolName?: string) => (toolName || '').trim().toLowerCase().replace(/[\s_-]+/g, '')

const managedAiQuestionToolNames = new Set(['askuserquestion', 'requestuserinput'])

const managedAiRequestKindForEvent = (event: AiAgentSessionEvent): ManagedAiSession['requestKind'] => {
  if (event.requestKind) return event.requestKind
  const toolName = normalizedManagedAiToolName(event.toolName)
  if (managedAiQuestionToolNames.has(toolName)) return 'question'
  if (toolName === 'exitplanmode') return 'plan'
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
  if (requestKind === 'telemetry') return false
  if (event.source === 'codex' && event.event === 'permission_request' && requestKind === 'permission') return true
  if (decisionMode === 'blocking') return true
  if (requestKind === 'notification') return true
  return event.actionable === true
}

const managedAiSessionStateForEvent = (event: AiAgentSessionEvent, previous: ManagedAiSessionState = 'unknown'): ManagedAiSessionState => {
  if (event.event === 'session_end') return 'ended'
  if (event.event === 'stop') return 'needsInput'
  const lifecycle = event.agentLifecycle
  if (lifecycle === 'ended') return 'ended'
  if (managedAiSessionNeedsInputForEvent(event)) return 'needsInput'
  if (lifecycle === 'running') return 'working'
  if (lifecycle === 'idle') return 'idle'
  if (lifecycle === 'needsInput') return 'needsInput'
  if (lifecycle === 'unknown') return 'unknown'
  if (event.event === 'session_start') return 'idle'
  if (event.event === 'prompt_submit' || event.event === 'pre_tool_use') return 'working'
  if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return managedAiSessionNeedsInputForEvent(event) ? 'needsInput' : 'working'
  return previous
}

const managedAiSessionAllowsResume = (session: Pick<ManagedAiSession, 'sessionKind' | 'restorable'>) =>
  session.restorable !== false && session.sessionKind !== 'subagent' && session.sessionKind !== 'internal'

const managedAiSessionIsChild = (session: Pick<ManagedAiSession, 'sessionKind'>) =>
  session.sessionKind === 'subagent' || session.sessionKind === 'internal'

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
  const managedAiNeedsInputSessions = computed(() => sortedManagedAiSessions.value.filter((session) => session.state === 'needsInput' && !session.handledAt && !managedAiSessionIsChild(session)))
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
      if (session.state === 'needsInput' && !managedAiSessionIsChild(session)) {
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

  const terminalEndEvents = new Map<string, AiAgentSessionEvent>()
  const pendingTerminalEndEvents = new Map<string, AiAgentSessionEvent>()
  const terminalEndPublishInFlight = new Set<string>()

  const endedManagedAiSessionFromTerminalClose = (session: ManagedAiSession, sessionEvent: AiAgentSessionEvent): ManagedAiSession => {
    const timelineId = `${sessionEvent.receivedAt}-${sessionEvent.event}`
    const timelineEvent: ManagedAiSessionTimelineEvent = {
      ...sessionEvent,
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      id: timelineId
    }
    return {
      ...session,
      state: 'ended',
      lastEvent: 'session_end',
      summary: sessionEvent.summary || session.summary,
      updatedAt: Date.now(),
      lastActivityAt: sessionEvent.receivedAt,
      agentLifecycle: 'ended',
      pendingRequestId: undefined,
      events: session.events.some((item) => item.id === timelineId) ? session.events : [...session.events, timelineEvent].slice(-200)
    }
  }

  const publishManagedAiTerminalEnd = (event: AiAgentSessionEvent) => {
    const key = managedAiSessionKey({ source: event.source, id: event.sessionId })
    if (terminalEndPublishInFlight.has(key)) return
    const publishEvent = managedAiClient.publishAiAgentSessionEvent()
    if (!publishEvent) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return
    }
    terminalEndPublishInFlight.add(key)
    void publishEvent(event)
      .then((result) => {
        if (!result?.ok) {
          setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.processFailed'))
          return
        }
        if (pendingTerminalEndEvents.get(key) === event) pendingTerminalEndEvents.delete(key)
      })
      .catch((error) => {
        setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.processFailed'))
      })
      .finally(() => {
        terminalEndPublishInFlight.delete(key)
      })
  }

  const applyTerminalEndEventToSession = (session: ManagedAiSession, event: AiAgentSessionEvent) => {
    if (event.receivedAt < session.lastActivityAt) return session
    return endedManagedAiSessionFromTerminalClose(session, event)
  }

  const endManagedAiSessionFromTerminal = (
    session: ManagedAiSession,
    input: { summary: string; receivedAt?: number; terminalSessionId?: string }
  ) => {
    const current = managedAiSessions.value.find((item) => item.source === session.source && item.id === session.id)
    if (!current || current.state === 'ended' || current.hibernated) return false
    const terminalSessionId = input.terminalSessionId || current.terminalSessionId
    const event: AiAgentSessionEvent = {
      source: current.source,
      event: 'session_end',
      sessionId: current.id,
      title: current.title,
      summary: input.summary,
      receivedAt: input.receivedAt ?? Date.now(),
      agentLifecycle: 'ended',
      ...(current.panelId ? { panelId: current.panelId } : {}),
      ...(terminalSessionId ? { terminalSessionId } : {}),
      ...(current.sessionKind ? { sessionKind: current.sessionKind } : {}),
      ...(current.parentSessionId ? { parentSessionId: current.parentSessionId } : {}),
      ...(typeof current.restorable === 'boolean' ? { restorable: current.restorable } : {})
    }
    if (event.receivedAt < current.lastActivityAt) return false
    const key = managedAiSessionKey(current)
    const ended = applyTerminalEndEventToSession(current, event)
    terminalEndEvents.set(key, event)
    pendingTerminalEndEvents.set(key, event)
    managedAiSessions.value = managedAiSessions.value.map((item) =>
      item.source === ended.source && item.id === ended.id ? ended : item
    )
    refreshManagedAiAttentionItems()
    publishManagedAiTerminalEnd(event)
    return true
  }

  const applyManagedAiSessionSnapshot = (snapshot: ManagedAiSessionSnapshot) => {
    const previousSessions = new Map(managedAiSessions.value.map((session) => [managedAiSessionKey(session), session]))
    const nextSessions = snapshot.sessions.map((session) => ({
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
    managedAiSessions.value = nextSessions.map((session) => {
      const key = managedAiSessionKey(session)
      const terminalEndEvent = terminalEndEvents.get(key)
      if (terminalEndEvent) {
        if (session.state === 'ended' && session.lastActivityAt >= terminalEndEvent.receivedAt) {
          terminalEndEvents.delete(key)
          pendingTerminalEndEvents.delete(key)
          return session
        }
        if (session.lastActivityAt <= terminalEndEvent.receivedAt) {
          return applyTerminalEndEventToSession(session, terminalEndEvent)
        }
        terminalEndEvents.delete(key)
        pendingTerminalEndEvents.delete(key)
      }
      const previous = previousSessions.get(key)
      return previous && previous.lastActivityAt > session.lastActivityAt ? previous : session
    })
    const snapshotKeys = new Set(managedAiSessions.value.map((session) => managedAiSessionKey(session)))
    terminalEndEvents.forEach((_event, key) => {
      if (snapshotKeys.has(key)) return
      terminalEndEvents.delete(key)
      pendingTerminalEndEvents.delete(key)
    })
    managedAiSessionsError.value = ''
    if (selectedManagedAiSessionKey.value && !managedAiSessions.value.some((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value)) {
      selectedManagedAiSessionKey.value = ''
    }
    refreshManagedAiAttentionItems()
    pendingTerminalEndEvents.forEach((event) => publishManagedAiTerminalEnd(event))
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

  // 事件驱动的整库快照重拉按 150ms 去抖合并，事件风暴下只触发一次全量刷新
  let managedAiSessionRefreshTimer: number | null = null
  const refreshManagedAiSessionsDebounced = () => {
    if (managedAiSessionRefreshTimer !== null) return
    managedAiSessionRefreshTimer = window.setTimeout(() => {
      managedAiSessionRefreshTimer = null
      void refreshManagedAiSessions({ silent: true })
    }, 150)
  }

  const upsertManagedAiSession = (event: AiAgentSessionEvent) => {
    const existing = managedAiSessions.value.find((session) => session.source === event.source && session.id === event.sessionId)
    const key = managedAiSessionKey({ source: event.source, id: event.sessionId })
    const terminalEndEvent = terminalEndEvents.get(key)
    if (terminalEndEvent) {
      const isTerminalEndEcho = event.event === 'session_end' && event.receivedAt === terminalEndEvent.receivedAt
      if (isTerminalEndEcho) {
        pendingTerminalEndEvents.delete(key)
      } else if (event.receivedAt <= terminalEndEvent.receivedAt && existing) {
        return existing
      } else {
        terminalEndEvents.delete(key)
        pendingTerminalEndEvents.delete(key)
      }
    }
    if (existing && event.receivedAt < existing.lastActivityAt) return existing
    if (existing?.state === 'ended' && event.event !== 'session_end' && event.receivedAt === existing.lastActivityAt) return existing
    const now = Date.now()
    const requestKind = managedAiRequestKindForEvent(event)
    const decisionMode = event.decisionMode || (event.actionable === true ? 'local' : requestKind === 'telemetry' ? 'telemetry' : 'local')
    const sessionKind = event.sessionKind || existing?.sessionKind
    const parentSessionId = event.parentSessionId || existing?.parentSessionId
    const restorable = event.restorable === false || existing?.restorable === false || sessionKind === 'subagent' || sessionKind === 'internal'
      ? false
      : event.restorable ?? existing?.restorable
    const allowResume = managedAiSessionAllowsResume({ sessionKind, restorable })
    const timelineEvent: ManagedAiSessionTimelineEvent = {
      ...event,
      requestKind,
      decisionMode,
      id: `${event.receivedAt}-${event.event}`
    }
    const events = existing?.events.some((item) => item.id === timelineEvent.id)
      ? existing.events
      : [...(existing?.events || []), timelineEvent].slice(-200)
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
      events,
      decisions: [...(existing?.decisions || [])],
      ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
      ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
      ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
      ...(event.cwd || existing?.cwd ? { cwd: event.cwd || existing?.cwd } : {}),
      ...(event.canonicalCwd || existing?.canonicalCwd ? { canonicalCwd: event.canonicalCwd || existing?.canonicalCwd } : {}),
      ...(event.gitBranch || existing?.gitBranch ? { gitBranch: event.gitBranch || existing?.gitBranch } : {}),
      ...(typeof event.gitDirty === 'boolean' ? { gitDirty: event.gitDirty } : typeof existing?.gitDirty === 'boolean' ? { gitDirty: existing.gitDirty } : {}),
      ...(event.gitStatusUpdatedAt || existing?.gitStatusUpdatedAt ? { gitStatusUpdatedAt: event.gitStatusUpdatedAt || existing?.gitStatusUpdatedAt } : {}),
      ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
      ...(event.requestId && event.actionable ? { pendingRequestId: event.requestId } : {}),
      requestKind,
      decisionMode,
      ...(event.waitTimeoutMs || existing?.waitTimeoutMs ? { waitTimeoutMs: event.waitTimeoutMs || existing?.waitTimeoutMs } : {}),
      ...(event.toolName || existing?.toolName ? { toolName: event.toolName || existing?.toolName } : {}),
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
      ...(event.launchCommand || existing?.launchCommand ? { launchCommand: event.launchCommand || existing?.launchCommand } : {}),
      ...(allowResume && (event.resumeCommand || existing?.resumeCommand) ? { resumeCommand: event.resumeCommand || existing?.resumeCommand } : {}),
      ...(sessionKind ? { sessionKind } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(typeof restorable === 'boolean' ? { restorable } : {}),
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
    if (!target || !isTerminalWorkspacePanel(target)) return null
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
    // 只回写目标会话的活动时间字段并保持数组引用不变；排序键 lastActivityAt 不受影响，无需重排
    const now = Date.now()
    for (const session of managedAiSessions.value) {
      if (session.terminalSessionId !== panel.sessionId && session.panelId !== panel.id) continue
      session.terminalActivityAt = at
      session.updatedAt = now
    }
  }

  const managedAiSessionMatchesTerminal = (session: ManagedAiSession, panel: Pick<TerminalPanel, 'id'> | null, terminalSessionId: string) =>
    session.terminalSessionId === terminalSessionId || Boolean(panel && session.panelId === panel.id)

  const applyManagedAiTerminalLifecycle = (panel: Pick<TerminalPanel, 'id'> | null, event: TerminalLifecycleEvent) => {
    if (event.processId) {
      managedAiSessions.value = managedAiSessions.value.map((session) =>
        managedAiSessionMatchesTerminal(session, panel, event.id)
          ? { ...session, terminalProcessId: event.processId, terminalActivityAt: event.at, updatedAt: Date.now() }
          : session
      )
    }
    if (event.stage === 'closed' || event.stage === 'error') {
      managedAiSessions.value
        .filter((session) => session.state !== 'ended' && managedAiSessionMatchesTerminal(session, panel, event.id))
        .forEach((session) => {
          endManagedAiSessionFromTerminal(session, {
            summary: event.errorMessage || 'Terminal closed',
            receivedAt: event.at,
            terminalSessionId: event.id
          })
        })
    }
  }

  const applyManagedAiTerminalExit = (panel: Pick<TerminalPanel, 'id'> | null, event: TerminalExitEvent) => {
    managedAiSessions.value
      .filter((session) => session.state !== 'ended' && managedAiSessionMatchesTerminal(session, panel, event.id))
      .forEach((session) => {
        endManagedAiSessionFromTerminal(session, {
          summary: event.errorMessage || 'Terminal closed',
          terminalSessionId: event.id
        })
      })
  }

  const applyManagedAiTerminalPanelClosed = (closedPanels: Array<Pick<TerminalPanel, 'id' | 'sessionId'>>) => {
    const closedIds = new Set<string>()
    closedPanels.forEach((panel) => {
      closedIds.add(panel.id)
      if (panel.sessionId) closedIds.add(panel.sessionId)
    })
    if (!closedIds.size) return
    const closingSessions = managedAiSessions.value.filter((session) => {
      if (session.state === 'ended' || (!session.panelId && !session.terminalSessionId)) return false
      return closedIds.has(session.panelId || '') || closedIds.has(session.terminalSessionId || '')
    })
    closingSessions.forEach((session) => {
      endManagedAiSessionFromTerminal(session, { summary: 'Terminal closed' })
    })
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
