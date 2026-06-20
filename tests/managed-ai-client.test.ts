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

const hibernationConfig = {
  enabled: true,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('managedAiClient', () => {
  it('returns undefined for unavailable bridge methods and binds managed AI session methods', async () => {
    const offAiAgentSessionEvent = vi.fn()
    const offManagedAiSessionEvent = vi.fn()
    const offManagedAiSessionFocusRequest = vi.fn()
    const aiAgentSessionEventListener = vi.fn()
    const managedAiSessionEventListener = vi.fn()
    const managedAiSessionFocusRequestListener = vi.fn()

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
      })),
      renameManagedAiSession: vi.fn(async (input) => ({
        ok: true,
        data: {
          session: { ...managedAiSnapshot.sessions[0], title: input.title },
          snapshot: {
            sessions: [{ ...managedAiSnapshot.sessions[0], title: input.title }]
          }
        }
      })),
      clearManagedAiSession: vi.fn(async () => ({
        ok: true,
        data: {
          snapshot: { sessions: [] }
        }
      })),
      bulkManagedAiSessions: vi.fn(async (input) => ({
        ok: true,
        data: {
          changed: input.operation === 'mark-handled' ? 1 : 0,
          snapshot: { sessions: [] }
        }
      })),
      getAgentHibernationConfig: vi.fn(async () => ({
        ok: true,
        data: { config: hibernationConfig }
      })),
      setAgentHibernationConfig: vi.fn(async (input) => ({
        ok: true,
        data: { config: { ...hibernationConfig, ...input } }
      })),
      hibernateManagedAiSession: vi.fn(async (input) => ({
        ok: true,
        data: {
          session: { ...managedAiSnapshot.sessions[0], hibernated: true, hibernationReason: input.reason },
          snapshot: { sessions: [{ ...managedAiSnapshot.sessions[0], hibernated: true, hibernationReason: input.reason }] },
          config: hibernationConfig
        }
      })),
      wakeManagedAiSession: vi.fn(async (input) => ({
        ok: true,
        data: {
          session: { ...managedAiSnapshot.sessions[0], hibernated: false, hibernationReason: input.reason },
          snapshot: { sessions: [{ ...managedAiSnapshot.sessions[0], hibernated: false, hibernationReason: input.reason }] },
          config: hibernationConfig
        }
      })),
      onAiAgentSessionEvent: vi.fn(() => offAiAgentSessionEvent),
      onManagedAiSessionEvent: vi.fn(() => offManagedAiSessionEvent),
      onManagedAiSessionFocusRequest: vi.fn(() => offManagedAiSessionFocusRequest)
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
    await expect(
      managedAiClient.renameManagedAiSession()?.({
        source: 'claude-code',
        sessionId: 'claude-session-1',
        title: 'Deploy approval'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({ title: 'Deploy approval' })
        })
      })
    )
    await expect(managedAiClient.clearManagedAiSession()?.({ source: 'claude-code', sessionId: 'claude-session-1' })).resolves.toEqual({
      ok: true,
      data: { snapshot: { sessions: [] } }
    })
    await expect(managedAiClient.bulkManagedAiSessions()?.({ operation: 'mark-handled', sources: ['claude-code'] })).resolves.toEqual({
      ok: true,
      data: { changed: 1, snapshot: { sessions: [] } }
    })
    await expect(managedAiClient.getAgentHibernationConfig()?.()).resolves.toEqual({
      ok: true,
      data: { config: hibernationConfig }
    })
    await expect(managedAiClient.setAgentHibernationConfig()?.({ enabled: false })).resolves.toEqual({
      ok: true,
      data: { config: { ...hibernationConfig, enabled: false } }
    })
    await expect(
      managedAiClient.hibernateManagedAiSession()?.({
        source: 'claude-code',
        sessionId: 'claude-session-1',
        reason: 'manual',
        terminalSessionId: 'terminal-session-1'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({ hibernated: true, hibernationReason: 'manual' })
        })
      })
    )
    await expect(managedAiClient.wakeManagedAiSession()?.({ source: 'claude-code', sessionId: 'claude-session-1', reason: 'resume' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          session: expect.objectContaining({ hibernated: false, hibernationReason: 'resume' })
        })
      })
    )
    expect(managedAiClient.onAiAgentSessionEvent()?.(aiAgentSessionEventListener)).toBe(offAiAgentSessionEvent)
    expect(managedAiClient.onManagedAiSessionEvent()?.(managedAiSessionEventListener)).toBe(offManagedAiSessionEvent)
    expect(managedAiClient.onManagedAiSessionFocusRequest()?.(managedAiSessionFocusRequestListener)).toBe(offManagedAiSessionFocusRequest)
    expect(window.aiops.renameManagedAiSession).toHaveBeenCalledWith({
      source: 'claude-code',
      sessionId: 'claude-session-1',
      title: 'Deploy approval'
    })
    expect(window.aiops.clearManagedAiSession).toHaveBeenCalledWith({ source: 'claude-code', sessionId: 'claude-session-1' })
    expect(window.aiops.bulkManagedAiSessions).toHaveBeenCalledWith({ operation: 'mark-handled', sources: ['claude-code'] })
    expect(window.aiops.getAgentHibernationConfig).toHaveBeenCalledTimes(1)
    expect(window.aiops.setAgentHibernationConfig).toHaveBeenCalledWith({ enabled: false })
    expect(window.aiops.hibernateManagedAiSession).toHaveBeenCalledWith({
      source: 'claude-code',
      sessionId: 'claude-session-1',
      reason: 'manual',
      terminalSessionId: 'terminal-session-1'
    })
    expect(window.aiops.wakeManagedAiSession).toHaveBeenCalledWith({ source: 'claude-code', sessionId: 'claude-session-1', reason: 'resume' })
    expect(window.aiops.onAiAgentSessionEvent).toHaveBeenCalledWith(aiAgentSessionEventListener)
    expect(window.aiops.onManagedAiSessionEvent).toHaveBeenCalledWith(managedAiSessionEventListener)
    expect(window.aiops.onManagedAiSessionFocusRequest).toHaveBeenCalledWith(managedAiSessionFocusRequestListener)

    window.aiops = {
      ...originalAiops,
      listManagedAiSessions: undefined as any,
      replyManagedAiSession: undefined as any,
      renameManagedAiSession: undefined as any,
      clearManagedAiSession: undefined as any,
      bulkManagedAiSessions: undefined as any,
      getAgentHibernationConfig: undefined as any,
      setAgentHibernationConfig: undefined as any,
      hibernateManagedAiSession: undefined as any,
      wakeManagedAiSession: undefined as any,
      onAiAgentSessionEvent: undefined as any,
      onManagedAiSessionEvent: undefined as any,
      onManagedAiSessionFocusRequest: undefined as any
    }
    expect(managedAiClient.listManagedAiSessions()).toBeUndefined()
    expect(managedAiClient.replyManagedAiSession()).toBeUndefined()
    expect(managedAiClient.renameManagedAiSession()).toBeUndefined()
    expect(managedAiClient.clearManagedAiSession()).toBeUndefined()
    expect(managedAiClient.bulkManagedAiSessions()).toBeUndefined()
    expect(managedAiClient.getAgentHibernationConfig()).toBeUndefined()
    expect(managedAiClient.setAgentHibernationConfig()).toBeUndefined()
    expect(managedAiClient.hibernateManagedAiSession()).toBeUndefined()
    expect(managedAiClient.wakeManagedAiSession()).toBeUndefined()
    expect(managedAiClient.onAiAgentSessionEvent()).toBeUndefined()
    expect(managedAiClient.onManagedAiSessionEvent()).toBeUndefined()
    expect(managedAiClient.onManagedAiSessionFocusRequest()).toBeUndefined()
  })
})
