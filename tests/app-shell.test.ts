import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

type MockSelectionPosition = { start: { x: number; y: number }; end: { x: number; y: number } }
type MockXtermInstance = {
  cols: number
  rows: number
  buffer: { active: { viewportY: number; cursorX: number; cursorY: number } }
  options: Record<string, unknown>
  selectedText: string
  selectionPosition: MockSelectionPosition | undefined
  selectionCallbacks: Array<() => void>
  resizeCallbacks: Array<(size: { cols: number; rows: number }) => void>
  open: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  clearSelection: ReturnType<typeof vi.fn>
  hasSelection: () => boolean
  getSelection: () => string
  getSelectionPosition: () => MockSelectionPosition | undefined
  onSelectionChange: (callback: () => void) => void
  onResize: (callback: (size: { cols: number; rows: number }) => void) => void
  emitSelection: (text: string, position?: MockSelectionPosition) => void
}

const { mockXtermInstances, monacoMocks } = vi.hoisted(() => ({
  mockXtermInstances: [] as MockXtermInstance[],
  monacoMocks: {
    model: {
      updateOptions: vi.fn(),
      getOffsetAt: vi.fn(() => 0),
      getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
      getLineCount: vi.fn(() => 20),
      getLineMaxColumn: vi.fn(() => 80),
      getValueInRange: vi.fn(() => ''),
      getFullModelRange: vi.fn(() => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }))
    },
    editorInstance: {
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      getModel: vi.fn(),
      addCommand: vi.fn(),
      onDidChangeModelContent: vi.fn(),
      onDidChangeCursorPosition: vi.fn(),
      onDidChangeCursorSelection: vi.fn(),
      onDidScrollChange: vi.fn(),
      getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
      getSelection: vi.fn(() => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })),
      getScrollTop: vi.fn(() => 0),
      setPosition: vi.fn(),
      setSelection: vi.fn(),
      revealPositionInCenterIfOutsideViewport: vi.fn(),
      executeEdits: vi.fn(),
      focus: vi.fn(),
      updateOptions: vi.fn(),
      layout: vi.fn(),
      dispose: vi.fn()
    },
    create: vi.fn()
  }
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation((options = {}) => {
    const instance: MockXtermInstance = {
      cols: 80,
      rows: 20,
      buffer: { active: { viewportY: 0, cursorX: 0, cursorY: 0 } },
      options: { ...options },
      selectedText: '',
      selectionPosition: undefined,
      selectionCallbacks: [],
      resizeCallbacks: [],
      open: vi.fn(),
      loadAddon: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      clearSelection: vi.fn(function (this: any) {
        this.selectedText = ''
        this.selectionPosition = undefined
      }),
      hasSelection() {
        return this.selectedText.trim().length > 0
      },
      getSelection() {
        return this.selectedText
      },
      getSelectionPosition() {
        return this.selectionPosition
      },
      onSelectionChange(callback: () => void) {
        this.selectionCallbacks.push(callback)
      },
      onResize(callback: (size: { cols: number; rows: number }) => void) {
        this.resizeCallbacks.push(callback)
      },
      emitSelection(text: string, position = { start: { x: 0, y: 4 }, end: { x: text.length, y: 4 } }) {
        this.selectedText = text
        this.selectionPosition = position
        this.selectionCallbacks.forEach((callback) => callback())
      }
    }
    mockXtermInstances.push(instance)
    return instance
  })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() }))
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn()
  }))
}))

vi.mock('monaco-editor/esm/vs/editor/editor.api', () => {
  monacoMocks.editorInstance.getModel.mockReturnValue(monacoMocks.model)
  monacoMocks.editorInstance.onDidChangeModelContent.mockReturnValue({ dispose: vi.fn() })
  monacoMocks.editorInstance.onDidChangeCursorPosition.mockReturnValue({ dispose: vi.fn() })
  monacoMocks.editorInstance.onDidChangeCursorSelection.mockReturnValue({ dispose: vi.fn() })
  monacoMocks.editorInstance.onDidScrollChange.mockReturnValue({ dispose: vi.fn() })
  monacoMocks.create.mockReturnValue(monacoMocks.editorInstance)
  class Range {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
    constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
      this.startLineNumber = startLineNumber
      this.startColumn = startColumn
      this.endLineNumber = endLineNumber
      this.endColumn = endColumn
    }
  }
  return {
    editor: {
      create: monacoMocks.create,
      setModelLanguage: vi.fn()
    },
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { KeyS: 49, Enter: 3 },
    Range
  }
})

vi.mock('monaco-editor/esm/vs/editor/contrib/folding/browser/folding', () => ({}))
vi.mock('monaco-editor/esm/vs/editor/contrib/find/browser/findController', () => ({}))
vi.mock('monaco-editor/esm/vs/basic-languages/sql/sql.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/basic-languages/monaco.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class EditorWorker {} }))
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class JsonWorker {} }))
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes?: Element[] }) => {
      nodes?.forEach((node) => node.setAttribute('data-processed', 'true'))
    })
  }
}))
import AppShell from '@/components/AppShell.vue'
import AgentsSidebar from '@/components/AgentsSidebar.vue'
import AiPanel from '@/components/AiPanel.vue'
import TopBar from '@/components/TopBar.vue'
import SideRail from '@/components/SideRail.vue'
import AssetsPanel from '@/components/panels/AssetsPanel.vue'
import FileBrowser from '@/components/files/FileBrowser.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import WorkspacePanel from '@/components/panels/WorkspacePanel.vue'
import FilesPanel from '@/components/panels/FilesPanel.vue'
import UserPanel from '@/components/panels/UserPanel.vue'
import KnowledgePanel from '@/components/panels/KnowledgePanel.vue'
import KnowledgeCenterEditor from '@/components/KnowledgeCenterEditor.vue'
import ExtensionsPanel from '@/components/panels/ExtensionsPanel.vue'
import KubernetesPanel from '@/components/panels/KubernetesPanel.vue'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import SnippetsPanel from '@/components/panels/SnippetsPanel.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import { shortcutRuntime } from '@/services/shortcutRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import { DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64 } from '@shared/knowledgeBaseSeed'
import type { FileSessionInfo, KeywordHighlightUserConfig } from '@shared/preload'

const prodKeychainSshAgentFingerprint = 'SHA256:KW/btgUSM+Gu9ht4gyd2CMSZB/1setTDE0+Uik88xGE'

const waitForDatabaseSqlResult = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await flushPromises()
}

const waitForDatabaseDbAiDone = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 180))
  await flushPromises()
}

const waitForDatabaseCatalog = async () => {
  await flushPromises()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await flushPromises()
}

const loadTestFileSession = async (id = 'local'): Promise<FileSessionInfo> => {
  const result = await window.aiops.listFileSessionCatalog()
  const session = result.data?.sessions.find((item) => item.id === id)
  if (!result.ok || !session) throw new Error(`File session not found: ${id}`)
  return session
}

type TestWrapperLike = { find: (selector: string) => { exists: () => boolean; text: () => string } }
type WrapperSelectorLike = { find: (selector: string) => { exists: () => boolean } }

const waitForSelector = async (wrapper: WrapperSelectorLike, selector: string) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await flushPromises()
    if (wrapper.find(selector).exists()) return
  }
  throw new Error(`Selector did not appear: ${selector}`)
}

const waitForDatabaseTableData = async (wrapper?: TestWrapperLike) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await flushPromises()
    if (
      !wrapper ||
      wrapper.find('.db-data-workspace .db-result-table').exists() ||
      wrapper.find('.db-data-workspace .db-result-table tbody tr').exists() ||
      wrapper.find('.db-data-workspace .db-result-empty').exists() ||
      wrapper.find('.db-data-workspace .db-result-error').exists()
    ) {
      return
    }
  }
  if (wrapper) {
    throw new Error(
      JSON.stringify({
        dataText: wrapper.find('.db-data-workspace').exists() ? wrapper.find('.db-data-workspace').text() : 'Database data workspace did not render',
        queryCalls: vi.mocked(window.aiops.queryDatabaseTable).mock.calls.length,
        lastQuery: vi.mocked(window.aiops.queryDatabaseTable).mock.calls.at(-1)?.[0]
      })
    )
  }
}

const waitForMockCall = async (mock: { mock: { calls: unknown[] } }, label: string) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    if (mock.mock.calls.length > 0) return
  }
  throw new Error(`${label} was not called`)
}

const dispatchShortcut = (key: string, init: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: init.code,
    ctrlKey: init.ctrlKey,
    shiftKey: init.shiftKey,
    altKey: init.altKey,
    metaKey: init.metaKey,
    bubbles: true,
    cancelable: true
  })
  document.dispatchEvent(event)
  return event.defaultPrevented
}

const installMockVoiceRecorder = () => {
  const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder
  const originalWindowMediaRecorder = (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
  const originalMediaDevices = navigator.mediaDevices
  const stopTrack = vi.fn()
  const getUserMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }]
  }))

  class MockMediaRecorder {
    static isTypeSupported = vi.fn(() => true)

    state: 'inactive' | 'recording' = 'inactive'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onerror: ((event: { error: Error }) => void) | null = null
    onstop: (() => void) | null = null

    constructor(_stream: unknown, private readonly options: { mimeType?: string } = {}) {}

    start = vi.fn(() => {
      this.state = 'recording'
    })

    stop = vi.fn(() => {
      if (this.state === 'inactive') return
      this.state = 'inactive'
      this.ondataavailable?.({
        data: new Blob([new Uint8Array(4096)], { type: this.options.mimeType || 'audio/webm' })
      })
      this.onstop?.()
    })
  }

  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: MockMediaRecorder })
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: MockMediaRecorder })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
  })

  return () => {
    if (originalMediaRecorder === undefined) delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    else Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: originalMediaRecorder })
    if (originalWindowMediaRecorder === undefined) delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
    else Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: originalWindowMediaRecorder })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices
    })
  }
}

let restoreMockVoiceRecorder: (() => void) | undefined

describe('AppShell', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    restoreMockVoiceRecorder = installMockVoiceRecorder()
    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetKubernetesCatalogMock?.()
    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    ;(globalThis as any).__resetDatabaseTableRowsMock?.()
    ;(globalThis as any).__resetExtensionPluginStoreMock?.()
    ;(globalThis as any).__resetFileEntriesMock?.()
    ;(globalThis as any).__resetChatHistoryStoreMock?.()
    ;(globalThis as any).__resetAiTodoSnapshotMock?.()
    ;(globalThis as any).__resetUserAccountStoreMock?.()
    ;(globalThis as any).__resetMcpStoreMock?.()
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreMockVoiceRecorder?.()
    restoreMockVoiceRecorder = undefined
    shortcutRuntime.destroy()
  })

  it('renders primary product surfaces', async () => {
    const wrapper = mount(AppShell, {
      global: {
        plugins: [createPinia()],
        stubs: {
          teleport: true
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('aiopsterm')
    expect(wrapper.text()).toContain('直接连接')
    expect(wrapper.text()).toContain('堡垒机资源')
    expect(wrapper.text()).toContain('prod-bastion')
    expect(wrapper.text()).toContain('智能助手')
    expect(wrapper.text()).toContain('local shell')
  })

  it('consumes pending aiopsterm protocol links on mount and unregisters listener', async () => {
    const stopDeepLink = vi.fn()
    vi.mocked(window.aiops.consumeDeepLinks).mockResolvedValueOnce([
      {
        url: 'aiopsterm://open/settings?section=shortcuts',
        action: 'open',
        target: 'settings',
        module: 'settings',
        settingsSection: 'shortcuts',
        acceptedAt: 1780490000000
      }
    ])
    vi.mocked(window.aiops.onDeepLink).mockReturnValueOnce(stopDeepLink)

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    const store = useWorkspaceStore()
    await flushPromises()

    expect(window.aiops.onDeepLink).toHaveBeenCalled()
    expect(window.aiops.consumeDeepLinks).toHaveBeenCalled()
    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('shortcuts')
    expect(store.topNotice).toContain('aiopsterm://')

    const listener = vi.mocked(window.aiops.onDeepLink).mock.calls.at(-1)?.[0]
    listener?.({
      url: 'aiopsterm://open/database',
      action: 'open',
      target: 'database',
      module: 'database',
      acceptedAt: 1780490000100
    })
    expect(store.activeModule).toBe('database')

    wrapper.unmount()
    expect(stopDeepLink).toHaveBeenCalled()
  })

  it('binds External reference-style configured shortcuts at runtime', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AppShell, {
      attachTo: document.body,
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    const store = useWorkspaceStore()
    await flushPromises()

    expect(store.panels).toHaveLength(1)
    expect(dispatchShortcut('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' })).toBe(true)
    expect(store.panels).toHaveLength(2)
    expect(store.activePanelId).toBe(store.panels[1].id)

    expect(store.rightPanelOpen).toBe(true)
    expect(dispatchShortcut('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(true)
    expect(store.rightPanelOpen).toBe(false)

    store.startShortcutRecording('newTerminal')
    expect(dispatchShortcut('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' })).toBe(false)
    expect(store.panels).toHaveLength(2)
    store.cancelShortcutRecording()

    store.startShortcutRecording('newTerminal')
    store.updateShortcutRecording('Ctrl+Alt+N')
    expect(await store.saveShortcutRecording()).toBe(true)
    expect(dispatchShortcut('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' })).toBe(false)
    expect(store.panels).toHaveLength(2)
    expect(dispatchShortcut('N', { ctrlKey: true, altKey: true, code: 'KeyN' })).toBe(true)
    expect(store.panels).toHaveLength(3)

    expect(dispatchShortcut('1', { altKey: true, code: 'Digit1' })).toBe(true)
    expect(store.activePanelId).toBe(store.panels[0].id)
    expect(dispatchShortcut('3', { altKey: true, code: 'Digit3' })).toBe(true)
    expect(store.activePanelId).toBe(store.panels[2].id)

    expect(dispatchShortcut('P', { ctrlKey: true, shiftKey: true, code: 'KeyP' })).toBe(true)
    expect(store.activeModule).toBe('snippets')
    expect(store.leftPanelOpen).toBe(true)

    wrapper.unmount()
  })

  it('matches External reference-style top layout controls for modes, sidebars, update badge, and window controls', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(TopBar, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await wrapper.vm.$nextTick()

    expect(wrapper.attributes('data-onboarding-id')).toBe('top-layout-controls')
    expect(wrapper.findAll('.mode-button')).toHaveLength(1)
    expect(wrapper.find('.right-ai-toggle').attributes('data-onboarding-id')).toBe('right-ai-toggle')
    expect(wrapper.text()).toContain('本地版本')

    await wrapper.find('.mode-button').trigger('click')
    expect(store.mode).toBe('agents')
    expect(wrapper.find('.right-ai-toggle').exists()).toBe(false)

    await wrapper.find('.layout-toggle').trigger('click')
    expect(store.agentsLeftOpen).toBe(false)

    await wrapper.find('.mode-button').trigger('click')
    expect(store.mode).toBe('terminal')
    await wrapper.find('.right-ai-toggle').trigger('click')
    expect(store.rightPanelOpen).toBe(false)

    await wrapper.find('.window-control-button').trigger('click')
    expect(window.aiops.minimizeWindow).toHaveBeenCalled()
  })

  it('follows External reference-style asset management navigation and filters knowledge documents', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mount(AssetsPanel, {
      props: { query: 'mysql' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()
    expect(assets.text()).toContain('主机管理')
    expect(assets.text()).toContain('密钥管理')

    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    expect(assets.text()).toContain('mysql-primary')

    await assets.find('.asset-search-input input').setValue('mysql')
    expect(assets.text()).toContain('mysql-primary')
    expect(assets.text()).not.toContain('prod-bastion')
    await assets.find('.asset-search-clear').trigger('click')
    expect((assets.find('.asset-search-input input').element as HTMLInputElement).value).toBe('')

    await assets.find('[data-testid="asset-new-host-button"]').trigger('click')
    expect(assets.text()).toContain('新建主机')
    expect(assets.text()).toContain('暂无 SSH 代理配置')
    expect(assets.text()).toContain('去设置代理')
    expect(assets.find('[data-testid="asset-proxy-select"]').exists()).toBe(false)
    expect(assets.text()).not.toContain('prod-proxy')
    expect(assets.text()).not.toContain('office-proxy')
    let assetFormInputs = assets.findAll('.asset-form-panel input')
    await assetFormInputs.at(0)!.setValue('unit-host')
    await assetFormInputs.at(1)!.setValue('10.10.10.10')
    await assetFormInputs.at(2)!.setValue('ops')
    await assetFormInputs.at(4)!.setValue('测试')
    await assetFormInputs.at(5)!.setValue('2222')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).toHaveBeenCalledWith(expect.not.objectContaining({ id: expect.stringMatching(/^asset-local-/) }))
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
    expect(assets.text()).toContain('unit-host')

    vi.mocked(window.aiops.createTerminal).mockClear()
    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.trigger('dblclick')
    await flushPromises()
    expect(store.activePanel.title).toBe('unit-host')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.10.10.10:2222')
    expect(store.activePanel.outputSegments).toEqual([])
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', title: 'unit-host' }))
    expect(store.activePanel.sshSession).toEqual(expect.objectContaining({ host: '10.10.10.10', port: 2222, username: 'ops' }))

    vi.mocked(window.aiops.createTerminal).mockRejectedValueOnce(new Error('unit ssh refused'))
    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.trigger('dblclick')
    await flushPromises()
    expect(store.activePanel.title).toBe('unit-host')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.10.10.10:2222')
    expect(store.activePanel.output).not.toContain('[aiopsterm] SSH launch failed')
    expect(assets.text()).toContain('unit ssh refused')

    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.find('button[title="删除"]').trigger('click')
    expect(assets.find('.asset-confirm-modal').text()).toContain('删除主机')
    expect(assets.find('.asset-confirm-modal footer .danger').attributes('disabled')).toBeDefined()
    await assets.find('.asset-confirm-modal input').setValue('unit-host')
    await assets.find('.asset-confirm-modal footer .danger').trigger('click')
    await flushPromises()
    expect(assets.findAll('.host-card').some((card) => card.text().includes('unit-host'))).toBe(false)

    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    expect(assets.find('.export-assets-modal').text()).toContain('选择导出主机')
    expect(assets.find('.export-assets-modal footer button:last-child').attributes('disabled')).toBeDefined()
    await assets.find('.export-assets-modal .export-leaf-row input').setValue(true)
    await assets.find('.export-assets-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(assets.find('.export-assets-modal').exists()).toBe(false)

    store.startOnboardingTour('addAndConnectHost')
    store.jumpOnboardingStep('form-fields')
    await assets.vm.$nextTick()
    await flushPromises()
    expect((assets.find('.asset-form-panel input').element as HTMLInputElement).value).toBe('')
    expect(assets.text()).not.toContain('onboarding-demo')
    expect(assets.find('[data-onboarding-id="asset-form-fields"]').exists()).toBe(true)
    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(assets.text()).toContain('请填写地址、用户名和有效端口。')
    expect(store.onboardingActiveStep?.id).toBe('form-fields')
    assetFormInputs = assets.findAll('.asset-form-panel input')
    await assetFormInputs.at(0)!.setValue('onboarding-unit')
    await assetFormInputs.at(1)!.setValue('10.60.0.7')
    await assetFormInputs.at(2)!.setValue('ops')
    await assetFormInputs.at(5)!.setValue('22')
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ host: '10.60.0.7', username: 'ops' }))
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
    expect(store.onboardingActiveStep?.id).toBe('connect-asset')

    const keys = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await keys.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
    expect(keys.text()).toContain('prod-ed25519')
    await keys.find('[data-testid="key-new-button"]').trigger('click')
    expect(keys.text()).toContain('新建密钥')
    await keys.find('.key-form-panel input').setValue('unit-key')
    await keys.find('.key-form-panel .asset-submit-button').trigger('click')
    expect(keys.text()).toContain('请输入私钥')
    await keys.find('.key-form-panel textarea').setValue('-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----')
    await keys.find('.key-form-panel .asset-submit-button').trigger('click')
    await flushPromises()
    expect(window.aiops.saveKeychain).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'unit-key',
        type: 'ed25519'
      })
    )
    expect(keys.text()).toContain('unit-key')
    expect(keys.findAll('.keychain-card').find((button) => button.text().includes('unit-key'))!.text()).toContain('类型ed25519')

    await keys.find('[data-testid="key-new-button"]').trigger('click')
    await keys.find('.key-form-panel input').setValue('prod-ed25519')
    await keys.find('.key-form-panel textarea').setValue('-----BEGIN RSA PRIVATE KEY-----')
    await keys.find('.key-form-panel .asset-submit-button').trigger('click')
    expect(keys.text()).toContain('密钥 prod-ed25519 已存在')

    const originalKeyFileReader = window.FileReader
    const originalGlobalKeyFileReader = globalThis.FileReader
    class ForbiddenKeyFileReader {
      constructor() {
        throw new Error('renderer FileReader must not read key import files')
      }
    }
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: ForbiddenKeyFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: ForbiddenKeyFileReader })

    try {
      await keys.find('[data-testid="key-new-button"]').trigger('click')
      await keys.find('.key-form-panel input').setValue('import-unit')
      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.readLocalFile).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/unit-rsa.pem'] })
      await keys.find('.key-drop-area').trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['openFile'],
          filters: expect.arrayContaining([expect.objectContaining({ name: 'Key Files' })])
        })
      )
      expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/unit-rsa.pem')
      expect(keys.text()).toContain('已导入 unit-rsa.pem，识别为 RSA')
      await keys.find('.key-form-panel .asset-submit-button').trigger('click')
      await flushPromises()
      expect(keys.findAll('.keychain-card').find((button) => button.text().includes('import-unit'))!.text()).toContain('类型rsa')

      await keys.find('[data-testid="key-new-button"]').trigger('click')
      await flushPromises()
      await keys.find('.key-form-panel input').setValue('drop-unit')
      vi.mocked(window.aiops.getPathForFile).mockClear()
      vi.mocked(window.aiops.readLocalFile).mockClear()
      const droppedKeyFile = new File(['ignored-renderer-bytes'], 'drop-ed25519.key', { type: 'text/plain' })
      Object.defineProperty(droppedKeyFile, 'path', { configurable: true, value: '/tmp/drop-ed25519.key' })
      await keys.find('.key-drop-area').trigger('drop', {
        dataTransfer: {
          files: [droppedKeyFile]
        }
      })
      await flushPromises()
      expect(window.aiops.getPathForFile).toHaveBeenCalledWith(droppedKeyFile)
      expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/drop-ed25519.key')
      expect(keys.text()).toContain('已导入 drop-ed25519.key，识别为 ED25519')
      await keys.find('.key-form-panel .asset-submit-button').trigger('click')
      await flushPromises()
      expect(keys.findAll('.keychain-card').find((button) => button.text().includes('drop-unit'))!.text()).toContain('类型ed25519')
    } finally {
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalKeyFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalKeyFileReader })
    }

    await keys.findAll('.keychain-card').find((button) => button.text().includes('unit-key'))!.trigger('contextmenu', {
      clientX: 310,
      clientY: 210
    })
    expect(keys.find('.asset-context-menu').text()).toContain('删除')
    await keys.find('.asset-context-menu').get('button').trigger('click')
    await flushPromises()
    expect(window.aiops.getKeychain).toHaveBeenCalledWith(expect.stringMatching(/^key-test-/))
    await keys.find('.key-form-panel button[title="关闭"]').trigger('click')
    await keys.findAll('.keychain-card').find((button) => button.text().includes('unit-key'))!.trigger('contextmenu', {
      clientX: 310,
      clientY: 210
    })
    await keys.find('.asset-context-menu .delete').trigger('click')
    expect(keys.find('.asset-confirm-modal').text()).toContain('删除密钥')
    await keys.find('.asset-confirm-modal input').setValue('unit-key')
    await keys.find('.asset-confirm-modal footer .danger').trigger('click')
    await flushPromises()
    expect(window.aiops.deleteKeychain).toHaveBeenCalled()
    expect(keys.text()).not.toContain('unit-key')

    const knowledge = mount(KnowledgePanel, {
      props: { query: 'Markdown' },
      global: { plugins: [createPinia()] }
    })
    await flushPromises()
    await knowledge.vm.$nextTick()
    expect(knowledge.text()).toContain('Markdown语法指南.md')
    expect(knowledge.text()).not.toContain('interface.png')
  })

  it('does not fabricate Key Management state when keychain bridges are unavailable', async () => {
    const originalAiops = {
      listKeychains: window.aiops.listKeychains,
      getKeychain: window.aiops.getKeychain,
      saveKeychain: window.aiops.saveKeychain,
      deleteKeychain: window.aiops.deleteKeychain
    }
    const mountKeysPanel = async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mount(AssetsPanel, {
        props: { query: '' },
        global: { plugins: [pinia] }
      })
      await flushPromises()
      await wrapper.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
      await flushPromises()
      return wrapper
    }

    try {
      ;(window.aiops as any).listKeychains = undefined
      const listMissing = await mountKeysPanel()
      expect(listMissing.text()).toContain('密钥列表服务不可用')
      expect(listMissing.text()).not.toContain('prod-ed25519')
      listMissing.unmount()

      ;(window.aiops as any).listKeychains = originalAiops.listKeychains
      ;(window.aiops as any).getKeychain = undefined
      const detailMissing = await mountKeysPanel()
      await detailMissing.findAll('.keychain-card').find((button) => button.text().includes('prod-ed25519'))!.find('button[title="编辑"]').trigger('click')
      await flushPromises()
      expect(detailMissing.text()).toContain('密钥详情服务不可用')
      expect(detailMissing.find('.key-form-panel').exists()).toBe(false)
      detailMissing.unmount()

      ;(window.aiops as any).getKeychain = originalAiops.getKeychain
      ;(window.aiops as any).saveKeychain = undefined
      const saveMissing = await mountKeysPanel()
      await saveMissing.find('[data-testid="key-new-button"]').trigger('click')
      await saveMissing.find('.key-form-panel input').setValue('bridge-missing-key')
      await saveMissing.find('.key-form-panel textarea').setValue('-----BEGIN RSA PRIVATE KEY-----')
      await saveMissing.find('.key-form-panel .asset-submit-button').trigger('click')
      await flushPromises()
      expect(saveMissing.text()).toContain('密钥保存服务不可用')
      expect(saveMissing.findAll('.keychain-card').some((button) => button.text().includes('bridge-missing-key'))).toBe(false)
      saveMissing.unmount()

      ;(window.aiops as any).saveKeychain = originalAiops.saveKeychain
      ;(window.aiops as any).deleteKeychain = undefined
      const deleteMissing = await mountKeysPanel()
      await deleteMissing.findAll('.keychain-card').find((button) => button.text().includes('prod-ed25519'))!.find('button[title="删除"]').trigger('click')
      await deleteMissing.find('.asset-confirm-modal input').setValue('prod-ed25519')
      await deleteMissing.find('.asset-confirm-modal footer .danger').trigger('click')
      await flushPromises()
      expect(deleteMissing.text()).toContain('密钥删除服务不可用')
      expect(deleteMissing.findAll('.keychain-card').some((button) => button.text().includes('prod-ed25519'))).toBe(true)
      deleteMissing.unmount()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not import key files without preload dialog, path, or read bridges', async () => {
    const originalAiops = {
      showOpenDialog: window.aiops.showOpenDialog,
      readLocalFile: window.aiops.readLocalFile,
      getPathForFile: window.aiops.getPathForFile
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const keys = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await keys.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
    await keys.find('[data-testid="key-new-button"]').trigger('click')
    await keys.find('.key-form-panel input').setValue('bridge-import-key')
    const privateKeyField = () => keys.find('.key-form-panel textarea').element as HTMLTextAreaElement

    try {
      vi.mocked(window.aiops.readLocalFile).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await keys.find('.key-drop-area').trigger('click')
      await flushPromises()
      expect(keys.text()).toContain('密钥文件选择服务不可用。')
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(privateKeyField().value).toBe('')

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      ;(window.aiops as any).readLocalFile = undefined
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/unit-rsa.pem'] })
      await keys.find('.key-drop-area').trigger('click')
      await flushPromises()
      expect(keys.text()).toContain('密钥文件读取服务不可用。')
      expect(privateKeyField().value).toBe('')

      ;(window.aiops as any).readLocalFile = originalAiops.readLocalFile
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/unit-rsa.pem'] })
      vi.mocked(window.aiops.readLocalFile).mockRejectedValueOnce(new Error('key disk denied'))
      await keys.find('.key-drop-area').trigger('click')
      await flushPromises()
      expect(keys.text()).toContain('key disk denied')
      expect(privateKeyField().value).toBe('')

      vi.mocked(window.aiops.getPathForFile).mockReturnValueOnce('')
      vi.mocked(window.aiops.readLocalFile).mockClear()
      await keys.find('.key-drop-area').trigger('drop', {
        dataTransfer: {
          files: [new File(['renderer-bytes-must-not-be-read'], 'missing-path.pem', { type: 'text/plain' })]
        }
      })
      await flushPromises()
      expect(keys.text()).toContain('拖拽导入需要本地文件路径。')
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(privateKeyField().value).toBe('')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('supports External reference-style asset import/export and organization asset table management', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/assets-export.json' })

    const assets = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(assets.text()).toContain('组织资产管理')
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person', 'switch'] })

    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    await assets.findAll('.export-assets-modal .export-leaf-row').find((row) => row.text().includes('prod-bastion'))!.find('input').setValue(true)
    await assets.find('.export-assets-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^external-reference-assets-\d{4}-\d{2}-\d{2}\.json$/)
      })
    )
    const exportCall = vi.mocked(window.aiops.writeLocalFile).mock.calls.at(-1)
    expect(exportCall?.[0]).toBe('/tmp/assets-export.json')
    expect(JSON.parse(String(exportCall?.[1]))).toEqual([
      expect.objectContaining({
        username: 'ops',
        ip: '10.24.8.12',
        label: 'prod-bastion',
        group_name: '生产',
        auth_type: 'keyBased',
        port: 22
      })
    ])
    expect(assets.find('.export-assets-modal').exists()).toBe(false)

    const originalFileReader = window.FileReader
    const originalGlobalFileReader = globalThis.FileReader
    class ForbiddenAssetImportFileReader {
      constructor() {
        throw new Error('renderer FileReader must not read asset import files')
      }
    }
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: ForbiddenAssetImportFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: ForbiddenAssetImportFileReader })
    try {
      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.readLocalFile).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['openFile'],
          filters: expect.arrayContaining([expect.objectContaining({ name: 'Asset Import Files' })])
        })
      )
      expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/external-reference-assets.json')
      expect(assets.find('.import-assets-modal').text()).toContain('其中 1 个与现有主机重复')
      expect(assets.find('.import-assets-modal').text()).toContain('imported-json')
      vi.mocked(window.aiops.saveAsset).mockClear()
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('跳过重复'))!.trigger('click')
      await flushPromises()
      expect(vi.mocked(window.aiops.saveAsset).mock.calls).toEqual([
        [expect.objectContaining({ host: '10.55.0.9' })]
      ])
      expect(vi.mocked(window.aiops.saveAsset).mock.calls[0]?.[0]).not.toHaveProperty('id')
      expect(assets.text()).toContain('imported-json')
      expect(assets.findAll('.host-card').some((card) => card.text().includes('prod-bastion-imported'))).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.readLocalFile).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/MobaXterm.mxtsessions'] })
      await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/MobaXterm.mxtsessions')
      expect(assets.find('.import-assets-modal').text()).toContain('moba-prod')
      expect(assets.find('.import-assets-modal').text()).toContain('10.88.1.5')
      vi.mocked(window.aiops.saveAsset).mockClear()
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
      expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
      expect(assets.text()).toContain('moba-prod')
      expect(assets.text()).toContain('mobauser')
    } finally {
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })
    }

    const managed = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await managed.findAll('.asset-management-item').find((button) => button.text().includes('组织资产管理'))!.trigger('click')
    expect(managed.text()).toContain('全部组织资产')
    expect(managed.find('.asset-table-footer').text()).toContain('共 6 条')
    expect(managed.text()).not.toContain('127.0.0.1')
    vi.mocked(window.aiops.refreshOrganizationAssets).mockClear()
    await managed.find('.asset-table-toolbar button[title="刷新"]').trigger('click')
    await flushPromises()
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith(undefined)
    expect(managed.text()).toContain('jumpserver-org-synced-asset')
    await managed.find('.asset-table-toolbar .asset-search-input input').setValue('mysql')
    expect(managed.text()).toContain('mysql-primary')
    expect(managed.text()).not.toContain('prod-bastion')
    await managed.find('.asset-search-clear').trigger('click')
    await managed.findAll('.asset-table-toolbar .asset-action-button').find((button) => button.text().includes('添加资产'))!.trigger('click')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await managed.find('.managed-asset-form .asset-submit-button').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(managed.text()).toContain('请填写主机 IP。')
    await managed.findAll('.managed-asset-form input').at(0)!.setValue('managed-unit')
    await managed.findAll('.managed-asset-form input').at(1)!.setValue('10.77.0.7')
    await managed.find('.managed-asset-form textarea').setValue('手动组织资产')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await managed.find('.managed-asset-form .asset-submit-button').trigger('click')
    const managedAddPayload = vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]
    expect(managedAddPayload).not.toHaveProperty('id')
    expect(managedAddPayload).toEqual(expect.objectContaining({ host: '10.77.0.7', title: 'managed-unit' }))
    expect(managedAddPayload).not.toHaveProperty('username')
    expect(managedAddPayload).not.toHaveProperty('port')
    expect(managed.text()).toContain('managed-unit')
    await managed.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('managed-unit'))!.find('input[type="checkbox"]').setValue(true)
    await managed.findAll('.asset-table-toolbar .asset-action-button').find((button) => button.text().includes('批量删除'))!.trigger('click')
    expect(managed.find('.asset-confirm-modal').text()).toContain('批量删除主机')
    await managed.find('.asset-confirm-modal footer .danger').trigger('click')
    await flushPromises()
    expect(managed.text()).not.toContain('managed-unit')

    const organization = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await organization.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await organization.findAll('.host-card').find((button) => button.text().includes('jumpserver-org'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    vi.mocked(window.aiops.refreshOrganizationAssets).mockClear()
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('刷新资产'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: 'asset-5' })
    expect(organization.text()).toContain('jumpserver-org-synced-asset')
    await organization.findAll('.host-card').find((button) => button.text().includes('jumpserver-org'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('管理资产'))!.trigger('click')
    await flushPromises()
    expect(organization.text()).toContain('管理资产 · jumpserver-org')
    await organization.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('jumpserver-org-synced-asset'))!.findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    expect((organization.findAll('.managed-asset-form input').at(0)!.element as HTMLInputElement).disabled).toBe(true)
    expect((organization.findAll('.managed-asset-form input').at(1)!.element as HTMLInputElement).disabled).toBe(true)
    await organization.find('.managed-asset-form textarea').setValue('刷新备注')
    await organization.find('.managed-asset-form .asset-submit-button').trigger('click')
    expect(organization.text()).toContain('刷新备注')
  })

  it('uses backend-confirmed SSH proxy configs in the asset host form', async () => {
    const releaseProxy = {
      name: 'release-proxy',
      type: 'SOCKS5' as const,
      host: '10.0.0.8',
      port: 1080,
      enableProxyIdentity: true,
      username: 'ops',
      password: 'secret'
    }
    const baseConfig = await window.aiops.getConfig()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      ...baseConfig,
      sshProxyConfigs: [releaseProxy]
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.hydrateConfig()

    const assets = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await assets.find('[data-testid="asset-new-host-button"]').trigger('click')
    await assets.vm.$nextTick()

    const proxySelect = assets.find('[data-testid="asset-proxy-select"]')
    expect(proxySelect.exists()).toBe(true)
    expect(proxySelect.text()).toContain('release-proxy')
    expect(proxySelect.text()).not.toContain('prod-proxy')
    expect(proxySelect.text()).not.toContain('office-proxy')
    await proxySelect.setValue('release-proxy')

    const assetFormInputs = assets.findAll('.asset-form-panel input')
    await assetFormInputs.at(0)!.setValue('proxy-unit')
    await assetFormInputs.at(1)!.setValue('10.70.0.7')
    await assetFormInputs.at(2)!.setValue('ops')
    await assetFormInputs.at(5)!.setValue('2222')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()

    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        host: '10.70.0.7',
        username: 'ops',
        needProxy: true,
        proxyName: 'release-proxy'
      })
    )
    expect(assets.text()).toContain('proxy-unit')
  })

  it('opens Terminal proxy settings when the asset form has no SSH proxy configs', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()

    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await assets.find('[data-testid="asset-new-host-button"]').trigger('click')
    await assets.find('.asset-proxy-empty button').trigger('click')

    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('terminal')
    expect(store.sshProxyConfigModalOpen).toBe(true)
    expect(store.sshProxyAddModalOpen).toBe(true)
  })

  it('does not fabricate the Workspace local shell row when the backend snapshot omits it', async () => {
    const snapshot = await window.aiops.listAssets()
    vi.mocked(window.aiops.listAssets).mockResolvedValueOnce({
      assets: snapshot.assets.filter((asset) => !asset.isLocalShell),
      folders: snapshot.folders
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WorkspacePanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('本地连接')
    expect(wrapper.findAll('.workspace-host-row').some((row) => row.text().includes('127.0.0.1'))).toBe(false)
  })

  it('does not fabricate Assets export success when save or file write bridges are unavailable or fail', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    await assets.findAll('.export-assets-modal .export-leaf-row').find((row) => row.text().includes('prod-bastion'))!.find('input').setValue(true)

    const originalAiops = {
      showSaveDialog: window.aiops.showSaveDialog,
      writeLocalFile: window.aiops.writeLocalFile
    }

    try {
      ;(window.aiops as any).showSaveDialog = undefined
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导出保存对话框服务不可用')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)
      expect(window.aiops.writeLocalFile).not.toHaveBeenCalled()

      ;(window.aiops as any).showSaveDialog = originalAiops.showSaveDialog
      ;(window.aiops as any).writeLocalFile = undefined
      vi.mocked(window.aiops.showSaveDialog!).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/assets-export-missing-write.json' })
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导出文件写入服务不可用')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)

      ;(window.aiops as any).writeLocalFile = originalAiops.writeLocalFile
      vi.mocked(window.aiops.showSaveDialog!).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/assets-export-write-failed.json' })
      vi.mocked(window.aiops.writeLocalFile!).mockRejectedValueOnce(new Error('disk full'))
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导出文件写入失败')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)
      expect(assets.text()).not.toContain('已导出 1 个主机')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Assets import preview when file picker or read bridges fail', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    const importButton = () => assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!
    const originalAiops = {
      showOpenDialog: window.aiops.showOpenDialog,
      readLocalFile: window.aiops.readLocalFile
    }

    try {
      vi.mocked(window.aiops.readLocalFile).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导入文件选择服务不可用。')
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      ;(window.aiops as any).readLocalFile = undefined
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导入文件读取服务不可用。')
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      ;(window.aiops as any).readLocalFile = originalAiops.readLocalFile
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      vi.mocked(window.aiops.readLocalFile).mockRejectedValueOnce(new Error('asset read denied'))
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('asset read denied')
      expect(assets.find('.import-assets-modal').exists()).toBe(false)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Workspace host favorite, comment, or tunnel state before asset writes succeed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WorkspacePanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()

    const hostRow = (name: string) => {
      const row = wrapper.findAll('.workspace-host-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace host row not found: ${name}`)
      return row
    }
    const contextButton = (label: string) => {
      const button = wrapper.find('.workspace-node-menu').findAll('button').find((item) => item.text().includes(label))
      if (!button) throw new Error(`Workspace context button not found: ${label}`)
      return button
    }

    await hostRow('prod-bastion').trigger('contextmenu')
    expect(wrapper.find('.workspace-node-menu').text()).toContain('取消收藏')
    vi.mocked(window.aiops.saveAsset).mockRejectedValueOnce(new Error('asset write offline'))
    await contextButton('取消收藏').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('asset write offline')
    await hostRow('prod-bastion').trigger('contextmenu')
    expect(wrapper.find('.workspace-node-menu').text()).toContain('取消收藏')
    await contextButton('取消收藏').trigger('click')
    await flushPromises()
    await hostRow('prod-bastion').trigger('contextmenu')
    expect(wrapper.find('.workspace-node-menu').text()).toContain('加入收藏')

    await hostRow('staging-api').trigger('contextmenu')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')
    vi.mocked(window.aiops.saveAsset).mockClear()
    vi.mocked(window.aiops.stopSshTunnel).mockClear()
    const originalStopSshTunnel = window.aiops.stopSshTunnel
    ;(window.aiops as any).stopSshTunnel = undefined
    await contextButton('隧道').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(originalStopSshTunnel).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('隧道运行时服务不可用')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')
    ;(window.aiops as any).stopSshTunnel = originalStopSshTunnel

    await hostRow('staging-api').trigger('contextmenu')
    vi.mocked(window.aiops.stopSshTunnel).mockResolvedValueOnce({ ok: false, errorCode: 'SSH_TUNNEL_STOP_FAILED', errorMessage: 'tunnel daemon offline' })
    await contextButton('隧道').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(window.aiops.stopSshTunnel).toHaveBeenCalledWith({ assetId: 'asset-2' })
    expect(wrapper.text()).toContain('tunnel daemon offline')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')

    await hostRow('staging-api').trigger('contextmenu')
    await contextButton('隧道').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('隧道已停止 staging-api')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已创建')

    vi.mocked(window.aiops.startSshTunnel).mockClear()
    await hostRow('staging-api').trigger('contextmenu')
    await contextButton('隧道').trigger('click')
    await flushPromises()
    expect(window.aiops.startSshTunnel).toHaveBeenCalledWith({ assetId: 'asset-2' })
    expect(wrapper.text()).toContain('隧道已连接 staging-api')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')

    await wrapper.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
    await hostRow('prod-bastion').trigger('contextmenu')
    await contextButton('编辑备注').trigger('click')
    await wrapper.find('.workspace-comment-edit input').setValue('失败备注')
    vi.mocked(window.aiops.saveAsset).mockRejectedValueOnce(new Error('comment write offline'))
    await wrapper.find('.workspace-comment-edit input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.text()).toContain('comment write offline')
    expect(wrapper.find('.workspace-comment-edit').exists()).toBe(true)
    await wrapper.find('.workspace-comment-edit input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.text()).toContain('(生产入口)')
    expect(wrapper.text()).not.toContain('(失败备注)')
    await hostRow('prod-bastion').trigger('contextmenu')
    await contextButton('编辑备注').trigger('click')
    await wrapper.find('.workspace-comment-edit input').setValue('后端备注')
    await wrapper.find('.workspace-comment-edit input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('.workspace-comment-edit').exists()).toBe(false)
    expect(wrapper.text()).toContain('(后端备注)')
  })

  it('does not visually commit Workspace and Files resource tree preferences before config saves return matching snapshots', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WorkspacePanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()
    const savedPreferences = () => ({
      showIpMode: store.workspacePreferences.showIpMode,
      expandedGroups: [...store.workspacePreferences.expandedGroups]
    })
    const rejectNextPreferenceSave = () => {
      vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
        ...store.config,
        workspacePreferences: savedPreferences()
      })
    }

    rejectNextPreferenceSave()
    await wrapper.find('.workspace-button[title="显示 IP"]').trigger('click')
    await flushPromises()
    expect(store.topNotice).toBe('资源树偏好保存失败')
    expect(store.workspacePreferences.showIpMode).toBe(false)
    expect(wrapper.find('.workspace-button').attributes('title')).toBe('显示 IP')
    expect(wrapper.text()).toContain('prod-bastion')
    expect(wrapper.text()).not.toContain('10.24.8.12')

    await wrapper.find('.workspace-button[title="显示 IP"]').trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.showIpMode).toBe(true)
    expect(wrapper.find('.workspace-button').attributes('title')).toBe('显示主机名')
    expect(wrapper.text()).toContain('10.24.8.12')

    const filesPanel = mount(FilesPanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()
    expect(filesPanel.find('.workspace-button').attributes('title')).toBe('显示主机名')
    expect(filesPanel.text()).toContain('10.24.8.12')

    rejectNextPreferenceSave()
    await filesPanel.find('.workspace-button[title="显示主机名"]').trigger('click')
    await flushPromises()
    expect(store.topNotice).toBe('资源树偏好保存失败')
    expect(store.workspacePreferences.showIpMode).toBe(true)
    expect(filesPanel.find('.workspace-button').attributes('title')).toBe('显示主机名')
    expect(filesPanel.text()).toContain('10.24.8.12')

    await filesPanel.find('.workspace-button[title="显示主机名"]').trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.showIpMode).toBe(false)
    expect(filesPanel.find('.workspace-button').attributes('title')).toBe('显示 IP')
    expect(filesPanel.text()).toContain('prod-bastion')

    rejectNextPreferenceSave()
    await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.expandedGroups).toContain('recent_connections')
    expect(filesPanel.text()).toContain('prod-bastion')

    await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.expandedGroups).not.toContain('recent_connections')
    expect(filesPanel.text()).not.toContain('prod-bastion')
    filesPanel.unmount()
  })

  it('matches External reference-style SSH resource tree tabs, display toggle, refresh, and context actions', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WorkspacePanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()

    try {
      expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person', 'switch'] })
      expect(wrapper.text()).toContain('直接连接')
      expect(wrapper.text()).toContain('堡垒机资源')
      expect(wrapper.text()).toContain('最近连接')
      expect(wrapper.text()).toContain('本地连接')
      expect(wrapper.text()).toContain('prod-bastion')

      await wrapper.find('.workspace-search input').setValue('mysql')
      expect(wrapper.text()).toContain('mysql-primary')
      expect(wrapper.text()).not.toContain('staging-api')
      await wrapper.find('.workspace-search input').setValue('')

      await wrapper.find('.workspace-button[title="显示 IP"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('10.24.8.12')
      expect(store.workspacePreferences.showIpMode).toBe(true)
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({ showIpMode: true })
        })
      )

      const filesPanel = mount(FilesPanel, {
        global: { plugins: [pinia] }
      })
      await flushPromises()
      expect(filesPanel.find('.workspace-button').attributes('title')).toBe('显示主机名')
      expect(filesPanel.text()).toContain('10.24.8.12')

      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
      await flushPromises()
      expect(store.workspacePreferences.expandedGroups).not.toContain('recent_connections')
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({
            expandedGroups: expect.not.arrayContaining(['recent_connections'])
          })
        })
      )
      const remounted = mount(WorkspacePanel, {
        global: { plugins: [pinia] }
      })
      await flushPromises()
      expect(remounted.text()).not.toContain('prod-bastion')
      remounted.unmount()

      await filesPanel.vm.$nextTick()
      expect(filesPanel.text()).not.toContain('10.24.8.12')
      expect(filesPanel.text()).not.toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
      await flushPromises()
      expect(store.workspacePreferences.expandedGroups).toContain('recent_connections')
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({
            expandedGroups: expect.arrayContaining(['recent_connections'])
          })
        })
      )
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('10.24.8.12')

      await filesPanel.find('.workspace-button[title="显示主机名"]').trigger('click')
      await flushPromises()
      expect(store.workspacePreferences.showIpMode).toBe(false)
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({ showIpMode: false })
        })
      )
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('prod-bastion')
      expect(wrapper.text()).not.toContain('10.24.8.12')

      const localRow = wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('127.0.0.1'))!
      await localRow.trigger('contextmenu', {
        clientX: 260,
        clientY: 180
      })
      const localMenuText = wrapper.find('.workspace-node-menu').text()
      expect(localMenuText).toContain('连接')
      expect(localMenuText).not.toContain('编辑')
      expect(localMenuText).not.toContain('克隆')
      expect(localMenuText).not.toContain('删除')

      vi.mocked(window.aiops.createTerminal).mockClear()
      await localRow.trigger('dblclick')
      await flushPromises()
      expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', title: '127.0.0.1' }))
      expect(store.activePanel.sessionId).toBe('test-session-local')
      expect(store.activePanel.title).toBe('127.0.0.1')
      expect(store.activePanel.status).toBe('running')
      expect(store.activePanel.sshSession).toBeUndefined()
      expect(store.activePanel.output).not.toContain('[aiopsterm] open local shell from Workspace')
      expect(wrapper.text()).toContain('已打开本地 shell 127.0.0.1')

      await wrapper.find('.workspace-button[title="主机"]').trigger('click')
      expect(wrapper.find('.workspace-host-modal').text()).toContain('新建主机')
      await wrapper.find('.workspace-host-form').trigger('submit')
      expect(wrapper.text()).toContain('请填写主机名、地址和用户名')
      await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('workspace-unit')
      await wrapper.findAll('.workspace-host-form input').at(1)!.setValue('10.44.0.9')
      await wrapper.findAll('.workspace-host-form input').at(2)!.setValue('ops')
      await wrapper.findAll('.workspace-host-form input').at(3)!.setValue('')
      await wrapper.findAll('.workspace-host-form input').at(4)!.setValue('Workspace')
      await wrapper.findAll('.workspace-host-form input').at(5)!.setValue('2201')
      await wrapper.find('.workspace-host-form textarea').setValue('工作区新增主机')
      vi.mocked(window.aiops.saveAsset).mockClear()
      await wrapper.find('.workspace-host-form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('.workspace-host-modal').exists()).toBe(false)
      expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
      expect(wrapper.text()).toContain('workspace-unit')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit'))!.trigger('contextmenu', {
        clientX: 300,
        clientY: 200
      })
      expect(wrapper.find('.workspace-node-menu').text()).toContain('克隆')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
      expect(wrapper.find('.workspace-host-modal').text()).toContain('编辑主机')
      await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('workspace-unit-edited')
      await wrapper.find('.workspace-host-form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain('workspace-unit-edited')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited'))!.trigger('contextmenu')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('克隆'))!.trigger('click')
      expect((wrapper.findAll('.workspace-host-form input').at(0)!.element as HTMLInputElement).value).toBe('workspace-unit-edited_Clone')
      vi.mocked(window.aiops.saveAsset).mockClear()
      await wrapper.find('.workspace-host-form').trigger('submit')
      await flushPromises()
      expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
      expect(wrapper.text()).toContain('workspace-unit-edited_Clone')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited_Clone'))!.trigger('contextmenu')
      await wrapper.find('.workspace-node-menu .delete').trigger('click')
      expect(wrapper.find('.files-folder-confirm').text()).toContain('删除主机')
      await wrapper.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.workspace-host-row').some((row) => row.text().includes('workspace-unit-edited_Clone'))).toBe(false)
      vi.mocked(window.aiops.createTerminal).mockClear()
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited'))!.trigger('dblclick')
      await flushPromises()
      expect(store.activePanel.title).toBe('workspace-unit-edited')
      expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.44.0.9:2201')
      expect(store.activePanel.outputSegments).toEqual([])
      expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', title: 'workspace-unit-edited' }))
      expect(store.activePanel.sshSession).toEqual(expect.objectContaining({ host: '10.44.0.9', port: 2201, username: 'ops' }))

      vi.mocked(window.aiops.createTerminal).mockRejectedValueOnce(new Error('workspace ssh refused'))
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited'))!.trigger('dblclick')
      await flushPromises()
      expect(store.activePanel.title).toBe('workspace-unit-edited')
      expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.44.0.9:2201')
      expect(store.activePanel.output).not.toContain('[aiopsterm] SSH launch failed')
      expect(wrapper.text()).toContain('workspace ssh refused')

      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('生产'))!.trigger('contextmenu', {
        clientX: 260,
        clientY: 180
      })
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑文件夹'))!.trigger('click')
      await wrapper.find('.workspace-folder-modal .files-folder-form input').setValue('生产归档')
      vi.mocked(window.aiops.renameAssetGroup).mockClear()
      await wrapper.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      await flushPromises()
      expect(window.aiops.renameAssetGroup).toHaveBeenCalledWith({ oldName: '生产', newName: '生产归档', assetTypes: ['person', 'switch'] })
      expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('生产归档'))).toBe(true)
      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('生产归档'))!.trigger('contextmenu')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(wrapper.find('.files-folder-confirm').text()).toContain('删除分组')
      vi.mocked(window.aiops.deleteAssetGroup).mockClear()
      await wrapper.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(window.aiops.deleteAssetGroup).toHaveBeenCalledWith({ name: '生产归档', fallbackName: '未分组', assetTypes: ['person', 'switch'] })
      expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('生产归档'))).toBe(false)
      expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('未分组'))).toBe(true)

      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('Local'))!.trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu', {
        clientX: 296,
        clientY: 196
      })
      const filesContextMenu = filesPanel.find('.asset-context-menu')
      expect(filesContextMenu.exists()).toBe(true)
      expect(filesContextMenu.text()).toContain('加入收藏')
      expect(filesContextMenu.text()).toContain('编辑备注')
      expect(filesContextMenu.text()).toContain('移动到文件夹')
      expect(filesContextMenu.text()).not.toContain('左侧打开')
      expect(filesPanel.find('.files-tree-session.selected').text()).toContain('prod-bastion')
      await filesContextMenu.findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      expect(filesPanel.find('.files-comment-edit input').exists()).toBe(true)
      expect((filesPanel.find('.files-comment-edit input').element as HTMLInputElement).value).toBe('生产入口')
      await filesPanel.find('.files-comment-edit input').setValue('生产入口待确认')
      await filesPanel.find('.files-comment-edit input').trigger('keydown', { key: 'Escape' })
      expect(filesPanel.find('.files-comment-edit').exists()).toBe(false)
      expect(filesPanel.text()).toContain('(生产入口)')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      await filesPanel.find('.files-comment-edit input').setValue('新备注')
      await filesPanel.find('.files-comment-edit input').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(filesPanel.find('.files-comment-edit').exists()).toBe(false)
      expect(filesPanel.text()).toContain('(新备注)')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).not.toContain('prod-bastion')
      await filesPanel.find('.files-search input').setValue('prod')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).not.toContain('Local')
      expect(filesPanel.find('.files-tree-session').exists()).toBe(true)
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      const prodFileSession = filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!
      const dragData = new Map<string, string>()
      await prodFileSession.trigger('dragstart', {
        dataTransfer: {
          effectAllowed: '',
          setData: vi.fn((type: string, value: string) => dragData.set(type, value))
        }
      })
      expect(dragData.get('application/x-aiopsterm-file-session')).toBe('asset-1')
      expect(JSON.parse(dragData.get('application/x-asset-sftp') || '{}')).toEqual(
        expect.objectContaining({
          uuid: 'asset-1',
          ip: '10.24.8.12',
          title: 'prod-bastion',
          host: '10.24.8.12',
          port: 22,
          username: 'deploy',
          asset_type: 'person',
          proxyCommand: ''
        })
      )
      await prodFileSession.trigger('click')
      expect(filesPanel.find('.files-tree-session.selected').text()).toContain('prod-bastion')
      expect(store.selectedLeftFileSessionId).toBeNull()
      await vi.advanceTimersByTimeAsync(249)
      expect(store.selectedLeftFileSessionId).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(store.selectedLeftFileSessionId).toBe('asset-1')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(true)
      expect(filesPanel.find('.files-folder-modal').text()).toContain('核心业务')
      await filesPanel.findAll('.files-folder-option').find((button) => button.text().includes('临时排障'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(false)
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBe('files-folder-b')
      expect(filesPanel.text()).toContain('临时排障')
      const originalInnerWidth = window.innerWidth
      const originalInnerHeight = window.innerHeight
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 })
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu', {
        clientX: 310,
        clientY: 210
      })
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(true)
      expect(filesPanel.find('.asset-context-menu').attributes('style')).toContain('left: 155px')
      expect(filesPanel.find('.asset-context-menu').attributes('style')).toContain('top: 129px')
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      expect((filesPanel.find('.files-search input').element as HTMLInputElement).value).toBe('')
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      expect(filesPanel.find('.files-tree-session.selected').exists()).toBe(false)
      expect(filesPanel.text()).toContain('临时排障')
      expect(filesPanel.text()).not.toContain('prod-bastion')
      expect(filesPanel.text()).not.toContain('Local')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时排障'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('直接连接'))!.trigger('click')
      expect(filesPanel.text()).toContain('Local')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).toContain('核心业务')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('核心业务'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).toContain('staging-files')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('staging-files'))!.trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').text()).toContain('从文件夹移除')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('从文件夹移除'))!.trigger('click')
      await flushPromises()
      expect(store.fileSessions.find((session) => session.id === 'folder_asset-2')?.folderUuid).toBeUndefined()
      expect(store.fileSessions.find((session) => session.id === 'folder_asset-2')?.group).toBe('最近连接')
      expect(filesPanel.text()).toContain('最近连接')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时排障'))!.trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').text()).toContain('编辑文件夹')
      expect(filesPanel.find('.asset-context-menu').text()).toContain('删除文件夹')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('编辑文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-modal').text()).toContain('编辑文件夹')
      expect((filesPanel.find('.files-folder-form input').element as HTMLInputElement).value).toBe('临时排障')
      await filesPanel.find('.files-folder-form input').setValue('')
      await filesPanel.find('.files-folder-form').trigger('submit')
      expect(filesPanel.text()).toContain('请输入文件夹名称')
      await filesPanel.find('.files-folder-form input').setValue('临时归档')
      await filesPanel.find('.files-folder-form textarea').setValue('归档中的远程文件入口')
      await filesPanel.find('.files-folder-form').trigger('submit')
      await flushPromises()
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(false)
      expect(filesPanel.text()).toContain('临时归档')
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时归档'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('文件夹内 1 个资产将移出文件夹')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBeUndefined()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.group).toBe('最近连接')
      expect(filesPanel.text()).not.toContain('临时归档')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('核心业务'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('确定删除文件夹 核心业务')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(filesPanel.text()).not.toContain('核心业务')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-modal').text()).toContain('暂无文件夹')
      await filesPanel.find('.files-folder-empty button').trigger('click')
      expect(filesPanel.find('.files-folder-modal').text()).toContain('创建文件夹')
      await filesPanel.find('.files-folder-form input').setValue('新建文件夹')
      await filesPanel.find('.files-folder-form textarea').setValue('从移动弹窗创建')
      await filesPanel.find('.files-folder-form').trigger('submit')
      await flushPromises()
      expect(filesPanel.text()).toContain('新建文件夹')

      await wrapper.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      expect(wrapper.text()).toContain('jumpserver-org')
      await wrapper.find('.workspace-button[title="新建"]').trigger('click')
      expect(wrapper.find('.workspace-add-menu').text()).toContain('自定义文件夹')
      await wrapper.find('.workspace-add-menu').findAll('button').find((button) => button.text().includes('自定义文件夹'))!.trigger('click')
      expect(wrapper.find('.workspace-folder-modal').text()).toContain('创建文件夹')
      await wrapper.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      expect(wrapper.text()).toContain('请输入文件夹名称')
      await wrapper.find('.workspace-folder-modal .files-folder-form input').setValue('值班窗口')
      await wrapper.find('.workspace-folder-modal .files-folder-form textarea').setValue('工作区值班资产')
      await wrapper.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain('值班窗口')
      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('值班窗口'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('编辑文件夹')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑文件夹'))!.trigger('click')
      await wrapper.find('.workspace-folder-modal .files-folder-form input').setValue('值班归档')
      await wrapper.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain('值班归档')
      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('jumpserver-org'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('刷新')
      vi.mocked(window.aiops.refreshOrganizationAssets).mockClear()
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('刷新'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: 'asset-5' })
      expect(wrapper.text()).toContain('jumpserver-org 资源已刷新')
      expect(wrapper.text()).toContain('jumpserver-org-synced-asset')

      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').exists()).toBe(true)
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      expect((wrapper.find('.workspace-comment-edit input').element as HTMLInputElement).value).toBe('生产入口')
      await wrapper.find('.workspace-comment-edit input').setValue('工作区备注')
      await wrapper.find('.workspace-comment-edit input').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.text()).toContain('(工作区备注)')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('从文件夹移除')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('从文件夹移除'))!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('已从 核心业务 移除 prod-bastion')
      expect(wrapper.find('.workspace-node-menu').exists()).toBe(false)
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('移动到文件夹')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(wrapper.find('.workspace-folder-modal').text()).toContain('值班归档')
      await wrapper.findAll('.files-folder-option').find((button) => button.text().includes('值班归档'))!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('已移动 prod-bastion 到 值班归档')
      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('值班归档'))!.trigger('contextmenu')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(wrapper.find('.files-folder-confirm').text()).toContain('其中 1 个主机将移出该文件夹')
      await wrapper.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('值班归档'))).toBe(false)
      expect(wrapper.text()).toContain('prod-bastion')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('jumpserver-org'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('管理资产')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('管理资产'))!.trigger('click')
      expect(wrapper.find('.workspace-management-modal').text()).toContain('管理资产 · jumpserver-org')
      await wrapper.find('.workspace-management-modal header button').trigger('click')

      vi.mocked(window.aiops.createTerminal).mockClear()
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('dblclick')
      await flushPromises()
      expect(store.activePanel.title).toBe('prod-bastion')
      expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.24.8.12:22')
      expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', assetId: 'asset-1', title: 'prod-bastion' }))
      expect(store.activePanel.sshSession).toEqual(expect.objectContaining({ assetId: 'asset-1', host: '10.24.8.12', port: 22, username: 'ops' }))
      expect(store.selectedContexts.some((context) => context.id === 'asset-1')).toBe(true)
      filesPanel.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches External reference-style user menu and user info card interactions', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const rail = mount(SideRail, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await store.refreshUserAccount()
    await rail.vm.$nextTick()

    try {
      await rail.find('.user-rail-trigger').trigger('click')
      expect(rail.find('.user-menu-popover').exists()).toBe(true)
      expect(rail.text()).toContain('账号中心')
      expect(rail.text()).toContain('个人信息')
      expect(rail.text()).toContain('退出登录')

      await rail.findAll('.user-menu-popover button').find((button) => button.text().includes('个人信息'))!.trigger('click')
      expect(store.activeModule).toBe('user')

      const panel = mount(UserPanel, {
        global: { plugins: [pinia] }
      })
      expect(panel.text()).toContain('个人信息')
      expect(panel.text()).toContain('VIP用户')
      expect(panel.text()).toContain('Local Operator')
      expect(panel.text()).toContain('本地账号')
      expect(panel.text()).toContain('设备已验证')

      vi.mocked(window.aiops.getUserAccount).mockClear()
      await panel.find('.user-info-footer .settings-button').trigger('click')
      await flushPromises()
      await panel.vm.$nextTick()
      expect(window.aiops.getUserAccount).toHaveBeenCalled()
      expect(store.userAccountCenterOpen).toBe(true)
      expect(panel.find('.user-account-modal').text()).toContain('可信设备')
      expect(panel.find('.user-account-modal').text()).toContain('Linux Workstation')
      const accountDeviceButtons = panel.findAll('.account-device-actions button')
      expect(accountDeviceButtons[0].attributes('disabled')).toBeDefined()
      expect(accountDeviceButtons[1].attributes('disabled')).toBeUndefined()
      vi.mocked(window.aiops.revokeTrustedDevice).mockClear()
      await accountDeviceButtons[1].trigger('click')
      await panel.vm.$nextTick()
      expect(store.trustedDeviceModal.open).toBe(true)
      expect(panel.find('.user-trusted-device-confirm').text()).toContain('确认移除该可信设备')
      await panel.find('.user-trusted-device-confirm footer .primary').trigger('click')
      await flushPromises()
      expect(window.aiops.revokeTrustedDevice).toHaveBeenCalledWith(2)
      expect(panel.find('.user-account-modal').text()).not.toContain('MacBook')
      expect(store.userNotice).toBe('可信设备已移除')
      await panel.findAll('.user-account-modal footer button').at(1)!.trigger('click')
      expect(store.activeModule).toBe('settings')
      expect(store.activeSettingsSection).toBe('trustedDevices')
      expect(store.userAccountCenterOpen).toBe(false)

      await panel.find('button[title="编辑"]').trigger('click')
      await panel.findAll('.user-info-form input').at(1)!.setValue('bad-name!')
      await panel.find('button[title="保存"]').trigger('click')
      await flushPromises()
      expect(store.userNotice).toBe('用户名仅支持字母、数字和下划线')
      await panel.findAll('.user-info-form input').at(0)!.setValue('Ops Lead')
      await panel.findAll('.user-info-form input').at(1)!.setValue('ops_lead')
      await panel.find('button[title="保存"]').trigger('click')
      await flushPromises()
      expect(store.userProfile.name).toBe('Ops Lead')

      await panel.find('button[title="修改邮箱"]').trigger('click')
      await panel.find('.user-modal-card input').setValue('ops@example.local')
      await panel.find('.user-code-row button').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(120)
      await panel.vm.$nextTick()
      expect(panel.find('.user-code-row button').text()).toContain('300s')
      await panel.findAll('.user-modal-card input').at(1)!.setValue('123456')
      await panel.find('.user-modal-card footer .primary').trigger('click')
      await flushPromises()
      expect(store.userProfile.email).toBe('ops@example.local')

      await panel.find('button[title="重置密码"]').trigger('click')
      await panel.find('.user-modal-card input[type="password"]').setValue('Aa123456!')
      await panel.findAll('.user-modal-card input[type="password"]').at(1)!.setValue('Aa123456!')
      await panel.find('.user-modal-card footer .primary').trigger('click')
      await flushPromises()
      expect(store.userNotice).toBe('密码重置成功')
      expect(store.userProfile.passwordUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

      await panel.find('.user-avatar.large').trigger('click')
      expect(panel.find('.avatar-preview-placeholder').text()).toContain('点击上传头像')
      expect(panel.find('.avatar-settings-modal footer .primary').attributes('disabled')).toBeDefined()
      expect(panel.find('.avatar-settings-modal input[type="file"]').exists()).toBe(false)
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/avatar.png'] })
      vi.mocked(window.aiops.prepareUserAvatarImage).mockClear()
      await panel.find('.avatar-actions-row .settings-button').trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
      })
      expect(window.aiops.prepareUserAvatarImage).toHaveBeenCalledWith({ filePath: '/tmp/avatar.png' })
      await panel.vm.$nextTick()
      expect(panel.find('.avatar-preview-box img').exists()).toBe(true)
      expect(store.userNotice).toBe('头像图片已读取')
      await panel.find('.avatar-settings-modal footer .primary').trigger('click')
      await flushPromises()
      expect(store.userProfile.avatarImageUrl).toBe('data:image/png;base64,avatar')
      expect(store.userNotice).toBe('头像更新成功')

      await panel.find('.user-info-footer .danger').trigger('click')
      await flushPromises()
      expect(store.userProfile.skippedLogin).toBe(true)
      await panel.vm.$nextTick()
      expect(panel.text()).toContain('请先登录')
      expect(panel.find('.user-login-tabs').text()).toContain('邮箱登录')
      expect(panel.find('.user-login-tabs').text()).toContain('手机号登录')
      expect(panel.find('.user-login-tabs').text()).toContain('账号登录')

      await panel.findAll('.user-login-tabs button').find((button) => button.text().includes('账号登录'))!.trigger('click')
      expect((panel.findAll('.user-login-form input').at(0)!.element as HTMLInputElement).value).toBe('')
      expect((panel.findAll('.user-login-form input').at(1)!.element as HTMLInputElement).value).toBe('')
      await panel.findAll('.user-login-form input').at(0)!.setValue('verify-device')
      await panel.findAll('.user-login-form input').at(1)!.setValue('secret')
      await panel.find('.user-login-form .primary').trigger('click')
      await flushPromises()
      await panel.vm.$nextTick()
      expect(store.userNotice).toBe('当前设备需要验证后才能登录')
      expect(panel.text()).toContain('当前设备需要验证后才能登录')
      await panel.findAll('.user-login-form input').at(0)!.setValue('ops_return')
      await panel.findAll('.user-login-form input').at(1)!.setValue('secret')
      await panel.find('.user-login-form .primary').trigger('click')
      await flushPromises()
      await panel.vm.$nextTick()
      expect(store.userProfile.skippedLogin).toBe(false)
      expect(store.userProfile.username).toBe('ops_return')

      await panel.find('.user-info-footer .danger').trigger('click')
      await flushPromises()
      await panel.vm.$nextTick()
      await panel.findAll('.user-login-tabs button').find((button) => button.text().includes('邮箱登录'))!.trigger('click')
      await panel.findAll('.user-login-form input').at(0)!.setValue('login@example.local')
      await panel.find('.user-code-row button').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(120)
      await panel.vm.$nextTick()
      expect(panel.find('.user-code-row button').text()).toContain('300s')
      await panel.findAll('.user-login-form input').at(1)!.setValue('246810')
      await panel.find('.user-login-form .primary').trigger('click')
      await flushPromises()
      expect(store.userProfile.email).toBe('login@example.local')

      await panel.find('.user-info-footer .danger').trigger('click')
      await flushPromises()
      await panel.vm.$nextTick()
      await panel.find('.user-skip-login button').trigger('click')
      await flushPromises()
      expect(store.userProfile.username).toBe('guest')
      expect(store.billingSettings.skippedLogin).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fabricate user avatar data when avatar backend preparation is unavailable or fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.refreshUserAccount()
    const panel = mount(UserPanel, {
      global: { plugins: [pinia] }
    })
    const originalPrepareUserAvatarImage = window.aiops.prepareUserAvatarImage

    try {
      await panel.find('.user-avatar.large').trigger('click')
      ;(window.aiops as any).prepareUserAvatarImage = undefined
      await panel.find('.avatar-actions-row .settings-button').trigger('click')
      await flushPromises()
      expect(store.userNotice).toBe('头像读取服务不可用')
      expect(store.userProfile.avatarImageUrl).toBe('')
      expect(panel.find('.avatar-preview-box img').exists()).toBe(false)

      ;(window.aiops as any).prepareUserAvatarImage = originalPrepareUserAvatarImage
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/not-image.txt'] })
      vi.mocked(window.aiops.prepareUserAvatarImage!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'USER_AVATAR_INVALID_IMAGE',
        errorMessage: '请选择图片文件'
      })
      await panel.find('.avatar-actions-row .settings-button').trigger('click')
      await flushPromises()
      expect(window.aiops.prepareUserAvatarImage).toHaveBeenCalledWith({ filePath: '/tmp/not-image.txt' })
      expect(store.userNotice).toBe('请选择图片文件')
      expect(store.userProfile.avatarImageUrl).toBe('')
      expect(panel.find('.avatar-preview-box img').exists()).toBe(false)
    } finally {
      ;(window.aiops as any).prepareUserAvatarImage = originalPrepareUserAvatarImage
    }
  })

  it('filters, selects, deletes, and creates agent conversations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'))
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AgentsSidebar, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    try {
      const pagedConversations = Array.from({ length: 25 }, (_, index) => ({
        id: `conv-page-${index + 1}`,
        title: `分页会话 ${index + 1}`,
        summary: `summary ${index + 1}`,
        updatedAt: index === 0 ? '刚刚' : '今天',
        ts: 10_000 - index,
        ipAddress: index === 0 ? '10.0.0.1' : undefined
      }))
      ;(globalThis as any).__setChatHistoryStoreMock?.(pagedConversations)
      store.conversations = pagedConversations
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.conversation-item')).toHaveLength(20)
      expect(wrapper.text()).toContain('分页会话 20')
      expect(wrapper.text()).not.toContain('分页会话 21')
      expect(wrapper.text()).not.toContain('summary 1')

      vi.mocked(window.aiops.listChatConversations).mockClear()
      await wrapper.find('.load-more-btn').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(window.aiops.listChatConversations).toHaveBeenCalledTimes(1)
      expect(wrapper.findAll('.conversation-item')).toHaveLength(25)
      expect(wrapper.text()).toContain('分页会话 25')
      expect(wrapper.find('.load-more-btn').exists()).toBe(false)

      await wrapper.find('.agents-search input').setValue('conv-page-2')
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.conversation-item')).toHaveLength(7)
      expect(wrapper.find('.agents-search-clear').exists()).toBe(true)
      expect(wrapper.text()).toContain('分页会话 2')
      expect(wrapper.text()).toContain('分页会话 25')
      expect(wrapper.text()).not.toContain('分页会话 1')

      await wrapper.find('.agents-search-clear').trigger('click')
      await wrapper.vm.$nextTick()
      expect((wrapper.find('.agents-search input').element as HTMLInputElement).value).toBe('')
      expect(wrapper.find('.agents-search-clear').exists()).toBe(false)
      expect(wrapper.findAll('.conversation-item')).toHaveLength(20)
      expect(wrapper.text()).toContain('分页会话 20')
      expect(wrapper.text()).not.toContain('分页会话 21')

      const actionConversations = [
        {
          id: 'conv-1',
          title: '生产巡检',
          summary: '分析磁盘、负载和服务状态',
          updatedAt: '刚刚',
          ts: new Date('2026-06-04T10:30:00+08:00').getTime(),
          ipAddress: '10.24.8.12'
        },
        {
          id: 'conv-2',
          title: 'K8s 发布失败',
          summary: '检查 Pod 事件和镜像拉取',
          updatedAt: '今天',
          ts: new Date('2026-06-01T12:00:00+08:00').getTime(),
          ipAddress: 'prod-cluster'
        },
        {
          id: 'conv-3',
          title: '数据库慢查询',
          summary: '梳理慢日志和索引建议',
          updatedAt: '昨天',
          ts: new Date('2026-05-25T10:30:00+08:00').getTime(),
          ipAddress: '10.32.6.9'
        }
      ]
      ;(globalThis as any).__setChatHistoryStoreMock?.(actionConversations, {
        'conv-2': [
          { id: 'hist-conv-2-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
          { id: 'hist-conv-2-user', role: 'user', text: '检查 Pod 事件和镜像拉取' },
          { id: 'hist-conv-2-assistant', role: 'assistant', text: 'K8s 发布失败历史包含 Pod 事件、镜像拉取状态和回滚检查记录。', state: 'done' }
        ],
        'conv-3': [
          { id: 'hist-conv-3-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
          { id: 'hist-conv-3-user', role: 'user', text: '梳理慢日志和索引建议' },
          { id: 'hist-conv-3-assistant', role: 'assistant', text: '数据库慢查询历史包含慢日志摘要、疑似缺失索引和 SQL 优化建议。', state: 'done' }
        ]
      })
      store.conversations = actionConversations
      await wrapper.find('.agents-search input').setValue('')
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('10:30')
      expect(wrapper.text()).toContain('3天前')
      expect(wrapper.text()).toContain('05/25')

      await wrapper.find('.agents-search input').setValue('conv-2')
      expect(wrapper.text()).toContain('K8s 发布失败')
      expect(wrapper.text()).not.toContain('生产巡检')
      expect(wrapper.text()).not.toContain('检查 Pod 事件和镜像拉取')

      await wrapper.find('.agents-search input').setValue('索引建议')
      expect(wrapper.text()).toContain('数据库慢查询')
      expect(wrapper.text()).not.toContain('K8s 发布失败')

      await wrapper.find('.agents-search input').setValue('prod-cluster')
      expect(wrapper.text()).toContain('K8s 发布失败')
      expect(wrapper.text()).not.toContain('数据库慢查询')

      await wrapper.find('.agents-search input').trigger('keydown', { key: 'Escape' })
      expect((wrapper.find('.agents-search input').element as HTMLInputElement).value).toBe('')

      await wrapper.find('.agents-search input').setValue('conv-2')
      await wrapper.find('.conversation-item').trigger('click')
      await flushPromises()
      expect(store.selectedConversationId).toBe('conv-2')
      expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('conv-2')
      expect(store.chatMessages.at(-1)?.text).toContain('K8s 发布失败历史包含 Pod 事件')

      await wrapper.find('.conversation-item').trigger('keydown', { key: 'Delete' })
      await flushPromises()
      expect(store.conversations.some((conversation) => conversation.id === 'conv-2')).toBe(false)
      expect(window.aiops.deleteChatConversation).toHaveBeenCalledWith('conv-2')

      await wrapper.find('.agents-search input').setValue('conv-3')
      await wrapper.find('.conversation-item').trigger('click')
      await flushPromises()
      expect(store.selectedConversationId).toBe('conv-3')
      expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('conv-3')
      expect(store.chatMessages.at(-1)?.text).toContain('数据库慢查询历史包含慢日志摘要')
      await wrapper.find('.delete-btn').trigger('click')
      await flushPromises()
      expect(store.conversations.some((conversation) => conversation.id === 'conv-3')).toBe(false)
      expect(window.aiops.deleteChatConversation).toHaveBeenCalledWith('conv-3')

      await wrapper.find('.new-chat-btn').trigger('click')
      await flushPromises()
      expect((wrapper.find('.agents-search input').element as HTMLInputElement).value).toBe('')
      expect(store.selectedConversationId).toMatch(/^conv-/)
      expect(store.chatMessages.at(-1)?.text).toContain('请输入本次运维目标')
      expect(window.aiops.createChatConversation).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns External reference-style context submenus to main on Escape and empty Backspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/ai-chat-export.md' })
    const historyConversations = Array.from({ length: 23 }, (_, index) => ({
      id: `history-${index + 1}`,
      title: index === 0 ? '生产巡检' : index === 1 ? '发布回滚会话' : `历史会话 ${index + 1}`,
      summary: index === 1 ? '包含 nginx 发布上下文' : `历史摘要 ${index + 1}`,
      updatedAt: index === 0 ? '刚刚' : '今天',
      ts: new Date('2026-06-04T10:30:00+08:00').getTime() - index * 1000,
      ipAddress: index === 1 ? '10.24.8.12' : undefined,
      favorite: index === 0 || index === 2
    }))
    ;(globalThis as any).__setChatHistoryStoreMock?.(
      historyConversations,
      {
        'history-1': [
          { id: 'history-1-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
          { id: 'history-1-user', role: 'user', text: '历史摘要 1' },
          { id: 'history-1-assistant', role: 'assistant', text: '生产巡检后端历史快照。', state: 'done' }
        ],
        'history-2': [
          { id: 'history-2-system', role: 'system', text: '历史会话已从 aiopsterm 后端恢复。' },
          { id: 'history-2-user', role: 'user', text: '包含 nginx 发布上下文', hosts: [{ id: 'history-host-2', kind: 'hosts', label: '10.24.8.12', detail: '发布回滚会话' }] },
          { id: 'history-2-assistant', role: 'assistant', text: '发布回滚会话后端恢复内容。', state: 'done' }
        ]
      },
      'history-1'
    )
    store.chatMessages = [
      { id: 'search-system', role: 'system', text: '系统提示：保持审计上下文。' },
      { id: 'search-user', role: 'user', text: '检查生产数据库 rollback 计划', contentParts: [{ type: 'text', text: '检查生产数据库 rollback 计划' }] },
      { id: 'search-assistant', role: 'assistant', text: 'rollback 计划：先确认连接，再生成只读 SQL。', state: 'done' }
    ]
    store.conversations = historyConversations
    store.selectedConversationId = 'history-1'
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-history-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-history-dropdown"]').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.find('[data-testid="ai-history-search-input"]').element)
    expect(wrapper.findAll('.ai-history-item')).toHaveLength(20)
    expect(wrapper.find('[data-testid="ai-history-load-more"]').exists()).toBe(true)
    vi.mocked(window.aiops.listChatConversations).mockClear()
    await wrapper.find('[data-testid="ai-history-load-more"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listChatConversations).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.ai-history-item')).toHaveLength(23)
    expect(wrapper.find('[data-testid="ai-history-load-more"]').exists()).toBe(false)
    await wrapper.find('[data-testid="ai-history-search-input"]').setValue('nginx')
    expect(wrapper.findAll('.ai-history-item')).toHaveLength(0)
    expect(wrapper.find('.ai-history-empty').text()).toContain('暂无数据')
    await wrapper.find('[data-testid="ai-history-search-input"]').setValue('发布回滚会话')
    expect(wrapper.findAll('.ai-history-item')).toHaveLength(1)
    expect(wrapper.find('.ai-history-item').text()).toContain('发布回滚会话')
    await wrapper.find('.ai-history-search button[title="清空搜索"]').trigger('click')
    expect((wrapper.find('[data-testid="ai-history-search-input"]').element as HTMLInputElement).value).toBe('')
    await wrapper.find('[data-testid="ai-history-favorites-toggle"]').trigger('click')
    expect(wrapper.find('.ai-history-date').text()).toContain('收藏')
    expect(wrapper.findAll('.ai-history-item')).toHaveLength(2)
    await wrapper.find('[data-testid="ai-history-favorites-toggle"]').trigger('click')

    const firstHistoryItem = wrapper.findAll('.ai-history-item').find((item) => item.text().includes('生产巡检'))!
    await firstHistoryItem.find('button[title="编辑标题"]').trigger('click')
    await wrapper.find('[data-testid="ai-history-title-input"]').setValue('生产巡检复盘')
    await wrapper.find('[data-testid="ai-history-title-input"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(store.conversations.find((conversation) => conversation.id === 'history-1')?.title).toBe('生产巡检复盘')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'history-1', title: '生产巡检复盘' }))
    if (!wrapper.find('[data-testid="ai-history-dropdown"]').exists()) {
      await wrapper.find('[data-testid="ai-history-open"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
    }

    await wrapper.find('[data-testid="ai-history-search-input"]').setValue('发布回滚会话')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ai-history-item').find((item) => item.text().includes('发布回滚会话'))!.find('button[title="收藏"]').trigger('click')
    await flushPromises()
    expect(store.conversations.find((conversation) => conversation.id === 'history-2')?.favorite).toBe(true)
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'history-2', favorite: true }))
    await wrapper.findAll('.ai-history-item').find((item) => item.text().includes('发布回滚会话'))!.trigger('click')
    await flushPromises()
    expect(store.selectedConversationId).toBe('history-2')
    expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('history-2')
    expect(store.chatMessages[0].text).toContain('历史会话已从 aiopsterm 后端恢复')
    expect(store.chatMessages.at(-1)?.text).toContain('发布回滚会话后端恢复内容')
    expect(store.chatMessages.at(-1)?.text).not.toContain('本地历史摘要')
    expect(wrapper.find('[data-testid="ai-history-dropdown"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-history-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-history-search-input"]').setValue('历史会话 3')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ai-history-item').find((item) => item.text().includes('历史会话 3'))!.find('button[title="删除历史"]').trigger('click')
    await flushPromises()
    expect(store.conversations.some((conversation) => conversation.id === 'history-3')).toBe(false)
    expect(window.aiops.deleteChatConversation).toHaveBeenCalledWith('history-3')
    await wrapper.find('[data-testid="ai-new-chat"]').trigger('click')
    await flushPromises()
    expect(store.selectedConversationId).toMatch(/^conv-/)
    expect(store.chatMessages.at(-1)?.text).toContain('请输入本次运维目标')
    expect(window.aiops.createChatConversation).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-history-dropdown"]').exists()).toBe(false)
    store.selectedConversationId = 'history-1'
    store.chatMessages = [
      { id: 'search-system', role: 'system', text: '系统提示：保持审计上下文。' },
      { id: 'search-user', role: 'user', text: '检查生产数据库 rollback 计划', contentParts: [{ type: 'text', text: '检查生产数据库 rollback 计划' }] },
      { id: 'search-assistant', role: 'assistant', text: 'rollback 计划：先确认连接，再生成只读 SQL。', state: 'done' }
    ]
    await window.aiops.updateChatConversation({
      id: 'history-1',
      messages: [
        { id: 'search-system', role: 'system', text: '系统提示：保持审计上下文。' },
        { id: 'search-user', role: 'user', text: '检查生产数据库 rollback 计划' },
        { id: 'search-assistant', role: 'assistant', text: 'rollback 计划：先确认连接，再生成只读 SQL。', state: 'done' }
      ]
    })
    await wrapper.vm.$nextTick()

    await wrapper.find('.ai-panel').trigger('keydown', { key: 'f', ctrlKey: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ai-chat-search-bar').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.find('[data-testid="ai-chat-search-input"]').element)
    await wrapper.find('[data-testid="ai-chat-search-input"]').setValue('rollback')
    await new Promise((resolve) => window.setTimeout(resolve, 210))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-chat-search-count"]').text()).toBe('1/2')
    expect(wrapper.findAll('.ai-chat-search-highlight')).toHaveLength(2)
    expect(wrapper.findAll('.ai-chat-search-highlight.active')).toHaveLength(1)
    await wrapper.find('.ai-chat-search-controls button[title="下一个"]').trigger('click')
    expect(wrapper.find('[data-testid="ai-chat-search-count"]').text()).toBe('2/2')
    await wrapper.find('[data-testid="ai-chat-search-input"]').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.find('[data-testid="ai-chat-search-count"]').text()).toBe('1/2')
    await wrapper.find('[data-testid="ai-chat-search-input"]').setValue('missing-term')
    await new Promise((resolve) => window.setTimeout(resolve, 210))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-chat-search-count"]').text()).toBe('无匹配')
    await wrapper.find('[data-testid="ai-chat-search-input"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.ai-chat-search-bar').exists()).toBe(false)
    expect(wrapper.find('.ai-chat-search-highlight').exists()).toBe(false)

    store.chatMessages.push(
      {
        id: 'export-command',
        role: 'assistant',
        text: 'kubectl get pods -n prod',
        ask: 'command',
        executedCommand: 'kubectl get pods -n prod',
        state: 'done'
      },
      {
        id: 'export-command-output',
        role: 'assistant',
        text: 'pod/api-0 Ready\npod/job-42 Completed',
        say: 'command_output',
        state: 'done'
      },
      {
        id: 'export-mcp-tool',
        role: 'assistant',
        text: 'search logs',
        ask: 'mcp_tool_call',
        mcpToolCall: {
          serverName: 'ops-mcp',
          toolName: 'search_logs',
          arguments: { service: 'api', limit: 20 }
        },
        state: 'done'
      },
      {
        id: 'export-followup',
        role: 'assistant',
        text: '选择下一步操作？',
        ask: 'followup',
        followupOptions: ['只读检查', '执行回滚'],
        selectedOption: '只读检查',
        state: 'done'
      },
      {
        id: 'export-search-result',
        role: 'assistant',
        text: '2026-06-04 api rollback-safe result',
        say: 'search_result',
        state: 'done'
      },
      {
        id: 'export-context-truncated',
        role: 'system',
        text: '{"status":"completed"}',
        say: 'context_truncated'
      },
      {
        id: 'export-approved',
        role: 'assistant',
        text: '',
        action: 'approved',
        state: 'done'
      },
      {
        id: 'export-rejected',
        role: 'assistant',
        text: '',
        action: 'rejected',
        state: 'done'
      }
    )

    await wrapper.find('[data-testid="ai-chat-export"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: '生产巡检复盘.md',
      filters: [{ name: 'Markdown Files', extensions: ['md'] }]
    })
    const exportCall = vi.mocked(window.aiops.writeLocalFile).mock.calls.at(-1)
    const exportMarkdown = String(exportCall?.[1])
    expect(exportCall?.[0]).toBe('/tmp/ai-chat-export.md')
    expect(exportMarkdown).toContain('from aiopsterm')
    expect(exportMarkdown).toContain('**User:**')
    expect(exportMarkdown).toContain('rollback 计划')
    expect(exportMarkdown).toContain('```bash\nkubectl get pods -n prod\n```')
    expect(exportMarkdown).toContain('**OUTPUT**')
    expect(exportMarkdown).toContain('pod/api-0 Ready')
    expect(exportMarkdown).toContain('"MCP SERVER": "ops-mcp"')
    expect(exportMarkdown).toContain('"TOOL": "search_logs"')
    expect(exportMarkdown).toContain('"service": "api"')
    expect(exportMarkdown).toContain('Options:')
    expect(exportMarkdown).toContain('- [x] 只读检查')
    expect(exportMarkdown).toContain('- [ ] 执行回滚')
    expect(exportMarkdown).toContain('**Search Result**')
    expect(exportMarkdown).toContain('2026-06-04 api rollback-safe result')
    expect(exportMarkdown).toContain('Context has been truncated.')
    expect(exportMarkdown).toContain('Approved')
    expect(exportMarkdown).toContain('Rejected')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('聊天已导出')

    const assistantMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('rollback 计划'))
    expect(assistantMessage).toBeTruthy()
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await assistantMessage!.find('[data-testid="ai-message-copy"]').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('rollback 计划：先确认连接，再生成只读 SQL。')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('消息已复制')

    await assistantMessage!.find('button[title="收藏"]').trigger('click')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'search-assistant')?.favorite).toBe(true)
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('已收藏消息')
    await assistantMessage!.find('button[title="有帮助"]').trigger('click')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'search-assistant')?.feedback).toBe('up')
    await assistantMessage!.find('button[title="无帮助"]').trigger('click')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'search-assistant')?.feedback).toBe('down')

    await assistantMessage!.find('[data-testid="ai-message-to-knowledge"]').trigger('click')
    await flushPromises()
    expect(store.activePanel.kind).toBe('knowledge')
    expect(store.activePanel.knowledge?.relPath).toMatch(/^summary\/ai-message-search-assistant\.md$/)
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('已沉淀到知识')
    await assistantMessage!.find('[data-testid="ai-message-to-skill"]').trigger('click')
    await flushPromises()
    expect(store.settingsSkills[0].name).toMatch(/rollback.+skill|ai-message-skill/)
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('已创建技能')

    store.activePanelId = 'panel-main'
    await assistantMessage!.find('[data-testid="ai-message-retry"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.chatMessages.at(-2)?.text).toContain('检查生产数据库 rollback 计划')

    store.chatMessages.push({
      id: 'command-assistant',
      role: 'assistant',
      text: 'uptime',
      contentParts: [{ type: 'chip', chipType: 'command', ref: { command: 'uptime', label: 'uptime' } }],
      state: 'done'
    })
    await wrapper.vm.$nextTick()
    const commandMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('uptime'))
    expect(commandMessage).toBeTruthy()
    await commandMessage!.find('[data-testid="ai-message-command-copy"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('uptime')
    await commandMessage!.find('[data-testid="ai-message-command-run"]').trigger('click')
    await flushPromises()
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: uptime')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.executedCommand).toBeUndefined()
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('终端会话不可用')
    store.activePanel.sessionId = 'terminal-command-panel'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    await commandMessage!.find('[data-testid="ai-message-command-run"]').trigger('click')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-command-panel', 'uptime\n')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.executedCommand).toBe('uptime')
    expect(commandMessage!.find('[data-testid="ai-message-executed-command"]').text()).toContain('uptime')

    const findContextButton = (label: string) =>
      wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes(label))
    const expectContextMainMenu = () => {
      expect(wrapper.find('.context-select-popup').exists()).toBe(true)
      expect(wrapper.find('.context-select-popup header button').exists()).toBe(false)
      expect(findContextButton('文档')).toBeTruthy()
      expect(findContextButton('技能')).toBeTruthy()
    }

    await wrapper.find('[data-onboarding-id="ai-context-trigger"]').trigger('click')
    await wrapper.vm.$nextTick()
    let contextSearchInput = wrapper.find('.context-select-popup header input')
    expect(document.activeElement).toBe(contextSearchInput.element)
    await contextSearchInput.trigger('keydown', { key: 'ArrowUp' })
    expect(findContextButton('127.0.0.1')?.classes()).toContain('keyboard-selected')
    await contextSearchInput.trigger('keydown', { key: 'ArrowDown' })
    expect(findContextButton('10.24.8.12')?.classes()).toContain('keyboard-selected')
    await contextSearchInput.setValue('文档')
    expect(wrapper.find('.context-select-popup .select-list button.keyboard-selected').exists()).toBe(false)

    await findContextButton('文档')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    contextSearchInput = wrapper.find('.context-select-popup header input')
    expect(document.activeElement).toBe(contextSearchInput.element)
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()
    expect(findContextButton('Markdown语法指南.md')).toBeTruthy()
    await contextSearchInput.trigger('keydown', { key: 'ArrowUp' })
    expect(findContextButton('Markdown语法指南.md')?.classes()).toContain('keyboard-selected')
    await contextSearchInput.setValue('missing-context')
    await contextSearchInput.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.context-select-popup .select-list button.keyboard-selected').exists()).toBe(false)
    await contextSearchInput.setValue('')

    await findContextButton('commands')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(findContextButton('Summary to Doc.md')).toBeTruthy()
    expect(findContextButton('Markdown语法指南.md')).toBeFalsy()
    expect(store.selectedContexts.some((context) => context.id === 'kb-doc:commands')).toBe(false)

    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()
    expect(findContextButton('Markdown语法指南.md')).toBeTruthy()

    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expectContextMainMenu()

    await findContextButton('文档')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.context-select-popup header input').setValue('Summary')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Backspace' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('Summary to Doc.md')).toBeTruthy()

    await wrapper.find('.context-select-popup header input').setValue('')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Backspace' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()

    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Backspace' })
    await wrapper.vm.$nextTick()
    expectContextMainMenu()

    await findContextButton('文档')!.trigger('mouseover')
    expect(findContextButton('文档')!.classes()).toContain('keyboard-selected')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()
    await findContextButton('Markdown语法指南.md')!.trigger('mouseover')
    expect(findContextButton('Markdown语法指南.md')!.classes()).toContain('keyboard-selected')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(store.selectedContexts.some((context) => context.label === 'Markdown语法指南.md')).toBe(true)
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-context-trigger"]').trigger('click')
    await wrapper.vm.$nextTick()
    await findContextButton('文档')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(findContextButton('Summary to Doc.md')).toBeTruthy()
    await wrapper.find('.context-select-popup header input').setValue('Summary')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(store.selectedContexts.some((context) => context.id === 'kb-doc:commands/Summary to Doc.md')).toBe(true)
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    await wrapper.find('[data-onboarding-id="ai-context-trigger"]').trigger('click')
    await wrapper.vm.$nextTick()
    await findContextButton('文档')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.ai-panel').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()

    await wrapper.find('.ai-panel').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expectContextMainMenu()

    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('[data-testid="ai-message-input"]').element)

    store.chatMessages.push({
      id: 'msg-edit-context-return',
      role: 'user',
      text: '检查数据库主机',
      contentParts: [{ type: 'text', text: '检查数据库主机' }],
      hosts: []
    })
    await wrapper.vm.$nextTick()
    await wrapper.find('.message.user .message-parts').trigger('click')
    await wrapper.vm.$nextTick()
    const selectedContextIdsBeforeEditContext = store.selectedContexts.map((context) => context.id)
    await wrapper.find('.user-message-edit-container .context-trigger-tag').trigger('click')
    await wrapper.vm.$nextTick()
    await findContextButton('文档')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(findContextButton('commands')).toBeTruthy()
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()
    expectContextMainMenu()
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('.user-message-edit-container .message-editable').element)
    await wrapper.find('.user-message-edit-container .context-trigger-tag').trigger('click')
    await wrapper.vm.$nextTick()
    await findContextButton('10.32.6.9')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.user-message-edit-container .context-tag').some((tag) => tag.text().includes('10.32.6.9'))).toBe(true)
    expect(store.selectedContexts.map((context) => context.id)).toEqual(selectedContextIdsBeforeEditContext)

    wrapper.unmount()
  })

  it('matches External reference-style Agent host context batch actions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    await wrapper.find('.context-trigger-tag').trigger('click')
    await wrapper.find('[data-onboarding-id="ai-context-hosts-menu"]').trigger('click')
    await wrapper.find('.context-select-popup header input').setValue('10.32.6.9')
    expect(wrapper.find('.host-batch-footer').exists()).toBe(true)
    expect(wrapper.find('.host-batch-footer').text()).toContain('全选')

    await wrapper.find('.host-batch-footer .batch-action-btn').trigger('click')
    expect(store.selectedContexts.some((context) => context.label === '10.32.6.9')).toBe(true)
    expect(wrapper.findAll('.chat-editable .mention-chip').some((chip) => chip.text().includes('10.32.6.9'))).toBe(true)
    expect(wrapper.find('.host-batch-footer').text()).toContain('取消全选')
    expect(wrapper.find('.host-batch-footer').text()).toContain('清空选择')

    await wrapper.findAll('.host-batch-footer .batch-action-btn').at(1)!.trigger('click')
    expect(store.selectedContexts.filter((context) => context.kind === 'hosts')).toHaveLength(0)
    expect(wrapper.find('.chat-editable .mention-chip').exists()).toBe(false)

    wrapper.unmount()
  })

  it('prepares AI image attachments through the preload boundary without writing system chat messages', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.chatMessages = [{ id: 'existing-system', role: 'system', text: '已有后端消息。' }]

    const originalPrepareImageFromFile = window.aiops.prepareChatImageAttachmentFromFile

    try {
      expect(wrapper.find('.chat-input input[type="file"]').exists()).toBe(false)
      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.prepareChatImageAttachmentFromFile).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/note.txt'] })
      vi.mocked(window.aiops.prepareChatImageAttachmentFromFile).mockResolvedValueOnce({
        ok: false,
        errorCode: 'CHAT_IMAGE_UNSUPPORTED_TYPE',
        errorMessage: '不支持的图片类型：note.txt'
      })
      await wrapper.find('[title="上传图片"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()

      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
      })
      expect(window.aiops.prepareChatImageAttachmentFromFile).toHaveBeenCalledWith({ filePath: '/tmp/note.txt' })
      expect(window.aiops.validateChatImageAttachment).not.toHaveBeenCalled()
      expect(window.aiops.prepareChatImageAttachment).not.toHaveBeenCalled()
      expect(wrapper.find('.chat-editable .image-preview-wrapper').exists()).toBe(false)
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('图片上传失败：不支持的图片类型')
      expect(store.chatMessages).toEqual([{ id: 'existing-system', role: 'system', text: '已有后端消息。' }])
      expect(store.chatMessages.some((message) => message.id.startsWith('image-upload'))).toBe(false)

      ;(window.aiops as any).prepareChatImageAttachmentFromFile = undefined
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/input.png'] })
      await wrapper.find('[title="上传图片"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('图片上传失败：图片读取服务不可用')
      expect(wrapper.find('.chat-editable .image-preview-wrapper').exists()).toBe(false)
    } finally {
      ;(window.aiops as any).prepareChatImageAttachmentFromFile = originalPrepareImageFromFile
      wrapper.unmount()
    }
  })

  it('does not fabricate AI file attachments when dialog or staging bridges are unavailable or fail', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    const originalShowOpenDialog = window.aiops.showOpenDialog
    const originalStageChatAttachment = window.aiops.stageChatAttachment

    try {
      vi.mocked(window.aiops.createChatConversation).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：文件选择服务不可用')
      expect(window.aiops.createChatConversation).not.toHaveBeenCalled()
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      vi.mocked(window.aiops.showOpenDialog!).mockClear()
      ;(window.aiops as any).stageChatAttachment = undefined
      vi.mocked(window.aiops.createChatConversation).mockClear()
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：文件暂存服务不可用')
      expect(window.aiops.createChatConversation).not.toHaveBeenCalled()
      expect(window.aiops.showOpenDialog).not.toHaveBeenCalled()
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      ;(window.aiops as any).stageChatAttachment = originalStageChatAttachment
      store.selectedConversationId = 'conv-attachment-boundary'
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/stage-fail.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockRejectedValueOnce(new Error('stage offline'))
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(window.aiops.stageChatAttachment).toHaveBeenCalledWith({ taskId: 'conv-attachment-boundary', srcAbsPath: '/tmp/stage-fail.log' })
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：stage offline')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/empty-ref.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockResolvedValueOnce({
        mode: 'local',
        refPath: '',
        name: 'empty-ref.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-boundary/empty-ref.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('File staging result is missing refPath')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)
    } finally {
      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      ;(window.aiops as any).stageChatAttachment = originalStageChatAttachment
      wrapper.unmount()
    }
  })

  it('does not transcribe voice input when browser recording is unavailable', async () => {
    restoreMockVoiceRecorder?.()
    restoreMockVoiceRecorder = undefined

    const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    const originalWindowMediaRecorder = (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
    const originalMediaDevices = navigator.mediaDevices
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })

    try {
      vi.mocked(window.aiops.transcribeVoiceInput).mockClear()
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()

      expect(window.aiops.transcribeVoiceInput).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).not.toContain('recording')
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('麦克风不可用，无法开始语音输入')
    } finally {
      wrapper.unmount()
      if (originalMediaRecorder === undefined) delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
      else Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: originalMediaRecorder })
      if (originalWindowMediaRecorder === undefined) delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder
      else Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: originalWindowMediaRecorder })
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: originalMediaDevices
      })
    }
  })

  it('opens and resets the AI command popup with External reference-style keyboard focus behavior', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })

    const mainInput = wrapper.find('[data-testid="ai-message-input"]')
    ;(mainInput.element as HTMLElement).replaceChildren()
    ;(mainInput.element as HTMLElement).focus()
    const emptySlashRange = document.createRange()
    emptySlashRange.selectNodeContents(mainInput.element)
    emptySlashRange.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(emptySlashRange)

    await mainInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await flushPromises()
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(wrapper.find('.command-select-popup').exists()).toBe(true)
    expect(wrapper.find('.command-select-popup .select-list').text()).toContain('rollback-plan')
    const commandSearch = wrapper.find('.command-select-popup header input')
    expect(document.activeElement).toBe(commandSearch.element)

    await commandSearch.setValue('summary')
    expect(wrapper.find('.command-select-popup .select-list').text()).toContain('Summary to Doc')
    expect(wrapper.find('.command-select-popup .select-list').text()).not.toContain('rollback-plan')
    await commandSearch.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.chat-editable .mention-chip-command').exists()).toBe(false)
    expect(wrapper.find('.command-select-popup').exists()).toBe(true)

    await commandSearch.trigger('keydown', { key: 'ArrowUp' })
    const selectedSummaryRow = wrapper.find('.command-select-popup .select-list button.keyboard-selected')
    expect(selectedSummaryRow.exists()).toBe(true)
    expect(selectedSummaryRow.text()).toContain('Summary to Doc')

    await commandSearch.setValue('missing-command')
    await commandSearch.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.command-select-popup .select-list button.keyboard-selected').exists()).toBe(false)
    expect(wrapper.find('.command-select-popup .select-list').text()).toContain('没有匹配的命令')

    await commandSearch.trigger('keydown', { key: 'Escape' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-select-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(mainInput.element)

    await mainInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect((wrapper.find('.command-select-popup header input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.command-select-popup .select-list button.keyboard-selected').exists()).toBe(false)

    wrapper.unmount()
  })

  it('opens External reference-style context and command popups in the AI panel', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').attributes('style')).toContain('width:')
    await wrapper.find('[data-onboarding-id="ai-mode-select"]').trigger('click')
    expect(wrapper.find('[data-onboarding-id="ai-mode-agent-option"]').exists()).toBe(true)
    expect(wrapper.find('.ai-mode-popup').attributes('style')).toContain('min-width:')
    const modeRows = wrapper.findAll('.ai-mode-popup .select-list button')
    expect(modeRows).toHaveLength(2)
    expect(modeRows[0].text()).toContain('Agent')
    expect(modeRows[0].text()).not.toContain('自动规划并等待确认')
    expect(modeRows[1].text()).toContain('Command')
    await modeRows[1].trigger('click')
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').text()).toContain('Command')
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').attributes('style')).toContain('width:')
    await wrapper.find('[data-onboarding-id="ai-mode-select"]').trigger('click')
    await wrapper.find('[data-onboarding-id="ai-mode-agent-option"]').trigger('click')
    expect(wrapper.text()).toContain('Agent')

    store.onboardingAiRequest = { action: 'open-model', stepId: 'ai-model-option', sequence: 1 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-onboarding-id="ai-model-option"]').exists()).toBe(true)
    await wrapper.find('[data-onboarding-id="ai-model-option"]').trigger('click')
    expect(store.config.modelName).toBe('aiopsterm-local-agent')
    await wrapper.find('[data-onboarding-id="ai-model-select"]').trigger('click')
    const thinkingModelRow = wrapper.findAll('.ai-model-popup .select-list button').find((button) => button.text().includes('gpt-5'))
    expect(thinkingModelRow).toBeTruthy()
    expect(thinkingModelRow!.text()).not.toContain('gpt-5-Thinking')
    expect(thinkingModelRow!.find('.thinking-icon').exists()).toBe(true)
    const lockedModelRow = wrapper.findAll('.ai-model-popup .select-list button.locked-model-option').find((button) => button.text().includes('gpt-5-pro'))
    expect(lockedModelRow).toBeTruthy()
    expect(lockedModelRow!.attributes('disabled')).toBeDefined()
    expect(lockedModelRow!.attributes('title')).toContain('升级 VIP')
    expect(lockedModelRow!.find('.locked-model-icon').exists()).toBe(true)
    expect(lockedModelRow!.text()).toContain('VIP')
    await lockedModelRow!.trigger('click')
    expect(store.config.modelName).toBe('aiopsterm-local-agent')

    const modelSearchInput = wrapper.find('.ai-model-popup header input')
    expect(modelSearchInput.exists()).toBe(true)
    await modelSearchInput.setValue('qwen')
    expect(wrapper.find('.ai-model-popup .select-list').text()).toContain('qwen2.5-coder')
    expect(wrapper.find('.ai-model-popup .select-list').text()).not.toContain('gpt-5')
    await modelSearchInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.config.modelName).toBe('qwen2.5-coder')
    expect(store.config.modelProvider).toBe('ollama')
    expect(wrapper.find('.ai-model-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-model-select"]').trigger('click')
    expect((wrapper.find('.ai-model-popup header input').element as HTMLInputElement).value).toBe('')
    await wrapper.find('.ai-model-popup header input').setValue('pro')
    const filteredLockedModelRow = wrapper.findAll('.ai-model-popup .select-list button.locked-model-option').find((button) => button.text().includes('gpt-5-pro'))
    expect(filteredLockedModelRow).toBeTruthy()
    expect(filteredLockedModelRow!.attributes('disabled')).toBeDefined()
    await wrapper.find('.ai-model-popup header input').trigger('keydown', { key: 'Enter' })
    expect(store.config.modelName).toBe('qwen2.5-coder')
    expect(wrapper.find('.ai-model-popup').exists()).toBe(true)
    await wrapper.find('.ai-model-popup header input').setValue('missing-model')
    expect(wrapper.find('.ai-model-popup .select-list').text()).toContain('没有匹配的模型')
    await wrapper.find('.ai-model-popup header input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.ai-model-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-model-select"]').trigger('click')
    const thinkingModelRowAfterSearch = wrapper.findAll('.ai-model-popup .select-list button:not(.locked-model-option)').find((button) => button.text().includes('gpt-5'))
    expect(thinkingModelRowAfterSearch).toBeTruthy()
    expect((wrapper.find('.ai-model-popup header input').element as HTMLInputElement).value).toBe('')
    await thinkingModelRowAfterSearch!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.config.modelName).toBe('gpt-5-Thinking')
    expect(store.config.modelProvider).toBe('local')
    expect(wrapper.find('[data-onboarding-id="ai-model-select"]').text()).toContain('gpt-5')
    expect(wrapper.find('[data-onboarding-id="ai-model-select"]').text()).not.toContain('Thinking')
    expect(wrapper.find('[data-onboarding-id="ai-model-select"] .thinking-icon').exists()).toBe(true)

    store.onboardingAiRequest = { action: 'open-context-main', stepId: 'ai-context-hosts', sequence: 2 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-onboarding-id="ai-context-hosts-menu"]').exists()).toBe(true)
    await wrapper.find('[data-onboarding-id="ai-context-hosts-menu"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-onboarding-id="ai-localhost-option"]').exists()).toBe(true)
    expect(wrapper.find('.host-batch-footer').exists()).toBe(true)
    expect(wrapper.find('.host-batch-footer').text()).toContain('全选')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(false)
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-mode-select"]').trigger('click')
    await wrapper.findAll('.ai-mode-popup .select-list button').find((button) => button.text().includes('Command'))!.trigger('click')
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').text()).toContain('Command')
    await wrapper.find('.context-trigger-tag').trigger('click')
    expect(wrapper.find('.context-select-popup').exists()).toBe(true)
    expect(wrapper.find('[data-onboarding-id="ai-context-hosts-menu"]').exists()).toBe(false)
    expect(wrapper.find('[data-onboarding-id="ai-localhost-option"]').exists()).toBe(false)
    expect(wrapper.find('.context-select-popup .select-list').text()).toContain('文档')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    expect(wrapper.find('.context-select-popup .select-list').text()).toContain('commands')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    await wrapper.find('[data-onboarding-id="ai-mode-select"]').trigger('click')
    await wrapper.find('[data-onboarding-id="ai-mode-agent-option"]').trigger('click')

    store.onboardingAiRequest = { action: 'prepare-send', stepId: 'ai-send', sequence: 3 }
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-message-input"]').text()).toContain('查看本地主机状态')

    await wrapper.find('.context-trigger-tag').trigger('click')
    expect(wrapper.find('.context-select-popup').exists()).toBe(true)

    const docsCategory = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('文档'))
    expect(docsCategory).toBeTruthy()
    await docsCategory!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup header button').exists()).toBe(true)
    await wrapper.find('.context-select-popup header input').setValue('Markdown')
    const markdownDoc = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('Markdown语法指南.md'))
    expect(markdownDoc).toBeTruthy()
    await markdownDoc!.trigger('click')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await wrapper.vm.$nextTick()
    expect(store.selectedContexts.some((context) => context.label === 'Markdown语法指南.md')).toBe(true)
    expect(store.selectedContexts.filter((context) => context.label === 'Markdown语法指南.md')).toHaveLength(1)

    await wrapper.find('[data-onboarding-id="ai-context-trigger"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('文档'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.context-select-popup header input').setValue('Markdown')
    await wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('Markdown语法指南.md'))!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup').exists()).toBe(false)
    expect(store.selectedContexts.filter((context) => context.label === 'Markdown语法指南.md')).toHaveLength(1)

    const mainInput = wrapper.find('[data-testid="ai-message-input"]')
    ;(mainInput.element as HTMLElement).focus()
    const pathTextNode = document.createTextNode('cat /etc/passwd')
    mainInput.element.appendChild(pathTextNode)
    const pathSlashRange = document.createRange()
    pathSlashRange.setStart(pathTextNode, 'cat /'.length)
    pathSlashRange.collapse(true)
    const mainSelection = window.getSelection()
    mainSelection?.removeAllRanges()
    mainSelection?.addRange(pathSlashRange)
    await mainInput.trigger('input')
    await mainInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-select-popup').exists()).toBe(false)
    Array.from(mainInput.element.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) node.remove()
    })
    await mainInput.trigger('input')

    const slashTextNode = document.createTextNode('/')
    mainInput.element.appendChild(slashTextNode)
    const mainSlashRange = document.createRange()
    mainSlashRange.setStart(slashTextNode, 1)
    mainSlashRange.collapse(true)
    ;(mainInput.element as HTMLElement).focus()
    mainSelection?.removeAllRanges()
    mainSelection?.addRange(mainSlashRange)
    await mainInput.trigger('input')
    mainSelection?.removeAllRanges()
    mainSelection?.addRange(mainSlashRange)
    await mainInput.trigger('keyup')
    await mainInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-select-popup').exists()).toBe(true)
    await wrapper.find('.command-select-popup header input').setValue('summary')
    expect(wrapper.find('.command-select-popup .select-list').text()).toContain('Summary to Doc')
    expect(wrapper.find('.command-select-popup .select-list').text()).not.toContain('/Summary to Doc')
    await wrapper.find('.command-select-popup header input').setValue('rollback')
    const rollbackCommandRow = wrapper.find('.command-select-popup .select-list button')
    await rollbackCommandRow.trigger('mouseover')
    expect(rollbackCommandRow.classes()).toContain('keyboard-selected')
    await rollbackCommandRow.trigger('click')
    expect(store.selectedCommandId).toBe('commands/rollback-plan.md')
    expect(store.selectedCommandRef).toEqual({ command: '/rollback-plan', label: '/rollback-plan', path: 'commands/rollback-plan.md' })
    expect(wrapper.find('.chat-editable .mention-chip-command').text()).toContain('/rollback-plan')
    const contextUsageRing = wrapper.find('[data-testid="ai-context-usage-ring"]')
    expect(contextUsageRing.exists()).toBe(true)
    expect(contextUsageRing.attributes('title')).toMatch(/^\d+% - .+ \/ 128\.0K context used$/)
    expect(wrapper.find('.context-usage-progress').attributes('stroke-dasharray')).toMatch(/^\d+(\.\d+)? 56\.55$/)
    expect(wrapper.find('.context-usage-progress').attributes('stroke')).toBe('#3b82f6')

    await wrapper.find('.chat-editable .mention-chip-command button').trigger('click')
    expect(store.selectedCommandId).toBeNull()
    expect(store.selectedCommandRef).toBeNull()

    const voiceButton = wrapper.find('[data-testid="ai-voice-button"]')
    expect(voiceButton.exists()).toBe(true)
    expect(voiceButton.attributes('title')).toBe('开始语音输入')
    expect(voiceButton.attributes('disabled')).toBeUndefined()
    const fileUploadButton = wrapper.find('[data-testid="ai-file-upload-button"]')
    expect(fileUploadButton.exists()).toBe(true)
    expect(fileUploadButton.attributes('title')).toBe('上传文件')
    expect(fileUploadButton.attributes('disabled')).toBeUndefined()
    vi.mocked(window.aiops.showOpenDialog).mockClear()
    vi.mocked(window.aiops.stageChatAttachment).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/ai-attachment.log'] })
    await fileUploadButton.trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [
        {
          name: 'Text',
          extensions: expect.arrayContaining(['txt', 'md', 'js', 'ts', 'py', 'log', 'csv', 'tsv'])
        }
      ]
    })
    expect(window.aiops.stageChatAttachment).toHaveBeenCalledWith({ taskId: store.selectedConversationId, srcAbsPath: '/tmp/ai-attachment.log' })
    expect(wrapper.findAll('.chat-editable .mention-chip-doc').some((chip) => chip.text().includes('ai-attachment.log'))).toBe(true)
    expect(wrapper.find('.input-placeholder-notice').text()).toContain('已添加文件：ai-attachment.log')
    vi.mocked(window.aiops.transcribeVoiceInput).mockClear()
    await voiceButton.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).toContain('recording')
    expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('title')).toBe('停止语音录制')
    await new Promise((resolve) => window.setTimeout(resolve, 240))
    await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await waitForMockCall(vi.mocked(window.aiops.transcribeVoiceInput), 'transcribeVoiceInput')
    expect(window.aiops.transcribeVoiceInput).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'browser',
        durationMs: expect.any(Number),
        audioData: expect.any(String),
        audioFormat: 'ogg-opus',
        audioSize: 4096
      })
    )
    expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).not.toContain('recording')
    expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('title')).toBe('开始语音输入')
    expect(wrapper.find('.input-placeholder-notice').text()).toContain('语音转写完成')
    expect((wrapper.find('[data-testid="ai-message-input"]').element as HTMLElement).textContent).toContain('Provider transcript from test voice backend')

    const markdownContext = store.selectedContexts.find((context) => context.label === 'Markdown语法指南.md')!
    await wrapper.find(`.chat-editable [data-context-id="${markdownContext.id}"] button`).trigger('click')
    expect(store.selectedContexts.some((context) => context.id === markdownContext.id)).toBe(false)

    await wrapper.find('.context-trigger-tag').trigger('click')
    const docsCategoryAgain = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('文档'))
    await docsCategoryAgain!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.context-select-popup header input').setValue('Markdown')
    const markdownDocAgain = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('Markdown语法指南.md'))
    await markdownDocAgain!.trigger('click')
    await mainInput.element.appendChild(document.createTextNode('检查回滚窗口'))
    await mainInput.trigger('input')
    vi.mocked(window.aiops.validateChatImageAttachment).mockClear()
    vi.mocked(window.aiops.prepareChatImageAttachment).mockClear()
    vi.mocked(window.aiops.prepareChatImageAttachmentFromFile).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/input.png'] })
    await wrapper.find('[title="上传图片"]').trigger('click')
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(window.aiops.validateChatImageAttachment).not.toHaveBeenCalled()
    expect(window.aiops.prepareChatImageAttachment).not.toHaveBeenCalled()
    expect(window.aiops.prepareChatImageAttachmentFromFile).toHaveBeenCalledWith({ filePath: '/tmp/input.png' })
    expect(wrapper.find('.chat-editable .image-preview-wrapper').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-context-usage-ring"]').attributes('title')).toContain('context used')
    const sendSlashTextNode = document.createTextNode('/')
    mainInput.element.appendChild(sendSlashTextNode)
    const sendSlashRange = document.createRange()
    sendSlashRange.setStart(sendSlashTextNode, 1)
    sendSlashRange.collapse(true)
    mainSelection?.removeAllRanges()
    mainSelection?.addRange(sendSlashRange)
    await mainInput.trigger('input')
    mainSelection?.removeAllRanges()
    mainSelection?.addRange(sendSlashRange)
    await mainInput.trigger('keydown', { key: '/' })
    await waitForSelector(wrapper, '.command-select-popup header input')
    await wrapper.find('.command-select-popup header input').setValue('rollback')
    await wrapper.find('.command-select-popup .select-list button').trigger('click')
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()
    vi.mocked(window.aiops.generateAiChatResponse).mockClear()
    await wrapper.find('.chat-input button[type="submit"]').trigger('submit')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('检查回滚窗口')
      })
    )
    expect(store.chatMessages.at(-2)?.id).toBe('aichat-request-test-1-user')
    expect(store.chatMessages.at(-1)?.id).toBe('aichat-request-test-1-assistant')
    expect(window.aiops.generateAiChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('检查回滚窗口'),
        command: expect.objectContaining({ label: '/rollback-plan', command: '/rollback-plan' })
      })
    )
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'doc')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'image')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command')).toBe(true)
    expect(wrapper.find('.message.user .mention-chip-doc').exists()).toBe(true)
    expect(wrapper.find('.message.user .message-image-part img').exists()).toBe(true)
    expect(wrapper.find('.message.user .mention-chip-command').exists()).toBe(true)
    expect(wrapper.find('[title="上传图片"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="ai-file-upload-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
    await wrapper.vm.$nextTick()
    const noticeAfterDisabledFileClick = wrapper.find('.input-placeholder-notice')
    expect(noticeAfterDisabledFileClick.exists() ? noticeAfterDisabledFileClick.text() : '').not.toContain('已添加文件')
    await wrapper.find('.chat-input button[type="submit"]').trigger('submit')
    await wrapper.vm.$nextTick()
    expect(store.chatMessages.some((message) => message.state === 'streaming')).toBe(false)
    expect(wrapper.find('[data-testid="ai-file-upload-button"]').attributes('disabled')).toBeUndefined()

    const originalUserMessageId = store.chatMessages.at(-2)?.id
    store.selectCommandPreset(null)
    await wrapper.find('.message.user .message-parts').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container .message-editable').exists()).toBe(true)
    const editInput = wrapper.find('.user-message-edit-container .message-editable')
    editInput.element.replaceChildren(document.createTextNode('编辑后的回滚窗口'))
    const editRange = document.createRange()
    editRange.selectNodeContents(editInput.element)
    editRange.collapse(false)
    const editSelection = window.getSelection()
    editSelection?.removeAllRanges()
    editSelection?.addRange(editRange)
    await editInput.trigger('input')
    const editPathTextNode = document.createTextNode(' ssh user@host:/tmp')
    editInput.element.appendChild(editPathTextNode)
    const editPathSlashRange = document.createRange()
    editPathSlashRange.setStart(editPathTextNode, ' ssh user@host:/'.length)
    editPathSlashRange.collapse(true)
    editSelection?.removeAllRanges()
    editSelection?.addRange(editPathSlashRange)
    await editInput.trigger('input')
    await editInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-select-popup').exists()).toBe(false)
    editInput.element.replaceChildren(document.createTextNode('编辑后的回滚窗口'))
    const editResetRange = document.createRange()
    editResetRange.selectNodeContents(editInput.element)
    editResetRange.collapse(false)
    editSelection?.removeAllRanges()
    editSelection?.addRange(editResetRange)
    await editInput.trigger('input')
    const editSlashTextNode = document.createTextNode('/')
    editInput.element.appendChild(editSlashTextNode)
    const slashRange = document.createRange()
    slashRange.setStart(editSlashTextNode, 1)
    slashRange.collapse(true)
    editSelection?.removeAllRanges()
    editSelection?.addRange(slashRange)
    await editInput.trigger('input')
    editSelection?.removeAllRanges()
    editSelection?.addRange(slashRange)
    await editInput.trigger('keyup')
    await editInput.trigger('keydown', { key: '/' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-select-popup').exists()).toBe(true)
    await wrapper.find('.command-select-popup header input').setValue('rollback')
    await wrapper.find('.command-select-popup header input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.user-message-edit-container .mention-chip-command').exists()).toBe(false)
    await wrapper.find('.command-select-popup header input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.command-select-popup header input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container .mention-chip-command').exists()).toBe(true)
    expect(store.selectedCommandId).toBeNull()

    const selectedContextIdsBeforeEditContext = store.selectedContexts.map((context) => context.id)
    editInput.element.appendChild(document.createTextNode('@'))
    const contextRange = document.createRange()
    contextRange.selectNodeContents(editInput.element)
    contextRange.collapse(false)
    editSelection?.removeAllRanges()
    editSelection?.addRange(contextRange)
    await editInput.trigger('input')
    await editInput.trigger('keydown', { key: '@' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.context-select-popup').exists()).toBe(true)
    const skillsCategory = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('技能'))
    expect(skillsCategory).toBeTruthy()
    await skillsCategory!.trigger('click')
    await wrapper.find('.context-select-popup header input').setValue('incident')
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.user-message-edit-container .mention-chip-skill').exists()).toBe(false)
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('.context-select-popup header input').trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container .mention-chip-skill').text()).toContain('incident-triage')
    expect(store.selectedContexts.map((context) => context.id)).toEqual(selectedContextIdsBeforeEditContext)

    editInput.element.appendChild(document.createTextNode('@'))
    const hostRange = document.createRange()
    hostRange.selectNodeContents(editInput.element)
    hostRange.collapse(false)
    editSelection?.removeAllRanges()
    editSelection?.addRange(hostRange)
    await editInput.trigger('input')
    await editInput.trigger('keydown', { key: '@' })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    const mysqlHost = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('10.32.6.9'))
    expect(mysqlHost).toBeTruthy()
    await mysqlHost!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.user-message-edit-container .context-tag').some((tag) => tag.text().includes('10.32.6.9'))).toBe(true)
    expect(store.selectedContexts.map((context) => context.id)).toEqual(selectedContextIdsBeforeEditContext)

    vi.mocked(window.aiops.prepareChatImageAttachmentFromClipboard).mockClear()
    vi.mocked(window.aiops.prepareChatImageAttachmentFromClipboard).mockResolvedValueOnce({
      ok: true,
      data: {
        type: 'image',
        mediaType: 'image/png',
        data: 'ZWRpdC1pbWFnZQ==',
        name: 'edit.png',
        size: 16
      }
    })
    const editPasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(editPasteEvent, 'clipboardData', {
      configurable: true,
      value: {
        getData: vi.fn(() => ''),
        items: [
          {
            type: 'image/png',
            getAsFile: () => null
          }
        ]
      }
    })
    editInput.element.dispatchEvent(editPasteEvent)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.prepareChatImageAttachmentFromClipboard).toHaveBeenCalledWith()
    expect(wrapper.find('.user-message-edit-container .image-preview-wrapper').exists()).toBe(true)

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/edit-attachment.sql'] })
    await wrapper.find('[data-testid="ai-edit-file-upload-button"]').trigger('click')
    await flushPromises()
    expect(window.aiops.stageChatAttachment).toHaveBeenLastCalledWith({ taskId: store.selectedConversationId, srcAbsPath: '/tmp/edit-attachment.sql' })
    expect(wrapper.find('.user-message-edit-container .mention-chip-doc').text()).toContain('edit-attachment.sql')

    await wrapper.find('.message-edit-actions .primary').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.chatMessages.find((message) => message.id === originalUserMessageId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'text' && part.text.includes('编辑后的回滚窗口'))).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'skill')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'doc' && part.ref.name === 'edit-attachment.sql')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'image' && part.name === 'edit.png')).toBe(true)
    expect(store.chatMessages.at(-2)?.hosts?.map((context) => context.id)).toEqual(['asset-1', 'asset-3'])
    expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)
    expect(wrapper.find('.message.user').text()).toContain('编辑后的回滚窗口')
    expect(wrapper.find('.message.user .message-image-part img').exists()).toBe(true)

    await expect(store.refreshAiTodoSnapshot()).resolves.toBe(true)
    await wrapper.vm.$nextTick()
    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="todo-progress-ratio"]').text()).toBe('1/3')
    expect(wrapper.find('.focus-chain-badge').text()).toContain('Focus Chain')
    expect(wrapper.find('.focus-chain-highlight').text()).toContain('当前焦点')
    expect(wrapper.find('.focus-chain-highlight').text()).toContain('只生成需要确认的只读命令')
    expect(wrapper.findAll('.todo-compact-list .todo-item')).toHaveLength(3)
    expect(wrapper.find('.todo-compact-list .todo-item.completed .status-icon').exists()).toBe(true)
    expect(wrapper.find('.todo-compact-list .todo-item.in-progress.is-focused .todo-focus-badge').exists()).toBe(true)
    expect(wrapper.find('.todo-compact-list .todo-item.in-progress.is-focused .status-icon.spinning').exists()).toBe(true)
    expect(wrapper.find('.todo-compact-list .subtasks').text()).toContain('检查风险级别')
    expect(wrapper.find('.todo-compact-list .subtasks').text()).toContain('危险命令需要二次确认')
    store.todoItems = Array.from({ length: 23 }, (_, index) => ({
      id: `overflow-${index + 1}`,
      content: `溢出任务 ${index + 1}`,
      status: index === 21 ? 'in_progress' : 'pending'
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.todo-compact-list .todo-item')).toHaveLength(20)
    expect(wrapper.find('.todo-compact-list').text()).not.toContain('溢出任务 21')
    store.todoItems = [
      { id: 'focus-explicit', content: '显式焦点', status: 'pending', isFocused: true },
      { id: 'running-but-not-focused', content: '运行但非焦点', status: 'in_progress' }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.todo-item.is-focused .todo-text').text()).toContain('显式焦点')
    expect(wrapper.find('.todo-item.in-progress.is-focused').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-context-usage-indicator"]').exists()).toBe(false)
    store.selectedContexts = [
      ...store.selectedContexts,
      {
        id: 'large-context',
        kind: 'docs',
        label: '大上下文',
        detail: 'x'.repeat(270000)
      }
    ]
    await wrapper.vm.$nextTick()
    const todoContextUsageIndicator = wrapper.find('[data-testid="todo-context-usage-indicator"]')
    expect(todoContextUsageIndicator.exists()).toBe(true)
    expect(todoContextUsageIndicator.classes()).toContain('warning')
    expect(todoContextUsageIndicator.find('.context-text').text()).toMatch(/^\d+%$/)
    store.selectedContexts = [
      {
        id: 'huge-context',
        kind: 'docs',
        label: '超大上下文',
        detail: 'x'.repeat(470000)
      }
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="todo-context-usage-indicator"]').classes()).toContain('maximum')
    store.selectedContexts = store.selectedContexts.filter((context) => context.id !== 'huge-context')
    await wrapper.vm.$nextTick()

    await wrapper.find('.todo-inline-header').trigger('click')
    expect(wrapper.find('.todo-inline-display ol').exists()).toBe(false)
    expect(wrapper.find('.focus-chain-highlight').exists()).toBe(false)
  })

  it('shows Fork SSH Channel only for External reference-style SSH terminal panels', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    await wrapper.find('.terminal-tab').trigger('contextmenu', { clientX: 120, clientY: 40 })
    expect(wrapper.find('.tab-menu').text()).not.toContain('Fork SSH Channel')
    store.registerSshSession(store.activePanelId, {
      id: 'asset-fork-unit',
      name: 'fork-source',
      host: '10.8.0.6',
      port: 2222,
      username: 'ops',
      group_name: '生产',
      asset_type: 'person',
      auth_type: 'keyBased'
    })
    store.applySshTerminalSession(
      store.activePanelId,
      {
        id: 'test-session-source-fork-unit',
        shell: 'ssh',
        cwd: '/home/ops',
        kind: 'ssh',
        connection: {
          connectionId: 'ssh-source-fork-unit',
          host: '10.8.0.6',
          port: 2222,
          username: 'ops',
          assetId: 'asset-fork-unit',
          assetName: 'fork-source',
          assetType: 'person',
          organizationId: '生产',
          authType: 'keyBased',
          title: 'fork-source',
          createdAt: 1717200000000
        }
      },
      {
        id: 'asset-fork-unit',
        name: 'fork-source',
        host: '10.8.0.6',
        port: 2222,
        username: 'ops',
        group_name: '生产',
        asset_type: 'person',
        auth_type: 'keyBased'
      }
    )
    await wrapper.find('.terminal-tab').trigger('contextmenu', { clientX: 120, clientY: 40 })
    expect(wrapper.find('.tab-menu').text()).toContain('Fork SSH Channel')
    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('Fork SSH Channel'))!.trigger('click')
    await flushPromises()
    expect(store.activePanel.title).toBe('local shell fork')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.8.0.6:2222')
    expect(store.activePanel.outputSegments).toEqual([])
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        assetId: 'asset-fork-unit',
        title: 'local shell fork',
        ssh: expect.objectContaining({ host: '10.8.0.6', port: 2222, username: 'ops', forkFromConnectionId: 'ssh-source-fork-unit' })
      })
    )
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.activePanel.sshSession?.connectionId).toBe('ssh-test-session-asset-fork-unit')
    expect(store.activePanel.sshSession?.forkFromConnectionId).toBe('ssh-source-fork-unit')
    expect(store.selectedContexts.some((context) => context.id === 'asset-fork-unit' && context.detail === 'fork-source fork')).toBe(true)

    vi.mocked(window.aiops.killTerminal).mockClear()
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('断开连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('test-session-asset-fork-unit')
    expect(store.activePanel.sessionId).toBeUndefined()
    expect(store.activePanel.status).toBe('closed')
    expect(store.activePanel.output).not.toContain('[connection disconnected]')
    expect(store.topNotice).toBe('终端已断开连接')

    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('重新连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        assetId: 'asset-fork-unit',
        title: 'local shell fork',
        ssh: expect.objectContaining({ host: '10.8.0.6', port: 2222, username: 'ops', forkFromConnectionId: 'ssh-source-fork-unit' })
      })
    )
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[connection reconnected]')
    expect(store.topNotice).toBe('终端已重新连接')

    wrapper.unmount()
  })

  it('matches External reference-style terminal context menu, search overlay, suggestions, and global command bar', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(wrapper.text()).toContain('与AI对话')
    expect(wrapper.text()).toContain('切换布局')

    const highlightConfig: KeywordHighlightUserConfig = {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: true
        },
        rules: [
          {
            name: 'error',
            enabled: true,
            scope: 'output',
            matchType: 'regex',
            pattern: '(?i)error',
            style: {
              foreground: '#FF0000',
              fontStyle: 'bold'
            }
          },
          {
            name: 'sudo',
            enabled: true,
            scope: 'input',
            matchType: 'regex',
            pattern: 'sudo',
            style: {
              foreground: '#E6B450',
              fontStyle: 'bold'
            }
          }
        ]
      }
    }
    store.keywordHighlightSettings = highlightConfig
    store.appendTerminalOutput(store.activePanelId, 'ERROR from service\n')
    expect(store.getHighlightedTerminalOutput(store.activePanelId)).toContain('\x1b[1;38;5;')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(mockXtermInstances.at(-1)!.write.mock.calls.at(-1)?.[0]).toContain('\x1b[1;38;5;')
    expect(store.activePanel.output).toContain('ERROR from service')
    expect(store.activePanel.output).not.toContain('\x1b[')
    store.appendTerminalInput(store.activePanelId, 'sudo systemctl status nginx\n')
    expect(store.getHighlightedTerminalOutput(store.activePanelId)).toContain('sudo')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(mockXtermInstances.at(-1)!.write.mock.calls.at(-1)?.[0]).toContain('sudo')
    expect(mockXtermInstances.at(-1)!.write.mock.calls.at(-1)?.[0]).toContain('\x1b[1;38;5;')

    const firstHost = wrapper.find('.xterm-host')
    Object.defineProperty(firstHost.element, 'clientHeight', { configurable: true, value: 360 })
    const xterm = mockXtermInstances.at(-1)!
    xterm.rows = 20
    xterm.buffer.active.viewportY = 0
    xterm.emitSelection('systemctl status nginx', { start: { x: 0, y: 5 }, end: { x: 22, y: 5 } })
    await wrapper.vm.$nextTick()
    const aiButton = wrapper.find('.terminal-chat-ai-button')
    expect(aiButton.exists()).toBe(true)
    expect(aiButton.attributes('style')).toContain('top: 54px')
    expect(aiButton.attributes('style')).toContain('right: 26px')
    await aiButton.trigger('click')
    expect(store.rightPanelOpen).toBe(true)
    expect(store.chatMessages.at(-2)?.text).toContain('Terminal output:')
    expect(store.chatMessages.at(-2)?.text).toContain('systemctl status nginx')
    expect(xterm.clearSelection).toHaveBeenCalled()

    Object.defineProperty(firstHost.element, 'clientWidth', { configurable: true, value: 720 })
    xterm.buffer.active.cursorX = 6
    xterm.buffer.active.cursorY = 8
    await wrapper.find('.command-line input').setValue('df')
    await flushPromises()
    await wrapper.vm.$nextTick()
    const suggestions = wrapper.find('.terminal-suggestions')
    expect(suggestions.exists()).toBe(true)
    expect(window.aiops.getTerminalCommandSuggestions).toHaveBeenCalledWith(
      'df',
      expect.objectContaining({ panelId: store.activePanelId, mode: 'base' })
    )
    expect(suggestions.attributes('style')).toContain('left: 54px')
    expect(suggestions.attributes('style')).toContain('top: 165.6px')
    expect(wrapper.text()).toContain('df -h')
    expect(suggestions.find('.ai-trigger').exists()).toBe(true)
    await wrapper.find('.command-line input').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-suggestions').classes()).toContain('selection-mode')
    expect(wrapper.find('.terminal-suggestions .ai-trigger').exists()).toBe(false)
    expect(wrapper.find('.terminal-suggestions .terminal-suggestion-arrow').exists()).toBe(true)
    expect(wrapper.find('.terminal-suggestions .terminal-suggestion-arrow').attributes('style')).toContain('top: 3px')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: df -h')
    expect(store.activePanel.output).not.toContain('df -h')
    expect(store.topNotice).toBe('终端会话不可用，请先打开本地 shell 或连接 SSH')
    expect((wrapper.find('.command-line input').element as HTMLInputElement).value).toBe('df -h')

    let resolveAiSuggestions: (value: Awaited<ReturnType<typeof window.aiops.getTerminalCommandSuggestions>>) => void = () => undefined
    vi.mocked(window.aiops.getTerminalCommandSuggestions)
      .mockImplementationOnce(async () => [{ command: 'top -o %CPU', source: 'base', explanation: 'base command' }])
      .mockImplementationOnce(async (_query, context) => {
        if (context?.mode !== 'ai') return []
        return await new Promise((resolve) => {
          resolveAiSuggestions = resolve
        })
      })
    await wrapper.find('.command-line input').setValue('top')
    await flushPromises()
    await wrapper.vm.$nextTick()
    const aiTrigger = wrapper.find('.terminal-suggestions .ai-trigger')
    expect(aiTrigger.exists()).toBe(true)
    await aiTrigger.trigger('mouseenter')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('AI Thinking')
    expect(wrapper.find('.terminal-suggestions .ai-trigger-loading').exists()).toBe(true)
    expect(wrapper.findAll('.terminal-suggestions .ai-trigger-loading .dot')).toHaveLength(3)
    await wrapper.find('.command-line input').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-suggestions .terminal-suggestion-arrow').attributes('style')).toContain('top: 33px')
    expect(window.aiops.getTerminalCommandSuggestions).toHaveBeenCalledWith(
      'top',
      expect.objectContaining({ panelId: store.activePanelId, mode: 'ai' })
    )
    resolveAiSuggestions([{ command: 'top -o %CPU', source: 'ai', explanation: 'Process CPU ranking' }])
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('top -o %CPU')
    expect(wrapper.find('.terminal-suggestions .ai-trigger').exists()).toBe(false)
    expect(wrapper.find('.terminal-suggestions .ai-trigger-loading').exists()).toBe(false)

    await wrapper.find('.command-line input').setValue('rm /tmp/file')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    expect(wrapper.find('.terminal-security-prompt').exists()).toBe(true)
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: rm /tmp/file')
    await wrapper.find('.terminal-security-prompt .settings-button:not(.primary)').trigger('click')
    expect(store.terminalSecurityPrompt).toBeNull()
    expect(store.topNotice).toBe('命令执行已取消：rm /tmp/file')
    expect(store.activePanel.output).not.toContain('[security] command rejected')
    await wrapper.find('.command-line input').setValue('rm /tmp/file')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    await wrapper.find('.terminal-security-prompt .primary').trigger('click')
    expect(store.terminalSecurityPrompt).toBeNull()
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: rm /tmp/file')
    expect(store.topNotice).toBe('终端会话不可用，请先打开本地 shell 或连接 SSH')

    store.securitySettings = {
      security: {
        ...store.securitySettings.security,
        blacklistPatterns: ['rm *'],
        securityPolicy: {
          ...store.securitySettings.security.securityPolicy,
          askForBlacklist: false
        }
      }
    }
    await wrapper.find('.command-line input').setValue('rm -rf /tmp')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    expect(store.terminalSecurityPrompt).toBeNull()
    expect(store.topNotice).toContain('命令已被安全策略阻止：rm -rf /tmp')
    expect(store.activePanel.output).not.toContain('[security] blocked')

    await wrapper.find('.xterm-host').trigger('contextmenu')
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(true)
    expect(wrapper.text()).toContain('全局执行')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('搜索'))!.trigger('click')
    expect(wrapper.find('.terminal-search-overlay').exists()).toBe(true)
    await wrapper.find('.terminal-search-overlay input').setValue('missing-term')
    expect(wrapper.find('.terminal-search-overlay').text()).not.toContain('0/0')
    expect(wrapper.find('.terminal-search-overlay div button[title="清空"]').exists()).toBe(true)
    const searchAddon = mockXtermInstances.at(-1)!.loadAddon.mock.calls.find(([addon]) => 'findNext' in addon)?.[0]
    const missingTermFindNextCalls = searchAddon.findNext.mock.calls.length
    await wrapper.find('.terminal-search-overlay input').trigger('keydown', { key: 'Enter' })
    expect(searchAddon.findNext.mock.calls).toHaveLength(missingTermFindNextCalls)
    await wrapper.find('.terminal-search-overlay input').setValue('ERROR')
    expect(wrapper.find('.terminal-search-overlay').text()).toContain('1/')
    expect(searchAddon.findNext).toHaveBeenCalledWith('ERROR', { incremental: true, caseSensitive: false })
    await wrapper.find('.terminal-search-overlay button[title="下一个"]').trigger('click')
    expect(searchAddon.findNext).toHaveBeenCalledWith('ERROR', { caseSensitive: false })
    await wrapper.find('.terminal-search-overlay button[title="上一个"]').trigger('click')
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('ERROR', { caseSensitive: false })
    const searchInput = wrapper.find('.terminal-search-overlay input')
    const clearSearchButton = wrapper.find('.terminal-search-overlay div button')
    await clearSearchButton.trigger('click')
    await wrapper.vm.$nextTick()
    expect(searchAddon.clearDecorations).toHaveBeenCalled()
    expect(wrapper.find('.terminal-search-overlay').exists()).toBe(true)
    const focusedSearchInput = wrapper.find('.terminal-search-overlay input')
    expect((focusedSearchInput.element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.terminal-search-overlay').text()).not.toContain('1/')
    expect(document.activeElement).toBe(focusedSearchInput.element)

    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('全局执行'))!.trigger('click')
    expect(wrapper.find('.terminal-global-command').exists()).toBe(true)
    await wrapper.find('.terminal-global-command input').setValue('uptime')
    await wrapper.find('.terminal-global-command input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(store.panels.every((panel) => !panel.output.includes('[aiopsterm] broadcast queued without live sessions: uptime'))).toBe(true)
    expect(store.topNotice).toBe('终端会话不可用，请先打开本地 shell 或连接 SSH')
    expect((wrapper.find('.terminal-global-command input').element as HTMLInputElement).value).toBe('uptime')

    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.findAll('.terminal-toolbar button').find((button) => button.text().includes('打开本地 shell'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }))
    expect(store.activePanel.sessionId).toBe('test-session-local')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[aiopsterm] shell started')

    vi.mocked(window.aiops.killTerminal).mockClear()
    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('断开连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('test-session-local')
    expect(store.activePanel.sessionId).toBeUndefined()
    expect(store.activePanel.status).toBe('closed')
    expect(store.activePanel.output).not.toContain('[connection disconnected]')
    expect(store.topNotice).toBe('终端已断开连接')

    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('重新连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }))
    expect(store.activePanel.sessionId).toBe('test-session-local')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[connection reconnected]')
    expect(store.topNotice).toBe('终端已重新连接')

    vi.mocked(window.aiops.writeTerminal).mockClear()
    await wrapper.find('.command-line input').setValue('whoami')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('test-session-local', 'whoami\n')
    expect(store.activePanel.output).not.toContain('whoami')
    expect((wrapper.find('.command-line input').element as HTMLInputElement).value).toBe('')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-command-dialog').exists()).toBe(true)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listAiModels).toHaveBeenCalled()
    expect(wrapper.find('.terminal-command-dialog select').text()).toContain('aiopsterm-local-agent')
    expect(wrapper.find('.terminal-command-dialog select').text()).not.toContain('gpt-5-Thinking')
    await wrapper.find('.terminal-command-dialog textarea').setValue('检查磁盘空间')
    vi.mocked(window.aiops.generateTerminalCommand).mockClear()
    await wrapper.find('.terminal-command-dialog textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.terminal-command-dialog').classes()).toContain('loading')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.generateTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: store.activePanelId,
        instruction: '检查磁盘空间',
        modelName: 'aiopsterm-local-agent'
      })
    )
    expect(store.terminalCommandGenerationRecords[0]).toEqual(expect.objectContaining({ instruction: '检查磁盘空间', command: 'df -h' }))
    expect(store.activePanel.outputSegments.at(-1)).toEqual({ text: 'df -h', scope: 'input' })
    expect(wrapper.find('.terminal-command-dialog').exists()).toBe(true)
    expect((wrapper.find('.terminal-command-dialog textarea').element as HTMLTextAreaElement).value).toBe('')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-command-dialog').exists()).toBe(false)

    store.registerSshSession(store.activePanelId, {
      id: 'asset-terminal-files-unit',
      name: 'terminal-files-host',
      host: '10.45.0.12',
      port: 22,
      username: 'deploy',
      group_name: '生产',
      asset_type: 'person'
    })
    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('文件管理'))!.trigger('click')
    expect(store.activeModule).toBe('files')
    expect(store.selectedLeftFileSessionId).toBe('asset-terminal-files-unit')
    expect(store.fileSessions.find((session) => session.id === 'asset-terminal-files-unit')).toEqual(
      expect.objectContaining({
        label: 'terminal-files-host',
        host: '10.45.0.12',
        rootPath: '/home/deploy'
      })
    )
    const terminalFileManagerPanel = store.panels.find((panel) => panel.id === store.activePanelId)
    expect(terminalFileManagerPanel?.output).not.toContain('[file manager]')
    expect(terminalFileManagerPanel?.outputSegments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('[file manager]') })])
    )

    store.setActiveModule('workspace')
    await expect(store.updateTerminalSettings({ rightMouseEvent: 'paste' })).resolves.toBe(true)
    await wrapper.find('.xterm-host').trigger('contextmenu')
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('test-session-local', 'clipboard-command')
    expect(store.activePanel.output).not.toContain('clipboard-command')
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(false)

    await expect(store.updateTerminalSettings({ middleMouseEvent: 'contextMenu' })).resolves.toBe(true)
    await wrapper.find('.xterm-host').trigger('mousedown', { button: 1 })
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(true)

    store.createPanel()
    await wrapper.vm.$nextTick()
    const activePanelId = store.activePanelId
    await expect(store.updateTerminalSettings({ middleMouseEvent: 'closeTab' })).resolves.toBe(true)
    await wrapper.findAll('.xterm-host').at(1)!.trigger('mousedown', { button: 1 })
    expect(store.panels.some((panel) => panel.id === activePanelId)).toBe(false)

    wrapper.unmount()
  })

  it('matches External reference-style Files workspace modes, sessions, and transfer panel', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(FilesWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()

    try {
      expect(wrapper.text()).toContain('拖拽模式')
      expect(wrapper.find('.files-transfer-layout').exists()).toBe(true)
      expect(wrapper.text()).toContain('新增连接 或 左侧拖拽至此')
      expect(store.fileTransferTasks).toEqual([])
      expect(wrapper.find('.transfer-progress-panel').exists()).toBe(false)
      expect(store.selectedRightFileSessionId).toBe('local')

      await wrapper.findAll('.files-session-header button[title="关闭"]').at(0)!.trigger('click')
      expect(store.selectedRightFileSessionId).toBeNull()
      expect(wrapper.text()).toContain('新增连接 或 左侧拖拽至此')
      const rightEmptyDrop = wrapper.findAll('.files-empty-drop').at(1)!
      const sftpPayload = {
        uuid: 'asset-dropped',
        ip: '10.50.0.8',
        host: '10.50.0.8',
        title: 'drop-host',
        hostname: 'drop-host',
        username: 'ops',
        asset_type: 'person'
      }
      await rightEmptyDrop.trigger('drop', {
        dataTransfer: {
          getData: vi.fn((type: string) => (type === 'application/x-asset-sftp' ? JSON.stringify(sftpPayload) : ''))
        }
      })
      expect(window.aiops.saveFileSessionFromSftpPayload).toHaveBeenCalledWith(sftpPayload)
      expect(store.selectedRightFileSessionId).toBe('asset-dropped')
      expect(store.fileSessions.find((session) => session.id === 'asset-dropped')).toEqual(
        expect.objectContaining({
          label: 'drop-host',
          host: '10.50.0.8',
          rootPath: '/home/ops'
        })
      )
      const duplicateDropEffect = { value: '' }
      await wrapper.findAll('.files-transfer-side').at(1)!.trigger('drop', {
        dataTransfer: {
          get dropEffect() {
            return duplicateDropEffect.value
          },
          set dropEffect(value: string) {
            duplicateDropEffect.value = value
          },
          getData: vi.fn((type: string) => (type === 'application/x-asset-sftp' ? JSON.stringify(sftpPayload) : ''))
        }
      })
      expect(duplicateDropEffect.value).toBe('none')

      await wrapper.findAll('.files-mode-switch button').find((button) => button.text().includes('默认模式'))!.trigger('click')
      expect(store.filesUiMode).toBe('default')
      expect(wrapper.find('.files-default-layout').exists()).toBe(true)
      expect(wrapper.text()).toContain('Local')

      await wrapper.findAll('.files-mode-switch button').find((button) => button.text().includes('拖拽模式'))!.trigger('click')
      await wrapper.findAll('.files-session-header button[title="添加"]').at(0)!.trigger('click')
      expect(wrapper.find('.file-modal-card.add-conn').exists()).toBe(true)
      expect(wrapper.findAll('.add-conn-list button').find((button) => button.text().includes('drop-host'))!.classes()).toContain('disabled')
      await wrapper.findAll('.add-conn-tabs button').find((button) => button.text().includes('从资产添加'))!.trigger('click')
      await wrapper.find('.add-conn-search input').setValue('staging')
      await wrapper.find('.add-conn-search input').trigger('keydown', { key: 'ArrowDown' })
      expect(wrapper.find('.add-conn-list button.keyboard-selected').text()).toContain('staging-files')
      await wrapper.find('.add-conn-search input').trigger('keydown', { key: 'Enter' })
      expect(store.selectedRightFileSessionId).toBe('folder_asset-2')
      expect(wrapper.find('.file-modal-card.add-conn').exists()).toBe(false)

      store.openFileSession('local', 'left')
      await flushPromises()
      const leftBrowser = wrapper.findAllComponents(FileBrowser).find((browser) => browser.props('panelSide') === 'left')!
      const rightBrowser = wrapper.findAllComponents(FileBrowser).find((browser) => browser.props('panelSide') === 'right')!
      const sourceRow = leftBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
      const dragPayload = new Map<string, string>()
      await sourceRow.trigger('dragstart', {
        dataTransfer: {
          effectAllowed: '',
          setData: vi.fn((type: string, value: string) => dragPayload.set(type, value))
        }
      })
      expect(JSON.parse(dragPayload.get('application/x-synchro-fs-item') || '{}')).toEqual(
        expect.objectContaining({
          kind: 'fs-item',
          fromUuid: 'local',
          fromSide: 'left',
          srcPath: '/release-note.md',
          name: 'release-note.md',
          isDir: false
        })
      )
      const sameSideDropEffect = { value: '' }
      await leftBrowser.find('.file-drop-zone').trigger('dragover', {
        dataTransfer: {
          get dropEffect() {
            return sameSideDropEffect.value
          },
          set dropEffect(value: string) {
            sameSideDropEffect.value = value
          },
          getData: vi.fn((type: string) => dragPayload.get(type) || '')
        }
      })
      expect(sameSideDropEffect.value).toBe('none')

      const rightDirectoryRow = rightBrowser.findAll('tbody tr').find((row) => row.text().includes('boot'))!
      await rightDirectoryRow.trigger('drop', {
        dataTransfer: {
          getData: vi.fn((type: string) => dragPayload.get(type) || '')
        }
      })
      await flushPromises()
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-file', localPath: '/release-note.md', remoteDirectory: '/home/staging/boot' },
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/release-note.md' && task.target === '/home/staging/boot/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'release-note.md',
          fromHost: '127.0.0.1',
          toHost: '10.24.9.20',
          status: 'success'
        })
      )

      const remoteDirectoryDragPayload = new Map<string, string>()
      await rightDirectoryRow.trigger('dragstart', {
        dataTransfer: {
          effectAllowed: '',
          setData: vi.fn((type: string, value: string) => remoteDirectoryDragPayload.set(type, value))
        }
      })
      expect(JSON.parse(remoteDirectoryDragPayload.get('application/x-synchro-fs-item') || '{}')).toEqual(
        expect.objectContaining({
          kind: 'fs-item',
          fromUuid: 'folder_asset-2',
          fromSide: 'right',
          srcPath: '/home/staging/boot',
          name: 'boot',
          isDir: true
        })
      )
      await leftBrowser.find('.file-drop-zone').trigger('drop', {
        dataTransfer: {
          getData: vi.fn((type: string) => remoteDirectoryDragPayload.get(type) || '')
        }
      })
      await flushPromises()
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'download-directory', remotePath: '/home/staging/boot', localDirectory: '/' },
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2', host: '10.24.9.20', fromHost: '10.24.9.20', toHost: '127.0.0.1' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/home/staging/boot' && task.target === '/boot')).toEqual(
        expect.objectContaining({
          type: 'download',
          name: 'boot',
          isGroup: true,
          fromHost: '10.24.9.20',
          toHost: '127.0.0.1',
          status: 'success'
        })
      )

      await rightBrowser.find('.file-drop-zone').trigger('drop', {
        dataTransfer: {
          files: [{ path: '/tmp/os-drop.log' }],
          getData: vi.fn(() => '')
        }
      })
      await flushPromises()
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-path', localPath: '/tmp/os-drop.log', remoteDirectory: '/home/staging' },
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/os-drop.log' && task.target === '/home/staging/os-drop.log')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'os-drop.log',
          toHost: '10.24.9.20',
          status: 'success'
        })
      )
      expect(store.fileTransferTasks.some((task) => task.name === 'dropped-item' || task.source === 'drag-source')).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload.log'] })
      const uploadFileButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传文件')!
      await uploadFileButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile'], defaultPath: '/home/staging' }))
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-file', localPath: '/tmp/local-upload.log', remoteDirectory: '/home/staging' },
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload.log' && task.target === '/home/staging/local-upload.log')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'local-upload.log',
          toHost: '10.24.9.20',
          status: 'success'
        })
      )

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload-dir'] })
      const uploadDirectoryButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传目录')!
      await uploadDirectoryButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/home/staging' }))
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-directory', localPath: '/tmp/local-upload-dir', remoteDirectory: '/home/staging' },
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload-dir' && task.target === '/home/staging/local-upload-dir')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'local-upload-dir',
          isGroup: true,
          stage: 'scanning',
          status: 'success'
        })
      )

      const remoteFileRow = rightBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
      await remoteFileRow.trigger('dblclick')
      await flushPromises()
      expect(window.aiops.readFileContent).toHaveBeenCalledWith(
        '/home/staging/release-note.md',
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2', host: '10.24.9.20', rootPath: '/home/staging' })
      )
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
      expect(wrapper.find('[data-testid="files-editor-monaco"]').exists()).toBe(true)
      expect(wrapper.find('.files-editor-toolbar').text()).toContain('编辑文件 /home/staging/release-note.md')
      const editorCount = wrapper.findAll('.files-floating-editor').length
      await remoteFileRow.trigger('dblclick')
      expect(wrapper.findAll('.files-floating-editor')).toHaveLength(editorCount)
      const editorBeforeDrag = wrapper.find('.files-floating-editor').attributes('style')
      await wrapper.find('.files-editor-toolbar').trigger('mousedown', { clientX: 120, clientY: 90 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 140 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.files-floating-editor').attributes('style')).not.toBe(editorBeforeDrag)
      const editorBeforeResize = wrapper.find('.files-floating-editor').attributes('style')
      await wrapper.find('.files-editor-resize-handle').trigger('mousedown', { clientX: 900, clientY: 600 })
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 940, clientY: 640 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.files-floating-editor').attributes('style')).not.toBe(editorBeforeResize)
      await wrapper.find('.files-editor-toolbar button[title="全屏"]').trigger('click')
      expect(wrapper.find('.files-floating-editor').classes()).toContain('fullscreen')
      vi.mocked(window.aiops.recordFileTransferTask).mockClear()
      await wrapper.find('.files-editor-body').setValue('changed remote note')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
      await flushPromises()
      expect(window.aiops.writeFileContent).toHaveBeenCalledWith(
        '/home/staging/release-note.md',
        'changed remote note',
        expect.objectContaining({ kind: 'remote', sessionId: 'folder_asset-2', host: '10.24.9.20', rootPath: '/home/staging' })
      )
      expect(store.fileTransferTasks.find((task) => task.name === 'save release-note.md' && task.source === '/home/staging/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'r2r',
          target: '/home/staging/release-note.md',
          status: 'success',
          speed: '已保存'
        })
      )
      expect(window.aiops.recordFileTransferTask).not.toHaveBeenCalled()
      await wrapper.find('.files-editor-body').setValue('changed remote note again')
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      expect(wrapper.find('.file-modal-card.small').text()).toContain('保存确认')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('取消'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('不保存'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(false)

      const runningTransfer = await window.aiops.recordFileTransferTask({
        type: 'r2r',
        name: 'deploy-dir',
        source: '/tmp/deploy-dir',
        target: '/srv/deploy-dir',
        progress: 40,
        speed: 'pending',
        status: 'running',
        isGroup: true,
        totalFiles: 2,
        finishedFiles: 1,
        children: [
          {
            id: 'test-child-transfer',
            type: 'r2r',
            name: 'app.log',
            source: '/tmp/deploy-dir/app.log',
            target: '/srv/deploy-dir/app.log',
            progress: 20,
            speed: 'pending',
            status: 'running'
          }
        ]
      })
      expect(runningTransfer.ok).toBe(true)
      const runningTransferTask = store.pushFileTransferTask(runningTransfer.data!.task)!
      await wrapper.vm.$nextTick()
      const groupTransferTask = wrapper.findAll('.transfer-task').find((task) => task.text().includes('deploy-dir'))!
      await groupTransferTask.find('.transfer-task-progress button').trigger('click')
      expect(wrapper.text()).toContain('app.log')
      await groupTransferTask.find('.transfer-task-children button[title="取消"]').trigger('click')
      await flushPromises()
      expect(window.aiops.cancelFileTransferTask).toHaveBeenCalledWith({ id: runningTransferTask.children![0].id })
      expect(store.fileTransferTasks.find((task) => task.id === runningTransferTask.id)?.status).toBe('failed')
      await vi.advanceTimersByTimeAsync(800)
      expect(store.fileTransferTasks.some((task) => task.id === runningTransferTask.id)).toBe(false)

      await wrapper.find('.transfer-progress-panel header button').trigger('click')
      expect(wrapper.find('.transfer-fab').exists()).toBe(true)
      expect(wrapper.find('.transfer-fab-kind').exists()).toBe(true)
      await wrapper.find('.transfer-fab').trigger('click')
      expect(wrapper.find('.transfer-progress-panel').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('supports External reference-style file table hidden toggle, rename, more menu, and move dialog', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const localSession = await loadTestFileSession('local')
    const wrapper = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(wrapper.text()).toContain('.hidden')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-picked'] })
    await wrapper.findAll('.file-icon-button').find((button) => button.attributes('title') === '打开文件夹')!.trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/' }))
    expect((wrapper.find('.file-path-input').element as HTMLInputElement).value).toBe('/tmp/local-picked')
    expect(wrapper.text()).toContain('已打开 /tmp/local-picked')

    await wrapper.findAll('.file-icon-button').find((button) => button.attributes('title') === '隐藏隐藏文件')!.trigger('click')
    expect(wrapper.text()).not.toContain('.hidden')

    const releaseRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await releaseRow.find('.file-row-actions button[title="重命名"]').trigger('click')
    await releaseRow.find('.file-rename-row input').setValue('release-note-v2.md')
    await releaseRow.find('.file-rename-row button[title="确认"]').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'rename', oldPath: '/tmp/local-picked/release-note.md', newPath: '/tmp/local-picked/release-note-v2.md' },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(wrapper.text()).toContain('release-note-v2.md')
    expect(wrapper.text()).toContain('重命名成功')

    const renamedRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note-v2.md'))!
    vi.mocked(window.aiops.recordFileTransferTask).mockClear()
    await renamedRow.find('.file-row-actions button[title="权限"]').trigger('click')
    expect(wrapper.find('.file-modal-card.small').text()).toContain('权限设置 - release-note-v2.md')
    expect((wrapper.find('.permission-code input').element as HTMLInputElement).value).toBe('644')
    await wrapper.findAll('.permission-check input').find((input) => (input.element as HTMLInputElement).value === '执行')!.setValue(true)
    await wrapper.find('.permission-recursive input').setValue(true)
    await wrapper.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'chmod', path: '/tmp/local-picked/release-note-v2.md', mode: '744', recursive: true },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(wrapper.text()).toContain('权限已更新为 744')
    expect(wrapper.text()).toContain('-744')

    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockReset()
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/downloads/release-note-v2.md' })
    await renamedRow.find('.file-row-actions button[title="下载"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'release-note-v2.md' })
    expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
      { kind: 'download-file', remotePath: '/tmp/local-picked/release-note-v2.md', localPath: '/tmp/downloads/release-note-v2.md' },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(store.fileTransferTasks.find((task) => task.name === 'release-note-v2.md' && task.target === '/tmp/downloads/release-note-v2.md')).toEqual(
      expect.objectContaining({
        type: 'download',
        name: 'release-note-v2.md',
        fromHost: '127.0.0.1',
        status: 'success'
      })
    )
    expect(wrapper.text()).toContain('release-note-v2.md 下载成功')

    const listCallsBeforeCancelledDownload = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/downloads/release-note-v2-cancelled.md' })
    vi.mocked(window.aiops.transferFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'cancelled',
        source: '/tmp/local-picked/release-note-v2.md',
        target: '/tmp/downloads/release-note-v2-cancelled.md',
        bytes: 0,
        files: 1,
        mtimeMs: Date.now(),
        itemKind: 'file',
        task: {
          id: 'transfer-cancelled-download',
          type: 'download',
          name: 'release-note-v2.md',
          source: '/tmp/local-picked/release-note-v2.md',
          target: '/tmp/downloads/release-note-v2-cancelled.md',
          progress: 80,
          speed: '已取消',
          status: 'failed'
        }
      }
    })
    await renamedRow.find('.file-row-actions button[title="下载"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('release-note-v2.md 下载已取消')
    expect(wrapper.text()).not.toContain('release-note-v2.md 下载成功')
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(listCallsBeforeCancelledDownload)

    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    expect(wrapper.find('.file-more-menu').exists()).toBe(true)
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('复制绝对路径'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/tmp/local-picked/release-note-v2.md')
    expect(wrapper.text()).toContain('绝对路径已复制')
    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('复制'))!.trigger('click')
    expect(wrapper.text()).toContain('复制到')
    expect(wrapper.find('.move-breadcrumb-row').exists()).toBe(true)
    await wrapper.find('.move-breadcrumb-menu-trigger').trigger('click')
    await flushPromises()
    expect(wrapper.find('.move-dir-menu').text()).toContain('boot')
    await wrapper.findAll('.move-dir-menu button').find((button) => button.text().includes('boot'))!.trigger('click')
    expect((wrapper.find('.move-target-input').exists())).toBe(false)
    expect(wrapper.text()).toContain('boot')
    await wrapper.find('.move-path-edit-trigger').trigger('click')
    await wrapper.find('.move-target-input').setValue('/tmp/local-picked')
    await wrapper.find('.move-target-input').trigger('keydown', { key: 'Enter' })
    await wrapper.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('冲突提示')
    expect((wrapper.find('.file-modal-card.small input').element as HTMLInputElement).value).toBe('release-note-v2_1.md')
    await wrapper.find('.file-modal-card.small input').setValue('   ')
    await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('重命名'))!.trigger('click')
    expect(wrapper.text()).toContain('请输入新文件名')
    const beforeConflictTasks = store.fileTransferTasks.length
    await wrapper.find('.file-modal-card.small input').setValue('release-note-v2_1.md')
    await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('重命名'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'copy', srcPath: '/tmp/local-picked/release-note-v2.md', targetPath: '/tmp/local-picked/release-note-v2_1.md', overwrite: false },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(store.fileTransferTasks).toHaveLength(beforeConflictTasks + 1)
    expect(store.fileTransferTasks.find((task) => task.target === '/tmp/local-picked/release-note-v2_1.md')).toEqual(
      expect.objectContaining({
        name: 'release-note-v2_1.md',
        source: '/tmp/local-picked/release-note-v2.md',
        target: '/tmp/local-picked/release-note-v2_1.md',
        type: 'r2r',
        status: 'success'
      })
    )

    const secondRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note-v2.md'))!
    await secondRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('移动'))!.trigger('click')
    await wrapper.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect((wrapper.find('.file-modal-card.small input').element as HTMLInputElement).value).toBe('release-note-v2_2.md')
    await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('覆盖'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'move', srcPath: '/tmp/local-picked/release-note-v2.md', targetPath: '/tmp/local-picked/release-note-v2.md', overwrite: true },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-picked/release-note-v2.md' && task.target === '/tmp/local-picked/release-note-v2.md')).toEqual(
      expect.objectContaining({
        name: 'release-note-v2.md',
        target: '/tmp/local-picked/release-note-v2.md',
        status: 'success'
      })
    )

    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('删除'))!.trigger('click')
    expect(wrapper.find('.file-delete-confirm').text()).toContain('/tmp/local-picked/release-note-v2.md')
    await wrapper.find('.file-delete-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'delete', path: '/tmp/local-picked/release-note-v2.md', recursive: false },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(wrapper.text()).toContain('删除成功')
    expect(wrapper.text()).not.toContain('release-note-v2.md')
    expect(window.aiops.recordFileTransferTask).not.toHaveBeenCalled()
  })

  it('does not silently ignore Files open/upload/download dialog bridge failures', async () => {
    const originalAiops = {
      showOpenDialog: window.aiops.showOpenDialog,
      showSaveDialog: window.aiops.showSaveDialog
    }

    try {
      const pinia = createPinia()
      setActivePinia(pinia)
      const localSession = await loadTestFileSession('local')
      const localBrowser = mount(FileBrowser, {
        props: {
          session: localSession,
          uiMode: 'default'
        },
        global: { plugins: [pinia] }
      })
      await flushPromises()
      ;(window.aiops as any).showOpenDialog = undefined
      await localBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '打开文件夹')!.trigger('click')
      await flushPromises()
      expect(localBrowser.text()).toContain('打开文件夹对话框服务不可用')
      expect((localBrowser.find('.file-path-input').element as HTMLInputElement).value).toBe('/')
      localBrowser.unmount()

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      const remoteSession = await loadTestFileSession('folder_asset-2')
      const remoteBrowser = mount(FileBrowser, {
        props: {
          session: remoteSession,
          uiMode: 'default'
        },
        global: { plugins: [pinia] }
      })
      await flushPromises()

      vi.mocked(window.aiops.transferFileEntry).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await remoteBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传文件')!.trigger('click')
      await flushPromises()
      expect(remoteBrowser.text()).toContain('上传文件选择对话框服务不可用')
      expect(window.aiops.transferFileEntry).not.toHaveBeenCalled()

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      vi.mocked(window.aiops.showOpenDialog!).mockRejectedValueOnce(new Error('dialog crashed'))
      await remoteBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传目录')!.trigger('click')
      await flushPromises()
      expect(remoteBrowser.text()).toContain('上传目录选择对话框失败')
      expect(window.aiops.transferFileEntry).not.toHaveBeenCalled()

      const remoteFileRow = remoteBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
      ;(window.aiops as any).showSaveDialog = undefined
      await remoteFileRow.find('.file-row-actions button[title="下载"]').trigger('click')
      await flushPromises()
      expect(remoteBrowser.text()).toContain('下载保存对话框服务不可用')
      expect(window.aiops.transferFileEntry).not.toHaveBeenCalled()

      ;(window.aiops as any).showSaveDialog = originalAiops.showSaveDialog
      vi.mocked(window.aiops.showSaveDialog!).mockRejectedValueOnce(new Error('save dialog crashed'))
      await remoteFileRow.find('.file-row-actions button[title="下载"]').trigger('click')
      await flushPromises()
      expect(remoteBrowser.text()).toContain('下载保存对话框失败')
      expect(window.aiops.transferFileEntry).not.toHaveBeenCalled()
      remoteBrowser.unmount()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('matches External reference-style quick command groups, edit panel, search, menus, and recording', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SnippetsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('快捷命令')
    expect(wrapper.text()).toContain('命令组')
    expect(wrapper.text()).toContain('巡检命令')
    expect(wrapper.text()).toContain('当前目录')

    await wrapper.findAll('.group-folder').find((item) => item.text().includes('巡检命令'))!.trigger('click')
    expect(store.selectedSnippetGroupUuid).toBe('group-monitor')
    expect(wrapper.text()).toContain('磁盘巡检')
    expect(wrapper.text()).not.toContain('当前目录')

    await wrapper.find('button[title="搜索"]').trigger('click')
    await wrapper.find('.snippet-search input').setValue('Nginx')
    expect(wrapper.text()).toContain('Nginx 状态')
    expect(wrapper.find('button[title="清空搜索"]').exists()).toBe(true)
    await wrapper.find('button[title="清空搜索"]').trigger('click')
    expect(store.snippetSearchQuery).toBe('')
    await wrapper.find('.snippet-search input').setValue('')
    await wrapper.find('.snippet-search input').trigger('blur')

    await wrapper.find('button[title="新建片段"]').trigger('click')
    expect(wrapper.text()).toContain('新建片段')
    expect(wrapper.text()).toContain('脚本语法说明')
    await wrapper.find('.script-help .help-header').trigger('click')
    await wrapper.find('.copy-example').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('sleep==2000'))
    await wrapper.find('.snippet-edit-panel input').setValue('新片段')
    await wrapper.find('.script-editor-container textarea').setValue('pwd\nsleep==1000\nctrl+c')
    await wrapper.find('.snippet-edit-panel footer').findAll('button')[1].trigger('click')
    await flushPromises()
    expect(store.quickCommands.some((command) => command.snippet_name === '新片段')).toBe(true)

    const commandCard = wrapper.findAll('.snippet-item').find((item) => item.text().includes('磁盘巡检'))!
    store.panels[0].sessionId = 'snippet-panel-main'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    await commandCard.trigger('contextmenu')
    expect(wrapper.find('.snippet-context-menu').exists()).toBe(true)
    await wrapper.find('.snippet-context-menu').findAll('button').find((button) => button.text().includes('全部窗口执行'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledTimes(1)
    expect(window.aiops.writeTerminal).toHaveBeenNthCalledWith(1, 'snippet-panel-main', 'df -h\n')
    expect(store.panels[0].output).not.toContain('df -h')
    expect(store.panels[0].output).not.toContain('du -sh * | sort -h')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenNthCalledWith(2, 'snippet-panel-main', 'du -sh * | sort -h\n')
    expect(store.panels[0].output).not.toContain('du -sh * | sort -h')
    expect(store.panels[0].output).not.toContain('[snippet] 磁盘巡检')

    await wrapper.find('button[title="宏录制"]').trigger('click')
    expect(store.isMacroRecording).toBe(true)
    expect(store.macroTerminalId).toBe(store.activePanelId)
    expect(wrapper.text()).toContain('录制中')
    store.recordMacroTerminalInput(store.activePanelId, 'uptime\n')
    await wrapper.findAll('.recording-status-bar button').find((button) => button.text().includes('停止录制'))!.trigger('click')
    await flushPromises()
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('uptime'))).toBe(true)

    await wrapper.find('button[title="宏录制"]').trigger('click')
    store.recordMacroTerminalInput(store.activePanelId, 'date')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('date')
    await wrapper.findAll('.recording-status-bar button').find((button) => button.text().includes('停止录制'))!.trigger('click')
    await flushPromises()
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-'))).toBe(true)
  })

  it('matches External reference-style quick command macro control keys, sleep threshold, and auto-stop', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mount(SnippetsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    store.setMacroSleepThreshold(400)
    store.startMacroRecording('panel-main')
    store.recordMacroTerminalInput('panel-main', 'uptime\n', 1000)
    store.recordMacroTerminalInput('panel-main', '\x1b[A', 1600)
    store.recordMacroTerminalInput('panel-main', 'whoami\n', 1650)
    store.recordMacroTerminalInput('panel-secondary', 'ignored\n', 1700)
    const saved = await store.stopMacroRecording()
    expect(saved?.snippet_content).toBe('uptime\nsleep==600\nup\nwhoami')

    store.startMacroRecording('panel-main')
    for (let index = 0; index < 50; index += 1) {
      store.recordMacroCommand(`cmd-${index}`, 2000 + index)
    }
    await flushPromises()
    expect(store.isMacroRecording).toBe(false)
    expect(store.macroLimitReason).toBe('count')
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('cmd-49'))).toBe(true)

    store.startMacroRecording('panel-main')
    store.recordMacroTerminalInput('panel-main', 'staged command')
    store.cancelMacroRecording()
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_content === 'staged command')).toBe(false)
  })

  it('keeps External reference paste mode from submitting the final quick command after sleep lines', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    const command = (await store.createQuickCommand({
      snippet_name: '粘贴不执行最后一行',
      snippet_content: 'echo first\nsleep==500\necho second',
      group_uuid: null
    }))!

    store.activePanel.sessionId = 'snippet-paste-session'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const run = store.runQuickCommand(command.id, false)
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenNthCalledWith(1, 'snippet-paste-session', 'echo first\n')
    expect(store.activePanel.output).not.toContain('echo first')
    expect(store.activePanel.output).not.toContain('echo second')
    await vi.advanceTimersByTimeAsync(500)
    await run
    expect(window.aiops.writeTerminal).toHaveBeenNthCalledWith(2, 'snippet-paste-session', 'echo second')
    expect(store.activePanel.output).not.toContain('echo second')
    expect(store.activePanel.output).not.toContain('echo second\n[snippet]')
  })

  it('matches External reference-style knowledge tree search, add menu, context actions, rename, capacity, and import progress', async () => {
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(KnowledgePanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('知识库')
    expect(wrapper.text()).toContain('commands')
    expect(wrapper.text()).toContain('我的容量')

    await wrapper.find('.kb-search input').setValue('interface')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('interface.png')
    expect(wrapper.find('.kb-search-results').exists()).toBe(true)
    expect(wrapper.text()).toContain('内容搜索')
    expect(wrapper.text()).toContain('commands/diagnose.md')
    expect(window.aiops.kbSearch).toHaveBeenCalledWith('interface', { maxResults: 12, minScore: 0.15 })
    await wrapper.find('.kb-search-result').trigger('click')
    expect(store.activePanel).toEqual(
      expect.objectContaining({
        id: 'kb:commands/diagnose.md',
        kind: 'knowledge',
        knowledge: expect.objectContaining({ relPath: 'commands/diagnose.md', startLine: 2, endLine: 8 })
      })
    )
    expect(wrapper.text()).not.toContain('Summary to Doc.md')
    await wrapper.find('.kb-search input').setValue('')
    await flushPromises()
    await wrapper.vm.$nextTick()
    store.kbSelectedKeys = []

    await wrapper.find('.kb-add-button').trigger('click')
    expect(wrapper.find('.kb-add-menu').exists()).toBe(true)
    await wrapper.find('.kb-add-menu').findAll('button').find((button) => button.text().includes('新建文件夹'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.kbSelectedKeys[0]).toContain('New Folder')

    const selectedPath = store.kbSelectedKeys[0]
    await wrapper.find('.kb-rename-input').setValue('Runbooks')
    await wrapper.find('.kb-rename-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.findKnowledgeNode(selectedPath)).toBeNull()
    expect(store.findKnowledgeNode('Runbooks')).toBeTruthy()

    const markdownNode = wrapper.findAll('.kb-tree-node').find((node) => node.text().includes('Markdown语法指南.md'))!
    await markdownNode.trigger('contextmenu')
    expect(wrapper.find('.kb-context-menu').exists()).toBe(true)
    await wrapper.find('.kb-context-menu').findAll('button').find((button) => button.text().includes('复制路径'))!.trigger('click')

    await wrapper.find('.kb-capacity-detail-link').trigger('click')
    expect(wrapper.text()).toContain('容量来源明细')
    await wrapper.find('.file-modal-card header button').trigger('click')

    await wrapper.find('.kb-add-button').trigger('click')
    await wrapper.find('.kb-add-menu').findAll('button').find((button) => button.text().includes('上传文件'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.kbImportJobs.length).toBe(1)
    expect(window.aiops.kbCheckPath).toHaveBeenCalledWith('/tmp/imported-note.md')
    expect(window.aiops.kbImportFile).toHaveBeenCalledWith('/tmp/imported-note.md', '')

    vi.mocked(window.aiops.kbCheckPath).mockClear()
    vi.mocked(window.aiops.kbImportFolder).mockClear()
    const droppedFolder = new File(['folder'], 'folder') as File & { path?: string }
    Object.defineProperty(droppedFolder, 'path', { configurable: true, value: '/tmp/imported/folder' })
    await wrapper.find('.kb-sidebar-root').trigger('drop', {
      dataTransfer: {
        files: [droppedFolder]
      }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.kbCheckPath).toHaveBeenCalledWith('/tmp/imported/folder')
    expect(window.aiops.kbImportFolder).toHaveBeenCalledWith('/tmp/imported/folder', '')

    const originalKbCheckPath = window.aiops.kbCheckPath
    vi.mocked(window.aiops.kbImportFile).mockClear()
    vi.mocked(window.aiops.kbImportFolder).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/bridge-missing.md'] })
    ;(window.aiops as any).kbCheckPath = undefined
    try {
      await wrapper.find('.kb-add-button').trigger('click')
      await wrapper.find('.kb-add-menu').findAll('button').find((button) => button.text().includes('上传文件'))!.trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(store.topNotice).toBe('知识库导入需要路径检查服务')
      expect(store.kbImportJobs.some((job) => job.destRelPath.includes('bridge-missing.md'))).toBe(false)
      expect(window.aiops.kbImportFile).not.toHaveBeenCalled()
      expect(window.aiops.kbImportFolder).not.toHaveBeenCalled()
    } finally {
      ;(window.aiops as any).kbCheckPath = originalKbCheckPath
    }
  })

  it('opens External reference-style knowledge files in the main workspace editor and adds them to AI context', async () => {
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    mockXtermInstances.length = 0
    const pinia = createPinia()
    setActivePinia(pinia)
    const panel = mount(KnowledgePanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()
    await panel.vm.$nextTick()

    const markdownNode = panel.findAll('.kb-tree-node').find((node) => node.text().includes('Markdown语法指南.md'))!
    await markdownNode.trigger('click')
    expect(store.activePanel).toEqual(
      expect.objectContaining({
        id: 'kb:Markdown语法指南.md',
        kind: 'knowledge',
        knowledge: expect.objectContaining({ relPath: 'Markdown语法指南.md', isImage: false })
      })
    )

    const workspace = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.find('.kb-editor-root').exists()).toBe(true)
    expect(workspace.text()).toContain('Markdown语法指南.md')
    expect(workspace.find('[data-testid="kb-editor-monaco"]').exists()).toBe(true)
    const textarea = workspace.find('.kb-editor-textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('content:Markdown语法指南.md')

    store.openKnowledgeFile('commands/diagnose.md', { startLine: 2, endLine: 8 })
    await flushPromises()
    await workspace.vm.$nextTick()
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('diagnose.md')
    expect(monacoMocks.editorInstance.setSelection).toHaveBeenCalledWith({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 8,
      endColumn: 80
    })
    const diagnosePanelId = store.activePanelId
    store.openKnowledgeFile('commands/diagnose.md', { startLine: 5, endLine: 6 })
    await flushPromises()
    await workspace.vm.$nextTick()
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(store.activePanelId).toBe(diagnosePanelId)
    expect(monacoMocks.editorInstance.setSelection).toHaveBeenCalledWith({
      startLineNumber: 5,
      startColumn: 1,
      endLineNumber: 6,
      endColumn: 80
    })
    store.openKnowledgeFile('Markdown语法指南.md')
    await flushPromises()
    await workspace.vm.$nextTick()

    const markdownContent =
      '# Runbook\n\n![diagram](images/interface.png)\n\n| Name | State |\n| :--- | ---: |\n| api | ok |\n\n```bash\necho ok\n```\n\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```\n\n<script>alert(1)</script>\n<img src="javascript:alert(1)" onerror="alert(2)" alt="bad">\n<a href="javascript:alert(3)" onclick="alert(4)">bad link</a>'
    await textarea.setValue(markdownContent)
    await workspace.findAll('.kb-editor-mode button').find((button) => button.text().includes('预览'))!.trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    const preview = workspace.find('.kb-markdown-preview')
    expect(preview.exists()).toBe(true)
    expect(preview.find('h1').text()).toBe('Runbook')
    expect(preview.find('table').exists()).toBe(true)
    expect(preview.find('pre code').text()).toContain('echo ok')
    expect(preview.find('pre code').classes()).toContain('hljs')
    expect(preview.find('.mermaid').attributes('data-processed')).toBe('true')
    expect(preview.find('img').attributes('src')).toContain(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64)
    expect(preview.html()).not.toContain('<script')
    expect(preview.html()).not.toContain('onerror')
    expect(preview.html()).not.toContain('onclick')
    expect(preview.html()).not.toContain('javascript:')
    expect(window.aiops.kbReadFile).toHaveBeenCalledWith('images/interface.png', 'base64')

    await workspace.findAll('.kb-editor-mode button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await workspace.vm.$nextTick()
    const editedTextarea = workspace.find('.kb-editor-textarea')
    await editedTextarea.setValue('updated markdown')
    await workspace.findAll('.kb-editor-actions > button').find((button) => button.text().includes('保存'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.kbWriteFile).toHaveBeenCalledWith('Markdown语法指南.md', 'updated markdown')

    const originalFileReader = window.FileReader
    const originalGlobalFileReader = globalThis.FileReader
    class ForbiddenFileReader {
      constructor() {
        throw new Error('renderer FileReader must not read pasted knowledge images')
      }
    }
    try {
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: ForbiddenFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: ForbiddenFileReader })
      vi.mocked(window.aiops.kbWriteFile).mockClear()
      vi.mocked(window.aiops.kbPasteImageFromClipboard).mockClear()
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        value: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => new File(['image-bytes'], 'clip.png', { type: 'image/png' })
            }
          ]
        }
      })
      workspace.find('.kb-editor-root').element.dispatchEvent(pasteEvent)
      await flushPromises()
      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(window.aiops.kbPasteImageFromClipboard).toHaveBeenCalledWith('')
      expect(vi.mocked(window.aiops.kbWriteFile).mock.calls.some((call) => call[2] === 'base64')).toBe(false)
      expect((workspace.find('.kb-editor-textarea').element as HTMLTextAreaElement).value).toContain('![](pasted-image-')
    } finally {
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })
    }

    await markdownNode.trigger('contextmenu')
    await panel.find('.kb-context-menu').findAll('button').find((button) => button.text().includes('添加到聊天'))!.trigger('click')
    await flushPromises()
    expect(store.selectedContexts.some((context) => context.id === 'kb-doc:Markdown语法指南.md')).toBe(true)
    expect(store.rightPanelOpen).toBe(true)

    const imageNode = panel.findAll('.kb-tree-node').find((node) => node.text().includes('interface.png'))!
    await imageNode.trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(store.activePanel.knowledge).toEqual({ relPath: 'images/interface.png', isImage: true })
    expect(workspace.text()).toContain('interface.png')
    expect(workspace.find('.kb-editor-image img').attributes('src')).toContain(DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64)
    expect(workspace.find('.kb-editor-image-controls').text()).toContain('100%')
    await workspace.find('.kb-editor-image-controls button[title="放大"]').trigger('click')
    expect(workspace.find('.kb-editor-image-controls').text()).toContain('125%')
    await workspace.find('.kb-editor-image-controls button[title="重置"]').trigger('click')
    expect(workspace.find('.kb-editor-image-controls').text()).toContain('100%')

    const aiPanel = mount(AiPanel, {
      global: { plugins: [pinia] }
    })
    const createDataTransferMock = () => {
      const data = new Map<string, string>()
      return {
        effectAllowed: '',
        dropEffect: '',
        setData: vi.fn((type: string, value: string) => data.set(type, value)),
        getData: vi.fn((type: string) => data.get(type) || '')
      }
    }
    const imageTab = workspace.findAll('.terminal-tab').find((tab) => tab.text().includes('interface.png'))!
    expect(imageTab.attributes('draggable')).toBe('true')
    const imageTransfer = createDataTransferMock()
    const imageDragEvent = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(imageDragEvent, 'dataTransfer', { configurable: true, value: imageTransfer })
    imageTab.element.dispatchEvent(imageDragEvent)
    expect(imageTransfer.setData).toHaveBeenCalledWith('application/x-aiopsterm-context', expect.stringContaining('"contextType":"image"'))

    const imageDropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(imageDropEvent, 'dataTransfer', { configurable: true, value: imageTransfer })
    aiPanel.find('.chat-input').element.dispatchEvent(imageDropEvent)
    await flushPromises()
    expect(store.selectedContexts.some((context) => context.id === 'kb-image:images/interface.png')).toBe(true)
    expect(window.aiops.kbReadFile).toHaveBeenCalledWith('images/interface.png', 'base64')
    expect(aiPanel.find('[data-testid="ai-message-input"]').text()).toContain('引用知识库：interface.png')
    expect(aiPanel.find('.chat-editable .mention-chip-images').exists()).toBe(true)

    store.openKnowledgeFile('Markdown语法指南.md')
    await workspace.vm.$nextTick()
    const docTab = workspace.findAll('.terminal-tab').find((tab) => tab.text().includes('Markdown语法指南.md'))!
    const docTransfer = createDataTransferMock()
    const docDragEvent = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(docDragEvent, 'dataTransfer', { configurable: true, value: docTransfer })
    docTab.element.dispatchEvent(docDragEvent)
    expect(docTransfer.setData).toHaveBeenCalledWith('application/x-aiopsterm-context', expect.stringContaining('"contextType":"doc"'))

    const docDropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(docDropEvent, 'dataTransfer', { configurable: true, value: docTransfer })
    aiPanel.find('.chat-input').element.dispatchEvent(docDropEvent)
    await flushPromises()
    expect(store.selectedContexts.some((context) => context.id === 'kb-doc:Markdown语法指南.md')).toBe(true)

    aiPanel.unmount()
    workspace.unmount()
    panel.unmount()
  })

  it('prevents markdown image paste when the knowledge image write bridge is unavailable or fails', async () => {
    const originalKbWriteFile = window.aiops.kbWriteFile
    const originalPasteImageFromClipboard = window.aiops.kbPasteImageFromClipboard

    const mountEditor = async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mount(KnowledgeCenterEditor, {
        attachTo: document.body,
        props: { relPath: 'runbooks/paste.md' },
        global: {
          plugins: [pinia],
          stubs: {
            KnowledgeMonacoEditor: {
              props: ['modelValue'],
              template: '<textarea class="kb-editor-textarea" :value="modelValue" />'
            }
          }
        }
      })
      await flushPromises()
      await wrapper.vm.$nextTick()
      return wrapper
    }

    const createImagePasteEvent = () => {
      const pastedFile = new File(['image-bytes'], 'clip.png', { type: 'image/png' })
      const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', {
        configurable: true,
        value: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => pastedFile
            }
          ]
        }
      })
      return event
    }

    try {
      vi.mocked(originalKbWriteFile).mockClear()
      vi.mocked(originalPasteImageFromClipboard).mockClear()
      ;(window.aiops as any).kbPasteImageFromClipboard = undefined
      const missingBridgeWrapper = await mountEditor()
      const missingBridgeEvent = createImagePasteEvent()
      missingBridgeWrapper.find('.kb-editor-root').element.dispatchEvent(missingBridgeEvent)
      await flushPromises()
      await missingBridgeWrapper.vm.$nextTick()
      expect(missingBridgeEvent.defaultPrevented).toBe(true)
      expect(missingBridgeWrapper.text()).toContain('Knowledge image paste service unavailable')
      expect(missingBridgeWrapper.text()).not.toContain('![](pasted-image-')
      expect(originalPasteImageFromClipboard).not.toHaveBeenCalled()
      expect(originalKbWriteFile).not.toHaveBeenCalled()
      missingBridgeWrapper.unmount()

      ;(window.aiops as any).kbPasteImageFromClipboard = originalPasteImageFromClipboard
      vi.mocked(originalKbWriteFile).mockClear()
      vi.mocked(originalPasteImageFromClipboard).mockClear()
      vi.mocked(originalPasteImageFromClipboard).mockRejectedValueOnce(new Error('image paste failed'))
      const failedWriteWrapper = await mountEditor()
      const failedWriteEvent = createImagePasteEvent()
      failedWriteWrapper.find('.kb-editor-root').element.dispatchEvent(failedWriteEvent)
      await flushPromises()
      await failedWriteWrapper.vm.$nextTick()
      expect(failedWriteEvent.defaultPrevented).toBe(true)
      expect(originalPasteImageFromClipboard).toHaveBeenCalledWith('runbooks')
      expect(originalKbWriteFile).not.toHaveBeenCalled()
      expect(failedWriteWrapper.text()).toContain('image paste failed')
      expect(failedWriteWrapper.text()).not.toContain('![](pasted-image-')
      failedWriteWrapper.unmount()
    } finally {
      ;(window.aiops as any).kbWriteFile = originalKbWriteFile
      ;(window.aiops as any).kbPasteImageFromClipboard = originalPasteImageFromClipboard
    }
  })

  it('matches External reference-style extension list, plugin details, built-ins, and Alias CRUD', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.refreshExtensionPlugins()
    await store.refreshAliasCommands()
    const panel = mount(ExtensionsPanel, {
      global: { plugins: [pinia] }
    })

    expect(panel.text()).toContain('插件')
    expect(panel.text()).toContain('Jumpserver Support')
    expect(panel.text()).toContain('支持资产同步与资产直连')
    expect(panel.text()).toContain('Alias')
    expect(panel.text()).toContain('系统')
    expect(panel.text()).toContain('Installed')
    expect(panel.text()).toContain('Store')
    expect(panel.text()).toContain('Update available')
    expect(panel.text()).toContain('Private')
    expect(panel.find('button[title="安装"]').exists()).toBe(true)
    expect(panel.find('button[title="订阅"]').exists()).toBe(true)
    expect(panel.find('button[title="更新"]').exists()).toBe(true)

    await panel.find('button[title="订阅"]').trigger('click')
    await flushPromises()
    expect(window.aiops.openExtensionSubscription).toHaveBeenCalledWith({
      plugin: expect.objectContaining({
        pluginId: 'private-automation-pack',
        installed: false,
        installable: false,
        isPrivate: true
      })
    })
    expect(store.extensionNotice).toContain('订阅')

    const badDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(badDrop, 'dataTransfer', { configurable: true, value: { files: [{ name: 'plugin.zip' }] } })
    panel.element.dispatchEvent(badDrop)
    await panel.vm.$nextTick()
    expect(store.extensionNotice).toContain('插件包格式错误')

    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true }) as DragEvent
    panel.element.dispatchEvent(dragEnter)
    await panel.vm.$nextTick()
    expect(store.extensionDragActive).toBe(true)

    const validDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(validDrop, 'dataTransfer', { configurable: true, value: { files: [{ name: 'local-tools.external-reference', path: '/tmp/local-tools.external-reference', size: 4096 }] } })
    panel.element.dispatchEvent(validDrop)
    await panel.vm.$nextTick()
    expect(store.extensionDragActive).toBe(false)
    expect(window.aiops.installExtensionPackage).toHaveBeenCalledWith({
      fileName: 'local-tools.external-reference',
      filePath: '/tmp/local-tools.external-reference',
      size: 4096,
      existingPluginIds: expect.arrayContaining(['jumpserverSupport', 'cloud-assets'])
    })
    expect(store.extensionInstallLoadingMap['local-local-tools']).toBe(true)
    expect(store.extensionInstallProgressMap['local-local-tools']).toMatchObject({ stage: 'installing', percent: 100 })
    expect(panel.text()).toContain('正在安装 local tools')
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    await new Promise((resolve) => setTimeout(resolve, 140))
    await flushPromises()
    await panel.vm.$nextTick()
    expect(store.selectedExtensionId).toBe('local-local-tools')
    expect(store.extensionPlugins.some((plugin) => plugin.pluginId === 'local-local-tools' && plugin.installed)).toBe(true)

    await panel.find('.extension_search_box input').setValue('Alias')
    expect(panel.text()).toContain('Alias')
    expect(panel.text()).not.toContain('Cloud Assets')

    await panel.find('.extension_item').trigger('click')
    expect(store.selectedExtensionId).toBe('Alias')

    await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(true)
    await panel.vm.$nextTick()
    expect(panel.text()).not.toContain('Alias')
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    await expect(store.updateExtensionSettings({ aliasStatus: true })).resolves.toBe(true)
    await panel.find('.extension_search_box input').setValue('Alias')
    expect(panel.text()).toContain('Alias')
    await panel.find('.extension_item').trigger('click')
    expect(store.selectedExtensionId).toBe('Alias')

    const workspace = mount(ExtensionsWorkspace, {
      global: { plugins: [pinia] }
    })
    expect(workspace.text()).toContain('添加命令')
    expect(store.aliasCommands.some((alias) => alias.alias === 'll')).toBe(true)
    expect(store.aliasCommands.some((alias) => alias.command === 'git status')).toBe(true)

    await workspace.find('.alias-search-input input').setValue('gst')
    const filteredAliasInputs = workspace.findAll('.alias-config-table tbody tr input').map((input) => (input.element as HTMLInputElement).value)
    const filteredCommandInputs = workspace.findAll('.alias-config-table tbody tr textarea').map((input) => (input.element as HTMLTextAreaElement).value)
    expect(filteredAliasInputs).toEqual(['gst'])
    expect(filteredCommandInputs).toEqual(['git status'])
    await workspace.find('.alias-search-input input').setValue('')

    await workspace.find('.alias-search-input input').setValue('no-hit')
    await workspace.find('.alias-config-toolbar button').trigger('click')
    expect(store.aliasSearchQuery).toBe('')
    expect(workspace.findAll('.alias-config-table tbody tr')[0].find('input').element).toBeTruthy()
    await workspace.findAll('.alias-config-table tbody tr')[0].find('button[title="保存"]').trigger('click')
    expect(store.extensionNotice).toContain('不能为空')
    await workspace.findAll('.alias-config-table tbody tr')[0].find('input').setValue('ll')
    await workspace.findAll('.alias-config-table tbody tr')[0].find('textarea').setValue('ls')
    await workspace.findAll('.alias-config-table tbody tr')[0].find('button[title="保存"]').trigger('click')
    expect(store.extensionNotice).toContain('已存在')
    await workspace.findAll('.alias-config-table tbody tr')[0].find('button[title="取消"]').trigger('click')

    await workspace.find('.alias-config-toolbar button').trigger('click')
    const newRow = workspace.findAll('.alias-config-table tbody tr')[0]
    await newRow.find('input').setValue('ports')
    await newRow.find('textarea').setValue('ss -tulpn')
    await newRow.find('button[title="保存"]').trigger('click')
    await workspace.vm.$nextTick()
    expect(store.aliasCommands.some((alias) => alias.alias === 'ports' && alias.command === 'ss -tulpn')).toBe(true)

    const aliasRow = workspace.findAll('.alias-config-table tbody tr').find((row) => (row.find('input').element as HTMLInputElement).value === 'ports')!
    await aliasRow.find('button[title="编辑"]').trigger('click')
    await aliasRow.find('input').setValue('ports2')
    await aliasRow.find('textarea').setValue('netstat -tunlp')
    await aliasRow.find('button[title="取消"]').trigger('click')
    expect(store.aliasCommands.some((alias) => alias.alias === 'ports' && alias.command === 'ss -tulpn')).toBe(true)
    expect(store.aliasCommands.some((alias) => alias.alias === 'ports2')).toBe(false)

    await workspace.find('.alias-config-toolbar button').trigger('click')
    await workspace.find('.alias-config-toolbar button').trigger('click')
    expect(store.aliasCommands.filter((alias) => alias.id === 'new')).toHaveLength(1)
    await workspace.findAll('.alias-config-table tbody tr')[0].find('button[title="取消"]').trigger('click')
    expect(store.aliasCommands.some((alias) => alias.id === 'new')).toBe(false)

    await aliasRow.find('button[title="删除"]').trigger('click')
    expect(store.aliasCommands.some((alias) => alias.alias === 'ports')).toBe(false)

    store.selectExtension('jumpserverSupport')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Jumpserver Support')
    expect(workspace.text()).toContain('同步资产并确认主机分组')
    expect(workspace.text()).toContain('connected to bastion host')
    expect(workspace.find('.connection_log_terminal').exists()).toBe(true)
    expect(workspace.find('.mock_terminal').exists()).toBe(false)

    store.selectExtension('ops-runbook')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Ops Runbook')
    expect(workspace.text()).toContain('插件功能')
    expect(workspace.text()).toContain('插件标识')
    expect(workspace.text()).toContain('最后更新')
    expect(workspace.text()).toContain('插件分类')
    expect(workspace.text()).toContain('Runbook')
    expect(workspace.text()).toContain('卸载')
    expect(workspace.text()).toContain('更新')

    void store.updateExtensionPlugin('ops-runbook')
    await workspace.vm.$nextTick()
    expect(window.aiops.updateExtensionPlugin).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ pluginId: 'ops-runbook', installed: true, hasUpdate: true })
    })
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
    expect(store.selectedExtensionInstallProgress?.stage).toBe('downloading')
    expect(workspace.text()).toContain('取消')
    await store.cancelExtensionInstall('ops-runbook')
    await workspace.vm.$nextTick()
    expect(window.aiops.cancelExtensionInstall).toHaveBeenCalledWith('ops-runbook')
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
    expect(store.selectedExtensionInstallProgress?.stage).toBe('cancelled')

    store.selectExtension('private-automation-pack')
    await workspace.vm.$nextTick()
    const subscribeButton = workspace.findAll('button').find((button) => button.text() === '订阅')!
    await subscribeButton.trigger('click')
    await flushPromises()
    expect(window.aiops.openExtensionSubscription).toHaveBeenLastCalledWith({
      plugin: expect.objectContaining({
        pluginId: 'private-automation-pack',
        installed: false,
        installable: false,
        isPrivate: true
      })
    })
    expect(store.extensionNotice).toContain('订阅')

    void store.installExtensionPlugin('cloud-assets')
    store.selectExtension('cloud-assets')
    await workspace.vm.$nextTick()
    expect(window.aiops.installExtensionPlugin).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ pluginId: 'cloud-assets', installed: false, latestVersion: '0.9.1' })
    })
    expect(store.extensionInstallLoadingMap['cloud-assets']).toBe(true)
    expect(workspace.text()).toContain('取消')
    expect(workspace.text()).toContain('Downloading')
  })

  it('matches External reference-style Kubernetes contexts, cluster sidebar, config, terminal, and modals', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    try {
      const panel = mount(KubernetesPanel, {
        global: { plugins: [pinia] }
      })
      const store = useWorkspaceStore()
      await flushPromises()
      await panel.vm.$nextTick()

      expect(panel.text()).toContain('prod-cluster')
      expect(panel.text()).toContain('staging/devops')
      await panel.find('.k8s-search input').setValue('staging')
      expect(panel.text()).toContain('staging-cluster')
      expect(panel.text()).not.toContain('prod-cluster')
      await panel.find('.k8s-search-clear').trigger('click')
      expect(store.k8sSearchQuery).toBe('')
      await panel.find('.k8s-search input').setValue('staging')

      const stagingRow = panel.findAll('.k8s-cluster-item').find((row) => row.text().includes('staging-cluster'))!
      await stagingRow.find('button[title="更多"]').trigger('click')
      expect(store.k8sClusterActionMenuId).toBe('k8s-2')
      await stagingRow.find('.k8s-cluster-menu').findAll('button').find((button) => button.text().includes('连接'))!.trigger('click')
      await flushPromises()
      expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connected')
      expect(window.aiops.connectKubernetesCluster).toHaveBeenCalledWith('k8s-2')

      await stagingRow.find('button[title="更多"]').trigger('click')
      await stagingRow.find('.k8s-cluster-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
      expect(store.k8sEditModalOpen).toBe(true)
      store.clearK8sSearch()

      const workspace = mount(KubernetesWorkspace, {
        global: { plugins: [pinia] }
      })
      await flushPromises()
      await workspace.vm.$nextTick()
      expect(workspace.text()).toContain('Kubernetes')
      expect(workspace.text()).toContain('prod/admin')
      expect(workspace.text()).toContain('本地集群')
      expect(workspace.text()).toContain('堡垒机资源')

      await workspace.findAll('.k8s-context-item').find((item) => item.text().includes('prod/admin'))!.trigger('click')
      expect(store.k8sContexts.find((context) => context.name === 'prod/admin')?.isActive).toBe(true)

      store.selectK8sCluster('k8s-1')
      await workspace.vm.$nextTick()
      expect(workspace.text()).toContain('危险区域')
      await workspace.find('.k8s-detail-form label input').setValue('prod-renamed')
      await workspace.find('.k8s-form-actions .primary').trigger('click')
      expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-1')?.name).toBe('prod-renamed')
      await workspace.findAll('.k8s-form-actions.inline button').find((button) => button.text().includes('Agent 代理'))!.trigger('click')
      expect(store.k8sProxyConfigOpen).toBe(true)
      await workspace.find('.k8s-proxy-config-modal .k8s-switch-row input').setValue(true)
      await workspace.find('.k8s-proxy-config-modal select').setValue('HTTPS')
      const proxyInputs = workspace.findAll('.k8s-proxy-config-modal input')
      await proxyInputs[1].setValue('proxy.k8s.local')
      await proxyInputs[2].setValue('9443')
      await workspace.find('.k8s-proxy-config-modal footer .primary').trigger('click')
      expect(store.k8sProxyConfig).toMatchObject({ enabled: true, type: 'HTTPS', host: 'proxy.k8s.local', port: 9443 })
      if (store.k8sSelectedCluster?.connection_status === 'connected') {
        await workspace.findAll('.k8s-form-actions.inline button').find((button) => button.text().includes('断开'))!.trigger('click')
        await flushPromises()
        await workspace.vm.$nextTick()
      }
      await workspace.findAll('.k8s-form-actions.inline button').find((button) => button.text().includes('连接'))!.trigger('click')
      await flushPromises()
      expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-1')?.connection_status).toBe('connected')
      expect(store.k8sClusterNotice).toContain('proxy.k8s.local:9443')
      vi.mocked(window.aiops.createKubernetesTerminal).mockClear()
      await workspace.findAll('.k8s-form-actions.inline button').find((button) => button.text().includes('打开终端'))!.trigger('click')
      await flushPromises()
      await workspace.vm.$nextTick()
      expect(store.k8sActiveTerminal?.clusterId).toBe('k8s-1')
      expect(window.aiops.createKubernetesTerminal).toHaveBeenCalledWith({ clusterId: 'k8s-1', namespace: undefined, cols: undefined, rows: undefined })
      expect(workspace.find('.k8s-terminal-meta').text()).toContain('Session:')
      expect(workspace.find('.k8s-terminal-meta').text()).toContain('Status: connected')
      expect(store.k8sActiveTerminal?.output).toContain('Connecting to cluster prod-renamed...')
      expect(store.k8sActiveTerminal?.output).not.toContain(`[session ${store.k8sActiveTerminal?.sessionId}] connected`)

    await workspace.find('.k8s-command-line input').setValue('kubectl get pods -A')
    await workspace.find('.k8s-command-line').trigger('submit')
    await flushPromises()
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl get pods -A')
    await workspace.vm.$nextTick()
    expect(workspace.find('.k8s-terminal-history').text()).toContain('kubectl get pods -A')
    const firstTerminalId = store.k8sActiveTerminal!.id
    await workspace.find('.k8s-terminal-tabs .k8s-workspace-button').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(store.k8sActiveTerminal?.id).not.toBe(firstTerminalId)
    expect(store.k8sTerminalTabs.filter((tab) => tab.clusterId === 'k8s-1')).toHaveLength(2)
    await workspace.find('.k8s-terminal-meta button[title="同步尺寸"]').trigger('click')
    await flushPromises()
    expect(store.k8sActiveTerminal?.cols).toBe(88)
    await workspace.find('.k8s-command-line input').setValue('kubectl get ns')
    await workspace.find('.k8s-terminal-meta button[title="采集命令输出到 AI"]').trigger('click')
    expect(store.chatMessages.at(-2)?.text).toContain('Terminal output')
    expect(store.chatMessages.at(-2)?.hosts?.[0].label).toBe('prod-renamed')
    await workspace.find('.k8s-terminal-meta button[title="结束会话"]').trigger('click')
    await flushPromises()
    expect(store.k8sActiveTerminal?.status).toBe('ended')
    expect((workspace.find('.k8s-command-line input').element as HTMLInputElement).disabled).toBe(true)

    store.k8sActiveClusterId = 'k8s-1'
    store.k8sResourceNamespace = 'all'
    store.k8sResourceQuery = ''
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('资源概览')
    expect(workspace.text()).toContain('Pods')
    expect(workspace.text()).toContain('Deployments')
    expect(workspace.text()).toContain('Services')
    expect(workspace.text()).toContain('Nodes')
    expect(workspace.text()).toContain('api-gateway-6d8c9bb7f6-l6j2m')
    expect(workspace.find('.k8s-agent-bar').text()).toContain('Agent')
    expect(workspace.find('.k8s-agent-bar').text()).toContain('prod/admin')
    await workspace.find('.k8s-agent-bar button').trigger('click')
    expect(store.k8sResourceOutput).toContain('Server Version')
    await vi.advanceTimersByTimeAsync(160)
    await workspace.findAll('.k8s-agent-bar button').find((button) => button.text().includes('Namespaces'))!.trigger('click')
    expect(store.k8sResourceOutput).toContain('kubectl get namespaces')
    expect(store.k8sResourceOutput).toContain('ingress-nginx')
    await workspace.find('.k8s-agent-command input').setValue('kubectl get deployments -A')
    await workspace.find('.k8s-agent-command').trigger('submit')
    expect(store.k8sAgentRuns[0].command).toBe('kubectl get deployments -A')
    expect(store.k8sResourceOutput).toContain('api-gateway')
    expect(workspace.find('.k8s-agent-history').text()).toContain('kubectl get deployments -A')
    await workspace.find('.k8s-agent-bar select').setValue('k8s-2')
    expect(store.k8sAgentCurrentCluster).toMatchObject({ clusterId: 'k8s-2', contextName: 'staging/devops' })
    await workspace.findAll('.k8s-agent-bar button').find((button) => button.text().includes('Cleanup'))!.trigger('click')
    expect(store.k8sAgentStatus).toBe('idle')
    await workspace.find('.k8s-resource-filter select').setValue('ops')
    expect(store.k8sResourceNamespace).toBe('ops')
    expect(workspace.text()).toContain('billing-worker-7f9d6f9dd9-rx8mm')
    expect(workspace.text()).not.toContain('api-gateway-6d8c9bb7f6-l6j2m')
    await workspace.find('.k8s-resource-search input').setValue('billing')
    expect(store.filteredK8sResources).toHaveLength(1)
    const billingRow = workspace.findAll('.k8s-resource-table tbody tr').find((row) => row.text().includes('billing-worker-7f9d6f9dd9-rx8mm'))!
    await billingRow.find('button[title="Describe"]').trigger('click')
    expect(store.k8sResourceOutput).toContain('kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    await billingRow.find('button[title="Logs"]').trigger('click')
    expect(store.k8sResourceOutput).toContain('kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')
    await workspace.find('.k8s-resource-output-actions button[title="复制输出"]').trigger('click')
    expect(store.k8sClusterNotice).toBe('Kubernetes 输出已复制')
    await workspace.find('.k8s-resource-output-actions button[title="发送输出命令到终端"]').trigger('click')
    await flushPromises()
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')
    await workspace.find('.k8s-resource-output-actions button[title="发送输出到 AI"]').trigger('click')
    expect(store.chatMessages.at(-2)?.text).toContain('Kubernetes 输出')
    await workspace.find('.k8s-resource-output-actions button[title="清空输出"]').trigger('click')
    expect(store.k8sResourceOutputTitle).toBe('资源输出')
    await billingRow.find('button[title="Describe"]').trigger('click')
    await flushPromises()
    await billingRow.find('button[title="发送到终端"]').trigger('click')
    await flushPromises()
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    await workspace.find('.k8s-resource-search input').setValue('')
    await workspace.findAll('.k8s-resource-kind-tabs button').find((button) => button.text().includes('Nodes'))!.trigger('click')
    expect(store.k8sResourceKind).toBe('nodes')
    expect(store.k8sResourceNamespace).toBe('all')
    expect(workspace.text()).toContain('prod-node-01')

    await workspace.findAll('.k8s-tab-bar button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
    expect(store.k8sConfigTab).toBe('jumpserver')
    expect(workspace.text()).toContain('jumpserver-org')
    await workspace.find('.k8s-group-header button[title="同步"]').trigger('click')
    expect(store.k8sClusters.some((cluster) => cluster.source_type === 'jumpserver')).toBe(true)

    store.k8sAddModalOpen = true
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('添加集群')
    expect(workspace.text()).toContain('Context')
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/prod-kubeconfig.yaml'] })
    const prodKubeconfigContent = [
      'apiVersion: v1',
      'kind: Config',
      'current-context: prod/admin',
      'clusters:',
      '- name: prod-cluster',
      '  cluster:',
      '    server: https://prod.k8s.local:6443',
      '- name: staging-cluster',
      '  cluster:',
      '    server: https://staging.k8s.local:6443',
      'contexts:',
      '- name: prod/admin',
      '  context:',
      '    cluster: prod-cluster',
      '    namespace: default',
      '- name: staging/devops',
      '  context:',
      '    cluster: staging-cluster',
      '    namespace: staging'
    ].join('\n')
    vi.mocked(window.aiops.importKubernetesKubeconfig).mockClear()
    vi.mocked(window.aiops.readLocalFile).mockClear()
    await workspace.find('.k8s-file-picker-row button').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      defaultPath: '~/.kube',
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'YAML Files', extensions: ['yaml', 'yml'] }
      ]
    })
    expect(window.aiops.importKubernetesKubeconfig).toHaveBeenCalledWith({ kubeconfigPath: '/tmp/prod-kubeconfig.yaml' })
    expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
    expect(store.k8sClusterNotice).toContain('发现 2 个 Context')
    expect(store.k8sImportContexts).toHaveLength(2)
    const testConnectionButton = workspace.find('.k8s-test-connection button')
    expect(testConnectionButton.attributes('disabled')).toBeUndefined()
    vi.mocked(window.aiops.testKubernetesClusterConnection).mockClear()
    await testConnectionButton.trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.testKubernetesClusterConnection).toHaveBeenCalledWith({
      contextName: 'prod/admin',
      serverUrl: 'https://prod.k8s.local:6443',
      kubeconfigPath: '/tmp/prod-kubeconfig.yaml',
      kubeconfigContent: prodKubeconfigContent
    })
    expect(store.k8sTestResult).toBe(true)
    await workspace.find('.k8s-add-cluster-modal footer .primary').trigger('click')
    expect(store.k8sClusters.some((cluster) => cluster.name === 'prod-cluster')).toBe(true)
    expect(store.k8sContexts.some((context) => context.name === 'prod/admin')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches External reference-style Database sidebar, tabs, SQL results, data grid, menus, and modals', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    expect(wrapper.text()).toContain('Database')
    expect(wrapper.text()).toContain('Default Group')
    expect(wrapper.text()).toContain('orders-postgres')
    expect(wrapper.find('.db-workspace-tab').text()).toContain('Overview')
    expect(wrapper.text()).toContain('New Connection')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Create connection')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Explore schemas')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Query console')
    expect(wrapper.find('.db-engine-grid').text()).toContain('MySQL')
    expect(wrapper.find('.db-engine-grid').text()).toContain('H2')
    expect(wrapper.find('.db-engine-grid').text()).toContain('SQLServer')
    expect(wrapper.find('.db-engine-grid').text()).toContain('Timeplus')
    expect(wrapper.findAll('.db-engine-grid button')).toHaveLength(16)
    expect(wrapper.findAll('.db-engine-grid button').filter((button) => button.classes().includes('disabled'))).toHaveLength(12)
    await wrapper.findAll('.db-overview-tips button').find((button) => button.text().includes('Explore schemas'))!.trigger('click')
    expect(document.activeElement).toBe(wrapper.find('.db-search input').element)
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('SQLServer'))!.trigger('click')
    expect(wrapper.text()).toContain('SQLServer connection is coming soon')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('PostgreSQL'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('PostgreSQL')
    expect(wrapper.find('.db-connection-modal').text()).toContain('SSL Mode')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')

    await wrapper.find('.db-search input').setValue('metrics')
    expect(wrapper.text()).toContain('metrics-mysql')
    expect(wrapper.text()).not.toContain('orders-postgres')
    expect(wrapper.find('.db-search-clear').exists()).toBe(true)
    await wrapper.find('.db-search-clear').trigger('click')
    expect((wrapper.find('.db-search input').element as HTMLInputElement).value).toBe('')
    await wrapper.find('.db-search input').setValue('oracle')
    await wrapper.find('.db-search input').trigger('keydown', { key: 'Escape' })
    expect((wrapper.find('.db-search input').element as HTMLInputElement).value).toBe('')

    await wrapper.find('button[title="Add"]').trigger('click')
    expect(wrapper.find('.db-add-menu').exists()).toBe(true)
    expect(wrapper.find('.db-add-menu').text()).toContain('H2')
    expect(wrapper.find('.db-add-menu').text()).toContain('SQLServer')
    expect(wrapper.find('.db-add-menu').text()).toContain('Timeplus')
    expect(wrapper.find('.db-add-menu').findAll('button')).toHaveLength(17)
    expect(wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('H2'))!.attributes('disabled')).toBeDefined()
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('PostgreSQL'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)
    const pgModalInputs = wrapper.findAll('.db-connection-modal input')
    await pgModalInputs.at(0)!.setValue('')
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    expect(wrapper.find('.db-modal-feedback').text()).toContain('Fix required fields')
    expect(pgModalInputs.at(0)!.classes()).toContain('error')
    await pgModalInputs.at(0)!.setValue('e2e-postgres')
    expect(wrapper.find('.db-connection-modal').text()).toContain('SSL Mode')
    const pgModalSelects = wrapper.findAll('.db-connection-modal select')
    await pgModalSelects.at(3)!.setValue('verify-full')
    expect((pgModalInputs.at(6)!.element as HTMLInputElement).value).toBe('jdbc:postgresql://127.0.0.1:5432')
    await pgModalInputs.at(6)!.setValue('jdbc:postgresql://manual-host:15432/manualdb')
    await pgModalInputs.at(1)!.setValue('10.10.10.20')
    expect((wrapper.findAll('.db-connection-modal input').at(6)!.element as HTMLInputElement).value).toBe('jdbc:postgresql://manual-host:15432/manualdb')
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(window.aiops.testDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        dbType: 'postgresql',
        name: 'e2e-postgres',
        host: '10.10.10.20',
        port: 5432,
        user: 'root',
        sslMode: 'verify-full',
        url: 'jdbc:postgresql://manual-host:15432/manualdb'
      })
    )
    expect(wrapper.text()).toContain('PostgreSQL 16 local backend validation')
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'create',
        connection: expect.objectContaining({
          dbType: 'postgresql',
          name: 'e2e-postgres',
          host: '10.10.10.20',
          sslMode: 'verify-full'
        })
      })
    )
    expect(wrapper.text()).toContain('e2e-postgres')

    const postgresRow = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('orders-postgres'))!
    await postgresRow.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Editor Source'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('Edit Connection')
    const editInputs = wrapper.findAll('.db-connection-modal input')
    expect((editInputs.at(0)!.element as HTMLInputElement).value).toBe('orders-postgres')
    expect(editInputs.at(4)!.attributes('placeholder')).toContain('Leave empty')
    await editInputs.at(0)!.setValue('orders-pg-edited')
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'edit',
        id: 'conn-prod-pg',
        connection: expect.objectContaining({
          name: 'orders-pg-edited',
          password: ''
        })
      })
    )
    expect(wrapper.text()).toContain('orders-pg-edited')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/aiopsterm/unit-cache.sqlite3'] })
    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('SQLite'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('Readonly')
    await wrapper.find('.db-connection-file button').trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile'] }))
    const sqliteInputs = wrapper.findAll('.db-connection-modal input')
    expect((sqliteInputs.at(1)!.element as HTMLInputElement).value).toBe('/tmp/aiopsterm/unit-cache.sqlite3')
    expect((sqliteInputs.at(3)!.element as HTMLInputElement).value).toBe('sqlite:///tmp/aiopsterm/unit-cache.sqlite3')
    await sqliteInputs.at(0)!.setValue('unit-sqlite')
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(window.aiops.testDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        dbType: 'sqlite',
        name: 'unit-sqlite',
        filePath: '/tmp/aiopsterm/unit-cache.sqlite3',
        readonly: true,
        url: 'sqlite:///tmp/aiopsterm/unit-cache.sqlite3'
      })
    )
    expect(wrapper.text()).toContain('SQLite local backend validation')
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'create',
        connection: expect.objectContaining({
          dbType: 'sqlite',
          name: 'unit-sqlite',
          filePath: '/tmp/aiopsterm/unit-cache.sqlite3'
        })
      })
    )
    expect(wrapper.text()).toContain('unit-sqlite')

    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('SQLite'))!.trigger('click')
    const invalidSqliteInputs = wrapper.findAll('.db-connection-modal input')
    await invalidSqliteInputs.at(0)!.setValue('fail-sqlite')
    await invalidSqliteInputs.at(1)!.setValue('/tmp/aiopsterm/not-a-db.txt')
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-modal-feedback').text()).toContain('SQLite file should end')
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')

    const originalShowOpenDialog = window.aiops.showOpenDialog
    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('SQLite'))!.trigger('click')
    try {
      ;(window.aiops as any).showOpenDialog = undefined
      await wrapper.find('.db-connection-file button').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-modal-feedback').text()).toContain('SQLite file picker service is unavailable')
      const missingPickerInputs = wrapper.findAll('.db-connection-modal input')
      expect((missingPickerInputs.at(1)!.element as HTMLInputElement).value).toBe('')
      expect((missingPickerInputs.at(3)!.element as HTMLInputElement).value).toBe('sqlite://')

      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      vi.mocked(window.aiops.showOpenDialog!).mockRejectedValueOnce(new Error('dialog crashed'))
      await wrapper.find('.db-connection-file button').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-modal-feedback').text()).toContain('SQLite file picker failed')
      const failedPickerInputs = wrapper.findAll('.db-connection-modal input')
      expect((failedPickerInputs.at(1)!.element as HTMLInputElement).value).toBe('')
      expect((failedPickerInputs.at(3)!.element as HTMLInputElement).value).toBe('sqlite://')
    } finally {
      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      if (wrapper.find('.db-connection-modal').exists()) {
        await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
      }
    }

    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('Oracle'))!.trigger('click')
    const oracleInputs = wrapper.findAll('.db-connection-modal input')
    await oracleInputs.at(0)!.setValue('hr-oracle-url')
    await oracleInputs.at(1)!.setValue('')
    await oracleInputs.at(2)!.setValue('')
    await oracleInputs.at(3)!.setValue('hr')
    await oracleInputs.at(4)!.setValue('secret')
    await oracleInputs.at(5)!.setValue('ORCLPDB1')
    await oracleInputs.at(6)!.setValue('jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1')
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(window.aiops.testDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        dbType: 'oracle',
        name: 'hr-oracle-url',
        user: 'hr',
        database: 'ORCLPDB1',
        url: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
      })
    )
    expect(wrapper.text()).toContain('Oracle local backend validation')
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'create',
        connection: expect.objectContaining({
          dbType: 'oracle',
          name: 'hr-oracle-url',
          url: 'jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1'
        })
      })
    )
    expect(wrapper.text()).toContain('hr-oracle-url')

    const defaultGroupRow = wrapper.findAll('.db-tree-row.group').find((row) => row.text().includes('Default Group'))!
    await defaultGroupRow.trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').text()).toContain('New Connection')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('MySQL')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('SQLServer')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('Timeplus')
    expect(wrapper.find('.db-popup-submenu').findAll('button')).toHaveLength(16)
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('SQLServer'))!.attributes('disabled')).toBeDefined()
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('MySQL'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)
    const groupModalSelects = wrapper.findAll('.db-connection-modal select')
    expect((groupModalSelects.at(1)!.element as HTMLSelectElement).value).toBe('group-default')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')

    await defaultGroupRow.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('New Group'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createDatabaseGroup).toHaveBeenCalledWith({ name: 'New Group', parentId: 'group-default' })
    expect(wrapper.find('.db-tree-edit').exists()).toBe(true)
    await wrapper.find('.db-tree-edit').setValue('Child DB Group')
    await wrapper.find('.db-tree-edit').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(window.aiops.renameDatabaseGroup).toHaveBeenCalledWith({ id: 'group-new-group', name: 'Child DB Group' })
    expect(wrapper.text()).toContain('Child DB Group')
    await wrapper.findAll('.db-tree-row.group').find((row) => row.text().includes('Child DB Group'))!.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Move To'))!.trigger('mouseenter')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('Root Group')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Root Group'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.moveDatabaseGroup).toHaveBeenCalledWith({ id: 'group-new-group', parentId: null })
    expect(wrapper.text()).toContain('Group moved to root')
    await wrapper.findAll('.db-tree-row.group').find((row) => row.text().includes('Child DB Group'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Delete Group'))!.trigger('click')
    expect(wrapper.find('.db-operation-confirm').text()).toContain('Delete Group')
    expect(wrapper.find('.db-operation-confirm').text()).toContain('Child DB Group')
    await wrapper.find('.db-operation-confirm footer').findAll('button').find((button) => button.text().includes('Cancel'))!.trigger('click')
    expect(wrapper.findAll('.db-tree-row.group').some((row) => row.text().includes('Child DB Group'))).toBe(true)
    await wrapper.findAll('.db-tree-row.group').find((row) => row.text().includes('Child DB Group'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Delete Group'))!.trigger('click')
    await wrapper.find('.db-operation-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(window.aiops.deleteDatabaseGroup).toHaveBeenCalledWith('group-new-group')
    expect(wrapper.findAll('.db-tree-row.group').some((row) => row.text().includes('Child DB Group'))).toBe(false)

    const metricsConnectionRow = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!
    await metricsConnectionRow.trigger('contextmenu')
    const metricsMenuButtons = wrapper.find('.db-context-menu').findAll('button')
    expect(metricsMenuButtons.find((button) => button.text().includes('Open Connection'))).toBeTruthy()
    expect(metricsMenuButtons.find((button) => button.text().includes('Query Console'))!.attributes('disabled')).toBeDefined()
    expect(metricsMenuButtons.find((button) => button.text().includes('Create Database'))!.attributes('disabled')).toBeDefined()
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Move To'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Production'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.moveDatabaseConnection).toHaveBeenCalledWith({ connectionId: 'conn-metrics-mysql', groupId: 'group-prod' })
    expect(wrapper.findAll('.db-tree > ul > li').find((group) => group.text().includes('Production'))!.text()).toContain('metrics-mysql')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Move To'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Root Group'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.moveDatabaseConnection).toHaveBeenCalledWith({ connectionId: 'conn-metrics-mysql', groupId: 'group-default' })
    expect(wrapper.findAll('.db-tree > ul > li').find((group) => group.text().includes('Default Group'))!.text()).toContain('metrics-mysql')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Refresh'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.refreshDatabaseConnection).toHaveBeenCalledWith('conn-metrics-mysql')
    expect(wrapper.text()).toContain('Connection schema refreshed')

    const idleMetricsConnection = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!
    if (!wrapper.findAll('.db-tree-row.database').some((row) => row.text().includes('metrics'))) {
      await idleMetricsConnection.find('button').trigger('click')
    }
    const idleMetricsCatalog = wrapper.findAll('.db-tree-row.database').find((row) => row.text().includes('metrics'))!
    if (!wrapper.findAll('.db-tree-row.table').some((row) => row.text().includes('service_health'))) {
      await idleMetricsCatalog.find('button').trigger('click')
    }
    const idleServiceHealthTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('service_health'))!
    vi.mocked(window.aiops.getDatabaseTableDdl).mockClear()
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await idleServiceHealthTable.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Copy Table'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Copy Table DDL'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.getDatabaseTableDdl).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-metrics-mysql',
        dbType: 'mysql',
        databaseName: 'metrics',
        tableName: 'service_health'
      })
    )
    expect(window.aiops.getDatabaseTableDdl).toHaveBeenCalledTimes(1)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE `service_health`'))
    expect(wrapper.text()).toContain('DDL copied')
    expect(wrapper.text()).not.toContain('not connected')

    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Open Connection'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.connectDatabaseConnection).toHaveBeenCalledWith('conn-metrics-mysql')
    expect(wrapper.text()).toContain('Connection opened')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!.trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Create Database'))!.attributes('disabled')).toBeUndefined()
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Create Database'))!.trigger('click')
    expect(wrapper.find('.db-create-modal').exists()).toBe(true)
    const createDbNameInput = wrapper.find('.db-create-modal input')
    await createDbNameInput.setValue('bad-name')
    expect(createDbNameInput.classes()).toContain('error')
    expect(wrapper.find('.db-create-modal footer button[type="submit"]').attributes('disabled')).toBeDefined()
    await createDbNameInput.setValue('ops_metrics')
    expect((wrapper.find('.db-create-modal textarea').element as HTMLTextAreaElement).value).toBe('CREATE DATABASE `ops_metrics`;')
    await wrapper.find('.db-create-modal textarea').setValue('CREATE DATABASE `manual_metrics`;')
    await createDbNameInput.setValue('ignored_metrics')
    expect((wrapper.find('.db-create-modal textarea').element as HTMLTextAreaElement).value).toBe('CREATE DATABASE `manual_metrics`;')
    await wrapper.find('.db-create-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.createDatabaseCatalog).toHaveBeenCalledWith({
      connectionId: 'conn-metrics-mysql',
      requestedName: 'manual_metrics',
      sql: 'CREATE DATABASE `manual_metrics`;'
    })
    expect(wrapper.text()).toContain('Database created in workspace catalog')
    expect(wrapper.text()).toContain('manual_metrics')

    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('orders-pg-edited'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Create Database'))!.trigger('click')
    await wrapper.find('.db-create-modal input').setValue('reporting')
    expect((wrapper.find('.db-create-modal textarea').element as HTMLTextAreaElement).value).toBe('CREATE DATABASE "reporting";')
    await wrapper.find('.db-create-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.createDatabaseCatalog).toHaveBeenCalledWith({
      connectionId: 'conn-prod-pg',
      requestedName: 'reporting',
      sql: 'CREATE DATABASE "reporting";'
    })
    expect(wrapper.text()).toContain('reporting')

    await wrapper.findAll('.db-workspace-tab').find((tab) => tab.text().includes('Overview'))!.trigger('click')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!.trigger('click')
    await wrapper.find('button[title="New SQL"]').trigger('click')
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('Query 1'))).toBe(true)
    expect((wrapper.find('.db-sql-toolbar select').element as HTMLSelectElement).value).toBe('conn-metrics-mysql')
    const sqlToolbarSelectsForMetrics = wrapper.findAll('.db-sql-toolbar select')
    expect(sqlToolbarSelectsForMetrics).toHaveLength(2)
    expect(sqlToolbarSelectsForMetrics.at(0)!.classes()).toContain('db-picker--connection')
    expect(sqlToolbarSelectsForMetrics.at(0)!.text()).not.toContain('[idle]')
    expect(sqlToolbarSelectsForMetrics.at(0)!.text()).not.toContain('[failed]')
    expect(wrapper.findAll('.db-sql-toolbar option').find((option) => option.text().includes('unit-sqlite'))!.text()).not.toContain('[idle]')
    expect((sqlToolbarSelectsForMetrics.at(1)!.element as HTMLSelectElement).value).toBe('metrics')
    expect(sqlToolbarSelectsForMetrics.at(1)!.classes()).toContain('db-picker--database')
    expect(sqlToolbarSelectsForMetrics.at(1)!.text()).toContain('manual_metrics')
    await sqlToolbarSelectsForMetrics.at(1)!.setValue('manual_metrics')
    expect((wrapper.findAll('.db-sql-toolbar select').at(1)!.element as HTMLSelectElement).value).toBe('manual_metrics')
    await wrapper.findAll('.db-sql-toolbar select').at(1)!.setValue('metrics')
    const unitSqliteOptionValue = wrapper.findAll('.db-sql-toolbar option').find((option) => option.text().includes('unit-sqlite'))!.attributes('value')!
    await sqlToolbarSelectsForMetrics.at(0)!.setValue(unitSqliteOptionValue)
    await flushPromises()
    expect(window.aiops.connectDatabaseConnection).toHaveBeenCalledWith(unitSqliteOptionValue)
    expect(wrapper.text()).toContain('Connection auto-connected for SQL context')
    expect(wrapper.findAll('.db-sql-toolbar select')).toHaveLength(2)
    expect((wrapper.findAll('.db-sql-toolbar select').at(1)!.element as HTMLSelectElement).value).toBe('unit-cache.sqlite3')
    await wrapper.findAll('.db-workspace-tab').find((tab) => tab.text().includes('Overview'))!.trigger('click')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('e2e-postgres'))!.trigger('click')
    await wrapper.find('button[title="New SQL"]').trigger('click')
    expect((wrapper.find('.db-sql-toolbar select').element as HTMLSelectElement).value).toBe('conn-prod-pg')
    expect((wrapper.findAll('.db-sql-toolbar select').at(1)!.element as HTMLSelectElement).value).toBe('orders')
    expect((wrapper.findAll('.db-sql-toolbar select').at(2)!.element as HTMLSelectElement).value).toBe('public')
    await wrapper.findAll('.db-workspace-tab').find((tab) => tab.text().includes('Overview'))!.trigger('click')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('orders-pg-edited'))!.trigger('click')
    await wrapper.find('button[title="New SQL"]').trigger('click')
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('Query 3'))).toBe(true)
    expect((wrapper.find('.db-sql-toolbar select').element as HTMLSelectElement).value).toBe('conn-prod-pg')
    const sqlToolbarSelectsForPg = wrapper.findAll('.db-sql-toolbar select')
    expect(sqlToolbarSelectsForPg).toHaveLength(3)
    expect((sqlToolbarSelectsForPg.at(1)!.element as HTMLSelectElement).value).toBe('orders')
    expect((sqlToolbarSelectsForPg.at(2)!.element as HTMLSelectElement).value).toBe('public')
    expect(sqlToolbarSelectsForPg.at(2)!.classes()).toContain('db-picker--schema')
    expect(sqlToolbarSelectsForPg.at(1)!.text()).toContain('reporting')
    await sqlToolbarSelectsForPg.at(1)!.setValue('reporting')
    expect((wrapper.findAll('.db-sql-toolbar select').at(2)!.element as HTMLSelectElement).value).toBe('public')
    await wrapper.findAll('.db-sql-toolbar select').at(1)!.setValue('orders')
    expect((wrapper.findAll('.db-sql-toolbar select').at(2)!.element as HTMLSelectElement).value).toBe('public')
    await sqlToolbarSelectsForPg.at(2)!.setValue('')
    expect(wrapper.find('button[title="Run all"]').attributes('disabled')).toBeDefined()
    await wrapper.findAll('.db-sql-toolbar select').at(2)!.setValue('ops')
    expect(wrapper.find('button[title="Run all"]').attributes('disabled')).toBeUndefined()
    await wrapper.findAll('.db-sql-toolbar select').at(1)!.setValue('orders')
    expect((wrapper.findAll('.db-sql-toolbar select').at(2)!.element as HTMLSelectElement).value).toBe('public')
    const workbenchEditor = wrapper.find('.db-sql-editor')
    expect(wrapper.find('.db-sql-toolbar-run').exists()).toBe(true)
    expect(wrapper.find('.db-sql-toolbar-run-current').exists()).toBe(true)
    expect(wrapper.find('.db-sql-toolbar-explain').exists()).toBe(true)
    expect(wrapper.find('.db-sql-editor-shell').exists()).toBe(true)
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('1')
    expect(wrapper.find('.db-sql-editor-footer').text()).toContain('Ln 1, Col 1')
    expect(wrapper.find('button[title="Save As"]').exists()).toBe(true)
    expect(wrapper.find('button[title="Save As"]').attributes('disabled')).toBeDefined()
    await workbenchEditor.setValue('select id, service from public.orders where status = \'open\' order by updated_at desc limit 5; select * from public.orders where service = \'billing\';')
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('1')
    await wrapper.find('button[title="Format"]').trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT\n  id')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('\nFROM\n  public.orders')
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('2')
    await workbenchEditor.setValue('select id from public.orders;\nselect * from public.audit_events;')
    const formatEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const formatSelectionEnd = 'select id from public.orders'.length
    formatEditorElement.setSelectionRange(0, formatSelectionEnd)
    await workbenchEditor.trigger('select')
    expect(wrapper.find('.db-sql-editor-footer').text()).toContain(`${formatSelectionEnd} selected`)
    await wrapper.find('button[title="Format"]').trigger('click')
    await flushPromises()
    const selectionFormattedSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(selectionFormattedSql).toContain('SELECT\n  id')
    expect(selectionFormattedSql).toContain('select * from public.audit_events;')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-running').text()).toContain('Running query')
    expect(wrapper.find('.db-status-bar').text()).toContain('Running')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#1-1')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-tabs').text()).toContain('#1-1')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-status-bar').text()).toContain('Execution OK')
    expect(wrapper.text()).toContain('【Rows】')
    expect(wrapper.find('.db-result-tabs').attributes('role')).toBe('tablist')
    const overviewResultTab = wrapper.find('.db-result-tabs [role="tab"]')
    expect(overviewResultTab.text()).toContain('Overview')
    expect(overviewResultTab.attributes('aria-selected')).toBe('false')
    const firstResultAriaTab = wrapper.findAll('.db-result-tabs [role="tab"]').find((tab) => tab.text().includes('#1-1'))!
    expect(firstResultAriaTab.attributes('aria-selected')).toBe('true')
    expect(firstResultAriaTab.attributes('title')).toContain('#1-1')
    expect(firstResultAriaTab.find('.db-result-tab-close').attributes('aria-label')).toBe('Close result tab')
    const serviceHeader = wrapper.findAll('.db-result-table th').find((header) => header.text().includes('service'))!
    const serviceFilterButton = serviceHeader.find('button[title="Filter"]')
    vi.spyOn(serviceFilterButton.element, 'getBoundingClientRect').mockReturnValue({
      x: 960,
      y: 720,
      left: 960,
      top: 720,
      right: 982,
      bottom: 742,
      width: 22,
      height: 22,
      toJSON: () => ({})
    } as DOMRect)
    await serviceFilterButton.trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-filter-popover').text()).toContain('payment-api')
    expect(wrapper.find('.db-filter-popover').attributes('style')).toContain('left:')
    expect(Number.parseFloat(wrapper.find('.db-filter-popover').attributes('style')!.match(/left:\s*([\d.]+)px/)![1])).toBeLessThanOrEqual(window.innerWidth - 260 - 8)
    expect(document.activeElement).toBe(wrapper.find('.db-filter-search input').element)
    expect(wrapper.find('.db-filter-mode-row').exists()).toBe(false)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.db-filter-popover').exists()).toBe(false)
    await serviceFilterButton.trigger('click')
    await flushPromises()
    await wrapper.find('.db-filter-search input').setValue('orders')
    expect(wrapper.find('.db-filter-popover').text()).toContain('orders-worker')
    expect(wrapper.find('.db-filter-popover').text()).not.toContain('payment-api')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('orders-worker')
    expect(wrapper.find('.db-result-table').text()).not.toContain('payment-api')
    expect(wrapper.find('.db-status-bar').text()).toContain('4 row')
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-row.all button').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-search input').setValue('payment')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-result-table').text()).not.toContain('orders-worker')
    expect(wrapper.find('.db-filter-chip').text()).toContain('EQ payment-api')
    const sqlResultWithFilter = wrapper.findAll('.db-result-tabs [role="tab"]').find((tab) => tab.text().includes('#1-1'))!
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-row.all button').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('orders-worker')
    expect(wrapper.find('.db-filter-chip').exists()).toBe(false)
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-search input').setValue('payment')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-filter-chip').text()).toContain('EQ payment-api')
    const firstResultTab = sqlResultWithFilter
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('click')
    expect(wrapper.find('.db-result-tabs [role="tab"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('.db-sql-overview th').map((header) => header.text())).toEqual(['SQL', 'Message', 'Time'])
    expect(wrapper.find('.db-sql-overview').text()).toContain('Execution OK')
    expect(wrapper.find('.db-sql-overview').text()).toContain('ms')
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-filter-chip').text()).toContain('EQ payment-api')
    expect(wrapper.find('.db-result-table').text()).not.toContain('orders-worker')
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('keydown', { key: ' ' })
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    await firstResultTab.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    await firstResultTab.find('.db-result-tab-close').trigger('click')
    expect(wrapper.find('.db-sql-overview tbody tr').classes()).toContain('closed')
    expect(wrapper.find('.db-sql-overview-open').exists()).toBe(false)
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    await workbenchEditor.setValue('select * from public.orders; select * from public.audit_events;')
    const editorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const secondStatementOffset = editorElement.value.indexOf('select * from public.audit_events')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    expect(wrapper.find('.db-result-running').text()).toContain('select * from public.audit_events')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-sql-overview').exists()).toBe(false)
    expect(wrapper.find('.db-result-table').text()).toContain('backend query ok')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#2-1')
    editorElement.setSelectionRange(0, 'select * from public.orders'.length)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Explain"]').trigger('click')
    await waitForDatabaseSqlResult()
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('EXPLAIN select * from public.audit_events')

    await workbenchEditor.setValue('select id from "public"."orders" where status = \'open\';\nselect * from public.audit_events;')
    const convertEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const selectedConvertSql = 'select id from "public"."orders" where status = \'open\''
    convertEditorElement.setSelectionRange(0, selectedConvertSql.length)
    vi.mocked(window.aiops.createDatabaseAiDrawerRequest).mockClear()
    vi.mocked(window.aiops.startDatabaseAiDrawerResponse).mockClear()
    vi.mocked(window.aiops.cancelDatabaseAiDrawerResponse).mockClear()
    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockClear()
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Convert SQL')
    expect(wrapper.find('.db-ai-drawer').attributes('data-request-id')).toBe('dbai-drawer-request-test-1')
    expect(window.aiops.createDatabaseAiDrawerRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'convert',
        sourceSql: selectedConvertSql,
        targetDialect: 'postgresql',
        context: expect.objectContaining({
          connectionId: 'conn-prod-pg',
          dbType: 'postgresql',
          databaseName: 'orders',
          schemaName: 'public',
          contextSummary: expect.stringContaining('selection')
        })
      })
    )
    await flushPromises()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    expect(window.aiops.startDatabaseAiDrawerResponse).toHaveBeenCalledWith({ requestId: 'dbai-drawer-request-test-1' })
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-status').text()).toContain('Done')
    expect(wrapper.findAll('.db-ai-section header').map((header) => header.text())).toEqual(['Reasoning', 'Response'])
    expect(wrapper.find('.db-ai-section').text()).toContain('Read the active database context')
    expect(wrapper.find('.db-ai-dialect-row').text()).toContain('Target Dialect')
    expect((wrapper.find('.db-ai-dialect-row select').element as HTMLSelectElement).value).toBe('postgresql')
    expect(window.aiops.generateDatabaseAiDrawerResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'dbai-drawer-request-test-1',
        action: 'convert',
        sourceSql: selectedConvertSql,
        targetDialect: 'postgresql',
        context: expect.objectContaining({
          connectionId: 'conn-prod-pg',
          dbType: 'postgresql',
          databaseName: 'orders',
          schemaName: 'public',
          contextSummary: expect.stringContaining('selection')
        })
      })
    )
    await wrapper.find('.db-ai-dialect-row select').setValue('mssql')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-drawer').text()).toContain('SQL Server')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Text-only conversion')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('SELECT TOP (100)')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('[public].[orders]')
    expect(wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.attributes('disabled')).toBeDefined()
    expect(window.aiops.generateDatabaseAiDrawerResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'convert',
        targetDialect: 'mssql'
      })
    )
    await wrapper.find('.db-ai-dialect-row select').setValue('postgresql')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('"public"."orders"')
    expect(wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.attributes('disabled')).toBeUndefined()
    const readOnlyEditorBefore = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toBe(readOnlyEditorBefore)
    expect(wrapper.find('.db-result-running').text()).toContain('LIMIT 100')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-tabs').text()).toContain('#')
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Replace Selection'))!.trigger('click')
    await flushPromises()
    const replacedConvertSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(replacedConvertSql).toContain('LIMIT 100;')
    expect(replacedConvertSql).toContain('select * from public.audit_events;')
    expect(replacedConvertSql).not.toBe(wrapper.find('.db-ai-sql-actions pre').text())
    await workbenchEditor.setValue('select 1;\n-- marker')
    const insertEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const markerOffset = insertEditorElement.value.indexOf('-- marker')
    insertEditorElement.setSelectionRange(markerOffset, markerOffset)
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Insert Into Editor'))!.trigger('click')
    await flushPromises()
    const insertedConvertSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(insertedConvertSql).toContain('select 1;')
    expect(insertedConvertSql.indexOf('LIMIT 100;')).toBeGreaterThan(insertedConvertSql.indexOf('select 1;'))
    expect(insertedConvertSql.indexOf('LIMIT 100;')).toBeLessThan(insertedConvertSql.indexOf('-- marker'))
    await workbenchEditor.setValue('before selected after')
    const insertReplaceEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const selectedWordStart = insertReplaceEditorElement.value.indexOf('selected')
    insertReplaceEditorElement.setSelectionRange(selectedWordStart, selectedWordStart + 'selected'.length)
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Insert Into Editor'))!.trigger('click')
    await flushPromises()
    const insertReplacedSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(insertReplacedSql).toContain('before select id from "public"."orders"')
    expect(insertReplacedSql).toContain('LIMIT 100; after')
    expect(insertReplacedSql).not.toContain('selected')
    await workbenchEditor.setValue('select id from public.orders where')
    const completeEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    completeEditorElement.setSelectionRange(completeEditorElement.value.length, completeEditorElement.value.length)
    await wrapper.find('button[title="AI Complete SQL"]').trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Complete SQL')
    expect(wrapper.find('.db-ai-context').text()).toContain('cursor prefix')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain("where status = 'open'")
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('LIMIT 100')
    await workbenchEditor.setValue('select 1;\nselect * from public.audit_events;\n-- after cursor')
    const prefixEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const prefixOffset = prefixEditorElement.value.indexOf('select * from public.audit_events') + 'select * from public.audit_events'.length
    prefixEditorElement.setSelectionRange(prefixOffset, prefixOffset)
    await wrapper.find('button[title="AI Complete SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('select 1;')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('select * from public.audit_events')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).not.toContain('after cursor')
    await wrapper.find('button[title="AI Optimize SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-request-list').exists()).toBe(true)
    expect(wrapper.findAll('.db-ai-request-list button').map((button) => button.text()).join(' ')).toContain('Convert SQL')
    expect(wrapper.findAll('.db-ai-request-list button').map((button) => button.text()).join(' ')).toContain('Optimize SQL')
    expect(wrapper.findAll('.db-ai-request-list button').map((button) => button.attributes('data-request-id'))).toContain('dbai-drawer-request-test-1')
    await wrapper.findAll('.db-ai-request-list button').find((button) => button.text().includes('Convert SQL'))!.trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Convert SQL')
    expect(wrapper.find('.db-ai-drawer').attributes('data-request-id')).toBe('dbai-drawer-request-test-1')
    expect((wrapper.find('.db-ai-dialect-row select').element as HTMLSelectElement).value).toBe('postgresql')
    await wrapper.find('.db-ai-dialect-row select').setValue('mssql')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('[public].[orders]')
    await wrapper.findAll('.db-ai-request-list button').find((button) => button.text().includes('Optimize SQL'))!.trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Optimize SQL')
    await wrapper.findAll('.db-ai-request-list button').find((button) => button.text().includes('Convert SQL'))!.trigger('click')
    expect((wrapper.find('.db-ai-dialect-row select').element as HTMLSelectElement).value).toBe('mssql')
    await wrapper.find('button[title="AI Explain SQL"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    await wrapper.find('.db-ai-drawer footer').findAll('button').find((button) => button.text().includes('Cancel'))!.trigger('click')
    expect(window.aiops.cancelDatabaseAiDrawerResponse).toHaveBeenCalled()
    expect(wrapper.find('.db-ai-status').text()).toContain('Cancelled')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-status').text()).toContain('Cancelled')

    const publicSchemaRows = wrapper.findAll('.db-tree-row.schema').filter((row) => row.text().includes('public'))
    expect(publicSchemaRows.length).toBeGreaterThan(0)
    const publicSchemaRow = publicSchemaRows[0]
    expect(wrapper.findAll('.db-tree-row.folder').map((row) => row.text()).join(' ')).toContain('tables')
    expect(wrapper.findAll('.db-tree-row.folder').map((row) => row.text()).join(' ')).toContain('views')
    expect(wrapper.findAll('.db-tree-row.folder').map((row) => row.text()).join(' ')).toContain('functions')
    expect(wrapper.findAll('.db-tree-row.folder').map((row) => row.text()).join(' ')).toContain('procedures')
    const viewsFolder = wrapper.findAll('.db-tree-row.folder').find((row) => row.text().includes('views'))!
    await viewsFolder.find('button').trigger('click')
    const openOrdersView = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('open_orders_v'))!
    expect(openOrdersView.exists()).toBe(true)
    await openOrdersView.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Query Console'))!.trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toBe('SELECT *\nFROM "public"."open_orders_v"\nLIMIT 100;')
    await openOrdersView.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('View DDL'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ddl-modal').text()).toContain('DDL permission denied')
    expect(wrapper.find('.db-ddl-toolbar').findAll('button').find((button) => button.text().includes('Copy'))!.attributes('disabled')).toBeDefined()
    await wrapper.find('.db-ddl-modal header button').trigger('click')
    await openOrdersView.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Copy Table'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Copy Table DDL'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DDL permission denied')
    const functionsFolder = wrapper.findAll('.db-tree-row.folder').find((row) => row.text().includes('functions'))!
    await functionsFolder.find('button').trigger('click')
    const routineRow = wrapper.findAll('.db-tree-row.column').find((row) => row.text().includes('notify_order_owner'))!
    await routineRow.trigger('click')
    expect(routineRow.classes()).toContain('selected')
    await wrapper.find('button[title="New SQL"]').trigger('click')
    expect((wrapper.find('.db-sql-toolbar select').element as HTMLSelectElement).value).toBe('conn-prod-pg')
    expect((wrapper.findAll('.db-sql-toolbar select').at(1)!.element as HTMLSelectElement).value).toBe('orders')
    expect((wrapper.findAll('.db-sql-toolbar select').at(2)!.element as HTMLSelectElement).value).toBe('public')
    await publicSchemaRow.trigger('click')

    const ordersTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('orders'))!
    await ordersTable.find('button').trigger('click')
    const ownerColumn = wrapper.findAll('.db-tree-row.column').find((row) => row.text().includes('owner'))!
    expect(ownerColumn.text()).toContain('owner')
    await ownerColumn.trigger('click')
    expect(ownerColumn.classes()).toContain('selected')

    await ordersTable.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Copy Table'))!.trigger('mouseenter')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('Copy Table SELECT')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Copy Table SELECT'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SELECT * FROM "public"."orders"')
    expect(wrapper.text()).toContain('SELECT copied')

    await ordersTable.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Copy Table'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Copy Table DDL'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.getDatabaseTableDdl).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-prod-pg', databaseName: 'orders', schemaName: 'public', tableName: 'orders' })
    )
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE public.orders'))
    expect(wrapper.text()).toContain('DDL copied')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Query Console'))!.trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')
    expect(wrapper.findAll('.db-workspace-tab').find((tab) => tab.classes().includes('active'))!.text()).toContain('Query')

    await ordersTable.trigger('dblclick')
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(true)
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.find('.db-where-bar').text()).toContain('orders')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: ?')
    expect(wrapper.find('.db-toolbar-total-unknown').text()).toBe('?')
    expect(wrapper.find('.db-toolbar-page-count').exists()).toBe(false)
    expect(wrapper.find('button.db-toolbar-total').exists()).toBe(false)
    const dataPageInput = wrapper.find('.db-toolbar input[type="number"]')
    expect(dataPageInput.attributes('min')).toBe('1')
    expect(dataPageInput.attributes('max')).toBeUndefined()
    expect(dataPageInput.attributes('title')).toBeUndefined()
    await wrapper.find('.db-toolbar-total').trigger('click')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 4')
    await wrapper.find('.db-toolbar select').setValue('10')
    expect(wrapper.find('.db-result-table tbody tr').exists()).toBe(true)
    expect(wrapper.find('.db-toolbar-total-unknown').exists()).toBe(false)
    expect(wrapper.find('.db-toolbar-btn-next').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-toolbar-btn-last').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar-btn-add-row').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-toolbar-btn-delete-row').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar-btn-delete-row').attributes('title')).toContain('Select a row')
    expect(wrapper.find('.db-toolbar-btn-undo').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar-btn-undo').attributes('title')).toContain('Nothing to undo')
    expect(wrapper.find('.db-toolbar-btn-save').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar-btn-save').attributes('title')).toContain('No changes to save')
    expect(wrapper.find('.db-toolbar button[title="Chart"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar button[title="Comment"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-toolbar .db-toolbar-export').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.db-where-bar input[aria-label="ORDER BY expression"]').exists()).toBe(false)
    expect(wrapper.find('.db-where-bar button[title="Apply order"]').exists()).toBe(false)
    expect(wrapper.findAll('.db-where-bar input')).toHaveLength(1)
    const whereInput = wrapper.find('.db-where-bar input')
    await whereInput.setValue('status = investigating')
    expect(whereInput.classes()).toContain('pending')
    expect(wrapper.find('.db-where-bar button[title="Apply filter"]').classes()).toContain('pending')
    await wrapper.find('.db-where-bar button').trigger('click')
    expect(wrapper.find('.db-where-bar input').classes()).not.toContain('pending')
    expect(wrapper.find('.db-result-table').text()).toContain('investigating')
    expect(wrapper.find('.db-result-table').text()).not.toContain('mitigated')
    expect(wrapper.find('.db-status-bar').text()).toContain('1 row')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 4')
    await wrapper.find('.db-toolbar-total').trigger('click')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 1')
    const ownerHeader = wrapper.findAll('.db-result-table th').find((header) => header.text().includes('owner'))!
    await ownerHeader.find('button[title="Filter"]').trigger('click')
    expect(wrapper.find('.db-filter-popover').text()).toContain('alice')
    await wrapper.find('.db-filter-search input').setValue('alice')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('alice')
    expect(wrapper.find('.db-result-table').text()).not.toContain('bob')

    const dataRow = wrapper.find('.db-result-table tbody tr')
    await dataRow.trigger('click')
    expect(wrapper.find('.db-toolbar-btn-delete-row').attributes('disabled')).toBeUndefined()
    const ownerCell = dataRow.findAll('td').at(4)!
    await ownerCell.trigger('dblclick')
    const dataEditInput = wrapper.find('.db-result-table td input')
    expect(document.activeElement).toBe(dataEditInput.element)
    expect((dataEditInput.element as HTMLInputElement).selectionStart).toBe(0)
    await dataEditInput.setValue('alice-edited')
    await dataEditInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')
    expect(wrapper.find('.db-result-table tbody tr').findAll('td').at(4)!.classes()).toContain('updated')
    expect(wrapper.find('.db-result-table').text()).toContain('alice-edited')
    expect(wrapper.find('.db-toolbar-btn-save').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-toolbar-btn-save').attributes('title')).toContain('Save changes')
    expect(wrapper.find('.db-toolbar-btn-undo').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 Updated')
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 SQL')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('UPDATE "public"."orders"')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('"owner" = \'alice-edited\'')
    await wrapper.find('.db-toolbar button[title="Undo"]').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('alice')
    expect(wrapper.find('.db-result-table tbody tr').classes()).not.toContain('updated')
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    await wrapper.find('.db-toolbar button[title="Add row"]').trigger('click')
    expect(wrapper.text()).toContain('New row added locally')
    expect(wrapper.find('.db-result-table tbody tr.new').exists()).toBe(true)
    expect(wrapper.find('.db-result-table tbody tr.new').text()).toContain('*')
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 New')
    expect(wrapper.find('.db-edit-summary').text()).toContain('No SQL statement will be generated')
    const newOwnerCell = wrapper.find('.db-result-table tbody tr.new').findAll('td').at(4)!
    await newOwnerCell.trigger('dblclick')
    const newRowInput = wrapper.find('.db-result-table tbody tr.new input')
    await newRowInput.setValue('new-owner')
    await newRowInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-result-table tbody tr.new').text()).toContain('new-owner')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('INSERT INTO "public"."orders"')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain("'new-owner'")
    await wrapper.find('.db-result-table tbody tr.new').trigger('click')
    await wrapper.find('.db-toolbar button[title="Delete row"]').trigger('click')
    expect(wrapper.find('.db-result-table tbody tr.new').exists()).toBe(false)
    expect(wrapper.text()).toContain('New row removed')
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    await wrapper.find('.db-result-table tbody tr').trigger('click')
    await wrapper.find('.db-toolbar button[title="Delete row"]').trigger('click')
    expect(wrapper.find('.db-result-table tbody tr.deleted').exists()).toBe(true)
    await wrapper.find('.db-result-table tbody tr.deleted').findAll('td').at(4)!.trigger('dblclick')
    expect(wrapper.find('.db-result-table td input').exists()).toBe(false)
    expect(wrapper.text()).toContain('Row marked for deletion')
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 Deleted')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('DELETE FROM "public"."orders"')
    await wrapper.findAll('.db-edit-summary-actions button').find((button) => button.text().includes('Copy Preview'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "public"."orders"'))
    await wrapper.findAll('.db-edit-summary-actions button').find((button) => button.text().includes('Discard All'))!.trigger('click')
    expect(wrapper.find('.db-result-table tbody tr.deleted').exists()).toBe(false)
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    await wrapper.find('.db-result-table tbody tr').trigger('click')
    await wrapper.find('.db-toolbar button[title="Delete row"]').trigger('click')
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-result-table tbody tr.deleted').exists()).toBe(false)
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)
    expect(wrapper.text()).toContain('Changes saved through backend table store (1 statement)')
    const resetOwnerHeader = wrapper.findAll('.db-result-table th').find((header) => header.text().includes('owner'))!
    await resetOwnerHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-row.all button').trigger('click')
    await wrapper.find('.db-where-bar input').setValue('')
    await wrapper.find('.db-where-bar button').trigger('click')
    await wrapper.find('.db-toolbar-total').trigger('click')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 3')

    let metricEventsTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('metric_events'))
    if (!metricEventsTable) {
      const metricsConnection = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('metrics-mysql'))!
      if (!wrapper.findAll('.db-tree-row.database').some((row) => row.text().includes('metrics'))) {
        await metricsConnection.find('button').trigger('click')
      }
      const metricsCatalog = wrapper.findAll('.db-tree-row.database').find((row) => row.text().includes('metrics'))
      if (metricsCatalog) await metricsCatalog.find('button').trigger('click')
      metricEventsTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('metric_events'))
    }
    expect(metricEventsTable).toBeTruthy()
    const metricEventsRow = metricEventsTable!
    await metricEventsRow.trigger('dblclick')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('metric_events'))).toBe(true)
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: ?')
    await wrapper.find('.db-result-table tbody tr').trigger('click')
    const metricSeverityCell = wrapper.find('.db-result-table tbody tr').findAll('td').at(3)!
    await metricSeverityCell.trigger('dblclick')
    const metricEditInput = wrapper.find('.db-result-table td input')
    await metricEditInput.setValue('critical')
    await metricEditInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-edit-summary').text()).toContain('No primary key detected')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('UPDATE `metrics`.`metric_events`')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('LIMIT 1')
    await wrapper.find('.db-toolbar button[title="Add row"]').trigger('click')
    const metricNewRow = wrapper.find('.db-result-table tbody tr.new')
    await metricNewRow.findAll('td').at(1)!.trigger('dblclick')
    await wrapper.find('.db-result-table tbody tr.new input').setValue('search')
    await wrapper.find('.db-result-table tbody tr.new input').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-edit-summary').text()).toContain('2 SQL')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('INSERT INTO `metrics`.`metric_events`')
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Changes saved through backend table store (2 statements)')
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    await wrapper.find('.db-search input').setValue('audit-oracle')
    const oracleConnectionRow = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('audit-oracle'))!
    await oracleConnectionRow.find('button').trigger('click')
    const oracleCatalogRow = wrapper.findAll('.db-tree-row.database').find((row) => row.text().includes('ORCLPDB1'))!
    await oracleCatalogRow.find('button').trigger('click')
    const oracleSchemaRow = wrapper.findAll('.db-tree-row.schema').find((row) => row.text().includes('OPS'))!
    await oracleSchemaRow.find('button').trigger('click')
    const oracleTablesFolder = wrapper
      .findAll('.db-tree-row.folder')
      .filter((row) => row.text().includes('tables') && row.find('button').exists())
      .at(0)!
    await oracleTablesFolder.find('button').trigger('click')
    const oracleTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('AUDIT_LOG'))!
    await oracleTable.trigger('dblclick')
    await waitForDatabaseTableData(wrapper)
    await wrapper.find('.db-result-table tbody tr').trigger('click')
    const oracleActionCell = wrapper.find('.db-result-table tbody tr').findAll('td').at(3)!
    await oracleActionCell.trigger('dblclick')
    const oracleEditInput = wrapper.find('.db-result-table td input')
    await oracleEditInput.setValue('RELEASE_BLOCKED')
    await oracleEditInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-edit-summary').text()).toContain('Oracle table editing requires a primary key')
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    expect(wrapper.find('.db-edit-summary').exists()).toBe(true)
    expect(wrapper.find('.db-edit-summary').text()).toContain('Oracle table editing requires a primary key')
    expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')

    await wrapper.find('.db-search input').setValue('')
    await ordersTable.trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').exists()).toBe(true)
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('View DDL'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.getDatabaseTableDdl).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-prod-pg', databaseName: 'orders', schemaName: 'public', tableName: 'orders' })
    )
    expect((wrapper.find('.db-ddl-modal textarea').element as HTMLTextAreaElement).value).toContain('CREATE TABLE')
    await wrapper.find('.db-ddl-toolbar').findAll('button').find((button) => button.text().includes('Copy'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE public.orders'))
    expect(wrapper.find('.db-ddl-toolbar').findAll('button').some((button) => button.text().includes('Open SQL Tab'))).toBe(false)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('DDL: orders'))).toBe(false)
    await wrapper.find('.db-ddl-modal header button').trigger('click')

    const ordersDataTab = wrapper.findAll('.db-workspace-tab').find((tab) => tab.text().includes('orders'))!
    await ordersDataTab.trigger('click')
    await wrapper.find('.db-toolbar-total').trigger('click')
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 3')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Truncate'))!.trigger('click')
    expect(wrapper.find('.db-danger-confirm').text()).toContain('TRUNCATE TABLE')
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.text()).toContain('Table truncated through backend table store')
    await ordersDataTab.trigger('click')
    expect(wrapper.find('.db-result-table tbody tr').exists()).toBe(false)
    expect(wrapper.find('.db-toolbar-total').text()).toContain('Total: 0')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Drop'))!.trigger('click')
    expect(wrapper.find('.db-danger-confirm').text()).toContain('DROP TABLE')
    expect(wrapper.find('.db-danger-confirm footer .danger').attributes('disabled')).toBeDefined()
    const mutateDatabaseTableImplementation = vi.mocked(window.aiops.mutateDatabaseTable).getMockImplementation()
    expect(mutateDatabaseTableImplementation).toBeDefined()
    vi.mocked(window.aiops.mutateDatabaseTable).mockImplementationOnce(async (input) => {
      const result = await mutateDatabaseTableImplementation!(input)
      if (!result.ok || !result.data?.catalog) return result
      return {
        ...result,
        data: {
          ...result.data,
          catalog: {
            ...result.data.catalog,
            groups: [...result.data.catalog.groups, { id: 'group-backend-drop-refresh', name: 'Backend Drop Refresh' }],
            groupParents: { ...result.data.catalog.groupParents, 'group-backend-drop-refresh': null },
            defaults: {
              ...result.data.catalog.defaults,
              expandedGroupIds: [...result.data.catalog.defaults.expandedGroupIds, 'group-backend-drop-refresh']
            }
          }
        }
      }
    })
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateDatabaseTable).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders',
        mutations: [{ kind: 'drop' }]
      })
    )
    await waitForDatabaseDbAiDone()
    expect(wrapper.text()).toContain('Backend Drop Refresh')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('DROP TABLE public.orders')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Generated SQL')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable'))
    const originalExecCommand = document.execCommand
    const execCommandSpy = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy
    })
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Copy'))!.trigger('click')
    await flushPromises()
    expect(execCommandSpy).toHaveBeenCalledWith('copy')
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand
      })
    } else {
      Reflect.deleteProperty(document, 'execCommand')
    }
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('DROP TABLE public.orders;')
    await expect(
      window.aiops.queryDatabaseTable({
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders',
        filters: [],
        sort: null,
        whereRaw: null,
        page: 1,
        pageSize: 100,
        withTotal: true
      })
    ).resolves.toMatchObject({ ok: false, errorCode: 'DB_TABLE_NOT_FOUND' })
    await expect(
      window.aiops.getDatabaseTableDdl({
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      })
    ).resolves.toMatchObject({ ok: false, errorCode: 'DB_TABLE_NOT_FOUND' })
    expect(wrapper.findAll('.db-ai-request-list button').some((button) => button.text().includes('Drop Table'))).toBe(true)
    expect(wrapper.findAll('.db-tree-row.table').some((row) => row.text().trim() === 'orders')).toBe(false)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(false)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('DDL: orders'))).toBe(false)
    expect(
      wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Insert Into Editor'))!.attributes('disabled')
    ).toBeDefined()
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const sqlEditor = wrapper.find('.db-sql-editor')
    await sqlEditor.setValue('syntax_error')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-running').text()).toContain('syntax_error')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-error').text()).toContain('Backend SQL executor rejected')
    const dbAiRequestCountBeforeDiagnose = wrapper.findAll('.db-ai-request-list button').length
    await wrapper.find('.db-result-error button').trigger('click')
    expect(wrapper.find('.db-result-diagnose-btn').classes()).toContain('loading')
    expect(wrapper.find('.db-result-diagnose-spinner').exists()).toBe(true)
    expect(wrapper.findAll('.db-ai-request-list button')).toHaveLength(dbAiRequestCountBeforeDiagnose)
    await new Promise((resolve) => window.setTimeout(resolve, 190))
    await flushPromises()
    expect(wrapper.find('.db-result-diagnose-success').text()).toContain('Diagnosed and replaced editor SQL')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('LIMIT 100')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-running').exists()).toBe(true)
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-tabs').text()).toContain('#')

    const removableConnection = wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('unit-sqlite'))!
    const unitSqliteConnectionId = wrapper.findAll('.db-sql-toolbar option').find((option) => option.text().includes('unit-sqlite'))?.attributes('value') ?? 'conn-unit-sqlite'
    await removableConnection.trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').text()).toContain('Close Connection')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Close Connection'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.disconnectDatabaseConnection).toHaveBeenCalledWith(unitSqliteConnectionId)
    expect(wrapper.text()).toContain('Connection closed')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('unit-sqlite'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Open Connection'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.connectDatabaseConnection).toHaveBeenCalledWith(unitSqliteConnectionId)
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('unit-sqlite'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Query Console'))!.trigger('click')
    expect((wrapper.find('.db-sql-toolbar select').element as HTMLSelectElement).value).toBe(
      unitSqliteConnectionId
    )
    const unitSqliteQueryTitle = wrapper.findAll('.db-workspace-tab').find((tab) => tab.classes().includes('active'))!.text()
    expect(unitSqliteQueryTitle).toContain('Query')
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('unit-sqlite'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Remove'))!.trigger('click')
    expect(wrapper.find('.db-operation-confirm').text()).toContain('Remove Connection')
    expect(wrapper.find('.db-operation-confirm').text()).toContain('unit-sqlite')
    await wrapper.find('.db-operation-confirm footer').findAll('button').find((button) => button.text().includes('Cancel'))!.trigger('click')
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('unit-sqlite'))).toBe(true)
    const tabCountBeforeConnectionRemove = wrapper.findAll('.db-workspace-tab').length
    await wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes('unit-sqlite'))!.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Remove'))!.trigger('click')
    await wrapper.find('.db-operation-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(window.aiops.removeDatabaseConnection).toHaveBeenCalledWith(unitSqliteConnectionId)
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('unit-sqlite'))).toBe(false)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('unit-sqlite'))).toBe(false)
    expect(wrapper.findAll('.db-workspace-tab').length).toBeLessThan(tabCountBeforeConnectionRemove)

    wrapper.unmount()
  })

  it('supports Monaco-like SQL editor indentation, run shortcut, and find/replace controls', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await expect(store.updateEditorSettings({ tabSize: 4, lineHeight: 24, fontSize: 18, wordWrap: 'on' })).resolves.toBe(true)
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await waitForDatabaseCatalog()

    const workspaceStyle = wrapper.find('.database-workspace').attributes('style')
    expect(workspaceStyle).toContain('--db-sql-editor-line-height: 24px')
    expect(workspaceStyle).toContain('--db-sql-editor-font-size: 18px')
    expect(workspaceStyle).toContain('--db-sql-editor-tab-size: 4')
    await wrapper.find('button[title="New SQL"]').trigger('click')
    const editor = wrapper.find('.db-sql-editor')
    await editor.setValue('select 1;')
    const editorElement = editor.element as HTMLTextAreaElement

    editorElement.setSelectionRange(0, 0)
    await editor.trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(editorElement.value).toBe('    select 1;')
    expect(editorElement.selectionStart).toBe(4)
    expect(wrapper.find('.db-sql-editor-footer').text()).toContain('Ln 1, Col 5')

    await editor.trigger('keydown', { key: 'Tab', shiftKey: true })
    await flushPromises()
    expect(editorElement.value).toBe('select 1;')
    expect(editorElement.selectionStart).toBe(0)

    await editor.setValue('select 1;\nselect 2;\nselect 3;')
    editorElement.setSelectionRange(0, 'select 1;\nselect 2;\n'.length)
    await editor.trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(editorElement.value).toBe('    select 1;\n    select 2;\nselect 3;')
    expect(editorElement.selectionStart).toBe(4)
    expect(editorElement.selectionEnd).toBe('    select 1;\n    select 2;\n'.length)

    editorElement.setSelectionRange(0, '    select 1;\n    select 2;\n'.length)
    await editor.trigger('keydown', { key: 'Tab', shiftKey: true })
    await flushPromises()
    expect(editorElement.value).toBe('select 1;\nselect 2;\nselect 3;')

    await editor.setValue('select status from public.orders where status = \'open\';')
    const firstStatus = editorElement.value.indexOf('status')
    editorElement.setSelectionRange(firstStatus, firstStatus + 'status'.length)
    await editor.trigger('keydown', { key: 'f', ctrlKey: true })
    await flushPromises()
    expect(wrapper.find('.db-sql-find-panel').exists()).toBe(true)
    expect((wrapper.find('.db-sql-find-panel input[aria-label="Find in SQL"]').element as HTMLInputElement).value).toBe('status')
    expect(wrapper.find('.db-sql-find-count').text()).toBe('1/2')

    await wrapper.find('.db-sql-find-panel input[aria-label="Find in SQL"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(editorElement.selectionStart).toBe(editorElement.value.lastIndexOf('status'))
    expect(wrapper.find('.db-sql-find-count').text()).toBe('2/2')

    await wrapper.find('.db-sql-find-panel button[title="Toggle replace"]').trigger('click')
    await wrapper.find('.db-sql-find-panel input[aria-label="Replace in SQL"]').setValue('state')
    await wrapper.find('.db-sql-find-panel button[title="Replace current"]').trigger('click')
    await flushPromises()
    expect(editorElement.value).toBe('select status from public.orders where state = \'open\';')
    await wrapper.find('.db-sql-find-panel button[title="Replace all"]').trigger('click')
    await flushPromises()
    expect(editorElement.value).toBe('select state from public.orders where state = \'open\';')
    expect(wrapper.text()).toContain('Replaced 1 match')

    await wrapper.find('.db-sql-find-panel input[aria-label="Find in SQL"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.db-sql-find-panel').exists()).toBe(false)

    await editor.setValue('select * from public.orders;')
    await editor.trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(wrapper.find('.db-result-running').text()).toContain('select * from public.orders')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')

    wrapper.unmount()
  })

  it('renders backend-owned DB AI drawer error records without generated SQL actions', async () => {
    const selectedSql = 'select id from "public"."orders"'
    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockResolvedValueOnce({
      ok: false,
      errorCode: 'DB_AI_PROVIDER_ERROR',
      errorMessage: 'Provider unavailable.',
      data: {
        request: {
          id: 'dbai-drawer-request-test-1',
          action: 'convert',
          label: 'Convert SQL',
          status: 'error',
          contextSummary: 'orders-postgres · postgresql · orders · current statement',
          sourceSql: selectedSql,
          text: 'Reasoning\n- Provider unavailable from backend record.',
          targetDialect: 'postgresql',
          backendContext: {
            connectionId: 'conn-prod-pg',
            dbType: 'postgresql',
            databaseName: 'orders',
            schemaName: 'public',
            contextSummary: 'orders-postgres · postgresql · orders · current statement'
          },
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_100
        },
        text: 'Reasoning\n- Provider unavailable from backend record.',
        reasoning: 'Reasoning\n- Provider unavailable from backend record.',
        sql: '',
        provider: 'aiopsterm-local',
        durationMs: 1
      }
    })
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue(`${selectedSql};`)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()

    expect(wrapper.find('.db-ai-status').text()).toContain('Error')
    expect(wrapper.find('.db-ai-section').text()).toContain('Provider unavailable from backend record.')
    expect(wrapper.find('.db-ai-sql-actions').exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps SQL history inert when a running result tab is closed before completion', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue('select * from public.orders;')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-running').text()).toContain('Running query')

    const runningResultTab = wrapper.findAll('.db-result-tabs [role="tab"]').find((tab) => tab.text().includes('#1-1'))!
    await runningResultTab.find('.db-result-tab-close').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    expect(wrapper.find('.db-sql-overview').text()).not.toContain('#1-1')

    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-sql-overview').text()).toContain('select * from public.orders')
    expect(wrapper.find('.db-sql-overview tbody tr').classes()).toContain('closed')
    expect(wrapper.find('.db-sql-overview-open').exists()).toBe(false)
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    expect(wrapper.find('.db-result-table').exists()).toBe(false)

    wrapper.unmount()
  })

  it('opens the Database DB AI pane with active context, streaming chat, resize, and persisted state', async () => {
    vi.mocked(window.aiops.getDatabaseAiPaneState).mockClear()
    vi.mocked(window.aiops.saveDatabaseAiPaneState).mockClear()
    vi.mocked(window.aiops.createDatabaseAiPaneRequest).mockClear()
    vi.mocked(window.aiops.startDatabaseAiPaneResponse).mockClear()
    vi.mocked(window.aiops.cancelDatabaseAiPaneResponse).mockClear()
    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockClear()
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()
    expect(window.aiops.getDatabaseAiPaneState).toHaveBeenCalled()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue('select * from public.orders;')
    await wrapper.find('button[title="Toggle DB AI Pane"]').trigger('click')
    expect(wrapper.find('.db-ai-pane').exists()).toBe(true)
    expect(wrapper.find('.database-workspace').attributes('style')).toContain('--db-ai-pane-width: 360px')
    expect(wrapper.find('.db-ai-pane-context-card').text()).toContain('orders-postgres')
    expect(wrapper.find('.db-ai-pane-context-card').text()).toContain('orders')
    expect(wrapper.find('.db-ai-pane-context-card').text()).toContain('public')

    await wrapper.find('.db-ai-pane-composer textarea').setValue('Summarize schema and generate a SELECT')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(2)
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    expect(window.aiops.createDatabaseAiPaneRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Summarize schema and generate a SELECT',
        context: expect.objectContaining({
          connectionId: 'conn-prod-pg',
          databaseName: 'orders',
          schemaName: 'public',
          contextSummary: expect.stringContaining('orders-postgres')
        }),
        activeSql: 'select * from public.orders;'
      })
    )
    expect(wrapper.findAll('.db-ai-pane-message').at(0)!.attributes('data-message-id')).toBe('dbai-pane-request-test-1-user')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.attributes('data-message-id')).toBe('dbai-pane-request-test-1-assistant')
    expect(window.aiops.startDatabaseAiPaneResponse).toHaveBeenCalledWith({
      requestId: 'dbai-pane-request-test-1',
      assistantMessageId: 'dbai-pane-request-test-1-assistant'
    })
    expect(window.aiops.generateDatabaseAiPaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'dbai-pane-request-test-1',
        assistantMessageId: 'dbai-pane-request-test-1-assistant',
        prompt: 'Summarize schema and generate a SELECT',
        activeSql: 'select * from public.orders;'
      })
    )
    await new Promise((resolve) => window.setTimeout(resolve, 115))
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    await wrapper.find('.db-ai-pane-composer-actions button[title="Stop response"]').trigger('click')
    expect(window.aiops.cancelDatabaseAiPaneResponse).toHaveBeenCalledWith({
      requestId: 'dbai-pane-request-test-1',
      assistantMessageId: 'dbai-pane-request-test-1-assistant'
    })
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.classes()).toContain('cancelled')
    await new Promise((resolve) => window.setTimeout(resolve, 380))
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Cancelled')
    await new Promise((resolve) => window.setTimeout(resolve, 360))
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Cancelled')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('当前响应由 aiopsterm DB AI 本地后端生成')

    await wrapper.findAll('.db-workspace-tab').find((tab) => tab.text().includes('Query'))!.trigger('click')
    await wrapper.find('.db-sql-toolbar .db-picker--connection').setValue('conn-metrics-mysql')
    await flushPromises()
    await wrapper.find('.db-ai-pane-context-head button').trigger('click')
    expect((wrapper.find('.db-ai-pane-connection').element as HTMLSelectElement).value).toBe('conn-metrics-mysql')
    expect((wrapper.find('.db-ai-pane-database').element as HTMLSelectElement).value).toBe('metrics')
    await wrapper.find('.db-ai-pane-connection').setValue('conn-local-cache')
    expect((wrapper.find('.db-ai-pane-database').element as HTMLSelectElement).value).toBe('cache.db')
    expect(wrapper.find('.db-ai-pane-context-card').text()).toContain('local-cache is not connected')
    await wrapper.find('.db-ai-pane-connect-row button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ai-pane-context-card').text()).not.toContain('is not connected')

    const resizer = wrapper.find('.db-ai-pane-resizer')
    await resizer.trigger('pointerdown', { clientX: 600 })
    expect(wrapper.find('.database-workspace').classes()).toContain('db-ai-pane-resizing')
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 420 }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.database-workspace').attributes('style')).toContain('--db-ai-pane-width: 540px')
    expect(resizer.attributes('aria-valuenow')).toBe('540')
    window.dispatchEvent(new MouseEvent('pointerup'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.database-workspace').classes()).not.toContain('db-ai-pane-resizing')
    await resizer.trigger('dblclick')
    expect(wrapper.find('.database-workspace').attributes('style')).toContain('--db-ai-pane-width: 360px')

    await wrapper.find('.db-ai-pane-composer textarea').setValue('persist this draft')
    await wrapper.vm.$nextTick()
    await flushPromises()
    expect(window.aiops.saveDatabaseAiPaneState).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        width: 360,
        context: expect.objectContaining({
          connectionId: 'conn-local-cache',
          catalogName: 'cache.db',
          dbType: 'sqlite'
        }),
        draft: 'persist this draft',
        messages: expect.arrayContaining([expect.objectContaining({ status: 'cancelled' })])
      })
    )
    wrapper.unmount()

    const remounted = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()
    expect(remounted.find('.db-ai-pane').exists()).toBe(true)
    expect((remounted.find('.db-ai-pane-connection').element as HTMLSelectElement).value).toBe('conn-local-cache')
    expect((remounted.find('.db-ai-pane-database').element as HTMLSelectElement).value).toBe('cache.db')
    expect((remounted.find('.db-ai-pane-composer textarea').element as HTMLTextAreaElement).value).toBe('persist this draft')
    expect(remounted.findAll('.db-ai-pane-message').some((message) => message.text().includes('Cancelled'))).toBe(true)

    remounted.unmount()
  })

  it('renders backend-owned DB AI pane error message records', async () => {
    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockResolvedValueOnce({
      ok: false,
      errorCode: 'DB_AI_PROVIDER_ERROR',
      errorMessage: 'Provider unavailable.',
      data: {
        requestId: 'dbai-pane-request-test-1',
        assistantMessage: {
          id: 'dbai-pane-request-test-1-assistant',
          requestId: 'dbai-pane-request-test-1',
          role: 'assistant',
          status: 'error',
          content: 'Pane provider unavailable from backend record.',
          contextSummary: 'orders-postgres · postgresql · orders · public',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_100
        },
        text: 'Pane provider unavailable from backend record.',
        provider: 'aiopsterm-local',
        durationMs: 1
      }
    })
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('button[title="Toggle DB AI Pane"]').trigger('click')
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Summarize schema')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()

    const assistantMessage = wrapper.findAll('.db-ai-pane-message').at(1)!
    expect(assistantMessage.classes()).toContain('error')
    expect(assistantMessage.text()).toContain('Error')
    expect(assistantMessage.text()).toContain('Pane provider unavailable from backend record.')

    wrapper.unmount()
  })

  it('keeps the SQL editor shell gutter, active line, and scroll state in sync', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const editor = wrapper.find('.db-sql-editor')
    await editor.setValue('select 1;\nselect 2;\nselect 3;')
    await flushPromises()

    expect(wrapper.find('.db-sql-editor-shell').exists()).toBe(true)
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('3')

    const editorElement = editor.element as HTMLTextAreaElement
    const secondLineOffset = editorElement.value.indexOf('2')
    editorElement.setSelectionRange(secondLineOffset, secondLineOffset + 1)
    await editor.trigger('select')

    expect(wrapper.find('.db-sql-editor-footer').text()).toContain('Ln 2, Col 8')
    expect(wrapper.find('.db-sql-editor-footer').text()).toContain('1 selected')
    expect(wrapper.findAll('.db-sql-editor-gutter span').at(1)!.classes()).toContain('active')
    expect(wrapper.find('.db-sql-editor-active-line').attributes('style')).toContain('translateY(20px)')

    editorElement.scrollTop = 20
    await editor.trigger('scroll')
    expect(wrapper.find('.db-sql-editor-active-line').attributes('style')).toContain('translateY(0px)')

    wrapper.unmount()
  })

  it('resizes the SQL editor/result panes with a External reference-style horizontal splitter', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const panes = wrapper.find('.db-sql-panes')
    const splitter = wrapper.find('.db-sql-splitter')
    expect(splitter.exists()).toBe(true)
    expect(panes.attributes('style')).toContain('--db-sql-editor-percent: 45%')
    expect(splitter.attributes('aria-valuenow')).toBe('45')

    const panesElement = panes.element as HTMLElement
    vi.spyOn(panesElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 100,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 500,
      toJSON: () => ({})
    } as DOMRect)

    await splitter.trigger('pointerdown', { clientY: 325 })
    expect(panes.classes()).toContain('resizing')
    expect(panes.attributes('style')).toContain('--db-sql-editor-percent: 45%')

    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 40 }))
    await wrapper.vm.$nextTick()
    expect(panes.attributes('style')).toContain('--db-sql-editor-percent: 20%')
    expect(splitter.attributes('aria-valuenow')).toBe('20')

    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 610 }))
    await wrapper.vm.$nextTick()
    expect(panes.attributes('style')).toContain('--db-sql-editor-percent: 80%')
    expect(splitter.attributes('aria-valuenow')).toBe('80')

    window.dispatchEvent(new MouseEvent('pointerup'))
    await wrapper.vm.$nextTick()
    expect(panes.classes()).not.toContain('resizing')

    await splitter.trigger('dblclick')
    expect(panes.attributes('style')).toContain('--db-sql-editor-percent: 45%')
    expect(splitter.attributes('aria-valuenow')).toBe('45')

    wrapper.unmount()
  })

  it('matches External reference-style settings nav, general, terminal, model, and AI preferences', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const panel = mount(SettingsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(panel.text()).toContain('通用')
    expect(panel.text()).toContain('终端')
    expect(panel.text()).toContain('AI 偏好设置')
    expect(panel.text()).toContain('文档')
    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('文档'))!.trigger('click')
    await flushPromises()
    expect(store.activeSettingsSection).toBe('general')
    expect(window.aiops.openExternalUrl).toHaveBeenCalledWith('https://aiopsterm.local/docs')

    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })

    expect(workspace.text()).toContain('基础设置')
    expect(workspace.text()).toContain('默认背景')
    expect(workspace.text()).toContain('自定义上传（支持JPG、PNG、WebP、GIF）')
    expect(workspace.text()).toContain('Termius Light')
    expect(workspace.text()).toContain('Kanagawa Dragon')
    expect(workspace.text()).toContain('Catppuccin Latte')
    expect(workspace.text()).toContain('打开入门引导')
    await workspace.find('.theme-select').setValue('catppuccin-latte')
    await flushPromises()
    expect(store.config.theme).toBe('catppuccin-latte')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themeId).toBe('catppuccin-latte')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#1e66f5')
    await workspace.find('.settings-button.primary').trigger('click')
    expect(store.onboardingGuideOpen).toBe(true)
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('入门引导')
    expect(workspace.text()).toContain('界面导览')
    store.onboardingGuideOpen = false
    await workspace.vm.$nextTick()

    await workspace.findAll('.settings-bg-tile.preset').at(0)!.trigger('click')
    await flushPromises()
    expect(store.config.background.mode).toBe('preset')
    await workspace.find('.settings-sliders input[type="range"]').setValue('0.5')
    await flushPromises()
    expect(store.config.background.opacity).toBe(0.5)
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/settings-custom-bg.webp'] })
    vi.mocked(window.aiops.saveCustomBackground).mockResolvedValueOnce({
      filePath: '/tmp/aiopsterm/backgrounds/settings-custom-bg.webp',
      url: 'file:///tmp/aiopsterm/backgrounds/settings-custom-bg.webp',
      name: 'settings-custom-bg.webp',
      size: 256
    })
    await workspace.find('.settings-bg-tile.upload').trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    expect(window.aiops.saveCustomBackground).toHaveBeenCalledWith('/tmp/settings-custom-bg.webp')
    expect(store.config.background.mode).toBe('custom')
    expect(store.config.background.image).toBe('file:///tmp/aiopsterm/backgrounds/settings-custom-bg.webp')
    const customPreview = workspace.find('.settings-bg-tile.custom-preview')
    expect(customPreview.exists()).toBe(true)
    expect(customPreview.attributes('style')).toContain('settings-custom-bg.webp')
    await customPreview.find('.settings-bg-delete').trigger('click')
    await flushPromises()
    expect(store.config.background.mode).toBe('none')
    expect(store.config.background.lastCustomImage).toBe('')

    const layoutRadios = workspace.findAll('input[name="defaultLayout"]')
    await layoutRadios[1].setValue(true)
    await flushPromises()
    expect(store.config.defaultMode).toBe('agents')

    expect(workspace.text()).toContain('编辑器设置')
    expect(workspace.text()).toContain('Minimap')
    expect(workspace.text()).toContain('Mouse Wheel Zoom')
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.findAll('input.settings-number')[0].setValue('18')
    await flushPromises()
    expect(store.editorSettings.fontSize).toBe(18)
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--editor-line-height')).toBe('26px')
    expect(document.documentElement.style.getPropertyValue('--editor-tab-size')).toBe('4')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        editorSettings: expect.objectContaining({
          fontSize: 18,
          lineHeight: 0,
          tabSize: 4,
          wordWrap: 'off',
          minimap: true,
          mouseWheelZoom: true
        })
      })
    )
    await workspace.findAll('input[name="minimap"]')[1].setValue(true)
    await flushPromises()
    await workspace.findAll('input[name="mouseWheelZoom"]')[1].setValue(true)
    await flushPromises()
    expect(store.editorSettings.minimap).toBe(false)
    expect(store.editorSettings.mouseWheelZoom).toBe(false)
    expect(document.documentElement.dataset.editorMinimap).toBe('off')
    expect(document.documentElement.dataset.editorMouseWheelZoom).toBe('off')
    await workspace.findAll('input[name="wordWrap"]')[0].setValue(true)
    await flushPromises()
    expect(store.editorSettings.wordWrap).toBe('on')
    expect(document.documentElement.dataset.editorWordWrap).toBe('on')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        editorSettings: expect.objectContaining({
          fontSize: 18,
          wordWrap: 'on',
          minimap: false,
          mouseWheelZoom: false
        })
      })
    )

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('终端'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('终端类型')
    expect(workspace.text()).toContain('ScrollBack')
    await workspace.findAll('.cursor-style-button').find((button) => button.attributes('title') === '竖线光标')!.trigger('click')
    expect(store.terminalSettings.cursorStyle).toBe('bar')
    await workspace.findAll('.settings-switch input').at(2)!.setValue(false)
    expect(store.terminalSettings.showCloseButton).toBe(false)
    await workspace.findAll('.settings-switch input').at(3)!.setValue(true)
    expect(store.terminalSettings.sshAgentsStatus).toBe(true)
    await workspace.vm.$nextTick()
    const agentRow = workspace.findAll('.settings-form-row').find((row) => row.text().includes('SSH Agent 设置'))!
    vi.mocked(window.aiops.saveConfig).mockClear()
    await agentRow.find('button').trigger('click')
    await flushPromises()
    expect(workspace.find('.agent-config-modal').exists()).toBe(true)
    expect(workspace.text()).toContain('暂无密钥添加')
    expect(window.aiops.listSshAgentKeychainOptions).toHaveBeenCalled()
    await workspace.find('.agent-config-modal .settings-select').setValue('key-1')
    await workspace.find('.agent-key-form .settings-button.primary').trigger('click')
    await flushPromises()
    expect(store.sshAgentKeys.some((key) => key.id === 'key-1')).toBe(true)
    expect(workspace.text()).toContain('prod-ed25519')
    expect(workspace.text()).toContain('ED25519')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-1',
            fingerprint: prodKeychainSshAgentFingerprint,
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-1'
          }
        ]
      })
    )
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.find('.agent-config-table .settings-link-button.danger').trigger('click')
    await flushPromises()
    expect(store.sshAgentKeys).toEqual([])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: []
      })
    )
    await workspace.find('.agent-config-modal footer .settings-button').trigger('click')
    expect(workspace.find('.agent-config-modal').exists()).toBe(false)
    const proxyRow = workspace.findAll('.settings-form-row').find((row) => row.text().includes('代理设置'))!
    vi.mocked(window.aiops.saveConfig).mockClear()
    await proxyRow.find('button').trigger('click')
    expect(workspace.find('.proxy-config-modal').exists()).toBe(true)
    expect(workspace.text()).toContain('暂无代理配置，请添加')
    await workspace.find('.proxy-config-modal footer .primary').trigger('click')
    expect(workspace.find('.proxy-config-add-modal').exists()).toBe(true)
    const proxyInputs = workspace.findAll('.proxy-config-add-modal .settings-input')
    await proxyInputs[0].setValue('release-proxy')
    await workspace.find('.proxy-config-add-modal .settings-select').setValue('SOCKS5')
    await proxyInputs[1].setValue('10.0.0.8')
    await proxyInputs[2].setValue('1080')
    await workspace.find('.proxy-config-add-modal input[type="checkbox"]').setValue(true)
    await workspace.vm.$nextTick()
    const credentialInputs = workspace.findAll('.proxy-config-add-modal .settings-input')
    await credentialInputs[3].setValue('ops')
    await credentialInputs[4].setValue('secret')
    await workspace.find('.proxy-config-add-modal footer .primary').trigger('click')
    expect(store.sshProxyConfigs.some((config) => config.name === 'release-proxy')).toBe(true)
    expect(workspace.text()).toContain('release-proxy')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshProxyConfigs: [
          {
            name: 'release-proxy',
            type: 'SOCKS5',
            host: '10.0.0.8',
            port: 1080,
            enableProxyIdentity: true,
            username: 'ops',
            password: 'secret'
          }
        ]
      })
    )
    await workspace.find('.proxy-config-table .settings-link-button.danger').trigger('click')
    expect(store.sshProxyConfigs).toEqual([])

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('模型'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('模型名称')
    expect(workspace.text()).toContain('LiteLLM')
    expect(workspace.text()).toContain('OpenAI Compatible & Responses')
    expect(workspace.text()).toContain('Amazon Bedrock')
    expect(workspace.text()).toContain('DeepSeek')
    expect(workspace.text()).toContain('Anthropic')
    expect(workspace.text()).toContain('Ollama')
    const providerInputs = workspace.findAll('.provider-card .settings-input')
    await providerInputs[0].setValue('http://litellm.internal')
    await workspace.findAll('.provider-card').at(0)!.findAll('button').find((button) => button.text() === 'Save')!.trigger('click')
    await flushPromises()
    expect(store.config.modelProvider).toBe('litellm')
    expect(store.config.modelEndpoint).toBe('http://litellm.internal')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProvider: 'litellm',
        modelEndpoint: 'http://litellm.internal',
        modelSettings: expect.objectContaining({
          providers: expect.objectContaining({
            litellm: expect.objectContaining({ baseUrl: 'http://litellm.internal' })
          })
        })
      })
    )
    const bedrockCard = workspace.findAll('.provider-card').find((card) => card.text().includes('Amazon Bedrock'))!
    expect(bedrockCard.text()).toContain('AWS Access Key')
    expect(bedrockCard.text()).toContain('Cross Region Inference')
    await bedrockCard.findAll('.settings-input')[0].setValue('AKIA-LOCAL')
    await bedrockCard.findAll('.settings-select')[0].setValue('eu-west-1')
    await bedrockCard.findAll('.settings-check-line input')[0].setValue(true)
    expect(store.modelProviders.bedrock.awsAccessKey).toBe('AKIA-LOCAL')
    expect(store.modelProviders.bedrock.awsRegion).toBe('eu-west-1')
    expect(store.modelProviders.bedrock.awsEndpointSelected).toBe(true)
    await workspace.vm.$nextTick()
    expect(bedrockCard.text()).toContain('Bedrock Endpoint')

    const openAiCard = workspace.findAll('.provider-card').find((card) => card.text().includes('OpenAI Compatible & Responses'))!
    expect(openAiCard.text()).toContain('Preview:')
    expect(openAiCard.text()).toContain('/responses')
    vi.mocked(window.aiops.checkModelProvider).mockClear()
    let resolveProviderCheck: (value: any) => void = () => undefined
    vi.mocked(window.aiops.checkModelProvider).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProviderCheck = resolve
        })
    )
    const checkClick = openAiCard.findAll('button').find((button) => button.text() === 'Check')!.trigger('click')
    await workspace.vm.$nextTick()
    expect(store.modelCheckState.openai).toBe('checking')
    resolveProviderCheck({
      ok: true,
      data: {
        provider: 'openai',
        label: 'OpenAI Compatible',
        modelId: 'gpt-5',
        endpoint: 'https://api.openai.com/v1/responses',
        message: 'OpenAI Compatible configuration validated by test backend.',
        durationMs: 1
      }
    })
    await checkClick
    await flushPromises()
    expect(window.aiops.checkModelProvider).toHaveBeenCalledWith({
      provider: 'openai',
      config: expect.objectContaining({
        baseUrl: 'https://api.openai.com',
        modelId: 'gpt-5',
        apiFormat: 'responses'
      })
    })
    expect(store.modelCheckState.openai).toBe('success')
    expect(workspace.text()).toContain('OpenAI Compatible configuration validated by test backend.')

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('AI 偏好设置'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('启用 Extended Thinking')
    expect(workspace.text()).toContain('OpenAI Reasoning Effort')
    expect(workspace.find('.settings-number.wide').attributes('max')).toBe('300')
    await workspace.find('.settings-budget input[type="range"]').setValue('5000')
    await flushPromises()
    expect(store.aiPreferences.thinkingBudgetTokens).toBe(5000)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          thinkingBudgetTokens: 5000
        })
      })
    )
    await workspace.findAll('.settings-check-line input').find((input) => (input.element as HTMLInputElement).checked === false)!.setValue(true)
    await flushPromises()
    expect(store.aiPreferences.autoExecuteReadOnlyCommands).toBe(true)
    await workspace.findAll('.security-config-row button').find((button) => button.text().includes('打开安全配置'))!.trigger('click')
    expect(store.securityConfigEditorOpen).toBe(true)
    expect(workspace.text()).toContain('security-config.json')
    expect(workspace.find('[data-testid="security-config-json-editor-monaco"]').exists()).toBe(true)
    expect(monacoMocks.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        language: 'json',
        fontSize: store.editorSettings.fontSize,
        tabSize: store.editorSettings.tabSize,
        wordWrap: store.editorSettings.wordWrap,
        minimap: expect.objectContaining({ enabled: store.editorSettings.minimap })
      })
    )
    const securityEditor = workspace.find('.security-config-json-editor')
    expect((securityEditor.element as HTMLTextAreaElement).value).toContain('"security"')
    await securityEditor.setValue('{invalid json')
    expect(workspace.text()).toContain('Invalid JSON')
    const securityConfig = {
      security: {
        enableCommandSecurity: true,
        enableStrictMode: true,
        blacklistPatterns: ['rm -rf /'],
        whitelistPatterns: ['ls', 'pwd'],
        dangerousCommands: ['reboot'],
        maxCommandLength: 4096,
        securityPolicy: {
          blockCritical: true,
          askForMedium: false,
          askForHigh: true,
          askForBlacklist: true
        }
      }
    }
    await securityEditor.setValue(JSON.stringify(securityConfig, null, 2))
    vi.mocked(window.aiops.saveConfig).mockClear()
    await new Promise((resolve) => window.setTimeout(resolve, 1100))
    expect(store.securitySettings).toEqual(securityConfig)
    expect(window.aiops.writeSecurityConfig).toHaveBeenCalledWith(JSON.stringify(securityConfig, null, 2))
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
    expect(store.config.securityConfig).toEqual(securityConfig)
    await workspace.find('.security-config-toolbar .settings-button').trigger('click')
    expect(store.securitySettings).toEqual({
      security: {
        enableCommandSecurity: true,
        enableStrictMode: false,
        blacklistPatterns: [],
        whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
        dangerousCommands: ['rm', 'format', 'shutdown'],
        maxCommandLength: 10000,
        securityPolicy: {
          blockCritical: true,
          askForMedium: true,
          askForHigh: true,
          askForBlacklist: false
        }
      }
    })
    await workspace.findAll('.security-config-toolbar .settings-button').find((button) => button.text() === 'Close')!.trigger('click')
    expect(store.securityConfigEditorOpen).toBe(false)
  })

  it('matches External reference-style onboarding guide and spotlight progress', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const guide = mount(OnboardingGuide, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(guide.text()).toContain('入门引导')
    expect(guide.text()).toContain('已完成 0 / 4')
    await guide.findAll('.onboarding-module-card').find((card) => card.text().includes('界面导览'))!.trigger('click')
    expect(store.onboardingActiveTour).toBe('interfaceGuide')
    expect(store.onboardingActiveStep?.targetId).toBe('left-module-switcher')

    const target = document.createElement('button')
    target.dataset.onboardingId = 'left-module-switcher'
    target.style.width = '120px'
    target.style.height = '32px'
    target.getBoundingClientRect = () =>
      ({
        x: 24,
        y: 24,
        top: 24,
        left: 24,
        right: 144,
        bottom: 56,
        width: 120,
        height: 32,
        toJSON: () => ({})
      }) as DOMRect
    target.textContent = 'target'
    document.body.appendChild(target)

    const spotlight = mount(OnboardingSpotlight, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await new Promise((resolve) => window.setTimeout(resolve, 90))
    await spotlight.vm.$nextTick()

    expect(spotlight.text()).toContain('模块切换栏')
    await spotlight.find('.spotlight-card .primary').trigger('click')
    expect(store.onboardingActiveStepIndex).toBe(1)

    store.onboardingActiveStepIndex = 4
    target.dataset.onboardingId = 'right-ai-toggle'
    await spotlight.vm.$nextTick()
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => window.setTimeout(resolve, 110))
    expect(store.onboardingActiveStepIndex).toBe(5)

    store.onboardingActiveStepIndex = store.onboardingActiveSteps.length - 1
    await spotlight.vm.$nextTick()
    await spotlight.find('.spotlight-card .primary').trigger('click')
    expect(store.onboardingCompleted.interfaceGuide).toBe(true)
    expect(store.onboardingActiveTour).toBeNull()

    store.startOnboardingTour('systemSettings')
    store.onboardingActiveStepIndex = store.onboardingActiveSteps.length - 1
    await spotlight.vm.$nextTick()
    expect(store.onboardingActiveStep?.advanceOnEvent).toBe('onboarding:autoApprovalEnabled')
    await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(true)
    await spotlight.vm.$nextTick()
    expect(store.onboardingCompleted.systemSettings).toBe(true)
    expect(store.onboardingActiveTour).toBeNull()

    spotlight.unmount()
    target.remove()
  })

  it('does not leave background controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('general')
    await workspace.vm.$nextTick()
    const savedConfig = {
      ...store.config,
      background: { ...store.config.background }
    }

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce(savedConfig)
    const firstPreset = workspace.findAll('.settings-bg-tile.preset').at(0)!
    await firstPreset.trigger('click')
    await flushPromises()
    expect(store.settingsNotice).toBe('背景设置保存失败')
    expect(store.config.background.mode).toBe('none')
    expect(firstPreset.classes()).not.toContain('active')
    expect(workspace.find('.settings-sliders').exists()).toBe(false)

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      background: {
        ...store.config.background,
        mode: 'preset',
        image: 'mist-lake'
      }
    })
    await firstPreset.trigger('click')
    await flushPromises()
    expect(store.config.background.mode).toBe('preset')
    expect(store.config.background.image).toBe('mist-lake')
    await workspace.vm.$nextTick()
    const opacityInput = workspace.find('.settings-sliders input[type="range"]')
    expect((opacityInput.element as HTMLInputElement).value).toBe('0.15')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      background: { ...store.config.background }
    })
    await opacityInput.setValue('0.5')
    await flushPromises()
    expect(store.settingsNotice).toBe('背景设置保存失败')
    expect(store.config.background.opacity).toBe(0.15)
    expect((opacityInput.element as HTMLInputElement).value).toBe('0.15')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/rejected-bg.webp'] })
    vi.mocked(window.aiops.saveCustomBackground).mockResolvedValueOnce({
      filePath: '/tmp/aiopsterm/backgrounds/rejected-bg.webp',
      url: 'file:///tmp/aiopsterm/backgrounds/rejected-bg.webp',
      name: 'rejected-bg.webp',
      size: 256
    })
    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      background: { ...store.config.background }
    })
    await workspace.find('.settings-bg-tile.upload').trigger('click')
    await flushPromises()
    expect(store.settingsNotice).toBe('背景设置保存失败')
    expect(store.config.background.mode).toBe('preset')
    expect(store.config.background.lastCustomImage).toBe('')
    expect(workspace.find('.settings-bg-tile.custom-preview').exists()).toBe(false)
  })

  it('does not leave theme controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('general')
    await workspace.vm.$nextTick()
    const themeSelect = workspace.find('.theme-select')
    const savedConfig = {
      ...store.config,
      theme: store.config.theme
    }

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce(savedConfig)
    await themeSelect.setValue('catppuccin-latte')
    await flushPromises()
    expect(store.settingsNotice).toBe('主题设置保存失败')
    expect(store.config.theme).toBe('dark')
    expect((themeSelect.element as HTMLSelectElement).value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeId).toBe('dark')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      theme: 'catppuccin-latte'
    })
    await themeSelect.setValue('catppuccin-latte')
    await flushPromises()
    expect(store.settingsNotice).toBe('主题设置已保存')
    expect(store.config.theme).toBe('catppuccin-latte')
    expect((themeSelect.element as HTMLSelectElement).value).toBe('catppuccin-latte')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themeId).toBe('catppuccin-latte')
  })

  it('does not leave General base setting controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('general')
    await workspace.vm.$nextTick()
    const savedConfig = {
      ...store.config
    }
    const row = (label: string) => workspace.findAll('.settings-form-row').find((item) => item.find('label').text() === label)!

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce(savedConfig)
    const layoutRadios = row('默认布局').findAll('input[name="defaultLayout"]')
    expect((layoutRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((layoutRadios[1].element as HTMLInputElement).checked).toBe(false)
    await layoutRadios[1].setValue(true)
    await flushPromises()
    expect(store.settingsNotice).toBe('基础设置保存失败')
    expect(store.config.defaultMode).toBe('terminal')
    expect(store.mode).toBe('terminal')
    expect((layoutRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((layoutRadios[1].element as HTMLInputElement).checked).toBe(false)

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce(savedConfig)
    const languageSelect = row('语言').find('select.settings-select')
    expect((languageSelect.element as HTMLSelectElement).value).toBe('zh-CN')
    await languageSelect.setValue('en-US')
    await flushPromises()
    expect(store.settingsNotice).toBe('基础设置保存失败')
    expect(store.config.language).toBe('zh-CN')
    expect((languageSelect.element as HTMLSelectElement).value).toBe('zh-CN')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce(savedConfig)
    const watermarkRadios = row('水印').findAll('input[name="watermark"]')
    expect((watermarkRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((watermarkRadios[1].element as HTMLInputElement).checked).toBe(false)
    await watermarkRadios[1].setValue(true)
    await flushPromises()
    expect(store.settingsNotice).toBe('基础设置保存失败')
    expect(store.config.watermark).toBe('open')
    expect((watermarkRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((watermarkRadios[1].element as HTMLInputElement).checked).toBe(false)
  })

  it('does not leave editor setting controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('general')
    await workspace.vm.$nextTick()
    const savedEditorSettings = {
      ...store.editorSettings
    }
    const initialFontSizeToken = document.documentElement.style.getPropertyValue('--editor-font-size')
    const initialMinimapToken = document.documentElement.dataset.editorMinimap
    const row = (label: string) => workspace.findAll('.settings-form-row').find((item) => item.find('label').text() === label)!

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      editorSettings: savedEditorSettings
    })
    const fontSizeInput = row('字体大小').find('input.settings-number')
    expect((fontSizeInput.element as HTMLInputElement).value).toBe('14')
    await fontSizeInput.setValue('18')
    await flushPromises()
    expect(store.settingsNotice).toBe('编辑器设置保存失败')
    expect(store.editorSettings.fontSize).toBe(14)
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe(initialFontSizeToken)
    expect((fontSizeInput.element as HTMLInputElement).value).toBe('14')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      editorSettings: savedEditorSettings
    })
    const fontSelect = row('字体').find('select.settings-select')
    expect((fontSelect.element as HTMLSelectElement).value).toBe('cascadia-mono')
    await fontSelect.setValue('jetbrains-mono')
    await flushPromises()
    expect(store.settingsNotice).toBe('编辑器设置保存失败')
    expect(store.editorSettings.fontFamily).toBe('cascadia-mono')
    expect((fontSelect.element as HTMLSelectElement).value).toBe('cascadia-mono')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      editorSettings: savedEditorSettings
    })
    const minimapRadios = row('Minimap').findAll('input[name="minimap"]')
    expect((minimapRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((minimapRadios[1].element as HTMLInputElement).checked).toBe(false)
    await minimapRadios[1].setValue(true)
    await flushPromises()
    expect(store.settingsNotice).toBe('编辑器设置保存失败')
    expect(store.editorSettings.minimap).toBe(true)
    expect(document.documentElement.dataset.editorMinimap).toBe(initialMinimapToken)
    expect((minimapRadios[0].element as HTMLInputElement).checked).toBe(true)
    expect((minimapRadios[1].element as HTMLInputElement).checked).toBe(false)
  })

  it('does not leave extension switches visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('extensions')
    await workspace.vm.$nextTick()

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      }
    })

    const autoCompleteSwitch = workspace.findAll('.settings-switch input').at(0)!
    expect((autoCompleteSwitch.element as HTMLInputElement).checked).toBe(true)
    await autoCompleteSwitch.setValue(false)
    await flushPromises()

    expect(store.settingsNotice).toBe('扩展设置保存失败')
    expect(store.extensionSettings.autoCompleteStatus).toBe(true)
    expect((autoCompleteSwitch.element as HTMLInputElement).checked).toBe(true)
  })

  it('does not leave AI preference controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('ai')
    await workspace.vm.$nextTick()
    const savedAiPreferences = {
      ...store.aiPreferences,
      proxy: { ...store.aiPreferences.proxy }
    }

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      aiPreferences: savedAiPreferences
    })
    const budgetSlider = workspace.find('.settings-budget input[type="range"]')
    expect((budgetSlider.element as HTMLInputElement).value).toBe('4096')
    await budgetSlider.setValue('5000')
    await flushPromises()
    expect(store.settingsNotice).toBe('AI 偏好设置保存失败')
    expect(store.aiPreferences.thinkingBudgetTokens).toBe(4096)
    expect((budgetSlider.element as HTMLInputElement).value).toBe('4096')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      aiPreferences: savedAiPreferences
    })
    const autoExecuteCheckbox = workspace.findAll('.settings-checkbox-item').find((row) => row.text().includes('自动执行只读命令'))!.find('input')
    expect((autoExecuteCheckbox.element as HTMLInputElement).checked).toBe(false)
    await autoExecuteCheckbox.setValue(true)
    await flushPromises()
    expect(store.settingsNotice).toBe('AI 偏好设置保存失败')
    expect(store.aiPreferences.autoExecuteReadOnlyCommands).toBe(false)
    expect((autoExecuteCheckbox.element as HTMLInputElement).checked).toBe(false)
  })

  it('does not leave terminal setting controls visually changed when the config bridge rejects the snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('terminal')
    await workspace.vm.$nextTick()
    const savedTerminalSettings = {
      ...store.terminalSettings
    }

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      terminal: savedTerminalSettings
    })
    const terminalTypeSelect = workspace.findAll('select.settings-select').at(0)!
    expect((terminalTypeSelect.element as HTMLSelectElement).value).toBe('xterm-256color')
    await terminalTypeSelect.setValue('vt220')
    await flushPromises()
    expect(store.settingsNotice).toBe('终端设置保存失败')
    expect(store.terminalSettings.terminalType).toBe('xterm-256color')
    expect((terminalTypeSelect.element as HTMLSelectElement).value).toBe('xterm-256color')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      terminal: savedTerminalSettings
    })
    const fontSizeInput = workspace.findAll('input.settings-number').at(0)!
    expect((fontSizeInput.element as HTMLInputElement).value).toBe('12')
    await fontSizeInput.setValue('18')
    await flushPromises()
    expect(store.settingsNotice).toBe('终端设置保存失败')
    expect(store.terminalSettings.fontSize).toBe(12)
    expect((fontSizeInput.element as HTMLInputElement).value).toBe('12')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      terminal: savedTerminalSettings
    })
    const showCloseSwitch = workspace.findAll('.settings-switch input').at(2)!
    expect((showCloseSwitch.element as HTMLInputElement).checked).toBe(true)
    await showCloseSwitch.setValue(false)
    await flushPromises()
    expect(store.settingsNotice).toBe('终端设置保存失败')
    expect(store.terminalSettings.showCloseButton).toBe(true)
    expect((showCloseSwitch.element as HTMLInputElement).checked).toBe(true)
  })

  it('matches External reference-style remaining settings pages for extensions, MCP, skills, rules, shortcuts, privacy, devices, billing, and about', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const panel = mount(SettingsPanel, {
      global: { plugins: [pinia] }
    })
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await store.refreshUserAccount()
    const clickNav = async (label: string) => {
      await panel.findAll('.settings-nav-item').find((item) => item.text().includes(label))!.trigger('click')
      await workspace.vm.$nextTick()
    }

    await clickNav('扩展')
    expect(workspace.text()).toContain('自动补全')
    await workspace.findAll('.settings-switch input').at(0)!.setValue(false)
    await flushPromises()
    expect(store.extensionSettings.autoCompleteStatus).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionSettings: expect.objectContaining({
          autoCompleteStatus: false,
          aliasStatus: true
        })
      })
    )
    await workspace.findAll('.settings-form-row').find((row) => row.text().includes('Keyword Highlighting Configuration'))!.find('button').trigger('click')
    expect(store.keywordHighlightEditorOpen).toBe(true)
    expect(workspace.text()).toContain('keyword-highlight.json')
    expect(workspace.find('[data-testid="keyword-highlight-json-editor-monaco"]').exists()).toBe(true)
    expect(monacoMocks.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        language: 'json',
        fontSize: store.editorSettings.fontSize,
        tabSize: store.editorSettings.tabSize,
        wordWrap: store.editorSettings.wordWrap
      })
    )
    const keywordEditor = workspace.find('.keyword-highlight-json-editor')
    expect((keywordEditor.element as HTMLTextAreaElement).value).toContain('keyword-highlight')
    await keywordEditor.setValue('{invalid json')
    expect(workspace.text()).toContain('Invalid JSON')
    const keywordConfig = {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: true
        },
        rules: [
          {
            name: 'sudo',
            enabled: true,
            scope: 'input',
            matchType: 'regex',
            pattern: 'sudo',
            style: {
              foreground: '#E6B450',
              fontStyle: 'bold'
            }
          }
        ]
      }
    }
    await keywordEditor.setValue(JSON.stringify(keywordConfig, null, 2))
    vi.mocked(window.aiops.saveConfig).mockClear()
    await new Promise((resolve) => window.setTimeout(resolve, 1100))
    expect(store.keywordHighlightSettings).toEqual(keywordConfig)
    expect(window.aiops.writeKeywordHighlightConfig).toHaveBeenCalledWith(JSON.stringify(keywordConfig, null, 2))
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
    expect(store.config.keywordHighlight).toEqual(keywordConfig)
    await workspace.find('.keyword-highlight-toolbar .settings-button').trigger('click')
    expect(store.keywordHighlightSettings).toEqual({
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: false
        },
        rules: []
      }
    })
    await workspace.findAll('.keyword-highlight-toolbar .settings-button').find((button) => button.text() === 'Close')!.trigger('click')
    expect(store.keywordHighlightEditorOpen).toBe(false)

    await clickNav('MCP')
    expect(workspace.text()).toContain('MCP Servers')
    expect(workspace.text()).toContain('filesystem')
    await workspace.findAll('.settings-section-title-row .settings-button').find((button) => button.text().includes('Add Server'))!.trigger('click')
    await flushPromises()
    expect(store.mcpConfigEditorOpen).toBe(true)
    expect(workspace.text()).toContain('mcp_settings.json')
    expect(workspace.find('[data-testid="mcp-config-json-editor-monaco"]').exists()).toBe(true)
    expect(monacoMocks.create).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        language: 'json',
        fontSize: store.editorSettings.fontSize,
        tabSize: store.editorSettings.tabSize,
        wordWrap: store.editorSettings.wordWrap
      })
    )
    const mcpEditor = workspace.find('.mcp-config-json-editor')
    expect((mcpEditor.element as HTMLTextAreaElement).value).toContain('"mcpServers"')
    await mcpEditor.setValue('{invalid json')
    expect(workspace.text()).toContain('Invalid JSON')
    const mcpConfig = {
      mcpServers: {
        filesystem: {
          type: 'stdio',
          disabled: false,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
          timeout: 60
        }
      }
    }
    await mcpEditor.setValue(JSON.stringify(mcpConfig, null, 2))
    await new Promise((resolve) => window.setTimeout(resolve, 2100))
    expect(window.aiops.writeMcpConfig).toHaveBeenCalledWith(JSON.stringify(mcpConfig, null, 2))
    await mcpEditor.trigger('keydown', { key: 's', ctrlKey: true })
    expect(JSON.parse(String(vi.mocked(window.aiops.writeMcpConfig).mock.calls.at(-1)?.[0]))).toEqual(mcpConfig)
    await workspace.findAll('.mcp-config-toolbar .settings-button').find((button) => button.text() === 'Close')!.trigger('click')
    expect(store.mcpConfigEditorOpen).toBe(false)
    await clickNav('MCP')
    await workspace.find('.mcp-tool-header button').trigger('click')
    await flushPromises()
    expect(store.mcpServers[0].tools[0].enabled).toBe(false)
    expect(window.aiops.setMcpToolState).toHaveBeenCalledWith('filesystem', 'read_file', false)

    await clickNav('Skills')
    expect(workspace.text()).toContain('incident-triage')
    await workspace.findAll('.settings-action-row button').find((button) => button.text() === 'Create')!.trigger('click')
    expect(store.skillModal.mode).toBe('create')
    await workspace.find('.settings-modal-card label input').setValue('release-check')
    await workspace.findAll('.settings-modal-card textarea')[0].setValue('Check release state')
    await workspace.findAll('.settings-modal-card textarea')[1].setValue('Always inspect rollout health before suggestions.')
    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([
      {
        name: 'release-check',
        description: 'Check release state',
        enabled: true,
        editable: true,
        content: 'Always inspect rollout health before suggestions.',
        path: '/tmp/aiopsterm/skills/release-check/SKILL.md'
      }
    ])
    await workspace.find('.settings-modal-card footer .primary').trigger('click')
    await workspace.vm.$nextTick()
    expect(store.settingsSkills.some((skill) => skill.name === 'release-check')).toBe(true)
    expect(window.aiops.createSkill).toHaveBeenCalledWith({ name: 'release-check', description: 'Check release state' }, 'Always inspect rollout health before suggestions.')

    await clickNav('规则')
    await workspace.find('.settings-section-title-row .settings-button').trigger('click')
    const ruleTextarea = workspace.find('.rule-edit textarea')
    await ruleTextarea.setValue('新增规则')
    await workspace.find('.rule-edit .primary').trigger('click')
    await flushPromises()
    expect(store.settingsRules.some((rule) => rule.content === '新增规则')).toBe(true)
    expect(window.aiops.saveSettingsRule).toHaveBeenCalledWith(expect.objectContaining({ content: '新增规则', enabled: true }))

    await clickNav('快捷键')
    expect(workspace.text()).toContain('快捷键设置')
    await workspace.find('.shortcut-display').trigger('click')
    expect(store.shortcutRecording.actionId).toBe('newTerminal')
    await workspace.find('.shortcut-modal input').setValue('Ctrl+K')
    await workspace.find('.shortcut-modal footer .primary').trigger('click')
    await flushPromises()
    expect(store.settingsShortcuts.find((shortcut) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+K')
    expect(window.aiops.saveSettingsShortcut).toHaveBeenCalledWith({ id: 'newTerminal', shortcut: 'Ctrl+K' })

    await clickNav('可信设备')
    expect(workspace.text()).toContain('Linux Workstation')
    await workspace.findAll('.trusted-device-item .danger').find((button) => !(button.element as HTMLButtonElement).disabled)!.trigger('click')
    expect(store.trustedDeviceModal.open).toBe(true)
    await workspace.find('.settings-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(store.trustedDevices).toHaveLength(1)

    await clickNav('隐私')
    expect(workspace.text()).toContain('Secret Redaction')
    const secretRadios = workspace.findAll('input[name="secretRedaction"]')
    await secretRadios[0].setValue(true)
    await flushPromises()
    expect(store.privacySettings.secretRedaction).toBe('enabled')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        privacy: expect.objectContaining({
          secretRedaction: 'enabled'
        })
      })
    )
    expect(workspace.text()).toContain('Supported Patterns')

    await clickNav('计费概览')
    expect(workspace.text()).toContain('账户中心')
    expect(workspace.text()).toContain('Subscription')

    ;(globalThis as any).__setUserAccountProfileMock?.({ skippedLogin: true, lastLoginMethod: 'skip', email: '', subscription: 'free', subscriptionExpiresAt: '' })
    await store.refreshUserAccount()
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('登录后可查看账户订阅、预算和用量比例。')
    vi.mocked(window.aiops.openUserLogin).mockClear()
    await workspace.find('.settings-empty-state .settings-button.primary').trigger('click')
    await flushPromises()
    expect(window.aiops.openUserLogin).toHaveBeenCalled()
    expect(store.billingSettings.skippedLogin).toBe(true)
    ;(globalThis as any).__resetUserAccountStoreMock?.()
    await store.refreshUserAccount()
    await workspace.vm.$nextTick()

    await clickNav('关于')
    expect(workspace.text()).toContain('Log Diagnostics')
    expect(workspace.text()).toContain('Feedback')
    vi.mocked(window.aiops.checkUpdate).mockClear()
    const aboutUpdateClick = workspace.find('.about-card .settings-button').trigger('click')
    expect(store.aboutSettings.updateStatus).toBe('checking')
    await aboutUpdateClick
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(store.aboutSettings.updateStatus).toBe('latest')
    expect(workspace.text()).toContain('Check Update (Latest Version)')
    expect(window.aiops.checkUpdate).toHaveBeenCalled()

    vi.mocked(window.aiops.checkUpdate).mockResolvedValueOnce({
      available: true,
      channel: 'manual',
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.1', channel: 'manual' }
    })
    await workspace.find('.about-card .settings-button').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Download Update (0.1.1)')
    await workspace.find('.about-card .settings-button').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.downloadAppUpdate).toHaveBeenCalledWith('0.1.1')
    expect(store.aboutSettings.updateStatus).toBe('downloaded')
    expect(workspace.text()).toContain('Install')
    await workspace.find('.about-card .settings-button').trigger('click')
    await flushPromises()
    expect(window.aiops.installAppUpdate).toHaveBeenCalledWith('0.1.1')
    expect(store.aboutSettings.updateStatus).toBe('install-requested')
    expect(store.aboutSettings.version).toBe('0.1.0')
    expect(store.aboutSettings.newVersion).toBe('0.1.1')
    expect(workspace.text()).toContain('Install Requested')
    await workspace.findAll('.diagnostics-card .settings-button').find((button) => button.text().includes('Open Log Dir'))!.trigger('click')
    expect(window.aiops.openLogDir).toHaveBeenCalled()
    await workspace.findAll('.diagnostics-card .settings-button').find((button) => button.text().includes('Submit Feedback'))!.trigger('click')
    expect(window.aiops.openExternalUrl).toHaveBeenCalledWith('https://aiopsterm.local/feedback')
  })
})
