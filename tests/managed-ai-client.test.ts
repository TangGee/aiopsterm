import { afterEach, describe, expect, it, vi } from 'vitest'
import { managedAiClient } from '@/services/managedAiClient'

const originalAiops = window.aiops

const managedAiSnapshot = {
  sessions: [
    {
      id: 'claude-session-1',
      source: 'claude-code' as const,
      title: 'Claude Code',
      summary: 'Needs approval',
      state: 'needsInput' as const,
      lastEvent: 'permission_request' as const,
      lastActivityAt: 100,
      createdAt: 90,
      updatedAt: 100,
      requestKind: 'permission' as const,
      decisionMode: 'blocking' as const,
      events: [],
      decisions: []
    }
  ]
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('managedAiClient', () => {
  it('returns undefined for unavailable bridge methods and binds managed AI session list/reply methods', async () => {
    window.aiops = {
      ...originalAiops,
      listManagedAiSessions: vi.fn(async () => ({
        ok: true,
        data: managedAiSnapshot
      })),
      replyManagedAiSession: vi.fn(async (input) => ({
        ok: true,
        data: {
          session: managedAiSnapshot.sessions[0],
          snapshot: {
            sessions: [
              {
                ...managedAiSnapshot.sessions[0],
                state: 'idle' as const,
                decisions: [{ id: 'decision-1', kind: input.kind, message: input.message, createdAt: 120 }]
              }
            ]
          }
        }
      }))
    }

    await expect(managedAiClient.listManagedAiSessions()?.()).resolves.toEqual({
      ok: true,
      data: managedAiSnapshot
    })
    await expect(
      managedAiClient.replyManagedAiSession()?.({
        source: 'claude-code',
        sessionId: 'claude-session-1',
        kind: 'reply',
        message: 'Use staging'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          snapshot: expect.objectContaining({
            sessions: [expect.objectContaining({ state: 'idle' })]
          })
        })
      })
    )
    expect(window.aiops.listManagedAiSessions).toHaveBeenCalledTimes(1)
    expect(window.aiops.replyManagedAiSession).toHaveBeenCalledWith({
      source: 'claude-code',
      sessionId: 'claude-session-1',
      kind: 'reply',
      message: 'Use staging'
    })

    window.aiops = {
      ...originalAiops,
      listManagedAiSessions: undefined as any,
      replyManagedAiSession: undefined as any
    }
    expect(managedAiClient.listManagedAiSessions()).toBeUndefined()
    expect(managedAiClient.replyManagedAiSession()).toBeUndefined()
  })
})
