import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, defaultExtensionSettings, defaultKeywordHighlightSettings, defaultTerminalSettings } from '@/services/settings/workspaceConfigRuntime'
import { createEmptyTerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import { createWorkspaceTerminalPanelsController } from '@/services/terminal/workspaceTerminalPanelsController'

const createController = () => {
  const panels = ref([
    createEmptyTerminalPanel('panel-idle', 'Idle terminal'),
    createEmptyTerminalPanel('panel-recent', 'Recent knowledge'),
    createEmptyTerminalPanel('panel-active', 'Active file')
  ])
  panels.value[1].kind = 'knowledge'
  panels.value[1].knowledge = { relPath: 'ops/runbook.md', isImage: false }
  panels.value[2].kind = 'local-file'
  panels.value[2].localFile = { filePath: '/tmp/current.txt' }
  const state = {
    mode: ref<'terminal' | 'agents'>('terminal'),
    activeModule: ref<any>('workspace'),
    activePanelId: ref('panel-active'),
    panels,
    config: ref({ ...defaultConfig, workspaceIdleCleanup: { enabled: false, timeoutMinutes: 20 } }),
    managedAiSessions: ref([]),
    terminalSettings: ref({ ...defaultTerminalSettings }),
    extensionSettings: ref({ ...defaultExtensionSettings }),
    keywordHighlightSettings: ref(structuredClone(defaultKeywordHighlightSettings)),
    kbSelectedKeys: ref<string[]>([])
  }
  const controller = createWorkspaceTerminalPanelsController(state, {
    setTopNotice: vi.fn(),
    i18nText: vi.fn(() => '') as any,
    createRendererLocalId: vi.fn(() => 'panel-new'),
    findKnowledgeNode: vi.fn(() => null),
    recordMacroTerminalInput: vi.fn(),
    touchManagedAiTerminalActivity: vi.fn(),
    applyManagedAiTerminalLifecycle: vi.fn(),
    applyManagedAiTerminalExit: vi.fn(),
    applyManagedAiTerminalPanelClosed: vi.fn()
  })
  return { controller, state }
}

describe('workspace idle cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(2_000_000)
  })

  it('closes idle panels of every workspace kind and always keeps the active panel', async () => {
    const { controller, state } = createController()
    state.panels.value[0].lastActivityAt = 1
    state.panels.value[1].lastActivityAt = 1
    controller.touchPanelActivity('panel-recent')
    state.panels.value[2].lastActivityAt = 1

    const result = await controller.closeIdlePanels()

    expect(result).toMatchObject({ ok: true, scanned: 3, eligible: 1, closed: 1, failed: 0, skippedActive: 1 })
    expect(state.panels.value.map((panel) => panel.id)).toEqual(['panel-recent', 'panel-active'])
    expect(state.activePanelId.value).toBe('panel-active')
  })

  it('reuses terminal close behavior and refreshes activity after a failed close', async () => {
    const { controller, state } = createController()
    state.panels.value[0].sessionId = 'terminal-idle-session'
    state.panels.value[0].lastActivityAt = 1
    state.panels.value[1].lastActivityAt = 2_000_000
    vi.mocked(window.aiops.killTerminal).mockResolvedValueOnce({ ok: false, errorMessage: 'busy' } as any)

    const result = await controller.closeIdlePanels()

    expect(result).toMatchObject({ ok: false, eligible: 1, closed: 0, failed: 1 })
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('terminal-idle-session')
    expect(state.panels.value[0].lastActivityAt).toBe(2_000_000)
  })
})
