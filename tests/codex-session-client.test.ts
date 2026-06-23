import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexSessionClient } from '@/services/ai/codexSessionClient'
import type {
  CodexSessionDataEvent,
  CodexSessionExitEvent,
  CodexSessionInfo,
  CodexSessionLifecycleEvent,
  CodexSessionTargetContext
} from '@shared/contracts/codexSessions'

const originalAiops = window.aiops

const target: CodexSessionTargetContext = {
  kind: 'ssh',
  panelId: 'panel-1',
  sessionId: 'terminal-1',
  label: 'prod',
  host: '127.0.0.1',
  port: 22,
  username: 'ops'
}

const session: CodexSessionInfo = {
  id: 'codex-1',
  binaryPath: '/usr/bin/codex',
  cwd: '/workspace',
  codexHome: '/tmp/codex-home',
  runtimeKind: 'pty',
  lifecycle: {
    id: 'codex-1',
    stage: 'starting',
    at: 1781884800000,
    runtimeKind: 'pty'
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('codexSessionClient', () => {
  it('returns undefined for unavailable bridge methods and binds Codex session bridge methods', async () => {
    const offData = vi.fn()
    const offLifecycle = vi.fn()
    const offExit = vi.fn()
    const dataListener = vi.fn<(event: CodexSessionDataEvent) => void>()
    const lifecycleListener = vi.fn<(event: CodexSessionLifecycleEvent) => void>()
    const exitListener = vi.fn<(event: CodexSessionExitEvent) => void>()

    window.aiops = {
      ...originalAiops,
      createCodexSession: vi.fn(async () => session),
      setCodexSessionTarget: vi.fn(async () => ({ ok: true, data: { sessionId: target.sessionId, target, registered: true } })),
      setCodexSessionPendingContext: vi.fn(async (id: string, text?: string) => ({
        ok: true,
        data: { id, bytes: new TextEncoder().encode(text || '').length, cleared: !text }
      })),
      writeCodexSession: vi.fn(async (id: string, data: string) => ({
        ok: true,
        data: { id, bytes: new TextEncoder().encode(data).length }
      })),
      resizeCodexSession: vi.fn(async () => undefined),
      killCodexSession: vi.fn(async (id: string) => ({ ok: true, data: { id } })),
      onCodexSessionData: vi.fn(() => offData),
      onCodexSessionLifecycle: vi.fn(() => offLifecycle),
      onCodexSessionExit: vi.fn(() => offExit)
    }

    await expect(codexSessionClient.createCodexSession()?.({ cols: 120, rows: 32, target })).resolves.toEqual(session)
    await expect(codexSessionClient.setCodexSessionTarget()?.(target)).resolves.toEqual({ ok: true, data: { sessionId: target.sessionId, target, registered: true } })
    await expect(codexSessionClient.setCodexSessionPendingContext()?.(session.id, 'target context')).resolves.toEqual({
      ok: true,
      data: { id: session.id, bytes: 14, cleared: false }
    })
    await expect(codexSessionClient.writeCodexSession()?.(session.id, 'status\n')).resolves.toEqual({ ok: true, data: { id: session.id, bytes: 7 } })
    await expect(codexSessionClient.resizeCodexSession()?.(session.id, 100, 24)).resolves.toBeUndefined()
    await expect(codexSessionClient.killCodexSession()?.(session.id)).resolves.toEqual({ ok: true, data: { id: session.id } })
    expect(codexSessionClient.onCodexSessionData()?.(dataListener)).toBe(offData)
    expect(codexSessionClient.onCodexSessionLifecycle()?.(lifecycleListener)).toBe(offLifecycle)
    expect(codexSessionClient.onCodexSessionExit()?.(exitListener)).toBe(offExit)

    expect(window.aiops.createCodexSession).toHaveBeenCalledWith({ cols: 120, rows: 32, target })
    expect(window.aiops.setCodexSessionTarget).toHaveBeenCalledWith(target)
    expect(window.aiops.setCodexSessionPendingContext).toHaveBeenCalledWith(session.id, 'target context')
    expect(window.aiops.writeCodexSession).toHaveBeenCalledWith(session.id, 'status\n')
    expect(window.aiops.resizeCodexSession).toHaveBeenCalledWith(session.id, 100, 24)
    expect(window.aiops.killCodexSession).toHaveBeenCalledWith(session.id)
    expect(window.aiops.onCodexSessionData).toHaveBeenCalledWith(dataListener)
    expect(window.aiops.onCodexSessionLifecycle).toHaveBeenCalledWith(lifecycleListener)
    expect(window.aiops.onCodexSessionExit).toHaveBeenCalledWith(exitListener)

    window.aiops = {
      ...originalAiops,
      createCodexSession: undefined as any,
      setCodexSessionTarget: undefined as any,
      setCodexSessionPendingContext: undefined as any,
      writeCodexSession: undefined as any,
      resizeCodexSession: undefined as any,
      killCodexSession: undefined as any,
      onCodexSessionData: undefined as any,
      onCodexSessionLifecycle: undefined as any,
      onCodexSessionExit: undefined as any
    }
    expect(codexSessionClient.createCodexSession()).toBeUndefined()
    expect(codexSessionClient.setCodexSessionTarget()).toBeUndefined()
    expect(codexSessionClient.setCodexSessionPendingContext()).toBeUndefined()
    expect(codexSessionClient.writeCodexSession()).toBeUndefined()
    expect(codexSessionClient.resizeCodexSession()).toBeUndefined()
    expect(codexSessionClient.killCodexSession()).toBeUndefined()
    expect(codexSessionClient.onCodexSessionData()).toBeUndefined()
    expect(codexSessionClient.onCodexSessionLifecycle()).toBeUndefined()
    expect(codexSessionClient.onCodexSessionExit()).toBeUndefined()
  })
})
