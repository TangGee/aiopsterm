import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import type { CodexSessionTargetContext } from '@shared/contracts/codexSessions'

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

const createTerminalRuntime = () => {
  const calls = {
    clearConversationOutput: vi.fn(),
    clearSessionTarget: vi.fn(async () => undefined),
    copySelectionFromContextMenu: vi.fn(),
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
    stopSession: vi.fn(async () => undefined),
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
  const openTerminalForAiHostContext = vi.fn(async () => panels[1])
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
  window.localStorage.removeItem(aiPanelModeStorageKey)
  window.localStorage.removeItem(aiPanelWorkspaceLinkModeStorageKey)
})

describe('aiPanelCodexConversationRuntime', () => {
  it('derives Codex mode labels, current target, host picker options, and starts the initial Codex mode', () => {
    const { runtime, terminalRuntime } = createHarness()

    expect(runtime.aiPanelMode.value).toBe('codex')
    expect(runtime.currentAiPanelModeLabel.value).toBe('Codex CLI')
    expect(runtime.currentPanelTarget.value).toMatchObject({ kind: 'local', sessionId: 'terminal-local', label: 'Local shell' })
    expect(runtime.filteredCodexHostTargets.value.map((host) => host.label)).toEqual(['Opened host', 'Production host'])

    runtime.startInitialMode()

    expect(runtime.activeCodexConversation.value).toMatchObject({ boundTarget: null })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalledWith(runtime.activeCodexConversation.value)
  })

  it('switches between classic and Codex modes through injected boundaries', async () => {
    const { closePopups, loadClassicChatData, runtime, terminalRuntime } = createHarness({ mode: 'classic' })

    expect(runtime.aiPanelMode.value).toBe('classic')
    await runtime.selectAiPanelMode('classic')
    expect(runtime.panelModeMenuOpen.value).toBe(false)

    await runtime.selectAiPanelMode('codex')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('codex')
    expect(closePopups).toHaveBeenCalled()
    expect(terminalRuntime.calls.startSession).toHaveBeenCalled()

    await runtime.selectAiPanelMode('classic')
    expect(window.localStorage.getItem(aiPanelModeStorageKey)).toBe('classic')
    expect(loadClassicChatData).toHaveBeenCalled()
  })

  it('binds, changes, unbinds, locates, and filters Codex targets without owning terminal side effects', async () => {
    const { logs, openTerminalForAiHostContext, panels, refreshAiContextCatalog, runtime, terminalRuntime } = createHarness()

    await runtime.bindCodexTarget({ kind: 'unknown' })
    expect(runtime.activeCodexConversation.value?.error).toBe('Missing target')

    await runtime.bindTerminalPanelToCodex(panels[1], 'bind-current')
    expect(runtime.activeCodexConversation.value?.boundTarget).toMatchObject({ kind: 'ssh', sessionId: 'terminal-ssh', host: '10.0.0.8' })
    expect(terminalRuntime.calls.startSession).toHaveBeenCalled()
    expect(logs.some((entry) => entry.event === 'renderer.codex-target.bound')).toBe(true)

    runtime.activeCodexConversation.value!.sessionId = 'codex-session'
    await runtime.bindTerminalPanelToCodex(panels[0], 'changed')
    expect(terminalRuntime.calls.syncTargetContext).toHaveBeenCalledWith({ force: true, conversation: runtime.activeCodexConversation.value })
    expect(terminalRuntime.calls.setPendingTargetContext).toHaveBeenCalledWith(
      runtime.activeCodexConversation.value,
      'changed',
      expect.objectContaining({ sessionId: 'terminal-local' })
    )

    await runtime.unbindCodexTarget()
    expect(runtime.activeCodexConversation.value?.boundTarget).toBeNull()
    expect(terminalRuntime.calls.clearSessionTarget).toHaveBeenCalledWith(runtime.activeCodexConversation.value, 'unbound')

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

  it('creates, selects, closes, restarts, focuses attention, applies settings, and disposes conversations', async () => {
    const { attention, markedAttention, notices, removedAttention, runtime, terminalRuntime, topNotices } = createHarness({ agentMode: true })

    await runtime.createNewCodexConversation()
    const first = runtime.activeCodexConversation.value
    await runtime.createNewCodexConversation()
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
    expect(notices).toContain('Keep one tab')

    first.status = 'error'
    first.error = 'attention'
    terminalRuntime.calls.syncAttentionState(first)
    runtime.dispose()
    expect(terminalRuntime.calls.disposeSubscriptions).toHaveBeenCalled()
    expect(removedAttention).toContain(`codex:${first.id}`)
    expect(attention.some((item) => item.surfaceId === 'agents-ai-panel')).toBe(true)
  })

  it('links workspace terminal tab changes to already-bound Codex conversations', async () => {
    const { activePanel, activePanelRef, panels, runtime } = createHarness()

    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const localConversation = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await runtime.createNewCodexConversation()
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

  it('links Codex conversation tab changes back to the bound workspace terminal', async () => {
    const { activePanel, activePanelRef, activateTerminalPanel, panels, runtime } = createHarness()

    await runtime.bindTerminalPanelToCodex(panels[0], 'local')
    const localConversation = runtime.activeCodexConversation.value
    activePanel(panels[1])
    await runtime.createNewCodexConversation()
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
})
