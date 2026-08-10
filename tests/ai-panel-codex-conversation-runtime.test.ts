import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { aiPanelModeStorageKey, aiPanelWorkspaceLinkModeStorageKey } from '@/services/ai/aiPanelModeRuntime'
import {
  createAiPanelCodexConversationRuntime,
  type AiPanelCodexConversation
} from '@/services/ai/aiPanelCodexConversationRuntime'
import type { AiPanelCodexTerminalRuntimeOptions } from '@/services/ai/aiPanelCodexTerminalRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { TerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import type { AiAttentionInput, AiAttentionItem } from '@/stores/workspace'
import type { AiContextCatalog, AiContextOption } from '@shared/contracts/aiChat'
import type { CodexSessionKillResult, CodexSessionTargetContext } from '@shared/contracts/codexSessions'
import type { ProductSessionListResult, ProductSessionRecord } from '@shared/contracts/productSessions'

const t = (key: string) =>
  ({
    'ai.codexCliMode': 'Codex CLI',
    'ai.classicChatMode': 'Classic Chat',
    'ai.codexStarting': 'Starting',
    'ai.codexReady': 'Ready',
    'ai.codexError': 'Error',
    'ai.codexClosed': 'Closed',
    'ai.codexIdle': 'Idle',
    'ai.codexTargetUnbound': 'Unbound',
    'ai.codexTargetDropHint': 'Drop a target',
    'ai.codexTargetMissing': 'Missing target',
    'ai.codexTargetOpenFailed': 'Open target failed',
    'ai.codexTargetClosed': 'Target closed',
    'ai.codexWorkspaceLinkNoConversation': 'No linked conversation',
    'ai.codexSessionStateSaveFailed': 'Codex session state could not be saved.',
    'ai.codexSessionStateLoadFailed': 'Codex session state could not be loaded.',
    'ai.codexRuntimeStopFailed': 'Codex runtime could not be stopped.',
    'ai.codexSessionRotated': 'Created a Codex session for the new target.',
    'ai.codexUnboundSessionCreated': 'Created a new unbound Codex session.',
    'ai.keepOneTab': 'Keep one tab',
    'ai.tabClosed': 'Tab closed'
  })[key] || key

const terminalSettings: TerminalSettings = {
  terminalType: 'xterm-256color',
  fontFamily: 'JetBrains Mono',
  fontSize: 13,
  scrollBack: 1000,
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.2,
  pinchZoomStatus: false,
  showCloseButton: true,
  sshAgentsStatus: false,
  middleMouseEvent: 'none',
  rightMouseEvent: 'contextMenu'
}

const localPanel = (): TerminalPanel => ({
  id: 'panel-local',
  title: 'Local shell',
  cwd: '/repo',
  output: '',
  outputSegments: [],
  status: 'ready',
  kind: 'terminal',
  sessionId: 'terminal-local'
})

const sshPanel = (): TerminalPanel => ({
  ...localPanel(),
  id: 'panel-ssh',
  title: 'prod',
  cwd: '/srv/app',
  sessionId: 'terminal-ssh',
  sshSession: {
    connectionId: 'conn-1',
    host: '10.0.0.8',
    port: 22,
    username: 'ops',
    assetId: 'asset-1',
    assetName: 'Production'
  }
})

const hostContext: AiContextOption = {
  id: 'host-1',
  kind: 'hosts',
  label: 'Production host',
  host: '10.0.0.8',
  username: 'ops',
  assetName: 'Production'
}

const codexProductSession = (patch: Partial<ProductSessionRecord> = {}): ProductSessionRecord => ({
  id: 'product-codex-session',
  surface: 'codex',
  title: 'Codex session',
  isOpen: true,
  projectRoot: '/srv/app',
  lastKnownCwd: '/srv/app',
  nativeBinding: {
    engine: 'codex',
    nativeSessionId: '0197f123-4567-7890-abcd-ef0123456789',
    profile: 'embedded-tui'
  },
  createdAt: 1,
  updatedAt: 2,
  ...patch
})

const originalProductSessionMethods = {
  listProductSessions: window.aiops.listProductSessions,
  getProductSession: window.aiops.getProductSession,
  createProductSession: window.aiops.createProductSession,
  updateProductSession: window.aiops.updateProductSession,
  closeProductSession: window.aiops.closeProductSession,
  onProductSessionChanged: window.aiops.onProductSessionChanged
}

const createTerminalRuntime = () => {
  const calls = {
    clearConversationOutput: vi.fn(),
    clearSessionTarget: vi.fn(async () => undefined),
    copySelectionFromContextMenu: vi.fn(),
    pasteClipboardFromContextMenu: vi.fn(),
    disposeConversation: vi.fn(),
    disposeSubscriptions: vi.fn(),
    ensureTerminal: vi.fn(),
    fitTerminal: vi.fn(),
    focusActiveTerminal: vi.fn(),
    setHostElement: vi.fn(),
    setPendingTargetContext: vi.fn(async () => undefined),
    startSession: vi.fn(async (conversation: AiPanelCodexConversation) => {
      conversation.sessionId ||= 'codex-session'
      conversation.status = 'ready'
    }),
    stopSession: vi.fn(async (conversation?: AiPanelCodexConversation | null): Promise<CodexSessionKillResult> => ({
      ok: true as const,
      data: { id: conversation?.sessionId || '' }
    })),
    surfaceVisibility: [] as Array<{ conversationId: string; visible: boolean }>,
    syncConversationSurfaces: vi.fn(),
    syncConversationOutput: vi.fn(),
    syncActiveBridgeTarget: vi.fn(async () => undefined),
    syncTargetContext: vi.fn(async () => undefined),
    syncAttentionState: vi.fn(),
    applyTerminalSettings: vi.fn()
  }
  return {
    calls,
    factory: (options: AiPanelCodexTerminalRuntimeOptions<AiPanelCodexConversation>) => {
      calls.syncAttentionState.mockImplementation((conversation: AiPanelCodexConversation) => options.syncAttentionState(conversation))
      calls.syncConversationSurfaces.mockImplementation(() => {
        options.conversations().forEach((conversation) => {
          calls.surfaceVisibility.push({
            conversationId: conversation.id,
            visible: options.isConversationVisible ? options.isConversationVisible(conversation) : options.activeConversationId() === conversation.id
          })
        })
      })
      return {
      applyTerminalSettings: calls.applyTerminalSettings,
      clearConversationOutput: calls.clearConversationOutput,
      clearSessionTarget: calls.clearSessionTarget,
      copySelection: vi.fn(async () => true),
      copySelectionFromContextMenu: calls.copySelectionFromContextMenu,
      pasteClipboard: vi.fn(async () => true),
      pasteClipboardFromContextMenu: calls.pasteClipboardFromContextMenu,
      disposeConversation: calls.disposeConversation,
      disposeSubscriptions: calls.disposeSubscriptions,
      ensureTerminal: calls.ensureTerminal,
      fitTerminal: calls.fitTerminal,
      focusActiveTerminal: calls.focusActiveTerminal,
      markPendingTargetDelivered: vi.fn(),
      setHostElement: calls.setHostElement,
      setPendingTargetContext: calls.setPendingTargetContext,
      startSession: calls.startSession,
      stopSession: calls.stopSession,
      subscribeBridge: vi.fn(),
      syncConversationSurfaces: calls.syncConversationSurfaces,
      syncConversationOutput: calls.syncConversationOutput,
      syncActiveBridgeTarget: calls.syncActiveBridgeTarget,
      syncTargetContext: calls.syncTargetContext
      }
    }
  }
}

const createHarness = (settings: { mode?: 'codex' | 'classic'; agentMode?: boolean } = {}) => {
  if (settings.mode) window.localStorage.setItem(aiPanelModeStorageKey, settings.mode)
  const panels = [localPanel(), sshPanel()]
  const activePanel = ref<TerminalPanel | null>(panels[0])
  const catalog: AiContextCatalog = {
    categories: [{ id: 'hosts', label: 'Hosts', options: [hostContext] }],
    openedHosts: [{ ...hostContext, id: 'host-open', label: 'Opened host' }],
    selectedDefaults: []
  }
  const notices: string[] = []
  const topNotices: string[] = []
  const attention: AiAttentionInput[] = []
  const removedAttention: string[] = []
  const markedAttention: string[] = []
  const logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = []
  const terminalRuntime = createTerminalRuntime()
  const loadClassicChatData = vi.fn(async () => undefined)
  const closePopups = vi.fn()
  const refreshAiContextCatalog = vi.fn(async () => undefined)
  const openTerminalForAiHostContext = vi.fn(
    async (): Promise<TerminalPanel | null | undefined> => panels[1]
  )
  const activateTerminalPanel = vi.fn((id: string) => {
    const panel = panels.find((item) => item.id === id || item.sessionId === id) || null
    if (panel) activePanel.value = panel
    return panel
  })

  const runtime = createAiPanelCodexConversationRuntime({
    agentMode: () => Boolean(settings.agentMode),
    activePanelId: () => activePanel.value?.id || '',
    activePanel: () => activePanel.value,
    panels: () => panels,
    terminalSettings: () => terminalSettings,
    aiContextCatalog: () => catalog,
    loadClassicChatData,
    closePopups,
    showNotice: (message) => notices.push(message),
    setTopNotice: (message) => topNotices.push(message),
    refreshAiContextCatalog,
    openTerminalForAiHostContext,
    activateTerminalPanel,
    upsertAiAttentionItem: (input) => attention.push(input),
    removeAiAttentionItem: (id) => {
      removedAttention.push(id)
    },
    markAiAttentionHandled: (id) => {
      markedAttention.push(id)
    },
    afterDomUpdate: () => nextTick(),
    t: t as never,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    terminalRuntimeFactory: terminalRuntime.factory
  })

  return {
    activePanel: (panel: TerminalPanel | null) => {
      activePanel.value = panel
    },
    activePanelRef: activePanel,
    activateTerminalPanel,
    attention,
    closePopups,
    loadClassicChatData,
    logs,
    markedAttention,
    notices,
    openTerminalForAiHostContext,
    panels,
    refreshAiContextCatalog,
    removedAttention,
    runtime,
    terminalRuntime,
    topNotices
  }
}

beforeEach(() => {
  Object.assign(window.aiops, originalProductSessionMethods)
  ;(globalThis as any).__resetProductSessionStoreMock?.()
  window.localStorage.removeItem(aiPanelModeStorageKey)
  window.localStorage.removeItem(aiPanelWorkspaceLinkModeStorageKey)
})

afterEach(() => {
  Object.assign(window.aiops, originalProductSessionMethods)
  ;(globalThis as any).__resetProductSessionStoreMock?.()
})

describe('aiPanelCodexConversationRuntime', () => {
  it('derives Codex mode labels and leaves cold start in the zero-session state', async () => {
    const { runtime, terminalRuntime } = createHarness()

    expect(runtime.aiPanelMode.value).toBe('codex')
    expect(runtime.currentAiPanelModeLabel.value).toBe('Codex CLI')
    expect(runtime.currentPanelTarget.value).toMatchObject({ kind: 'local', sessionId: 'terminal-local', label: 'Local shell' })
    expect(runtime.filteredCodexHostTargets.value.map((host) => host.label)).toEqual(['Opened host', 'Production host'])

    runtime.startInitialMode()
    await nextTick()

    expect(runtime.activeCodexConversation.value).toBeNull()
    expect(runtime.codexConversations.value).toEqual([])
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()
  })

  it('switches between classic and Codex modes through injected boundaries', async () => {
    const { closePopups, loadClassicChatData, runtime, terminalRuntime } = createHarness({ mode: 'classic' })

    expect(runtime.aiPanelMode.value).toBe('classic')
    await runtime.selectAiPanelMode('classic')
    expect(runtime.panelModeMenuOpen.value).toBe(false)

    await runtime.selectAiPanelMode('codex')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('codex')
    expect(closePopups).toHaveBeenCalled()
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()

    await runtime.selectAiPanelMode('classic')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('classic')
    expect(loadClassicChatData).toHaveBeenCalled()
  })

  it('hydrates Codex tabs with project roots and exact native thread ids', async () => {
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: {
        sessions: [{
          id: 'product-codex-restored',
          surface: 'codex' as const,
          title: 'Production session',
          isOpen: true,
          projectRoot: '/srv/app',
          lastKnownCwd: '/srv/app/api',
          target: {
            kind: 'ssh' as const,
            terminalSessionId: 'stale-terminal',
            assetId: 'asset-1',
            connectionId: 'conn-1',
            label: 'Production'
          },
          nativeBinding: {
            engine: 'codex',
            nativeSessionId: '0197f123-4567-7890-abcd-ef0123456789',
            profile: 'embedded-tui'
          },
          createdAt: 1,
          updatedAt: 2
        }]
      }
    }))
    const { runtime, terminalRuntime } = createHarness()

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe('product-codex-restored'))

    expect(runtime.activeCodexConversation.value).toMatchObject({
      title: 'Production session',
      projectRoot: '/srv/app',
      nativeThreadId: '0197f123-4567-7890-abcd-ef0123456789',
      launchMode: 'resume',
      boundTarget: {
        sessionId: 'terminal-ssh',
        assetId: 'asset-1',
        cwd: '/srv/app'
      }
    })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(runtime.activeCodexConversation.value)
    runtime.dispose()
  })

  it('waits for pending Codex hydration before creating and selecting a new conversation', async () => {
    const restoredSession = codexProductSession({ id: 'product-codex-hydration-race' })
    let resolveSessions!: (result: ProductSessionListResult) => void
    window.aiops.listProductSessions = vi.fn(() => new Promise<ProductSessionListResult>((resolve) => {
      resolveSessions = resolve
    }))
    const { runtime, terminalRuntime } = createHarness()

    runtime.startInitialMode()
    await vi.waitFor(() => expect(window.aiops.listProductSessions).toHaveBeenCalledTimes(1))
    const creation = runtime.createNewCodexConversation()

    expect(runtime.codexConversations.value).toEqual([])
    resolveSessions({ ok: true, data: { sessions: [restoredSession] } })
    await creation
    await nextTick()
    await nextTick()

    const created = runtime.codexConversations.value.find((conversation) => conversation.id !== restoredSession.id)
    expect(runtime.codexConversations.value.map((conversation) => conversation.id)).toContain(restoredSession.id)
    expect(created).toMatchObject({ boundTarget: null })
    expect(runtime.activeCodexConversationId.value).toBe(created?.id)
    expect(terminalRuntime.calls.ensureTerminal).toHaveBeenCalledWith(created)
    runtime.dispose()
  })

  it('resumes a local Codex thread on a new local terminal id within the same project root', async () => {
    const productSession = codexProductSession({
      id: 'product-codex-local-restored',
      projectRoot: '/repo',
      lastKnownCwd: '/repo/old-terminal',
      target: {
        kind: 'local',
        panelId: 'stale-local-panel',
        terminalSessionId: 'stale-local-session',
        label: 'Local shell'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [productSession] }
    }))
    const { openTerminalForAiHostContext, panels, runtime, terminalRuntime } = createHarness()
    openTerminalForAiHostContext.mockResolvedValue(panels[0])

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe(productSession.id))

    expect(runtime.activeCodexConversation.value?.boundTarget).toMatchObject({
      kind: 'local',
      panelId: 'panel-local',
      sessionId: 'terminal-local',
      cwd: '/repo'
    })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(runtime.activeCodexConversation.value)
    runtime.dispose()
  })

  it.each([
    {
      name: 'a stale host identity',
      mutatePanel: (panel: TerminalPanel) => {
        if (panel.sshSession) panel.sshSession.host = '10.0.0.9'
      }
    },
    {
      name: 'a closed panel',
      mutatePanel: (panel: TerminalPanel) => {
        panel.status = 'closed'
      }
    },
    {
      name: 'a cwd outside the project root',
      mutatePanel: (panel: TerminalPanel) => {
        panel.cwd = '/srv/other'
      }
    }
  ])('keeps an open Codex tab visible without auto-resume for $name', async ({ mutatePanel }) => {
    const productSession = codexProductSession({
      id: 'product-codex-stale-target',
      target: {
        kind: 'ssh',
        panelId: 'panel-ssh',
        terminalSessionId: 'terminal-ssh',
        assetId: 'asset-1',
        connectionId: 'conn-1',
        label: 'Production',
        host: '10.0.0.8',
        port: 22,
        username: 'ops',
        assetName: 'Production'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [productSession] }
    }))
    const { panels, runtime, terminalRuntime } = createHarness()
    mutatePanel(panels[1])

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe(productSession.id))
    await nextTick()

    expect(runtime.codexConversations.value.map((conversation) => conversation.id)).toEqual([productSession.id])
    expect(runtime.activeCodexConversation.value).toMatchObject({
      nativeThreadId: productSession.nativeBinding?.nativeSessionId,
      boundTarget: expect.objectContaining({ sessionId: 'terminal-ssh', host: '10.0.0.8' })
    })
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('rejects Codex restore when the reopened terminal is outside the saved project root', async () => {
    const closedSession = codexProductSession({
      id: 'product-codex-out-of-root-history',
      isOpen: false,
      target: {
        kind: 'ssh',
        panelId: 'panel-ssh',
        terminalSessionId: 'terminal-ssh',
        assetId: 'asset-1',
        connectionId: 'conn-1',
        label: 'Production',
        host: '10.0.0.8',
        port: 22,
        username: 'ops'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({ ok: true, data: { sessions: [closedSession] } }))
    window.aiops.getProductSession = vi.fn(async (id) => ({
      ok: true,
      data: { session: id === closedSession.id ? closedSession : null }
    }))
    window.aiops.updateProductSession = vi.fn(async (input) => ({
      ok: true,
      data: { session: { ...closedSession, ...input, updatedAt: 3 } }
    }))
    const { openTerminalForAiHostContext, panels, runtime, terminalRuntime } = createHarness({ agentMode: true })
    panels[1].cwd = '/srv/other'

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.codexSessionHistory.value).toContainEqual(closedSession))
    terminalRuntime.calls.startSession.mockClear()

    await expect(runtime.restoreCodexProductSession(closedSession.id)).resolves.toBe(false)
    expect(openTerminalForAiHostContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1', kind: 'hosts' }),
      expect.objectContaining({ cwd: '/srv/app' })
    )
    expect(runtime.activeCodexConversation.value).toBeNull()
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('loads an older Codex product session by id when it is outside the bounded cache', async () => {
    const olderSession = codexProductSession({
      id: 'product-codex-older-than-cache',
      isOpen: false,
      projectRoot: '/repo',
      lastKnownCwd: '/repo',
      target: {
        kind: 'local',
        panelId: 'panel-local',
        terminalSessionId: 'terminal-local',
        label: 'Local shell'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({ ok: true, data: { sessions: [] } }))
    window.aiops.getProductSession = vi.fn(async (id) => ({
      ok: true,
      data: { session: id === olderSession.id ? olderSession : null }
    }))
    window.aiops.updateProductSession = vi.fn(async (input) => ({
      ok: true,
      data: { session: { ...olderSession, ...input, updatedAt: 3 } }
    }))
    const { runtime, terminalRuntime } = createHarness()
    runtime.startInitialMode()
    await vi.waitFor(() => expect(window.aiops.listProductSessions).toHaveBeenCalled())

    await expect(runtime.restoreCodexProductSession(olderSession.id)).resolves.toBe(true)

    expect(window.aiops.getProductSession).toHaveBeenCalledWith(olderSession.id)
    expect(runtime.activeCodexConversation.value).toMatchObject({ id: olderSession.id })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalled()
    runtime.dispose()
  })

  it('matches the saved local terminal instead of the first unrelated local panel', async () => {
    const session = codexProductSession({
      id: 'product-codex-specific-local',
      projectRoot: '/repo',
      lastKnownCwd: '/repo',
      target: {
        kind: 'local',
        panelId: 'panel-local',
        terminalSessionId: 'terminal-local',
        label: 'Saved local shell'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({ ok: true, data: { sessions: [session] } }))
    const { panels, runtime, terminalRuntime } = createHarness()
    panels.unshift({
      ...localPanel(),
      id: 'panel-unrelated-local',
      sessionId: 'terminal-unrelated-local'
    })

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe(session.id))

    expect(runtime.activeCodexConversation.value?.boundTarget).toMatchObject({
      panelId: 'panel-local',
      sessionId: 'terminal-local'
    })
    runtime.dispose()
  })

  it('keeps closed Codex product sessions in history without hydrating them as tabs', async () => {
    const closedSession = codexProductSession({
      id: 'product-codex-closed',
      title: 'Closed session',
      isOpen: false,
      updatedAt: 3
    })
    const openSession = codexProductSession({
      id: 'product-codex-open',
      title: 'Open session',
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: '0197f123-4567-7890-abcd-ef0123456790',
        profile: 'embedded-tui'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [closedSession, openSession] }
    }))
    const { runtime } = createHarness()

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe(openSession.id))

    expect(runtime.codexConversations.value.map((conversation) => conversation.id)).toEqual([openSession.id])
    expect(runtime.codexSessionHistory.value.map((session) => session.id)).toEqual([closedSession.id, openSession.id])
    runtime.dispose()
  })

  it('keeps the zero-session state when every Codex product session is closed', async () => {
    const closedSession = codexProductSession({ id: 'product-codex-closed-only', isOpen: false })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [closedSession] }
    }))
    const { runtime } = createHarness()

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.codexSessionHistory.value).toContainEqual(closedSession))

    expect(runtime.activeCodexConversation.value).toBeNull()
    expect(runtime.codexConversations.value).toEqual([])
    expect(runtime.codexConversations.value.some((conversation) => conversation.id === closedSession.id)).toBe(false)
    expect(runtime.codexSessionHistory.value.find((session) => session.id === closedSession.id)).toEqual(closedSession)
    expect(runtime.activeCodexConversationId.value).toBe('')
    runtime.dispose()
  })

  it.each(['rejected result', 'bridge exception'])('retries Codex hydration after a %s without creating a replacement session', async (state) => {
    const openSession = codexProductSession({ id: 'product-codex-retry-open', isOpen: true })
    const originalListProductSessions = window.aiops.listProductSessions
    const listProductSessions = vi.fn()
    if (state === 'rejected result') {
      listProductSessions.mockResolvedValueOnce({
        ok: false,
        errorCode: 'PRODUCT_SESSION_LIST_FAILED',
        errorMessage: 'session list rejected'
      })
    } else {
      listProductSessions.mockRejectedValueOnce(new Error('session list failed'))
    }
    listProductSessions.mockResolvedValueOnce({
      ok: true,
      data: { sessions: [openSession] }
    })
    window.aiops.listProductSessions = listProductSessions
    vi.mocked(window.aiops.createProductSession).mockClear()
    const { runtime, topNotices } = createHarness()
    try {
      runtime.startInitialMode()
      await vi.waitFor(() => expect(topNotices.length).toBeGreaterThan(0))

      expect(listProductSessions).toHaveBeenCalledTimes(1)
      expect(runtime.codexConversations.value).toEqual([])
      expect(window.aiops.createProductSession).not.toHaveBeenCalled()

      runtime.startInitialMode()
      await vi.waitFor(() => expect(runtime.activeCodexConversation.value?.id).toBe(openSession.id))

      expect(listProductSessions).toHaveBeenCalledTimes(2)
      expect(window.aiops.createProductSession).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
      window.aiops.listProductSessions = originalListProductSessions
    }
  })

  it('restores Codex history with its original native thread and marks the product session open', async () => {
    const closedSession = codexProductSession({
      id: 'product-codex-history',
      title: 'History session',
      isOpen: false,
      target: {
        kind: 'ssh',
        terminalSessionId: 'stale-terminal',
        assetId: 'asset-1',
        connectionId: 'conn-1',
        label: 'Production'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [closedSession] }
    }))
    window.aiops.getProductSession = vi.fn(async (id) => ({
      ok: true,
      data: { session: id === closedSession.id ? closedSession : null }
    }))
    window.aiops.updateProductSession = vi.fn(async (input) => ({
      ok: true,
      data: {
        session: {
          ...closedSession,
          ...input,
          updatedAt: 4
        }
      }
    }))
    const { activateTerminalPanel, runtime, terminalRuntime } = createHarness({ agentMode: true })

    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.codexSessionHistory.value).toContainEqual(closedSession))
    await expect(runtime.restoreCodexProductSession(closedSession.id)).resolves.toBe(true)

    expect(runtime.activeCodexConversation.value).toMatchObject({
      id: closedSession.id,
      nativeThreadId: closedSession.nativeBinding?.nativeSessionId,
      launchMode: 'resume'
    })
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith(expect.objectContaining({
      id: closedSession.id,
      isOpen: true
    }))
    expect(runtime.codexSessionHistory.value.find((session) => session.id === closedSession.id)?.isOpen).toBe(true)
    expect(activateTerminalPanel).toHaveBeenCalledWith('panel-ssh')
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(expect.objectContaining({
      id: closedSession.id,
      nativeThreadId: closedSession.nativeBinding?.nativeSessionId
    }))
    runtime.dispose()
  })

  it('keeps a degraded Codex tab without starting native runtime when reopen persistence fails', async () => {
    const closedSession = codexProductSession({
      id: 'product-codex-reopen-rejected',
      isOpen: false,
      target: {
        kind: 'local',
        panelId: 'panel-local',
        terminalSessionId: 'terminal-local',
        label: 'Local shell'
      }
    })
    window.aiops.listProductSessions = vi.fn(async () => ({ ok: true, data: { sessions: [closedSession] } }))
    window.aiops.getProductSession = vi.fn(async () => ({ ok: true, data: { session: closedSession } }))
    window.aiops.updateProductSession = vi.fn(async () => ({
      ok: false,
      errorCode: 'PRODUCT_SESSION_DELETE_IN_PROGRESS',
      errorMessage: 'Session deletion has started.'
    }))
    const { runtime, terminalRuntime, topNotices } = createHarness()
    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.codexSessionHistory.value).toContainEqual(closedSession))

    await expect(runtime.restoreCodexProductSession(closedSession.id)).resolves.toBe(false)

    expect(runtime.activeCodexConversation.value).toMatchObject({
      id: closedSession.id,
      status: 'error',
      error: 'Codex session state could not be saved.'
    })
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()
    expect(topNotices).toContain('Codex session state could not be saved.')
    runtime.dispose()
  })

  it('restores an intentionally unbound Codex session as idle without a target error', async () => {
    const closedSession = codexProductSession({
      id: 'product-codex-unbound-history',
      isOpen: false,
      projectRoot: undefined,
      lastKnownCwd: undefined,
      target: undefined,
      nativeBinding: undefined
    })
    window.aiops.listProductSessions = vi.fn(async () => ({ ok: true, data: { sessions: [closedSession] } }))
    window.aiops.getProductSession = vi.fn(async () => ({ ok: true, data: { session: closedSession } }))
    window.aiops.updateProductSession = vi.fn(async (input) => ({
      ok: true,
      data: { session: { ...closedSession, ...input, updatedAt: 3 } }
    }))
    const { runtime, terminalRuntime, topNotices } = createHarness()
    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.codexSessionHistory.value).toContainEqual(closedSession))

    await expect(runtime.restoreCodexProductSession(closedSession.id)).resolves.toBe(true)

    expect(runtime.activeCodexConversation.value).toMatchObject({
      id: closedSession.id,
      status: 'idle',
      error: '',
      boundTarget: null
    })
    expect(terminalRuntime.calls.startSession).not.toHaveBeenCalled()
    expect(topNotices).not.toContain('Open target failed')
    runtime.dispose()
  })

  it('does not hydrate a Codex product session again after it is closed', async () => {
    const sessions = [
      codexProductSession({ id: 'product-codex-close-me', title: 'Close me', updatedAt: 3 }),
      codexProductSession({
        id: 'product-codex-keep-open',
        title: 'Keep open',
        nativeBinding: {
          engine: 'codex',
          nativeSessionId: '0197f123-4567-7890-abcd-ef0123456790',
          profile: 'embedded-tui'
        }
      })
    ]
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: sessions.map((session) => ({ ...session })) }
    }))
    window.aiops.closeProductSession = vi.fn(async (id) => {
      const session = sessions.find((candidate) => candidate.id === id)
      if (session) session.isOpen = false
      return { ok: true, data: { id, stopped: true } }
    })
    const firstHarness = createHarness()

    firstHarness.runtime.startInitialMode()
    await vi.waitFor(() => expect(firstHarness.runtime.codexConversations.value).toHaveLength(2))
    await firstHarness.runtime.closeCodexConversation(sessions[0].id)

    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(sessions[0].id)
    expect(sessions[0].isOpen).toBe(false)
    firstHarness.runtime.dispose()

    const secondHarness = createHarness()
    secondHarness.runtime.startInitialMode()
    await vi.waitFor(() => expect(secondHarness.runtime.activeCodexConversation.value?.id).toBe(sessions[1].id))

    expect(secondHarness.runtime.codexConversations.value.map((conversation) => conversation.id)).toEqual([sessions[1].id])
    expect(secondHarness.runtime.codexSessionHistory.value.find((session) => session.id === sessions[0].id)?.isOpen).toBe(false)
    secondHarness.runtime.dispose()
  })

  it('persists close before kill and keeps the tab retryable when persistence or kill fails', async () => {
    const order: string[] = []
    let closeAttempt = 0
    let trackOrder = false
    window.aiops.closeProductSession = vi.fn(async (id) => {
      if (trackOrder) order.push('close')
      closeAttempt += 1
      if (closeAttempt === 1) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_CLOSE_REJECTED',
          errorMessage: 'Product session close was rejected.'
        }
      }
      if (closeAttempt === 2) return { ok: true as const, data: { id: 'wrong-product-session', stopped: false } }
      return { ok: true as const, data: { id, stopped: false } }
    })
    window.aiops.updateProductSession = vi.fn(async (input) => {
      if (trackOrder && input.isOpen === true) order.push('rollback')
      return {
        ok: true as const,
        data: {
          session: codexProductSession({
            id: input.id,
            isOpen: input.isOpen ?? true,
            projectRoot: input.projectRoot || '/repo',
            lastKnownCwd: input.lastKnownCwd || '/repo'
          })
        }
      }
    })
    const { activePanel, logs, panels, runtime, terminalRuntime, topNotices } = createHarness()
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[0], 'test-local')
    activePanel(panels[1])
    await nextTick()
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'test-ssh')
    const closing = runtime.activeCodexConversation.value
    if (!closing) throw new Error('expected closing Codex conversation')
    terminalRuntime.calls.stopSession.mockClear()
    terminalRuntime.calls.disposeConversation.mockClear()
    trackOrder = true

    await expect(runtime.closeCodexConversation(closing.id)).resolves.toBe(false)

    expect(order).toEqual(['close'])
    expect(terminalRuntime.calls.stopSession).not.toHaveBeenCalled()
    expect(runtime.codexConversations.value).toContain(closing)
    expect(terminalRuntime.calls.disposeConversation).not.toHaveBeenCalledWith(closing)

    order.length = 0
    await expect(runtime.closeCodexConversation(closing.id)).resolves.toBe(false)
    expect(order).toEqual(['close'])
    expect(terminalRuntime.calls.stopSession).not.toHaveBeenCalled()
    expect(logs).toContainEqual(expect.objectContaining({
      event: 'renderer.product-session.codex-close-failed',
      fields: expect.objectContaining({
        errorCode: 'PRODUCT_SESSION_CLOSE_RESULT_INVALID',
        returnedProductSessionId: 'wrong-product-session'
      })
    }))

    order.length = 0
    terminalRuntime.calls.stopSession.mockImplementationOnce(async () => {
      order.push('kill')
      return {
        ok: false,
        errorCode: 'CODEX_KILL_REJECTED',
        errorMessage: 'Codex runtime is still running.'
      }
    })

    await expect(runtime.closeCodexConversation(closing.id)).resolves.toBe(false)

    expect(order).toEqual(['close', 'kill', 'rollback'])
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith({ id: closing.id, isOpen: true })
    expect(runtime.codexConversations.value).toContain(closing)
    expect(closing).toMatchObject({ status: 'error', error: 'Codex runtime is still running.' })
    expect(terminalRuntime.calls.disposeConversation).not.toHaveBeenCalledWith(closing)
    expect(topNotices.at(-1)).toBe('Codex runtime is still running.')
    expect(logs).toContainEqual(expect.objectContaining({
      level: 'warn',
      event: 'renderer.codex-session.close-kill-failed',
      fields: expect.objectContaining({ rollbackOk: true, errorCode: 'CODEX_KILL_REJECTED' })
    }))

    order.length = 0
    terminalRuntime.calls.stopSession.mockImplementationOnce(async (conversation) => {
      order.push('kill')
      return { ok: true, data: { id: conversation?.sessionId || '' } }
    })
    await expect(runtime.closeCodexConversation(closing.id)).resolves.toBe(true)

    expect(order.slice(0, 2)).toEqual(['close', 'kill'])
    expect(runtime.codexConversations.value).not.toContain(closing)
    expect(terminalRuntime.calls.disposeConversation).toHaveBeenCalledWith(closing)
  })

  it('binds, changes, unbinds, locates, and filters Codex targets without owning terminal side effects', async () => {
    const { logs, openTerminalForAiHostContext, panels, refreshAiContextCatalog, runtime, terminalRuntime } = createHarness()

    await runtime.bindCodexTarget({ kind: 'unknown' })
    expect(runtime.activeCodexConversation.value?.error).toBe('Missing target')

    await runtime.bindTerminalPanelToCodex(panels[1], 'bind-current')
    expect(runtime.activeCodexConversation.value?.boundTarget).toMatchObject({ kind: 'ssh', sessionId: 'terminal-ssh', host: '10.0.0.8' })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalled()
    expect(logs.some((entry) => entry.event === 'renderer.codex-target.bound')).toBe(true)

    const sshConversation = runtime.activeCodexConversation.value!
    sshConversation.sessionId = 'codex-session'
    await runtime.bindTerminalPanelToCodex(panels[0], 'changed')
    const localConversation = runtime.activeCodexConversation.value!
    expect(localConversation.id).not.toBe(sshConversation.id)
    expect(localConversation.boundTarget).toMatchObject({ kind: 'local', sessionId: 'terminal-local' })
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(sshConversation.id)
    expect(terminalRuntime.calls.stopSession).toHaveBeenCalledWith(sshConversation)
    expect(terminalRuntime.calls.syncTargetContext).not.toHaveBeenCalledWith({ force: true, conversation: sshConversation })

    await runtime.unbindCodexTarget()
    expect(runtime.activeCodexConversation.value?.id).not.toBe(localConversation.id)
    expect(runtime.activeCodexConversation.value?.boundTarget).toBeNull()
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(localConversation.id)
    expect(terminalRuntime.calls.stopSession).toHaveBeenCalledWith(localConversation)
    expect(terminalRuntime.calls.clearSessionTarget).not.toHaveBeenCalled()

    await runtime.toggleCodexTargetPicker()
    expect(runtime.codexTargetPickerOpen.value).toBe(true)
    expect(refreshAiContextCatalog).toHaveBeenCalled()
    runtime.codexTargetQuery.value = 'opened'
    expect(runtime.filteredCodexHostTargets.value.map((host) => host.label)).toEqual(['Opened host'])

    await runtime.bindHostContextToCodex(hostContext)
    expect(openTerminalForAiHostContext).toHaveBeenCalledWith(hostContext)
    expect(runtime.activeCodexConversation.value?.boundTarget).toMatchObject({ sessionId: 'terminal-ssh' })

    runtime.locateCodexBoundTarget()
    expect(runtime.activeCodexConversation.value?.error).toBe('')
  })

  it('creates one Product Session and starts Codex on the first bind while target sync is also requested', async () => {
    const sessions = new Map<string, ProductSessionRecord>()
    let now = 10
    window.aiops.getProductSession = vi.fn(async (id) => ({
      ok: true as const,
      data: { session: sessions.get(id) || null }
    }))
    window.aiops.createProductSession = vi.fn(async (input) => {
      const id = input.id || `product-${++now}`
      if (sessions.has(id)) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_ID_CONFLICT',
          errorMessage: `Product session already exists: ${id}`
        }
      }
      const createdAt = ++now
      const session: ProductSessionRecord = {
        id,
        surface: input.surface,
        title: input.title || '',
        isOpen: input.isOpen ?? true,
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.lastKnownCwd ? { lastKnownCwd: input.lastKnownCwd } : {}),
        ...(input.target ? { target: input.target } : {}),
        createdAt,
        updatedAt: createdAt
      }
      sessions.set(id, session)
      return { ok: true as const, data: { session } }
    })
    window.aiops.updateProductSession = vi.fn(async (input) => {
      const existing = sessions.get(input.id)
      if (!existing) {
        return {
          ok: false as const,
          errorCode: 'PRODUCT_SESSION_NOT_FOUND',
          errorMessage: 'Product session was not found.'
        }
      }
      const session: ProductSessionRecord = {
        ...existing,
        ...input,
        id: existing.id,
        surface: existing.surface,
        createdAt: existing.createdAt,
        updatedAt: ++now
      }
      sessions.set(session.id, session)
      return { ok: true as const, data: { session } }
    })
    const { panels, runtime, terminalRuntime } = createHarness()

    await runtime.toggleCodexTargetPicker()
    expect(runtime.codexTargetPickerOpen.value).toBe(true)

    const binding = runtime.bindTerminalPanelToCodex(panels[0], 'bind-current')
    expect(runtime.codexTargetPickerOpen.value).toBe(false)
    const targetSync = runtime.syncActiveCodexTargetContext()

    await expect(binding).resolves.toBe(true)
    await targetSync

    expect(window.aiops.createProductSession).toHaveBeenCalledTimes(1)
    expect(window.aiops.updateProductSession).not.toHaveBeenCalled()
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledTimes(1)
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(runtime.activeCodexConversation.value)
    expect(runtime.activeCodexConversation.value).toMatchObject({
      boundTarget: expect.objectContaining({ sessionId: 'terminal-local' }),
      status: 'ready'
    })

    const conversation = runtime.activeCodexConversation.value!
    const canonicalTitle = sessions.get(conversation.id)?.title
    conversation.title = 'stale renderer title'
    vi.mocked(window.aiops.updateProductSession).mockClear()
    await runtime.syncActiveCodexTargetContext()
    expect(window.aiops.updateProductSession).toHaveBeenCalledTimes(1)
    expect(window.aiops.updateProductSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ title: expect.anything() })
    )
    expect(sessions.get(conversation.id)?.title).toBe(canonicalTitle)
  })

  it('closes the host picker before opening a terminal and keeps it closed when opening fails', async () => {
    let resolveTerminal!: (panel: TerminalPanel | null) => void
    const { openTerminalForAiHostContext, runtime } = createHarness()
    openTerminalForAiHostContext.mockImplementationOnce(
      () => new Promise<TerminalPanel | null>((resolve) => {
        resolveTerminal = resolve
      })
    )

    await runtime.toggleCodexTargetPicker()
    runtime.codexTargetQuery.value = 'production'
    const binding = runtime.bindHostContextToCodex(hostContext)

    expect(runtime.codexTargetPickerOpen.value).toBe(false)
    expect(runtime.codexTargetQuery.value).toBe('')
    resolveTerminal(null)
    await expect(binding).resolves.toBe(false)
    expect(runtime.codexTargetPickerOpen.value).toBe(false)
    expect(runtime.activeCodexConversation.value?.error).toBe('Open target failed')
  })

  it.each([
    {
      name: 'cwd leaves the project root',
      mutateTarget: (panel: TerminalPanel) => {
        panel.cwd = '/srv/other'
      },
      expectedRoot: '/srv/other'
    },
    {
      name: 'stable host identity changes',
      mutateTarget: (panel: TerminalPanel) => {
        if (!panel.sshSession) return
        panel.sshSession.connectionId = 'conn-2'
        panel.sshSession.host = '10.0.0.9'
      },
      expectedRoot: '/srv/app'
    }
  ])('rotates the active product session when $name', async ({ mutateTarget, expectedRoot }) => {
    const order: string[] = []
    window.aiops.closeProductSession = vi.fn(async (id) => {
      order.push(`close:${id}`)
      return { ok: true, data: { id, stopped: false } }
    })
    const { logs, panels, runtime, terminalRuntime } = createHarness()
    await runtime.bindTerminalPanelToCodex(panels[1], 'initial-target')
    const previous = runtime.activeCodexConversation.value
    if (!previous) throw new Error('expected active Codex conversation')
    previous.nativeThreadId = '0197f123-4567-7890-abcd-ef0123456789'
    terminalRuntime.calls.stopSession.mockImplementationOnce(async (conversation) => {
      order.push(`kill:${conversation?.id}`)
      return { ok: true, data: { id: conversation?.sessionId || '' } }
    })

    mutateTarget(panels[1])
    await runtime.syncActiveCodexTargetContext()

    const replacement = runtime.activeCodexConversation.value
    expect(order).toEqual([`close:${previous.id}`, `kill:${previous.id}`])
    expect(replacement?.id).not.toBe(previous.id)
    expect(replacement).toMatchObject({
      projectRoot: expectedRoot,
      boundTarget: expect.objectContaining({ cwd: expectedRoot })
    })
    expect(replacement?.nativeThreadId).toBeUndefined()
    expect(runtime.codexConversations.value).not.toContain(previous)
    expect(terminalRuntime.calls.disposeConversation).toHaveBeenCalledWith(previous)
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(replacement)
    expect(logs).toContainEqual(expect.objectContaining({
      level: 'info',
      event: 'renderer.product-session.codex-rotated',
      fields: expect.objectContaining({ previousProductSessionId: previous.id, reason: 'live-target-changed' })
    }))
  })

  it('archives a bound native thread and keeps the unbound replacement as an unpersisted draft', async () => {
    const sessions = new Map<string, ProductSessionRecord>()
    let now = 10
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [...sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt) }
    }))
    window.aiops.getProductSession = vi.fn(async (id) => ({
      ok: true,
      data: { session: sessions.get(id) || null }
    }))
    window.aiops.createProductSession = vi.fn(async (input) => {
      const id = input.id || `product-${++now}`
      const existing = sessions.get(id)
      const session: ProductSessionRecord = {
        id,
        surface: input.surface,
        title: input.title || existing?.title || 'Codex CLI',
        isOpen: input.isOpen ?? true,
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.lastKnownCwd ? { lastKnownCwd: input.lastKnownCwd } : {}),
        ...(input.target ? { target: input.target } : {}),
        ...(input.nativeBinding ? { nativeBinding: input.nativeBinding } : {}),
        createdAt: existing?.createdAt || ++now,
        updatedAt: ++now
      }
      sessions.set(id, session)
      return { ok: true, data: { session } }
    })
    window.aiops.updateProductSession = vi.fn(async (input) => {
      const existing = sessions.get(input.id)
      if (!existing) return { ok: false, errorCode: 'PRODUCT_SESSION_NOT_FOUND', errorMessage: 'missing' }
      const session: ProductSessionRecord = { ...existing, updatedAt: ++now }
      if (input.title !== undefined) session.title = input.title
      if (input.isOpen !== undefined) session.isOpen = input.isOpen
      if (input.projectRoot === null) delete session.projectRoot
      else if (input.projectRoot !== undefined) session.projectRoot = input.projectRoot
      if (input.lastKnownCwd === null) delete session.lastKnownCwd
      else if (input.lastKnownCwd !== undefined) session.lastKnownCwd = input.lastKnownCwd
      if (input.target === null) delete session.target
      else if (input.target !== undefined) session.target = input.target
      if (input.nativeBinding === null) delete session.nativeBinding
      else if (input.nativeBinding !== undefined) session.nativeBinding = input.nativeBinding
      sessions.set(input.id, session)
      return { ok: true, data: { session } }
    })
    const order: string[] = []
    window.aiops.closeProductSession = vi.fn(async (id) => {
      order.push(`close:${id}`)
      const existing = sessions.get(id)
      if (!existing) return { ok: false, errorCode: 'PRODUCT_SESSION_NOT_FOUND', errorMessage: 'missing' }
      sessions.set(id, { ...existing, isOpen: false, updatedAt: ++now })
      return { ok: true, data: { id, stopped: false } }
    })
    const firstHarness = createHarness()
    await firstHarness.runtime.bindTerminalPanelToCodex(firstHarness.panels[1], 'native-target')
    const nativeConversation = firstHarness.runtime.activeCodexConversation.value
    if (!nativeConversation) throw new Error('expected native Codex conversation')
    nativeConversation.nativeThreadId = '0197f123-4567-7890-abcd-ef0123456789'
    const storedNative = sessions.get(nativeConversation.id)
    if (!storedNative) throw new Error('expected stored native Codex product session')
    sessions.set(nativeConversation.id, {
      ...storedNative,
      nativeBinding: {
        engine: 'codex',
        nativeSessionId: nativeConversation.nativeThreadId,
        profile: 'embedded-tui'
      }
    })
    firstHarness.terminalRuntime.calls.stopSession.mockImplementationOnce(async (conversation) => {
      order.push(`kill:${conversation?.id}`)
      return { ok: true, data: { id: conversation?.sessionId || '' } }
    })

    await expect(firstHarness.runtime.unbindCodexTarget()).resolves.toBe(true)

    const replacement = firstHarness.runtime.activeCodexConversation.value
    expect(order).toEqual([`close:${nativeConversation.id}`, `kill:${nativeConversation.id}`])
    expect(replacement?.id).not.toBe(nativeConversation.id)
    expect(replacement).toMatchObject({ boundTarget: null, sessionId: '' })
    expect(replacement?.nativeThreadId).toBeUndefined()
    expect(sessions.get(nativeConversation.id)).toMatchObject({
      isOpen: false,
      nativeBinding: { nativeSessionId: nativeConversation.nativeThreadId }
    })
    expect(sessions.has(replacement!.id)).toBe(false)
    expect(firstHarness.runtime.codexSessionHistory.value.find((session) => session.id === nativeConversation.id)).toMatchObject({
      isOpen: false,
      nativeBinding: { nativeSessionId: nativeConversation.nativeThreadId }
    })

    firstHarness.runtime.dispose()
    const secondHarness = createHarness()
    secondHarness.runtime.startInitialMode()
    await vi.waitFor(() => expect(window.aiops.listProductSessions).toHaveBeenCalled())
    expect(secondHarness.runtime.codexConversations.value).toEqual([])
    expect(secondHarness.runtime.activeCodexConversation.value).toBeNull()
    expect(secondHarness.terminalRuntime.calls.startSession).not.toHaveBeenCalled()
    secondHarness.runtime.dispose()
  })

  it('creates, selects, closes, restarts, focuses attention, applies settings, and disposes conversations', async () => {
    const { activePanel, attention, markedAttention, notices, panels, removedAttention, runtime, terminalRuntime, topNotices } = createHarness({ agentMode: true })

    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[0], 'test-local')
    const first = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await nextTick()
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'test-ssh')
    const second = runtime.activeCodexConversation.value
    if (!first || !second) throw new Error('expected conversations')

    expect(runtime.codexConversations.value).toHaveLength(2)
    expect(terminalRuntime.calls.ensureTerminal).toHaveBeenCalledWith(second)

    await runtime.selectCodexConversation(first.id)
    expect(runtime.activeCodexConversationId.value).toBe(first.id)
    expect(terminalRuntime.calls.syncActiveBridgeTarget).toHaveBeenCalled()
    expect(terminalRuntime.calls.fitTerminal).toHaveBeenCalledWith({ force: true, conversation: first })
    expect(terminalRuntime.calls.focusActiveTerminal).toHaveBeenCalled()
    expect(terminalRuntime.calls.surfaceVisibility.slice(-2)).toEqual([
      { conversationId: first.id, visible: true },
      { conversationId: second.id, visible: false }
    ])

    await runtime.selectCodexConversation(second.id)
    expect(terminalRuntime.calls.surfaceVisibility.slice(-2)).toEqual([
      { conversationId: first.id, visible: false },
      { conversationId: second.id, visible: true }
    ])
    await runtime.selectCodexConversation(first.id)

    first.status = 'error'
    first.error = 'bridge failed'
    first.sessionId = 'codex-session-1'
    const focusItem: AiAttentionItem = {
      id: `codex:${first.id}`,
      source: 'codex',
      kind: 'error',
      title: 'Codex',
      summary: 'bridge failed',
      priority: 50,
      createdAt: 1,
      conversationId: first.id
    }
    await runtime.focusAiAttentionItem(focusItem)
    expect(topNotices.at(-1)).toContain('已定位到')

    first.status = 'ready'
    await runtime.focusAiAttentionItem(focusItem)
    expect(markedAttention).toContain(focusItem.id)

    second.status = 'error'
    second.error = 'second failed'
    await runtime.restartCodexSession()
    expect(terminalRuntime.calls.stopSession).toHaveBeenCalledWith(first)
    expect(removedAttention).toContain(`codex:${first.id}`)
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(first)

    runtime.applyCodexTerminalSettingsToAll()
    expect(terminalRuntime.calls.applyTerminalSettings).toHaveBeenCalled()

    await runtime.closeCodexConversation(second.id)
    expect(terminalRuntime.calls.disposeConversation).toHaveBeenCalledWith(second)
    expect(notices).toContain('Tab closed')

    await runtime.closeCodexConversation(first.id)
    expect(runtime.codexConversations.value).toEqual([])
    expect(notices.filter((notice) => notice === 'Tab closed')).toHaveLength(2)

    first.status = 'error'
    first.error = 'attention'
    terminalRuntime.calls.syncAttentionState(first)
    runtime.dispose()
    expect(terminalRuntime.calls.disposeSubscriptions).toHaveBeenCalled()
    expect(removedAttention).toContain(`codex:${first.id}`)
    expect(attention.some((item) => item.surfaceId === 'agents-ai-panel')).toBe(true)
  })

  it('closes every Codex session bound to a terminal when that terminal closes', async () => {
    const { panels, runtime, terminalRuntime } = createHarness()
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'first-shared-binding')
    const firstId = runtime.activeCodexConversation.value?.id
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'second-shared-binding')
    const secondId = runtime.activeCodexConversation.value?.id
    terminalRuntime.calls.stopSession
      .mockResolvedValueOnce({ ok: true, data: { id: 'codex-first' } })
      .mockResolvedValueOnce({ ok: false, errorCode: 'CODEX_STOP_FAILED', errorMessage: 'already closed' })

    await expect(runtime.handleCodexTerminalClosed(panels[1].id, panels[1].sessionId || '')).resolves.toEqual([
      firstId,
      secondId
    ])

    expect(runtime.codexConversations.value.map((conversation) => conversation.id)).not.toEqual(
      expect.arrayContaining([firstId, secondId])
    )
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(firstId)
    expect(window.aiops.closeProductSession).toHaveBeenCalledWith(secondId)
    runtime.dispose()
  })

  it('links workspace terminal tab changes to already-bound Codex conversations', async () => {
    const { activePanel, activePanelRef, panels, runtime } = createHarness()

    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const localConversation = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'ssh')
    const sshConversation = runtime.activeCodexConversation.value
    if (!localConversation || !sshConversation) throw new Error('expected linked conversations')

    activePanel(panels[0])
    await nextTick()
    await nextTick()

    expect(runtime.aiPanelWorkspaceLinkMode.value).toBe('follow-workspace')
    expect(runtime.activeCodexConversationId.value).toBe(localConversation.id)
    expect(activePanelRef.value?.id).toBe('panel-local')
    expect(runtime.codexWorkspaceLinkNotice.value).toBe('')

    activePanel(panels[1])
    await nextTick()
    await nextTick()

    expect(runtime.activeCodexConversationId.value).toBe(sshConversation.id)
  })

  it('keeps an explicitly created unbound Codex conversation active in follow-workspace mode', async () => {
    const { panels, runtime, terminalRuntime } = createHarness()

    await runtime.selectAiPanelMode('codex')
    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const boundConversation = runtime.activeCodexConversation.value
    if (!boundConversation) throw new Error('expected a bound Codex conversation')

    await runtime.createNewCodexConversation()
    const created = runtime.codexConversations.value.at(-1)
    if (!created) throw new Error('expected a new Codex conversation')
    await nextTick()
    await nextTick()

    expect(created.boundTarget).toBeNull()
    expect(runtime.activeCodexConversationId.value).toBe(created.id)
    expect(runtime.activeCodexConversationId.value).not.toBe(boundConversation.id)
    expect(terminalRuntime.calls.surfaceVisibility.slice(-2)).toEqual([
      { conversationId: boundConversation.id, visible: false },
      { conversationId: created.id, visible: true }
    ])
    runtime.dispose()
  })

  it('links Codex conversation tab changes back to the bound workspace terminal', async () => {
    const { activePanel, activePanelRef, activateTerminalPanel, panels, runtime } = createHarness()

    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const localConversation = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await runtime.createNewCodexConversation()
    await runtime.bindTerminalPanelToCodex(panels[1], 'ssh')
    const sshConversation = runtime.activeCodexConversation.value
    if (!localConversation || !sshConversation) throw new Error('expected linked conversations')

    activePanel(panels[0])
    await runtime.selectCodexConversation(sshConversation.id)

    expect(activateTerminalPanel).toHaveBeenCalledWith('panel-ssh')
    expect(activePanelRef.value?.id).toBe('panel-ssh')

    activePanel(panels[1])
    await runtime.selectCodexConversation(localConversation.id)

    expect(activateTerminalPanel).toHaveBeenCalledWith('panel-local')
    expect(activePanelRef.value?.id).toBe('panel-local')
  })

  it('keeps manual workspace link mode from auto-switching Codex conversations', async () => {
    const { activePanel, activePanelRef, activateTerminalPanel, panels, runtime } = createHarness()

    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const localConversation = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await runtime.createNewCodexConversation()
    const sshConversation = runtime.activeCodexConversation.value
    if (!localConversation || !sshConversation) throw new Error('expected linked conversations')

    await runtime.toggleAiPanelWorkspaceLinkMode()
    expect(runtime.aiPanelWorkspaceLinkMode.value).toBe('manual')
    expect(window.localStorage.getItem(aiPanelWorkspaceLinkModeStorageKey)).toBe('manual')

    activePanel(panels[0])
    await nextTick()
    await nextTick()

    expect(runtime.activeCodexConversationId.value).toBe(sshConversation.id)

    await runtime.selectCodexConversation(localConversation.id)
    expect(activateTerminalPanel).not.toHaveBeenCalledWith('panel-local')
    expect(activePanelRef.value?.id).toBe('panel-local')
  })

  it('removes an open Codex tab when its product session is permanently deleted', async () => {
    let emitDeleted: (() => void) | undefined
    const unsubscribe = vi.fn()
    window.aiops.onProductSessionChanged = vi.fn((listener) => {
      emitDeleted = () => listener({ type: 'deleted', id: 'product-codex-deleted' })
      return unsubscribe
    })
    window.aiops.listProductSessions = vi.fn(async () => ({
      ok: true,
      data: { sessions: [codexProductSession({ id: 'product-codex-deleted' })] }
    }))
    const { runtime, terminalRuntime } = createHarness()
    runtime.startInitialMode()
    await vi.waitFor(() => expect(runtime.activeCodexConversationId.value).toBe('product-codex-deleted'))

    emitDeleted?.()
    await vi.waitFor(() => expect(runtime.codexConversations.value).toEqual([]))
    expect(runtime.codexSessionHistory.value).toEqual([])
    expect(terminalRuntime.calls.disposeConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-codex-deleted' })
    )

    runtime.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
