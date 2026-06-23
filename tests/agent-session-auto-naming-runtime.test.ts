import { describe, expect, it, vi } from 'vitest'
import type {
  AiAgentSessionEvent,
  ManagedAiSessionEvent,
  ManagedAiSessionRecord,
  ManagedAiSessionTimelineEvent
} from '../src/shared/contracts/managedAiSessions'

type ManagedAiSessionAuditEntry = {
  at: number
  kind: string
  source?: string
  sessionId?: string
  title?: string
  reason?: string
}

type AgentSessionAutoNamingRuntime = {
  configure: (config?: {
    enabled?: boolean
    minEventGrowth?: number
    minIntervalMs?: number
    maxContextMessages?: number
    emit?: (event: ManagedAiSessionEvent) => void
    generateTitle?: (input: { session: ManagedAiSessionRecord; prompt: string }) => Promise<string | null | undefined>
  }) => void
  maybeRunAutoNaming: (session: ManagedAiSessionRecord, event: AiAgentSessionEvent) => void
  emitManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void
}

type CreateAgentSessionAutoNamingRuntime = (options: {
  getSession: (key: string) => ManagedAiSessionRecord | undefined
  setSession: (key: string, session: ManagedAiSessionRecord) => void
  persistSnapshot: () => void
  appendManagedAiSessionAudit: (entry: ManagedAiSessionAuditEntry) => void
  publishManagedAiStreamFrame: (name: string, session: ManagedAiSessionRecord, payload: Record<string, unknown>) => void
  now?: () => number
}) => AgentSessionAutoNamingRuntime

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/agentSessionAutoNamingRuntime'
  return (await import(modulePath)) as { createAgentSessionAutoNamingRuntime: CreateAgentSessionAutoNamingRuntime }
}

const timelineEvent = (overrides: Partial<ManagedAiSessionTimelineEvent> = {}): ManagedAiSessionTimelineEvent => ({
  id: overrides.id || `event-${overrides.event || 'stop'}`,
  source: overrides.source || 'codex',
  event: overrides.event || 'stop',
  sessionId: overrides.sessionId || 'session-1',
  title: overrides.title || '',
  summary: overrides.summary || '',
  receivedAt: overrides.receivedAt || 100,
  requestKind: overrides.requestKind || 'telemetry',
  decisionMode: overrides.decisionMode || 'telemetry',
  ...overrides
})

const sessionRecord = (overrides: Partial<ManagedAiSessionRecord> = {}): ManagedAiSessionRecord => ({
  id: overrides.id || 'session-1',
  source: overrides.source || 'codex',
  title: overrides.title || 'Codex',
  summary: overrides.summary || '',
  state: overrides.state || 'idle',
  lastEvent: overrides.lastEvent || 'stop',
  lastActivityAt: overrides.lastActivityAt || 200,
  createdAt: overrides.createdAt || 100,
  updatedAt: overrides.updatedAt || 200,
  requestKind: overrides.requestKind || 'telemetry',
  decisionMode: overrides.decisionMode || 'telemetry',
  events:
    overrides.events || [
      timelineEvent({ event: 'session_start', summary: '开始修复发布脚本', receivedAt: 100 }),
      timelineEvent({ event: 'stop', summary: '修复发布脚本失败重试', receivedAt: 200 })
    ],
  decisions: overrides.decisions || [],
  ...overrides
})

const stopEvent = (overrides: Partial<AiAgentSessionEvent> = {}): AiAgentSessionEvent => ({
  source: overrides.source || 'codex',
  event: overrides.event || 'stop',
  sessionId: overrides.sessionId || 'session-1',
  title: overrides.title || 'Codex',
  summary: overrides.summary || '修复发布脚本失败重试',
  receivedAt: overrides.receivedAt || 200,
  ...overrides
})

const createHarness = (createAgentSessionAutoNamingRuntime: CreateAgentSessionAutoNamingRuntime, initialSession = sessionRecord(), nowValues = [1000, 1100, 1200, 1300]) => {
  const sessions = new Map([[`${initialSession.source}:${initialSession.id}`, initialSession]])
  const audits: ManagedAiSessionAuditEntry[] = []
  const frames: Array<{ name: string; session: ManagedAiSessionRecord; payload: Record<string, unknown> }> = []
  const events: ManagedAiSessionEvent[] = []
  const persistSnapshot = vi.fn()
  const now = vi.fn(() => nowValues.shift() || 9999)
  const runtime = createAgentSessionAutoNamingRuntime({
    getSession: (key) => sessions.get(key),
    setSession: (key, session) => sessions.set(key, session),
    persistSnapshot,
    appendManagedAiSessionAudit: (entry) => audits.push(entry),
    publishManagedAiStreamFrame: (name, session, payload) => frames.push({ name, session, payload }),
    now
  })
  return { runtime, sessions, audits, frames, events, persistSnapshot, now }
}

describe('agentSessionAutoNamingRuntime', () => {
  it('generates and applies auto titles through injected state, persistence, audit, and stream dependencies', async () => {
    const { createAgentSessionAutoNamingRuntime } = await loadRuntime()
    const harness = createHarness(createAgentSessionAutoNamingRuntime)
    const generateTitle = vi.fn(async ({ prompt }) => {
      expect(prompt).toContain('Recent session events:')
      expect(prompt).toContain('修复发布脚本失败重试')
      return '"发布脚本修复"'
    })
    harness.runtime.configure({ enabled: true, minIntervalMs: 30000, minEventGrowth: 1, generateTitle })

    harness.runtime.maybeRunAutoNaming(harness.sessions.get('codex:session-1')!, stopEvent())
    await vi.waitFor(() => expect(harness.frames).toHaveLength(1))

    expect(harness.sessions.get('codex:session-1')).toEqual(
      expect.objectContaining({
        title: '发布脚本修复',
        autoTitle: '发布脚本修复',
        autoTitleEventCount: 2,
        autoTitleAttemptedAt: 1200,
        autoTitleGeneratedAt: 1200
      })
    )
    expect(harness.persistSnapshot).toHaveBeenCalledTimes(2)
    expect(harness.audits).toEqual([
      expect.objectContaining({
        at: 1200,
        kind: 'session.auto_named',
        source: 'codex',
        sessionId: 'session-1',
        title: '发布脚本修复'
      })
    ])
    expect(harness.frames[0]).toEqual(
      expect.objectContaining({
        name: 'managed_ai.session.renamed',
        payload: { title: '发布脚本修复', auto: true }
      })
    )
  })

  it('audits actionable skip reasons without invoking the generator', () => {
    return loadRuntime().then(({ createAgentSessionAutoNamingRuntime }) => {
      const harness = createHarness(createAgentSessionAutoNamingRuntime, sessionRecord({ autoTitleAttemptedAt: 1000, autoTitleEventCount: 2 }), [1010])
      const generateTitle = vi.fn(async () => 'New title')
      harness.runtime.configure({ enabled: true, minIntervalMs: 30000, minEventGrowth: 1, generateTitle })

      harness.runtime.maybeRunAutoNaming(harness.sessions.get('codex:session-1')!, stopEvent())

      expect(generateTitle).not.toHaveBeenCalled()
      expect(harness.persistSnapshot).not.toHaveBeenCalled()
      expect(harness.audits).toEqual([
        expect.objectContaining({
          kind: 'session.auto_name_skipped',
          reason: 'too-soon',
          sessionId: 'session-1'
        })
      ])
    })
  })

  it('does not audit disabled or non-stop events', () => {
    return loadRuntime().then(({ createAgentSessionAutoNamingRuntime }) => {
      const harness = createHarness(createAgentSessionAutoNamingRuntime)

      harness.runtime.maybeRunAutoNaming(harness.sessions.get('codex:session-1')!, stopEvent())
      harness.runtime.configure({ enabled: true, generateTitle: vi.fn(async () => 'Title') })
      harness.runtime.maybeRunAutoNaming(harness.sessions.get('codex:session-1')!, stopEvent({ event: 'prompt_submit' }))

      expect(harness.audits).toEqual([])
      expect(harness.persistSnapshot).not.toHaveBeenCalled()
    })
  })

  it('keeps manual titles authoritative even when an async generator later resolves', async () => {
    const { createAgentSessionAutoNamingRuntime } = await loadRuntime()
    const harness = createHarness(createAgentSessionAutoNamingRuntime)
    let resolveTitle: (title: string) => void = () => undefined
    const generateTitle = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveTitle = resolve
        })
    )
    harness.runtime.configure({ enabled: true, minIntervalMs: 30000, minEventGrowth: 1, generateTitle })

    harness.runtime.maybeRunAutoNaming(harness.sessions.get('codex:session-1')!, stopEvent())
    harness.sessions.set('codex:session-1', {
      ...harness.sessions.get('codex:session-1')!,
      title: '手动标题',
      userTitle: '手动标题'
    })
    resolveTitle('自动标题')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.sessions.get('codex:session-1')).toEqual(expect.objectContaining({ title: '手动标题', userTitle: '手动标题' }))
    expect(harness.frames).toEqual([])
    expect(harness.audits).toEqual([])
    expect(harness.persistSnapshot).toHaveBeenCalledTimes(1)
  })

  it('audits empty title and generator errors without publishing rename frames', async () => {
    const { createAgentSessionAutoNamingRuntime } = await loadRuntime()
    const emptyHarness = createHarness(createAgentSessionAutoNamingRuntime)
    emptyHarness.runtime.configure({ enabled: true, minIntervalMs: 30000, minEventGrowth: 1, generateTitle: vi.fn(async () => '""') })
    emptyHarness.runtime.maybeRunAutoNaming(emptyHarness.sessions.get('codex:session-1')!, stopEvent())
    await vi.waitFor(() => expect(emptyHarness.audits).toEqual([expect.objectContaining({ reason: 'empty-title' })]))
    expect(emptyHarness.frames).toEqual([])

    const errorHarness = createHarness(createAgentSessionAutoNamingRuntime, sessionRecord({ id: 'session-2' }))
    errorHarness.runtime.configure({
      enabled: true,
      minIntervalMs: 30000,
      minEventGrowth: 1,
      generateTitle: vi.fn(async () => {
        throw new Error('provider failed')
      })
    })
    errorHarness.runtime.maybeRunAutoNaming(errorHarness.sessions.get('codex:session-2')!, stopEvent({ sessionId: 'session-2' }))
    await vi.waitFor(() => expect(errorHarness.audits).toEqual([expect.objectContaining({ reason: 'generator-error' })]))
    expect(errorHarness.frames).toEqual([])
  })

  it('forwards managed AI stream events to the configured observer', async () => {
    const { createAgentSessionAutoNamingRuntime } = await loadRuntime()
    const harness = createHarness(createAgentSessionAutoNamingRuntime)
    const emit = vi.fn()
    harness.runtime.configure({ enabled: true, emit })
    const event: ManagedAiSessionEvent = {
      name: 'managed_ai.session.renamed',
      category: 'managed-ai',
      source: 'codex',
      sessionId: 'session-1',
      payload: {}
    }

    harness.runtime.emitManagedAiSessionEvent(event)

    expect(emit).toHaveBeenCalledWith(event)
  })
})
