import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { useI18n } from '@/i18n'
import {
  aiSessionsEventFilterOptions,
  buildManagedAiActiveScopeLabel,
  buildManagedAiLibrarySections,
  buildManagedAiPanelModeButtons,
  buildManagedAiSessionRows,
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
  managedAiProjectDisplayLabelSet,
  managedAiProjectDisplayLabels,
  managedAiPrimarySessions,
  managedAiRequestKindLabelKey,
  managedAiSessionAllowsResume,
  managedAiSessionDisplayTitle,
  managedAiSessionIsChild,
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

const aiSessionsPanelStateStorageKey = 'aiopsterm.aiSessionsPanelState'

type AiSessionsPanelStoredState = {
  libraryGrouping?: ManagedAiLibraryGrouping
  collapsedLibrarySections?: string[]
  expandedChildGroups?: string[]
}

const validLibraryGrouping = (value: unknown): value is ManagedAiLibraryGrouping =>
  value === 'project' || value === 'agent' || value === 'time'

const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []

const readAiSessionsPanelState = (): AiSessionsPanelStoredState => {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(aiSessionsPanelStateStorageKey) || '{}') as Record<string, unknown>
    return {
      ...(validLibraryGrouping(parsed.libraryGrouping) ? { libraryGrouping: parsed.libraryGrouping } : {}),
      collapsedLibrarySections: stringArray(parsed.collapsedLibrarySections),
      expandedChildGroups: stringArray(parsed.expandedChildGroups)
    }
  } catch {
    return {}
  }
}

const writeAiSessionsPanelState = (state: AiSessionsPanelStoredState) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(aiSessionsPanelStateStorageKey, JSON.stringify(state))
  } catch {
    /* localStorage may be unavailable in restricted webviews. */
  }
}

export const useAiSessionsPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const storedPanelState = readAiSessionsPanelState()
  const query = ref('')
  const mode = ref<ManagedAiPanelMode>('pending')
  const libraryGrouping = ref<ManagedAiLibraryGrouping>(storedPanelState.libraryGrouping || 'project')
  const collapsedLibrarySections = ref<Set<string>>(new Set(storedPanelState.collapsedLibrarySections || []))
  const expandedChildGroups = ref<Set<string>>(new Set(storedPanelState.expandedChildGroups || []))
  const filter = ref<ManagedAiStateFilter>('needsInput')
  const eventFilter = ref<ManagedAiRequestKindFilter>('all')
  const replyText = ref('')
  const renameTitle = ref('')
  const locallySelectedSessionKey = ref('')
  const contextMenu = ref<{ visible: boolean; x: number; y: number; sessionKey: string }>({
    visible: false,
    x: 0,
    y: 0,
    sessionKey: ''
  })
  const eventFilters = computed(() => aiSessionsEventFilterOptions.map((option) => ({ key: option.key, label: t(option.labelKey) })))
  watch([libraryGrouping, collapsedLibrarySections, expandedChildGroups], () => {
    writeAiSessionsPanelState({
      libraryGrouping: libraryGrouping.value,
      collapsedLibrarySections: [...collapsedLibrarySections.value],
      expandedChildGroups: [...expandedChildGroups.value]
    })
  })

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
  const primarySessions = computed(() => managedAiPrimarySessions(workspace.sortedManagedAiSessions))

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
  const contextMenuSession = computed(() => workspace.sortedManagedAiSessions.find((session) => sessionKey(session) === contextMenu.value.sessionKey) || null)

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

  const projectLabel = (session: Pick<ManagedAiSession, 'cwd' | 'canonicalCwd'>) => managedAiProjectDisplayLabel(session, projectLabels.value, t('aiSessions.unknownProject'))
  const projectLabelCandidates = (session: Pick<ManagedAiSession, 'cwd' | 'canonicalCwd'>) =>
    managedAiProjectDisplayLabelSet(session, projectLabels.value, t('aiSessions.unknownProject')).candidates
  const sessionDisplayTitle = (session: Pick<ManagedAiSession, 'userTitle' | 'autoTitle' | 'title' | 'summary' | 'id'>) => managedAiSessionDisplayTitle(session)
  const sessionRowTitle = (session: ManagedAiSession) => sessionDisplayTitle(session)
  const liveLinkedPanelForSession = (session: Pick<ManagedAiSession, 'panelId' | 'terminalSessionId'>) => {
    const targetIds = [session.panelId, session.terminalSessionId].filter(Boolean)
    if (!targetIds.length) return null
    return (
      workspace.panels.find(
        (panel) =>
          (!panel.kind || panel.kind === 'terminal') &&
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
  const sessionRowStatusLabel = (session: Pick<ManagedAiSession, 'state' | 'panelId' | 'terminalSessionId'>) => {
    const dotState = sessionDotState(session)
    if (dotState === 'working') return t('aiSessions.rowStatus.running')
    if (dotState === 'needsInput') return t('aiSessions.rowStatus.pending')
    if (dotState === 'linked') return t('aiSessions.rowStatus.linked')
    return t('aiSessions.rowStatus.other')
  }
  const isSyntheticRowDetail = (_session: ManagedAiSession, detail: string) =>
    detail.trim().toLowerCase() === 'terminal closed'
  const sessionRowDetail = (session: ManagedAiSession) => {
    const detail = session.summary.trim()
    if (isSyntheticRowDetail(session, detail)) return ''
    return detail
  }
  const sessionRowTooltip = (session: ManagedAiSession) =>
    [sessionRowTitle(session), sessionRowDetail(session), sessionRowStatusLabel(session), sessionRowMeta(session), session.cwd || ''].filter(Boolean).join('\n')
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
      if (primarySessions.value.some((session) => session.state === 'working')) {
        selectMode('running')
        return
      }
      if (primarySessions.value.length > 0 || workspace.sortedManagedAiSessions.length > 0) selectMode('library')
    },
    { immediate: true }
  )

  const focusLinkedPanel = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
    const linkedPanel = liveLinkedPanelForSession(session)
    if (!linkedPanel) return false
    workspace.mode = 'terminal'
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

  const canResumeSession = (session: Pick<ManagedAiSession, 'state' | 'resumeCommand' | 'sessionKind' | 'restorable'>) => managedAiSessionAllowsResume(session)
  const isChildSession = (session: Pick<ManagedAiSession, 'sessionKind'>) => managedAiSessionIsChild(session)
  const childGroupKey = (session: Pick<ManagedAiSession, 'source' | 'id'>, suffix = 'children') => `${sessionKey(session)}:${suffix}`
  const isChildGroupExpanded = (key: string) => Boolean(query.value.trim()) || expandedChildGroups.value.has(key)
  const toggleChildGroup = (key: string) => {
    const next = new Set(expandedChildGroups.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedChildGroups.value = next
  }
  const sessionRows = (sessions: ManagedAiSession[]) => buildManagedAiSessionRows(sessions)
  const sectionOrphanChildGroupKey = (sectionKey: string) => `section:${sectionKey}:orphan-children`
  const flatOrphanChildGroupKey = () => `flat:${mode.value}:orphan-children`
  const sessionKindLabel = (session: Pick<ManagedAiSession, 'sessionKind'>) =>
    session.sessionKind === 'internal' ? t('aiSessions.internalSession') : t('aiSessions.childSession')

  const sessionGitMeta = (session: Pick<ManagedAiSession, 'gitBranch' | 'gitDirty'>) => {
    const branch = String(session.gitBranch || '').trim()
    return branch ? `${branch}${session.gitDirty ? '*' : ''}` : ''
  }

  const sessionRowMetaCandidates = (session: ManagedAiSession) => {
    const source = sourceLabel(session.source)
    const branch = sessionGitMeta(session)
    const time = formatRelativeTime(session.lastActivityAt)
    return projectLabelCandidates(session).map((project) => [source, branch, project, time].filter(Boolean).join(' · '))
  }

  const sessionRowMeta = (session: ManagedAiSession) => sessionRowMetaCandidates(session).at(-1) || ''
  const childSessionRowMeta = (session: ManagedAiSession) => [sourceLabel(session.source), formatRelativeTime(session.lastActivityAt)].filter(Boolean).join(' · ')
  const childSessionRowTooltip = (session: ManagedAiSession) =>
    [sessionRowTitle(session), sessionRowDetail(session), sessionKindLabel(session), childSessionRowMeta(session)].filter(Boolean).join('\n')

  const resumeOrFocusSession = (session: ManagedAiSession) => {
    if (focusLinkedPanel(session)) return
    if (canResumeSession(session)) {
      void workspace.resumeManagedAiSession(session.source, session.id)
      return
    }
    workspace.selectedManagedAiSessionKey = sessionKey(session)
  }

  const closeSessionContextMenu = () => {
    contextMenu.value = { visible: false, x: 0, y: 0, sessionKey: '' }
  }

  const openSessionContextMenu = (session: ManagedAiSession, event: MouseEvent) => {
    selectSession(session)
    const menuWidth = 210
    const menuHeight = 176
    const padding = 8
    const x = Math.min(Math.max(event.clientX, padding), Math.max(padding, window.innerWidth - menuWidth - padding))
    const y = Math.min(Math.max(event.clientY, padding), Math.max(padding, window.innerHeight - menuHeight - padding))
    contextMenu.value = {
      visible: true,
      x,
      y,
      sessionKey: sessionKey(session)
    }
  }

  const openContextSessionContent = () => {
    const session = contextMenuSession.value
    if (!session) return
    workspace.openManagedAiSessionContent(session.source, session.id)
    closeSessionContextMenu()
  }

  const locateContextSession = () => {
    const session = contextMenuSession.value
    if (!session) return
    resumeOrFocusSession(session)
    closeSessionContextMenu()
  }

  const markContextSessionHandled = () => {
    const session = contextMenuSession.value
    if (!session) return
    workspace.markManagedAiSessionHandled(session.source, session.id)
    closeSessionContextMenu()
  }

  const clearContextSession = () => {
    const session = contextMenuSession.value
    if (!session) return
    void workspace.clearManagedAiSession(session.source, session.id)
    closeSessionContextMenu()
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
    expandedChildGroups,
    eventFilter,
    replyText,
    renameTitle,
    contextMenu,
    contextMenuSession,
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
    openSessionContextMenu,
    closeSessionContextMenu,
    openContextSessionContent,
    locateContextSession,
    markContextSessionHandled,
    clearContextSession,
    locateSessionTerminal,
    renameSelectedSession,
    submitReply,
    submitQuestionReply,
    copyTimelineEvent,
    resumeOrFocusSession,
    projectLabel,
    sessionDisplayTitle,
    sessionRowTooltip,
    sessionRowTitle,
    sessionRowDetail,
    sessionRowMeta,
    sessionRowMetaCandidates,
    sessionDotState,
    canResumeSession,
    isChildSession,
    childGroupKey,
    isChildGroupExpanded,
    toggleChildGroup,
    sessionRows,
    sectionOrphanChildGroupKey,
    flatOrphanChildGroupKey,
    sessionKindLabel,
    childSessionRowMeta,
    childSessionRowTooltip,
    formatTime,
    formatRelativeTime
  }
}
