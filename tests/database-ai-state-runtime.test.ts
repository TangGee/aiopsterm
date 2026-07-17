import { describe, expect, it } from 'vitest'
import {
  DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS,
  DATABASE_AI_PANE_MAX_MESSAGES,
  deleteDatabaseAiPaneSessionProjection,
  getDatabaseAiPaneStateSnapshot,
  replaceDatabaseAiPaneState,
  normalizeDatabaseAiPaneState
} from '../src/shared/databaseAiStateRuntime'
import type { DatabaseAiPaneMessageRecord, DatabaseAiPaneSessionSnapshot } from '../src/shared/contracts/database'

const message = (index: number, status: DatabaseAiPaneMessageRecord['status'] = 'done'): DatabaseAiPaneMessageRecord => ({
  id: `message-${index}`,
  requestId: `request-${index}`,
  role: index % 2 ? 'assistant' : 'user',
  status,
  content: `message ${index}`,
  contextSummary: 'metrics / main',
  createdAt: index + 1,
  updatedAt: index + 1
})

const archivedSession = (index: number): DatabaseAiPaneSessionSnapshot => ({
  conversationId: `session-${index}`,
  context: { connectionId: 'metrics', catalogName: 'main', schemaName: '', dbType: 'sqlite' },
  draft: '',
  messages: Array.from({ length: DATABASE_AI_PANE_MAX_MESSAGES + 3 }, (_, messageIndex) =>
    message(index * 100 + messageIndex, messageIndex === DATABASE_AI_PANE_MAX_MESSAGES + 2 ? 'streaming' : 'done')
  ),
  createdAt: index + 1,
  updatedAt: index + 10
})

describe('database AI pane session state', () => {
  it('keeps a bounded archived-session projection and cancels restored in-flight rows', () => {
    const archivedSessions = Array.from(
      { length: DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS + 3 },
      (_, index) => archivedSession(index)
    )
    archivedSessions.push({ ...archivedSession(100), conversationId: 'active-session' })
    archivedSessions.push({ ...archivedSession(39), updatedAt: 1_000 })

    const normalized = normalizeDatabaseAiPaneState({
      conversationId: 'active-session',
      open: true,
      width: 360,
      context: { connectionId: 'metrics', catalogName: 'main', schemaName: '', dbType: 'sqlite' },
      draft: '',
      messages: [],
      archivedSessions
    })

    expect(normalized.archivedSessions).toHaveLength(DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS)
    expect(normalized.archivedSessions?.some((session) => session.conversationId === 'active-session')).toBe(false)
    expect(new Set(normalized.archivedSessions?.map((session) => session.conversationId)).size).toBe(
      DATABASE_AI_PANE_MAX_ARCHIVED_SESSIONS
    )
    expect(normalized.archivedSessions?.[0]).toMatchObject({ conversationId: 'session-39', updatedAt: 1_000 })
    expect(normalized.archivedSessions?.[0].messages).toHaveLength(DATABASE_AI_PANE_MAX_MESSAGES)
    expect(normalized.archivedSessions?.[0].messages.at(-1)?.status).toBe('cancelled')
  })

  it('deletes active and archived session projections without selecting another session', () => {
    replaceDatabaseAiPaneState(normalizeDatabaseAiPaneState({
      conversationId: 'active-session',
      open: true,
      width: 420,
      context: { connectionId: 'metrics', catalogName: 'main', schemaName: '', dbType: 'sqlite' },
      draft: 'active draft',
      messages: [message(1)],
      archivedSessions: [archivedSession(1), archivedSession(2)]
    }))

    expect(deleteDatabaseAiPaneSessionProjection('session-1')).toBe(true)
    expect(getDatabaseAiPaneStateSnapshot().archivedSessions?.map((session) => session.conversationId)).toEqual(['session-2'])
    expect(deleteDatabaseAiPaneSessionProjection('active-session')).toBe(true)
    const state = getDatabaseAiPaneStateSnapshot()
    expect(state.conversationId).not.toBe('active-session')
    expect(state).toMatchObject({ open: false, width: 420, draft: '', messages: [] })
    expect(state.archivedSessions?.map((session) => session.conversationId)).toEqual(['session-2'])
    expect(deleteDatabaseAiPaneSessionProjection('missing-session')).toBe(false)
  })
})
