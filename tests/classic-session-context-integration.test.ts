import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ProductSessionRecord } from '@shared/contracts/productSessions'

const session = (input: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'conv-2',
  surface: 'classic',
  title: 'K8s 发布失败',
  isOpen: true,
  createdAt: 1,
  updatedAt: 2,
  ...input
})

const flushMicrotasks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) await Promise.resolve()
}

describe('Classic session context integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(globalThis as any).__resetChatHistoryStoreMock?.()
    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    ;(globalThis as any).__resetSkillsStoreMock?.()
  })

  it('refreshes the catalog, restores snapshot order, and excludes unavailable refs from requests', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [
              { id: 'missing-doc', kind: 'docs', label: 'Removed runbook', relPath: 'removed/runbook.md' },
              { id: 'skill:incident-triage', kind: 'skills', label: 'incident-triage', skillName: 'incident-triage' },
              { id: 'chat:conv-1', kind: 'chats', label: '生产巡检', chatSessionId: 'conv-1' }
            ]
          }
        })
      }
    })
    const store = useWorkspaceStore()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)

    expect(window.aiops.listAiContextCatalog).toHaveBeenCalled()
    expect(store.selectedContexts.map((context) => context.id)).toEqual([
      'missing-doc',
      'skill:incident-triage',
      'chat:conv-1'
    ])
    expect(store.selectedContexts[0]).toMatchObject({ unavailable: true, relPath: 'removed/runbook.md' })
    expect(store.selectedContexts[1]).toMatchObject({ unavailable: false, skillName: 'incident-triage' })
    expect(store.selectedContexts[2]).toMatchObject({ unavailable: false, chatSessionId: 'conv-1' })

    await expect(
      store.sendChat('只使用仍然可用的上下文', undefined, undefined, { mode: 'chat', skipKnowledgeSearch: true })
    ).resolves.toBe(true)

    const request = vi.mocked(window.aiops.createAiChatExchangeRequest).mock.calls.at(-1)?.[0]
    expect(request?.contexts?.map((context) => context.id)).toEqual(['skill:incident-triage', 'chat:conv-1'])
    expect(request?.contexts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'missing-doc' })]))
  })

  it('keeps an empty restored snapshot instead of applying defaults and persists payload-free refs', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: { session: session({ classicContext: { contexts: [] } }) }
    })
    const store = useWorkspaceStore()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)
    expect(store.aiContextCatalog.selectedDefaults).toEqual([])
    expect(store.selectedContexts).toEqual([])

    store.toggleContext({
      id: 'kb-image:images/diagram.png',
      kind: 'images',
      label: 'diagram.png',
      relPath: 'images/diagram.png',
      mediaType: 'image/png',
      data: 'BASE64_IMAGE_PAYLOAD',
      content: 'binary metadata'
    })
    await flushMicrotasks()

    const update = vi.mocked(window.aiops.updateProductSession).mock.calls.at(-1)?.[0]
    expect(update).toMatchObject({
      id: 'conv-2',
      classicContext: {
        contexts: [
          expect.objectContaining({
            id: 'kb-image:images/diagram.png',
            kind: 'images',
            relPath: 'images/diagram.png',
            mediaType: 'image/png'
          })
        ]
      }
    })
    expect(JSON.stringify(update)).not.toContain('BASE64_IMAGE_PAYLOAD')
    expect(JSON.stringify(update)).not.toContain('binary metadata')
  })

  it('treats a session without Classic context as empty instead of restoring catalog defaults', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: { session: session({ classicContext: undefined }) }
    })
    vi.mocked(window.aiops.listAiContextCatalog).mockResolvedValueOnce({
      ok: true,
      data: {
        categories: [{
          id: 'hosts',
          label: 'Hosts',
          options: [{ id: 'asset-default', kind: 'hosts', label: 'default host', assetId: 'asset-default' }]
        }],
        openedHosts: [],
        selectedDefaults: [{ id: 'asset-default', kind: 'hosts', label: 'default host', assetId: 'asset-default' }]
      }
    })
    const store = useWorkspaceStore()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)
    await flushMicrotasks()

    expect(store.selectedContexts).toEqual([])
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({
      id: 'conv-2',
      classicContext: {
        contexts: [],
        terminalBindings: [],
        autoFollowActiveHost: false
      }
    })
    expect(window.aiops.createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-default' }))
  })

  it('clears the previous selection when the restored Product Session does not exist', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: { session: null }
    })
    const store = useWorkspaceStore()
    store.selectedContexts = [{
      id: 'asset-previous',
      kind: 'hosts',
      label: 'previous host',
      assetId: 'asset-previous'
    }]

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)

    expect(store.selectedContexts).toEqual([])
    expect(window.aiops.createTerminal).not.toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-previous' }))
  })

  it('allows Agent Q&A without hosts and sends no implicit terminal target', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: { session: session({ classicContext: { contexts: [] } }) }
    })
    const store = useWorkspaceStore()
    await store.restoreConversation('conv-2')
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()

    await expect(
      store.sendChat('只分析现象，不执行命令', undefined, undefined, { mode: 'agent', skipKnowledgeSearch: true })
    ).resolves.toBe(true)

    const request = vi.mocked(window.aiops.createAiChatExchangeRequest).mock.calls.at(-1)?.[0]
    expect(request?.hostTargets).toEqual([])
    expect(request).not.toHaveProperty('terminalSessionId')
  })

  it('reopens a stable matching panel at send time when its canonical Classic target is missing', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [{ id: 'asset-1', kind: 'hosts', label: '10.24.8.12', assetId: 'asset-1' }]
          }
        })
      }
    })
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'legacy-terminal-without-provenance'
    store.activePanel.status = 'running'
    store.activePanel.sshSession = {
      connectionId: 'legacy-connection',
      host: '10.24.8.12',
      port: 22,
      username: 'ops',
      assetId: 'asset-1',
      assetName: 'prod-bastion'
    }
    store.activePanel.classicTarget = undefined
    vi.mocked(window.aiops.createTerminal).mockClear()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)

    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()
    await expect(
      store.sendChat('检查主机', undefined, undefined, { mode: 'agent', skipKnowledgeSearch: true })
    ).resolves.toBe(true)
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', assetId: 'asset-1' }))
    expect(vi.mocked(window.aiops.createAiChatExchangeRequest).mock.calls.at(-1)?.[0].hostTargets).toEqual([
      expect.objectContaining({ targetId: 'asset-1::test-session-asset-1', terminalSessionId: 'test-session-asset-1' })
    ])
  })

  it('restores multiple selected hosts by opening their terminals before continuing', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [
              { id: 'asset-1', kind: 'hosts', label: '10.24.8.12', assetId: 'asset-1' },
              { id: 'asset-2', kind: 'hosts', label: '10.24.12.44', assetId: 'asset-2' }
            ]
          }
        })
      }
    })
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'terminal-existing'
    const originalPanelId = store.activePanel.id
    vi.mocked(window.aiops.createTerminal).mockClear()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)

    expect(vi.mocked(window.aiops.createTerminal).mock.calls.map(([input]) => input?.assetId)).toEqual(['asset-1', 'asset-2'])
    expect(store.activePanel.id).toBe(originalPanelId)
    expect(store.selectedContexts).toEqual([
      expect.objectContaining({ assetId: 'asset-1', terminalSessionId: 'test-session-asset-1' }),
      expect.objectContaining({ assetId: 'asset-2', terminalSessionId: 'test-session-asset-2' })
    ])
    vi.mocked(window.aiops.createTerminal).mockClear()
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()
    await expect(
      store.sendChat('分别检查两台主机', undefined, undefined, { mode: 'agent', skipKnowledgeSearch: true })
    ).resolves.toBe(true)

    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
    const request = vi.mocked(window.aiops.createAiChatExchangeRequest).mock.calls.at(-1)?.[0]
    expect(request?.hostTargets).toEqual([
      expect.objectContaining({ targetId: 'asset-1::test-session-asset-1', terminalSessionId: 'test-session-asset-1', label: '10.24.8.12', kind: 'ssh' }),
      expect.objectContaining({ targetId: 'asset-2::test-session-asset-2', terminalSessionId: 'test-session-asset-2', label: '10.24.12.44', kind: 'ssh' })
    ])
    expect(request).not.toHaveProperty('terminalSessionId')
  })

  it('restores available hosts and silently drops a host that cannot reconnect', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [
              { id: 'asset-1', kind: 'hosts', label: '10.24.8.12', assetId: 'asset-1' },
              { id: 'asset-2', kind: 'hosts', label: '10.24.12.44', assetId: 'asset-2' }
            ]
          }
        })
      }
    })
    const createTerminal = vi.mocked(window.aiops.createTerminal)
    const defaultCreateTerminal = createTerminal.getMockImplementation()!
    createTerminal.mockImplementation(async (options) => {
      if (options?.assetId === 'asset-2') throw new Error('staging host unavailable')
      return defaultCreateTerminal(options)
    })
    const store = useWorkspaceStore()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()

    await expect(
      store.sendChat('检查两台主机', undefined, undefined, { mode: 'agent', skipKnowledgeSearch: true })
    ).resolves.toBe(true)

    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalled()
    expect(store.selectedContexts).toEqual([
      expect.objectContaining({ assetId: 'asset-1', terminalSessionId: 'test-session-asset-1' })
    ])
    expect(store.topNotice).not.toContain('staging host unavailable')
  })

  it('keeps the usable binding when two restored hosts resolve to the same terminal session', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [
              { id: 'asset-1', kind: 'hosts', label: '10.24.8.12', assetId: 'asset-1' },
              { id: 'asset-2', kind: 'hosts', label: '10.24.12.44', assetId: 'asset-2' }
            ]
          }
        })
      }
    })
    const createTerminal = vi.mocked(window.aiops.createTerminal)
    const defaultCreateTerminal = createTerminal.getMockImplementation()!
    createTerminal.mockImplementation(async (options) => {
      const result = await defaultCreateTerminal(options)
      const id = 'terminal-shared'
      return {
        ...result,
        id,
        classicTarget: result.classicTarget
          ? { ...result.classicTarget, terminalSessionId: id }
          : undefined,
        connection: result.connection ? { ...result.connection, connectionId: `ssh-${id}` } : undefined,
        lifecycle: result.lifecycle ? { ...result.lifecycle, id, connectionId: result.connection ? `ssh-${id}` : undefined } : undefined
      }
    })
    const store = useWorkspaceStore()

    await expect(store.restoreConversation('conv-2')).resolves.toBe(true)
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()

    await expect(
      store.sendChat('检查两台主机', undefined, undefined, { mode: 'agent', skipKnowledgeSearch: true })
    ).resolves.toBe(true)

    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalled()
  })

  it('drops a missing restored host and does not switch Agent to the active terminal', async () => {
    vi.mocked(window.aiops.getProductSession).mockResolvedValue({
      ok: true,
      data: {
        session: session({
          classicContext: {
            contexts: [{
              id: 'asset-missing',
              kind: 'hosts',
              label: 'prod.internal',
              assetId: 'asset-missing',
              host: 'prod.internal',
              port: 22,
              username: 'ops'
            }]
          }
        })
      }
    })
    const store = useWorkspaceStore()
    await store.restoreConversation('conv-2')
    store.activePanel.sessionId = 'terminal-unrelated'
    store.activePanel.title = 'Unrelated local shell'
    store.activePanel.sshSession = undefined
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()

    await expect(store.sendChat('继续检查生产环境', undefined, undefined, { mode: 'agent' })).resolves.toBe(true)

    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalled()
    expect(store.selectedContexts).toEqual([])
    expect(store.topNotice).not.toContain('prod.internal')
  })

  it('keeps Classic terminal bindings for restore and closes only after the last live terminal closes', async () => {
    const store = useWorkspaceStore()
    const firstPanel = store.activePanel
    firstPanel.sessionId = 'terminal-asset-1'
    firstPanel.status = 'running'
    firstPanel.sshSession = {
      assetId: 'asset-1',
      connectionId: 'connection-asset-1',
      assetName: 'Production',
      host: '10.24.8.12',
      port: 22,
      username: 'ops'
    }
    const secondPanel = store.createPanel()
    secondPanel.sessionId = 'terminal-asset-2'
    secondPanel.status = 'running'
    secondPanel.sshSession = {
      assetId: 'asset-2',
      connectionId: 'connection-asset-2',
      assetName: 'Staging',
      host: '10.24.12.44',
      port: 22,
      username: 'deploy'
    }
    if (!firstPanel.sessionId || !secondPanel.sessionId) throw new Error('expected terminal panels')
    const bindings = [
      {
        id: 'asset-1',
        kind: 'hosts' as const,
        label: 'Production',
        assetId: 'asset-1',
        panelId: firstPanel.id,
        terminalSessionId: firstPanel.sessionId,
        host: '10.24.8.12',
        port: 22,
        username: 'ops'
      },
      {
        id: 'asset-2',
        kind: 'hosts' as const,
        label: 'Staging',
        assetId: 'asset-2',
        panelId: secondPanel.id,
        terminalSessionId: secondPanel.sessionId,
        host: '10.24.12.44',
        port: 22,
        username: 'deploy'
      }
    ]
    let currentSession = session({
      classicContext: {
        contexts: bindings.map((binding) => ({ ...binding })),
        terminalBindings: bindings.map((binding) => ({ ...binding })),
        autoFollowActiveHost: false
      }
    })
    vi.mocked(window.aiops.listProductSessions).mockImplementation(async () => ({
      ok: true,
      data: { sessions: [currentSession] }
    }))
    vi.mocked(window.aiops.updateProductSession).mockImplementation(async (input) => {
      currentSession = {
        ...currentSession,
        ...(input.classicContext === null
          ? { classicContext: undefined }
          : input.classicContext
            ? { classicContext: input.classicContext }
            : {}),
        updatedAt: currentSession.updatedAt + 1
      }
      return { ok: true, data: { session: currentSession } }
    })

    firstPanel.status = 'closed'
    await expect(store.handleClassicTerminalClosed(firstPanel.id, firstPanel.sessionId)).resolves.toEqual([])
    expect(currentSession.classicContext?.contexts).toEqual([
      expect.objectContaining({ assetId: 'asset-2' })
    ])
    expect(currentSession.classicContext?.terminalBindings).toHaveLength(2)

    secondPanel.status = 'closed'
    await expect(store.handleClassicTerminalClosed(secondPanel.id, secondPanel.sessionId)).resolves.toEqual(['conv-2'])
    expect(currentSession.classicContext?.terminalBindings).toHaveLength(2)
  })
})
