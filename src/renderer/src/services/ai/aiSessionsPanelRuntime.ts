import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { useI18n } from '@/i18n'
import {
  aiSessionsEventFilterOptions,
  aiSessionsStateFilterOptions,
  buildManagedAiActiveScopeLabel,
  buildManagedAiCockpitCards,
  filteredManagedAiTimelineEvents,
  formatManagedAiRelativeTime,
  formatManagedAiTime,
  managedAiAttentionQueue,
  managedAiDecisionLabelKey,
  managedAiDecisionModeLabelKey,
  managedAiEventLabelKey,
  managedAiLifecycleLabelKey,
  managedAiProjectOptions,
  managedAiRequestKindLabelKey,
  managedAiSessionKey,
  managedAiSessionStateLabelKey,
  managedAiSourceLabel,
  managedAiSourceOptions,
  managedAiTimelineEventCopyPayload,
  managedAiTimelineEventState,
  managedAiVisibleSessionSummaryPayload,
  selectedVisibleManagedAiSession,
  visibleManagedAiSessions,
  type ManagedAiCockpitFilterKey,
  type ManagedAiRequestKindFilter,
  type ManagedAiSourceFilter,
  type ManagedAiStateFilter,
  type ManagedAiTimelineEvent
} from '@/services/ai/aiSessionsPanelViewRuntime'
import type { ManagedAiSession, ManagedAiSessionState } from '@/services/ai/workspaceManagedAiTypes'
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

export const useAiSessionsPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const query = ref('')
  const filter = ref<ManagedAiStateFilter>('all')
  const eventFilter = ref<ManagedAiRequestKindFilter>('all')
  const sourceFilter = ref<ManagedAiSourceFilter>('all')
  const projectFilter = ref('all')
  const hibernatedOnly = ref(false)
  const replyText = ref('')
  const renameTitle = ref('')
  const filters = computed(() => aiSessionsStateFilterOptions.map((option) => ({ key: option.key, label: t(option.labelKey) })))
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

  const sourceOptions = computed(() => managedAiSourceOptions(workspace.sortedManagedAiSessions))
  const projectOptions = computed(() => managedAiProjectOptions(workspace.sortedManagedAiSessions, t('aiSessions.unknownPath')))
  const attentionQueue = computed(() => managedAiAttentionQueue(workspace.sortedManagedAiSessions))

  const cockpitCards = computed(() =>
    buildManagedAiCockpitCards({
      sessions: workspace.managedAiSessions,
      filter: filter.value,
      hibernatedOnly: hibernatedOnly.value,
      translate: t
    })
  )

  const applyStateFilter = (key: ManagedAiStateFilter) => {
    filter.value = key
    hibernatedOnly.value = false
  }

  const applyCockpitFilter = (key: ManagedAiCockpitFilterKey) => {
    if (key === 'hibernated') {
      filter.value = 'all'
      hibernatedOnly.value = true
      return
    }
    applyStateFilter(key)
  }

  const visibleSessions = computed(() =>
    visibleManagedAiSessions({
      sessions: workspace.sortedManagedAiSessions,
      query: query.value,
      filter: filter.value,
      sourceFilter: sourceFilter.value,
      projectFilter: projectFilter.value,
      hibernatedOnly: hibernatedOnly.value
    })
  )

  const visiblePendingSessions = computed(() => visibleSessions.value.filter((session) => session.state === 'needsInput'))

  const activeScopeLabel = computed(() =>
    buildManagedAiActiveScopeLabel({
      filter: filter.value,
      hibernatedOnly: hibernatedOnly.value,
      sourceFilter: sourceFilter.value,
      projectFilter: projectFilter.value,
      projectOptions: projectOptions.value,
      query: query.value,
      translate: t
    })
  )

  const selectedSession = computed(() => selectedVisibleManagedAiSession({ selectedSession: workspace.selectedManagedAiSession, visibleSessions: visibleSessions.value }))

  const filteredTimelineEvents = computed(() => filteredManagedAiTimelineEvents(selectedSession.value, eventFilter.value))

  watch(
    selectedSession,
    (session) => {
      renameTitle.value = session?.title || ''
      replyText.value = ''
      eventFilter.value = 'all'
    },
    { immediate: true }
  )

  const selectSession = (session: Pick<ManagedAiSession, 'source' | 'id' | 'panelId' | 'terminalSessionId'>) => {
    workspace.focusManagedAiSession(session.panelId || session.terminalSessionId || session.id)
    workspace.selectedManagedAiSessionKey = sessionKey(session)
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

  const visibleSessionSummaryPayload = () =>
    managedAiVisibleSessionSummaryPayload({
      activeScopeLabel: activeScopeLabel.value,
      visibleSessions: visibleSessions.value,
      visiblePendingCount: visiblePendingSessions.value.length,
      translate: t
    })

  const copyVisibleSessionQueue = async () => {
    const copied = await copyTextToClipboard(visibleSessionSummaryPayload())
    workspace.setTopNotice(copied ? t('aiSessions.queueCopied') : t('aiSessions.queueCopyFailed'))
  }

  const focusNextVisiblePending = () => {
    const selectedKey = selectedSession.value ? sessionKey(selectedSession.value) : ''
    const selectedIndex = visiblePendingSessions.value.findIndex((session) => sessionKey(session) === selectedKey)
    const next = visiblePendingSessions.value[(selectedIndex + 1) % visiblePendingSessions.value.length]
    if (!next) return
    selectSession(next)
  }

  const markVisiblePendingHandled = async () => {
    const pending = visiblePendingSessions.value
    if (!pending.length) return
    const groups = new Map<AiAgentSessionSource, string[]>()
    pending.forEach((session) => groups.set(session.source, [...(groups.get(session.source) || []), session.id]))
    for (const [source, sessionIds] of groups) {
      await workspace.bulkManagedAiSessions({
        operation: 'mark-handled',
        sources: [source],
        sessionIds
      })
    }
    workspace.setTopNotice(t('aiSessions.visibleHandled', { count: pending.length }))
  }

  const formatTime = (timestamp: number) => formatManagedAiTime(timestamp)

  const formatRelativeTime = (timestamp: number) => formatManagedAiRelativeTime(timestamp, Date.now(), t)

  return {
    workspace,
    t,
    query,
    filter,
    eventFilter,
    sourceFilter,
    projectFilter,
    hibernatedOnly,
    replyText,
    renameTitle,
    filters,
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
    sourceOptions,
    projectOptions,
    attentionQueue,
    cockpitCards,
    applyStateFilter,
    applyCockpitFilter,
    visibleSessions,
    visiblePendingSessions,
    activeScopeLabel,
    selectedSession,
    filteredTimelineEvents,
    selectSession,
    renameSelectedSession,
    submitReply,
    submitQuestionReply,
    copyTimelineEvent,
    copyVisibleSessionQueue,
    focusNextVisiblePending,
    markVisiblePendingHandled,
    formatTime,
    formatRelativeTime
  }
}
