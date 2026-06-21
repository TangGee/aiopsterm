import { computed, ref, watch } from 'vue'
import { useWorkspaceStore, type ManagedAiSession, type ManagedAiSessionState } from '@/stores/workspace'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { useI18n } from '@/i18n'
import type { AiAgentSessionEventName, AiAgentSessionSource } from '@shared/contracts/managedAiSessions'

export const useAiSessionsPanelRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()
  const query = ref('')
  const filter = ref<'all' | ManagedAiSessionState>('all')
  const eventFilter = ref<'all' | ManagedAiSession['events'][number]['requestKind']>('all')
  const sourceFilter = ref<'all' | AiAgentSessionSource>('all')
  const projectFilter = ref('all')
  const hibernatedOnly = ref(false)
  const replyText = ref('')
  const renameTitle = ref('')
  type CockpitFilterKey = 'all' | 'needsInput' | 'working' | 'idle' | 'ended' | 'hibernated'
  const filters = computed<Array<{ key: 'all' | ManagedAiSessionState; label: string }>>(() => [
  { key: 'all', label: t('aiSessions.filter.all') },
  { key: 'needsInput', label: t('aiSessions.filter.needsInput') },
  { key: 'working', label: t('aiSessions.filter.working') },
  { key: 'idle', label: t('aiSessions.filter.idle') },
  { key: 'ended', label: t('aiSessions.filter.ended') }
  ])
  const eventFilters = computed<Array<{ key: 'all' | ManagedAiSession['events'][number]['requestKind']; label: string }>>(() => [
  { key: 'all', label: t('aiSessions.filter.all') },
  { key: 'permission', label: t('aiSessions.eventFilter.permission') },
  { key: 'question', label: t('aiSessions.eventFilter.question') },
  { key: 'plan', label: t('aiSessions.eventFilter.plan') },
  { key: 'notification', label: t('aiSessions.eventFilter.notification') },
  { key: 'telemetry', label: t('aiSessions.eventFilter.telemetry') }
  ])

  const sourceLabel = (source: AiAgentSessionSource) => {
  const labels: Record<AiAgentSessionSource, string> = {
    'claude-code': 'Claude Code',
    antigravity: 'Antigravity',
    amp: 'Amp',
    codebuddy: 'CodeBuddy',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor',
    factory: 'Factory',
    gemini: 'Gemini',
    grok: 'Grok',
    'hermes-agent': 'Hermes Agent',
    kiro: 'Kiro',
    omp: 'OMP',
    opencode: 'OpenCode',
    pi: 'Pi',
    qoder: 'Qoder',
    rovodev: 'Rovo Dev'
  }
  return labels[source] || source
  }

  const stateLabel = (state: ManagedAiSessionState) => {
  if (state === 'needsInput') return t('aiSessions.filter.needsInput')
  if (state === 'working') return t('aiSessions.filter.working')
  if (state === 'idle') return t('aiSessions.filter.idle')
  if (state === 'ended') return t('aiSessions.filter.ended')
  return t('aiSessions.state.unknown')
  }

  const lifecycleLabel = (lifecycle: NonNullable<ManagedAiSession['agentLifecycle']>) => {
  if (lifecycle === 'running') return t('aiSessions.filter.working')
  if (lifecycle === 'idle') return t('aiSessions.filter.idle')
  if (lifecycle === 'needsInput') return t('aiSessions.filter.needsInput')
  if (lifecycle === 'ended') return t('aiSessions.filter.ended')
  return t('aiSessions.state.unknown')
  }

  const requestKindLabel = (kind: ManagedAiSession['requestKind']) => {
  if (kind === 'permission') return t('aiSessions.request.permission')
  if (kind === 'question') return t('aiSessions.request.question')
  if (kind === 'plan') return t('aiSessions.request.plan')
  if (kind === 'notification') return t('aiSessions.request.notification')
  return t('aiSessions.request.telemetry')
  }

  const decisionModeLabel = (mode: ManagedAiSession['decisionMode']) => {
  if (mode === 'blocking') return t('aiSessions.decision.blocking')
  if (mode === 'local') return t('aiSessions.decision.local')
  return t('aiSessions.decision.telemetry')
  }

  const eventLabel = (event: AiAgentSessionEventName) => {
  if (event === 'session_start') return t('aiSessions.event.sessionStart')
  if (event === 'prompt_submit') return t('aiSessions.event.promptSubmit')
  if (event === 'pre_tool_use') return t('aiSessions.event.toolUse')
  if (event === 'permission_request') return t('aiSessions.event.permissionRequest')
  if (event === 'question') return t('aiSessions.event.question')
  if (event === 'notification') return t('aiSessions.event.notification')
  if (event === 'lifecycle') return t('aiSessions.event.lifecycle')
  if (event === 'stop') return t('aiSessions.event.stop')
  return t('aiSessions.event.sessionEnd')
  }

  const timelineEventNeedsInput = (event: ManagedAiSession['events'][number]) => {
  if (event.source === 'codex' && event.event === 'permission_request') return false
  if (event.requestKind === 'telemetry') return false
  if (event.decisionMode === 'blocking') return true
  if (event.requestKind === 'notification') return true
  return event.actionable === true
  }

  const eventState = (event: ManagedAiSession['events'][number]): ManagedAiSessionState => {
  if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return timelineEventNeedsInput(event) ? 'needsInput' : 'working'
  if (event.event === 'prompt_submit' || event.event === 'pre_tool_use' || event.event === 'lifecycle') return 'working'
  if (event.event === 'session_end') return 'ended'
  return 'idle'
  }

  const decisionLabel = (kind: string) => {
  if (kind === 'allow') return t('aiSessions.decision.allow')
  if (kind === 'always') return t('aiSessions.decision.always')
  if (kind === 'bypass') return t('aiSessions.decision.bypass')
  if (kind === 'deny') return t('aiSessions.decision.deny')
  if (kind === 'reply') return t('aiSessions.decision.reply')
  return t('aiSessions.decision.handled')
  }

  const sessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

  const projectKeyFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  return normalized || '__unknown__'
  }

  const projectLabelFor = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  if (!normalized) return t('aiSessions.unknownPath')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) || normalized
  }

  const sourceOptions = computed(() => {
  const sources = new Set<AiAgentSessionSource>()
  workspace.sortedManagedAiSessions.forEach((session) => sources.add(session.source))
  return [...sources].sort((first, second) => sourceLabel(first).localeCompare(sourceLabel(second)))
  })

  const projectOptions = computed(() => {
  const projects = new Map<string, { key: string; label: string; count: number; latest: number }>()
  workspace.sortedManagedAiSessions.forEach((session) => {
    const key = projectKeyFor(session.cwd)
    const existing = projects.get(key)
    projects.set(key, {
      key,
      label: existing?.label || projectLabelFor(session.cwd),
      count: (existing?.count || 0) + 1,
      latest: Math.max(existing?.latest || 0, session.lastActivityAt || 0)
    })
  })
  return [...projects.values()]
    .sort((first, second) => second.latest - first.latest || first.label.localeCompare(second.label))
    .map((project) => ({
      ...project,
      label: `${project.label} (${project.count})`
    }))
  })

  const attentionQueue = computed(() =>
  workspace.sortedManagedAiSessions.filter((session) => session.state === 'needsInput').sort((first, second) => second.lastActivityAt - first.lastActivityAt)
  )

  const hibernatedSessions = computed(() => workspace.sortedManagedAiSessions.filter((session) => session.hibernated))

  const cockpitCards = computed<Array<{ key: CockpitFilterKey; label: string; value: number; active: boolean }>>(() => [
  { key: 'all', label: t('aiSessions.cockpit.total'), value: workspace.managedAiSessions.length, active: filter.value === 'all' && !hibernatedOnly.value },
  { key: 'needsInput', label: t('aiSessions.filter.needsInput'), value: attentionQueue.value.length, active: filter.value === 'needsInput' && !hibernatedOnly.value },
  { key: 'working', label: t('aiSessions.filter.working'), value: workspace.managedAiSessions.filter((session) => session.state === 'working').length, active: filter.value === 'working' && !hibernatedOnly.value },
  { key: 'idle', label: t('aiSessions.filter.idle'), value: workspace.managedAiSessions.filter((session) => session.state === 'idle').length, active: filter.value === 'idle' && !hibernatedOnly.value },
  { key: 'ended', label: t('aiSessions.filter.ended'), value: workspace.managedAiSessions.filter((session) => session.state === 'ended').length, active: filter.value === 'ended' && !hibernatedOnly.value },
  { key: 'hibernated', label: t('aiSessions.filter.hibernated'), value: hibernatedSessions.value.length, active: hibernatedOnly.value }
  ])

  const applyStateFilter = (key: 'all' | ManagedAiSessionState) => {
  filter.value = key
  hibernatedOnly.value = false
  }

  const applyCockpitFilter = (key: CockpitFilterKey) => {
  if (key === 'hibernated') {
    filter.value = 'all'
    hibernatedOnly.value = true
    return
  }
  applyStateFilter(key)
  }

  const visibleSessions = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return workspace.sortedManagedAiSessions.filter((session) => {
    if (hibernatedOnly.value && session.hibernated !== true) return false
    if (filter.value !== 'all' && session.state !== filter.value) return false
    if (sourceFilter.value !== 'all' && session.source !== sourceFilter.value) return false
    if (projectFilter.value !== 'all' && projectKeyFor(session.cwd) !== projectFilter.value) return false
    if (!needle) return true
    return [session.title, session.summary, session.source, session.cwd, session.id].some((value) => String(value || '').toLowerCase().includes(needle))
  })
  })

  const visiblePendingSessions = computed(() => visibleSessions.value.filter((session) => session.state === 'needsInput'))

  const activeScopeLabel = computed(() => {
  const parts: string[] = []
  if (filter.value !== 'all') parts.push(stateLabel(filter.value))
  if (hibernatedOnly.value) parts.push(t('aiSessions.filter.hibernated'))
  if (sourceFilter.value !== 'all') parts.push(sourceLabel(sourceFilter.value))
  if (projectFilter.value !== 'all') parts.push(projectOptions.value.find((project) => project.key === projectFilter.value)?.label || projectFilter.value)
  if (query.value.trim()) parts.push(t('aiSessions.scopeSearch', { query: query.value.trim() }))
  return parts.length ? parts.join(' / ') : t('aiSessions.scopeAll')
  })

  const selectedSession = computed(() => {
  const selected = workspace.selectedManagedAiSession
  if (selected && visibleSessions.value.some((session) => sessionKey(session) === sessionKey(selected))) return selected
  return visibleSessions.value[0] || null
  })

  const filteredTimelineEvents = computed(() => {
  const events = selectedSession.value?.events.slice().reverse() || []
  if (eventFilter.value === 'all') return events
  return events.filter((event) => event.requestKind === eventFilter.value)
  })

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

  const timelineEventCopyPayload = (event: ManagedAiSession['events'][number]) =>
  JSON.stringify(
    {
      id: event.id,
      source: event.source,
      event: event.event,
      sessionId: event.sessionId,
      title: event.title,
      summary: event.summary,
      receivedAt: event.receivedAt,
      requestKind: event.requestKind,
      decisionMode: event.decisionMode,
      ...(event.requestId ? { requestId: event.requestId } : {}),
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : {}),
      ...(event.cwd ? { cwd: event.cwd } : {}),
      ...(event.transcriptPath ? { transcriptPath: event.transcriptPath } : {}),
      ...(event.agentLifecycle ? { agentLifecycle: event.agentLifecycle } : {})
    },
    null,
    2
  )

  const copyTimelineEvent = async (event: ManagedAiSession['events'][number]) => {
  const copied = await copyTextToClipboard(timelineEventCopyPayload(event))
  workspace.setTopNotice(copied ? t('aiSessions.eventCopied') : t('aiSessions.eventCopyFailed'))
  }

  const visibleSessionSummaryPayload = () =>
  [
    t('aiSessions.queueHeader', { scope: activeScopeLabel.value }),
    t('aiSessions.queueCounts', { current: visibleSessions.value.length, pending: visiblePendingSessions.value.length }),
    '',
    ...visibleSessions.value.map((session, index) => {
      const status = `${stateLabel(session.state)} / ${requestKindLabel(session.requestKind)} / ${decisionModeLabel(session.decisionMode)}`
      const lines = [
        `${index + 1}. ${session.title}`,
        `   ${t('aiSessions.copy.agent')}: ${sourceLabel(session.source)} (${session.source})`,
        `   ${t('aiSessions.copy.status')}: ${status}`,
        `   ${t('aiSessions.copy.session')}: ${session.id}`,
        session.cwd ? `   ${t('aiSessions.copy.path')}: ${session.cwd}` : '',
        session.summary ? `   ${t('aiSessions.copy.summary')}: ${session.summary}` : '',
        session.resumeCommand ? `   ${t('aiSessions.copy.resume')}: ${session.resumeCommand}` : ''
      ].filter(Boolean)
      return lines.join('\n')
    })
  ].join('\n')

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

  const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))

  const formatRelativeTime = (timestamp: number) => {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (deltaSeconds < 60) return t('aiSessions.relative.secondsAgo', { count: deltaSeconds })
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) return t('aiSessions.relative.minutesAgo', { count: deltaMinutes })
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return t('aiSessions.relative.hoursAgo', { count: deltaHours })
  return t('aiSessions.relative.daysAgo', { count: Math.round(deltaHours / 24) })
  }

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
