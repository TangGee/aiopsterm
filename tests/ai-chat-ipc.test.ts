import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'

const backend = vi.hoisted(() => ({
  cancelAiChatResponse: vi.fn(),
  createAiChatExchangeRequest: vi.fn(),
  generateAiChatResponse: vi.fn()
}))

vi.mock('../src/main/backend/ai/aiChat', () => backend)
vi.mock('../src/main/backend/agent/clineAgentOwnerRuntime', () => ({
  withClineAgentRendererOwner: (_ownerId: number, callback: () => unknown) => callback()
}))

type Handler = (event: any, ...args: any[]) => unknown

describe('AI chat IPC product binding', () => {
  it('waits for asynchronous product-session binding before returning the response', async () => {
    const result = {
      ok: true,
      data: { text: 'done', provider: 'provider', model: 'model', durationMs: 1 }
    }
    backend.generateAiChatResponse.mockResolvedValue(result)
    let releaseBind!: () => void
    const bindProductSession = vi.fn(() => new Promise<void>((resolve) => {
      releaseBind = resolve
    }))
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
    } as unknown as IpcMain
    const modulePath = '../src/main/ipc/aiChat'
    const { registerAiChatIpc } = await import(modulePath)
    registerAiChatIpc(ipcMain, { bindProductSession })
    const request = { requestId: 'request-1', conversationId: 'classic-1', prompt: 'inspect' }
    let settled = false

    const responsePromise = Promise.resolve(handlers.get('ai:chat-response')?.({ sender: { id: 7 } }, request)).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(bindProductSession).toHaveBeenCalledWith(request, result)
    expect(settled).toBe(false)
    releaseBind()
    await expect(responsePromise).resolves.toEqual(result)
  })

  it('canonicalizes every host target from Main terminal metadata and rejects identity mismatches', async () => {
    backend.generateAiChatResponse.mockClear()
    backend.generateAiChatResponse.mockResolvedValue({ ok: true, data: {} })
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
    } as unknown as IpcMain
    const modulePath = '../src/main/ipc/aiChat'
    const { registerAiChatIpc } = await import(modulePath)
    const canonicalTargets = [
      { targetId: 'asset-a', terminalSessionId: 'terminal-a', label: 'Host A', kind: 'ssh' as const, cwd: '/srv/a' },
      { targetId: 'asset-b', terminalSessionId: 'terminal-b', label: 'Host B', kind: 'ssh' as const, cwd: '/srv/b' }
    ]
    registerAiChatIpc(ipcMain, {
      resolveTrustedHostTarget: (event: any, terminalSessionId: string) =>
        event.sender.id === 7
          ? canonicalTargets.find((target) => target.terminalSessionId === terminalSessionId) || null
          : null
    })
    const event = { sender: { id: 7 } }
    const hostTargets = canonicalTargets.map(({ cwd: _cwd, ...target }) => ({
      ...target,
      label: `Stale ${target.label}`,
      cwd: '/renderer/stale'
    }))

    await handlers.get('ai:chat-response')?.(event, { prompt: 'inspect', mode: 'agent', hostTargets })
    expect(backend.generateAiChatResponse).toHaveBeenCalledWith(expect.objectContaining({ hostTargets: canonicalTargets }))

    const mismatches = [
      [{ ...hostTargets[0], targetId: 'asset-spoofed' }],
      [{ ...hostTargets[0], kind: 'local' }],
      [{ targetId: 'asset-c', terminalSessionId: 'terminal-other', label: 'Host C', kind: 'ssh' }]
    ]
    for (const mismatchedTargets of mismatches) {
      backend.generateAiChatResponse.mockClear()
      await expect(handlers.get('ai:chat-response')?.(event, {
        prompt: 'inspect',
        mode: 'agent',
        hostTargets: mismatchedTargets
      })).resolves.toMatchObject({ ok: false, errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID' })
      expect(backend.generateAiChatResponse).not.toHaveBeenCalled()
    }
  })

  it('fails closed when host targets are supplied without a Main provenance resolver', async () => {
    backend.generateAiChatResponse.mockClear()
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler))
    } as unknown as IpcMain
    const modulePath = '../src/main/ipc/aiChat'
    const { registerAiChatIpc } = await import(modulePath)
    registerAiChatIpc(ipcMain)

    await expect(handlers.get('ai:chat-response')?.({ sender: { id: 7 } }, {
      prompt: 'inspect',
      mode: 'agent',
      hostTargets: [{ targetId: 'asset-a', terminalSessionId: 'terminal-a', label: 'Host A', kind: 'ssh' }]
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID' })
    expect(backend.generateAiChatResponse).not.toHaveBeenCalled()
  })
})
