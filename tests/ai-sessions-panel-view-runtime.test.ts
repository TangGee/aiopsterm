import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildManagedAiActiveScopeLabel,
  buildManagedAiCockpitCards,
  buildManagedAiLibrarySections,
  buildManagedAiPanelModeButtons,
  buildManagedAiSessionRows,
  filteredManagedAiTimelineEvents,
  formatManagedAiRelativeTime,
  managedAiAttentionQueue,
  managedAiPanelModeForSession,
  managedAiPanelModeStateFilter,
  managedAiProjectDisplayLabel,
  managedAiProjectDisplayLabelSet,
  managedAiProjectDisplayLabels,
  managedAiProjectGroupKey,
  managedAiProjectKey,
  managedAiProjectOptions,
  managedAiSessionAllowsResume,
  managedAiSessionDisplayTitle,
  managedAiSessionIsChild,
  managedAiSessionKey,
  managedAiSourceOptions,
  managedAiTimelineEventCopyPayload,
  managedAiTimelineEventState,
  managedAiVisibleSessionSummaryPayload,
  selectedVisibleManagedAiSession,
  visibleManagedAiSessions,
  type ManagedAiPanelTranslate,
  type ManagedAiTimelineEvent
} from '@/services/ai/aiSessionsPanelViewRuntime'
import type { ManagedAiSession } from '@/services/ai/workspaceManagedAiTypes'
import type {
  AiAgentSessionEventName,
  AiAgentSessionSource,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionState
} from '@shared/contracts/managedAiSessions'

const labels: Record<string, string> = {
  'aiSessions.cockpit.total': 'Total',
  'aiSessions.filter.needsInput': 'Needs input',
  'aiSessions.filter.working': 'Working',
  'aiSessions.filter.idle': 'Idle',
  'aiSessions.filter.ended': 'Ended',
  'aiSessions.filter.hibernated': 'Hibernated',
  'aiSessions.mode.pending': 'Pending',
  'aiSessions.mode.pendingTooltip': 'Needs your action',
  'aiSessions.mode.running': 'Running',
  'aiSessions.mode.runningTooltip': 'Working sessions',
  'aiSessions.mode.library': 'Library',
  'aiSessions.mode.libraryTooltip': 'All sessions',
  'aiSessions.scopeAll': 'All scope',
  'aiSessions.scopeSearch': 'Search: {query}',
  'aiSessions.queueHeader': 'AI session queue: {scope}',
  'aiSessions.queueCounts': 'Current: {current}, pending: {pending}',
  'aiSessions.request.permission': 'Permission',
  'aiSessions.request.question': 'Question',
  'aiSessions.request.notification': 'Notification',
  'aiSessions.request.telemetry': 'Telemetry',
  'aiSessions.decision.blocking': 'Blocking',
  'aiSessions.decision.local': 'Local',
  'aiSessions.decision.telemetry': 'Telemetry only',
  'aiSessions.copy.agent': 'Agent',
  'aiSessions.copy.status': 'Request',
  'aiSessions.copy.session': 'Session',
  'aiSessions.copy.path': 'Path',
  'aiSessions.copy.summary': 'Summary',
  'aiSessions.copy.resume': 'Resume',
  'aiSessions.relative.secondsAgo': '{count}s ago',
  'aiSessions.relative.minutesAgo': '{count}m ago',
  'aiSessions.relative.hoursAgo': '{count}h ago',
  'aiSessions.relative.daysAgo': '{count}d ago'
}

const t: ManagedAiPanelTranslate = (key, params) => {
  const template = labels[key] || key
  if (!params) return template
  return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template)
}

const makeEvent = (input: {
  id: string
  source?: AiAgentSessionSource
  event?: AiAgentSessionEventName
  sessionId?: string
  title?: string
  summary?: string
  receivedAt?: number
  requestKind?: ManagedAiRequestKind
  decisionMode?: ManagedAiDecisionMode
  actionable?: boolean
  requestId?: string
  raw?: Record<string, unknown>
}): ManagedAiTimelineEvent => ({
  source: input.source || 'claude-code',
  event: input.event || 'permission_request',
  sessionId: input.sessionId || 'session-1',
  title: input.title || 'Event',
  summary: input.summary || 'Event summary',
  receivedAt: input.receivedAt || 100,
  id: input.id,
  requestKind: input.requestKind || 'permission',
  decisionMode: input.decisionMode || 'blocking',
  ...(typeof input.actionable === 'boolean' ? { actionable: input.actionable } : {}),
  ...(input.requestId ? { requestId: input.requestId } : {}),
  ...(input.raw ? { raw: input.raw } : {})
})

const makeSession = (input: {
  id: string
  source: AiAgentSessionSource
  title: string
  summary?: string
  state: ManagedAiSessionState
  lastEvent?: AiAgentSessionEventName
  lastActivityAt: number
  cwd?: string
  canonicalCwd?: string
  gitBranch?: string
  gitDirty?: boolean
  requestKind?: ManagedAiRequestKind
  decisionMode?: ManagedAiDecisionMode
  hibernated?: boolean
  resumeCommand?: string
  sessionKind?: ManagedAiSession['sessionKind']
  parentSessionId?: string
  restorable?: boolean
  events?: ManagedAiTimelineEvent[]
}): ManagedAiSession => ({
  id: input.id,
  source: input.source,
  title: input.title,
  summary: input.summary || '',
  state: input.state,
  lastEvent: input.lastEvent || 'permission_request',
  lastActivityAt: input.lastActivityAt,
  createdAt: input.lastActivityAt - 10,
  updatedAt: input.lastActivityAt,
  ...(input.cwd ? { cwd: input.cwd } : {}),
  ...(input.canonicalCwd ? { canonicalCwd: input.canonicalCwd } : {}),
  ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
  ...(typeof input.gitDirty === 'boolean' ? { gitDirty: input.gitDirty } : {}),
  requestKind: input.requestKind || 'permission',
  decisionMode: input.decisionMode || 'blocking',
  ...(input.hibernated ? { hibernated: input.hibernated } : {}),
  ...(input.resumeCommand ? { resumeCommand: input.resumeCommand } : {}),
  ...(input.sessionKind ? { sessionKind: input.sessionKind } : {}),
  ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
  ...(typeof input.restorable === 'boolean' ? { restorable: input.restorable } : {}),
  events: input.events || [],
  decisions: []
})

const sessions: ManagedAiSession[] = [
  makeSession({
    id: 'claude-api',
    source: 'claude-code',
    title: 'Deploy approval',
    summary: 'Approve release',
    state: 'needsInput',
    lastActivityAt: 300,
    cwd: '/work/api',
    requestKind: 'permission',
    decisionMode: 'blocking',
    resumeCommand: 'claude --resume claude-api'
  }),
  makeSession({
    id: 'gemini-api',
    source: 'gemini',
    title: 'API refactor',
    summary: 'Reading files',
    state: 'working',
    lastEvent: 'pre_tool_use',
    lastActivityAt: 250,
    cwd: '/work/api',
    requestKind: 'telemetry',
    decisionMode: 'telemetry'
  }),
  makeSession({
    id: 'codex-docs',
    source: 'codex',
    title: 'Docs cleanup',
    summary: 'Round finished',
    state: 'idle',
    lastEvent: 'stop',
    lastActivityAt: 200,
    cwd: '/work/docs',
    requestKind: 'telemetry',
    decisionMode: 'telemetry'
  }),
  makeSession({
    id: 'cursor-unknown',
    source: 'cursor',
    title: 'Unknown project',
    state: 'ended',
    lastEvent: 'session_end',
    lastActivityAt: 400,
    hibernated: true,
    requestKind: 'notification',
    decisionMode: 'local'
  })
]

describe('aiSessionsPanelViewRuntime', () => {
  it('projects source and project options with stable labels, counts, and recency ordering', () => {
    expect(managedAiSessionKey(sessions[0])).toBe('claude-code:claude-api')
    expect(managedAiProjectKey(undefined)).toBe('__unknown__')
    expect(managedAiProjectGroupKey({ cwd: '/link/api', canonicalCwd: '/work/api' })).toBe('/work/api')
    expect(managedAiSourceOptions(sessions)).toEqual(['claude-code', 'codex', 'cursor', 'gemini'])

    expect(managedAiProjectOptions(sessions, 'Unknown path')).toEqual([
      { key: '__unknown__', label: 'Unknown path (1)', count: 1, latest: 400 },
      { key: '/work/api', label: 'api (2)', count: 2, latest: 300 },
      { key: '/work/docs', label: 'docs (1)', count: 1, latest: 200 }
    ])
  })

  it('groups symlink aliases by canonical project path before adding duplicate markers', () => {
    const home = process.env.HOME || homedir()
    const projectPath = join(home, 'sdd', 'work', 'learn_ai', 'aiopsterm')
    const linkedProjectPath = join(home, 'sdd', 'links', 'aiopsterm')
    const otherProjectPath = join(home, 'zzz-other', 'aiopsterm')
    const compactProjectPath = process.env.HOME ? `~/${relative(process.env.HOME, projectPath)}` : projectPath
    const aliasedProjectSessions = [
      makeSession({
        id: 'codex-real-aiopsterm',
        source: 'codex',
        title: 'Real cwd',
        state: 'idle',
        lastActivityAt: 500,
        cwd: projectPath,
        canonicalCwd: projectPath,
        requestKind: 'telemetry',
        decisionMode: 'telemetry'
      }),
      makeSession({
        id: 'claude-link-aiopsterm',
        source: 'claude-code',
        title: 'Link cwd',
        state: 'idle',
        lastActivityAt: 490,
        cwd: linkedProjectPath,
        canonicalCwd: projectPath,
        requestKind: 'telemetry',
        decisionMode: 'telemetry'
      }),
      makeSession({
        id: 'gemini-other-aiopsterm',
        source: 'gemini',
        title: 'Other cwd',
        state: 'idle',
        lastActivityAt: 480,
        cwd: otherProjectPath,
        canonicalCwd: otherProjectPath,
        requestKind: 'telemetry',
        decisionMode: 'telemetry'
      })
    ]
    const projectLabels = managedAiProjectDisplayLabels(aliasedProjectSessions, 'Unknown project')

    expect(managedAiProjectDisplayLabel(aliasedProjectSessions[0], projectLabels, 'Unknown project')).toBe('aiopsterm ①')
    expect(managedAiProjectDisplayLabel(aliasedProjectSessions[1], projectLabels, 'Unknown project')).toBe('aiopsterm ①')
    expect(managedAiProjectDisplayLabel(aliasedProjectSessions[2], projectLabels, 'Unknown project')).toBe('aiopsterm ②')
    expect(managedAiProjectDisplayLabelSet(aliasedProjectSessions[0], projectLabels, 'Unknown project').candidates).toEqual([
      `${compactProjectPath} ①`,
      'work/learn_ai/aiopsterm ①',
      'learn_ai/aiopsterm ①',
      'aiopsterm ①'
    ])
    expect(
      buildManagedAiLibrarySections({
        sessions: aliasedProjectSessions,
        grouping: 'project',
        unknownProjectLabel: 'Unknown project'
      }).map((section) => [section.label, section.count, section.sessions.map((session) => session.id)])
    ).toEqual([
      ['aiopsterm ①', 2, ['codex-real-aiopsterm', 'claude-link-aiopsterm']],
      ['aiopsterm ②', 1, ['gemini-other-aiopsterm']]
    ])
  })

  it('builds project-first row labels and library sections with lightweight duplicate markers', () => {
    const duplicateProjectSessions = [
      ...sessions,
      makeSession({
        id: 'codex-marketing-api',
        source: 'codex',
        title: '',
        summary: 'Review campaign endpoint',
        state: 'idle',
        lastActivityAt: 450,
        cwd: '/work/marketing/api',
        requestKind: 'telemetry',
        decisionMode: 'telemetry'
      })
    ]
    const projectLabels = managedAiProjectDisplayLabels(duplicateProjectSessions, 'Unknown project')

    expect(managedAiProjectDisplayLabel(duplicateProjectSessions[0], projectLabels, 'Unknown project')).toBe('api ①')
    expect(managedAiProjectDisplayLabel(duplicateProjectSessions[4], projectLabels, 'Unknown project')).toBe('api ②')
    expect(managedAiProjectDisplayLabel(sessions[3], projectLabels, 'Unknown project')).toBe('Unknown project')
    expect(managedAiSessionDisplayTitle(duplicateProjectSessions[4])).toBe('Review campaign endpoint')

    expect(
      buildManagedAiLibrarySections({
        sessions: duplicateProjectSessions,
        grouping: 'project',
        unknownProjectLabel: 'Unknown project'
      }).map((section) => [section.label, section.count, section.pendingCount, section.runningCount, section.sessions.map((session) => session.id)])
    ).toEqual([
      ['api ②', 1, 0, 0, ['codex-marketing-api']],
      ['Unknown project', 1, 0, 0, ['cursor-unknown']],
      ['api ①', 2, 1, 1, ['claude-api', 'gemini-api']],
      ['docs', 1, 0, 0, ['codex-docs']]
    ])
    expect(
      buildManagedAiLibrarySections({
        sessions: duplicateProjectSessions,
        grouping: 'project',
        unknownProjectLabel: 'Unknown project'
      }).map((section) => [section.label, section.projectPath])
    ).toEqual([
      ['api ②', '/work/marketing/api'],
      ['Unknown project', undefined],
      ['api ①', '/work/api'],
      ['docs', '/work/docs']
    ])

    expect(
      buildManagedAiLibrarySections({
        sessions: duplicateProjectSessions,
        grouping: 'agent',
        unknownProjectLabel: 'Unknown project'
      }).map((section) => [section.label, section.count, section.pendingCount, section.runningCount])
    ).toEqual([
      ['Codex', 2, 0, 0],
      ['Cursor', 1, 0, 0],
      ['Claude Code', 1, 1, 0],
      ['Gemini', 1, 0, 1]
    ])

    expect(
      buildManagedAiLibrarySections({
        sessions: duplicateProjectSessions,
        grouping: 'time',
        unknownProjectLabel: 'Unknown project'
      })
    ).toEqual([])
  })

  it('builds cockpit counts, attention ordering, and active scope labels without component state', () => {
    const cockpit = buildManagedAiCockpitCards({
      sessions,
      filter: 'needsInput',
      hibernatedOnly: false,
      translate: t
    })

    expect(cockpit.map((card) => [card.key, card.value, card.active])).toEqual([
      ['all', 4, false],
      ['needsInput', 1, true],
      ['working', 1, false],
      ['idle', 1, false],
      ['ended', 1, false],
      ['hibernated', 1, false]
    ])
    expect(managedAiAttentionQueue(sessions).map((session) => session.id)).toEqual(['claude-api'])

    expect(
      buildManagedAiActiveScopeLabel({
        filter: 'needsInput',
        hibernatedOnly: true,
        sourceFilter: 'claude-code',
        projectFilter: '/work/api',
        projectOptions: managedAiProjectOptions(sessions, 'Unknown path'),
        query: 'deploy',
        translate: t
      })
    ).toBe('Needs input / Hibernated / Claude Code / api (2) / Search: deploy')
  })

  it('builds the compact panel mode buttons and maps modes to state filters', () => {
    expect(managedAiPanelModeStateFilter('pending')).toBe('needsInput')
    expect(managedAiPanelModeStateFilter('running')).toBe('working')
    expect(managedAiPanelModeStateFilter('library')).toBe('all')
    expect(managedAiPanelModeForSession(sessions[0])).toBe('pending')
    expect(managedAiPanelModeForSession(sessions[1])).toBe('running')
    expect(managedAiPanelModeForSession(sessions[2])).toBe('library')

    expect(
      buildManagedAiPanelModeButtons({
        sessions,
        mode: 'running',
        translate: t
      })
    ).toEqual([
      { key: 'pending', label: 'Pending', tooltip: 'Needs your action', count: 1, active: false },
      { key: 'running', label: 'Running', tooltip: 'Working sessions', count: 1, active: true },
      { key: 'library', label: 'Library', tooltip: 'All sessions', active: false }
    ])
  })

  it('keeps subagent and internal sessions out of primary counts while preserving expandable child rows', () => {
    const parent = makeSession({
      id: 'codex-parent',
      source: 'codex',
      title: 'Parent task',
      state: 'idle',
      lastActivityAt: 700,
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      resumeCommand: "codex resume 'codex-parent'"
    })
    const child = makeSession({
      id: 'codex-child',
      source: 'codex',
      title: 'Review child',
      state: 'idle',
      lastActivityAt: 710,
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      sessionKind: 'subagent',
      parentSessionId: 'codex-parent',
      restorable: false,
      resumeCommand: "codex resume 'codex-child'"
    })
    const orphanInternal = makeSession({
      id: 'codex-exec',
      source: 'codex',
      title: 'Exec run',
      state: 'working',
      lastActivityAt: 720,
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      sessionKind: 'internal',
      restorable: false
    })
    const newerSiblingParent = makeSession({
      id: 'codex-sibling-parent',
      source: 'codex',
      title: 'Sibling parent',
      state: 'idle',
      lastActivityAt: 705,
      requestKind: 'telemetry',
      decisionMode: 'telemetry'
    })

    expect(managedAiSessionIsChild(child)).toBe(true)
    expect(managedAiSessionAllowsResume(parent)).toBe(true)
    expect(managedAiSessionAllowsResume(child)).toBe(false)

    expect(
      buildManagedAiPanelModeButtons({
        sessions: [parent, child, orphanInternal],
        mode: 'running',
        translate: t
      }).map((button) => [button.key, button.count])
    ).toEqual([
      ['pending', 0],
      ['running', 0],
      ['library', undefined]
    ])

    expect(buildManagedAiSessionRows([parent, child, orphanInternal, newerSiblingParent])).toEqual({
      rows: [
        expect.objectContaining({
          key: 'codex:codex-parent',
          session: parent,
          childSessions: [child],
          latest: 710
        }),
        expect.objectContaining({
          key: 'codex:codex-sibling-parent',
          session: newerSiblingParent,
          childSessions: [],
          latest: 705
        })
      ],
      orphanChildSessions: [orphanInternal]
    })
  })

  it('filters visible sessions by state, source, project, query, and hibernation state', () => {
    expect(
      visibleManagedAiSessions({
        sessions,
        query: 'release',
        filter: 'needsInput',
        sourceFilter: 'claude-code',
        projectFilter: '/work/api',
        hibernatedOnly: false
      }).map((session) => session.id)
    ).toEqual(['claude-api'])

    expect(
      visibleManagedAiSessions({
        sessions,
        query: '',
        filter: 'all',
        sourceFilter: 'all',
        projectFilter: '__unknown__',
        hibernatedOnly: true
      }).map((session) => session.id)
    ).toEqual(['cursor-unknown'])
  })

  it('keeps detail closed until a visible session is selected and filters timeline events newest first', () => {
    const visible = sessions.slice(1, 3)
    expect(selectedVisibleManagedAiSession({ selectedSession: sessions[0], visibleSessions: visible })).toBeNull()
    expect(selectedVisibleManagedAiSession({ selectedSession: sessions[1], visibleSessions: visible })?.id).toBe('gemini-api')

    const timelineSession = makeSession({
      id: 'timeline',
      source: 'claude-code',
      title: 'Timeline',
      state: 'needsInput',
      lastActivityAt: 500,
      events: [
        makeEvent({ id: 'permission-1', requestKind: 'permission', receivedAt: 100 }),
        makeEvent({ id: 'question-1', event: 'question', requestKind: 'question', receivedAt: 200 })
      ]
    })

    expect(filteredManagedAiTimelineEvents(timelineSession, 'all').map((event) => event.id)).toEqual(['question-1', 'permission-1'])
    expect(filteredManagedAiTimelineEvents(timelineSession, 'question').map((event) => event.id)).toEqual(['question-1'])
  })

  it('classifies timeline event state including Codex terminal permission prompts', () => {
    expect(managedAiTimelineEventState(makeEvent({ id: 'claude-permission', source: 'claude-code', event: 'permission_request', decisionMode: 'blocking' }))).toBe(
      'needsInput'
    )
    expect(managedAiTimelineEventState(makeEvent({ id: 'codex-permission', source: 'codex', event: 'permission_request', decisionMode: 'local' }))).toBe('needsInput')
    expect(managedAiTimelineEventState(makeEvent({ id: 'notification', event: 'notification', requestKind: 'notification', decisionMode: 'local' }))).toBe(
      'needsInput'
    )
    expect(
      managedAiTimelineEventState(
        makeEvent({ id: 'codex-question-pre-tool', source: 'codex', event: 'pre_tool_use', requestKind: 'question', decisionMode: 'local', actionable: true })
      )
    ).toBe('needsInput')
    expect(managedAiTimelineEventState(makeEvent({ id: 'end', event: 'session_end', requestKind: 'telemetry', decisionMode: 'telemetry' }))).toBe('ended')
  })

  it('builds copy payloads without raw event data and formats queue summaries', () => {
    const eventPayload = managedAiTimelineEventCopyPayload(
      makeEvent({
        id: 'question-1',
        event: 'question',
        requestKind: 'question',
        requestId: 'request-1',
        raw: { secret: 'not copied' }
      })
    )

    expect(eventPayload).toContain('"requestKind": "question"')
    expect(eventPayload).toContain('"requestId": "request-1"')
    expect(eventPayload).not.toContain('raw')
    expect(eventPayload).not.toContain('not copied')

    const queuePayload = managedAiVisibleSessionSummaryPayload({
      activeScopeLabel: 'api (2)',
      visibleSessions: sessions.slice(0, 2),
      visiblePendingCount: 1,
      translate: t
    })

    expect(queuePayload).toContain('AI session queue: api (2)')
    expect(queuePayload).toContain('Current: 2, pending: 1')
    expect(queuePayload).toContain('1. Deploy approval')
    expect(queuePayload).toContain('Agent: Claude Code (claude-code)')
    expect(queuePayload).toContain('Request: Permission / Blocking')
    expect(queuePayload).not.toContain('Status:')
    expect(queuePayload).not.toContain('Needs input / Permission')
    expect(queuePayload).not.toContain('Ended')
    expect(queuePayload).toContain('Resume: claude --resume claude-api')
    expect(queuePayload).toContain('2. API refactor')
  })

  it('formats relative time through injected clock and translation', () => {
    expect(formatManagedAiRelativeTime(1_000, 45_000, t)).toBe('44s ago')
    expect(formatManagedAiRelativeTime(1_000, 121_000, t)).toBe('2m ago')
    expect(formatManagedAiRelativeTime(1_000, 7_201_000, t)).toBe('2h ago')
    expect(formatManagedAiRelativeTime(1_000, 172_801_000, t)).toBe('2d ago')
  })
})
