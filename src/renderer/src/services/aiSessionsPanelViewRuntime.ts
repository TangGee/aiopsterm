import type { I18nKey } from '@/i18n'
import type { ManagedAiSession, ManagedAiSessionState } from '@/services/workspaceManagedAiTypes'
import type {
  AiAgentSessionEventName,
  AiAgentSessionSource,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionDecisionKind,
  ManagedAiSessionLifecycle
} from '@shared/contracts/managedAiSessions'

export type ManagedAiPanelTranslate = (key: I18nKey, params?: Record<string, string | number>) => string
export type ManagedAiTimelineEvent = ManagedAiSession['events'][number]
export type ManagedAiStateFilter = 'all' | ManagedAiSessionState
export type ManagedAiRequestKindFilter = 'all' | ManagedAiTimelineEvent['requestKind']
export type ManagedAiSourceFilter = 'all' | AiAgentSessionSource
export type ManagedAiCockpitFilterKey = 'all' | 'needsInput' | 'working' | 'idle' | 'ended' | 'hibernated'

export type ManagedAiProjectOption = {
  key: string
  label: string
  count: number
  latest: number
}

export type ManagedAiCockpitCard = {
  key: ManagedAiCockpitFilterKey
  label: string
  value: number
  active: boolean
}

export const aiSessionsStateFilterOptions: Array<{ key: ManagedAiStateFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'aiSessions.filter.all' },
  { key: 'needsInput', labelKey: 'aiSessions.filter.needsInput' },
  { key: 'working', labelKey: 'aiSessions.filter.working' },
  { key: 'idle', labelKey: 'aiSessions.filter.idle' },
  { key: 'ended', labelKey: 'aiSessions.filter.ended' }
]

export const aiSessionsEventFilterOptions: Array<{ key: ManagedAiRequestKindFilter; labelKey: I18nKey }> = [
  { key: 'all', labelKey: 'aiSessions.filter.all' },
  { key: 'permission', labelKey: 'aiSessions.eventFilter.permission' },
  { key: 'question', labelKey: 'aiSessions.eventFilter.question' },
  { key: 'plan', labelKey: 'aiSessions.eventFilter.plan' },
  { key: 'notification', labelKey: 'aiSessions.eventFilter.notification' },
  { key: 'telemetry', labelKey: 'aiSessions.eventFilter.telemetry' }
]

const sourceLabels: Record<AiAgentSessionSource, string> = {
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

export const managedAiSourceLabel = (source: AiAgentSessionSource) => sourceLabels[source] || source

export const managedAiSessionStateLabelKey = (state: ManagedAiSessionState): I18nKey => {
  if (state === 'needsInput') return 'aiSessions.filter.needsInput'
  if (state === 'working') return 'aiSessions.filter.working'
  if (state === 'idle') return 'aiSessions.filter.idle'
  if (state === 'ended') return 'aiSessions.filter.ended'
  return 'aiSessions.state.unknown'
}

export const managedAiLifecycleLabelKey = (lifecycle: ManagedAiSessionLifecycle): I18nKey => {
  if (lifecycle === 'running') return 'aiSessions.filter.working'
  if (lifecycle === 'idle') return 'aiSessions.filter.idle'
  if (lifecycle === 'needsInput') return 'aiSessions.filter.needsInput'
  if (lifecycle === 'ended') return 'aiSessions.filter.ended'
  return 'aiSessions.state.unknown'
}

export const managedAiRequestKindLabelKey = (kind: ManagedAiRequestKind): I18nKey => {
  if (kind === 'permission') return 'aiSessions.request.permission'
  if (kind === 'question') return 'aiSessions.request.question'
  if (kind === 'plan') return 'aiSessions.request.plan'
  if (kind === 'notification') return 'aiSessions.request.notification'
  return 'aiSessions.request.telemetry'
}

export const managedAiDecisionModeLabelKey = (mode: ManagedAiDecisionMode): I18nKey => {
  if (mode === 'blocking') return 'aiSessions.decision.blocking'
  if (mode === 'local') return 'aiSessions.decision.local'
  return 'aiSessions.decision.telemetry'
}

export const managedAiEventLabelKey = (event: AiAgentSessionEventName): I18nKey => {
  if (event === 'session_start') return 'aiSessions.event.sessionStart'
  if (event === 'prompt_submit') return 'aiSessions.event.promptSubmit'
  if (event === 'pre_tool_use') return 'aiSessions.event.toolUse'
  if (event === 'permission_request') return 'aiSessions.event.permissionRequest'
  if (event === 'question') return 'aiSessions.event.question'
  if (event === 'notification') return 'aiSessions.event.notification'
  if (event === 'lifecycle') return 'aiSessions.event.lifecycle'
  if (event === 'stop') return 'aiSessions.event.stop'
  return 'aiSessions.event.sessionEnd'
}

export const managedAiDecisionLabelKey = (kind: ManagedAiSessionDecisionKind | string): I18nKey => {
  if (kind === 'allow') return 'aiSessions.decision.allow'
  if (kind === 'always') return 'aiSessions.decision.always'
  if (kind === 'bypass') return 'aiSessions.decision.bypass'
  if (kind === 'deny') return 'aiSessions.decision.deny'
  if (kind === 'reply') return 'aiSessions.decision.reply'
  return 'aiSessions.decision.handled'
}

export const managedAiSessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

export const managedAiProjectKey = (cwd?: string) => {
  const normalized = String(cwd || '').trim()
  return normalized || '__unknown__'
}

export const managedAiProjectLabel = (cwd: string | undefined, unknownPathLabel: string) => {
  const normalized = String(cwd || '').trim()
  if (!normalized) return unknownPathLabel
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) || normalized
}

export const managedAiSourceOptions = (sessions: ManagedAiSession[]) => {
  const sources = new Set<AiAgentSessionSource>()
  sessions.forEach((session) => sources.add(session.source))
  return [...sources].sort((first, second) => managedAiSourceLabel(first).localeCompare(managedAiSourceLabel(second)))
}

export const managedAiProjectOptions = (sessions: ManagedAiSession[], unknownPathLabel: string): ManagedAiProjectOption[] => {
  const projects = new Map<string, ManagedAiProjectOption>()
  sessions.forEach((session) => {
    const key = managedAiProjectKey(session.cwd)
    const existing = projects.get(key)
    projects.set(key, {
      key,
      label: existing?.label || managedAiProjectLabel(session.cwd, unknownPathLabel),
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
}

export const managedAiAttentionQueue = (sessions: ManagedAiSession[]) =>
  sessions.filter((session) => session.state === 'needsInput').sort((first, second) => second.lastActivityAt - first.lastActivityAt)

export const managedAiHibernatedSessions = (sessions: ManagedAiSession[]) => sessions.filter((session) => session.hibernated)

export const buildManagedAiCockpitCards = (input: {
  sessions: ManagedAiSession[]
  filter: ManagedAiStateFilter
  hibernatedOnly: boolean
  translate: ManagedAiPanelTranslate
}): ManagedAiCockpitCard[] => {
  const { sessions, filter, hibernatedOnly, translate } = input
  return [
    { key: 'all', label: translate('aiSessions.cockpit.total'), value: sessions.length, active: filter === 'all' && !hibernatedOnly },
    {
      key: 'needsInput',
      label: translate('aiSessions.filter.needsInput'),
      value: sessions.filter((session) => session.state === 'needsInput').length,
      active: filter === 'needsInput' && !hibernatedOnly
    },
    {
      key: 'working',
      label: translate('aiSessions.filter.working'),
      value: sessions.filter((session) => session.state === 'working').length,
      active: filter === 'working' && !hibernatedOnly
    },
    {
      key: 'idle',
      label: translate('aiSessions.filter.idle'),
      value: sessions.filter((session) => session.state === 'idle').length,
      active: filter === 'idle' && !hibernatedOnly
    },
    {
      key: 'ended',
      label: translate('aiSessions.filter.ended'),
      value: sessions.filter((session) => session.state === 'ended').length,
      active: filter === 'ended' && !hibernatedOnly
    },
    {
      key: 'hibernated',
      label: translate('aiSessions.filter.hibernated'),
      value: sessions.filter((session) => session.hibernated).length,
      active: hibernatedOnly
    }
  ]
}

export const visibleManagedAiSessions = (input: {
  sessions: ManagedAiSession[]
  query: string
  filter: ManagedAiStateFilter
  sourceFilter: ManagedAiSourceFilter
  projectFilter: string
  hibernatedOnly: boolean
}) => {
  const needle = input.query.trim().toLowerCase()
  return input.sessions.filter((session) => {
    if (input.hibernatedOnly && session.hibernated !== true) return false
    if (input.filter !== 'all' && session.state !== input.filter) return false
    if (input.sourceFilter !== 'all' && session.source !== input.sourceFilter) return false
    if (input.projectFilter !== 'all' && managedAiProjectKey(session.cwd) !== input.projectFilter) return false
    if (!needle) return true
    return [session.title, session.summary, session.source, session.cwd, session.id].some((value) => String(value || '').toLowerCase().includes(needle))
  })
}

export const buildManagedAiActiveScopeLabel = (input: {
  filter: ManagedAiStateFilter
  hibernatedOnly: boolean
  sourceFilter: ManagedAiSourceFilter
  projectFilter: string
  projectOptions: ManagedAiProjectOption[]
  query: string
  translate: ManagedAiPanelTranslate
}) => {
  const parts: string[] = []
  if (input.filter !== 'all') parts.push(input.translate(managedAiSessionStateLabelKey(input.filter)))
  if (input.hibernatedOnly) parts.push(input.translate('aiSessions.filter.hibernated'))
  if (input.sourceFilter !== 'all') parts.push(managedAiSourceLabel(input.sourceFilter))
  if (input.projectFilter !== 'all') parts.push(input.projectOptions.find((project) => project.key === input.projectFilter)?.label || input.projectFilter)
  const query = input.query.trim()
  if (query) parts.push(input.translate('aiSessions.scopeSearch', { query }))
  return parts.length ? parts.join(' / ') : input.translate('aiSessions.scopeAll')
}

export const selectedVisibleManagedAiSession = (input: {
  selectedSession: ManagedAiSession | null
  visibleSessions: ManagedAiSession[]
}) => {
  const { selectedSession, visibleSessions } = input
  if (selectedSession && visibleSessions.some((session) => managedAiSessionKey(session) === managedAiSessionKey(selectedSession))) return selectedSession
  return visibleSessions[0] || null
}

export const filteredManagedAiTimelineEvents = (session: ManagedAiSession | null, eventFilter: ManagedAiRequestKindFilter) => {
  const events = session?.events.slice().reverse() || []
  if (eventFilter === 'all') return events
  return events.filter((event) => event.requestKind === eventFilter)
}

export const managedAiTimelineEventNeedsInput = (event: ManagedAiTimelineEvent) => {
  if (event.source === 'codex' && event.event === 'permission_request') return false
  if (event.requestKind === 'telemetry') return false
  if (event.decisionMode === 'blocking') return true
  if (event.requestKind === 'notification') return true
  return event.actionable === true
}

export const managedAiTimelineEventState = (event: ManagedAiTimelineEvent): ManagedAiSessionState => {
  if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return managedAiTimelineEventNeedsInput(event) ? 'needsInput' : 'working'
  if (event.event === 'prompt_submit' || event.event === 'pre_tool_use' || event.event === 'lifecycle') return 'working'
  if (event.event === 'session_end') return 'ended'
  return 'idle'
}

export const managedAiTimelineEventCopyPayload = (event: ManagedAiTimelineEvent) =>
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

export const managedAiVisibleSessionSummaryPayload = (input: {
  activeScopeLabel: string
  visibleSessions: ManagedAiSession[]
  visiblePendingCount: number
  translate: ManagedAiPanelTranslate
}) =>
  [
    input.translate('aiSessions.queueHeader', { scope: input.activeScopeLabel }),
    input.translate('aiSessions.queueCounts', { current: input.visibleSessions.length, pending: input.visiblePendingCount }),
    '',
    ...input.visibleSessions.map((session, index) => {
      const status = [
        input.translate(managedAiSessionStateLabelKey(session.state)),
        input.translate(managedAiRequestKindLabelKey(session.requestKind)),
        input.translate(managedAiDecisionModeLabelKey(session.decisionMode))
      ].join(' / ')
      const lines = [
        `${index + 1}. ${session.title}`,
        `   ${input.translate('aiSessions.copy.agent')}: ${managedAiSourceLabel(session.source)} (${session.source})`,
        `   ${input.translate('aiSessions.copy.status')}: ${status}`,
        `   ${input.translate('aiSessions.copy.session')}: ${session.id}`,
        session.cwd ? `   ${input.translate('aiSessions.copy.path')}: ${session.cwd}` : '',
        session.summary ? `   ${input.translate('aiSessions.copy.summary')}: ${session.summary}` : '',
        session.resumeCommand ? `   ${input.translate('aiSessions.copy.resume')}: ${session.resumeCommand}` : ''
      ].filter(Boolean)
      return lines.join('\n')
    })
  ].join('\n')

export const formatManagedAiTime = (timestamp: number, locales?: Intl.LocalesArgument) =>
  new Intl.DateTimeFormat(locales, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp))

export const formatManagedAiRelativeTime = (timestamp: number, now: number, translate: ManagedAiPanelTranslate) => {
  const deltaSeconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (deltaSeconds < 60) return translate('aiSessions.relative.secondsAgo', { count: deltaSeconds })
  const deltaMinutes = Math.round(deltaSeconds / 60)
  if (deltaMinutes < 60) return translate('aiSessions.relative.minutesAgo', { count: deltaMinutes })
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return translate('aiSessions.relative.hoursAgo', { count: deltaHours })
  return translate('aiSessions.relative.daysAgo', { count: Math.round(deltaHours / 24) })
}
