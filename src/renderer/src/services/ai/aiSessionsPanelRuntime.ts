import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { useI18n } from '@/i18n'
import {
  aiSessionsEventFilterOptions,
  buildManagedAiActiveScopeLabel,
  buildManagedAiLibrarySections,
  buildManagedAiPanelModeButtons,
  filteredManagedAiTimelineEvents,
  formatManagedAiRelativeTime,
  formatManagedAiTime,
  managedAiDecisionLabelKey,
  managedAiDecisionModeLabelKey,
  managedAiEventLabelKey,
  managedAiLifecycleLabelKey,
  managedAiPanelModeForSession,
  managedAiPanelModeStateFilter,
  managedAiProjectDisplayLabel,
  managedAiProjectDisplayLabels,
  managedAiRequestKindLabelKey,
  managedAiSessionDisplayTitle,
  managedAiSessionKey,
  managedAiSessionStateLabelKey,
  managedAiSourceLabel,
  managedAiTimelineEventCopyPayload,
  managedAiTimelineEventState,
  selectedVisibleManagedAiSession,
  visibleManagedAiSessions,
  type ManagedAiLibraryGrouping,
  type ManagedAiPanelMode,
  type ManagedAiRequestKindFilter,
  type ManagedAiStateFilter,
  type ManagedAiTimelineEvent
} from '@/services/ai/aiSessionsPanelViewRuntime'
import type { ManagedAiSession, ManagedAiSessionState } from '@/services/ai/workspaceManagedAiTypes'
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

export const useAiSessionsPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const query = ref('')
  const mode = ref<ManagedAiPanelMode>('pending')
  const libraryGrouping = ref<ManagedAiLibraryGrouping>('project')
  const collapsedLibrarySections = ref<Set<string>>(new Set())
  const filter = ref<ManagedAiStateFilter>('needsInput')
  const eventFilter = ref<ManagedAiRequestKindFilter>('all')
  const replyText = ref('')
  const renameTitle = ref('')
  const locallySelectedSessionKey = ref('')
  const eventFilters = computed(() => aiSessionsEventFilterOptions.map((option) => ({ key: option.key, label: t(option.labelKey) })))

  const sourceLabel = (source: AiAgentSessionSource) => managedAiSourceLabel(source)
  const stateLabel = (state: ManagedAiSessionState) => t(managedAiSessionStateLabelKey(state))
  const lifecycleLabel = (lifecycle: NonNullable<ManagedAiSession['agentLifecycle']>) => t(managedAiLifecycleLabelKey(lifecycle))
  const requestKindLabel = (kind: ManagedAiSession['requestKind']) => t(managedAiRequestKindLabelKey(kind))
  const decisionModeLabel = (mode: ManagedAiSession['decisionMode']) => t(managedAiDecisionModeLabelKey(mode))
  const eventLabel = (event: AiAgentSessionEventName) => t(managedAiEventLabelKey(event))
  const eventState = (event: ManagedAiTimelineEvent) => managedAiTimelineEventState(event)
  const decisionLabel = (kind: string) => t(managedAiDecisionLabelKey(kind))
  const sessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => managedAiSessionKey(session)
  const modeButtons = computed(() =>
    buildManagedAiPanelModeButtons({
      sessions: workspace.managedAiSessions,
      mode: mode.value,
      translate: t
    })
  )

  const activeModeLabel = computed(() => modeButtons.value.find((button) => button.active)?.label || t('aiSessions.mode.pending'))

  const searchPlaceholder = computed(() => {
    if (mode.value === 'pending') return t('aiSessions.searchPendingPlaceholder')
    if (mode.value === 'running') return t('aiSessions.searchRunningPlaceholder')
    return t('aiSessions.searchLibraryPlaceholder')
  })

  const selectMode = (nextMode: ManagedAiPanelMode) => {
    mode.value = nextMode
    filter.value = managedAiPanelModeStateFilter(nextMode)
  }

  const visibleSessions = computed(() =>
    visibleManagedAiSessions({
      sessions: workspace.sortedManagedAiSessions,
      query: query.value,
      filter: filter.value,
      sourceFilter: 'all',
      projectFilter: 'all',
      hibernatedOnly: false
    })
  )

  const activeScopeLabel = computed(() =>
    buildManagedAiActiveScopeLabel({
      filter: filter.value,
      hibernatedOnly: false,
      sourceFilter: 'all',
      projectFilter: 'all',
      projectOptions: [],
      query: query.value,
      translate: t
    })
  )

  const selectedSession = computed(() => selectedVisibleManagedAiSession({ selectedSession: workspace.selectedManagedAiSession, visibleSessions: visibleSessions.value }))

  const filteredTimelineEvents = computed(() => filteredManagedAiTimelineEvents(selectedSession.value, eventFilter.value))
  const projectLabels = computed(() => managedAiProjectDisplayLabels(workspace.sortedManagedAiSessions, t('aiSessions.unknownProject')))
  const librarySections = computed(() =>
    buildManagedAiLibrarySections({
      sessions: visibleSessions.value,
      grouping: libraryGrouping.value,
      unknownProjectLabel: t('aiSessions.unknownProject')
    })
  )
  const runningSections = computed(() =>
    buildManagedAiLibrarySections({
      sessions: visibleSessions.value,
      grouping: libraryGrouping.value,
      unknownProjectLabel: t('aiSessions.unknownProject')
    })
  )

  const projectLabel = (session: Pick<ManagedAiSession, 'cwd'>) => managedAiProjectDisplayLabel(session, projectLabels.value, t('aiSessions.unknownProject'))
  const sessionDisplayTitle = (session: Pick<ManagedAiSession, 'userTitle' | 'autoTitle' | 'title' | 'summary' | 'id'>) => managedAiSessionDisplayTitle(session)
  const sessionRowTooltip = (session: ManagedAiSession) =>
    [projectLabel(session), sessionDisplayTitle(session), session.cwd || '', session.summary || ''].filter(Boolean).join('\n')
  const liveLinkedPanelForSession = (session: Pick<ManagedAiSession, 'panelId' | 'terminalSessionId'>) => {
    const targetIds = [session.panelId, session.terminalSessionId].filter(Boolean)
    if (!targetIds.length) return null
    return (
      workspace.panels.find(
        (panel) =>
          panel.kind !== 'knowledge' &&
          panel.status !== 'closed' &&
          panel.status !== 'error' &&
          (targetIds.includes(panel.id) || (panel.sessionId ? targetIds.includes(panel.sessionId) : false))
      ) || null
    )
  }
  const sessionDotState = (session: Pick<ManagedAiSession, 'state' | 'panelId' | 'terminalSessionId'>) => {
    if (session.state === 'working') return 'working'
    if (session.state === 'needsInput') return 'needsInput'
    if (liveLinkedPanelForSession(session)) return 'linked'
    return 'other'
  }
  const sessionRowDetail = (session: ManagedAiSession) => session.summary.trim() || sessionDisplayTitle(session)
  const sessionRowStatusLabel = (session: Pick<ManagedAiSession, 'state' | 'panelId' | 'terminalSessionId'>) => {
    const dotState = sessionDotState(session)
    if (dotState === 'working') return t('aiSessions.rowStatus.running')
    if (dotState === 'needsInput') return t('aiSessions.rowStatus.pending')
    if (dotState === 'linked') return t('aiSessions.rowStatus.linked')
    return t('aiSessions.rowStatus.other')
  }
  const selectLibraryGrouping = (nextGrouping: ManagedAiLibraryGrouping) => {
    libraryGrouping.value = nextGrouping
  }
  const isLibrarySectionCollapsed = (key: string) => collapsedLibrarySections.value.has(key)
  const toggleLibrarySection = (key: string) => {
    const next = new Set(collapsedLibrarySections.value)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    collapsedLibrarySections.value = next
  }

  watch(
    selectedSession,
    (session) => {
      renameTitle.value = session?.title || ''
      replyText.value = ''
      eventFilter.value = 'all'
    },
    { immediate: true }
  )

  watch(
    () => workspace.managedAiSessionFocusRequest.sequence,
    () => {
      const session = workspace.managedAiSessionFocusRequest.session
      if (!session) return
      locallySelectedSessionKey.value = ''
      const nextMode = managedAiPanelModeForSession(session)
      if (nextMode === mode.value) return
      mode.value = nextMode
      filter.value = managedAiPanelModeStateFilter(nextMode)
    }
  )

  watch(
    () => workspace.sortedManagedAiSessions.map((session) => `${session.source}:${session.id}:${session.state}`).join('|'),
    () => {
      if (mode.value !== 'pending' || visibleSessions.value.length > 0) return
      if (workspace.sortedManagedAiSessions.some((session) => session.state === 'working')) {
        selectMode('running')
        return
      }
      if (workspace.sortedManagedAiSessions.length > 0) selectMode('library')
    },
    { immediate: true }
  )

  const focusLinkedPanel = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
    const linkedPanel = liveLinkedPanelForSession(session)
    if (!linkedPanel) return false
    workspace.focusManagedAiSession(session.id)
    workspace.activePanelId = linkedPanel.id
    workspace.selectedManagedAiSessionKey = sessionKey(session)
    return true
  }

  const selectSession = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
    const key = sessionKey(session)
    locallySelectedSessionKey.value = workspace.selectedManagedAiSessionKey === key ? '' : key
    workspace.selectedManagedAiSessionKey = key
  }

  const locateSessionTerminal = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
    if (!focusLinkedPanel(session)) workspace.focusManagedAiSession(session.id)
    workspace.selectedManagedAiSessionKey = sessionKey(session)
  }

  const canResumeSession = (session: Pick<ManagedAiSession, 'state' | 'resumeCommand'>) =>
    session.state !== 'working' && session.state !== 'needsInput' && Boolean(session.resumeCommand?.trim())

  const sessionRowMeta = (session: ManagedAiSession) =>
    [sourceLabel(session.source), formatRelativeTime(session.lastActivityAt), session.cwd || projectLabel(session)].filter(Boolean).join(' · ')

  const sessionRowActionHint = (session: ManagedAiSession) => {
    if (liveLinkedPanelForSession(session)) return t('aiSessions.rowAction.locate')
    if (canResumeSession(session)) return t('aiSessions.rowAction.open')
    return ''
  }

  const resumeOrFocusSession = (session: ManagedAiSession) => {
    if (focusLinkedPanel(session)) return
    if (canResumeSession(session)) {
      void workspace.resumeManagedAiSession(session.source, session.id)
      return
    }
    workspace.focusManagedAiSession(session.id)
  }

  const renameSelectedSession = () => {
    const session = selectedSession.value
    const title = renameTitle.value.trim()
    if (!session || !title || title === session.title) return
    void workspace.renameManagedAiSession(session.source, session.id, title)
  }

  const submitReply = async () => {
    const session = selectedSession.value
    const message = replyText.value.trim()
    if (!session || !message) return
    const ok = await workspace.replyManagedAiSession(session.source, session.id, 'reply', message)
    if (ok) replyText.value = ''
  }

  const submitQuestionReply = async () => {
    const session = selectedSession.value
    const message = replyText.value.trim()
    if (!session || !message) return
    const ok = await workspace.replyManagedAiSession(session.source, session.id, 'reply', message)
    if (ok) replyText.value = ''
  }

  const copyTimelineEvent = async (event: ManagedAiTimelineEvent) => {
    const copied = await copyTextToClipboard(managedAiTimelineEventCopyPayload(event))
    workspace.setTopNotice(copied ? t('aiSessions.eventCopied') : t('aiSessions.eventCopyFailed'))
  }

  const formatTime = (timestamp: number) => formatManagedAiTime(timestamp)

  const formatRelativeTime = (timestamp: number) => formatManagedAiRelativeTime(timestamp, Date.now(), t)

  return {
    workspace,
    t,
    query,
    mode,
    libraryGrouping,
    collapsedLibrarySections,
    eventFilter,
    replyText,
    renameTitle,
    modeButtons,
    activeModeLabel,
    searchPlaceholder,
    eventFilters,
    sourceLabel,
    stateLabel,
    lifecycleLabel,
    requestKindLabel,
    decisionModeLabel,
    eventLabel,
    eventState,
    decisionLabel,
    sessionKey,
    selectMode,
    selectLibraryGrouping,
    isLibrarySectionCollapsed,
    toggleLibrarySection,
    visibleSessions,
    librarySections,
    runningSections,
    activeScopeLabel,
    selectedSession,
    filteredTimelineEvents,
    selectSession,
    locateSessionTerminal,
    renameSelectedSession,
    submitReply,
    submitQuestionReply,
    copyTimelineEvent,
    resumeOrFocusSession,
    projectLabel,
    sessionDisplayTitle,
    sessionRowTooltip,
    sessionRowDetail,
    sessionRowStatusLabel,
    sessionRowMeta,
    sessionRowActionHint,
    sessionDotState,
    formatTime,
    formatRelativeTime
  }
}
