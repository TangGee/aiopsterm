import {
  compactAutoTitle,
  compactString,
  normalizeAutoNamingPositiveInteger,
  sessionKey,
  sourceLabel
} from './agentSessionNormalization'
import type { ManagedAiSessionAuditEntry } from './agentSessionAuditRuntime'
import type {
  AiAgentSessionEvent,
  ManagedAiSessionEvent,
  ManagedAiSessionRecord
} from '@shared/contracts/managedAiSessions'

export type ManagedAiSessionAutoNamingInput = {
  session: ManagedAiSessionRecord
  prompt: string
}

export type ManagedAiSessionAutoNamingRuntime = {
  enabled?: boolean
  minEventGrowth?: number
  minIntervalMs?: number
  maxContextMessages?: number
  emit?: (event: ManagedAiSessionEvent) => void
  generateTitle?: (input: ManagedAiSessionAutoNamingInput) => Promise<string | null | undefined>
}

export type AgentSessionAutoNamingRuntime = {
  configure: (config?: ManagedAiSessionAutoNamingRuntime) => void
  maybeRunAutoNaming: (session: ManagedAiSessionRecord, event: AiAgentSessionEvent) => void
  emitManagedAiSessionEvent: (event: ManagedAiSessionEvent) => void
}

type AgentSessionAutoNamingRuntimeOptions = {
  getSession: (key: string) => ManagedAiSessionRecord | undefined
  setSession: (key: string, session: ManagedAiSessionRecord) => void
  persistSnapshot: () => void
  appendManagedAiSessionAudit: (entry: ManagedAiSessionAuditEntry) => void
  publishManagedAiStreamFrame: (name: string, session: ManagedAiSessionRecord, payload: Record<string, unknown>) => void
  now?: () => number
}

const defaultAutoTitleMinEventGrowth = 4
const defaultAutoTitleMinIntervalMs = 180_000
const defaultAutoTitleMaxContextMessages = 8

type NormalizedManagedAiSessionAutoNamingRuntime = Required<
  Pick<ManagedAiSessionAutoNamingRuntime, 'enabled' | 'minEventGrowth' | 'minIntervalMs' | 'maxContextMessages'>
> &
  Pick<ManagedAiSessionAutoNamingRuntime, 'emit' | 'generateTitle'>

export const createAgentSessionAutoNamingRuntime = ({
  getSession,
  setSession,
  persistSnapshot,
  appendManagedAiSessionAudit,
  publishManagedAiStreamFrame,
  now = Date.now
}: AgentSessionAutoNamingRuntimeOptions): AgentSessionAutoNamingRuntime => {
  let runtime: NormalizedManagedAiSessionAutoNamingRuntime = {
    enabled: false,
    minEventGrowth: defaultAutoTitleMinEventGrowth,
    minIntervalMs: defaultAutoTitleMinIntervalMs,
    maxContextMessages: defaultAutoTitleMaxContextMessages
  }

  const recentAutoNamingEvents = (session: ManagedAiSessionRecord) => {
    const useful = session.events.filter((event) => {
      if (!event.summary && !event.title && !event.cwd) return false
      if (event.event === 'lifecycle') return false
      return true
    })
    return useful.slice(-runtime.maxContextMessages)
  }

  const buildAutoNamingPrompt = (session: ManagedAiSessionRecord) => {
    const lines: string[] = [
      'You name AI coding-agent sessions in a terminal workspace.',
      'Return only a short title, 2-5 words, in the same language as the session content.',
      'No quotes, punctuation, markdown, prefixes, or explanation.',
      ''
    ]
    if (session.autoTitle) {
      lines.push(`Current auto title: ${session.autoTitle}`)
      lines.push('If it is still accurate, return it exactly.')
      lines.push('')
    }
    if (session.cwd) lines.push(`Project path: ${session.cwd}`)
    lines.push(`Agent: ${sourceLabel(session.source)}`)
    lines.push('Recent session events:')
    recentAutoNamingEvents(session).forEach((event) => {
      const eventText = [
        event.event,
        event.summary ? compactString(event.summary, 240) : '',
        event.title && event.title !== event.summary ? compactString(event.title, 120) : '',
        event.cwd && event.cwd !== session.cwd ? `cwd=${event.cwd}` : ''
      ]
        .filter(Boolean)
        .join(' | ')
      if (eventText) lines.push(`- ${eventText}`)
    })
    return lines.join('\n')
  }

  const autoNamingSkipAudit = (session: ManagedAiSessionRecord, reason: string, at = now()) => {
    appendManagedAiSessionAudit({
      at,
      kind: 'session.auto_name_skipped',
      source: session.source,
      sessionId: session.id,
      event: session.lastEvent,
      state: session.state,
      title: session.title,
      summary: session.summary,
      reason
    })
  }

  const updateAutoNamingAttempt = (session: ManagedAiSessionRecord, attemptedAt: number, eventCount: number) => {
    const key = sessionKey(session.source, session.id)
    const current = getSession(key)
    if (!current || current.userTitle) return null
    const next = {
      ...current,
      autoTitleAttemptedAt: attemptedAt,
      autoTitleEventCount: eventCount,
      updatedAt: attemptedAt
    }
    setSession(key, next)
    persistSnapshot()
    return next
  }

  const applyAutoNamingTitle = (session: ManagedAiSessionRecord, title: string, generatedAt: number, eventCount: number) => {
    const key = sessionKey(session.source, session.id)
    const current = getSession(key)
    if (!current || current.userTitle) return null
    const next = {
      ...current,
      title,
      autoTitle: title,
      autoTitleGeneratedAt: generatedAt,
      autoTitleAttemptedAt: generatedAt,
      autoTitleEventCount: eventCount,
      updatedAt: generatedAt
    }
    setSession(key, next)
    persistSnapshot()
    appendManagedAiSessionAudit({
      at: generatedAt,
      kind: 'session.auto_named',
      source: next.source,
      sessionId: next.id,
      event: next.lastEvent,
      state: next.state,
      title: next.title,
      summary: next.summary
    })
    publishManagedAiStreamFrame('managed_ai.session.renamed', next, { title: next.title, auto: true })
    return next
  }

  const shouldRunAutoNaming = (session: ManagedAiSessionRecord, event: AiAgentSessionEvent) => {
    if (!runtime.enabled) return 'disabled'
    if (event.event !== 'stop') return 'not-stop'
    if (session.userTitle) return 'manual-title'
    if (typeof runtime.generateTitle !== 'function') return 'missing-generator'
    if (session.events.length < 2) return 'too-short'
    if (!recentAutoNamingEvents(session).length) return 'no-context'
    const timestamp = now()
    if (session.autoTitleAttemptedAt && timestamp - session.autoTitleAttemptedAt < runtime.minIntervalMs) return 'too-soon'
    if (session.autoTitleEventCount && session.events.length - session.autoTitleEventCount < runtime.minEventGrowth) return 'insufficient-growth'
    return ''
  }

  return {
    configure: (config: ManagedAiSessionAutoNamingRuntime = {}) => {
      runtime = {
        enabled: config.enabled === true,
        minEventGrowth: normalizeAutoNamingPositiveInteger(config.minEventGrowth, defaultAutoTitleMinEventGrowth, 1, 100),
        minIntervalMs: normalizeAutoNamingPositiveInteger(config.minIntervalMs, defaultAutoTitleMinIntervalMs, 30_000, 3_600_000),
        maxContextMessages: normalizeAutoNamingPositiveInteger(config.maxContextMessages, defaultAutoTitleMaxContextMessages, 3, 40),
        emit: config.emit,
        generateTitle: config.generateTitle
      }
    },
    maybeRunAutoNaming: (session, event) => {
      const skipReason = shouldRunAutoNaming(session, event)
      if (skipReason) {
        if (skipReason !== 'disabled' && skipReason !== 'not-stop') autoNamingSkipAudit(session, skipReason)
        return
      }
      const eventCount = session.events.length
      const attemptedAt = now()
      const attempting = updateAutoNamingAttempt(session, attemptedAt, eventCount)
      if (!attempting) return
      const prompt = buildAutoNamingPrompt(attempting)
      void runtime
        .generateTitle!({ session: attempting, prompt })
        .then((rawTitle) => {
          const title = compactAutoTitle(rawTitle, attempting.autoTitle || attempting.title)
          if (!title) {
            autoNamingSkipAudit(attempting, 'empty-title')
            return
          }
          applyAutoNamingTitle(attempting, title, now(), eventCount)
        })
        .catch(() => {
          autoNamingSkipAudit(attempting, 'generator-error')
        })
    },
    emitManagedAiSessionEvent: (event) => runtime.emit?.(event)
  }
}
