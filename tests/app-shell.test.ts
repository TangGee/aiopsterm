import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'

type MockSelectionPosition = { start: { x: number; y: number }; end: { x: number; y: number } }
type MockXtermInstance = {
  cols: number
  rows: number
  buffer: { active: { viewportY: number; cursorX: number; cursorY: number; baseY?: number } }
  options: Record<string, unknown>
  screenText?: string
  selectedText: string
  selectionPosition: MockSelectionPosition | undefined
  selectionCallbacks: Array<() => void>
  resizeCallbacks: Array<(size: { cols: number; rows: number }) => void>
  dataCallbacks: Array<(data: string) => void>
  customKeyEventHandler: ((event: KeyboardEvent) => boolean) | undefined
  open: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  clearSelection: ReturnType<typeof vi.fn>
  scrollToBottom: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  hasSelection: () => boolean
  getSelection: () => string
  getSelectionPosition: () => MockSelectionPosition | undefined
  onSelectionChange: (callback: () => void) => void
  onResize: (callback: (size: { cols: number; rows: number }) => void) => void
  onData: (callback: (data: string) => void) => { dispose: ReturnType<typeof vi.fn> }
  attachCustomKeyEventHandler: (callback: (event: KeyboardEvent) => boolean) => void
  setVisibility?: ReturnType<typeof vi.fn>
  setPriority?: ReturnType<typeof vi.fn>
  setSessionId?: ReturnType<typeof vi.fn>
  ensureSurfaceAttached?: ReturnType<typeof vi.fn>
  detachSurface?: ReturnType<typeof vi.fn>
  hostElement?: () => HTMLElement | null
  updateKeywordHighlight?: ReturnType<typeof vi.fn>
  updateSettings?: ReturnType<typeof vi.fn>
  startCoreOnly?: ReturnType<typeof vi.fn>
  writeAndMeasurePaint?: ReturnType<typeof vi.fn>
  debugSnapshot?: () => {
    text: string
    cols: number
    rows: number
    viewportY: number
    baseY: number
    lines: Array<{ y: number; text: string; cells?: unknown[]; highlights?: unknown[] }>
    lastFrameSeq: number
  }
  debugInfo?: () => {
    terminalId: string
    sessionId?: string
    groupId: string
    surface: string
    workerId: number
    visible: boolean
    priority: string
    cols: number
    rows: number
    coreCreated: boolean
    surfaceAttached: boolean
    lastSnapshotSeq: number
    lastFrameSeq: number
    lastFrameAt: number
  }
  readScreen?: (tailLines?: number) => Promise<{ text: string; cols: number; rows: number }>
  emitSelection: (text: string, position?: MockSelectionPosition) => void
  emitData: (data: string) => void
  emitKeyEvent: (event: KeyboardEvent) => boolean
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
      dataCallbacks: [],
      customKeyEventHandler: undefined,
      open: vi.fn(),
      loadAddon: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      scrollToBottom: vi.fn(),
      refresh: vi.fn(),
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
      onData(callback: (data: string) => void) {
        this.dataCallbacks.push(callback)
        return { dispose: vi.fn() }
      },
      attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) {
        this.customKeyEventHandler = callback
      },
      emitSelection(text: string, position = { start: { x: 0, y: 4 }, end: { x: text.length, y: 4 } }) {
        this.selectedText = text
        this.selectionPosition = position
        this.selectionCallbacks.forEach((callback) => callback())
      },
      emitData(data: string) {
        this.dataCallbacks.forEach((callback) => callback(data))
      },
      emitKeyEvent(event: KeyboardEvent) {
        return this.customKeyEventHandler ? this.customKeyEventHandler(event) : true
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

vi.mock('@/services/terminal/threadedTerminalRuntime', () => ({
  ThreadedTerminalFitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
  ThreadedTerminalSearchAddon: vi.fn().mockImplementation(() => ({
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn()
  })),
  createThreadedTerminalHost: vi.fn().mockImplementation((options = {}) => {
    const stripAnsi = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    const normalizeScreenText = (value: string) =>
      stripAnsi(value)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    const appendScreenText = (instance: MockXtermInstance, value: string) => {
      instance.screenText = `${instance.screenText || ''}${normalizeScreenText(value)}`
      const lines = (instance.screenText || '').split('\n')
      instance.buffer.active.baseY = Math.max(0, lines.length - instance.rows)
      instance.buffer.active.viewportY = instance.buffer.active.baseY
      const lastLine = lines.at(-1) || ''
      instance.buffer.active.cursorX = lastLine.length
      instance.buffer.active.cursorY = Math.max(0, Math.min(instance.rows - 1, lines.length - 1))
    }
    const screenLinesFor = (instance: MockXtermInstance, tailLines?: number) => {
      const count = tailLines || instance.rows
      return (instance.screenText || '').split('\n').slice(-count)
    }
    const instance: MockXtermInstance & { currentHost?: HTMLElement; sessionId?: string } = {
      cols: options.cols || 80,
      rows: options.rows || 20,
      buffer: { active: { viewportY: 0, cursorX: 0, cursorY: 0 } },
      options: {
        terminalType: options.settings?.terminalType,
        termName: options.settings?.terminalType,
        fontFamily: options.settings?.fontFamily,
        fontSize: options.settings?.fontSize,
        lineHeight: options.settings?.lineHeight,
        cursorBlink: options.settings?.cursorBlink,
        cursorStyle: options.settings?.cursorStyle,
        scrollBack: options.settings?.scrollBack,
        scrollback: options.settings?.scrollBack
      },
      screenText: normalizeScreenText(options.initialData || ''),
      selectedText: '',
      selectionPosition: undefined,
      selectionCallbacks: [],
      resizeCallbacks: [],
      dataCallbacks: [],
      customKeyEventHandler: undefined,
      open: vi.fn(function (this: MockXtermInstance & { currentHost?: HTMLElement }, element: HTMLElement) {
        this.currentHost = element
        element.classList.add('threaded-terminal-host')
      }),
      loadAddon: vi.fn(),
      write: vi.fn(function (this: MockXtermInstance, data: string, callback?: () => void) {
        appendScreenText(this, data)
        callback?.()
      }),
      clear: vi.fn(function (this: MockXtermInstance) {
        this.screenText = ''
        this.buffer.active.cursorX = 0
        this.buffer.active.cursorY = 0
        this.buffer.active.viewportY = 0
        this.buffer.active.baseY = 0
      }),
      focus: vi.fn(),
      dispose: vi.fn(),
      scrollToBottom: vi.fn(),
      refresh: vi.fn(),
      clearSelection: vi.fn(function (this: MockXtermInstance) {
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
      onData(callback: (data: string) => void) {
        this.dataCallbacks.push(callback)
        return { dispose: vi.fn() }
      },
      attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) {
        this.customKeyEventHandler = callback
      },
      setVisibility: vi.fn(),
      setPriority: vi.fn(),
      setSessionId: vi.fn(function (this: MockXtermInstance & { sessionId?: string }, sessionId?: string) {
        this.sessionId = sessionId
      }),
      ensureSurfaceAttached: vi.fn(() => true),
      detachSurface: vi.fn(function (this: MockXtermInstance & { currentHost?: HTMLElement }) {
        this.currentHost?.classList.remove('threaded-terminal-host')
        this.currentHost = undefined
      }),
      hostElement() {
        return this.currentHost || null
      },
      updateKeywordHighlight: vi.fn(),
      updateSettings: vi.fn(function (this: MockXtermInstance, settings: Record<string, unknown>) {
        Object.assign(this.options, {
          ...settings,
          termName: settings.terminalType,
          scrollback: settings.scrollBack
        })
      }),
      startCoreOnly: vi.fn(),
      writeAndMeasurePaint: vi.fn(function (this: MockXtermInstance, data: string) {
        this.write(data)
        return Promise.resolve({
          terminalId: options.terminalId || '',
          latencyMs: 1,
          frameMs: 1,
          paintedRows: 1,
          full: false,
          seq: 1
        })
      }),
      debugSnapshot() {
        const lines = screenLinesFor(this)
        return {
          text: lines.join('\n').replace(/\s+$/g, ''),
          cols: this.cols,
          rows: this.rows,
          viewportY: this.buffer.active.viewportY,
          baseY: this.buffer.active.baseY || 0,
          lines: lines.map((text, index) => ({ y: index, text, cells: [], highlights: [] })),
          lastFrameSeq: 1
        }
      },
      debugInfo() {
        return {
          terminalId: options.terminalId || '',
          sessionId: this.sessionId || options.sessionId,
          groupId: options.groupId || '',
          surface: options.surface || 'workspace',
          workerId: 1,
          visible: options.visible ?? true,
          priority: options.priority || 'active',
          cols: this.cols,
          rows: this.rows,
          coreCreated: true,
          surfaceAttached: true,
          lastSnapshotSeq: 1,
          lastFrameSeq: 1,
          lastFrameAt: 1
        }
      },
      readScreen(tailLines?: number) {
        return Promise.resolve({
          text: screenLinesFor(this, tailLines).join('\n').replace(/\s+$/g, ''),
          cols: this.cols,
          rows: this.rows
        })
      },
      emitSelection(text: string, position = { start: { x: 0, y: 4 }, end: { x: text.length, y: 4 } }) {
        this.selectedText = text
        this.selectionPosition = position
        this.selectionCallbacks.forEach((callback) => callback())
      },
      emitData(data: string) {
        this.dataCallbacks.forEach((callback) => callback(data))
      },
      emitKeyEvent(event: KeyboardEvent) {
        return this.customKeyEventHandler ? this.customKeyEventHandler(event) : true
      }
    }
    mockXtermInstances.push(instance)
    return instance
  }),
  isThreadedTerminalHost: (value: unknown) => mockXtermInstances.includes(value as MockXtermInstance),
  threadedTerminalCapability: () => ({ supported: true }),
  threadedTerminalPriorityFor: (_terminalId: string, activeTerminalId: string, visible: boolean) =>
    !visible ? 'background' : activeTerminalId ? 'active' : 'visible',
  getThreadedTerminalDebugStats: () => ({
    coreWorkerCount: 1,
    renderWorkerReady: true,
    hostCount: mockXtermInstances.length,
    hosts: [],
    renderGroups: []
  })
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
import TransferSide from '@/components/files/TransferSide.vue'
import FilesWorkspace from '@/components/FilesWorkspace.vue'
import TerminalWorkspace from '@/components/TerminalWorkspace.vue'
import ExtensionsWorkspace from '@/components/ExtensionsWorkspace.vue'
import KubernetesWorkspace from '@/components/KubernetesWorkspace.vue'
import DatabaseWorkspace from '@/components/DatabaseWorkspace.vue'
import SettingsWorkspace from '@/components/SettingsWorkspace.vue'
import WorkspacePanel from '@/components/panels/WorkspacePanel.vue'
import AiSessionsPanel from '@/components/panels/AiSessionsPanel.vue'
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
import { shortcutRuntime } from '@/services/common/shortcutRuntime'
import { useWorkspaceStore } from '@/stores/workspace'
import { settingsBackgroundPresets } from '@/config/settings'
import { DEFAULT_KNOWLEDGE_INTERFACE_IMAGE_BASE64 } from '@shared/knowledgeBaseSeed'
import type { KeywordHighlightUserConfig } from '@shared/contracts/appRuntime'
import type { FileSessionInfo } from '@shared/contracts/files'
import type { TerminalCreateOptions, TerminalKeyboardInteractiveRequest, TerminalSessionInfo } from '@shared/contracts/terminalSessions'

const prodKeychainSshAgentFingerprint = 'SHA256:KW/btgUSM+Gu9ht4gyd2CMSZB/1setTDE0+Uik88xGE'
const teleportStub = { teleport: true }
const withTeleportStub = (options: Record<string, any> = {}) => ({
  ...options,
  global: {
    ...(options.global || {}),
    stubs: {
      ...((options.global || {}).stubs || {}),
      ...teleportStub
    }
  }
})
const mountAssetsPanel = (options: Parameters<typeof mount>[1] = {}) => mount(AssetsPanel, withTeleportStub(options))
const mountWorkspacePanel = (options: Parameters<typeof mount>[1] = {}) => mount(WorkspacePanel, withTeleportStub(options))

const enableCatalogModelOptions = async (store: ReturnType<typeof useWorkspaceStore>) => {
  store.updateModelProviderConfig('ollama', { modelId: 'qwen2.5-coder' })
  const modelSettings = store.config.modelSettings!
  const nextSettings = {
    ...modelSettings,
    providers: {
      ...modelSettings.providers,
      ollama: {
        ...modelSettings.providers.ollama,
        modelId: 'qwen2.5-coder'
      }
    },
    options: [
      ...(modelSettings.options || []).filter((option) => option.name !== 'gpt-5-Thinking' && option.name !== 'qwen2.5-coder'),
      { name: 'gpt-5-Thinking', locked: false, checked: true, type: 'standard' as const, apiProvider: 'default' },
      { name: 'qwen2.5-coder', displayName: 'Ollama Coder', locked: false, checked: true, type: 'custom' as const, apiProvider: 'ollama' }
    ]
  }
  store.config = { ...store.config, modelSettings: nextSettings }
  await store.refreshAiModelCatalog({ replaceSettingsOptions: true })
}

const mountAiPanelWithModels = async (pinia: ReturnType<typeof createPinia>) => {
  const store = useWorkspaceStore()
  await enableCatalogModelOptions(store)
  const wrapper = mount(AiPanel, {
    attachTo: document.body,
    props: { agentMode: true },
    global: { plugins: [pinia] }
  })
  await flushPromises()
  await wrapper.vm.$nextTick()
  await switchAiPanelToClassic(wrapper)
  return { wrapper, store }
}

const switchAiPanelToClassic = async (wrapper: VueWrapper<any>) => {
  if (wrapper.find('[data-testid="ai-panel-mode-open"]').text().includes('Classic Chat')) return
  await wrapper.find('[data-testid="ai-panel-mode-open"]').trigger('click')
  const classicModeButton = wrapper.find('[data-testid="ai-mode-classic"]')
  if (!classicModeButton.exists()) return
  await classicModeButton.trigger('click')
  await flushPromises()
  await wrapper.vm.$nextTick()
}

const waitForDatabaseSqlResult = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  await flushPromises()
}

const waitForDatabaseDbAiDone = async () => {
  await new Promise((resolve) => window.setTimeout(resolve, 180))
  await flushPromises()
}

const createTestDataTransfer = () => {
  const data = new Map<string, string>()
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
    getData: vi.fn((type: string) => data.get(type) || ''),
    get types() {
      return [...data.keys()]
    }
  }
}

const inlineStyleImports = (stylePath: string, seen = new Set<string>()): string => {
  if (seen.has(stylePath)) return ''
  seen.add(stylePath)
  return readFileSync(stylePath, 'utf-8').replace(/@import\s+['"](\.[^'"]+)['"];\s*/g, (_match, importPath: string) =>
    inlineStyleImports(join(dirname(stylePath), importPath), seen)
  )
}

const appStyles = () => inlineStyleImports('src/renderer/src/styles/base.less')

const findMenuButton = (wrapper: VueWrapper<any>, menuSelector: string, label: string) => {
  const button = wrapper.find(menuSelector).findAll('button').find((item) => item.text().includes(label))
  if (!button) throw new Error(`Menu button not found: ${label}`)
  return button
}

const findFilesGroupRow = (wrapper: VueWrapper<any>, label: string) => {
  const row = wrapper.findAll('.files-tree-group-row').find((item) => item.text().includes(label))
  if (!row) throw new Error(`Files group row not found: ${label}`)
  return row
}

const findFilesSessionRow = (wrapper: VueWrapper<any>, label: string) => {
  const row = wrapper.findAll('.files-tree-session').find((item) => item.text().includes(label))
  if (!row) throw new Error(`Files session row not found: ${label}`)
  return row
}

const countFilesSessionRows = (wrapper: VueWrapper<any>, label: string) => wrapper.findAll('.files-tree-session').filter((item) => item.text().includes(label)).length

const openAssetTreeCreateHost = async (wrapper: VueWrapper<any>) => {
  await wrapper.find('.asset-host-tree').trigger('contextmenu', { clientX: 160, clientY: 220 })
  const button = wrapper.find('.asset-context-menu').findAll('button').find((item) => item.text().includes('新建主机'))
  if (!button) throw new Error('Asset create host context button not found')
  await button.trigger('click')
  await flushPromises()
}

const keySubmitButton = (wrapper: VueWrapper<any>) => {
  const button = wrapper.findAll('.key-form-panel .asset-submit-button').find((item) => !item.classes().includes('secondary'))
  if (!button) throw new Error('Key submit button not found')
  return button
}

const openTerminalMenuButton = async (wrapper: VueWrapper<any>, label: string, hostSelector = '.xterm-host') => {
  await wrapper.find(hostSelector).trigger('contextmenu')
  return findMenuButton(wrapper, '.terminal-context-menu', label)
}

const ensureVisibleTerminalTab = async (wrapper: VueWrapper<any>) => {
  if (wrapper.find('.terminal-tab.active').exists()) return
  useWorkspaceStore().createPanel()
  await flushPromises()
}

const openTerminalCommandLine = async (wrapper: VueWrapper<any>, hostSelector = '.xterm-host') => {
  await (await openTerminalMenuButton(wrapper, '输入命令', hostSelector)).trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper.find('.command-line input')
}

const openLocalShellFromActiveTab = async (wrapper: VueWrapper<any>) => {
  await ensureVisibleTerminalTab(wrapper)
  await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
  const connectionButton = ['打开本地 shell', '重新连接', '连接 SSH']
    .map((label) => wrapper.find('.tab-menu').findAll('button').find((item) => item.text().includes(label)))
    .find(Boolean)
  if (!connectionButton) throw new Error('Menu connection button not found')
  await connectionButton.trigger('click')
  await flushPromises()
}

const buildNonJumpserverOrganizationRefreshData = async () => {
  const snapshot = await window.aiops.listAssets()
  return {
    ...snapshot,
    assets: snapshot.assets.map((asset) =>
      asset.id === 'asset-5' || asset.uuid === 'org-1'
        ? { ...asset, name: 'not-jumpserver-org', title: 'not-jumpserver-org', tags: asset.tags.filter((tag) => tag.toLowerCase() !== 'jumpserver') }
        : asset
    ),
    organizationId: 'asset-5',
    refreshed: 1,
    created: 1,
    updated: 0
  }
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
type TextWrapperLike = { text: () => string }
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

const placeCaretAfterTrailingSlash = (editable: Element) => {
  const textNodes: Text[] = []
  const collectTextNodes = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        textNodes.push(child as Text)
        return
      }
      collectTextNodes(child)
    })
  }
  collectTextNodes(editable)
  const slashNode = textNodes.reverse().find((node) => node.data.endsWith('/'))
  if (!slashNode) throw new Error('Trailing slash token not found')
  const range = document.createRange()
  range.setStart(slashNode, slashNode.data.length)
  range.collapse(true)
  ;(editable as HTMLElement).focus()
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

const waitForText = async (wrapper: TextWrapperLike, text: string) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await flushPromises()
    if (wrapper.text().includes(text)) return
  }
  throw new Error(`Text did not appear: ${text}`)
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

const waitForMockCallCount = async (mock: { mock: { calls: unknown[] } }, count: number, label: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 25))
    if (mock.mock.calls.length >= count) return
  }
  throw new Error(`${label} was not called ${count} times`)
}

const waitForAnimationFrames = async (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

const withMockExecCommand = async <T>(handler: () => boolean, callback: (execCommandSpy: ReturnType<typeof vi.fn>) => Promise<T>) => {
  const originalExecCommand = document.execCommand
  const execCommandSpy = vi.fn(handler)
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommandSpy
  })
  try {
    return await callback(execCommandSpy)
  } finally {
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand
      })
    } else {
      Reflect.deleteProperty(document, 'execCommand')
    }
  }
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
    window.localStorage.removeItem('aiopsterm.aiPanelMode')
    restoreMockVoiceRecorder = installMockVoiceRecorder()
    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetKubernetesCatalogMock?.()
    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    ;(globalThis as any).__resetDatabaseTableRowsMock?.()
    ;(globalThis as any).__resetDatabaseSqlExecutionMock?.()
    ;(globalThis as any).__resetExtensionPluginStoreMock?.()
    ;(globalThis as any).__resetFileEntriesMock?.()
    ;(globalThis as any).__resetChatHistoryStoreMock?.()
    ;(globalThis as any).__resetAiTodoSnapshotMock?.()
    ;(globalThis as any).__resetUserAccountStoreMock?.()
    ;(globalThis as any).__resetSkillsStoreMock?.()
    ;(globalThis as any).__resetMcpStoreMock?.()
    ;(globalThis as any).__resetConfigStoreMock?.()
    ;(globalThis as any).__resetAiAgentSessionEventMock?.()
    ;(globalThis as any).__resetTerminalKeyboardInteractiveMock?.()
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
    expect(wrapper.find('.ai-header h2').text()).toBe('AI')
    expect(wrapper.find('[data-testid="ai-codex-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-panel-mode-open"]').text()).toContain('Codex CLI')
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').text()).toContain('未绑定终端')
    expect(window.aiops.createCodexSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('切换布局')
    expect(wrapper.text()).not.toContain('local shell')
  })

  it('keeps AI session management in the left panel while reusing the terminal workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.setActiveModule('aiSessions')
    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.module-panel-pane .ai-sessions-panel').exists()).toBe(true)
    expect(wrapper.find('.terminal-workspace').exists()).toBe(true)
    expect(wrapper.find('.ai-sessions-workspace').exists()).toBe(false)
    expect(wrapper.find('.module-panel-pane').text()).toContain('AI 会话')
    expect(wrapper.text()).not.toContain('Managed Local Agents')
  })

  it('refreshes managed AI sessions when backend managed events arrive', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.setActiveModule('aiSessions')
    const renamedSnapshot = {
      ok: true,
      data: {
        sessions: [
          {
            id: 'codex-auto-title-1',
            source: 'codex',
            title: '发布脚本修复',
            summary: '修复发布脚本失败重试',
            state: 'idle',
            lastEvent: 'stop',
            lastActivityAt: 900,
            createdAt: 800,
            updatedAt: 950,
            autoTitle: '发布脚本修复',
            events: [],
            decisions: []
          }
        ]
      }
    } as any
    vi.mocked(window.aiops.listManagedAiSessions).mockResolvedValue(renamedSnapshot).mockResolvedValueOnce({
      ok: true,
      data: { sessions: [] }
    } as any)

    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    await flushPromises()

    const callsBeforeManagedEvent = vi.mocked(window.aiops.listManagedAiSessions).mock.calls.length
    ;(globalThis as any).__emitManagedAiSessionEventMock({
      name: 'managed_ai.session.renamed',
      category: 'managed-ai',
      source: 'codex',
      sessionId: 'codex-auto-title-1',
      title: '发布脚本修复',
      payload: { source: 'codex', sessionId: 'codex-auto-title-1', title: '发布脚本修复' },
      seq: 2
    })
    await flushPromises()
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
    await flushPromises()

    expect(window.aiops.onManagedAiSessionEvent).toHaveBeenCalled()
    expect(vi.mocked(window.aiops.listManagedAiSessions).mock.calls.length).toBeGreaterThanOrEqual(callsBeforeManagedEvent + 1)
    expect(wrapper.find('.ai-sessions-panel').text()).toContain('发布脚本修复')
    expect(store.managedAiSessions[0]?.autoTitle).toBe('发布脚本修复')
  })

  it('lets the AI session panel mark the selected managed session as handled', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.applyLocalTerminalSession('panel-main', {
      id: 'terminal-session-1',
      kind: 'local',
      shell: '/bin/bash',
      cwd: '/work/project'
    })
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-session-1',
      title: 'Deploy approval',
      summary: 'Approve npm test',
      panelId: 'panel-main',
      terminalSessionId: 'terminal-session-1',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 100
    })
    store.focusManagedAiSession('claude-session-1')

    const wrapper = mount(AiSessionsPanel, {
      global: {
        plugins: [pinia]
      }
    })
    await flushPromises()

    expect(wrapper.find('.ai-session-row.active').text()).toContain('Deploy approval')
    expect(store.aiAttentionUnreadCount).toBe(1)
    await wrapper.find('.ai-session-handle').trigger('click')
    await flushPromises()

    expect(store.aiAttentionUnreadCount).toBe(0)
    expect(store.selectedManagedAiSessionKey).toBe('')
    expect(store.activePanelId).toBe('panel-main')
  })

  it('summarizes and filters managed AI sessions by status, agent, and project', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1717200600000)
    let wrapper: VueWrapper | null = null
    try {
      store.upsertManagedAiSession({
        source: 'claude-code',
        event: 'permission_request',
        sessionId: 'claude-attention-1',
        title: 'Deploy approval',
        summary: 'Approve release',
        cwd: '/work/api',
        requestKind: 'permission',
        decisionMode: 'blocking',
        actionable: true,
        receivedAt: 1717200500000
      })
      store.upsertManagedAiSession({
        source: 'codex',
        event: 'stop',
        sessionId: 'codex-idle-1',
        title: 'Docs cleanup',
        summary: 'Round finished',
        cwd: '/work/docs',
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        receivedAt: 1717200400000
      })
      store.upsertManagedAiSession({
        source: 'gemini',
        event: 'pre_tool_use',
        sessionId: 'gemini-work-1',
        title: 'API refactor',
        summary: 'Reading files',
        cwd: '/work/api',
        requestKind: 'telemetry',
        decisionMode: 'telemetry',
        receivedAt: 1717200550000
      })

      wrapper = mount(AiSessionsPanel, {
        global: {
          plugins: [pinia]
        }
      })
      await flushPromises()

      expect(wrapper.find('.ai-sessions-cockpit').text()).toContain('总会话')
      expect(wrapper.find('.ai-sessions-cockpit').text()).toContain('待处理')
      expect(wrapper.find('.ai-sessions-attention-strip').text()).toContain('Deploy approval')
      expect(wrapper.findAll('.ai-session-row')).toHaveLength(3)

      await wrapper.find('.ai-sessions-attention-strip button').trigger('click')
      await flushPromises()
      expect(store.selectedManagedAiSessionKey).toBe('claude-code:claude-attention-1')

      const sourceSelect = wrapper.findAll('.ai-sessions-context select').at(0)!
      await sourceSelect.setValue('gemini')
      await flushPromises()
      expect(wrapper.findAll('.ai-session-row')).toHaveLength(1)
      expect(wrapper.find('.ai-session-row').text()).toContain('API refactor')

      await sourceSelect.setValue('all')
      const projectSelect = wrapper.findAll('.ai-sessions-context select').at(1)!
      await projectSelect.setValue('/work/api')
      await flushPromises()
      expect(wrapper.findAll('.ai-session-row')).toHaveLength(2)
      expect(wrapper.text()).toContain('Deploy approval')
      expect(wrapper.text()).toContain('API refactor')
      expect(wrapper.text()).not.toContain('Docs cleanup')
    } finally {
      wrapper?.unmount()
      dateNowSpy.mockRestore()
    }
  })

  it('copies and handles the currently filtered AI session queue', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    vi.mocked(navigator.clipboard.writeText).mockClear()
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-api-approval',
      title: 'API approval',
      summary: 'Approve deploy command',
      cwd: '/work/api',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 1717200500000
    })
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-docs-approval',
      title: 'Docs approval',
      summary: 'Approve docs cleanup',
      cwd: '/work/docs',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 1717200400000
    })
    store.upsertManagedAiSession({
      source: 'gemini',
      event: 'pre_tool_use',
      sessionId: 'gemini-api-work',
      title: 'API work',
      summary: 'Inspecting routes',
      cwd: '/work/api',
      requestKind: 'telemetry',
      decisionMode: 'telemetry',
      receivedAt: 1717200550000
    })
    vi.mocked(window.aiops.bulkManagedAiSessions).mockImplementationOnce(async (input) => ({
      ok: true,
      data: {
        changed: 1,
        snapshot: {
          sessions: store.managedAiSessions.map((session) =>
            input.sources?.includes(session.source) && input.sessionIds?.includes(session.id)
              ? { ...session, state: 'idle' as const, handledAt: 1717200600000, updatedAt: 1717200600000 }
              : session
          )
        }
      }
    }))

    const wrapper = mount(AiSessionsPanel, {
      global: {
        plugins: [pinia]
      }
    })
    await flushPromises()

    const projectSelect = wrapper.findAll('.ai-sessions-context select').at(1)!
    await projectSelect.setValue('/work/api')
    await flushPromises()

    expect(wrapper.find('.ai-sessions-queue-bar').text()).toContain('2 个当前会话')
    expect(wrapper.find('.ai-sessions-queue-bar').text()).toContain('1 个待处理')
    const queueButtons = wrapper.findAll('.ai-sessions-queue-actions button')
    await queueButtons.at(1)!.trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('AI 会话队列：api (2)'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('API approval'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('API work'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.not.stringContaining('Docs approval'))

    await queueButtons.at(2)!.trigger('click')
    await flushPromises()

    expect(window.aiops.bulkManagedAiSessions).toHaveBeenCalledWith({
      operation: 'mark-handled',
      sources: ['claude-code'],
      sessionIds: ['claude-api-approval']
    })
    expect(store.managedAiSessions.find((session) => session.id === 'claude-api-approval')?.state).toBe('idle')
    expect(store.managedAiSessions.find((session) => session.id === 'claude-docs-approval')?.state).toBe('needsInput')
    expect(store.topNotice).toBe('已处理 1 个 AI 会话')

    wrapper.unmount()
  })

  it('filters and copies managed AI session timeline events', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    vi.mocked(navigator.clipboard.writeText).mockClear()
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-timeline-1',
      title: 'Timeline audit',
      summary: 'Approve deployment command',
      requestId: 'permission-1',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 100
    })
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'question',
      sessionId: 'claude-timeline-1',
      title: 'Timeline audit',
      summary: 'Which window should deploy?',
      requestId: 'question-1',
      requestKind: 'question',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 200
    })
    store.focusManagedAiSession('claude-timeline-1')

    const wrapper = mount(AiSessionsPanel, {
      global: {
        plugins: [pinia]
      }
    })
    await flushPromises()

    expect(wrapper.find('.ai-session-section-header').text()).toContain('2 / 2')
    const questionFilter = wrapper.findAll('.ai-session-event-filters button').find((button) => button.text() === '提问')
    expect(questionFilter).toBeTruthy()
    await questionFilter!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.ai-session-section-header').text()).toContain('1 / 2')
    expect(wrapper.find('.ai-session-timeline').text()).toContain('Which window should deploy?')
    expect(wrapper.find('.ai-session-timeline').text()).not.toContain('Approve deployment command')

    await wrapper.find('.ai-session-event-copy').trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"requestKind": "question"'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.not.stringContaining('"raw"'))
    expect(store.topNotice).toBe('AI 会话事件已复制')
  })

  it('links the empty AI session panel to AI settings for hook setup', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.setActiveModule('aiSessions')

    const wrapper = mount(AiSessionsPanel, {
      global: {
        plugins: [pinia]
      }
    })
    await flushPromises()

    expect(wrapper.find('.ai-sessions-empty').text()).toContain('Agent Hook')
    await wrapper.find('.ai-sessions-empty-action').trigger('click')
    await flushPromises()

    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('ai')
    expect(store.rightPanelOpen).toBe(false)
  })

  it('opens AI settings from the AI session panel header', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.upsertManagedAiSession({
      source: 'codex',
      event: 'session_start',
      sessionId: 'codex-session-1',
      title: 'Codex work',
      summary: 'Project setup',
      panelId: 'panel-main',
      terminalSessionId: 'terminal-session-1',
      receivedAt: 100
    })

    const wrapper = mount(AiSessionsPanel, {
      global: {
        plugins: [pinia]
      }
    })
    await flushPromises()

    await wrapper.find('.ai-sessions-settings').trigger('click')
    await flushPromises()

    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('ai')
  })

  it('applies persisted background and watermark settings at the app shell level', async () => {
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
    await flushPromises()
    const store = useWorkspaceStore()
    await expect(store.selectBackground('custom', 'file:///tmp/aiopsterm/backgrounds/settings-bg.png')).resolves.toBe(true)
    await expect(store.updateBackgroundTuning({ opacity: 0.4, brightness: 0.7 })).resolves.toBe(true)
    await expect(store.updateWatermark('open')).resolves.toBe(true)
    await wrapper.vm.$nextTick()

    const shell = wrapper.find('.app-shell')
    expect(shell.classes()).toContain('has-app-background')
    expect(shell.classes()).toContain('watermark-enabled')
    expect(shell.attributes('style')).toContain('--app-bg-image: url(\"file:///tmp/aiopsterm/backgrounds/settings-bg.png\")')
    expect(shell.attributes('style')).toContain('--app-bg-opacity: 0.4')
    expect(shell.attributes('style')).toContain('--app-bg-brightness: 0.7')
    const styles = appStyles()
    expect(styles).toContain('--workspace-bg: color-mix(in srgb, var(--bg) 6%, transparent);')
    expect(styles).toContain('--glass-surface: color-mix(in srgb, var(--surface) 36%, transparent);')
    expect(styles).toContain('--readable-surface: color-mix(in srgb, var(--surface-2) 82%, transparent);')
    expect(styles).toContain('.side-rail {\n  width: 48px;\n  border-right: 1px solid var(--border);\n  background: var(--glass-surface);')
    expect(styles).toContain('.terminal-tab {\n  height: 31px;')
    expect(styles).toContain('background: var(--glass-surface);')
    expect(styles).toContain('.app-shell.has-app-background .terminal-context-menu')
    expect(styles).toContain('.app-shell.has-app-background .terminal-global-command')
    expect(styles).toContain('.app-shell.has-app-background .chat-input')
    expect(styles).toContain('.app-shell.has-app-background .select-popup')
    expect(styles).toContain('.app-shell.has-app-background .message,')
    expect(styles).toContain('.app-shell.has-app-background .db-status-bar')
    expect(styles).toContain('.app-shell.has-app-background .ai-codex-xterm-stack.is-idle')
    expect(styles).toContain('.app-shell.has-app-background .ai-codex-xterm .xterm-viewport')
    expect(styles).toContain('background: transparent !important;')
    expect(styles).toContain('.ai-codex-xterm-stack {')
    expect(styles).toContain('grid-template: minmax(0, 1fr) / minmax(0, 1fr);')
    expect(styles).toContain('border: 1px solid var(--border);')
    expect(styles).toContain('.ai-codex-xterm-stack > .threaded-terminal-render-group-canvas')
    expect(styles).toContain('.app-shell.has-app-background .ai-codex-xterm.threaded-terminal-host,')
    expect(styles).toContain('backdrop-filter: none;')

    await expect(store.selectBackground('preset', 'aurora-glass-image')).resolves.toBe(true)
    await wrapper.vm.$nextTick()
    expect(shell.attributes('style')).toContain('--app-bg-image: url(\"')
    expect(shell.attributes('style')).toContain('aurora-glass')
  })

  it('keeps the general settings background picker from forcing horizontal scrolling', () => {
    const styles = appStyles()
    expect(styles).toContain('.settings-content-scroll {\n  min-width: 0;\n  min-height: 0;\n  overflow-x: hidden;\n  overflow-y: auto;\n}')
    expect(styles).toContain('grid-template-columns: repeat(auto-fit, minmax(150px, 180px));')
    expect(styles).toContain('.settings-bg-tile {\n  width: 100%;\n  min-width: 0;\n  max-width: 180px;')
    expect(styles).not.toContain('grid-template-columns: repeat(3, 180px);')
  })

  it('hydrates secondary module catalogs only after entering their modules', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    const wrapper = mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    await waitForMockCall(vi.mocked(window.aiops.getConfig), 'getConfig')
    await flushPromises()

    vi.mocked(window.aiops.listFileSessionCatalog!).mockClear()
    vi.mocked(window.aiops.kbEnsureRoot!).mockClear()
    vi.mocked(window.aiops.kbListDir!).mockClear()
    vi.mocked(window.aiops.listKubernetesCatalog!).mockClear()
    vi.mocked(window.aiops.listExtensionPlugins!).mockClear()

    expect(window.aiops.listFileSessionCatalog).not.toHaveBeenCalled()
    expect(window.aiops.kbEnsureRoot).not.toHaveBeenCalled()
    expect(window.aiops.kbListDir).not.toHaveBeenCalled()
    expect(window.aiops.listKubernetesCatalog).not.toHaveBeenCalled()
    expect(window.aiops.listExtensionPlugins).not.toHaveBeenCalled()

    store.setActiveModule('files')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listFileSessionCatalog).toHaveBeenCalled()

    vi.mocked(window.aiops.listFileSessionCatalog!).mockClear()
    store.setActiveModule('knowledge')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.kbEnsureRoot).toHaveBeenCalled()
    expect(window.aiops.kbListDir).toHaveBeenCalledWith('')
    expect(window.aiops.listFileSessionCatalog).not.toHaveBeenCalled()

    store.setActiveModule('kubernetes')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listKubernetesCatalog).toHaveBeenCalled()

    store.setActiveModule('extensions')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listExtensionPlugins).toHaveBeenCalledTimes(1)
  })

  it('keeps Classic Chat available beside the Codex CLI AI panel mode', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    mockXtermInstances.length = 0
    await enableCatalogModelOptions(store)
    vi.mocked(window.aiops.listChatConversations).mockClear()
    vi.mocked(window.aiops.listAiTodoSnapshot).mockClear()
    vi.mocked(window.aiops.listAiContextCatalog).mockClear()
    vi.mocked(window.aiops.listAiCommandCatalog).mockClear()
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-codex-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-panel-mode-open"]').text()).toContain('Codex CLI')
    expect(window.aiops.createCodexSession).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').text()).toContain('未绑定终端')
    expect(window.aiops.listChatConversations).not.toHaveBeenCalled()
    expect(window.aiops.listAiTodoSnapshot).not.toHaveBeenCalled()
    expect(window.aiops.listAiContextCatalog).not.toHaveBeenCalled()
    expect(window.aiops.listAiCommandCatalog).not.toHaveBeenCalled()

    store.activePanel.sessionId = 'terminal-copy'
    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').classes()).toContain('picker-open')
    expect(wrapper.find('[data-testid="ai-codex-target-picker"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.createCodexSession).toHaveBeenCalled()

    const codexTerminal = mockXtermInstances.at(-1)!
    expect(codexTerminal.debugInfo?.().surface).toBe('codex')
    expect(codexTerminal.options.termName).toBe('xterm-256color')
    const codexTerminalFont = '"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace'
    await expect(
      store.updateTerminalSettings({
        terminalType: 'linux',
        fontFamily: codexTerminalFont,
        fontSize: 16
      })
    ).resolves.toBe(true)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(codexTerminal.options.termName).toBe('linux')
    expect(codexTerminal.options.fontFamily).toBe(codexTerminalFont)
    expect(codexTerminal.options.fontSize).toBe(16)
    codexTerminal.emitSelection('codex copied text')
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await wrapper.find('[data-testid="ai-codex-xterm"]').trigger('contextmenu')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('codex copied text')
    expect(store.topNotice).toBe('Codex 终端内容已复制')

    codexTerminal.emitSelection('codex shortcut text')
    vi.mocked(navigator.clipboard.writeText).mockClear()
    const copyKeyEvent = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    const allowTerminalInput = codexTerminal.emitKeyEvent(copyKeyEvent)
    await flushPromises()
    expect(allowTerminalInput).toBe(false)
    expect(copyKeyEvent.defaultPrevented).toBe(true)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('codex shortcut text')
    expect(window.aiops.writeCodexSession).not.toHaveBeenCalledWith(expect.any(String), 'codex shortcut text')

    await wrapper.find('[data-testid="ai-panel-mode-open"]').trigger('click')
    await wrapper.find('[data-testid="ai-mode-classic"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-panel-mode-open"]').text()).toContain('Classic Chat')
    expect(wrapper.find('[data-testid="ai-message-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-new-chat"]').exists()).toBe(true)
    expect(window.aiops.listChatConversations).toHaveBeenCalled()
    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalled()
    expect(window.aiops.listAiContextCatalog).toHaveBeenCalled()
    expect(window.aiops.listAiCommandCatalog).toHaveBeenCalled()
  })

  it('does not start Codex in the background when the persisted AI panel mode is Classic Chat', async () => {
    window.localStorage.setItem('aiopsterm.aiPanelMode', 'classic')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await enableCatalogModelOptions(store)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-panel-mode-open"]').text()).toContain('Classic Chat')
    expect(wrapper.find('[data-testid="ai-message-input"]').exists()).toBe(true)
    expect(window.aiops.createCodexSession).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="ai-panel-mode-open"]').trigger('click')
    await wrapper.find('[data-testid="ai-mode-codex"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.createCodexSession).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').text()).toContain('未绑定终端')
    expect(window.localStorage.getItem('aiopsterm.aiPanelMode')).toBe('codex')
  })

  it('binds Codex CLI to an explicit terminal target and does not follow active panel changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    const firstPanelId = store.activePanelId
    store.activePanel.sessionId = 'terminal-first'
    store.activePanel.cwd = '/root'
    store.registerSshSession(store.activePanelId, {
      id: 'asset-first',
      name: 'first-host',
      host: '10.0.0.10',
      port: 22,
      username: 'root'
    })
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.createCodexSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          sessionId: 'terminal-first',
          host: '10.0.0.10'
        })
      })
    )
    expect(window.aiops.writeCodexSession).not.toHaveBeenCalledWith('test-codex-session', expect.stringContaining('[aiopsterm target bound]'))
    expect(window.aiops.setCodexSessionPendingContext).not.toHaveBeenCalledWith('test-codex-session', expect.stringContaining('[aiopsterm target bound]'))

    vi.mocked(window.aiops.setCodexSessionTarget).mockClear()
    const second = store.createPanel()
    second.sessionId = 'terminal-second'
    second.cwd = '/srv/app'
    store.registerSshSession(second.id, {
      id: 'asset-second',
      name: 'second-host',
      host: '10.0.0.20',
      port: 2222,
      username: 'deploy'
    })
    store.activePanelId = second.id
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.setCodexSessionTarget).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').text()).toContain('first-host')

    await wrapper.find('[data-testid="ai-codex-target-locate"]').trigger('click')
    expect(store.activePanelId).toBe(firstPanelId)
  })

  it('keeps Codex target changes hidden and replaces pending target context before user input', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'terminal-first'
    store.activePanel.cwd = '/root'
    store.registerSshSession(store.activePanelId, {
      id: 'asset-first',
      name: 'first-host',
      host: '10.0.0.10',
      port: 22,
      username: 'root'
    })
    const firstPanel = store.activePanel
    const secondPanel = store.createPanel()
    secondPanel.sessionId = 'terminal-second'
    secondPanel.cwd = '/srv/app'
    store.registerSshSession(secondPanel.id, {
      id: 'asset-second',
      name: 'second-host',
      host: '10.0.0.20',
      port: 2222,
      username: 'deploy'
    })
    store.activePanelId = firstPanel.id

    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    vi.mocked(window.aiops.setCodexSessionPendingContext).mockClear()
    vi.mocked(window.aiops.writeCodexSession).mockClear()

    store.activePanelId = secondPanel.id
    await wrapper.find('[data-testid="ai-codex-target-change"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    store.activePanelId = firstPanel.id
    await wrapper.find('[data-testid="ai-codex-target-change"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.writeCodexSession).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining('[aiopsterm target changed]'))
    const pendingCalls = vi.mocked(window.aiops.setCodexSessionPendingContext).mock.calls
    expect(pendingCalls.length).toBe(2)
    expect(pendingCalls[0]?.[1]).toContain('Current target: second-host')
    expect(pendingCalls.at(-1)?.[1]).toBe('')
  })

  it('registers failed Codex sessions as global AI attention items and focuses them on jump', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'terminal-failed-codex'
    store.activePanel.cwd = '/srv/failure'
    vi.mocked(window.aiops.createCodexSession).mockRejectedValueOnce(new Error('codex boot failed'))
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: false },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(store.aiAttentionUnreadCount).toBe(1)
    expect(store.currentAiAttentionItem).toMatchObject({
      source: 'codex',
      kind: 'error',
      surfaceId: 'terminal-ai-panel',
      summary: 'codex boot failed'
    })

    store.mode = 'agents'
    store.rightPanelOpen = false
    const jumped = store.jumpToNextAiAttention()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(jumped?.id).toBe(store.currentAiAttentionItem?.id)
    expect(store.mode).toBe('terminal')
    expect(store.rightPanelOpen).toBe(true)
    expect(wrapper.find('[data-testid="ai-panel-mode-open"]').text()).toContain('Codex CLI')
    expect(store.topNotice).toContain('已定位到')

    wrapper.unmount()
  })

  it('opens multiple Codex conversation tabs from the Codex header', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'terminal-main'
    store.activePanel.cwd = '/root'
    store.registerSshSession(store.activePanelId, {
      id: 'asset-main',
      name: 'main-host',
      host: '10.0.0.30',
      port: 22,
      username: 'root'
    })
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-bind-current"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-codex-new"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="ai-codex-tab"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="ai-codex-tabs"]').exists()).toBe(true)
    expect(window.aiops.createCodexSession).toHaveBeenCalledTimes(2)
  })

  it('opens a new terminal when binding Codex CLI from the host picker', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.refreshAiContextCatalog({ hydrateSelection: false })
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-testid="ai-codex-bind-open"]').trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    const hostButtons = wrapper.findAll('[data-testid="ai-codex-bind-host"]')
    expect(hostButtons.length).toBeGreaterThan(1)
    await hostButtons[1].trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        assetId: expect.any(String)
      })
    )
    expect(window.aiops.createCodexSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'ssh',
          sessionId: expect.stringContaining('test-session-'),
          host: expect.any(String)
        })
      })
    )
    expect(wrapper.find('[data-testid="ai-codex-target-bar"]').text()).not.toContain('未绑定终端')
  })

  it('keeps the SSH keyboard-interactive dialog open on backdrop clicks and submits responses', async () => {
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
    await flushPromises()

    const request: TerminalKeyboardInteractiveRequest = {
      id: 'ssh-mfa-ui-1',
      connectionId: 'ssh-test-session',
      host: '203.0.113.10',
      port: 2222,
      username: 'root',
      title: 'dynamic-bastion',
      purpose: 'keyboard-interactive',
      name: 'Dynamic password',
      instructions: 'Enter OTP',
      prompts: [{ prompt: 'Verification code:', echo: false }],
      attempts: 1,
      maxAttempts: 1,
      timeoutMs: 180000
    }
    ;(globalThis as any).__emitTerminalKeyboardInteractiveRequestMock(request)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="terminal-mfa-dialog"]').exists()).toBe(true)
    const dialogText = wrapper.find('[data-testid="terminal-mfa-dialog"]').text()
    expect(dialogText).toContain('root@203.0.113.10:2222')
    expect(dialogText).toContain('Verification code:')
    expect(dialogText).not.toContain('第 1/1 次')
    expect(dialogText).not.toContain('剩余')
    expect(wrapper.find('[data-testid="terminal-password-remember"]').exists()).toBe(false)
    await wrapper.find('.terminal-mfa-backdrop').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-mfa-dialog"]').exists()).toBe(true)

    await wrapper.find('.terminal-mfa-dialog form').trigger('submit')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-mfa-error"]').text()).toContain('请输入认证信息')
    await wrapper.find('[data-testid="terminal-mfa-input"]').setValue('654321')
    await wrapper.find('.terminal-mfa-dialog form').trigger('submit')
    expect(window.aiops.respondTerminalKeyboardInteractive).toHaveBeenCalledWith('ssh-mfa-ui-1', ['654321'])

    ;(globalThis as any).__emitTerminalKeyboardInteractiveResultMock({ id: 'ssh-mfa-ui-1', status: 'success', attempts: 1 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-mfa-dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('uses the SSH auth dialog for missing saved passwords and can remember the typed password', async () => {
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
    await flushPromises()

    const request: TerminalKeyboardInteractiveRequest = {
      id: 'ssh-password-ui-1',
      connectionId: 'ssh-test-session',
      host: '10.71.0.11',
      port: 22,
      username: 'root',
      title: 'test_hhhh',
      purpose: 'password',
      assetId: 'asset-password-empty',
      canRememberPassword: true,
      prompts: [{ prompt: 'SSH password for root@10.71.0.11:22:', echo: false }],
      attempts: 1,
      maxAttempts: 1,
      timeoutMs: 180000
    }
    ;(globalThis as any).__emitTerminalKeyboardInteractiveRequestMock(request)
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-testid="terminal-mfa-dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('SSH 密码认证')
    expect(dialog.text()).toContain('勾选后会在连接成功时更新该主机密码')
    expect(dialog.text()).toContain('SSH password for root@10.71.0.11:22:')
    await wrapper.find('[data-testid="terminal-mfa-input"]').setValue('typed-password')
    await wrapper.find('[data-testid="terminal-password-remember"]').setValue(true)
    await wrapper.find('.terminal-mfa-dialog form').trigger('submit')
    expect(window.aiops.respondTerminalKeyboardInteractive).toHaveBeenCalledWith('ssh-password-ui-1', {
      responses: ['typed-password'],
      rememberPassword: true
    })

    ;(globalThis as any).__emitTerminalKeyboardInteractiveResultMock({ id: 'ssh-password-ui-1', status: 'success', attempts: 1, final: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="terminal-mfa-dialog"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the SSH password retry prompt when a saved password is rejected', async () => {
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
    await flushPromises()

    const request: TerminalKeyboardInteractiveRequest = {
      id: 'ssh-password-ui-retry-1',
      connectionId: 'ssh-test-session',
      host: '10.71.0.11',
      port: 22,
      username: 'root',
      title: 'test_hhhh',
      purpose: 'password',
      assetId: 'asset-password-retry',
      canRememberPassword: true,
      prompts: [{ prompt: 'SSH password for root@10.71.0.11:22:', echo: false }],
      attempts: 2,
      maxAttempts: 2,
      timeoutMs: 180000
    }
    ;(globalThis as any).__emitTerminalKeyboardInteractiveRequestMock(request)
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-testid="terminal-mfa-dialog"]')
    expect(dialog.text()).toContain('拒绝了已保存的密码')
    expect(dialog.text()).toContain('记住密码并更新该主机')
    await wrapper.find('[data-testid="terminal-mfa-input"]').setValue('new-password')
    await wrapper.find('.terminal-mfa-dialog form').trigger('submit')
    expect(window.aiops.respondTerminalKeyboardInteractive).toHaveBeenCalledWith('ssh-password-ui-retry-1', {
      responses: ['new-password'],
      rememberPassword: false
    })

    wrapper.unmount()
  })

  it('switches core shell and AI labels through the External reference locale set', async () => {
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
    store.setActiveModule('settings')
    await flushPromises()

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      language: 'en-US'
    })
    const languageSelect = wrapper.findAll('.settings-form-row').find((row) => row.find('label').text() === '语言')!.find('select.settings-select')
    await languageSelect.setValue('en-US')
    await flushPromises()

    expect(store.config.language).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
    expect(document.documentElement.dir).toBe('ltr')
    expect(wrapper.find('.settings-workspace-title h2').text()).toBe('Settings')
    expect(wrapper.find('.settings-side-panel').text()).toContain('General')
    expect(wrapper.find('.settings-side-panel').text()).toContain('AI Preferences')
    expect(wrapper.text()).toContain('Basic Settings')
    expect(wrapper.text()).toContain('Default Layout')

    store.setActiveModule('workspace')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await switchAiPanelToClassic(wrapper)
    expect(wrapper.find('.ai-header h2').text()).toBe('AI')
    expect(wrapper.find('[data-testid="ai-new-chat"]').attributes('title')).toBe('New chat')
    expect(wrapper.find('[data-onboarding-id="ai-input-editable"]').attributes('data-placeholder')).toBe('Describe your operations goal')
    expect(wrapper.text()).toContain('chat with AI')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      language: 'ar-AR'
    })
    store.setActiveModule('settings')
    await flushPromises()
    const translatedLanguageSelect = wrapper.findAll('.settings-form-row').find((row) => row.find('label').text() === 'Language')!.find('select.settings-select')
    await translatedLanguageSelect.setValue('ar-AR')
    await flushPromises()
    expect(document.documentElement.lang).toBe('ar-AR')
    expect(document.documentElement.dir).toBe('rtl')

    wrapper.unmount()
  })

  it('localizes managed AI session and terminal context controls', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.config = {
      ...store.config,
      language: 'en-US'
    }
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-i18n-approval',
      title: 'Deploy approval',
      summary: 'Approve deployment command',
      panelId: 'panel-i18n',
      terminalSessionId: 'terminal-i18n',
      cwd: '/srv/i18n',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 100
    })

    const sessions = mount(AiSessionsPanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(sessions.text()).toContain('AI Sessions')
    expect(sessions.find('input').attributes('placeholder')).toBe('Search sessions')
    expect(sessions.find('.ai-sessions-queue-bar').text()).toContain('1 current sessions')
    expect(sessions.find('.ai-sessions-queue-bar').text()).toContain('1 pending')
    expect(sessions.text()).toContain('Permission approval')

    const terminal = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    store.createPanel()
    const panel = store.panels.find((item) => item.id === store.activePanelId)!
    panel.id = 'panel-i18n'
    panel.title = 'Deploy shell'
    panel.cwd = '/srv/i18n'
    store.applyLocalTerminalSession(panel.id, {
      id: 'terminal-i18n',
      kind: 'local',
      shell: '/bin/bash',
      cwd: '/srv/i18n'
    })
    await terminal.vm.$nextTick()
    await terminal.vm.$nextTick()

    const contextBar = terminal.find('.terminal-context-bar')
    expect(contextBar.text()).toContain('Local')
    expect(contextBar.text()).toContain('AI Sessions')
    expect(contextBar.text()).toContain('Copy context')
    expect(contextBar.findAll('button').find((button) => button.text() === 'Refresh')?.attributes('title')).toBe('Refresh AI session status')

    sessions.unmount()
    terminal.unmount()
  })

  it('opens asset management as a full workspace instead of a narrow side panel', async () => {
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

    store.setActiveModule('assets')
    await flushPromises()

    expect(wrapper.find('.assets-workspace').exists()).toBe(true)
    expect(wrapper.find('.module-panel-pane').exists()).toBe(false)
    expect(wrapper.find('.ai-panel-pane').exists()).toBe(false)
    expect(wrapper.find('.asset-workspace-tabs').text()).toContain('主机管理')
    expect(wrapper.find('.asset-workspace-tabs').text()).toContain('密钥管理')
    expect(wrapper.find('.asset-workspace-tabs').text()).toContain('代理管理')
    expect(wrapper.find('.asset-workspace-tabs').text()).not.toContain('组织资产管理')
    expect(wrapper.find('[data-onboarding-id="host-management-entry"]').exists()).toBe(true)
    expect(wrapper.find('.host-card').text()).toContain('prod-bastion')

    await wrapper.findAll('.asset-workspace-tab').find((tab) => tab.text().includes('密钥管理'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.keychain-card').text()).toContain('prod-ed25519')

    wrapper.unmount()
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

  it('fails closed for malformed pending aiopsterm protocol links', async () => {
    vi.mocked(window.aiops.consumeDeepLinks).mockResolvedValueOnce({ target: 'settings' } as any)

    const pinia = createPinia()
    setActivePinia(pinia)
    mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    const store = useWorkspaceStore()
    await flushPromises()

    expect(store.activeModule).toBe('workspace')
    expect(store.activeSettingsSection).toBe('general')
    expect(store.topNotice).toContain('deep link')
  })

  it('applies only valid aiopsterm protocol links from pending batches and runtime events', async () => {
    const stopDeepLink = vi.fn()
    vi.mocked(window.aiops.consumeDeepLinks).mockResolvedValueOnce([
      {
        url: 'aiopsterm://open/settings?section=mcp',
        action: 'open',
        target: 'database',
        module: 'database',
        acceptedAt: 1780490000000
      } as any,
      {
        url: 'aiopsterm://open/files',
        action: 'open',
        target: 'files',
        module: 'files',
        acceptedAt: 1780490000100
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

    expect(store.activeModule).toBe('files')
    expect(store.topNotice).toContain('aiopsterm://')

    const listener = vi.mocked(window.aiops.onDeepLink).mock.calls.at(-1)?.[0]
    listener?.({
      url: 'aiopsterm://open/database',
      action: 'open',
      target: 'settings',
      module: 'settings',
      settingsSection: 'general',
      acceptedAt: 1780490000200
    } as any)
    expect(store.activeModule).toBe('files')
    expect(store.topNotice).toContain('deep link')

    listener?.({
      url: 'aiopsterm://open/database',
      action: 'open',
      target: 'database',
      module: 'database',
      acceptedAt: 1780490000300
    })
    expect(store.activeModule).toBe('database')

    wrapper.unmount()
    expect(stopDeepLink).toHaveBeenCalled()
  })

  it('fails closed when pending aiopsterm protocol consumption rejects', async () => {
    vi.mocked(window.aiops.consumeDeepLinks).mockRejectedValueOnce(new Error('ipc failed'))

    const pinia = createPinia()
    setActivePinia(pinia)
    mount(AppShell, {
      global: {
        plugins: [pinia],
        stubs: {
          teleport: true
        }
      }
    })
    const store = useWorkspaceStore()
    await flushPromises()

    expect(store.activeModule).toBe('workspace')
    expect(store.topNotice).toContain('deep link')
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
    expect(store.panels).toHaveLength(1)
    expect(store.activePanelId).toBe(store.panels[0].id)

    expect(store.rightPanelOpen).toBe(true)
    expect(dispatchShortcut('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(true)
    await flushPromises()
    expect(store.rightPanelOpen).toBe(false)

    store.startShortcutRecording('newTerminal')
    expect(dispatchShortcut('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' })).toBe(false)
    expect(store.panels).toHaveLength(1)
    store.cancelShortcutRecording()

    store.startShortcutRecording('newTerminal')
    store.updateShortcutRecording('Ctrl+Alt+N')
    expect(await store.saveShortcutRecording()).toBe(true)
    expect(dispatchShortcut('T', { ctrlKey: true, shiftKey: true, code: 'KeyT' })).toBe(false)
    expect(store.panels).toHaveLength(1)
    expect(dispatchShortcut('N', { ctrlKey: true, altKey: true, code: 'KeyN' })).toBe(true)
    expect(store.panels).toHaveLength(2)

    expect(dispatchShortcut('1', { altKey: true, code: 'Digit1' })).toBe(true)
    expect(store.activePanelId).toBe(store.panels[0].id)
    expect(dispatchShortcut('2', { altKey: true, code: 'Digit2' })).toBe(true)
    expect(store.activePanelId).toBe(store.panels[1].id)

    expect(dispatchShortcut('P', { ctrlKey: true, shiftKey: true, code: 'KeyP' })).toBe(true)
    expect(store.activeModule).toBe('snippets')
    expect(store.leftPanelOpen).toBe(true)

    wrapper.unmount()
  })

  it('persists External reference-style layout pane resizing and quick-close through backend config snapshots', async () => {
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
    vi.mocked(window.aiops.saveConfig).mockClear()

    const leftPane = () => wrapper.find('[data-layout-pane="terminal-left"]')
    const rightPane = () => wrapper.find('[data-layout-pane="terminal-right"]')
    const agentsPane = () => wrapper.find('[data-layout-pane="agents-left"]')
    const leftResizer = () => wrapper.find('[data-layout-resizer="terminal-left"]')
    const rightResizer = () => wrapper.find('[data-layout-resizer="terminal-right"]')
    const agentsResizer = () => wrapper.find('[data-layout-resizer="agents-left"]')
    const styles = appStyles()
    expect(styles).toContain('.layout-pane-right > .layout-resizer-right')
    expect(styles).toContain('left: -10px;')
    expect(styles).toContain('width: 14px;')

    expect(leftPane().attributes('style')).toContain('286px')
    await leftResizer().trigger('mousedown', { clientX: 286 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 336 }))
    await wrapper.vm.$nextTick()
    expect(leftPane().attributes('style')).toContain('336px')
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
    expect(window.aiops.saveConfig).toHaveBeenLastCalledWith({ leftPanelOpen: true, leftPanelWidth: 336 })
    expect(store.leftPanelWidth).toBe(336)

    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1200 })
    await rightResizer().trigger('mousedown', { clientX: 840 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1170 }))
    await flushPromises()
    expect(window.aiops.saveConfig).toHaveBeenLastCalledWith({ rightPanelOpen: false })
    expect(store.rightPanelOpen).toBe(false)
    expect(rightPane().exists()).toBe(false)

    await store.toggleMode()
    await flushPromises()
    expect(store.mode).toBe('agents')
    expect(agentsPane().attributes('style')).toContain('286px')
    await agentsResizer().trigger('mousedown', { clientX: 286 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 386 }))
    await wrapper.vm.$nextTick()
    expect(agentsPane().attributes('style')).toContain('386px')
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
    expect(window.aiops.saveConfig).toHaveBeenLastCalledWith({ agentsLeftOpen: true, agentsLeftWidth: 386 })
    expect(store.agentsLeftWidth).toBe(386)

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
    expect(wrapper.find('[data-testid="ai-attention-bell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-attention-count"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('本地版本')

    await wrapper.find('.mode-button').trigger('click')
    await flushPromises()
    expect(store.mode).toBe('agents')
    expect(wrapper.find('.right-ai-toggle').exists()).toBe(false)

    await wrapper.find('.layout-toggle').trigger('click')
    await flushPromises()
    expect(store.agentsLeftOpen).toBe(false)

    await wrapper.find('.mode-button').trigger('click')
    await flushPromises()
    expect(store.mode).toBe('terminal')
    await wrapper.find('.right-ai-toggle').trigger('click')
    await flushPromises()
    expect(store.rightPanelOpen).toBe(false)

    await wrapper.find('.window-control-button').trigger('click')
    expect(window.aiops.minimizeWindow).toHaveBeenCalled()
  })

  it('shows the AI attention badge and routes the bell click through the workspace store', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(TopBar, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.mode = 'agents'
    store.activeModule = 'database'
    store.rightPanelOpen = false

    store.upsertAiAttentionItem({
      id: 'codex:error:topbar',
      source: 'codex',
      kind: 'error',
      title: 'Codex CLI',
      summary: 'Codex crashed',
      conversationId: 'codex-topbar',
      surfaceId: 'terminal-ai-panel'
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-attention-count"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="ai-attention-bell"]').attributes('title')).toContain('Codex CLI')

    await wrapper.find('[data-testid="ai-attention-bell"]').trigger('click')
    await flushPromises()

    expect(store.mode).toBe('terminal')
    expect(store.activeModule).toBe('workspace')
    expect(store.rightPanelOpen).toBe(true)
    expect(store.aiAttentionFocusRequest).toMatchObject({
      sequence: 1,
      item: expect.objectContaining({ id: 'codex:error:topbar' })
    })
  })

  it('does not fabricate top layout changes when config persistence is unavailable or malformed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(TopBar, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    const originalSaveConfig = window.aiops.saveConfig
    await wrapper.vm.$nextTick()

    try {
      vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
        ...store.config,
        defaultMode: 'terminal'
      })
      await wrapper.find('.mode-button').trigger('click')
      await flushPromises()
      expect(store.mode).toBe('terminal')
      expect(store.topNotice).toBe('布局设置保存失败')

      vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
        ...store.config,
        defaultMode: 'agents'
      })
      await wrapper.find('.mode-button').trigger('click')
      await flushPromises()
      expect(store.mode).toBe('agents')

      ;(window.aiops as any).saveConfig = undefined
      await wrapper.find('.layout-toggle').trigger('click')
      await flushPromises()
      expect(store.agentsLeftOpen).toBe(true)
      expect(store.topNotice).toBe('布局设置保存服务不可用')

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        ...store.config,
        agentsLeftOpen: false
      })
      await wrapper.find('.layout-toggle').trigger('click')
      await flushPromises()
      expect(store.agentsLeftOpen).toBe(false)
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('follows External reference-style asset management navigation and filters knowledge documents', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: 'mysql' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()
    expect(assets.text()).toContain('主机管理')
    expect(assets.text()).toContain('堡垒机管理')
    expect(assets.text()).toContain('密钥管理')

    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await assets.find('.asset-search-input input').setValue('')
    expect(assets.text()).toContain('prod-bastion')
    expect(assets.findAll('.asset-tree-group-row').some((row) => row.text().includes('主机'))).toBe(false)

    await assets.find('.asset-host-tree').trigger('contextmenu', { clientX: 140, clientY: 180 })
    expect(assets.find('.asset-context-menu').text()).toContain('新建目录')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await assets.vm.$nextTick()
    expect(assets.find('.asset-context-menu').exists()).toBe(false)
    await assets.find('.asset-host-tree').trigger('contextmenu', { clientX: 140, clientY: 180 })
    await assets.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('新建目录'))!.trigger('click')
    await assets.find('.asset-folder-modal input').setValue('资产目录')
    await assets.find('.asset-folder-modal footer .primary').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAssetFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '资产目录', scope: 'direct' }))
    expect(assets.text()).toContain('资产目录')

    await assets.findAll('.asset-tree-group-row').find((button) => button.text().includes('生产'))!.trigger('contextmenu', { clientX: 160, clientY: 190 })
    expect(assets.find('.asset-context-menu').text()).toContain('新建子目录')
    await assets.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('新建子目录'))!.trigger('click')
    await assets.find('.asset-folder-modal input').setValue('资产子目录')
    await assets.find('.asset-folder-modal footer .primary').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAssetFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '资产子目录', scope: 'direct', parentUuid: expect.any(String) }))
    expect(assets.text()).toContain('资产子目录')

    await assets.find('.asset-search-input input').setValue('mysql')
    expect(assets.text()).toContain('mysql-primary')
    expect(assets.text()).not.toContain('prod-bastion')
    await assets.find('.asset-search-clear').trigger('click')
    expect((assets.find('.asset-search-input input').element as HTMLInputElement).value).toBe('')

    await openAssetTreeCreateHost(assets)
    expect(assets.text()).toContain('新建主机')
    expect(assets.text()).toContain('暂无 SSH 代理配置')
    expect(assets.text()).toContain('新增代理')
    expect(assets.find('[data-testid="asset-proxy-select"]').exists()).toBe(false)
    expect(assets.text()).not.toContain('prod-proxy')
    expect(assets.text()).not.toContain('office-proxy')
    let assetFormInputs = assets.findAll('.asset-form-panel input')
    await assetFormInputs.at(0)!.setValue('unit-host')
    await assetFormInputs.at(1)!.setValue('10.10.10.10')
    await assetFormInputs.at(2)!.setValue('ops')
    await assetFormInputs.at(4)!.setValue('测试')
    await assetFormInputs.at(5)!.setValue('2222')
    vi.mocked(window.aiops.testAssetConnection).mockClear()
    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-testid="asset-test-connection"]').trigger('click')
    await flushPromises()
    expect(window.aiops.testAssetConnection).toHaveBeenCalledWith({
      asset: expect.objectContaining({ host: '10.10.10.10', username: 'ops', port: 2222 })
    })
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()
    expect(assets.text()).toContain('连接成功 ops@10.10.10.10:2222')
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
    expect(store.activeModule).toBe('workspace')

    store.setActiveModule('assets')
    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('mouseenter')
    await assets.findAll('.asset-action-button.icon-only').find((button) => button.attributes('title') === '导入帮助')!.trigger('click')
    expect(assets.find('.asset-import-help-modal').text()).toContain('导入说明')
    expect(assets.find('.asset-import-help-modal').text()).toContain('预览')
    await assets.find('.asset-import-help-modal .asset-submit-button').trigger('click')

    store.selectedContexts = []
    store.setActiveModule('assets')
    const assetConnectedPanelId = store.activePanelId
    const assetConnectedPanelCount = store.panels.length
    vi.mocked(window.aiops.createTerminal).mockRejectedValueOnce(new Error('unit ssh refused'))
    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.trigger('dblclick')
    await flushPromises()
    expect(store.panels).toHaveLength(assetConnectedPanelCount)
    expect(store.activePanelId).toBe(assetConnectedPanelId)
    expect(store.activePanel.title).toBe('unit-host')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.10.10.10:2222')
    expect(store.activePanel.output).not.toContain('[aiopsterm] SSH launch failed')
    expect(store.selectedContexts.some((context) => context.id === 'asset-test-')).toBe(false)
    expect(store.selectedContexts.some((context) => context.label === '10.10.10.10')).toBe(false)
    expect(store.activeModule).toBe('assets')
    expect(assets.text()).toContain('unit ssh refused')

    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'terminal-malformed-asset-ssh',
      shell: 'ssh',
      cwd: '/home/ops',
      kind: 'ssh',
      connection: {
        connectionId: 'ssh-terminal-malformed-asset',
        host: '',
        port: 2222,
        username: 'ops',
        assetName: '',
        createdAt: 1717200006000
      }
    } as any)
    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.trigger('dblclick')
    await flushPromises()
    expect(store.panels).toHaveLength(assetConnectedPanelCount)
    expect(store.activePanelId).toBe(assetConnectedPanelId)
    expect(store.activePanel.title).toBe('unit-host')
    expect(store.activePanel.sessionId).not.toBe('terminal-malformed-asset-ssh')
    expect(store.selectedContexts.some((context) => context.label === '10.10.10.10')).toBe(false)
    expect(assets.text()).toContain('SSH 终端启动失败')

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

    const keys = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await keys.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
    expect(keys.text()).toContain('prod-ed25519')
    await keys.find('[data-testid="key-new-button"]').trigger('click')
    expect(keys.text()).toContain('新建密钥')
    await keys.find('.key-form-panel input').setValue('unit-key')
    await keySubmitButton(keys).trigger('click')
    expect(keys.text()).toContain('请输入私钥')
    await keys.find('.key-form-panel textarea').setValue('-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----')
    await keySubmitButton(keys).trigger('click')
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
    await keySubmitButton(keys).trigger('click')
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
      await keySubmitButton(keys).trigger('click')
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
      await keySubmitButton(keys).trigger('click')
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
      const wrapper = mountAssetsPanel({
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
      await keySubmitButton(saveMissing).trigger('click')
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

  it('fails closed on malformed successful Key Management result envelopes', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const originalAiops = {
      listKeychains: window.aiops.listKeychains,
      getKeychain: window.aiops.getKeychain,
      saveKeychain: window.aiops.saveKeychain,
      deleteKeychain: window.aiops.deleteKeychain
    }
    const mountKeysPanel = async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mountAssetsPanel({
        props: { query: '' },
        global: { plugins: [pinia] }
      })
      await flushPromises()
      await wrapper.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
      await flushPromises()
      return wrapper
    }
    const findKeyCard = (wrapper: ReturnType<typeof mount>, name: string) =>
      wrapper.findAll('.keychain-card').find((button) => button.text().includes(name))

    try {
      vi.mocked(window.aiops.listKeychains).mockResolvedValueOnce([{ id: 'broken-key-list' }] as any)
      const listMalformed = await mountKeysPanel()
      expect(listMalformed.text()).toContain(malformedMessage)
      expect(findKeyCard(listMalformed, 'broken-key-list')).toBeUndefined()
      expect(findKeyCard(listMalformed, 'prod-ed25519')).toBeUndefined()
      listMalformed.unmount()

      const detailMalformed = await mountKeysPanel()
      vi.mocked(window.aiops.getKeychain).mockResolvedValueOnce({ id: 'key-1', name: 'prod-ed25519' } as any)
      await findKeyCard(detailMalformed, 'prod-ed25519')!.find('button[title="编辑"]').trigger('click')
      await flushPromises()
      expect(detailMalformed.text()).toContain(malformedMessage)
      expect(detailMalformed.find('.key-form-panel').exists()).toBe(false)
      detailMalformed.unmount()

      const saveMalformed = await mountKeysPanel()
      await saveMalformed.find('[data-testid="key-new-button"]').trigger('click')
      await saveMalformed.find('.key-form-panel input').setValue('malformed-save-key')
      await saveMalformed.find('.key-form-panel textarea').setValue('-----BEGIN RSA PRIVATE KEY-----')
      vi.mocked(window.aiops.saveKeychain).mockResolvedValueOnce({ ok: true, data: { id: 'broken-save-key' } } as any)
      await keySubmitButton(saveMalformed).trigger('click')
      await flushPromises()
      expect(saveMalformed.text()).toContain(malformedMessage)
      expect(saveMalformed.find('.key-form-panel').exists()).toBe(true)
      expect(findKeyCard(saveMalformed, 'malformed-save-key')).toBeUndefined()
      saveMalformed.unmount()

      const deleteMalformed = await mountKeysPanel()
      await findKeyCard(deleteMalformed, 'prod-ed25519')!.find('button[title="删除"]').trigger('click')
      await deleteMalformed.find('.asset-confirm-modal input').setValue('prod-ed25519')
      vi.mocked(window.aiops.deleteKeychain).mockResolvedValueOnce({ ok: true, data: { id: 'different-key' } } as any)
      await deleteMalformed.find('.asset-confirm-modal footer .danger').trigger('click')
      await flushPromises()
      expect(deleteMalformed.text()).toContain(malformedMessage)
      expect(findKeyCard(deleteMalformed, 'prod-ed25519')).toBeTruthy()
      deleteMalformed.unmount()
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
    const keys = mountAssetsPanel({
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
    vi.mocked(window.aiops.exportAssets).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()

    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(assets.text()).toContain('代理管理')
    expect(assets.text()).not.toContain('组织资产管理')
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    expect(window.aiops.listAssetGroups).toHaveBeenCalledWith({ assetTypes: ['person', 'switch'] })

    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    await assets.findAll('.export-assets-modal .export-leaf-row').find((row) => row.text().includes('prod-bastion'))!.find('input').setValue(true)
    await assets.find('.export-assets-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(window.aiops.exportAssets).toHaveBeenCalledWith({ assetIds: ['asset-1'] })
    expect(window.aiops.showSaveDialog).not.toHaveBeenCalled()
    expect(window.aiops.writeLocalFile).not.toHaveBeenCalled()
    expect(assets.text()).toContain('已导出 1 个主机到 external-reference-assets-2024-06-01.json')
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
      vi.mocked(window.aiops.previewAssetImport).mockClear()
      vi.mocked(window.aiops.confirmAssetImport).mockClear()
      vi.mocked(window.aiops.saveAsset).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: ['openFile'],
          filters: expect.arrayContaining([expect.objectContaining({ name: 'Asset Import Files' })])
        })
      )
      expect(window.aiops.previewAssetImport).toHaveBeenCalledWith({ filePath: '/tmp/external-reference-assets.json' })
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').text()).toContain('其中 1 个与现有主机重复')
      expect(assets.find('.import-assets-modal').text()).toContain('imported-json')
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('跳过重复'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.confirmAssetImport).toHaveBeenCalledWith({ filePath: '/tmp/external-reference-assets.json', overwrite: false })
      expect(window.aiops.saveAsset).not.toHaveBeenCalled()
      expect(assets.text()).toContain('imported-json')
      expect(assets.findAll('.host-card').some((card) => card.text().includes('prod-bastion-imported'))).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.readLocalFile).mockClear()
      vi.mocked(window.aiops.previewAssetImport).mockClear()
      vi.mocked(window.aiops.confirmAssetImport).mockClear()
      vi.mocked(window.aiops.saveAsset).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/MobaXterm.mxtsessions'] })
      await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.previewAssetImport).toHaveBeenCalledWith({ filePath: '/tmp/MobaXterm.mxtsessions' })
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').text()).toContain('moba-prod')
      expect(assets.find('.import-assets-modal').text()).toContain('10.88.1.5')
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
      await flushPromises()
      expect(window.aiops.confirmAssetImport).toHaveBeenCalledWith({ filePath: '/tmp/MobaXterm.mxtsessions', overwrite: true })
      expect(window.aiops.saveAsset).not.toHaveBeenCalled()
      expect(assets.text()).toContain('moba-prod')
      expect(assets.text()).toContain('mobauser')
    } finally {
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })
    }

    const managed = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    useWorkspaceStore().openAssetManagement(undefined, 'assetManagement')
    await flushPromises()
    expect(managed.text()).toContain('全部组织资产')
    expect(managed.find('.asset-table-footer').text()).toContain('共 6 条')
    expect(managed.text()).not.toContain('127.0.0.1')
    expect(managed.findAll('.asset-management-tree-group-row').length).toBeGreaterThan(0)
    expect(managed.findAll('.asset-management-tree-group-row').some((row) => row.text().includes('jumpserver-org'))).toBe(true)
    expect(managed.findAll('.asset-management-tree-group-row').some((row) => row.text().includes('核心业务'))).toBe(true)
    const visibleAssetCheckboxes = () => managed.findAll('.asset-management-tree-asset-row input[type="checkbox"]')
    const groupToggle = managed.findAll('.asset-management-tree-toggle').find((button) => button.text().includes('jumpserver-org'))!
    await groupToggle.trigger('click')
    expect(managed.text()).not.toContain('prod-bastion')
    await groupToggle.trigger('click')
    expect(managed.text()).toContain('prod-bastion')
    await managed.find('.asset-table-scroll thead input[type="checkbox"]').setValue(true)
    expect(managed.findAll('.asset-management-tree-group-row input[type="checkbox"]')).toHaveLength(0)
    expect(visibleAssetCheckboxes().every((input) => (input.element as HTMLInputElement).checked)).toBe(true)
    await managed.find('.asset-table-scroll thead input[type="checkbox"]').setValue(false)
    vi.mocked(window.aiops.refreshOrganizationAssets).mockClear()
    await managed.find('.asset-table-toolbar button[title="刷新"]').trigger('click')
    await flushPromises()
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith(undefined)
    expect(managed.text()).toContain('jumpserver-org-synced-asset')
    await managed.find('.asset-table-toolbar .asset-search-input input').setValue('mysql')
    expect(managed.text()).toContain('mysql-primary')
    expect(managed.text()).not.toContain('prod-bastion')
    await managed.find('.asset-search-clear').trigger('click')
    await managed.findAll('.asset-table-toolbar .asset-action-button').find((button) => button.text().includes('新建目录'))!.trigger('click')
    await managed.find('.asset-folder-modal input').setValue('堡垒目录')
    await managed.find('.asset-folder-modal footer .primary').trigger('click')
    await flushPromises()
    expect(window.aiops.saveAssetFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '堡垒目录', scope: 'bastion' }))
    expect(managed.text()).toContain('堡垒目录')
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
    await flushPromises()
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

    const organization = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    useWorkspaceStore().openAssetManagement(undefined, 'assetConfig')
    await flushPromises()
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
    await flushPromises()
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

    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await openAssetTreeCreateHost(assets)
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

  it('loads saved host passwords for Assets edits and supports explicit reveal toggles', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')

    await openAssetTreeCreateHost(assets)
    const createSecretInput = assets.find('.asset-form-panel .asset-secret-field input')
    expect(createSecretInput.exists()).toBe(true)
    expect((createSecretInput.element as HTMLInputElement).value).toBe('')
    expect((createSecretInput.element as HTMLInputElement).type).toBe('password')
    await assets.find('.asset-form-panel .asset-secret-toggle').trigger('click')
    expect((assets.find('.asset-form-panel .asset-secret-field input').element as HTMLInputElement).type).toBe('text')
    await assets.find('.asset-form-panel header button[title="关闭"]').trigger('click')
    await flushPromises()

    vi.mocked(window.aiops.getAssetEditableSecret).mockClear()
    await assets.findAll('.host-card').find((card) => card.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    await assets.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await flushPromises()

    expect(window.aiops.getAssetEditableSecret).toHaveBeenCalledWith('asset-4')
    const editSecretInput = assets.find('.asset-form-panel .asset-secret-field input')
    expect((editSecretInput.element as HTMLInputElement).value).toBe('legacy-password')
    expect((editSecretInput.element as HTMLInputElement).type).toBe('password')
    await assets.find('.asset-form-panel .asset-secret-toggle').trigger('click')
    expect((assets.find('.asset-form-panel .asset-secret-field input').element as HTMLInputElement).type).toBe('text')
  })

  it('clears saved host passwords from Assets edits when the password field is emptied', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')

    await assets.findAll('.host-card').find((card) => card.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    await assets.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await flushPromises()

    const editSecretInput = assets.find('.asset-form-panel .asset-secret-field input')
    expect((editSecretInput.element as HTMLInputElement).value).toBe('legacy-password')
    await editSecretInput.setValue('')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()

    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ id: 'asset-4', password: '' }))
    await expect(window.aiops.getAssetEditableSecret('asset-4')).resolves.toEqual({ ok: true, data: { assetId: 'asset-4' } })
  })

  it('copies saved passwords when cloning hosts from Assets', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')

    vi.mocked(window.aiops.getAssetEditableSecret).mockClear()
    await assets.findAll('.host-card').find((card) => card.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    await assets.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('克隆'))!.trigger('click')
    await flushPromises()

    expect(window.aiops.getAssetEditableSecret).toHaveBeenCalledWith('asset-4')
    const clonedSecretInput = assets.find('.asset-form-panel .asset-secret-field input')
    expect((clonedSecretInput.element as HTMLInputElement).value).toBe('legacy-password')
    expect((assets.findAll('.asset-form-panel input').at(0)!.element as HTMLInputElement).value).toBe('legacy-node_Clone')

    vi.mocked(window.aiops.saveAsset).mockClear()
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        title: 'legacy-node_Clone',
        password: 'legacy-password'
      })
    )
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
  })

  it('routes Database connection drafts through backend-confirmed SSH proxy configs', async () => {
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

    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('PostgreSQL'))!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.db-connection-modal').text()).toContain('SSH Proxy')
    const modalInputs = wrapper.findAll('.db-connection-modal input')
    await modalInputs.at(0)!.setValue('proxy-postgres')
    await modalInputs.at(1)!.setValue('10.20.0.10')
    const proxyCheckbox = modalInputs.find((input) => (input.element as HTMLInputElement).type === 'checkbox' && !(input.element as HTMLInputElement).disabled)!
    await proxyCheckbox.setValue(true)
    await flushPromises()

    const proxySelect = wrapper.findAll('.db-connection-modal select').find((select) => select.text().includes('release-proxy'))!
    expect(proxySelect.text()).toContain('release-proxy')
    expect(proxySelect.text()).toContain('SOCKS5 10.0.0.8:1080')
    await proxySelect.setValue('release-proxy')

    vi.mocked(window.aiops.testDatabaseConnection).mockClear()
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(window.aiops.testDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        dbType: 'postgresql',
        name: 'proxy-postgres',
        host: '10.20.0.10',
        needProxy: true,
        proxyName: 'release-proxy'
      })
    )

    vi.mocked(window.aiops.saveDatabaseConnection).mockClear()
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'create',
        connection: expect.objectContaining({
          dbType: 'postgresql',
          name: 'proxy-postgres',
          needProxy: true,
          proxyName: 'release-proxy'
        })
      })
    )
    expect(wrapper.text()).toContain('proxy-postgres')

    wrapper.unmount()
  })

  it('opens Terminal proxy settings when the asset form has no SSH proxy configs', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const store = useWorkspaceStore()

    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await openAssetTreeCreateHost(assets)
    await assets.find('.asset-proxy-empty button').trigger('click')

    expect(assets.find('.asset-proxy-form-modal').exists()).toBe(true)
    expect(assets.text()).toContain('新增代理')
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
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('本地连接')
    expect(wrapper.findAll('.workspace-host-row').some((row) => row.text().includes('127.0.0.1'))).toBe(false)
  })

  it('loads saved host passwords for Workspace edits and keeps them auditable before save', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.find('.workspace-search input').setValue('legacy-node')
    await flushPromises()

    vi.mocked(window.aiops.getAssetEditableSecret).mockClear()
    await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 260,
      clientY: 180
    })
    await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await flushPromises()

    expect(window.aiops.getAssetEditableSecret).toHaveBeenCalledWith('asset-4')
    const secretInput = wrapper.find('.workspace-host-form .asset-secret-field input')
    expect((secretInput.element as HTMLInputElement).value).toBe('legacy-password')
    expect((secretInput.element as HTMLInputElement).type).toBe('password')
    await wrapper.find('.workspace-host-form .asset-secret-toggle').trigger('click')
    expect((wrapper.find('.workspace-host-form .asset-secret-field input').element as HTMLInputElement).type).toBe('text')

    vi.mocked(window.aiops.saveAsset).mockClear()
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ id: 'asset-4', password: 'legacy-password' }))
  })

  it('clears saved host passwords from Workspace edits when the password field is emptied', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.find('.workspace-search input').setValue('legacy-node')
    await flushPromises()

    await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 260,
      clientY: 180
    })
    await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    await flushPromises()

    const secretInput = wrapper.find('.workspace-host-form .asset-secret-field input')
    expect((secretInput.element as HTMLInputElement).value).toBe('legacy-password')
    await secretInput.setValue('')
    vi.mocked(window.aiops.saveAsset).mockClear()
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ id: 'asset-4', password: '' }))
    await expect(window.aiops.getAssetEditableSecret('asset-4')).resolves.toEqual({ ok: true, data: { assetId: 'asset-4' } })
  })

  it('copies saved passwords when cloning hosts from Workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.find('.workspace-search input').setValue('legacy-node')
    await flushPromises()

    vi.mocked(window.aiops.getAssetEditableSecret).mockClear()
    await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('legacy-node'))!.trigger('contextmenu', {
      clientX: 260,
      clientY: 180
    })
    await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('克隆'))!.trigger('click')
    await flushPromises()

    expect(window.aiops.getAssetEditableSecret).toHaveBeenCalledWith('asset-4')
    const clonedSecretInput = wrapper.find('.workspace-host-form .asset-secret-field input')
    expect((clonedSecretInput.element as HTMLInputElement).value).toBe('legacy-password')
    expect((wrapper.findAll('.workspace-host-form input').at(0)!.element as HTMLInputElement).value).toBe('legacy-node_Clone')

    vi.mocked(window.aiops.saveAsset).mockClear()
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        title: 'legacy-node_Clone',
        password: 'legacy-password'
      })
    )
    expect(vi.mocked(window.aiops.saveAsset).mock.calls.at(-1)?.[0]).not.toHaveProperty('id')
  })

  it('does not fabricate Assets export success when the backend export bridge is unavailable, fails, or is canceled', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    await assets.findAll('.export-assets-modal .export-leaf-row').find((row) => row.text().includes('prod-bastion'))!.find('input').setValue(true)

    const originalAiops = {
      exportAssets: window.aiops.exportAssets
    }
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()

    try {
      ;(window.aiops as any).exportAssets = undefined
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('资产导出服务不可用')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)
      expect(window.aiops.showSaveDialog).not.toHaveBeenCalled()
      expect(window.aiops.writeLocalFile).not.toHaveBeenCalled()

      ;(window.aiops as any).exportAssets = originalAiops.exportAssets
      vi.mocked(window.aiops.exportAssets!).mockRejectedValueOnce(new Error('asset export bridge failed'))
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导出文件失败')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)

      vi.mocked(window.aiops.exportAssets!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'ASSET_EXPORT_FAILED',
        errorMessage: 'backend disk full'
      })
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('backend disk full')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)

      vi.mocked(window.aiops.exportAssets!).mockResolvedValueOnce({
        ok: true,
        data: {
          exported: 0,
          fileName: 'external-reference-assets-2024-06-01.json',
          canceled: true
        }
      })
      await assets.find('.export-assets-modal footer button:last-child').trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('已取消导出')
      expect(assets.find('.export-assets-modal').exists()).toBe(true)
      expect(assets.text()).not.toContain('已导出 1 个主机')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Assets import preview or confirmation when import bridges fail', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
    const importButton = () => assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!
    const originalAiops = {
      showOpenDialog: window.aiops.showOpenDialog,
      readLocalFile: window.aiops.readLocalFile,
      previewAssetImport: window.aiops.previewAssetImport,
      confirmAssetImport: window.aiops.confirmAssetImport,
      listAssetGroups: window.aiops.listAssetGroups,
      saveAsset: window.aiops.saveAsset
    }

    try {
      vi.mocked(window.aiops.readLocalFile).mockClear()
      vi.mocked(window.aiops.previewAssetImport).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导入文件选择服务不可用。')
      expect(window.aiops.previewAssetImport).not.toHaveBeenCalled()
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      ;(window.aiops as any).previewAssetImport = undefined
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('导入文件预览服务不可用。')
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      ;(window.aiops as any).previewAssetImport = originalAiops.previewAssetImport
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      vi.mocked(window.aiops.previewAssetImport).mockRejectedValueOnce(new Error('asset preview denied'))
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('asset preview denied')
      expect(window.aiops.readLocalFile).not.toHaveBeenCalled()
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
      vi.mocked(window.aiops.previewAssetImport).mockResolvedValueOnce({
        ok: false,
        errorCode: 'ASSET_IMPORT_PARSE_FAILED',
        errorMessage: 'asset parse denied'
      })
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('asset parse denied')
      expect(assets.find('.import-assets-modal').exists()).toBe(false)

      vi.mocked(window.aiops.saveAsset).mockClear()
      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/MobaXterm.mxtsessions'] })
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.find('.import-assets-modal').exists()).toBe(true)

      ;(window.aiops as any).confirmAssetImport = undefined
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('资产导入确认服务不可用。')
      expect(assets.find('.import-assets-modal').exists()).toBe(true)
      expect(window.aiops.saveAsset).not.toHaveBeenCalled()

      ;(window.aiops as any).confirmAssetImport = originalAiops.confirmAssetImport
      vi.mocked(window.aiops.confirmAssetImport).mockResolvedValueOnce({
        ok: false,
        errorCode: 'ASSET_IMPORT_FAILED',
        errorMessage: 'asset confirm denied'
      })
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
      await flushPromises()
      expect(assets.text()).toContain('asset confirm denied')
      expect(assets.find('.import-assets-modal').exists()).toBe(true)
      expect(window.aiops.saveAsset).not.toHaveBeenCalled()

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/MobaXterm.mxtsessions'] })
      await importButton().trigger('click')
      await flushPromises()
      expect(assets.find('.import-assets-modal').exists()).toBe(true)
      vi.mocked(window.aiops.listAssetGroups).mockResolvedValueOnce([{ key: 'broken-group', name: '生产' }] as any)
      await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
      await flushPromises()
      expect(assets.text()).toContain(malformedMessage)
      expect(assets.find('.import-assets-modal').exists()).toBe(true)
      expect(assets.findAll('.host-card').some((card) => card.text().includes('moba-prod'))).toBe(false)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('fails closed on malformed successful Assets asset result envelopes', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const pinia = createPinia()
    setActivePinia(pinia)
    const assets = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')

    await openAssetTreeCreateHost(assets)
    const assetFormInputs = () => assets.findAll('.asset-form-panel input')
    await assetFormInputs().at(0)!.setValue('malformed-save-host')
    await assetFormInputs().at(1)!.setValue('10.77.77.77')
    await assetFormInputs().at(2)!.setValue('ops')
    await assetFormInputs().at(4)!.setValue('测试')
    await assetFormInputs().at(5)!.setValue('2222')

    vi.mocked(window.aiops.saveAsset).mockClear()
    vi.mocked(window.aiops.testAssetConnection).mockResolvedValueOnce({ ok: true, data: { endpoint: 'ops@10.77.77.77:2222' } } as any)
    await assets.find('[data-testid="asset-test-connection"]').trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.find('.asset-connection-test-result').classes()).not.toContain('success')
    expect(assets.text()).not.toContain('连接成功 ops@10.77.77.77:2222')
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()

    vi.mocked(window.aiops.saveAsset).mockResolvedValueOnce({ ok: true, data: { id: 'asset-malformed' } } as any)
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.findAll('.host-card').some((card) => card.text().includes('malformed-save-host'))).toBe(false)

    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导出'))!.trigger('click')
    await assets.findAll('.export-assets-modal .export-leaf-row').find((row) => row.text().includes('prod-bastion'))!.find('input').setValue(true)
    vi.mocked(window.aiops.exportAssets).mockResolvedValueOnce({ ok: true, data: { fileName: 'broken-export.json' } } as any)
    await assets.find('.export-assets-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.find('.export-assets-modal').exists()).toBe(true)
    expect(assets.text()).not.toContain('已导出')

    vi.mocked(window.aiops.exportAssets).mockResolvedValueOnce({
      ok: true,
      data: {
        exported: 1,
        fileName: 'external-reference-assets-2024-06-01.json',
        filePath: '/tmp/assets-export.json'
      }
    } as any)
    await assets.find('.export-assets-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.find('.export-assets-modal').exists()).toBe(true)
    expect(assets.text()).not.toContain('已导出 1 个主机')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/external-reference-assets.json'] })
    vi.mocked(window.aiops.previewAssetImport).mockResolvedValueOnce({
      ok: true,
      data: { filePath: '/tmp/external-reference-assets.json', fileName: 'external-reference-assets.json', assets: [{ previewId: 'missing-host' }], duplicateCount: 0 }
    } as any)
    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.find('.import-assets-modal').exists()).toBe(false)

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/MobaXterm.mxtsessions'] })
    await assets.findAll('.asset-action-button').find((button) => button.text().includes('导入'))!.trigger('click')
    await flushPromises()
    expect(assets.find('.import-assets-modal').exists()).toBe(true)
    vi.mocked(window.aiops.confirmAssetImport).mockResolvedValueOnce({
      ok: true,
      data: { assets: [{ id: 'broken-import' }], folders: [], imported: 1, skipped: 0, created: 1, updated: 0, filePath: '/tmp/MobaXterm.mxtsessions', fileName: 'MobaXterm.mxtsessions' }
    } as any)
    await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('确认导入'))!.trigger('click')
    await flushPromises()
    expect(assets.text()).toContain(malformedMessage)
    expect(assets.find('.import-assets-modal').exists()).toBe(true)
    expect(assets.text()).not.toContain('broken-import')

    const managed = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    useWorkspaceStore().openAssetManagement(undefined, 'assetManagement')
    await flushPromises()
    await managed.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('prod-bastion'))!.find('input[type="checkbox"]').setValue(true)
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: { assets: [{ id: 'malformed-refresh' }], folders: [], refreshed: 1, created: 1, updated: 0 }
    } as any)
    await managed.find('.asset-table-toolbar button[title="刷新"]').trigger('click')
    await flushPromises()
    expect(managed.text()).toContain(malformedMessage)
    expect(managed.text()).toContain('prod-bastion')
    expect(managed.text()).not.toContain('malformed-refresh')
    expect((managed.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('prod-bastion'))!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)

    const organization = mountAssetsPanel({
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    useWorkspaceStore().openAssetManagement(undefined, 'assetConfig')
    await flushPromises()
    await organization.findAll('.host-card').find((button) => button.text().includes('jumpserver-org'))!.trigger('contextmenu')
    const wrongOrganizationAssets = await window.aiops.listAssets()
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: {
        ...wrongOrganizationAssets,
        organizationId: 'other-org',
        refreshed: 1,
        created: 1,
        updated: 0
      }
    } as any)
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('刷新资产'))!.trigger('click')
    await flushPromises()
    expect(organization.text()).toContain(malformedMessage)
    expect(organization.text()).not.toContain('已刷新堡垒机资源 jumpserver-org')
    expect(organization.text()).not.toContain('jumpserver-org-synced-asset')

    await organization.findAll('.host-card').find((button) => button.text().includes('jumpserver-org'))!.trigger('contextmenu')
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: await buildNonJumpserverOrganizationRefreshData()
    } as any)
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('刷新资产'))!.trigger('click')
    await flushPromises()
    expect(organization.text()).toContain(malformedMessage)
    expect(organization.text()).toContain('jumpserver-org')
    expect(organization.text()).not.toContain('not-jumpserver-org')
    expect(organization.text()).not.toContain('jumpserver-org-synced-asset')
  })

  it('fails closed when Assets host management cannot trust asset groups or mutation refreshes', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const originalAiops = {
      listAssets: window.aiops.listAssets,
      listAssetGroups: window.aiops.listAssetGroups,
      saveAsset: window.aiops.saveAsset,
      deleteAsset: window.aiops.deleteAsset
    }
    const mountHostManagement = async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mountAssetsPanel({
        props: { query: '' },
        global: { plugins: [pinia] }
      })
      await flushPromises()
      await wrapper.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')
      await flushPromises()
      return wrapper
    }
    const fillNewHostForm = async (wrapper: ReturnType<typeof mount>, name: string) => {
      await openAssetTreeCreateHost(wrapper)
      const inputs = () => wrapper.findAll('.asset-form-panel input')
      await inputs().at(0)!.setValue(name)
      await inputs().at(1)!.setValue('10.88.77.66')
      await inputs().at(2)!.setValue('ops')
      await inputs().at(4)!.setValue('测试')
      await inputs().at(5)!.setValue('2222')
    }

    try {
      ;(window.aiops as any).listAssetGroups = undefined
      const missingGroups = await mountHostManagement()
      expect(missingGroups.text()).toContain('资产分组服务不可用')
      expect(missingGroups.findAll('.host-card').some((card) => card.text().includes('prod-bastion'))).toBe(false)
      missingGroups.unmount()

      ;(window.aiops as any).listAssetGroups = vi.fn(async () => [{ key: 'broken-group', name: '生产' }] as any)
      const malformedGroups = await mountHostManagement()
      expect(malformedGroups.text()).toContain(malformedMessage)
      expect(malformedGroups.findAll('.host-card').some((card) => card.text().includes('prod-bastion'))).toBe(false)
      malformedGroups.unmount()

      ;(window.aiops as any).listAssetGroups = originalAiops.listAssetGroups
      const saveRefreshMissing = await mountHostManagement()
      await fillNewHostForm(saveRefreshMissing, 'snapshot-missing-host')
      vi.mocked(window.aiops.saveAsset).mockImplementationOnce(async (input: any) => {
        const savedResult = await originalAiops.saveAsset(input)
        vi.mocked(window.aiops.listAssets).mockResolvedValueOnce({
          assets: (await originalAiops.listAssets()).assets.filter((asset) => asset.id !== savedResult.data?.id),
          folders: (await originalAiops.listAssets()).folders
        })
        return savedResult
      })
      await saveRefreshMissing.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
      await flushPromises()
      expect(saveRefreshMissing.text()).toContain(malformedMessage)
      expect(saveRefreshMissing.find('.asset-form-panel').exists()).toBe(true)
      expect(saveRefreshMissing.findAll('.host-card').some((card) => card.text().includes('snapshot-missing-host'))).toBe(false)
      saveRefreshMissing.unmount()

      const wrongDelete = await mountHostManagement()
      const prodCard = wrongDelete.findAll('.host-card').find((card) => card.text().includes('prod-bastion'))!
      await prodCard.find('button[title="删除"]').trigger('click')
      await wrongDelete.find('.asset-confirm-modal input').setValue('prod-bastion')
      vi.mocked(window.aiops.deleteAsset).mockResolvedValueOnce({ ok: true, data: { id: 'different-asset' } } as any)
      await wrongDelete.find('.asset-confirm-modal footer .danger').trigger('click')
      await flushPromises()
      expect(wrongDelete.text()).toContain(malformedMessage)
      expect(wrongDelete.findAll('.host-card').some((card) => card.text().includes('prod-bastion'))).toBe(true)
      wrongDelete.unmount()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Workspace host favorite, comment, or tunnel state before asset writes succeed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const wrapper = mountWorkspacePanel({
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
    expect(window.aiops.startSshTunnel).not.toHaveBeenCalled()
    expect(wrapper.find('.workspace-tunnel-modal').exists()).toBe(true)
    expect(wrapper.find('.workspace-tunnel-modal').text()).toContain('访问远端服务')
    await wrapper.find('[data-testid="workspace-tunnel-local-port"]').setValue('15432')
    await wrapper.find('[data-testid="workspace-tunnel-remote-host"]').setValue('127.0.0.1')
    await wrapper.find('[data-testid="workspace-tunnel-remote-port"]').setValue('5432')
    await wrapper.find('.workspace-tunnel-form').trigger('submit')
    await flushPromises()
    expect(window.aiops.startSshTunnel).toHaveBeenCalledWith({
      assetId: 'asset-2',
      type: 'local_forward',
      localPort: 15432,
      remoteHost: '127.0.0.1',
      remotePort: 5432
    })
    expect(wrapper.text()).toContain('隧道已连接 staging-api')
    expect(wrapper.find('.workspace-tunnel-modal').exists()).toBe(false)
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

  it('starts Workspace SSH tunnels with External reference-style typed parameters from the modal', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
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

    vi.mocked(window.aiops.startSshTunnel).mockClear()
    await hostRow('prod-bastion').trigger('contextmenu')
    await contextButton('隧道').trigger('click')
    await flushPromises()
    expect(window.aiops.startSshTunnel).not.toHaveBeenCalled()
    expect(wrapper.find('.workspace-tunnel-modal').text()).toContain('动态 SOCKS')

    await wrapper.find('[data-testid="workspace-tunnel-local-port"]').setValue('0')
    await wrapper.find('.workspace-tunnel-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('本地监听端口必须是 1-65535 的整数')
    expect(window.aiops.startSshTunnel).not.toHaveBeenCalled()
    expect(hostRow('prod-bastion').find('.tunnel-icon').exists()).toBe(false)

    const socksOption = wrapper.findAll('.workspace-tunnel-type-card').find((option) => option.text().includes('动态 SOCKS'))
    if (!socksOption) throw new Error('SOCKS tunnel option not found')
    await socksOption.find('input').setValue(true)
    await flushPromises()
    expect((wrapper.find('[data-testid="workspace-tunnel-local-port"]').element as HTMLInputElement).value).toBe('1080')
    expect(wrapper.find('[data-testid="workspace-tunnel-remote-port"]').exists()).toBe(false)
    await wrapper.find('[data-testid="workspace-tunnel-local-port"]').setValue('11080')
    await wrapper.find('.workspace-tunnel-form').trigger('submit')
    await flushPromises()

    expect(window.aiops.startSshTunnel).toHaveBeenCalledWith({
      assetId: 'asset-1',
      type: 'dynamic_socks',
      localPort: 11080
    })
    expect(wrapper.text()).toContain('隧道已连接 prod-bastion')
    expect(hostRow('prod-bastion').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')
  })

  it('supports Workspace tree context creation, drag moves, linked SSH options, and recent connections', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    store.updateSshProxyForm({
      name: 'release-proxy',
      type: 'SOCKS5',
      host: '10.0.0.8',
      port: 1080,
      username: '',
      password: '',
      enableProxyIdentity: false
    })
    await store.saveSshProxyForm()
    const wrapper = mountWorkspacePanel({
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()

    const groupRow = (name: string) => {
      const row = wrapper.findAll('.workspace-folder-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace group row not found: ${name}`)
      return row
    }
    const hostRow = (name: string) => {
      const row = wrapper.findAll('.workspace-host-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace host row not found: ${name}`)
      return row
    }
    const menuButton = (label: string) => findMenuButton(wrapper, '.workspace-node-menu', label)

    expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('主机'))).toBe(false)
    expect(groupRow('生产').text()).toContain('(2)')

    await groupRow('生产').trigger('contextmenu', { clientX: 180, clientY: 160 })
    await menuButton('新建子分组').trigger('click')
    await wrapper.find('.workspace-folder-modal input').setValue('生产子组')
    await wrapper.find('.workspace-folder-modal form').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveAssetFolder).toHaveBeenCalledWith(expect.objectContaining({ name: '生产子组', scope: 'direct' }))
    expect(wrapper.text()).toContain('生产子组')

    await groupRow('生产子组').trigger('contextmenu', { clientX: 190, clientY: 180 })
    await menuButton('新建主机').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-host-modal').exists()).toBe(true)
    await wrapper.find('.files-folder-modal-backdrop').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.workspace-host-modal').exists()).toBe(true)
    expect((wrapper.findAll('.workspace-host-form input').at(2)!.element as HTMLInputElement).value).toBe('root')
    expect(wrapper.find('.workspace-host-form').text()).not.toContain('分组')
    await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('jump-source-host')
    await wrapper.findAll('.workspace-host-form input').at(1)!.setValue('10.55.0.8')
    await wrapper.findAll('.workspace-field-heading button').find((button) => button.text().includes('新建跳板机'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-jump-child-modal').exists()).toBe(true)
    expect((wrapper.findAll('.workspace-jump-child-modal input').find((input) => input.element instanceof HTMLInputElement && (input.element as HTMLInputElement).value === '生产子组')?.element as HTMLInputElement | undefined)?.value).toBe('生产子组')
    await wrapper.find('.workspace-jump-child-modal header button').trigger('click')
    await flushPromises()

    await wrapper.findAll('.workspace-host-form select').at(1)!.setValue('keyBased')
    await flushPromises()
    await wrapper.findAll('.workspace-field-heading button').find((button) => button.text().includes('新建密钥'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.workspace-key-child-modal .key-drop-area').exists()).toBe(true)
    vi.mocked(window.aiops.readLocalFile).mockClear()
    const droppedWorkspaceKey = new File(['key'], 'workspace.key') as File & { path?: string }
    Object.defineProperty(droppedWorkspaceKey, 'path', { configurable: true, value: '/tmp/workspace.key' })
    vi.mocked(window.aiops.readLocalFile).mockResolvedValueOnce({
      content: '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n-----END OPENSSH PRIVATE KEY-----',
      mtimeMs: Date.now(),
      size: 72
    })
    await wrapper.find('.workspace-key-child-modal .key-drop-area').trigger('drop', {
      dataTransfer: {
        files: [droppedWorkspaceKey]
      }
    })
    await flushPromises()
    expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/workspace.key')
    expect((wrapper.find('.workspace-key-child-modal textarea').element as HTMLTextAreaElement).value).toContain('OPENSSH PRIVATE KEY')
    await wrapper.find('.workspace-key-child-modal header button').trigger('click')
    await flushPromises()

    await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('tree-linked-host')
    await wrapper.findAll('.workspace-host-form input').at(1)!.setValue('10.55.0.9')
    await wrapper.find('.workspace-host-form select').setValue('person')
    await wrapper.findAll('.workspace-host-form select').at(1)!.setValue('keyBased')
    await flushPromises()
    await wrapper.findAll('.workspace-host-form input').at(3)!.setValue('22')
    await wrapper.findAll('.workspace-host-form select').at(2)!.setValue('key-1')
    await wrapper.findAll('.workspace-host-form select').at(3)!.setValue('release-proxy')
    await wrapper.findAll('.workspace-host-form select').at(4)!.setValue('asset-2')
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'tree-linked-host',
        username: 'root',
        port: 22,
        group: '生产子组',
        auth_type: 'keyBased',
        keychainId: 'key-1',
        needProxy: true,
        proxyName: 'release-proxy',
        jumpHostId: 'asset-2'
      })
    )
    expect(wrapper.text()).toContain('tree-linked-host')

    await wrapper.find('.workspace-tree').trigger('contextmenu', { clientX: 240, clientY: 280 })
    expect(wrapper.find('.workspace-node-menu').text()).toContain('新建顶级分组')
    await document.body.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.workspace-node-menu').exists()).toBe(false)

    const transfer = createTestDataTransfer()
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dragStart, 'dataTransfer', { configurable: true, value: transfer })
    hostRow('tree-linked-host').element.dispatchEvent(dragStart)
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', { configurable: true, value: transfer })
    groupRow('预发').element.dispatchEvent(drop)
    await flushPromises()
    expect(window.aiops.saveAsset).toHaveBeenCalledWith(expect.objectContaining({ name: 'tree-linked-host', group: '预发', group_name: '预发' }))

    await wrapper.find('.workspace-tree').trigger('contextmenu', { clientX: 260, clientY: 300 })
    await menuButton('新建主机').trigger('click')
    await flushPromises()
    await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('root-default-host')
    await wrapper.findAll('.workspace-host-form input').at(1)!.setValue('10.66.0.9')
    await wrapper.findAll('.workspace-host-form input').at(2)!.setValue('ops')
    await wrapper.findAll('.workspace-host-form input').at(4)!.setValue('22')
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveAsset).toHaveBeenCalledWith(expect.objectContaining({ name: 'root-default-host', group: '未分组', group_name: '未分组' }))
    expect(wrapper.text()).toContain('root-default-host')

    vi.mocked(window.aiops.createTerminal).mockClear()
    await hostRow('tree-linked-host').trigger('dblclick')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', title: 'tree-linked-host' }))
    expect(store.workspacePreferences.recentAssetIds?.[0]).toMatch(/^asset-test-/)

    await wrapper.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
    await flushPromises()
    vi.mocked(window.aiops.createTerminal).mockClear()
    await hostRow('jumpserver-org').trigger('dblclick')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', assetId: 'asset-5', title: 'jumpserver-org' }))

    wrapper.unmount()
  })

  it('fails closed on malformed successful Workspace asset result envelopes', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()

    const hostRow = (name: string) => {
      const row = wrapper.findAll('.workspace-host-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace host row not found: ${name}`)
      return row
    }
    const groupRow = (name: string) => {
      const row = wrapper.findAll('.workspace-folder-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace group row not found: ${name}`)
      return row
    }
    const menuButton = (label: string) => {
      const button = wrapper.find('.workspace-node-menu').findAll('button').find((item) => item.text().includes(label))
      if (!button) throw new Error(`Workspace menu button not found: ${label}`)
      return button
    }

    await wrapper.find('.workspace-tree').trigger('contextmenu', { clientX: 220, clientY: 260 })
    await menuButton('新建主机').trigger('click')
    const hostFormInputs = () => wrapper.findAll('.workspace-host-form input')
    await hostFormInputs().at(0)!.setValue('workspace-malformed-host')
    await hostFormInputs().at(1)!.setValue('10.66.0.8')
    await hostFormInputs().at(2)!.setValue('ops')
    await hostFormInputs().at(4)!.setValue('2208')
    await wrapper.find('.workspace-host-form textarea').setValue('malformed host draft')

    vi.mocked(window.aiops.saveAsset).mockClear()
    vi.mocked(window.aiops.testAssetConnection).mockResolvedValueOnce({ ok: true, data: { endpoint: 'ops@10.66.0.8:2208' } } as any)
    await wrapper.find('[data-testid="workspace-host-test-connection"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.find('.asset-connection-test-result').classes()).not.toContain('success')
    expect(wrapper.text()).not.toContain('连接成功 ops@10.66.0.8:2208')
    expect(window.aiops.saveAsset).not.toHaveBeenCalled()

    vi.mocked(window.aiops.saveAsset).mockResolvedValueOnce({ ok: true, data: { id: 'workspace-malformed-host' } } as any)
    await wrapper.find('.workspace-host-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.find('.workspace-host-modal').exists()).toBe(true)
    expect(wrapper.findAll('.workspace-host-row').some((row) => row.text().includes('workspace-malformed-host'))).toBe(false)
    await wrapper.find('.workspace-host-modal header button').trigger('click')

    await groupRow('生产').trigger('contextmenu')
    await menuButton('编辑文件夹').trigger('click')
    await wrapper.find('.workspace-folder-modal .files-folder-form input').setValue('生产坏响应')
    vi.mocked(window.aiops.renameAssetGroup).mockResolvedValueOnce({ ok: true, data: { assets: [{ id: 'broken-group' }], folders: [] } } as any)
    await wrapper.find('.workspace-folder-modal .files-folder-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('生产坏响应'))).toBe(false)
    expect(wrapper.findAll('.workspace-folder-row').some((row) => row.text().includes('生产'))).toBe(true)
    await wrapper.find('.workspace-folder-modal header button').trigger('click')

    await hostRow('staging-api').trigger('contextmenu')
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')
    vi.mocked(window.aiops.stopSshTunnel).mockResolvedValueOnce({ ok: true, data: { message: '隧道已停止 staging-api' } } as any)
    await menuButton('隧道').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(hostRow('staging-api').find('.tunnel-icon').attributes('title')).toBe('隧道已连接')

    await wrapper.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
    expect(wrapper.text()).toContain('jumpserver-org')
    expect(wrapper.text()).not.toContain('jumpserver-org-synced-asset')
    await groupRow('jumpserver-org').trigger('contextmenu')
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: { assets: [{ id: 'workspace-malformed-refresh' }], folders: [], refreshed: 1, created: 1, updated: 0 }
    } as any)
    await menuButton('刷新').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.text()).toContain('jumpserver-org')
    expect(wrapper.text()).not.toContain('jumpserver-org-synced-asset')
    expect(wrapper.text()).not.toContain('workspace-malformed-refresh')

    await groupRow('jumpserver-org').trigger('contextmenu')
    const wrongOrganizationAssets = await window.aiops.listAssets()
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: {
        ...wrongOrganizationAssets,
        organizationId: 'other-org',
        refreshed: 1,
        created: 1,
        updated: 0
      }
    } as any)
    await menuButton('刷新').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.text()).not.toContain('jumpserver-org 资源已刷新')
    expect(wrapper.text()).not.toContain('jumpserver-org-synced-asset')

    await groupRow('jumpserver-org').trigger('contextmenu')
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: await buildNonJumpserverOrganizationRefreshData()
    } as any)
    await menuButton('刷新').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(malformedMessage)
    expect(wrapper.text()).toContain('jumpserver-org')
    expect(wrapper.text()).not.toContain('not-jumpserver-org')
    expect(wrapper.text()).not.toContain('jumpserver-org-synced-asset')
  })

  it('fails closed when Workspace cannot trust asset groups, folders, or deletion snapshots', async () => {
    const malformedMessage = '资产服务返回数据无效'
    const originalAiops = {
      listAssets: window.aiops.listAssets,
      listAssetGroups: window.aiops.listAssetGroups,
      saveAsset: window.aiops.saveAsset,
      deleteAsset: window.aiops.deleteAsset,
      saveAssetFolder: window.aiops.saveAssetFolder,
      deleteAssetFolder: window.aiops.deleteAssetFolder,
      renameAssetGroup: window.aiops.renameAssetGroup,
      refreshOrganizationAssets: window.aiops.refreshOrganizationAssets,
      deleteAssetGroup: window.aiops.deleteAssetGroup
    }
    const mountWorkspace = async () => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const store = useWorkspaceStore()
      await store.hydrateConfig()
      const wrapper = mountWorkspacePanel({
        global: { plugins: [pinia] }
      })
      await flushPromises()
      return wrapper
    }
    const hostRow = (wrapper: ReturnType<typeof mount>, name: string) => {
      const row = wrapper.findAll('.workspace-host-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace host row not found: ${name}`)
      return row
    }
    const groupRow = (wrapper: ReturnType<typeof mount>, name: string) => {
      const row = wrapper.findAll('.workspace-folder-row').find((item) => item.text().includes(name))
      if (!row) throw new Error(`Workspace group row not found: ${name}`)
      return row
    }
    const menuButton = (wrapper: ReturnType<typeof mount>, label: string) => {
      const button = wrapper.find('.workspace-node-menu').findAll('button').find((item) => item.text().includes(label))
      if (!button) throw new Error(`Workspace menu button not found: ${label}`)
      return button
    }

    try {
      ;(window.aiops as any).listAssetGroups = undefined
      const missingGroups = await mountWorkspace()
      expect(missingGroups.text()).toContain('资产分组服务不可用')
      expect(missingGroups.findAll('.workspace-host-row').some((row) => row.text().includes('prod-bastion'))).toBe(false)
      missingGroups.unmount()

      ;(window.aiops as any).listAssetGroups = originalAiops.listAssetGroups
      vi.mocked(window.aiops.listAssetGroups).mockResolvedValueOnce([{ key: 'broken-group', name: '生产' }] as any)
      const malformedGroups = await mountWorkspace()
      expect(malformedGroups.text()).toContain(malformedMessage)
      expect(malformedGroups.findAll('.workspace-host-row').some((row) => row.text().includes('prod-bastion'))).toBe(false)
      malformedGroups.unmount()

      const saveRefreshMissing = await mountWorkspace()
      await saveRefreshMissing.find('.workspace-tree').trigger('contextmenu', { clientX: 220, clientY: 260 })
      await menuButton(saveRefreshMissing, '新建主机').trigger('click')
      const hostInputs = () => saveRefreshMissing.findAll('.workspace-host-form input')
      await hostInputs().at(0)!.setValue('workspace-missing-refresh')
      await hostInputs().at(1)!.setValue('10.88.66.55')
      await hostInputs().at(2)!.setValue('ops')
      await hostInputs().at(4)!.setValue('2202')
      vi.mocked(window.aiops.saveAsset).mockImplementationOnce(async (input: any) => {
        const savedResult = await originalAiops.saveAsset(input)
        const snapshot = await originalAiops.listAssets()
        vi.mocked(window.aiops.listAssets).mockResolvedValueOnce({
          assets: snapshot.assets.filter((asset) => asset.id !== savedResult.data?.id),
          folders: snapshot.folders
        })
        return savedResult
      })
      await saveRefreshMissing.find('.workspace-host-form').trigger('submit')
      await flushPromises()
      expect(saveRefreshMissing.text()).toContain(malformedMessage)
      expect(saveRefreshMissing.find('.workspace-host-modal').exists()).toBe(true)
      expect(saveRefreshMissing.findAll('.workspace-host-row').some((row) => row.text().includes('workspace-missing-refresh'))).toBe(false)
      saveRefreshMissing.unmount()

      const wrongAssetDelete = await mountWorkspace()
      await hostRow(wrongAssetDelete, 'prod-bastion').trigger('contextmenu')
      await menuButton(wrongAssetDelete, '删除').trigger('click')
      vi.mocked(window.aiops.deleteAsset).mockResolvedValueOnce({ ok: true, data: { id: 'different-asset' } } as any)
      await wrongAssetDelete.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(wrongAssetDelete.text()).toContain(malformedMessage)
      expect(wrongAssetDelete.findAll('.workspace-host-row').some((row) => row.text().includes('prod-bastion'))).toBe(true)
      wrongAssetDelete.unmount()

      const wrongFolderSave = await mountWorkspace()
      await wrongFolderSave.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      await groupRow(wrongFolderSave, '核心业务').trigger('contextmenu')
      await menuButton(wrongFolderSave, '编辑文件夹').trigger('click')
      await wrongFolderSave.find('.workspace-folder-modal .files-folder-form input').setValue('核心归档')
      vi.mocked(window.aiops.saveAssetFolder).mockResolvedValueOnce({
        ok: true,
        data: { uuid: 'different-folder', name: '核心归档', description: '常用堡垒机业务资产' }
      } as any)
      await wrongFolderSave.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      await flushPromises()
      expect(wrongFolderSave.text()).toContain(malformedMessage)
      expect(wrongFolderSave.find('.workspace-folder-modal').exists()).toBe(true)
      expect(wrongFolderSave.findAll('.workspace-folder-row').some((row) => row.text().includes('核心归档'))).toBe(false)
      expect(wrongFolderSave.findAll('.workspace-folder-row').some((row) => row.text().includes('核心业务'))).toBe(true)
      wrongFolderSave.unmount()

      const staleFolderDelete = await mountWorkspace()
      await staleFolderDelete.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      const staleSnapshot = await originalAiops.listAssets()
      await groupRow(staleFolderDelete, '核心业务').trigger('contextmenu')
      await menuButton(staleFolderDelete, '删除文件夹').trigger('click')
      vi.mocked(window.aiops.deleteAssetFolder).mockImplementationOnce(async (uuid: string) => {
        vi.mocked(window.aiops.listAssets).mockResolvedValueOnce(staleSnapshot)
        return { ok: true, data: { uuid } }
      })
      await staleFolderDelete.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(staleFolderDelete.text()).toContain(malformedMessage)
      expect(staleFolderDelete.findAll('.workspace-folder-row').some((row) => row.text().includes('核心业务'))).toBe(true)
      expect(staleFolderDelete.findAll('.workspace-host-row').some((row) => row.text().includes('prod-bastion'))).toBe(true)
      staleFolderDelete.unmount()

      const staleGroupDelete = await mountWorkspace()
      const staleDirectSnapshot = await originalAiops.listAssets()
      await groupRow(staleGroupDelete, '生产').trigger('contextmenu')
      await menuButton(staleGroupDelete, '删除文件夹').trigger('click')
      vi.mocked(window.aiops.deleteAssetGroup).mockResolvedValueOnce({ ok: true, data: staleDirectSnapshot } as any)
      await staleGroupDelete.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(staleGroupDelete.text()).toContain(malformedMessage)
      expect(staleGroupDelete.findAll('.workspace-folder-row').some((row) => row.text().includes('生产'))).toBe(true)
      staleGroupDelete.unmount()

      const renameGroupRefreshFailure = await mountWorkspace()
      await groupRow(renameGroupRefreshFailure, '生产').trigger('contextmenu')
      await menuButton(renameGroupRefreshFailure, '编辑文件夹').trigger('click')
      await renameGroupRefreshFailure.find('.workspace-folder-modal .files-folder-form input').setValue('生产归档')
      vi.mocked(window.aiops.listAssetGroups).mockResolvedValueOnce([{ key: 'broken-group', name: '生产归档' }] as any)
      await renameGroupRefreshFailure.find('.workspace-folder-modal .files-folder-form').trigger('submit')
      await flushPromises()
      expect(renameGroupRefreshFailure.text()).toContain(malformedMessage)
      expect(renameGroupRefreshFailure.find('.workspace-folder-modal').exists()).toBe(true)
      expect(renameGroupRefreshFailure.findAll('.workspace-folder-row').some((row) => row.text().includes('生产归档'))).toBe(false)
      expect(renameGroupRefreshFailure.findAll('.workspace-folder-row').some((row) => row.text().includes('生产'))).toBe(true)
      renameGroupRefreshFailure.unmount()

      const deleteGroupRefreshFailure = await mountWorkspace()
      await groupRow(deleteGroupRefreshFailure, '预发').trigger('contextmenu')
      await menuButton(deleteGroupRefreshFailure, '删除文件夹').trigger('click')
      vi.mocked(window.aiops.listAssetGroups).mockResolvedValueOnce([{ key: 'broken-group', name: '未分组' }] as any)
      await deleteGroupRefreshFailure.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(deleteGroupRefreshFailure.text()).toContain(malformedMessage)
      expect(deleteGroupRefreshFailure.find('.files-folder-confirm').exists()).toBe(true)
      expect(deleteGroupRefreshFailure.findAll('.workspace-folder-row').some((row) => row.text().includes('预发'))).toBe(true)
      deleteGroupRefreshFailure.unmount()

      const refreshGroupOptionsFailure = await mountWorkspace()
      await refreshGroupOptionsFailure.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      expect(refreshGroupOptionsFailure.text()).not.toContain('jumpserver-org-synced-asset')
      await groupRow(refreshGroupOptionsFailure, 'jumpserver-org').trigger('contextmenu')
      vi.mocked(window.aiops.listAssetGroups).mockResolvedValueOnce([{ key: 'broken-group', name: '企业' }] as any)
      await menuButton(refreshGroupOptionsFailure, '刷新').trigger('click')
      await flushPromises()
      expect(refreshGroupOptionsFailure.text()).toContain(malformedMessage)
      expect(refreshGroupOptionsFailure.text()).toContain('jumpserver-org')
      expect(refreshGroupOptionsFailure.text()).not.toContain('jumpserver-org-synced-asset')
      refreshGroupOptionsFailure.unmount()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not visually commit Workspace and Files resource tree preferences before config saves return matching snapshots', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mountWorkspacePanel({
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

    if (store.workspacePreferences.expandedGroups.includes('group-预发')) {
      await findFilesGroupRow(filesPanel, '预发').trigger('click')
      await flushPromises()
      expect(store.workspacePreferences.expandedGroups).not.toContain('group-预发')
      expect(countFilesSessionRows(filesPanel, 'staging-api')).toBe(1)
    }

    rejectNextPreferenceSave()
    await findFilesGroupRow(filesPanel, '预发').trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.expandedGroups).not.toContain('group-预发')
    expect(countFilesSessionRows(filesPanel, 'staging-api')).toBe(1)

    await findFilesGroupRow(filesPanel, '预发').trigger('click')
    await flushPromises()
    expect(store.workspacePreferences.expandedGroups).toContain('group-预发')
    expect(countFilesSessionRows(filesPanel, 'staging-api')).toBe(2)
    filesPanel.unmount()
  })

  it('matches External reference-style SSH resource tree tabs, display toggle, refresh, and context actions', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const wrapper = mountWorkspacePanel({
      global: { plugins: [pinia] }
    })
    await flushPromises()

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
      expect(filesPanel.text()).toContain('生产')
      expect(filesPanel.text()).toContain('预发')
      expect(filesPanel.text()).toContain('数据库')
      expect(filesPanel.text()).toContain('本地连接')
      expect(filesPanel.text()).not.toContain('核心业务')

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
      const remounted = mountWorkspacePanel({
        global: { plugins: [pinia] }
      })
      await flushPromises()
      expect(remounted.text()).not.toContain('prod-bastion')
      remounted.unmount()

      await filesPanel.vm.$nextTick()
      expect(filesPanel.text()).toContain('10.24.12.44')
      expect(filesPanel.text()).not.toContain('staging-api')
      await findFilesGroupRow(filesPanel, '预发').trigger('click')
      await flushPromises()
      expect(store.workspacePreferences.expandedGroups).not.toContain('group-预发')
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({
            expandedGroups: expect.not.arrayContaining(['group-预发'])
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
      expect(wrapper.text()).not.toContain('已打开本地 shell 127.0.0.1')

      await wrapper.find('.workspace-tree').trigger('contextmenu', { clientX: 220, clientY: 260 })
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('新建主机'))!.trigger('click')
      expect(wrapper.find('.workspace-host-modal').text()).toContain('新建主机')
      await wrapper.find('.workspace-host-form').trigger('submit')
      expect(wrapper.text()).toContain('请填写主机名、地址和用户名')
      await wrapper.findAll('.workspace-host-form input').at(0)!.setValue('workspace-unit')
      await wrapper.findAll('.workspace-host-form input').at(1)!.setValue('10.44.0.9')
      await wrapper.findAll('.workspace-host-form input').at(2)!.setValue('ops')
      await wrapper.findAll('.workspace-host-form input').at(3)!.setValue('')
      await wrapper.findAll('.workspace-host-form input').at(4)!.setValue('2201')
      await wrapper.find('.workspace-host-form textarea').setValue('工作区新增主机')
      vi.mocked(window.aiops.testAssetConnection).mockRejectedValueOnce(new Error('workspace probe refused'))
      vi.mocked(window.aiops.saveAsset).mockClear()
      await wrapper.find('[data-testid="workspace-host-test-connection"]').trigger('click')
      await flushPromises()
      expect(window.aiops.testAssetConnection).toHaveBeenCalledWith({
        asset: expect.objectContaining({ host: '10.44.0.9', username: 'ops', port: 2201 })
      })
      expect(window.aiops.saveAsset).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('workspace probe refused')
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

      store.selectedContexts = []
      const workspaceConnectedPanelId = store.activePanelId
      const workspaceConnectedPanelCount = store.panels.length
      vi.mocked(window.aiops.createTerminal).mockRejectedValueOnce(new Error('workspace ssh refused'))
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited'))!.trigger('dblclick')
      await flushPromises()
      expect(store.panels).toHaveLength(workspaceConnectedPanelCount)
      expect(store.activePanelId).toBe(workspaceConnectedPanelId)
      expect(store.activePanel.title).toBe('workspace-unit-edited')
      expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.44.0.9:2201')
      expect(store.activePanel.output).not.toContain('[aiopsterm] SSH launch failed')
      expect(store.selectedContexts.some((context) => context.label === '10.44.0.9')).toBe(false)
      expect(wrapper.text()).toContain('workspace ssh refused')

      vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
        id: 'terminal-malformed-workspace-ssh',
        shell: 'ssh',
        cwd: '/home/ops',
        kind: 'ssh',
        connection: {
          connectionId: 'ssh-terminal-malformed-workspace',
          host: '10.44.0.9',
          port: 2201,
          username: '',
          assetName: 'workspace-unit-edited',
          createdAt: 1717200006100
        }
      } as any)
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('workspace-unit-edited'))!.trigger('dblclick')
      await flushPromises()
      expect(store.panels).toHaveLength(workspaceConnectedPanelCount)
      expect(store.activePanelId).toBe(workspaceConnectedPanelId)
      expect(store.activePanel.sessionId).not.toBe('terminal-malformed-workspace-ssh')
      expect(store.selectedContexts.some((context) => context.label === '10.44.0.9')).toBe(false)
      expect(wrapper.text()).toContain('SSH 终端启动失败')

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

      await findFilesSessionRow(filesPanel, 'Local').trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      await filesPanel.find('.files-search input').setValue('prod')
      const prodRow = findFilesSessionRow(filesPanel, 'prod-bastion')
      await prodRow.trigger('contextmenu', {
        clientX: 296,
        clientY: 196
      })
      const filesContextMenu = filesPanel.find('.asset-context-menu')
      expect(filesContextMenu.exists()).toBe(true)
      expect(filesContextMenu.text()).toContain('取消收藏')
      expect(filesContextMenu.text()).toContain('编辑备注')
      expect(filesContextMenu.text()).not.toContain('从文件夹移除')
      expect(filesContextMenu.text()).not.toContain('左侧打开')
      expect(filesPanel.find('.files-tree-session.selected').text()).toContain('prod-bastion')
      await filesContextMenu.findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      expect(filesPanel.find('.files-comment-edit input').exists()).toBe(true)
      expect((filesPanel.find('.files-comment-edit input').element as HTMLInputElement).value).toBe('生产入口')
      await filesPanel.find('.files-comment-edit input').setValue('生产入口待确认')
      await filesPanel.find('.files-comment-edit input').trigger('keydown', { key: 'Escape' })
      expect(filesPanel.find('.files-comment-edit').exists()).toBe(false)
      expect(filesPanel.text()).toContain('(生产入口)')
      await findFilesSessionRow(filesPanel, 'prod-bastion').trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      await filesPanel.find('.files-comment-edit input').setValue('新备注')
      await filesPanel.find('.files-comment-edit input').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(filesPanel.find('.files-comment-edit').exists()).toBe(false)
      expect(filesPanel.text()).toContain('(新备注)')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).not.toContain('核心业务')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).not.toContain('Local')
      expect(filesPanel.find('.files-tree-session').exists()).toBe(true)
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      const prodFileSession = findFilesSessionRow(filesPanel, 'prod-bastion')
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
          username: 'ops',
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
      const originalInnerWidth = window.innerWidth
      const originalInnerHeight = window.innerHeight
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 })
      await findFilesSessionRow(filesPanel, 'prod-bastion').trigger('contextmenu', {
        clientX: 310,
        clientY: 210
      })
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(true)
      expect(filesPanel.find('.asset-context-menu').attributes('style')).toContain('left: 155px')
      expect(filesPanel.find('.asset-context-menu').attributes('style')).toContain('top: 154px')
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      expect((filesPanel.find('.files-search input').element as HTMLInputElement).value).toBe('')
      expect(filesPanel.find('.asset-context-menu').exists()).toBe(false)
      expect(filesPanel.find('.files-tree-session.selected').exists()).toBe(false)
      expect(filesPanel.text()).toContain('临时排障')
      expect(filesPanel.text()).toContain('核心业务')
      expect(filesPanel.text()).toContain('jumpserver-org')
      expect(filesPanel.text()).not.toContain('Local')
      expect(filesPanel.text()).not.toContain('staging-api')
      expect(filesPanel.text()).toContain('prod-bastion')
      await findFilesSessionRow(filesPanel, 'prod-bastion').trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').text()).toContain('移动到文件夹')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(true)
      expect(filesPanel.find('.files-folder-modal').text()).toContain('核心业务')
      await filesPanel.findAll('.files-folder-option').find((button) => button.text().includes('临时排障'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(false)
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBe('custom-folder-b')
      expect(filesPanel.text()).not.toContain('Local')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时排障'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('直接连接'))!.trigger('click')
      expect(filesPanel.text()).toContain('Local')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).toContain('数据库')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('数据库'))!.trigger('click')
      await flushPromises()
      expect(filesPanel.text()).toContain('mysql-primary')
      await findFilesSessionRow(filesPanel, 'mysql-primary').trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').text()).not.toContain('从文件夹移除')
      expect(filesPanel.find('.asset-context-menu').text()).not.toContain('移动到文件夹')
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      await findFilesGroupRow(filesPanel, '临时排障').trigger('click')
      await flushPromises()
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
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBe('custom-folder-b')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时归档'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('文件夹内 1 个资产将移出文件夹')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBeUndefined()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.group).toBe('未分组')
      expect(filesPanel.text()).not.toContain('临时归档')
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('核心业务'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('确定删除文件夹 核心业务')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(filesPanel.text()).not.toContain('核心业务')
      await findFilesSessionRow(filesPanel, 'prod-bastion').trigger('contextmenu')
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
      await wrapper.find('.workspace-tree').trigger('contextmenu', { clientX: 220, clientY: 260 })
      expect(wrapper.find('.workspace-node-menu').text()).toContain('新建顶级分组')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('新建顶级分组'))!.trigger('click')
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
      expect((wrapper.find('.workspace-comment-edit input').element as HTMLInputElement).value).toBe('新备注')
      await wrapper.find('.workspace-comment-edit input').setValue('工作区备注')
      await wrapper.find('.workspace-comment-edit input').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.text()).toContain('(工作区备注)')
      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').text()).not.toContain('从文件夹移除')
      expect(wrapper.find('.workspace-node-menu').text()).toContain('移动到文件夹')
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(wrapper.find('.workspace-folder-modal').text()).toContain('值班归档')
      await wrapper.findAll('.files-folder-option').find((button) => button.text().includes('值班归档'))!.trigger('click')
      await flushPromises()
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
      expect(store.userProfile.avatarImageUrl).toMatch(/^aiopsterm-user-avatar:\/\/[a-f0-9]{64}\.png$/)
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

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/avatar.txt'] })
      vi.mocked(window.aiops.prepareUserAvatarImage!).mockResolvedValueOnce({
        ok: true,
        data: {
          filePath: '/tmp/avatar.txt',
          name: 'avatar.txt',
          mimeType: 'text/plain',
          size: 6,
          dataUrl: 'data:text/plain;base64,avatar',
          avatarImageUrl: 'aiopsterm-user-avatar://bad-avatar.png',
          assetFileName: 'bad-avatar.png',
          message: 'malformed avatar'
        }
      } as any)
      await panel.find('.avatar-actions-row .settings-button').trigger('click')
      await flushPromises()
      expect(store.userNotice).toBe('头像后端返回了无效结果')
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
      expect(store.chatMessages).toEqual([])
      expect(wrapper.text()).not.toContain('请输入本次运维目标')
      expect(window.aiops.createChatConversation).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns External reference-style context submenus to main on Escape and empty Backspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
    vi.mocked(window.aiops.exportChat).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
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

    expect(wrapper.find('[data-testid="ai-conversation-tabs"]').exists()).toBe(true)
    expect(wrapper.find('.ai-header > [data-testid="ai-conversation-tabs"]').exists()).toBe(true)
    expect(wrapper.findAll('.ai-header > .ai-header-actions > .ai-header-icon-button')).toHaveLength(1)
    expect(wrapper.find('[data-testid="ai-more-actions-open"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-history-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-chat-search-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-chat-export"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="ai-conversation-tab"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-1"]').text()).toContain('生产巡检')
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-1"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-2"]').exists()).toBe(false)

    const styles = appStyles()
    expect(styles).toContain('.ai-header {\n  justify-content: flex-start;\n  gap: 4px;\n  min-width: 0;\n}')
    expect(styles).toContain('.ai-header-actions {\n  gap: 4px;\n  width: auto;')
    expect(styles).toContain('.ai-panel-mode-menu {\n  position: relative;\n  flex: 0 0 112px;')
    expect(styles).toContain('.ai-header-title {\n  flex: 0 0 48px;')
    expect(styles).toContain('.ai-conversation-tabs {\n  flex: 1 1 0;\n  width: 0;\n  min-width: 0;')
    expect(styles).toContain('.ai-conversation-tab {\n  min-width: 42px;')
    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    expect(wrapper.find('[data-testid="ai-more-actions-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-more-actions-menu"]').findAll('button')).toHaveLength(3)
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
      await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
      await wrapper.vm.$nextTick()
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
    expect(wrapper.findAll('[data-testid="ai-conversation-tab"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-2"]').attributes('aria-selected')).toBe('true')
    await wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-1"]').trigger('click')
    await flushPromises()
    expect(store.selectedConversationId).toBe('history-1')
    expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('history-1')
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-1"]').attributes('aria-selected')).toBe('true')

    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    await wrapper.vm.$nextTick()
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
    const createdConversationId = store.selectedConversationId
    expect(store.chatMessages).toEqual([])
    expect(wrapper.find('.ai-empty-chat').exists()).toBe(true)
    expect(window.aiops.createChatConversation).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-history-dropdown"]').exists()).toBe(false)
    expect(wrapper.find(`[data-testid="ai-conversation-tab"][data-conversation-id="${createdConversationId}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-testid="ai-conversation-tab"][data-conversation-id="${createdConversationId}"]`).text()).toContain('新会话')
    expect(wrapper.find('[data-testid="ai-conversation-tab"][data-conversation-id="history-1"]').exists()).toBe(true)
    store.conversations = store.conversations.map((conversation) =>
      conversation.id === createdConversationId ? { ...conversation, title: '排查磁盘容量持续升高' } : conversation
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find(`[data-testid="ai-conversation-tab"][data-conversation-id="${createdConversationId}"]`).text()).toContain('排查磁盘容量持续升高')
    vi.mocked(window.aiops.deleteChatConversation).mockClear()
    await wrapper.find(`[data-testid="ai-conversation-tab"][data-conversation-id="${createdConversationId}"] .ai-conversation-tab-close`).trigger('click')
    await flushPromises()
    expect(window.aiops.deleteChatConversation).not.toHaveBeenCalled()
    expect(store.selectedConversationId).not.toBe(createdConversationId)
    expect(store.conversations.some((conversation) => conversation.id === createdConversationId)).toBe(true)
    expect(wrapper.find(`[data-testid="ai-conversation-tab"][data-conversation-id="${createdConversationId}"]`).exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="ai-conversation-tab"]').length).toBeGreaterThan(0)
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

    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-chat-search-open"]').trigger('click')
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
    expect(appStyles()).toContain('.input-controls-row {\n  display: flex;\n  flex-wrap: nowrap;')
    expect(appStyles()).toContain('.input-action-buttons-container button {\n  flex: 0 0 24px;')
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

    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="ai-chat-export"]').trigger('click')
    await flushPromises()
    const exportInput = vi.mocked(window.aiops.exportChat).mock.calls.at(-1)?.[0]
    expect(exportInput).toEqual(
      expect.objectContaining({
        title: '生产巡检复盘',
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'search-user', role: 'user' }),
          expect.objectContaining({ id: 'export-command', ask: 'command' })
        ])
      })
    )
    expect(window.aiops.showSaveDialog).not.toHaveBeenCalled()
    expect(window.aiops.writeLocalFile).not.toHaveBeenCalled()
    const exportMarkdown = String((await vi.mocked(window.aiops.exportChat).mock.results.at(-1)?.value)?.data?.markdown)
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
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'))
    await withMockExecCommand(
      () => false,
      async (execCommandSpy) => {
        await assistantMessage!.find('[data-testid="ai-message-copy"]').trigger('click')
        await flushPromises()
        expect(execCommandSpy).toHaveBeenCalledWith('copy')
      }
    )
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('复制失败')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).not.toContain('消息已复制')

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

    store.chatMessages.push(
      {
        id: 'markdown-assistant',
        role: 'assistant',
        text:
          '当前按 CPU 使用率排序，负载最高的进程是：\n\n```text\nPID: 53263\n用户: root\n进程: systemd\n```\n\n**结论**：当前系统没有明显高负载进程。\n<script>alert(1)</script>\n[危险链接](javascript:alert(1))',
        state: 'done'
      },
      {
        id: 'rendered-command-output',
        role: 'assistant',
        text: '```text\nroot@tlinux:~# ps -eo pid,pcpu,comm\n53263 1.9 systemd\n```',
        say: 'command_output',
        state: 'done'
      }
    )
    await wrapper.vm.$nextTick()
    const markdownMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('当前按 CPU 使用率排序'))!
    expect(markdownMessage.find('[data-testid="ai-markdown-message"]').exists()).toBe(true)
    expect(markdownMessage.find('[data-testid="ai-markdown-code-block"]').exists()).toBe(true)
    expect(markdownMessage.text()).toContain('PID: 53263')
    expect(markdownMessage.text()).toContain('结论')
    expect(markdownMessage.text()).not.toContain('```text')
    expect(markdownMessage.html()).not.toContain('<script')
    expect(markdownMessage.html()).not.toContain('javascript:alert')
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await markdownMessage.find('[data-testid="ai-markdown-code-copy"]').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('PID: 53263\n用户: root\n进程: systemd')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('代码已复制')

    const commandOutputMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('root@tlinux:~# ps -eo pid,pcpu,comm'))!
    expect(commandOutputMessage.find('[data-testid="ai-command-output-renderer"]').exists()).toBe(true)
    expect(commandOutputMessage.find('[data-testid="ai-command-output-text"]').text()).toContain('53263 1.9 systemd')
    expect(commandOutputMessage.text()).toContain('OUTPUT')
    expect(commandOutputMessage.text()).not.toContain('```text')
    await commandOutputMessage.find('[data-testid="ai-command-output-copy"]').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('root@tlinux:~# ps -eo pid,pcpu,comm\n53263 1.9 systemd')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('输出已复制')

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
    expect(commandMessage!.find('[data-testid="ai-message-command-card"]').exists()).toBe(true)
    expect(commandMessage!.find('[data-testid="ai-message-command-text"]').text()).toContain('uptime')
    expect(commandMessage!.find('[data-testid="ai-message-command-line-count"]').text()).toContain('1 line')
    expect(commandMessage!.find('[data-testid="ai-message-command-reject"]').exists()).toBe(true)
    expect(commandMessage!.find('[data-testid="ai-message-command-auto-run"]').exists()).toBe(false)
    expect(commandMessage!.find('[data-testid="ai-message-command-review-large"]').exists()).toBe(false)
    expect(commandMessage!.find('[data-testid="ai-message-command-review"]').attributes('title')).toContain('审计并编辑命令')
    expect(appStyles()).toContain('.message-command-actions {\n  display: flex;')
    expect(appStyles()).toContain('flex-wrap: wrap;')
    expect(appStyles()).toContain('.message-command-actions button span {\n  min-width: 0;')
    expect(appStyles()).toContain('text-overflow: ellipsis;')
    expect(appStyles()).toContain('.ai-command-audit-dialog {\n  width: min(1120px, calc(100vw - 36px));')
    expect(appStyles()).toContain('grid-template-rows: auto auto minmax(0, 1fr) auto;')
    expect(appStyles()).toContain('.ai-command-audit-dialog textarea {\n  width: 100%;\n  min-height: 0;\n  height: 100%;')
    await commandMessage!.find('[data-testid="ai-message-command-copy"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('uptime')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('命令已复制')
    await commandMessage!.find('[data-testid="ai-message-command-run"]').trigger('click')
    await flushPromises()
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: uptime')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.executedCommand).toBeUndefined()
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.commandExecutionStatus).toBe('failed')
    expect(commandMessage!.find('[data-testid="ai-message-command-status"]').text()).toContain('终端会话不可用')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('终端会话不可用')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'command-assistant',
            commandExecutionStatus: 'failed',
            commandExecutionMessage: expect.stringContaining('终端会话不可用')
          })
        ])
      })
    )
    store.activePanel.sessionId = 'terminal-command-panel'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    vi.mocked(window.aiops.updateChatConversation).mockClear()
    await commandMessage!.find('[data-testid="ai-message-command-review"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-command-audit-dialog"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ai-command-audit-dialog"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-command-audit-dialog"]').exists()).toBe(true)
    expect((wrapper.find('[data-testid="ai-command-audit-input"]').element as HTMLTextAreaElement).value).toBe('uptime')
    await wrapper.find('[data-testid="ai-command-audit-input"]').setValue('uptime -p')
    expect(wrapper.find('[data-testid="ai-command-audit-line-count"]').text()).toContain('1 line')
    await wrapper.find('[data-testid="ai-command-audit-run"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-command-audit-dialog"]').exists()).toBe(false)
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-command-panel', 'uptime -p\n')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.contentParts?.find((part) => part.type === 'chip' && part.chipType === 'command')?.ref.command).toBe('uptime -p')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.executedCommand).toBe('uptime -p')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.commandExecutionStatus).toBe('succeeded')
    expect(commandMessage!.find('[data-testid="ai-message-command-status"]').text()).toContain('已发送到终端：uptime -p')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'command-assistant',
            executedCommand: 'uptime -p',
            commandExecutionStatus: 'succeeded',
            commandExecutionMessage: '已发送到终端：uptime -p'
          })
        ])
      })
    )
    vi.mocked(window.aiops.writeTerminal).mockClear()
    vi.mocked(window.aiops.updateChatConversation).mockClear()
    await commandMessage!.find('[data-testid="ai-message-command-review"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-command-audit-dialog"]').exists()).toBe(true)
    expect((wrapper.find('[data-testid="ai-command-audit-input"]').element as HTMLTextAreaElement).readOnly).toBe(false)
    expect((wrapper.find('[data-testid="ai-command-audit-input"]').element as HTMLTextAreaElement).value).toBe('uptime -p')
    await wrapper.find('[data-testid="ai-command-audit-input"]').setValue('uptime -s')
    await wrapper.find('[data-testid="ai-command-audit-run"]').trigger('click')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-command-panel', 'uptime -s\n')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.executedCommand).toBe('uptime -s')
    expect(store.chatMessages.find((message) => message.id === 'command-assistant')?.commandExecutionStatus).toBe('succeeded')

    store.chatMessages.push({
      id: 'command-reject-assistant',
      role: 'assistant',
      text: 'df -h',
      state: 'done',
      ask: 'command',
      commandExecution: {
        ip: 'local',
        command: 'df -h',
        requiresApproval: false,
        interactive: false
      }
    })
    await wrapper.vm.$nextTick()
    const rejectableCommandMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('df -h'))
    expect(rejectableCommandMessage).toBeTruthy()
    expect(rejectableCommandMessage!.find('[data-testid="ai-message-command-auto-run"]').exists()).toBe(true)
    await rejectableCommandMessage!.find('[data-testid="ai-message-command-reject"]').trigger('click')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'command-reject-assistant')?.action).toBe('rejected')
    expect(rejectableCommandMessage!.find('[data-testid="ai-message-command-status"]').text()).toContain('已拒绝执行')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('命令已拒绝')
    await rejectableCommandMessage!.find('[data-testid="ai-message-command-review"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect((wrapper.find('[data-testid="ai-command-audit-input"]').element as HTMLTextAreaElement).readOnly).toBe(false)
    await wrapper.find('[data-testid="ai-command-audit-input"]').setValue('df -h /')
    await wrapper.find('[data-testid="ai-command-audit-save"]').trigger('click')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'command-reject-assistant')?.action).toBeUndefined()
    expect(store.chatMessages.find((message) => message.id === 'command-reject-assistant')?.commandExecution?.command).toBe('df -h /')
    expect(store.chatMessages.find((message) => message.id === 'command-reject-assistant')?.commandExecutionStatus).toBeUndefined()
    expect(store.chatMessages.find((message) => message.id === 'command-reject-assistant')?.commandExecutionMessage).toBeUndefined()
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('命令已更新')
    await wrapper.find('[data-testid="ai-command-audit-close"]').trigger('click')

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
      id: 'msg-readonly-user',
      role: 'user',
      text: '检查数据库主机',
      contentParts: [{ type: 'text', text: '检查数据库主机' }],
      hosts: []
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-message-edit"]').exists()).toBe(false)
    await wrapper.find('.message.user .message-parts').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)

    wrapper.unmount()
  })

  it('matches External reference-style Agent host context batch actions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    await wrapper.find('.context-trigger-tag').trigger('click')
    await wrapper.find('[data-onboarding-id="ai-context-hosts-menu"]').trigger('click')
    await wrapper.find('.context-select-popup header input').setValue('10.32.6.9')
    expect(wrapper.find('.host-batch-footer').exists()).toBe(true)
    expect(wrapper.find('.host-batch-footer').text()).toContain('全选')

    await wrapper.find('.host-batch-footer .batch-action-btn').trigger('click')
    expect(store.selectedContexts.some((context) => context.label === '10.32.6.9')).toBe(true)
    expect(wrapper.findAll('.input-context-row .context-tag').some((chip) => chip.text().includes('10.32.6.9'))).toBe(true)
    expect(wrapper.findAll('.chat-editable .mention-chip').some((chip) => chip.text().includes('10.32.6.9'))).toBe(false)
    expect(wrapper.find('.host-batch-footer').text()).toContain('取消全选')
    expect(wrapper.find('.host-batch-footer').text()).toContain('清空选择')

    await wrapper.findAll('.host-batch-footer .batch-action-btn').at(1)!.trigger('click')
    expect(store.selectedContexts.filter((context) => context.kind === 'hosts')).toHaveLength(0)
    expect(wrapper.findAll('.input-context-row .context-tag').some((chip) => chip.text().includes('10.32.6.9'))).toBe(false)

    wrapper.unmount()
  })

  it('prepares AI image attachments through the preload boundary without writing system chat messages', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
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
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
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
        taskId: 'conv-attachment-boundary',
        srcAbsPath: '/tmp/empty-ref.log',
        refPath: '',
        name: 'empty-ref.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-boundary/empty-ref.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/wrong-task.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockResolvedValueOnce({
        mode: 'local',
        taskId: 'other-conversation',
        srcAbsPath: '/tmp/wrong-task.log',
        refPath: 'aiopsterm://chat-attachment/other-conversation/wrong-task.log',
        name: 'wrong-task.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/other-conversation/wrong-task.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/wrong-source.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockResolvedValueOnce({
        mode: 'local',
        taskId: 'conv-attachment-boundary',
        srcAbsPath: '/tmp/other-source.log',
        refPath: 'aiopsterm://chat-attachment/conv-attachment-boundary/wrong-source.log',
        name: 'wrong-source.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-boundary/wrong-source.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/wrong-ref.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockResolvedValueOnce({
        mode: 'local',
        taskId: 'conv-attachment-boundary',
        srcAbsPath: '/tmp/wrong-ref.log',
        refPath: 'aiopsterm://chat-attachment/other-conversation/wrong-ref.log',
        name: 'wrong-ref.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-boundary/wrong-ref.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      store.selectedConversationId = 'conv:attachment/normalized'
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/normalized-task.log'] })
      vi.mocked(window.aiops.stageChatAttachment!).mockResolvedValueOnce({
        mode: 'local',
        taskId: 'conv-attachment-normalized',
        srcAbsPath: '/tmp/normalized-task.log',
        refPath: 'aiopsterm://chat-attachment/conv-attachment-normalized/normalized-task.log',
        name: 'normalized-task.log',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-attachment-normalized/normalized-task.log'
      })
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(window.aiops.stageChatAttachment).toHaveBeenLastCalledWith({ taskId: 'conv:attachment/normalized', srcAbsPath: '/tmp/normalized-task.log' })
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('已添加文件：normalized-task.log')
      expect(wrapper.find('.chat-editable .mention-chip-doc').text()).toContain('normalized-task.log')
    } finally {
      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      ;(window.aiops as any).stageChatAttachment = originalStageChatAttachment
      wrapper.unmount()
    }
  })

  it('fails closed on malformed successful AI input and export backend results', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
    store.selectedConversationId = 'conv-malformed-ai-boundary'
    store.conversations = [
      {
        id: 'conv-malformed-ai-boundary',
        title: 'Malformed AI boundary',
        summary: '',
        updatedAt: '刚刚',
        ts: 1
      }
    ]
    store.chatMessages = [{ id: 'malformed-export-user', role: 'user', text: '导出这条消息', state: 'done' }]

    const originalVoiceBlobArrayBuffer = Blob.prototype.arrayBuffer

    try {
      vi.mocked(window.aiops.exportChat).mockResolvedValueOnce({
        ok: true,
        data: {
          exported: 1
        }
      } as any)
      await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.find('[data-testid="ai-chat-export"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('导出失败：AI 服务返回数据无效')

      vi.mocked(window.aiops.exportChat).mockResolvedValueOnce({
        ok: true,
        data: {
          exported: 1,
          fileName: 'ai-chat.md',
          filePath: '/tmp/ai-chat.md',
          markdown: '# malformed export'
        }
      } as any)
      await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.find('[data-testid="ai-chat-export"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('导出失败：AI 服务返回数据无效')
      expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).not.toContain('聊天已导出')

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/malformed-image.png'] })
      vi.mocked(window.aiops.prepareChatImageAttachmentFromFile).mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'image',
          mediaType: 'image/png',
          data: '',
          name: 'malformed-image.png',
          size: 16
        }
      } as any)
      await wrapper.find('[title="上传图片"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('图片上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .image-preview-wrapper').exists()).toBe(false)

      vi.mocked(window.aiops.prepareChatImageAttachmentFromClipboard).mockResolvedValueOnce({
        ok: true,
        data: {
          type: 'image',
          mediaType: 'image/png',
          name: 'clipboard-malformed.png',
          size: 16
        }
      } as any)
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        value: {
          getData: vi.fn(() => ''),
          items: [{ type: 'image/png', getAsFile: () => null }]
        }
      })
      wrapper.find('[data-testid="ai-message-input"]').element.dispatchEvent(pasteEvent)
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(window.aiops.prepareChatImageAttachmentFromClipboard).toHaveBeenCalledWith()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('图片上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .image-preview-wrapper').exists()).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/malformed-attachment.log'] })
      vi.mocked(window.aiops.stageChatAttachment).mockResolvedValueOnce({
        mode: 'local',
        taskId: 'conv-malformed-ai-boundary',
        srcAbsPath: '/tmp/malformed-attachment.log',
        refPath: 'aiopsterm://chat-attachment/conv-malformed-ai-boundary/malformed-attachment.log',
        name: '',
        size: 128,
        stagedPath: '/tmp/aiopsterm/chat-attachments/conv-malformed-ai-boundary/malformed-attachment.log'
      } as any)
      await wrapper.find('[data-testid="ai-file-upload-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传失败：AI 服务返回数据无效')
      expect(wrapper.find('.chat-editable .mention-chip-doc').exists()).toBe(false)

      vi.mocked(window.aiops.transcribeVoiceInput).mockResolvedValueOnce({
        ok: true,
        data: {
          text: 'malformed transcript must not be inserted',
          provider: 'unknown-provider'
        }
      } as any)
      Object.defineProperty(Blob.prototype, 'arrayBuffer', {
        configurable: true,
        writable: true,
        value: vi.fn(async function (this: Blob) {
          return Uint8Array.from({ length: this.size }, (_value, index) => index % 255).buffer
        })
      })
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await wrapper.vm.$nextTick()
      await new Promise((resolve) => window.setTimeout(resolve, 240))
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await flushPromises()
      await waitForMockCall(vi.mocked(window.aiops.transcribeVoiceInput), 'transcribeVoiceInput')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('语音识别失败：AI 服务返回数据无效')
      expect((wrapper.find('[data-testid="ai-message-input"]').element as HTMLElement).textContent).not.toContain('malformed transcript')
    } finally {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, writable: true, value: originalVoiceBlobArrayBuffer })
      wrapper.unmount()
    }
  })

  it('keeps sent user messages readonly and fails closed on voice transcription backend boundaries', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
    store.selectedConversationId = 'conv-readonly-ai-boundary'
    store.conversations = [
      {
        id: 'conv-readonly-ai-boundary',
        title: 'Readonly AI boundary',
        summary: '',
        updatedAt: '刚刚',
        ts: 1
      }
    ]
    store.chatMessages = [
      {
        id: 'edit-ai-user',
        role: 'user',
        text: '原始故障描述',
        contentParts: [{ type: 'text', text: '原始故障描述' }],
        state: 'done'
      }
    ]

    const originalTranscribeVoiceInput = window.aiops.transcribeVoiceInput
    const originalVoiceBlobArrayBuffer = Blob.prototype.arrayBuffer

    try {
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="ai-message-edit"]').exists()).toBe(false)
      expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)
      await wrapper.find('[data-testid="ai-user-message-content"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)

      ;(window.aiops as any).transcribeVoiceInput = undefined
      Object.defineProperty(Blob.prototype, 'arrayBuffer', {
        configurable: true,
        writable: true,
        value: vi.fn(async function (this: Blob) {
          return Uint8Array.from({ length: this.size }, (_value, index) => index % 255).buffer
        })
      })
      const mainInput = wrapper.find('[data-testid="ai-message-input"]')
      mainInput.element.replaceChildren(document.createTextNode('voice draft'))
      await mainInput.trigger('input')
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await wrapper.vm.$nextTick()
      await new Promise((resolve) => window.setTimeout(resolve, 240))
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.input-placeholder-notice').text()).toContain('语音识别失败：语音识别服务不可用')
      expect((mainInput.element as HTMLElement).textContent).toContain('voice draft')
      expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).not.toContain('recording')
    } finally {
      ;(window.aiops as any).transcribeVoiceInput = originalTranscribeVoiceInput
      Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, writable: true, value: originalVoiceBlobArrayBuffer })
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
    const { wrapper } = await mountAiPanelWithModels(pinia)

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
    const { wrapper } = await mountAiPanelWithModels(pinia)

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

  it('keeps the AI chat scrolled to the newest rendered message', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)
    const chatScroll = wrapper.find('.chat-scroll').element as HTMLElement
    Object.defineProperty(chatScroll, 'scrollHeight', { configurable: true, value: 1400 })
    Object.defineProperty(chatScroll, 'clientHeight', { configurable: true, value: 360 })
    chatScroll.scrollTop = 0

    store.chatMessages.push({
      id: 'scroll-user',
      role: 'user',
      text: '滚动到底部',
      state: 'done'
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    await waitForAnimationFrames(1)

    expect(chatScroll.scrollTop).toBe(1400)

    wrapper.unmount()
  })

  it('renders malformed AI response envelopes as backend errors instead of fabricated answers', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    vi.mocked(window.aiops.generateAiChatResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        text: '这段 malformed 文本不能被当成正常 AI 回答'
      }
    } as any)

    const input = wrapper.find('[data-testid="ai-message-input"]')
    input.element.replaceChildren(document.createTextNode('检查 malformed AI 响应'))
    const range = document.createRange()
    range.selectNodeContents(input.element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await flushPromises()
    await waitForMockCall(vi.mocked(window.aiops.generateAiChatResponse), 'generateAiChatResponse')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const assistantMessage = wrapper.findAll('.message.assistant').at(-1)
    expect(assistantMessage).toBeTruthy()
    expect(store.chatMessages.at(-1)?.state).toBe('error')
    expect(assistantMessage!.text()).toContain('AI 响应生成结果无效')
    expect(assistantMessage!.text()).not.toContain('malformed 文本')

    wrapper.unmount()
  })

  it('renders rejected AI response bridges as backend errors and re-enables input actions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    vi.mocked(window.aiops.generateAiChatResponse).mockRejectedValueOnce(new Error('provider bridge rejected'))

    const input = wrapper.find('[data-testid="ai-message-input"]')
    input.element.replaceChildren(document.createTextNode('检查 rejected AI 响应'))
    const range = document.createRange()
    range.selectNodeContents(input.element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await flushPromises()
    await waitForMockCall(vi.mocked(window.aiops.generateAiChatResponse), 'generateAiChatResponse')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const assistantMessage = wrapper.findAll('.message.assistant').at(-1)
    expect(assistantMessage).toBeTruthy()
    expect(store.chatMessages.at(-1)?.state).toBe('error')
    expect(assistantMessage!.text()).toContain('provider bridge rejected')
    expect(store.chatMessages.some((message) => message.state === 'streaming')).toBe(false)
    expect(wrapper.find('[data-testid="ai-file-upload-button"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('renders and approves AI MCP tool calls through the backend bridge', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    vi.mocked(window.aiops.generateAiChatResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        text: '请求执行 MCP Tool filesystem/read_file。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: 'aichat-request-test-1',
        assistantMessageId: 'aichat-request-test-1-assistant',
        message: {
          id: 'aichat-request-test-1-assistant',
          role: 'assistant',
          text: '请求执行 MCP Tool filesystem/read_file。',
          state: 'done',
          ask: 'mcp_tool_call',
          mcpToolCall: {
            serverName: 'filesystem',
            toolName: 'read_file',
            arguments: { path: '/tmp/readme.md' }
          }
        }
      }
    } as any)

    const input = wrapper.find('[data-testid="ai-message-input"]')
    input.element.replaceChildren(document.createTextNode('读取 README'))
    const range = document.createRange()
    range.selectNodeContents(input.element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await waitForMockCall(vi.mocked(window.aiops.generateAiChatResponse), 'generateAiChatResponse')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-mcp-tool-call"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-mcp-tool-call"]').text()).toContain('filesystem')
    expect(wrapper.find('[data-testid="ai-mcp-tool-call"]').text()).toContain('read_file')
    expect(wrapper.find('[data-testid="ai-mcp-tool-call"]').text()).toContain('/tmp/readme.md')

    vi.mocked(window.aiops.approveAiMcpToolCall).mockClear()
    await wrapper.find('[data-testid="ai-mcp-tool-approve"]').trigger('click')
    await waitForMockCall(vi.mocked(window.aiops.approveAiMcpToolCall), 'approveAiMcpToolCall')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.approveAiMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'aichat-request-test-1-assistant',
        autoApprove: false
      })
    )
    expect(store.chatMessages.at(-1)).toMatchObject({
      action: 'approved',
      say: 'command_output',
      text: 'MCP tool filesystem:read_file executed.'
    })
    expect(wrapper.text()).toContain('MCP tool filesystem:read_file executed.')

    wrapper.unmount()
  })

  it('renders and approves AI MCP resource access through the backend bridge', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    vi.mocked(window.aiops.generateAiChatResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        text: '请求访问 MCP Resource filesystem:file:///workspace。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: 'aichat-request-test-1',
        assistantMessageId: 'aichat-request-test-1-assistant',
        message: {
          id: 'aichat-request-test-1-assistant',
          role: 'assistant',
          text: '请求访问 MCP Resource filesystem:file:///workspace。',
          state: 'done',
          ask: 'mcp_resource_access',
          mcpResourceAccess: {
            serverName: 'filesystem',
            uri: 'file:///workspace'
          }
        }
      }
    } as any)

    const input = wrapper.find('[data-testid="ai-message-input"]')
    input.element.replaceChildren(document.createTextNode('读取工作区资源'))
    const range = document.createRange()
    range.selectNodeContents(input.element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await waitForMockCall(vi.mocked(window.aiops.generateAiChatResponse), 'generateAiChatResponse')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="ai-mcp-resource-access"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-mcp-resource-access"]').text()).toContain('filesystem')
    expect(wrapper.find('[data-testid="ai-mcp-resource-access"]').text()).toContain('file:///workspace')

    vi.mocked(window.aiops.approveAiMcpResourceAccess).mockClear()
    await wrapper.find('[data-testid="ai-mcp-resource-approve"]').trigger('click')
    await waitForMockCall(vi.mocked(window.aiops.approveAiMcpResourceAccess), 'approveAiMcpResourceAccess')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(window.aiops.approveAiMcpResourceAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'aichat-request-test-1-assistant'
      })
    )
    expect(store.chatMessages.at(-1)).toMatchObject({
      action: 'approved',
      say: 'command_output',
      text: 'MCP resource file:///workspace'
    })
    expect(wrapper.text()).toContain('MCP resource file:///workspace')

    wrapper.unmount()
  })

  it('renders provider execute_command blocks as runnable backend-owned command cards', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, store } = await mountAiPanelWithModels(pinia)

    vi.mocked(window.aiops.generateAiChatResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        text: '请求执行 Command 10.24.8.12: uptime。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: 'aichat-request-test-1',
        assistantMessageId: 'aichat-request-test-1-assistant',
        message: {
          id: 'aichat-request-test-1-assistant',
          role: 'assistant',
          text: 'uptime',
          state: 'done',
          ask: 'command',
          commandExecution: {
            ip: '10.24.8.12',
            command: 'uptime',
            requiresApproval: false,
            interactive: false
          }
        }
      }
    } as any)

    const input = wrapper.find('[data-testid="ai-message-input"]')
    input.element.replaceChildren(document.createTextNode('检查负载'))
    const range = document.createRange()
    range.selectNodeContents(input.element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await waitForMockCall(vi.mocked(window.aiops.generateAiChatResponse), 'generateAiChatResponse')
    await flushPromises()
    await wrapper.vm.$nextTick()

    const commandMessage = wrapper.findAll('.message.assistant').find((message) => message.text().includes('uptime'))
    expect(commandMessage).toBeTruthy()
    expect(commandMessage!.find('[data-testid="ai-message-command-card"]').exists()).toBe(true)
    expect(commandMessage!.find('[data-testid="ai-message-command-text"]').text()).toContain('uptime')
    const hostBadge = commandMessage!.find('[data-testid="ai-message-command-host"]')
    expect(hostBadge.exists()).toBe(true)
    expect(hostBadge.attributes('title')).toBe('目标主机：10.24.8.12')
    expect(hostBadge.attributes('aria-label')).toBe('目标主机：10.24.8.12')
    expect(hostBadge.find('svg').exists()).toBe(true)
    expect(hostBadge.text()).toContain('Host 10.24.8.12')
    expect(commandMessage!.find('[data-testid="ai-message-command-run"]').exists()).toBe(true)
    expect(commandMessage!.find('[data-testid="ai-message-command-auto-run"]').exists()).toBe(true)
    expect(commandMessage!.find('[data-testid="ai-message-command-line-count"]').text()).toContain('1 line')

    await commandMessage!.find('[data-testid="ai-message-command-run"]').trigger('click')
    await flushPromises()
    expect(window.aiops.writeTerminal).not.toHaveBeenCalledWith(expect.any(String), 'uptime\n')
    expect(store.chatMessages.find((message) => message.id === 'aichat-request-test-1-assistant')?.commandExecutionStatus).toBe('failed')
    expect(wrapper.find('[data-testid="ai-chat-export-notice"]').text()).toContain('终端会话不可用')

    store.activePanel.sessionId = 'terminal-command-panel'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const runCommandPromise = commandMessage!.find('[data-testid="ai-message-command-auto-run"]').trigger('click')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-command-panel', 'uptime\n')
    store.appendTerminalOutput('terminal-command-panel', 'uptime\n 12:00:00 up 3 days, 1 user, load average: 0.10, 0.20, 0.30\n')
    vi.mocked(window.aiops.generateAiChatResponse).mockImplementationOnce(async (input: any) => ({
      ok: true,
      data: {
        text: '负载正常，无需继续执行命令。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: input.requestId,
        assistantMessageId: input.assistantMessageId
      }
    }))
    await runCommandPromise
    await waitForMockCallCount(vi.mocked(window.aiops.generateAiChatResponse), 2, 'generateAiChatResponse')
    await flushPromises()
    expect(store.chatMessages.find((message) => message.id === 'aichat-request-test-1-assistant')).toMatchObject({
      executedCommand: 'uptime',
      commandExecutionStatus: 'succeeded',
      commandExecution: {
        ip: '10.24.8.12',
        command: 'uptime'
      }
    })
    expect(store.chatMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          say: 'command_output',
          action: 'approved',
          text: expect.stringContaining('load average')
        }),
        expect.objectContaining({
          role: 'assistant',
          state: 'done',
          text: '负载正常，无需继续执行命令。'
        })
      ])
    )
    expect(vi.mocked(window.aiops.generateAiChatResponse).mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'agent',
      prompt: expect.stringContaining('Command output from the approved execute_command tool is available.'),
      messages: expect.arrayContaining([
        expect.objectContaining({
          say: 'command_output',
          action: 'approved',
          text: expect.stringContaining('load average')
        })
      ])
    })
    expect(commandMessage!.find('[data-testid="ai-message-command-status"]').text()).toContain('命令输出已回传 Agent：uptime')

    vi.mocked(window.aiops.generateAiChatResponse).mockImplementationOnce(async (input: any) => ({
      ok: true,
      data: {
        text: '请求执行 Command 10.24.8.12: df -h。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: input.requestId,
        assistantMessageId: input.assistantMessageId,
        message: {
          id: input.assistantMessageId,
          role: 'assistant',
          text: 'df -h',
          state: 'done',
          ask: 'command',
          commandExecution: {
            ip: '10.24.8.12',
            command: 'df -h',
            requiresApproval: false,
            interactive: false
          }
        }
      }
    } as any))
    vi.mocked(window.aiops.generateAiChatResponse).mockImplementationOnce(async (input: any) => ({
      ok: true,
      data: {
        text: '磁盘空间正常。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'done',
        requestId: input.requestId,
        assistantMessageId: input.assistantMessageId
      }
    }))
    vi.mocked(window.aiops.writeTerminal).mockImplementationOnce(async (id: string, data: string) => {
      store.appendTerminalOutput(id, `${data}/dev/vda1 40G 20G 20G 50% /\n`)
      return {
        ok: true,
        data: {
          id,
          bytes: new TextEncoder().encode(data).byteLength
        }
      }
    })
    input.element.replaceChildren(document.createTextNode('继续检查磁盘'))
    range.selectNodeContents(input.element)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    await input.trigger('input')
    await wrapper.find('.chat-input').trigger('submit')
    await waitForMockCallCount(vi.mocked(window.aiops.generateAiChatResponse), 3, 'generateAiChatResponse')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-command-panel', 'df -h\n')
    await waitForMockCallCount(vi.mocked(window.aiops.generateAiChatResponse), 4, 'generateAiChatResponse')
    expect(vi.mocked(window.aiops.generateAiChatResponse).mock.calls.at(-1)?.[0]).toMatchObject({
      mode: 'agent',
      prompt: expect.stringContaining('Command output from the approved execute_command tool is available.')
    })

    wrapper.unmount()
  })

  it('shows a configure-model prompt when the AI catalog has no available chat models', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.mocked(window.aiops.listAiModels).mockResolvedValueOnce({
      chatModels: [],
      lockedChatModels: [{ id: 'gpt-5-pro', label: 'gpt-5-pro', detail: 'Subscription model', locked: true, checked: true, tier: 'VIP' }],
      settingsModels: [{ name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' }]
    })
    const store = useWorkspaceStore()
    store.aiModelOptions = []
    store.lockedAiModelOptions = []
    store.settingModelOptions = []
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })

    await flushPromises()
    await switchAiPanelToClassic(wrapper)
    await waitForMockCall(vi.mocked(window.aiops.listAiModels), 'listAiModels')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.ai-empty-chat.no-model').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有可用的模型')
    expect(wrapper.text()).toContain('配置可用模型')
    expect(wrapper.find('[data-testid="ai-no-model-login"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-message-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-model-select"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-no-model-login"]').trigger('click')
    await flushPromises()
    expect(window.aiops.openUserLogin).toHaveBeenCalled()

    await wrapper.find('[data-testid="ai-no-model-configure"]').trigger('click')
    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('models')

    wrapper.unmount()
  })

  it('opens External reference-style context and command popups in the AI panel', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    await enableCatalogModelOptions(store)
    const wrapper = mount(AiPanel, {
      attachTo: document.body,
      props: { agentMode: true },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    await switchAiPanelToClassic(wrapper)

    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').exists()).toBe(true)
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').attributes('style')).toBeUndefined()
    expect(wrapper.find('.chat-input > .chat-editable + .input-controls-row').exists()).toBe(true)
    expect(wrapper.find('.input-action-buttons-container button[type="submit"]').exists()).toBe(true)
    const styles = appStyles()
    expect(styles).toContain('.input-controls-row {\n  display: flex;\n  flex-wrap: nowrap;')
    expect(styles).toContain('.input-controls-row > .ai-control-menu-wrap:first-child {\n  flex-basis: 70px;\n  max-width: 70px;')
    expect(styles).toContain('.model-control-wrap {\n  flex: 1 1 84px;')
    expect(styles).toContain('.input-action-buttons-container {\n  flex: 0 0 auto;\n  max-width: 100%;')
    expect(styles).toContain('.input-action-buttons-container button {\n  flex: 0 0 24px;')
    expect(styles).not.toContain('grid-column: 1 / -1;\n    justify-content: flex-end;')
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
    expect(wrapper.find('[data-onboarding-id="ai-mode-select"]').attributes('style')).toBeUndefined()
    await wrapper.find('[data-onboarding-id="ai-mode-select"]').trigger('click')
    await wrapper.find('[data-onboarding-id="ai-mode-agent-option"]').trigger('click')
    expect(wrapper.text()).toContain('Agent')

    store.onboardingAiRequest = { action: 'open-model', stepId: 'ai-model-option', sequence: 1 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-onboarding-id="ai-model-option"]').exists()).toBe(true)
    const lockedModelRow = wrapper.findAll('.ai-model-popup .select-list button.locked-model-option').find((button) => button.text().includes('gpt-5-pro'))
    expect(lockedModelRow).toBeTruthy()
    expect(lockedModelRow!.attributes('disabled')).toBeDefined()
    expect(lockedModelRow!.attributes('title')).toContain('升级 VIP')
    expect(lockedModelRow!.find('.locked-model-icon').exists()).toBe(true)
    expect(lockedModelRow!.text()).toContain('VIP')
    await lockedModelRow!.trigger('click')
    expect(store.config.modelName).not.toBe('gpt-5-pro')

    const modelSearchInput = wrapper.find('.ai-model-popup header input')
    expect(modelSearchInput.exists()).toBe(true)
    await modelSearchInput.setValue('qwen')
    await wrapper.vm.$nextTick()
    const qwenFilteredRows = wrapper.findAll('.ai-model-popup button').map((button) => button.text())
    expect(qwenFilteredRows.some((text) => text.includes('qwen2.5-coder'))).toBe(true)
    expect(qwenFilteredRows.some((text) => text.includes('gpt-5'))).toBe(false)
    await modelSearchInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.config.modelName).toBe('qwen2.5-coder')
    expect(store.config.modelProvider).toBe('ollama')
    expect(wrapper.find('.ai-model-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-model-select"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect((wrapper.find('.ai-model-popup header input').element as HTMLInputElement).value).toBe('')
    await wrapper.find('.ai-model-popup header input').setValue('pro')
    await wrapper.vm.$nextTick()
    const filteredLockedModelRow = wrapper.findAll('.ai-model-popup .select-list button.locked-model-option').find((button) => button.text().includes('gpt-5-pro'))
    expect(filteredLockedModelRow).toBeTruthy()
    expect(filteredLockedModelRow!.attributes('disabled')).toBeDefined()
    await wrapper.find('.ai-model-popup header input').trigger('keydown', { key: 'Enter' })
    expect(store.config.modelName).toBe('qwen2.5-coder')
    expect(wrapper.find('.ai-model-popup').exists()).toBe(true)
    await wrapper.find('.ai-model-popup header input').setValue('missing-model')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ai-model-popup .select-list').text()).toContain('没有匹配的模型')
    await wrapper.find('.ai-model-popup header input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.ai-model-popup').exists()).toBe(false)

    await wrapper.find('[data-onboarding-id="ai-model-select"]').trigger('click')
    await wrapper.vm.$nextTick()
    const qwenModelRowAfterSearch = wrapper.findAll('.ai-model-popup .select-list button:not(.locked-model-option)').find((button) => button.text().includes('qwen2.5-coder'))
    expect(qwenModelRowAfterSearch).toBeTruthy()
    expect((wrapper.find('.ai-model-popup header input').element as HTMLInputElement).value).toBe('')
    await qwenModelRowAfterSearch!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.config.modelName).toBe('qwen2.5-coder')
    expect(store.config.modelProvider).toBe('ollama')
    expect(wrapper.find('[data-onboarding-id="ai-model-select"]').text()).toContain('Ollama Coder')
    expect(qwenModelRowAfterSearch!.text()).toContain('qwen2.5-coder')

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
    vi.mocked(window.aiops.listAiCommandCatalog).mockClear()

    mainInput.element.appendChild(document.createTextNode('/'))
    placeCaretAfterTrailingSlash(mainInput.element)
    await mainInput.trigger('input')
    await flushPromises()
    await wrapper.vm.$nextTick()
    placeCaretAfterTrailingSlash(mainInput.element)
    await mainInput.trigger('keyup')
    await mainInput.trigger('keydown', { key: '/' })
    await waitForSelector(wrapper, '.command-select-popup header input')
    expect(window.aiops.listAiCommandCatalog).toHaveBeenCalled()
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
    expect(wrapper.find('[data-testid="ai-context-usage-ring"]').exists()).toBe(false)

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
    const originalVoiceBlobArrayBuffer = Blob.prototype.arrayBuffer
    const originalVoiceFileReader = window.FileReader
    const originalGlobalVoiceFileReader = globalThis.FileReader
    class ForbiddenVoiceFileReader {
      readAsArrayBuffer() {
        throw new Error('renderer FileReader must not read voice audio')
      }

      readAsDataURL() {
        throw new Error('renderer FileReader must not read voice audio')
      }
    }
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: vi.fn(async function (this: Blob) {
        return Uint8Array.from({ length: this.size }, (_value, index) => index % 255).buffer
      })
    })
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: ForbiddenVoiceFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: ForbiddenVoiceFileReader })
    try {
      await voiceButton.trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).toContain('recording')
      expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('title')).toBe('停止语音录制')
      await new Promise((resolve) => window.setTimeout(resolve, 240))
      await wrapper.find('[data-testid="ai-voice-button"]').trigger('click')
      await flushPromises()
      await wrapper.vm.$nextTick()
      await waitForMockCall(vi.mocked(window.aiops.transcribeVoiceInput), 'transcribeVoiceInput')
    } finally {
      Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, writable: true, value: originalVoiceBlobArrayBuffer })
      Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalVoiceFileReader })
      Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalVoiceFileReader })
    }
    const voiceTranscriptionInput = vi.mocked(window.aiops.transcribeVoiceInput).mock.calls.at(-1)?.[0] as {
      audioData?: string
      audioBytes?: ArrayBuffer
      audioFormat?: string
      audioSize?: number
      durationMs?: number
      source?: string
    }
    expect(voiceTranscriptionInput).toEqual(
      expect.objectContaining({
        source: 'browser',
        durationMs: expect.any(Number),
        audioBytes: expect.any(ArrayBuffer),
        audioFormat: 'audio/webm',
        audioSize: 4096
      })
    )
    expect(voiceTranscriptionInput.audioData).toBeUndefined()
    expect(voiceTranscriptionInput.audioBytes?.byteLength).toBe(4096)
    expect(wrapper.find('[data-testid="ai-voice-button"]').classes()).not.toContain('recording')
    expect(wrapper.find('[data-testid="ai-voice-button"]').attributes('title')).toBe('开始语音输入')
    expect(wrapper.find('.input-placeholder-notice').text()).toContain('语音转写完成')
    expect((wrapper.find('[data-testid="ai-message-input"]').element as HTMLElement).textContent).toContain('Provider transcript from test voice backend')

    const markdownContext = store.selectedContexts.find((context) => context.label === 'Markdown语法指南.md')!
    await wrapper.findAll('.input-context-row .context-tag button').find((button) => button.element.closest('.context-tag')?.textContent?.includes('Markdown语法指南.md'))!.trigger('click')
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
    expect(wrapper.find('[data-testid="ai-context-usage-ring"]').exists()).toBe(false)
    mainInput.element.appendChild(document.createTextNode(' /'))
    placeCaretAfterTrailingSlash(mainInput.element)
    await mainInput.trigger('input')
    await flushPromises()
    await wrapper.vm.$nextTick()
    placeCaretAfterTrailingSlash(mainInput.element)
    await mainInput.trigger('keydown', { key: '/' })
    await waitForSelector(wrapper, '.command-select-popup header input')
    await wrapper.find('.command-select-popup header input').setValue('rollback')
    await wrapper.find('.command-select-popup .select-list button').trigger('click')
    vi.mocked(window.aiops.createAiChatExchangeRequest).mockClear()
    vi.mocked(window.aiops.generateAiChatResponse).mockClear()
    vi.mocked(window.aiops.cancelAiChatResponse).mockClear()
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
    const contextUsageRingAfterSend = wrapper.find('[data-testid="ai-context-usage-ring"]')
    expect(contextUsageRingAfterSend.exists()).toBe(true)
    expect(contextUsageRingAfterSend.attributes('title')).toMatch(/^\d+% - .+ \/ 128\.0K context used$/)
    expect(wrapper.find('.context-usage-progress').attributes('stroke-dasharray')).toMatch(/^\d+(\.\d+)? 56\.55$/)
    expect(wrapper.find('.context-usage-progress').attributes('stroke')).toBe('#3b82f6')
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
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.cancelAiChatResponse).toHaveBeenCalledWith({
      requestId: 'aichat-request-test-1',
      assistantMessageId: 'aichat-request-test-1-assistant'
    })
    expect(store.chatMessages.some((message) => message.state === 'streaming')).toBe(false)
    expect(store.chatMessages.at(-1)?.state).toBe('cancelled')
    expect(store.chatMessages.at(-1)?.text).toBe('已停止生成。')
    expect(wrapper.find('[data-testid="ai-file-upload-button"]').attributes('disabled')).toBeUndefined()

    const sentUserMessageId = store.chatMessages.at(-2)?.id
    store.selectCommandPreset(null)
    await wrapper.find('.message.user .message-parts').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-message-edit"]').exists()).toBe(false)
    expect(store.chatMessages.at(-2)?.id).toBe(sentUserMessageId)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'text' && part.text.includes('检查回滚窗口'))).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'doc')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'image')).toBe(true)
    const latestUserMessage = wrapper.findAll('.message.user').at(-1)!
    expect(latestUserMessage.text()).toContain('检查回滚窗口')
    expect(latestUserMessage.find('.message-image-part img').exists()).toBe(true)

    ;(globalThis as any).__setAiTodoSnapshotMock?.([
      { id: 'todo-1', content: '收集上下文', description: '已接收本次对话输入', status: 'completed' },
      {
        id: 'todo-2',
        content: '生成命令建议',
        description: '正在为「检查回滚窗口」生成只读诊断步骤',
        status: 'in_progress',
        isFocused: true,
        subtasks: [
          { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
          { id: 'todo-2-2', content: '关联响应 aichat-request-test-1-assistant' }
        ]
      },
      { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
    ])
    await expect(store.refreshAiTodoSnapshot()).resolves.toBe(true)
    await wrapper.vm.$nextTick()
    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalled()
    expect(store.todoProgress).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1, percent: 33 })
    expect(store.todoItems.find((todo) => todo.id === 'todo-2')).toMatchObject({
      content: '生成命令建议',
      status: 'in_progress',
      isFocused: true
    })
    expect(wrapper.find('.todo-inline-display').exists()).toBe(false)
    expect(wrapper.find('[data-testid="todo-progress-ratio"]').exists()).toBe(false)
    expect(wrapper.find('.todo-compact-list').exists()).toBe(false)
    expect(wrapper.find('.focus-chain-highlight').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('任务进度')
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

    await ensureVisibleTerminalTab(wrapper)
    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
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
    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
    expect(wrapper.find('.tab-menu').text()).toContain('Fork SSH Channel')
    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('Fork SSH Channel'))!.trigger('click')
    await flushPromises()
    expect(store.activePanel.title).toBe('fork-source fork')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh ops@10.8.0.6:2222')
    expect(store.activePanel.outputSegments).toEqual([])
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        assetId: 'asset-fork-unit',
        title: 'fork-source fork',
        ssh: expect.objectContaining({ host: '10.8.0.6', port: 2222, username: 'ops', forkFromConnectionId: 'ssh-source-fork-unit' })
      })
    )
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.activePanel.sshSession?.connectionId).toBe('ssh-test-session-asset-fork-unit')
    expect(store.activePanel.sshSession?.forkFromConnectionId).toBe('ssh-source-fork-unit')
    expect(store.selectedContexts.some((context) => context.id === 'asset-fork-unit' && context.detail === 'fork-source fork')).toBe(true)

    store.selectedContexts = []
    const connectedForkPanelId = store.activePanelId
    const connectedForkPanelCount = store.panels.length
    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
    vi.mocked(window.aiops.createTerminal).mockRejectedValueOnce(new Error('fork ssh refused'))
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('Fork SSH Channel'))!.trigger('click')
    await flushPromises()
    expect(store.panels).toHaveLength(connectedForkPanelCount)
    expect(store.activePanelId).toBe(connectedForkPanelId)
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.selectedContexts.some((context) => context.id === 'asset-fork-unit')).toBe(false)
    expect(store.topNotice).toBe('fork ssh refused')

    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'terminal-malformed-fork-ssh',
      shell: 'ssh',
      cwd: '/home/ops',
      kind: 'ssh',
      connection: {
        connectionId: 'ssh-terminal-malformed-fork',
        host: '10.8.0.6',
        port: 2222,
        username: 'ops',
        assetName: '',
        createdAt: 1717200006200
      }
    } as any)
    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('Fork SSH Channel'))!.trigger('click')
    await flushPromises()
    expect(store.panels).toHaveLength(connectedForkPanelCount)
    expect(store.activePanelId).toBe(connectedForkPanelId)
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.selectedContexts.some((context) => context.id === 'asset-fork-unit')).toBe(false)
    expect(store.topNotice).toBe('SSH 终端启动失败')

    vi.mocked(window.aiops.killTerminal).mockResolvedValueOnce({
      ok: true,
      data: { id: 'terminal-wrong-fork-session' }
    } as any)
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('断开连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('test-session-asset-fork-unit')
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[connection disconnected]')
    expect(store.topNotice).toBe('终端断开失败')

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
        title: 'fork-source fork',
        ssh: expect.objectContaining({ host: '10.8.0.6', port: 2222, username: 'ops', forkFromConnectionId: 'ssh-source-fork-unit' })
      })
    )
    expect(store.activePanel.sessionId).toBe('test-session-asset-fork-unit')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[connection reconnected]')
    expect(store.topNotice).toBe('终端已重新连接')

    const reconnectedSessionId = store.activePanel.sessionId
    vi.mocked(window.aiops.killTerminal).mockClear()
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('断开连接'))!.trigger('click')
    await flushPromises()
    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'terminal-malformed-reconnect-ssh',
      shell: 'ssh',
      cwd: '/home/ops',
      kind: 'ssh',
      connection: {
        connectionId: 'ssh-terminal-malformed-reconnect',
        host: '10.8.0.6',
        port: 2222,
        username: '',
        assetName: 'fork-source',
        createdAt: 1717200006300
      }
    } as any)
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('重新连接'))!.trigger('click')
    await flushPromises()
    expect(store.activePanel.sessionId).toBeUndefined()
    expect(store.activePanel.sessionId).not.toBe('terminal-malformed-reconnect-ssh')
    expect(store.activePanel.status).toBe('closed')
    expect(store.topNotice).toBe('SSH 终端启动失败')
    expect(reconnectedSessionId).toBe('test-session-asset-fork-unit')

    wrapper.unmount()
  })

  it('handles control_compat-style surface actions inside the shared terminal workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any>) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return vi.fn()
    })
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(controlHandler).toBeTruthy()

    const renamed = await controlHandler!({ id: 'surface-action-rename', method: 'surface.action', params: { surfaceId: store.activePanelId, action: 'rename', title: 'Ops Shell' } })
    expect(renamed).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'rename', title: 'Ops Shell' }) }))
    expect(store.activePanel.title).toBe('Ops Shell')

    const anchorPanelId = store.activePanelId
    const created = await controlHandler!({ id: 'surface-action-new', method: 'surface.action', params: { surfaceId: anchorPanelId, action: 'new_terminal_right', title: 'Side Shell', focus: false } })
    expect(created).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'new_terminal_right', createdSurfaceId: expect.any(String) }) }))
    expect(store.panels.map((panel) => panel.title)).toContain('Side Shell')
    expect(store.activePanelId).toBe(anchorPanelId)

    store.createPanel()
    store.renamePanel(store.activePanelId, 'Right Shell')
    const beforeCloseCount = store.panels.length
    const closedRight = await controlHandler!({ id: 'surface-action-close-right', method: 'surface.action', params: { surfaceId: anchorPanelId, action: 'close_right' } })
    expect(closedRight).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'close_right', closed: beforeCloseCount - 1 }) }))
    expect(store.panels).toHaveLength(1)
    expect(store.activePanelId).toBe(anchorPanelId)

    const unknownAction = await controlHandler!({ id: 'surface-action-unknown', method: 'surface.action', params: { surfaceId: anchorPanelId, action: 'open_preview_right' } })
    expect(unknownAction).toEqual(expect.objectContaining({ ok: false, errorCode: 'SURFACE_ACTION_UNKNOWN' }))

    const workspaceRename = await controlHandler!({ id: 'workspace-action-rename', method: 'workspace.action', params: { workspaceId: anchorPanelId, action: 'rename', title: 'Workspace Shell' } })
    expect(workspaceRename).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'rename', workspaceId: 'main' }) }))
    expect(store.activePanel.title).toBe('Workspace Shell')

    wrapper.unmount()
  })

  it('consumes backend terminal lifecycle events for reconnect-aware panel state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(window.aiops.onTerminalLifecycle).toHaveBeenCalled()
    vi.mocked(window.aiops.createTerminal).mockClear()
    await openLocalShellFromActiveTab(wrapper)
    expect(store.activePanel.sessionId).toBe('test-session-local')

    const lifecycleListener = vi.mocked(window.aiops.onTerminalLifecycle).mock.calls.at(-1)?.[0]
    expect(lifecycleListener).toBeTruthy()
    lifecycleListener?.({
      id: 'test-session-local',
      kind: 'local',
      stage: 'closed',
      shell: '/bin/bash',
      cwd: '/tmp/forged',
      code: 0,
      reason: 'manual',
      isNetworkDisconnect: false,
      at: '1717200004990'
    } as any)
    await wrapper.vm.$nextTick()
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.sessionId).toBe('test-session-local')
    expect(store.activePanel.cwd).not.toBe('/tmp/forged')
    expect(store.activePanel.output).not.toContain('[process exited')

    lifecycleListener?.({
      id: 'test-session-local',
      kind: 'local',
      stage: 'error',
      shell: '/bin/bash',
      cwd: '/',
      code: 1,
      reason: 'error',
      isNetworkDisconnect: false,
      errorMessage: 'failed to start shell',
      at: 1717200005000
    })
    await wrapper.vm.$nextTick()

    expect(store.activePanel.status).toBe('error')
    expect(store.activePanel.sessionId).toBeUndefined()
    expect(store.activePanel.output).not.toContain('[connection disconnected]')
    expect(store.activePanel.terminalExit).toEqual(expect.objectContaining({ reason: 'error', errorMessage: 'failed to start shell' }))

    await wrapper.find('.xterm-host').trigger('contextmenu')
    expect(wrapper.find('.terminal-context-menu').text()).toContain('重新连接')
    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('重新连接'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }))
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.sessionId).toBe('test-session-local')

    lifecycleListener?.({
      id: 'test-session-local',
      kind: 'local',
      stage: 'closed',
      shell: '/bin/bash',
      cwd: '/',
      code: 0,
      reason: 'manual',
      isNetworkDisconnect: false,
      at: 1717200005010
    })
    await wrapper.vm.$nextTick()
    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'terminal-malformed-local-reconnect',
      shell: '',
      cwd: '/',
      kind: 'local'
    } as any)
    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('重新连接'))!.trigger('click')
    await flushPromises()
    expect(store.activePanel.sessionId).toBeUndefined()
    expect(store.activePanel.status).toBe('closed')
    expect(store.topNotice).toBe('本地终端启动失败')

    wrapper.unmount()
  })

  it('launches control_compat-style agent teams as grouped visible local terminals through the control socket', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })
    const createTeamTerminal = async (index: number, options?: TerminalCreateOptions): Promise<TerminalSessionInfo> => {
      const id = `team-terminal-${index}`
      return {
        id,
        shell: '/bin/bash',
        cwd: options?.cwd || '/work/project',
        kind: 'local' as const,
        lifecycle: {
          id,
          kind: 'local' as const,
          stage: 'shell-ready' as const,
          shell: '/bin/bash',
          cwd: options?.cwd || '/work/project',
          at: 1717200007000 + index
        }
      }
    }
    vi.mocked(window.aiops.createTerminal)
      .mockImplementationOnce((options?: TerminalCreateOptions) => createTeamTerminal(1, options))
      .mockImplementationOnce((options?: TerminalCreateOptions) => createTeamTerminal(2, options))

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    expect(controlHandler).toBeTruthy()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    const store = useWorkspaceStore()

    const response = await invokeControlHandler({
      id: 'team-1',
      method: 'agent.team.launch',
      params: {
        source: 'codex',
        count: 2,
        cwd: '/work/project',
        prompt: 'review this repo',
        name: 'Review Team'
      }
    })
    await flushPromises()

    expect(response).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          team: expect.objectContaining({
            source: 'codex',
            requestedCount: 2,
            launchedCount: 2,
            failedCount: 0,
            group: expect.objectContaining({ name: 'Review Team', memberCount: 2 })
          })
        })
      })
    )
    expect(window.aiops.createTerminal).toHaveBeenCalledTimes(2)
    expect(window.aiops.createTerminal).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: 'local', title: 'Codex 1', cwd: '/work/project', terminalType: expect.any(String) })
    )
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('team-terminal-1', "cd '/work/project' && codex 'review this repo'\n")
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('team-terminal-2', "cd '/work/project' && codex 'review this repo'\n")
    expect(store.panels.filter((panel) => panel.title.startsWith('Codex'))).toHaveLength(2)
    expect(response?.data?.snapshot.workspaceGroups).toEqual([expect.objectContaining({ name: 'Review Team', memberCount: 2, active: true })])
    expect(store.topNotice).toBe('已创建 2 个 Codex Team 会话')

    wrapper.unmount()
  })

  it('manages control_compat-style surface resume bindings through the control socket', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    expect(controlHandler).toBeTruthy()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    const store = useWorkspaceStore()
    store.activePanel.sessionId = 'resume-terminal-1'
    store.activePanel.status = 'running'
    store.activePanel.cwd = '/work/project'
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const setResponse = await invokeControlHandler({
      id: 'resume-set',
      method: 'surface.resume.set',
      params: {
        panelId: store.activePanelId,
        kind: 'tmux',
        checkpointId: 'work',
        command: 'tmux attach -t work',
        autoResume: true,
        environment: {
          SAFE_ENV: 'yes',
          API_KEY: 'secret'
        }
      }
    })
    expect(setResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          surfaceId: store.activePanelId,
          resumeBinding: expect.objectContaining({
            command: 'tmux attach -t work',
            kind: 'tmux',
            checkpointId: 'work',
            environment: { SAFE_ENV: 'yes' },
            autoResume: true
          })
        })
      })
    )
    expect(setResponse.data.snapshot.surfaces[0].resumeBinding).toEqual(expect.objectContaining({ command: 'tmux attach -t work' }))

    const getResponse = await invokeControlHandler({ id: 'resume-get', method: 'surface.resume.get', params: { panelId: store.activePanelId } })
    expect(getResponse.data.resume_binding).toEqual(expect.objectContaining({ command: 'tmux attach -t work' }))

    const untrustedPreview = await invokeControlHandler({ id: 'resume-preview-untrusted', method: 'surface.resume.preview', params: { panelId: store.activePanelId } })
    expect(untrustedPreview.data.candidates[0]).toEqual(expect.objectContaining({ ready: false, trusted: false, reason: 'untrusted' }))
    const untrustedAutorun = await invokeControlHandler({ id: 'resume-autorun-untrusted', method: 'surface.resume.autorun', params: { panelId: store.activePanelId } })
    expect(untrustedAutorun.data).toEqual(expect.objectContaining({ ranCount: 0, readyCount: 0 }))
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()

    const trustResponse = await invokeControlHandler({
      id: 'resume-trust',
      method: 'surface.resume.trust',
      params: { panelId: store.activePanelId, policy: 'auto', reason: 'unit-test' }
    })
    expect(trustResponse.data.resumeBinding).toEqual(
      expect.objectContaining({
        autoResume: true,
        approvalPolicy: 'auto',
        approval_record_id: expect.stringContaining('surface-resume:'),
        trustReason: 'unit-test'
      })
    )
    const trustedPreview = await invokeControlHandler({ id: 'resume-preview-trusted', method: 'surface.resume.preview', params: { panelId: store.activePanelId } })
    expect(trustedPreview.data).toEqual(expect.objectContaining({ readyCount: 1, trustedCount: 1 }))
    expect(trustedPreview.data.candidates[0]).toEqual(expect.objectContaining({ ready: true, trusted: true, reason: 'ready' }))
    const trustedAutorun = await invokeControlHandler({ id: 'resume-autorun-trusted', method: 'surface.resume.autorun', params: { panelId: store.activePanelId } })
    expect(trustedAutorun.data).toEqual(expect.objectContaining({ ranCount: 1, readyCount: 1 }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('resume-terminal-1', 'tmux attach -t work\n')
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const runResponse = await invokeControlHandler({ id: 'resume-run', method: 'surface.resume.run', params: { panelId: store.activePanelId } })
    expect(runResponse).toEqual(expect.objectContaining({ ok: true }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('resume-terminal-1', 'tmux attach -t work\n')

    const clearResponse = await invokeControlHandler({
      id: 'resume-clear',
      method: 'surface.resume.clear',
      params: { panelId: store.activePanelId, checkpointId: 'work' }
    })
    expect(clearResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ cleared: true, resumeBinding: null }) }))
    const finalGetResponse = await invokeControlHandler({ id: 'resume-get-empty', method: 'surface.resume.get', params: { panelId: store.activePanelId } })
    expect(finalGetResponse.data.resumeBinding).toBeNull()

    wrapper.unmount()
  })

  it('clears terminal scrollback through the control socket', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const panelId = store.activePanelId
    const xterm = mockXtermInstances.at(-1)!
    expect(xterm).toBeTruthy()
    store.activePanel.sessionId = store.activePanel.sessionId || 'clear-terminal-1'
    store.activePanel.status = 'running'
    store.appendTerminalOutput(panelId, 'clear me\n')
    await wrapper.vm.$nextTick()
    expect(store.activePanel.output).toContain('clear me')

    const response = await invokeControlHandler({ id: 'clear-history', method: 'terminal.clear_history', params: { panelId } })

    expect(response).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ cleared: true }) }))
    expect(xterm.clear).toHaveBeenCalled()
    expect(store.activePanel.output).toBe('')

    wrapper.unmount()
  })

  it('handles control_compat-style mobile terminal data-plane controls on shared terminal surfaces', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const panelId = store.activePanelId
    const sessionId = store.activePanel.sessionId
    const xterm = mockXtermInstances.at(-1)!
    xterm.cols = 100
    xterm.rows = 30
    xterm.buffer.active = {
      ...xterm.buffer.active,
      length: 3,
      getLine: (index: number) => ({ translateToString: () => ['alpha', 'beta', 'gamma'][index] || '' })
    } as any
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const workspaceList = await invokeControlHandler({ id: 'mobile-workspace-list', method: 'mobile.workspace.list', params: {} })
    expect(workspaceList).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ workspace_count: 1, count: expect.any(Number) }) }))
    expect(workspaceList.data.terminals).toEqual(expect.arrayContaining([expect.objectContaining({ panelId, panel_id: panelId, session_id: sessionId })]))

    const input = await invokeControlHandler({ id: 'terminal-input', method: 'terminal.input', params: { surface_id: panelId, text: 'pwd' } })
    expect(input).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, queued: false, bytes: 3 }) }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith(sessionId, 'pwd')

    const paste = await invokeControlHandler({ id: 'terminal-paste', method: 'terminal.paste', params: { surface_id: panelId, text: 'hello', submit_key: 'none' } })
    expect(paste).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, submitted: false }) }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith(sessionId, '\x1b[200~hello\x1b[201~')

    const pasteSubmit = await invokeControlHandler({ id: 'terminal-paste-submit', method: 'mobile.terminal.paste', params: { surface_id: panelId, text: 'go', submit_key: 'return' } })
    expect(pasteSubmit).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ submitted: true }) }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith(sessionId, '\x1b[200~go\x1b[201~\r')

    const replay = await invokeControlHandler({ id: 'terminal-replay', method: 'terminal.replay', params: { surface_id: panelId, lines: 2 } })
    expect(replay).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, columns: 100, rows: 30, snapshot_format: 'aiopsterm.text', text: 'beta\ngamma' }) }))

    const viewport = await invokeControlHandler({ id: 'terminal-viewport', method: 'terminal.viewport', params: { surface_id: panelId, viewport_columns: 120, viewport_rows: 40 } })
    expect(viewport).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, columns: 100, rows: 30, viewport_columns: 120, viewport_rows: 40 }) }))

    const scroll = await invokeControlHandler({ id: 'terminal-scroll', method: 'terminal.scroll', params: { surface_id: panelId, delta_lines: 2 } })
    expect(scroll).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, unsupported: true }) }))

    const mouse = await invokeControlHandler({ id: 'terminal-mouse', method: 'terminal.mouse', params: { surface_id: panelId, col: 2, row: 3 } })
    expect(mouse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: panelId, unsupported: true }) }))

    wrapper.unmount()
  })

  it('respawns a terminal through command security from the control socket', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const panelId = store.activePanelId
    const sessionId = store.activePanel.sessionId
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const response = await invokeControlHandler({ id: 'respawn-pane', method: 'surface.respawn', params: { panelId, command: 'exec bash -l' } })

    expect(response).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ command: 'exec bash -l', decision: expect.objectContaining({ status: 'allow' }) }) }))
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith(sessionId, 'exec bash -l\n')

    vi.mocked(window.aiops.writeTerminal).mockClear()
    const approval = await invokeControlHandler({ id: 'respawn-danger', method: 'surface.respawn', params: { panelId, command: 'rm /tmp/file' } })

    expect(approval).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ decision: expect.objectContaining({ status: 'needs-approval' }) }) }))
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('updates split pane layout through the control socket without writing terminal input', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const firstPanelId = store.activePanelId
    const secondPanel = store.createPanel()
    secondPanel.title = 'Pane 2'
    const secondPanelId = secondPanel.id
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const joinResponse = await invokeControlHandler({
      id: 'pane-join',
      method: 'pane.join',
      params: { paneId: secondPanelId, targetPaneId: firstPanelId, direction: 'below', focus: true }
    })
    expect(joinResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ joined: true }) }))
    expect(store.panels.find((panel) => panel.id === secondPanelId)).toEqual(
      expect.objectContaining({ split: 'below', splitSourceId: firstPanelId, splitGroupId: firstPanelId })
    )
    expect(store.activePanelId).toBe(secondPanelId)

    const breakResponse = await invokeControlHandler({
      id: 'pane-break',
      method: 'pane.break',
      params: { paneId: secondPanelId, focus: false }
    })
    expect(breakResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ broken: true }) }))
    expect(store.panels.find((panel) => panel.id === secondPanelId)).toEqual(
      expect.objectContaining({ split: undefined, splitSourceId: undefined, splitGroupId: undefined })
    )

    await invokeControlHandler({
      id: 'pane-join-right',
      method: 'pane.join',
      params: { paneId: secondPanelId, targetPaneId: firstPanelId, direction: 'right' }
    })
    const firstIndexBeforeSwap = store.panels.findIndex((panel) => panel.id === firstPanelId)
    const secondIndexBeforeSwap = store.panels.findIndex((panel) => panel.id === secondPanelId)
    const swapResponse = await invokeControlHandler({
      id: 'pane-swap',
      method: 'pane.swap',
      params: { paneId: secondPanelId, targetPaneId: firstPanelId }
    })
    expect(swapResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ swapped: true }) }))
    expect(store.panels[firstIndexBeforeSwap].id).toBe(secondPanelId)
    expect(store.panels[secondIndexBeforeSwap].id).toBe(firstPanelId)

    const resizeResponse = await invokeControlHandler({
      id: 'pane-resize',
      method: 'pane.resize',
      params: { paneId: firstPanelId, direction: 'right', amount: 5 }
    })
    expect(resizeResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, resized: false }) }))
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('navigates and finds shared work-panel panes through tmux-compatible control commands', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const firstPanelId = store.activePanelId
    store.renamePanel(firstPanelId, 'Main Shell')
    const deployPanel = store.createPanel()
    deployPanel.title = 'Deploy Shell'
    deployPanel.output = 'rollout deploy pending'
    const deployPanelId = deployPanel.id
    const logsPanel = store.createPanel()
    logsPanel.title = 'Logs Shell'
    const logsPanelId = logsPanel.id
    store.activePanelId = firstPanelId
    await wrapper.vm.$nextTick()

    const nextResponse = await invokeControlHandler({ id: 'next-window', method: 'workspace.next', params: {} })
    expect(nextResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: deployPanelId, action: 'next' }) }))
    expect(store.activePanelId).toBe(deployPanelId)

    const previousResponse = await invokeControlHandler({ id: 'previous-window', method: 'workspace.previous', params: {} })
    expect(previousResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: firstPanelId, action: 'previous' }) }))
    expect(store.activePanelId).toBe(firstPanelId)

    await invokeControlHandler({ id: 'select-pane', method: 'pane.focus', params: { paneId: logsPanelId } })
    expect(store.activePanelId).toBe(logsPanelId)
    const lastPaneResponse = await invokeControlHandler({ id: 'last-pane', method: 'pane.last', params: {} })
    expect(lastPaneResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: firstPanelId, action: 'last-pane' }) }))
    expect(store.activePanelId).toBe(firstPanelId)

    const selectWindowResponse = await invokeControlHandler({ id: 'select-window', method: 'workspace.select', params: { workspaceId: '2' } })
    expect(selectWindowResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activePanelId: deployPanelId, action: 'select-window' }) }))
    expect(store.activePanelId).toBe(deployPanelId)

    const findResponse = await invokeControlHandler({ id: 'find-window', method: 'workspace.find', params: { query: 'rollout', content: true, select: true } })
    expect(findResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: 1,
          selected: expect.objectContaining({ panelId: deployPanelId, reason: 'content' }),
          activePanelId: deployPanelId
        })
      })
    )
    expect(store.activePanelId).toBe(deployPanelId)

    wrapper.unmount()
  })

  it('manages shared work-panel panes through tmux-compatible control commands', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const firstPanelId = store.activePanelId

    const createResponse = await invokeControlHandler({
      id: 'new-window',
      method: 'workspace.create',
      params: { title: 'Scratch', cwd: '/tmp/scratch', focus: false, workspace_env: { SAFE_ENV: 'yes', EMPTY_VALUE: '', 'BAD=KEY': 'no' } }
    })
    expect(createResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'new-window' }) }))
    const scratchPanel = store.panels.find((panel) => panel.title === 'Scratch')
    expect(scratchPanel).toEqual(expect.objectContaining({ cwd: '/tmp/scratch' }))
    expect(store.activePanelId).toBe(firstPanelId)

    const envResponse = await invokeControlHandler({ id: 'workspace-env', method: 'workspace.env', params: {} })
    expect(envResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ env: { SAFE_ENV: 'yes' }, count: 1, keys: ['SAFE_ENV'] }) }))
    expect(envResponse.data.snapshot.workspaceEnvironment).toEqual(expect.objectContaining({ count: 1, keys: ['SAFE_ENV'] }))

    const splitResponse = await invokeControlHandler({
      id: 'split-window',
      method: 'surface.split',
      params: { paneId: firstPanelId, direction: 'right', title: 'Sidecar', focus: true }
    })
    expect(splitResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'split-window' }) }))
    const sidecarPanel = store.panels.find((panel) => panel.title === 'Sidecar')
    expect(sidecarPanel).toEqual(expect.objectContaining({ split: 'right', splitSourceId: firstPanelId, splitGroupId: firstPanelId }))
    expect(store.activePanelId).toBe(sidecarPanel?.id)

    const listPanes = await invokeControlHandler({ id: 'list-panes', method: 'pane.list', params: {} })
    expect(listPanes).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ count: store.panels.length }) }))
    expect(listPanes.data.panes).toEqual(expect.arrayContaining([expect.objectContaining({ panelId: firstPanelId }), expect.objectContaining({ panelId: sidecarPanel?.id })]))

    const paneSurfaces = await invokeControlHandler({ id: 'list-pane-surfaces', method: 'pane.surfaces', params: { paneId: sidecarPanel!.id } })
    expect(paneSurfaces).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          paneId: sidecarPanel!.id,
          count: 1,
          surfaces: [expect.objectContaining({ panelId: sidecarPanel!.id, selected: true })]
        })
      })
    )

    const reorderResponse = await invokeControlHandler({
      id: 'reorder-surface',
      method: 'surface.reorder',
      params: { surfaceId: sidecarPanel!.id, index: 0, focus: true }
    })
    expect(reorderResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'surface.reorder', changed: true, toIndex: 0 }) }))
    expect(store.panels[0].id).toBe(sidecarPanel!.id)
    expect(store.activePanelId).toBe(sidecarPanel!.id)

    const moveResponse = await invokeControlHandler({
      id: 'move-surface',
      method: 'surface.move',
      params: { surfaceId: sidecarPanel!.id, paneId: firstPanelId, direction: 'below' }
    })
    expect(moveResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'surface.move', targetPaneId: firstPanelId }) }))
    expect(store.panels.find((panel) => panel.id === sidecarPanel!.id)).toEqual(expect.objectContaining({ split: 'below', splitSourceId: firstPanelId, splitGroupId: firstPanelId }))

    const splitOffResponse = await invokeControlHandler({
      id: 'split-off',
      method: 'surface.split_off',
      params: { surfaceId: sidecarPanel!.id }
    })
    expect(splitOffResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'surface.split_off', splitOff: true }) }))
    expect(store.panels.find((panel) => panel.id === sidecarPanel!.id)).toEqual(expect.objectContaining({ split: undefined, splitSourceId: undefined, splitGroupId: undefined }))

    const healthResponse = await invokeControlHandler({ id: 'surface-health', method: 'surface.health', params: {} })
    expect(healthResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          count: store.panels.length,
          surfaces: expect.arrayContaining([expect.objectContaining({ panelId: sidecarPanel!.id, inWindow: true })])
        })
      })
    )

    const refreshResponse = await invokeControlHandler({ id: 'refresh-surfaces', method: 'surface.refresh', params: {} })
    expect(refreshResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ refreshed: expect.any(Number) }) }))

    const flashResponse = await invokeControlHandler({ id: 'trigger-flash', method: 'surface.trigger_flash', params: { surfaceId: sidecarPanel!.id } })
    expect(flashResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ flashed: true, surfaceId: sidecarPanel!.id }) }))
    expect(store.activePanelId).toBe(sidecarPanel!.id)

    const promptResponse = await invokeControlHandler({ id: 'prompt-submit', method: 'workspace.prompt_submit', params: { workspaceId: sidecarPanel!.id, message: 'echo from control' } })
    expect(promptResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ status: expect.stringMatching(/allow|needs-approval|unavailable|blocked/) }) }))

    const renameResponse = await invokeControlHandler({
      id: 'rename-window',
      method: 'workspace.rename',
      params: { panelId: sidecarPanel!.id, title: 'Renamed Sidecar' }
    })
    expect(renameResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ title: 'Renamed Sidecar' }) }))
    expect(store.panels.find((panel) => panel.id === sidecarPanel?.id)?.title).toBe('Renamed Sidecar')
    expect(store.panels.find((panel) => panel.id === sidecarPanel?.id)?.titleSource).toBe('user')

    const autoTitleProbe = await invokeControlHandler({ id: 'auto-title-probe', method: 'workspace.set_auto_title', params: { panelId: sidecarPanel!.id, probe: true } })
    expect(autoTitleProbe).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ enabled: true, workspace_user_owned: true }) }))
    const skippedAutoTitle = await invokeControlHandler({ id: 'auto-title-skip', method: 'workspace.set_auto_title', params: { panelId: sidecarPanel!.id, title: 'Generated Sidecar' } })
    expect(skippedAutoTitle).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ workspaceApplied: false, workspaceUserOwned: true }) }))
    expect(store.panels.find((panel) => panel.id === sidecarPanel?.id)?.title).toBe('Renamed Sidecar')

    store.panels.find((panel) => panel.id === scratchPanel?.id)!.titleSource = 'system'
    const autoTitleResponse = await invokeControlHandler({ id: 'auto-title-apply', method: 'workspace.set_auto_title', params: { panelId: scratchPanel!.id, title: 'Generated Scratch' } })
    expect(autoTitleResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ workspaceApplied: true, panelId: scratchPanel!.id }) }))
    expect(store.panels.find((panel) => panel.id === scratchPanel?.id)).toEqual(expect.objectContaining({ title: 'Generated Scratch', titleSource: 'auto' }))

    const hasResponse = await invokeControlHandler({ id: 'has-session', method: 'workspace.has_session', params: { panelId: sidecarPanel!.id } })
    expect(hasResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ exists: true, target: sidecarPanel!.id }) }))

    const layoutResponse = await invokeControlHandler({ id: 'select-layout', method: 'workspace.select_layout', params: { layout: 'main-vertical' } })
    expect(layoutResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ layout: 'main-vertical', applied: true }) }))

    const killPaneResponse = await invokeControlHandler({ id: 'kill-pane', method: 'surface.close', params: { paneId: sidecarPanel!.id } })
    expect(killPaneResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'kill-pane' }) }))
    expect(store.panels.some((panel) => panel.id === sidecarPanel?.id)).toBe(false)

    const scratchId = scratchPanel!.id
    const killWindowResponse = await invokeControlHandler({ id: 'kill-window', method: 'workspace.close', params: { panelId: scratchId } })
    expect(killWindowResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'kill-window' }) }))
    expect(store.panels.some((panel) => panel.id === scratchId)).toBe(false)

    wrapper.unmount()
  })

  it('tracks surface telemetry and control_compat create/focus primitives through the control socket', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    await openLocalShellFromActiveTab(wrapper)
    await flushPromises()
    const firstPanelId = store.activePanelId
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const createResponse = await invokeControlHandler({
      id: 'surface-create',
      method: 'surface.create',
      params: { title: 'Created Surface', cwd: '/tmp/created', focus: true }
    })
    expect(createResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surfaceId: expect.any(String), action: 'surface.create' }) }))
    const createdPanelId = createResponse.data.surfaceId
    expect(store.panels.find((panel) => panel.id === createdPanelId)).toEqual(expect.objectContaining({ title: 'Created Surface', cwd: '/tmp/created' }))
    expect(store.activePanelId).toBe(createdPanelId)

    const focusResponse = await invokeControlHandler({ id: 'surface-focus', method: 'surface.focus', params: { surface_id: firstPanelId } })
    expect(focusResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ surface_id: firstPanelId, action: 'surface.focus' }) }))
    expect(store.activePanelId).toBe(firstPanelId)

    const paneCreateResponse = await invokeControlHandler({
      id: 'pane-create',
      method: 'pane.create',
      params: { surface_id: firstPanelId, direction: 'below', title: 'Pane Created', focus: false }
    })
    expect(paneCreateResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ action: 'pane.create' }) }))
    const paneCreated = store.panels.find((panel) => panel.title === 'Pane Created')
    expect(paneCreated).toEqual(expect.objectContaining({ split: 'below', splitSourceId: firstPanelId, splitGroupId: firstPanelId }))

    const reportTty = await invokeControlHandler({ id: 'report-tty', method: 'surface.report_tty', params: { surface_id: firstPanelId, tty_name: '/dev/pts/7' } })
    expect(reportTty).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ tty_name: '/dev/pts/7', recorded: true }) }))
    const reportState = await invokeControlHandler({ id: 'report-state', method: 'surface.report_shell_state', params: { surface_id: firstPanelId, state: 'prompt' } })
    expect(reportState).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ state: 'prompt', published: true }) }))
    const portsKick = await invokeControlHandler({ id: 'ports-kick', method: 'surface.ports_kick', params: { surface_id: firstPanelId, reason: 'refresh' } })
    expect(portsKick).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ reason: 'refresh', kicked: true, port_scan_started: false }) }))

    const listResponse = await invokeControlHandler({ id: 'surface-list', method: 'surface.list', params: {} })
    expect(listResponse.data.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panelId: firstPanelId,
          telemetry: expect.objectContaining({
            tty_name: '/dev/pts/7',
            shell_state: 'prompt',
            last_ports_kick_reason: 'refresh'
          })
        })
      ])
    )
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('maps workspace remote controls to visible SSH terminal surfaces without hidden sessions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.createTerminal).mockClear()
    vi.mocked(window.aiops.writeTerminal).mockClear()

    const configured = await invokeControlHandler({
      id: 'remote-configure',
      method: 'workspace.remote.configure',
      params: { destination: 'root@example.com', port: 2222, title: 'Example Remote' }
    })
    expect(configured).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          configured: true,
          autoConnect: false,
          remote: expect.objectContaining({ connection_state: 'disconnected', host: 'example.com', port: 2222, username: 'root' })
        })
      })
    )
    const remotePanelId = configured.data.surfaceId
    expect(store.panels.find((panel) => panel.id === remotePanelId)).toEqual(expect.objectContaining({ title: 'Example Remote', sshSession: expect.objectContaining({ host: 'example.com', port: 2222, username: 'root' }) }))
    expect(window.aiops.createTerminal).not.toHaveBeenCalled()
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()

    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'ssh-control-1',
      shell: 'ssh',
      cwd: '/home/root',
      kind: 'ssh',
      connection: {
        connectionId: 'ssh-connection-1',
        host: 'example.com',
        port: 2222,
        username: 'root',
        assetName: 'Example Remote',
        createdAt: 1717200010000
      }
    } as any)
    const reconnected = await invokeControlHandler({ id: 'remote-reconnect', method: 'workspace.remote.reconnect', params: { surface_id: remotePanelId } })
    expect(reconnected).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ reconnected: true, remote: expect.objectContaining({ connection_state: 'connected', session_id: 'ssh-control-1' }) }) }))
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ssh', ssh: expect.objectContaining({ host: 'example.com', port: 2222, username: 'root' }) }))

    vi.mocked(window.aiops.killTerminal).mockResolvedValueOnce({ ok: true, data: { id: 'ssh-control-1' } })
    const disconnected = await invokeControlHandler({ id: 'remote-disconnect', method: 'workspace.remote.disconnect', params: { surface_id: remotePanelId } })
    expect(disconnected).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ disconnected: true, remote: expect.objectContaining({ connection_state: 'disconnected' }) }) }))
    expect(window.aiops.killTerminal).toHaveBeenCalledWith('ssh-control-1')

    const sessions = await invokeControlHandler({ id: 'remote-pty-sessions', method: 'workspace.remote.pty_sessions', params: {} })
    expect(sessions).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ sessions: [expect.objectContaining({ surface_id: remotePanelId, connected: false })] }) }))

    const bridge = await invokeControlHandler({ id: 'remote-pty-bridge', method: 'workspace.remote.pty_bridge', params: { session_id: 'ssh-control-1' } })
    expect(bridge).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, method: 'workspace.remote.pty_bridge', session_id: 'ssh-control-1', bridge_available: false }) }))
    const resize = await invokeControlHandler({
      id: 'remote-pty-resize',
      method: 'workspace.remote.pty_resize',
      params: { session_id: 'ssh-control-1', attachment_id: 'attach-1', attachment_token: 'token-1', cols: 100, rows: 40 }
    })
    expect(resize).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, method: 'workspace.remote.pty_resize', resized: false, cols: 100, rows: 40 }) }))
    const tmux = await invokeControlHandler({ id: 'remote-tmux', method: 'remote.tmux.sessions', params: { host: 'example.com' } })
    expect(tmux).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ unsupported: true, method: 'remote.tmux.sessions' }) }))

    wrapper.unmount()
  })

  it('opens control_compat-style settings, feedback, and sidebar snapshots through the shared terminal workspace control handler', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()
    store.upsertAiAttentionItem({ id: 'attention-1', source: 'codex', kind: 'approval', title: 'Approve deploy', summary: 'Needs review', priority: 90, createdAt: 1717200010000 })

    const settingsResponse = await invokeControlHandler({ id: 'settings-open', method: 'settings.open', params: { target: 'models' } })
    expect(settingsResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ opened: true, target: 'models', activeModule: 'settings' })
      })
    )
    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('models')
    expect(store.rightPanelOpen).toBe(false)

    const invalidSettingsResponse = await invokeControlHandler({ id: 'settings-invalid', method: 'settings.open', params: { target: 'not-a-section' } })
    expect(invalidSettingsResponse).toEqual(expect.objectContaining({ ok: false, errorCode: 'SETTINGS_TARGET_INVALID' }))

    vi.mocked(window.aiops.submitSettingsFeedbackReport).mockClear()
    const feedbackResponse = await invokeControlHandler({ id: 'feedback-open', method: 'feedback.open', params: {} })
    expect(feedbackResponse).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ opened: true }) }))
    expect(window.aiops.submitSettingsFeedbackReport).toHaveBeenCalledTimes(1)

    const sidebarResponse = await invokeControlHandler({ id: 'sidebar-snapshot', method: 'extension.sidebar.snapshot', params: { windowId: 'window:1' } })
    expect(sidebarResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          selected_workspace_id: 'main',
          window_id: 'window:1',
          workspaces: [expect.objectContaining({ id: 'main', unread_count: 1, latest_notification_text: 'Needs review' })],
          snapshot: expect.objectContaining({ activeModule: 'settings' })
        })
      })
    )

    wrapper.unmount()
  })

  it('opens project, markdown, and file surfaces through the shared terminal workspace control handler', async () => {
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()

    const markdownResponse = await invokeControlHandler({
      id: 'markdown-open',
      method: 'markdown.open',
      params: { path: 'commands/diagnose.md', line: 2, endLine: 8 }
    })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(markdownResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          opened: true,
          surfaceId: 'kb:commands/diagnose.md',
          relPath: 'commands/diagnose.md',
          surface: expect.objectContaining({ surfaceKind: 'knowledge', knowledge: expect.objectContaining({ startLine: 2, endLine: 8 }) })
        })
      })
    )
    expect(store.activeModule).toBe('workspace')
    expect(store.activePanel).toEqual(expect.objectContaining({ id: 'kb:commands/diagnose.md', kind: 'knowledge' }))
    expect(wrapper.find('.kb-editor-root').exists()).toBe(true)

    const unsupportedAbsolute = await invokeControlHandler({
      id: 'file-open-absolute',
      method: 'file.open',
      params: { path: '/tmp/outside.md' }
    })
    expect(unsupportedAbsolute).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          opened: false,
          unsupported: true,
          unsupportedReason: expect.stringContaining('arbitrary local files')
        })
      })
    )

    const fileResponse = await invokeControlHandler({
      id: 'file-open-many',
      method: 'file.open',
      params: { paths: ['commands/diagnose.md', 'Markdown语法指南.md'], focus: true }
    })
    expect(fileResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          opened: true,
          surfaceId: 'kb:Markdown语法指南.md',
          surfaces: expect.arrayContaining([
            expect.objectContaining({ panelId: 'kb:commands/diagnose.md' }),
            expect.objectContaining({ panelId: 'kb:Markdown语法指南.md' })
          ])
        })
      })
    )
    expect(store.activePanelId).toBe('kb:Markdown语法指南.md')

    const projectOpen = await invokeControlHandler({
      id: 'project-open',
      method: 'project.open',
      params: { path: 'commands/diagnose.md', focus: true }
    })
    expect(projectOpen).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          opened: true,
          surfaceId: 'kb:commands/diagnose.md',
          project: expect.objectContaining({ projectUrl: 'commands/diagnose.md', selectedFile: 'commands/diagnose.md', unsupported: true })
        })
      })
    )

    const setTab = await invokeControlHandler({
      id: 'project-set-tab',
      method: 'project.set_tab',
      params: { surfaceId: 'kb:commands/diagnose.md', tab: 'targets' }
    })
    expect(setTab).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ activeTab: 'targets', active_tab: 'targets' }) }))
    const setFile = await invokeControlHandler({
      id: 'project-set-file',
      method: 'project.set_selected_file',
      params: { surfaceId: 'kb:commands/diagnose.md', path: 'commands/Summary to Doc.md' }
    })
    expect(setFile).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ selectedFile: 'commands/Summary to Doc.md' }) }))
    const state = await invokeControlHandler({
      id: 'project-state',
      method: 'project.get_state',
      params: { surfaceId: 'kb:commands/diagnose.md' }
    })
    expect(state).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          surfaceId: 'kb:commands/diagnose.md',
          activeTab: 'targets',
          selectedFile: 'commands/Summary to Doc.md',
          unsupported: true
        })
      })
    )

    wrapper.unmount()
  })

  it('exports and restores control_compat-style session snapshots in the shared terminal workspace', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })
    const createSessionRestoreTerminal = async (id: string, at: number, options?: TerminalCreateOptions): Promise<TerminalSessionInfo> => {
      return {
        id,
        shell: '/bin/bash',
        cwd: options?.cwd || '/home/unit',
        kind: 'local' as const,
        lifecycle: {
          id,
          kind: 'local' as const,
          stage: 'shell-ready' as const,
          shell: '/bin/bash',
          cwd: options?.cwd || '/home/unit',
          at
        }
      }
    }
    vi.mocked(window.aiops.createTerminal)
      .mockImplementationOnce((options?: TerminalCreateOptions) => createSessionRestoreTerminal('session-restore-1', 1717200010001, options))

    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
    expect(invokeControlHandler).toBeTruthy()
    const store = useWorkspaceStore()

    store.appendTerminalOutput(store.activePanelId, 'screen output must not be persisted\n')
    await openLocalShellFromActiveTab(wrapper)
    const localPanelId = store.activePanelId
    store.activePanel.cwd = '/work/project'
    store.activePanel.title = 'Local Work'
    await invokeControlHandler({
      id: 'restore-group-create',
      method: 'workspace.group.create',
      params: { name: 'Restore Group', from: localPanelId }
    })
    await invokeControlHandler({
      id: 'restore-resume-set',
      method: 'surface.resume.set',
      params: { panelId: localPanelId, kind: 'tmux', checkpointId: 'work', command: 'tmux attach -t work' }
    })

    const exportResponse = await invokeControlHandler({ id: 'session-export', method: 'session.export', params: { id: 'latest', name: 'Restore Layout' } })
    expect(exportResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          snapshot: expect.objectContaining({
            id: 'latest',
            name: 'Restore Layout',
            panels: expect.arrayContaining([expect.objectContaining({ id: localPanelId, title: 'Local Work', cwd: '/work/project', terminalKind: 'local' })]),
            workspaceGroups: [expect.objectContaining({ name: 'Restore Group', memberPanelIds: [localPanelId] })]
          })
        })
      })
    )
    expect(JSON.stringify(exportResponse.data.snapshot)).not.toContain('screen output must not be persisted')
    expect((exportResponse.data.snapshot as any).panels.find((panel: any) => panel.id === localPanelId)?.resumeBinding).toEqual(expect.objectContaining({ command: 'tmux attach -t work' }))

    const restoreSnapshot = {
      id: 'latest',
      name: 'Restore Layout',
      version: 1,
      createdAt: 1717200011000,
      updatedAt: 1717200011000,
      activePanelId: 'restore-ssh',
      mode: 'terminal',
      activeModule: 'workspace',
      panels: [
        {
          id: 'restore-local',
          title: 'Restored Local',
          cwd: '/work/restored',
          kind: 'terminal',
          status: 'running',
          terminalKind: 'local',
          resumeBinding: { command: 'codex resume session-1', kind: 'codex', autoResume: false, updatedAt: 1717200011001 }
        },
        {
          id: 'restore-ssh',
          title: 'Restored SSH',
          cwd: '/home/ops',
          kind: 'terminal',
          status: 'closed',
          terminalKind: 'ssh',
          split: 'right',
          splitSourceId: 'restore-local',
          splitGroupId: 'restore-local',
          splitOrder: 1717200011002,
          sshSession: { host: '10.0.0.8', port: 2222, username: 'ops', assetId: 'asset-restore', assetName: 'Restored SSH' }
        }
      ],
      workspaceGroups: [
        {
          id: 'restore-group',
          name: 'Restored Group',
          anchorPanelId: 'restore-local',
          memberPanelIds: ['restore-local', 'restore-ssh'],
          collapsed: false,
          pinned: true,
          index: 0,
          createdAt: 1717200011000,
          updatedAt: 1717200011000
        }
      ]
    }
    vi.mocked(window.aiops.killTerminal).mockClear()
    vi.mocked(window.aiops.createTerminal).mockClear()
    vi.mocked(window.aiops.createTerminal).mockImplementationOnce((options?: TerminalCreateOptions) => createSessionRestoreTerminal('restored-local-session', 1717200010002, options))
    const restoreResponse = await invokeControlHandler({ id: 'session-restore', method: 'session.restore', params: { snapshot: restoreSnapshot } })
    await flushPromises()

    expect(window.aiops.killTerminal).toHaveBeenCalledWith('session-restore-1')
    expect(window.aiops.createTerminal).toHaveBeenCalledTimes(1)
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'local', panelId: 'restore-local', cwd: '/work/restored', title: 'Restored Local' })
    )
    expect(restoreResponse).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          restoredPanels: 2,
          restoredWorkspaceGroups: 1,
          restoredResumeBindings: 1,
          launchedLocalTerminals: 1,
          skippedRemoteTerminals: 1
        })
      })
    )
    expect(store.panels.map((panel) => panel.id)).toEqual(['restore-local', 'restore-ssh'])
    expect(store.panels[0]).toEqual(expect.objectContaining({ title: 'Restored Local', sessionId: 'restored-local-session', cwd: '/work/restored', status: 'running' }))
    expect(store.panels[1]).toEqual(
      expect.objectContaining({
        title: 'Restored SSH',
        status: 'closed',
        split: 'right',
        splitSourceId: 'restore-local',
        sshSession: expect.objectContaining({ host: '10.0.0.8', port: 2222, username: 'ops' })
      })
    )
    expect(store.panels[1].sessionId).toBeUndefined()
    expect(restoreResponse.data.snapshot.workspaceGroups).toEqual([expect.objectContaining({ name: 'Restored Group', memberCount: 2, active: true })])
    const resumeAfterRestore = await invokeControlHandler({ id: 'resume-after-restore', method: 'surface.resume.get', params: { panelId: 'restore-local' } })
    expect(resumeAfterRestore.data.resumeBinding).toEqual(expect.objectContaining({ command: 'codex resume session-1', kind: 'codex' }))
    expect(store.topNotice).toBe('已恢复会话 Restore Layout')

    wrapper.unmount()
  })

  it('previews and sweeps automatic agent hibernation without touching visible or busy sessions', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1717200020000)
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    let controlHandler: ((request: any) => Promise<any> | any) | null = null
    vi.mocked(window.aiops.onControlRequest).mockImplementationOnce((handler: any) => {
      controlHandler = handler
      return () => {
        controlHandler = null
      }
    })
    const enabledHibernationConfig = {
      ok: true,
      data: {
        config: {
          enabled: true,
          idleSeconds: 5,
          maxLiveTerminals: 2,
          confirmationSeconds: 1
        }
      }
    } as any
    vi.mocked(window.aiops.getAgentHibernationConfig)
      .mockResolvedValueOnce(enabledHibernationConfig)
      .mockResolvedValueOnce(enabledHibernationConfig)
      .mockResolvedValueOnce(enabledHibernationConfig)

    let wrapper: VueWrapper | null = null
    try {
      wrapper = mount(TerminalWorkspace, {
        attachTo: document.body,
        global: { plugins: [pinia] }
      })
      await flushPromises()
      const invokeControlHandler = controlHandler as unknown as (request: any) => Promise<any>
      expect(invokeControlHandler).toBeTruthy()
      const store = useWorkspaceStore()
      store.agentHibernationConfig = {
        enabled: true,
        idleSeconds: 5,
        maxLiveTerminals: 2,
        confirmationSeconds: 1
      }

      store.applyLocalTerminalSession('panel-main', {
        id: 'visible-terminal',
        kind: 'local',
        shell: '/bin/bash',
        cwd: '/work/visible'
      })
      store.renamePanel('panel-main', 'Visible Agent')
      store.activePanelId = 'panel-main'

      const backgroundOld = store.createPanel()
      store.applyLocalTerminalSession(backgroundOld.id, {
        id: 'background-old-terminal',
        kind: 'local',
        shell: '/bin/bash',
        cwd: '/work/old'
      })
      const backgroundNew = store.createPanel()
      store.applyLocalTerminalSession(backgroundNew.id, {
        id: 'background-new-terminal',
        kind: 'local',
        shell: '/bin/bash',
        cwd: '/work/new'
      })
      const busy = store.createPanel()
      store.applyLocalTerminalSession(busy.id, {
        id: 'busy-terminal',
        kind: 'local',
        shell: '/bin/bash',
        cwd: '/work/busy'
      })
      store.activePanelId = 'panel-main'

      store.upsertManagedAiSession({
        source: 'codex',
        event: 'stop',
        sessionId: 'visible-session',
        title: 'Visible',
        summary: '',
        panelId: 'panel-main',
        terminalSessionId: 'visible-terminal',
        cwd: '/work/visible',
        resumeCommand: "cd '/work/visible' && codex resume 'visible-session'",
        agentLifecycle: 'idle',
        receivedAt: 1717200010000,
        terminalActivityAt: 1717200010000
      })
      store.upsertManagedAiSession({
        source: 'codex',
        event: 'stop',
        sessionId: 'old-session',
        title: 'Old',
        summary: '',
        panelId: backgroundOld.id,
        terminalSessionId: 'background-old-terminal',
        cwd: '/work/old',
        resumeCommand: "cd '/work/old' && codex resume 'old-session'",
        agentLifecycle: 'idle',
        receivedAt: 1717200000000,
        terminalActivityAt: 1717200000000,
        terminalProcessId: 4001
      })
      store.upsertManagedAiSession({
        source: 'claude-code',
        event: 'stop',
        sessionId: 'new-session',
        title: 'New',
        summary: '',
        panelId: backgroundNew.id,
        terminalSessionId: 'background-new-terminal',
        cwd: '/work/new',
        resumeCommand: "cd '/work/new' && claude --resume 'new-session'",
        agentLifecycle: 'idle',
        receivedAt: 1717200005000,
        terminalActivityAt: 1717200005000,
        terminalProcessId: 4002
      })
      store.upsertManagedAiSession({
        source: 'codex',
        event: 'pre_tool_use',
        sessionId: 'busy-session',
        title: 'Busy',
        summary: '',
        panelId: busy.id,
        terminalSessionId: 'busy-terminal',
        cwd: '/work/busy',
        resumeCommand: "cd '/work/busy' && codex resume 'busy-session'",
        agentLifecycle: 'running',
        receivedAt: 1717200000000,
        terminalActivityAt: 1717200000000,
        terminalProcessId: 4003
      })
      vi.mocked(window.aiops.killTerminal).mockClear()
      const hibernateResult = async (input: any) => {
        const existing = store.managedAiSessions.find((session) => session.source === input.source && session.id === input.sessionId)!
        return {
          ok: true,
          data: {
            session: {
              ...existing,
              hibernated: true,
              hibernatedAt: Date.now(),
              hibernationReason: input.reason || 'auto-reaper',
              hibernatedTerminalSessionId: input.terminalSessionId,
              updatedAt: Date.now()
            },
            snapshot: {
              sessions: store.managedAiSessions.map((session) =>
                session.source === input.source && session.id === input.sessionId
                  ? {
                      ...session,
                      hibernated: true,
                      hibernatedAt: Date.now(),
                      hibernationReason: input.reason || 'auto-reaper',
                      hibernatedTerminalSessionId: input.terminalSessionId,
                      updatedAt: Date.now()
                    }
                  : session
              )
            },
            config: store.agentHibernationConfig
          }
        } as any
      }
      vi.mocked(window.aiops.hibernateManagedAiSession)
        .mockImplementationOnce(hibernateResult)
        .mockImplementationOnce(hibernateResult)

      const preview = await invokeControlHandler({ id: 'reaper-preview', method: 'agent-hibernation.preview', params: {} })
      expect(preview).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({
            liveRestorableCount: 4,
            eligibleCount: 2,
            selectedCount: 2,
            hibernatedCount: 0
          })
        })
      )
      expect(preview.data.candidates.map((candidate: any) => candidate.session.id)).toEqual(['old-session', 'new-session'])
      expect(preview.data.candidates.map((candidate: any) => candidate.session.id)).not.toContain('visible-session')
      expect(preview.data.candidates.map((candidate: any) => candidate.session.id)).not.toContain('busy-session')

      const firstSweep = await invokeControlHandler({ id: 'reaper-sweep-1', method: 'agent-hibernation.sweep', params: {} })
      expect(firstSweep).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ pendingCount: 2, hibernatedCount: 0 }) }))
      expect(window.aiops.killTerminal).not.toHaveBeenCalled()
      dateNowSpy.mockReturnValue(1717200021500)
      const secondSweep = await invokeControlHandler({ id: 'reaper-sweep-2', method: 'agent-hibernation.sweep', params: {} })
      await flushPromises()

      expect(secondSweep).toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ pendingCount: 0, hibernatedCount: 2 }) }))
      expect(window.aiops.killTerminal).toHaveBeenCalledWith('background-old-terminal')
      expect(window.aiops.killTerminal).toHaveBeenCalledWith('background-new-terminal')
      expect(window.aiops.hibernateManagedAiSession).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'codex', sessionId: 'old-session', reason: 'auto-reaper', terminalSessionId: 'background-old-terminal' })
      )
      expect(window.aiops.hibernateManagedAiSession).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'claude-code', sessionId: 'new-session', reason: 'auto-reaper', terminalSessionId: 'background-new-terminal' })
      )
      expect(store.managedAiSessions.find((session) => session.id === 'old-session')).toEqual(expect.objectContaining({ hibernated: true }))
      expect(store.managedAiSessions.find((session) => session.id === 'new-session')).toEqual(expect.objectContaining({ hibernated: true }))
      expect(store.managedAiSessions.find((session) => session.id === 'visible-session')).toEqual(expect.not.objectContaining({ hibernated: true }))
      expect(store.managedAiSessions.find((session) => session.id === 'busy-session')).toEqual(expect.not.objectContaining({ hibernated: true }))
    } finally {
      wrapper?.unmount()
      dateNowSpy.mockRestore()
    }
  })

  it('applies terminal type and font settings to active views and new local sessions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    store.appendTerminalOutput(store.activePanelId, 'settings terminal view\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const activeTerminal = mockXtermInstances.at(-1)!
    expect(activeTerminal.options.termName).toBe('xterm-256color')

    const terminalFont = '"Liberation Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace'
    await expect(
      store.updateTerminalSettings({
        terminalType: 'vt220',
        fontFamily: terminalFont,
        fontSize: 18,
        lineHeight: 1.4
      })
    ).resolves.toBe(true)
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(activeTerminal.options.termName).toBe('vt220')
    expect(activeTerminal.options.fontFamily).toBe(terminalFont)
    expect(activeTerminal.options.fontSize).toBe(18)
    expect(activeTerminal.options.lineHeight).toBe(1.4)

    store.createPanel()
    store.appendTerminalOutput(store.activePanelId, 'new settings terminal view\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const newPanelTerminal = mockXtermInstances.at(-1)!
    expect(newPanelTerminal).not.toBe(activeTerminal)
    expect(newPanelTerminal.options.termName).toBe('vt220')
    expect(newPanelTerminal.options.fontFamily).toBe(terminalFont)
    expect(newPanelTerminal.options.fontSize).toBe(18)
    expect(newPanelTerminal.options.lineHeight).toBe(1.4)

    vi.mocked(window.aiops.createTerminal).mockClear()
    await openLocalShellFromActiveTab(wrapper)
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local',
        terminalType: 'vt220'
      })
    )

    wrapper.unmount()
  })

  it('opens the default dashboard, keeps new terminals as tabs, and splits only from context menus', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(wrapper.find('.terminal-dashboard').exists()).toBe(true)
    expect(wrapper.text()).toContain('与AI对话')
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(0)
    expect(wrapper.findAll('.terminal-tab')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('欢迎')
    expect(wrapper.text()).not.toContain('local shell')
    expect(wrapper.find('.new-tab-button').exists()).toBe(false)

    store.createPanel()
    store.appendTerminalOutput(store.activePanelId, 'new tab output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(store.panels).toHaveLength(1)
    expect(store.activePanel.split).toBeUndefined()
    expect(wrapper.find('.terminal-dashboard').exists()).toBe(false)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.find('.terminal-grid').classes()).not.toContain('split')

    await expect(store.updateTerminalSettings({ showCloseButton: false })).resolves.toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-tab.active .terminal-tab-close').exists()).toBe(false)
    await expect(store.updateTerminalSettings({ showCloseButton: true })).resolves.toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-tab.active .terminal-tab-close').exists()).toBe(true)

    const firstTerminal = mockXtermInstances.at(-1)!
    const dispatchTerminalWheel = async (deltaY: number) => {
      wrapper.find('.terminal-pane.active .xterm-host').element.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY
        })
      )
      await wrapper.vm.$nextTick()
    }
    await expect(store.updateTerminalSettings({ pinchZoomStatus: false })).resolves.toBe(true)
    await dispatchTerminalWheel(-120)
    await waitForAnimationFrames(2)
    expect(firstTerminal.options.fontSize).toBe(12)
    await expect(store.updateTerminalSettings({ pinchZoomStatus: true })).resolves.toBe(true)
    await dispatchTerminalWheel(-120)
    await waitForAnimationFrames(2)
    expect(firstTerminal.options.fontSize).toBe(13)
    await dispatchTerminalWheel(120)
    await waitForAnimationFrames(2)
    expect(firstTerminal.options.fontSize).toBe(12)

    await wrapper.find('.terminal-tab.active .terminal-tab-close').trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.panels).toHaveLength(1)
    expect(store.activePanel.title).toBe('欢迎')
    expect(wrapper.findAll('.terminal-tab')).toHaveLength(0)

    store.createPanel()
    const sourceSplitPanelId = store.activePanelId
    store.appendTerminalOutput(store.activePanelId, 'new tab output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('向右拆分'))!.trigger('click')
    store.appendTerminalOutput(store.activePanelId, 'split output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(store.activePanel.split).toBe('right')
    expect(store.activePanel.splitSourceId).toBe(sourceSplitPanelId)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(wrapper.find('.terminal-grid').classes()).toContain('split')

    const sourceTerminal = mockXtermInstances.at(-2)!
    const splitTerminal = mockXtermInstances.at(-1)!
    expect(sourceTerminal.options.fontSize).toBe(12)
    expect(splitTerminal.options.fontSize).toBe(12)
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('字体放大'))!.trigger('click')
    await waitForAnimationFrames(2)
    expect(splitTerminal.options.fontSize).toBe(13)
    expect(sourceTerminal.options.fontSize).toBe(12)

    const secondSplitSourceId = store.activePanelId
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('向下拆分'))!.trigger('click')
    store.appendTerminalOutput(store.activePanelId, 'third split output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(store.activePanel.split).toBe('below')
    expect(store.activePanel.splitSourceId).toBe(secondSplitSourceId)
    expect(store.panels.filter((panel) => panel.splitGroupId === store.activePanel.splitGroupId)).toHaveLength(3)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(3)
    const firstPaneStyle = wrapper.findAll('.terminal-pane').at(0)!.attributes('style')
    const secondPaneStyle = wrapper.findAll('.terminal-pane').at(1)!.attributes('style')
    const thirdPaneStyle = wrapper.findAll('.terminal-pane').at(2)!.attributes('style')
    expect(firstPaneStyle).toContain('left: calc(0% + 4px)')
    expect(firstPaneStyle).toContain('width: calc(50% - 8px)')
    expect(firstPaneStyle).toContain('height: calc(100% - 8px)')
    expect(secondPaneStyle).toContain('left: calc(50% + 4px)')
    expect(secondPaneStyle).toContain('height: calc(50% - 8px)')
    expect(thirdPaneStyle).toContain('left: calc(50% + 4px)')
    expect(thirdPaneStyle).toContain('top: calc(50% + 4px)')
    expect(thirdPaneStyle).toContain('height: calc(50% - 8px)')

    await wrapper.findAll('.terminal-pane').at(0)!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(3)
    await wrapper.findAll('.terminal-pane').at(2)!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(3)

    await wrapper.findAll('.terminal-pane').at(0)!.find('.xterm-host').trigger('mousedown', { button: 0 })
    expect(store.activePanelId).toBe(sourceSplitPanelId)
    await wrapper.findAll('.terminal-pane').at(0)!.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('向右拆分'))!.trigger('click')
    store.appendTerminalOutput(store.activePanelId, 'fourth split output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(store.activePanel.split).toBe('right')
    expect(store.activePanel.splitSourceId).toBe(sourceSplitPanelId)
    expect(store.panels.filter((panel) => panel.splitGroupId === store.activePanel.splitGroupId)).toHaveLength(4)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)

    await wrapper.findAll('.terminal-pane').at(3)!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)
    await wrapper.findAll('.terminal-pane').at(1)!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(4)

    wrapper.unmount()
  })

  it('shows compact terminal tab context for local and SSH sessions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    const localPanel = store.createPanel()
    localPanel.title = 'API shell'
    localPanel.cwd = '/srv/projects/api'
    store.appendTerminalOutput(localPanel.id, 'local ready\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const localTab = wrapper.find('.terminal-tab.active')
    expect(localTab.find('.terminal-tab-title').text()).toBe('API shell')
    expect(localTab.find('.terminal-tab-meta').text()).toBe('api')
    expect(localTab.attributes('title')).toContain('本地终端')
    expect(localTab.attributes('title')).toContain('/srv/projects/api')

    const sshPanel = store.createPanel()
    sshPanel.title = 'Prod SSH'
    sshPanel.cwd = '/var/log/nginx'
    sshPanel.sshSession = {
      host: '10.0.0.8',
      port: 2222,
      username: 'ops',
      assetId: 'asset-prod',
      assetName: 'Prod'
    }
    store.appendTerminalOutput(sshPanel.id, 'ssh ready\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const sshTab = wrapper.find('.terminal-tab.active')
    expect(sshTab.find('.terminal-tab-title').text()).toBe('Prod SSH')
    expect(sshTab.find('.terminal-tab-meta').text()).toBe('ops@10.0.0.8:2222')
    expect(sshTab.find('.terminal-tab-kind').text()).toBe('ssh')
    expect(sshTab.attributes('title')).toContain('SSH')
    expect(sshTab.attributes('title')).toContain('状态:')
    expect(sshTab.attributes('title')).toContain('主机: ops@10.0.0.8:2222')
    expect(sshTab.attributes('title')).toContain('/var/log/nginx')

    wrapper.unmount()
  })

  it('shows and copies the active terminal context bar with pending AI attention', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    vi.mocked(navigator.clipboard.writeText).mockClear()
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    const panel = store.createPanel()
    panel.title = 'Deploy shell'
    panel.cwd = '/srv/projects/deploy'
    store.applyLocalTerminalSession(panel.id, {
      id: 'terminal-deploy',
      kind: 'local',
      shell: '/bin/bash',
      cwd: '/srv/projects/deploy'
    })
    store.upsertManagedAiSession({
      source: 'claude-code',
      event: 'permission_request',
      sessionId: 'claude-deploy-approval',
      title: 'Deploy approval',
      summary: 'Approve deployment command',
      panelId: panel.id,
      terminalSessionId: 'terminal-deploy',
      cwd: '/srv/projects/deploy',
      requestKind: 'permission',
      decisionMode: 'blocking',
      actionable: true,
      receivedAt: 100
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const contextBar = wrapper.find('.terminal-context-bar')
    expect(contextBar.exists()).toBe(true)
    expect(contextBar.text()).toContain('bash')
    expect(contextBar.text()).toContain('Local')
    expect(contextBar.text()).toContain('/srv/projects/deploy')
    expect(contextBar.text()).toContain('1 AI')

    await contextBar.findAll('button').find((button) => button.text().includes('复制上下文'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Title: bash'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('CWD: /srv/projects/deploy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Pending AI: claude-code/Deploy approval'))
    expect(store.topNotice).toBe('终端上下文已复制')

    vi.mocked(window.aiops.listManagedAiSessions).mockResolvedValueOnce({
      ok: true,
      data: {
        sessions: store.managedAiSessions.map((session) => ({
          ...session,
          events: session.events || [],
          decisions: session.decisions || []
        }))
      }
    } as any)
    await contextBar.findAll('button').find((button) => button.text().includes('AI 会话'))!.trigger('click')
    expect(store.activeModule).toBe('aiSessions')
    await contextBar.findAll('button').find((button) => button.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(window.aiops.listManagedAiSessions).toHaveBeenCalled()
    expect(store.topNotice).toBe('AI 会话已刷新')
    await contextBar.findAll('button').find((button) => button.text() === '聚焦')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.activeModule).toBe('workspace')
    expect(mockXtermInstances.at(-1)!.focus).toHaveBeenCalled()

    await contextBar.find('.terminal-context-attention').trigger('click')
    expect(store.activeModule).toBe('aiSessions')
    expect(store.selectedManagedAiSession?.id).toBe('claude-deploy-approval')

    wrapper.unmount()
  })

  it('restores and reattaches terminal splits from context menus and tab dragging', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    store.createPanel()
    const firstTabId = store.activePanelId
    store.appendTerminalOutput(firstTabId, 'first terminal\n')
    await wrapper.vm.$nextTick()

    await wrapper.find('.terminal-tab.active').trigger('contextmenu', { clientX: 120, clientY: 40 })
    await wrapper.find('.tab-menu').findAll('button').find((button) => button.text().includes('向右拆分'))!.trigger('click')
    const splitTabId = store.activePanelId
    store.appendTerminalOutput(splitTabId, 'split terminal\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)
    expect(wrapper.find('.terminal-grid').classes()).toContain('split')

    const splitTerminal = mockXtermInstances.at(-1)!
    const splitFitAddon = splitTerminal.loadAddon.mock.calls.find(([addon]) => 'fit' in addon)?.[0]
    const fitCallsBeforeUnsplit = splitFitAddon.fit.mock.calls.length
    const activeHost = wrapper.find('.terminal-pane.active .xterm-host').element as HTMLElement
    activeHost.innerHTML = `
      <div class="xterm" style="width: 320px; height: 160px; max-width: 320px;">
        <div class="xterm-screen" style="width: 320px; height: 160px;">
          <canvas width="320" height="160" style="width: 320px; height: 160px;"></canvas>
          <div class="xterm-text-layer" style="width: 320px; height: 160px;"></div>
        </div>
        <div class="xterm-viewport" style="width: 320px; height: 160px;"></div>
        <div class="xterm-scroll-area" style="width: 320px; height: 160px;"></div>
      </div>
    `
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    expect(wrapper.find('.terminal-context-menu').text()).toContain('取消拆分')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('取消拆分'))!.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await waitForAnimationFrames(4)
    expect(store.activePanelId).toBe(splitTabId)
    expect(store.activePanel.split).toBeUndefined()
    expect(store.activePanel.splitGroupId).toBeUndefined()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(wrapper.find('.terminal-grid').classes()).not.toContain('split')
    expect((activeHost.querySelector('.xterm') as HTMLElement).style.width).toBe('')
    expect((activeHost.querySelector('.xterm-screen') as HTMLElement).style.height).toBe('')
    expect((activeHost.querySelector('.xterm-viewport') as HTMLElement).style.width).toBe('')
    expect((activeHost.querySelector('canvas') as HTMLCanvasElement).getAttribute('width')).toBeNull()
    expect(splitFitAddon.fit.mock.calls.length).toBeGreaterThan(fitCallsBeforeUnsplit)
    expect(splitTerminal.refresh).toHaveBeenCalledWith(0, expect.any(Number))

    const tabsAfterRestore = wrapper.findAll('.terminal-tab')
    const restoredTab = tabsAfterRestore.find((tab) => tab.classes().includes('active'))!
    const sourceTabIndex = store.panels.findIndex((panel) => panel.id === firstTabId)
    const sourceTab = tabsAfterRestore.at(sourceTabIndex)!
    const attachTransfer = createTestDataTransfer()
    const attachDragStart = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(attachDragStart, 'dataTransfer', { configurable: true, value: attachTransfer })
    restoredTab.element.dispatchEvent(attachDragStart)
    const attachDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(attachDrop, 'dataTransfer', { configurable: true, value: attachTransfer })
    sourceTab.element.dispatchEvent(attachDrop)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await waitForAnimationFrames(4)
    expect(attachTransfer.setData).toHaveBeenCalledWith('application/x-aiopsterm-terminal-tab', splitTabId)
    expect(store.activePanelId).toBe(splitTabId)
    expect(store.activePanel.split).toBe('right')
    expect(store.activePanel.splitSourceId).toBe(firstTabId)
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(2)

    const restoreTransfer = createTestDataTransfer()
    const restoreDragStart = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(restoreDragStart, 'dataTransfer', { configurable: true, value: restoreTransfer })
    wrapper.find('.terminal-tab.active').element.dispatchEvent(restoreDragStart)
    const restoreDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(restoreDrop, 'dataTransfer', { configurable: true, value: restoreTransfer })
    wrapper.find('.terminal-tabs').element.dispatchEvent(restoreDrop)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await waitForAnimationFrames(4)
    expect(store.activePanelId).toBe(splitTabId)
    expect(store.activePanel.split).toBeUndefined()
    expect(store.activePanel.splitGroupId).toBeUndefined()
    expect(wrapper.findAll('.terminal-pane')).toHaveLength(1)
    expect(splitTerminal.refresh).toHaveBeenCalledWith(0, expect.any(Number))

    wrapper.unmount()
  })

  it('copies live local and SSH terminal connections when splitting panes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    mockXtermInstances.length = 0
    const wrapper = mount(TerminalWorkspace, {
      attachTo: document.body,
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    await openLocalShellFromActiveTab(wrapper)
    const localSourcePanelId = store.activePanelId
    expect(store.activePanel.sessionId).toBe('test-session-local')

    vi.mocked(window.aiops.createTerminal).mockClear()
    vi.mocked(window.aiops.createTerminal).mockResolvedValueOnce({
      id: 'test-session-local-split',
      shell: '/bin/bash',
      cwd: '/',
      kind: 'local',
      lifecycle: {
        id: 'test-session-local-split',
        kind: 'local',
        stage: 'shell-ready',
        shell: '/bin/bash',
        cwd: '/',
        at: 1717200002000
      }
    })
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('向右拆分'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local' }))
    expect(store.activePanel.split).toBe('right')
    expect(store.activePanel.splitSourceId).toBe(localSourcePanelId)
    expect(store.activePanel.sessionId).toBe('test-session-local-split')
    expect(store.activePanel.status).toBe('running')
    expect(store.activePanel.output).not.toContain('[aiopsterm]')
    expect(wrapper.find('.terminal-grid').classes()).toContain('split-right')
    expect(wrapper.find('.terminal-grid').classes()).not.toContain('split-below')

    store.closePanels('all')
    store.registerSshSession(store.activePanelId, {
      id: 'asset-split-unit',
      name: 'split-source',
      host: '10.8.0.9',
      port: 2229,
      username: 'ops',
      group_name: '生产',
      asset_type: 'person',
      auth_type: 'keyBased'
    })
    store.applySshTerminalSession(
      store.activePanelId,
      {
        id: 'test-session-source-split-unit',
        shell: 'ssh',
        cwd: '/home/ops',
        kind: 'ssh',
        connection: {
          connectionId: 'ssh-source-split-unit',
          host: '10.8.0.9',
          port: 2229,
          username: 'ops',
          assetId: 'asset-split-unit',
          assetName: 'split-source',
          assetType: 'person',
          organizationId: '生产',
          authType: 'keyBased',
          title: 'split-source',
          createdAt: 1717200002000
        }
      },
      {
        id: 'asset-split-unit',
        name: 'split-source',
        host: '10.8.0.9',
        port: 2229,
        username: 'ops',
        group_name: '生产',
        asset_type: 'person',
        auth_type: 'keyBased'
      }
    )
    await wrapper.vm.$nextTick()
    const sshSourcePanelId = store.activePanelId

    vi.mocked(window.aiops.createTerminal).mockClear()
    await wrapper.find('.terminal-pane.active .xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('向下拆分'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        assetId: 'asset-split-unit',
        title: 'split-source',
        ssh: expect.objectContaining({ host: '10.8.0.9', port: 2229, username: 'ops' })
      })
    )
    expect(store.activePanel.split).toBe('below')
    expect(store.activePanel.splitSourceId).toBe(sshSourcePanelId)
    expect(store.activePanel.sessionId).toBe('test-session-asset-split-unit')
    expect(store.activePanel.sshSession?.sourcePanelId).toBe(sshSourcePanelId)
    expect(store.activePanel.sshSession?.connectionId).toBe('ssh-test-session-asset-split-unit')
    expect(store.activePanel.output).not.toContain('aiopsterm ssh')
    expect(wrapper.find('.terminal-grid').classes()).toContain('split-below')

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
    const xterm = mockXtermInstances.at(-1)!
    expect(xterm.updateKeywordHighlight).toHaveBeenCalledWith(highlightConfig)
    expect(xterm.write.mock.calls.some(([data]) => String(data).includes('\x1b[1;38;5;'))).toBe(false)
    expect(store.activePanel.output).toContain('ERROR from service')
    expect(store.activePanel.output).not.toContain('\x1b[')
    store.appendTerminalInput(store.activePanelId, 'sudo systemctl status nginx\n')
    expect(store.getHighlightedTerminalOutput(store.activePanelId)).toContain('sudo')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(xterm.updateKeywordHighlight).toHaveBeenCalledWith(highlightConfig)
    expect(xterm.write.mock.calls.some(([data]) => String(data).includes('\x1b[1;38;5;'))).toBe(false)
    xterm.write.mockClear()
    store.activePanel.sessionId = 'live-highlight-session'
    store.appendTerminalOutput('live-highlight-session', 'ERROR from live shell\n')
    xterm.write('ERROR from live shell\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const liveHighlightWrite = xterm.write.mock.calls.at(-1)?.[0]
    expect(liveHighlightWrite).toContain('ERROR')
    expect(liveHighlightWrite).toContain('from live shell')
    expect(liveHighlightWrite).not.toContain('\x1b[')
    expect(store.activePanel.output).toContain('ERROR from live shell')
    expect(store.activePanel.output).not.toContain('\x1b[')
    store.activePanel.sessionId = undefined

    const firstHost = wrapper.find('.xterm-host')
    const styles = appStyles()
    expect(styles).toMatch(/\.xterm-host \{[\s\S]*?min-height: 0;[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;[\s\S]*?display: grid;[\s\S]*?box-sizing: border-box;[\s\S]*?\}/)
    expect(styles).toContain('padding: 10px 10px 16px;')
    Object.defineProperty(firstHost.element, 'clientHeight', { configurable: true, value: 360 })
    xterm.rows = 20
    xterm.buffer.active.viewportY = 0
    xterm.emitSelection('systemctl status nginx', { start: { x: 0, y: 5 }, end: { x: 22, y: 5 } })
    await wrapper.vm.$nextTick()
    const aiButton = wrapper.find('.terminal-chat-ai-button')
    expect(aiButton.exists()).toBe(true)
    expect(aiButton.attributes('style')).toContain('top: 60px')
    expect(aiButton.attributes('style')).toContain('right: 26px')
    xterm.emitSelection('bottom prompt', { start: { x: 0, y: 19 }, end: { x: 13, y: 19 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-chat-ai-button').attributes('style')).toContain('top: 294px')
    xterm.emitSelection('systemctl status nginx', { start: { x: 0, y: 5 }, end: { x: 22, y: 5 } })
    await wrapper.vm.$nextTick()
    await aiButton.trigger('click')
    expect(store.rightPanelOpen).toBe(true)
    expect(store.chatMessages.at(-2)?.text).toContain('Terminal output:')
    expect(store.chatMessages.at(-2)?.text).toContain('systemctl status nginx')
    expect(xterm.clearSelection).toHaveBeenCalled()

    Object.defineProperty(firstHost.element, 'clientWidth', { configurable: true, value: 720 })
    xterm.buffer.active.cursorX = 6
    xterm.buffer.active.cursorY = 8
    expect(wrapper.find('.terminal-toolbar').exists()).toBe(false)
    expect(wrapper.find('.command-line input').exists()).toBe(false)
    await (await openTerminalCommandLine(wrapper)).setValue('df')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.command-line.floating').exists()).toBe(true)
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

    const originalSuggestionBridge = window.aiops.getTerminalCommandSuggestions
    try {
      ;(window.aiops as any).getTerminalCommandSuggestions = undefined
      await wrapper.find('.command-line input').setValue('svc')
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(store.topNotice).toBe('终端命令建议服务不可用')
      expect(wrapper.find('.terminal-suggestions').exists()).toBe(false)
    } finally {
      ;(window.aiops as any).getTerminalCommandSuggestions = originalSuggestionBridge
    }

    vi.mocked(window.aiops.getTerminalCommandSuggestions).mockRejectedValueOnce(new Error('suggestions backend rejected'))
    await wrapper.find('.command-line input').setValue('svc')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('suggestions backend rejected')
    expect(wrapper.find('.terminal-suggestions').exists()).toBe(false)

    vi.mocked(window.aiops.getTerminalCommandSuggestions).mockResolvedValueOnce([
      { command: '', source: 'base', explanation: 'empty command from backend' } as any
    ])
    await wrapper.find('.command-line input').setValue('bad')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('终端命令建议服务返回数据无效')
    expect(wrapper.find('.terminal-suggestions').exists()).toBe(false)
    await wrapper.find('.command-line input').trigger('keydown', { key: 'ArrowRight' })
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect((wrapper.find('.command-line input').element as HTMLInputElement).value).toBe('bad')
    expect(store.activePanel.output).not.toContain('empty command from backend')

    vi.mocked(window.aiops.getTerminalCommandSuggestions)
      .mockImplementationOnce(async () => [{ command: 'tail -f /var/log/syslog', source: 'history', explanation: 'history on this host' }])
      .mockResolvedValueOnce([{ command: 'tail -n 100 /var/log/syslog', source: 'unknown-source', explanation: 'malformed ai source' } as any])
    await wrapper.find('.command-line input').setValue('tail')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-suggestions').text()).toContain('tail -f /var/log/syslog')
    await wrapper.find('.terminal-suggestions .ai-trigger').trigger('mouseenter')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('终端命令建议服务返回数据无效')
    expect(wrapper.find('.terminal-suggestions').text()).toContain('tail -f /var/log/syslog')
    expect(wrapper.find('.terminal-suggestions').text()).not.toContain('tail -n 100 /var/log/syslog')
    expect(wrapper.find('.terminal-suggestions .ai-trigger-loading').exists()).toBe(false)

    vi.mocked(window.aiops.getTerminalCommandSuggestions)
      .mockImplementationOnce(async () => [{ command: 'journalctl -u nginx', source: 'history', explanation: 'history on this host' }])
      .mockRejectedValueOnce(new Error('ai suggestion rejected'))
    await wrapper.find('.command-line input').setValue('journal')
    await flushPromises()
    await wrapper.vm.$nextTick()
    await wrapper.find('.terminal-suggestions .ai-trigger').trigger('mouseenter')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('ai suggestion rejected')
    expect(wrapper.find('.terminal-suggestions').text()).toContain('journalctl -u nginx')
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
    await openLocalShellFromActiveTab(wrapper)
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

    const terminalAfterReconnect = mockXtermInstances.at(-1)!
    terminalAfterReconnect.selectedText = 'copied terminal text'
    await wrapper.find('.xterm-host').trigger('contextmenu')
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('复制'))!.trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copied terminal text')
    expect(store.topNotice).toBe('终端内容已复制')
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(false)

    terminalAfterReconnect.selectedText = 'copy should fail'
    await wrapper.find('.xterm-host').trigger('contextmenu')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard write denied'))
    const originalExecCommand = document.execCommand
    const failedExecCommandSpy = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: failedExecCommandSpy
    })
    try {
      await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('复制'))!.trigger('click')
      await flushPromises()
      expect(failedExecCommandSpy).toHaveBeenCalledWith('copy')
      expect(store.topNotice).toBe('终端复制失败')
      expect(wrapper.find('.terminal-context-menu').exists()).toBe(false)
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: originalExecCommand
        })
      } else {
        Reflect.deleteProperty(document, 'execCommand')
      }
    }

    vi.mocked(window.aiops.writeTerminal).mockClear()
    vi.mocked(window.aiops.writeRuntimeLog!).mockClear()
    store.appendTerminalOutput('test-session-local', 'Welcome to Ubuntu 24.04 LTS\r\nroot@tlinux:~# ')
    terminalAfterReconnect.write('Welcome to Ubuntu 24.04 LTS\r\nroot@tlinux:~# ')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(terminalAfterReconnect.write).toHaveBeenCalledWith('Welcome to Ubuntu 24.04 LTS\r\nroot@tlinux:~# ')
    const clearCallsBeforeInput = terminalAfterReconnect.clear.mock.calls.length
    terminalAfterReconnect.emitData('pwd\n')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('test-session-local', 'pwd\n')
    expect(terminalAfterReconnect.clear.mock.calls).toHaveLength(clearCallsBeforeInput)
    expect(terminalAfterReconnect.write).not.toHaveBeenCalledWith(expect.stringContaining('root@tlinux:~# pWelcome'))
    expect(terminalAfterReconnect.scrollToBottom).toHaveBeenCalled()
    expect(window.aiops.writeRuntimeLog).toHaveBeenCalledWith(
      'debug',
      'renderer.terminal-input.write-request',
      expect.objectContaining({
        panelId: store.activePanelId,
        sessionId: 'test-session-local',
        bytes: 4
      })
    )
    expect(window.aiops.writeRuntimeLog).toHaveBeenCalledWith(
      'debug',
      'renderer.terminal-input.write-accepted',
      expect.objectContaining({
        panelId: store.activePanelId,
        sessionId: 'test-session-local',
        bytes: 4
      })
    )
    expect(store.activePanel.output).not.toContain('pwd')

    vi.mocked(window.aiops.writeTerminal).mockClear()
    terminalAfterReconnect.write.mockImplementationOnce(() => {
      terminalAfterReconnect.emitData('\x1b[>0;276;0c')
    })
    store.replaceTerminalOutput('test-session-local', 'replayed terminal history\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await flushPromises()
    expect(window.aiops.writeTerminal).not.toHaveBeenCalledWith('test-session-local', '\x1b[>0;276;0c')

    vi.mocked(window.aiops.writeTerminal).mockResolvedValueOnce({ ok: true, data: { id: 'wrong-session', bytes: 4 } })
    terminalAfterReconnect.emitData('date')
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('test-session-local', 'date')
    expect(store.topNotice).toBe('终端写入服务返回数据无效')
    expect(window.aiops.writeRuntimeLog).toHaveBeenCalledWith(
      'warn',
      'renderer.terminal-input.write-rejected',
      expect.objectContaining({
        panelId: store.activePanelId,
        sessionId: 'test-session-local',
        bytes: 4,
        ok: true
      })
    )

    vi.mocked(window.aiops.writeTerminal).mockClear()
    if (!wrapper.find('.command-line input').exists()) await openTerminalCommandLine(wrapper)
    await wrapper.find('.command-line input').setValue('whoami')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('test-session-local', 'whoami\n')
    expect(store.activePanel.output).not.toContain('whoami')
    expect(wrapper.find('.command-line input').exists()).toBe(false)

    await enableCatalogModelOptions(store)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-command-dialog').exists()).toBe(true)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.listAiModels).toHaveBeenCalled()
    expect(wrapper.find('.terminal-command-dialog select').text()).toContain('qwen2.5-coder')
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
        modelName: 'qwen2.5-coder'
      })
    )
    expect(store.terminalCommandGenerationRecords[0]).toEqual(expect.objectContaining({ instruction: '检查磁盘空间', command: 'df -h' }))
    expect(store.activePanel.outputSegments.at(-1)).toEqual({ text: 'df -h', scope: 'input' })
    expect(wrapper.find('.terminal-command-dialog').exists()).toBe(true)
    expect((wrapper.find('.terminal-command-dialog textarea').element as HTMLTextAreaElement).value).toBe('')

    const originalGenerateTerminalCommand = window.aiops.generateTerminalCommand
    try {
      ;(window.aiops as any).generateTerminalCommand = undefined
      await wrapper.find('.terminal-command-dialog textarea').setValue('检查内存')
      await wrapper.find('.terminal-command-dialog textarea').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.terminal-command-dialog p').text()).toBe('命令生成失败')
      expect(store.topNotice).toBe('终端命令生成服务不可用')
      expect(store.terminalCommandGenerationRecords.some((record) => record.instruction === '检查内存')).toBe(false)
      expect((wrapper.find('.terminal-command-dialog textarea').element as HTMLTextAreaElement).value).toBe('检查内存')
    } finally {
      ;(window.aiops as any).generateTerminalCommand = originalGenerateTerminalCommand
    }

    vi.mocked(window.aiops.generateTerminalCommand).mockRejectedValueOnce(new Error('terminal command backend rejected'))
    await wrapper.find('.terminal-command-dialog textarea').setValue('检查 CPU')
    await wrapper.find('.terminal-command-dialog textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.terminal-command-dialog p').text()).toBe('命令生成失败')
    expect(store.topNotice).toBe('terminal command backend rejected')
    expect(store.terminalCommandGenerationRecords.some((record) => record.instruction === '检查 CPU')).toBe(false)
    expect((wrapper.find('.terminal-command-dialog textarea').element as HTMLTextAreaElement).value).toBe('检查 CPU')

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
    vi.mocked(window.aiops.writeTerminal).mockClear()
    vi.mocked(navigator.clipboard.readText).mockRejectedValueOnce(new Error('clipboard read denied'))
    await wrapper.find('.xterm-host').trigger('contextmenu')
    await flushPromises()
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()
    expect(store.topNotice).toBe('clipboard read denied')
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(false)

    const originalReadText = navigator.clipboard.readText
    ;(navigator.clipboard as any).readText = undefined
    try {
      await wrapper.find('.xterm-host').trigger('contextmenu')
      await flushPromises()
      expect(window.aiops.writeTerminal).not.toHaveBeenCalled()
      expect(store.topNotice).toBe('终端剪贴板读取服务不可用')
    } finally {
      ;(navigator.clipboard as any).readText = originalReadText
    }

    await expect(store.updateTerminalSettings({ middleMouseEvent: 'contextMenu' })).resolves.toBe(true)
    await wrapper.find('.xterm-host').trigger('mousedown', { button: 1 })
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(true)

    store.createPanel()
    store.appendTerminalOutput(store.activePanelId, 'second terminal output\n')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const activePanelId = store.activePanelId
    await expect(store.updateTerminalSettings({ middleMouseEvent: 'closeTab' })).resolves.toBe(true)
    await wrapper.find('.xterm-host').trigger('mousedown', { button: 1 })
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
      expect(wrapper.find('.files-workspace-tabs').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('主机管理')
      expect(wrapper.text()).not.toContain('密钥管理')
      expect(wrapper.find('.files-transfer-layout').exists()).toBe(true)
      expect(wrapper.text()).toContain('新增连接 或 左侧拖拽至此')
      expect(store.fileTransferTasks).toEqual([])
      expect(wrapper.find('.transfer-progress-panel').exists()).toBe(false)
      expect(store.selectedRightFileSessionId).toBe('local')
      expect(wrapper.findAll('.files-session-header button[title="关闭连接"]').length).toBe(0)

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
      await rightEmptyDrop.trigger('dragenter')
      await rightEmptyDrop.trigger('dragover', { dataTransfer: { dropEffect: '' } })
      expect(rightEmptyDrop.classes()).toContain('active')
      await rightEmptyDrop.trigger('dragleave', { relatedTarget: null })
      expect(rightEmptyDrop.classes()).not.toContain('active')
      await rightEmptyDrop.trigger('dragenter')
      await rightEmptyDrop.trigger('drop', {
        dataTransfer: {
          getData: vi.fn((type: string) => (type === 'application/x-asset-sftp' ? JSON.stringify(sftpPayload) : ''))
        }
      })
      expect(rightEmptyDrop.classes()).not.toContain('active')
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
      expect(wrapper.find('.add-conn-list button.keyboard-selected').text()).toContain('staging-api')
      await wrapper.find('.add-conn-search input').trigger('keydown', { key: 'Enter' })
      expect(store.selectedRightFileSessionId).toBe('asset-2')
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
          getData: vi.fn((type: string) => dragPayload.get(type) || (type === 'text/plain' ? `synchro-fs-item:${dragPayload.get('application/x-synchro-fs-item') || ''}` : ''))
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
        { kind: 'upload-file', localPath: '/release-note.md', remoteDirectory: '/home/deploy/boot' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/release-note.md' && task.target === '/home/deploy/boot/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'release-note.md',
          fromHost: '127.0.0.1',
          toHost: '10.24.12.44',
          status: 'success'
        })
      )

      await sourceRow.trigger('dragstart', {
        dataTransfer: {
          effectAllowed: '',
          setData: vi.fn((type: string, value: string) => dragPayload.set(type, value))
        }
      })
      await rightBrowser.find('.file-drop-zone').trigger('drop', {
        dataTransfer: {
          getData: vi.fn((type: string) => dragPayload.get(type) || '')
        }
      })
      await flushPromises()
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-file', localPath: '/release-note.md', remoteDirectory: '/home/deploy' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/release-note.md' && task.target === '/home/deploy/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'release-note.md',
          toHost: '10.24.12.44',
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
          fromUuid: 'asset-2',
          fromSide: 'right',
          srcPath: '/home/deploy/boot',
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
        { kind: 'download-directory', remotePath: '/home/deploy/boot', localDirectory: '/' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2', host: '10.24.12.44', fromHost: '10.24.12.44', toHost: '127.0.0.1' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/home/deploy/boot' && task.target === '/boot')).toEqual(
        expect.objectContaining({
          type: 'download',
          name: 'boot',
          isGroup: true,
          fromHost: '10.24.12.44',
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
        { kind: 'upload-path', localPath: '/tmp/os-drop.log', remoteDirectory: '/home/deploy' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/os-drop.log' && task.target === '/home/deploy/os-drop.log')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'os-drop.log',
          toHost: '10.24.12.44',
          status: 'success'
        })
      )
      expect(store.fileTransferTasks.some((task) => task.name === 'dropped-item' || task.source === 'drag-source')).toBe(false)

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload.log'] })
      const uploadFileButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传文件')!
      await uploadFileButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile'], defaultPath: '/home/deploy' }))
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-file', localPath: '/tmp/local-upload.log', remoteDirectory: '/home/deploy' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload.log' && task.target === '/home/deploy/local-upload.log')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'local-upload.log',
          toHost: '10.24.12.44',
          status: 'success'
        })
      )

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload-dir'] })
      const uploadDirectoryButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传目录')!
      await uploadDirectoryButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/home/deploy' }))
      expect(window.aiops.transferFileEntry).toHaveBeenCalledWith(
        { kind: 'upload-directory', localPath: '/tmp/local-upload-dir', remoteDirectory: '/home/deploy' },
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2' })
      )
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload-dir' && task.target === '/home/deploy/local-upload-dir')).toEqual(
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
        '/home/deploy/release-note.md',
        expect.objectContaining({ kind: 'remote', sessionId: 'asset-2', host: '10.24.12.44', rootPath: '/home/deploy' })
      )
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
      expect(wrapper.find('[data-testid="files-editor-monaco"]').exists()).toBe(true)
      expect(wrapper.find('.files-editor-toolbar').text()).toContain('编辑文件 /home/deploy/release-note.md')
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
      await wrapper.find('.files-editor-body').setValue('changed remote note')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
      await flushPromises()
      expect(window.aiops.writeFileContent).toHaveBeenCalledWith(
        '/home/deploy/release-note.md',
        'changed remote note',
        expect.objectContaining({
          kind: 'remote',
          sessionId: 'asset-2',
          host: '10.24.12.44',
          rootPath: '/home/deploy',
          expectedAction: 'edit',
          expectedMtimeMs: 1717200000000,
          expectedSize: '/home/deploy/release-note.md'.length + 64
        })
      )
      expect(store.fileTransferTasks.find((task) => task.name === 'save release-note.md' && task.source === '/home/deploy/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'r2r',
          target: '/home/deploy/release-note.md',
          status: 'success',
          speed: '已保存'
        })
      )
      expect((window.aiops as any).recordFileTransferTask).toBeUndefined()
      await wrapper.find('.files-editor-body').setValue('changed remote note again')
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      expect(wrapper.find('.file-modal-card.small').text()).toContain('保存确认')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('取消'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('不保存'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(false)

      const runningTransferTask = store.pushFileTransferTask({
        id: 'backend-running-transfer',
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
            id: 'backend-running-transfer-child',
            type: 'r2r',
            name: 'app.log',
            source: '/tmp/deploy-dir/app.log',
            target: '/srv/deploy-dir/app.log',
            progress: 20,
            speed: 'pending',
            status: 'running'
          }
        ]
      })!
      vi.mocked(window.aiops.cancelFileTransferTask).mockResolvedValueOnce({
        ok: true,
        data: {
          id: runningTransferTask.children![0].id,
          taskIds: [runningTransferTask.id, runningTransferTask.children![0].id],
          status: 'aborted'
        }
      })
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
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pinia = createPinia()
    setActivePinia(pinia)
    try {
      const localSession = await loadTestFileSession('local')
      const wrapper = mount(FileBrowser, {
        props: {
          session: localSession,
          uiMode: 'default'
        },
        global: { plugins: [pinia] }
      })
      const store = useWorkspaceStore()

      await vi.runOnlyPendingTimersAsync()
      await flushPromises()
      expect(wrapper.text()).toContain('.hidden')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-picked'] })
    await wrapper.findAll('.file-icon-button').find((button) => button.attributes('title') === '打开文件夹')!.trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/' }))
    expect((wrapper.find('.file-path-input').element as HTMLInputElement).value).toBe('/tmp/local-picked')
    expect(wrapper.text()).toContain('已打开 /tmp/local-picked')

    await wrapper.findAll('.file-icon-button').find((button) => button.attributes('title') === '隐藏隐藏文件')!.trigger('click')
    expect(wrapper.text()).not.toContain('.hidden')

    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      { name: 'zeta.log', path: '/tmp/local-picked/zeta.log', type: 'file', size: 30, modifiedAt: 1717200003000, mode: '-rw-r--r--' },
      { name: 'alpha.log', path: '/tmp/local-picked/alpha.log', type: 'file', size: 10, modifiedAt: 1717200001000, mode: '-rw-r--r--' },
      { name: 'linked-file', path: '/tmp/local-picked/linked-file', type: 'link', size: 1, modifiedAt: 1717200002000, mode: 'lrwxrwxrwx', linkTarget: '../target.txt' },
      { name: 'subdir', path: '/tmp/local-picked/subdir', type: 'directory', size: 0, modifiedAt: 1717200004000, mode: 'drwxr-xr-x' }
    ])
    await wrapper.findAll('.file-icon-button').find((button) => button.attributes('title') === '刷新')!.trigger('click')
    await flushPromises()
    const rowNames = () => wrapper.findAll('tbody tr').map((row) => row.find('.file-name-cell span').text())
    expect(rowNames()).toEqual(['..', 'subdir', 'linked-file', 'alpha.log', 'zeta.log'])
    await wrapper.findAll('.file-sort-button').find((button) => button.text().includes('大小'))!.trigger('click')
    expect(rowNames()).toEqual(['..', 'subdir', 'linked-file', 'alpha.log', 'zeta.log'])
    await wrapper.findAll('.file-sort-button').find((button) => button.text().includes('大小'))!.trigger('click')
    expect(rowNames()).toEqual(['..', 'subdir', 'linked-file', 'zeta.log', 'alpha.log'])
    const linkedFileRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('linked-file'))!
    expect(linkedFileRow.text()).toContain('-> ../target.txt')
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('linked file is not directory'))
    await linkedFileRow.find('td').trigger('click')
    await flushPromises()
    expect(linkedFileRow.classes()).toContain('selected')
    expect(wrapper.text()).toContain('linked file is not directory')
    expect(wrapper.find('.file-browser-notice').text()).toContain('linked file is not directory')
    expect((wrapper.find('.file-path-input').element as HTMLInputElement).value).toBe('/tmp/local-picked')
    await vi.advanceTimersByTimeAsync(4500)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.file-browser-notice').exists()).toBe(false)
    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      { name: 'parent-entry.md', path: '/tmp/parent-entry.md', type: 'file', size: 3, modifiedAt: 1717200005000, mode: '-rw-r--r--' }
    ])
    await wrapper.findAll('tbody tr').find((row) => row.text().includes('..'))!.find('td').trigger('click')
    await flushPromises()
    expect(window.aiops.listFiles).toHaveBeenLastCalledWith('/tmp', expect.objectContaining({ kind: 'local', sessionId: 'local' }))
    expect((wrapper.find('.file-path-input').element as HTMLInputElement).value).toBe('/tmp')
    await wrapper.find('.file-path-input').setValue('/tmp/local-picked')
    await wrapper.find('.file-path-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()

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
    await renamedRow.find('.file-row-actions button[title="权限"]').trigger('click')
    expect(wrapper.find('.file-modal-card.permission-modal').text()).toContain('权限设置 - release-note-v2.md')
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
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable'))
    const originalExecCommand = document.execCommand
    const failedExecCommandSpy = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: failedExecCommandSpy
    })
    try {
      await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('复制绝对路径'))!.trigger('click')
      await flushPromises()
      expect(failedExecCommandSpy).toHaveBeenCalledWith('copy')
      expect(wrapper.text()).toContain('复制绝对路径失败')
      expect(wrapper.text()).not.toContain('绝对路径已复制')
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: originalExecCommand
        })
      } else {
        Reflect.deleteProperty(document, 'execCommand')
      }
    }
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
    expect((window.aiops as any).recordFileTransferTask).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed on malformed Files backend transfer and mutation success envelopes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()

    const localSessionForMalformedList = await loadTestFileSession('local')
    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      {
        name: 'backend-missing-path.txt',
        type: 'file',
        size: 128,
        modifiedAt: Date.now()
      }
    ] as any)
    const malformedListBrowser = mount(FileBrowser, {
      props: {
        session: localSessionForMalformedList,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    expect(malformedListBrowser.text()).toContain('文件服务返回数据无效')
    expect(malformedListBrowser.text()).not.toContain('backend-missing-path.txt')
    malformedListBrowser.unmount()

    const remoteSession = await loadTestFileSession('asset-2')
    const remoteBrowser = mount(FileBrowser, {
      props: {
        session: remoteSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()

    const remoteListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/backend-missing-task.log'] })
    vi.mocked(window.aiops.transferFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        status: 'success',
        source: '/tmp/backend-missing-task.log',
        target: '/home/deploy/backend-missing-task.log',
        bytes: 128,
        files: 1,
        mtimeMs: Date.now()
      }
    } as any)
    await remoteBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传文件')!.trigger('click')
    await flushPromises()
    expect(remoteBrowser.text()).toContain('文件服务返回数据无效')
    expect(remoteBrowser.text()).not.toContain('backend-missing-task.log 上传成功')
    expect(store.fileTransferTasks.some((task) => task.source === '/tmp/backend-missing-task.log')).toBe(false)
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(remoteListCallsBefore)
    remoteBrowser.unmount()

    const localSession = await loadTestFileSession('local')
    const renameBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const renameRow = renameBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await renameRow.find('.file-row-actions button[title="重命名"]').trigger('click')
    await renameRow.find('.file-rename-row input').setValue('release-note-v2.md')
    const renameListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({ ok: true } as any)
    await renameRow.find('.file-rename-row button[title="确认"]').trigger('click')
    await flushPromises()
    expect(renameBrowser.text()).toContain('文件服务返回数据无效')
    expect(renameBrowser.text()).not.toContain('重命名成功')
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(renameListCallsBefore)
    renameBrowser.unmount()

    const mismatchedRenameBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const mismatchedRenameRow = mismatchedRenameBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await mismatchedRenameRow.find('.file-row-actions button[title="重命名"]').trigger('click')
    await mismatchedRenameRow.find('.file-rename-row input').setValue('release-note-v2.md')
    const mismatchedRenameListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        affected: 1,
        path: '/tmp/local-picked/other-file.md',
        mtimeMs: Date.now()
      }
    } as any)
    await mismatchedRenameRow.find('.file-rename-row button[title="确认"]').trigger('click')
    await flushPromises()
    expect(mismatchedRenameBrowser.text()).toContain('文件服务返回数据无效')
    expect(mismatchedRenameBrowser.text()).not.toContain('重命名成功')
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(mismatchedRenameListCallsBefore)
    mismatchedRenameBrowser.unmount()

    const chmodBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const chmodRow = chmodBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await chmodRow.find('.file-row-actions button[title="权限"]').trigger('click')
    await chmodBrowser.findAll('.permission-check input').find((input) => (input.element as HTMLInputElement).value === '执行')!.setValue(true)
    const chmodListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        affected: 1,
        path: '/release-note.md',
        mode: '744',
        mtimeMs: Date.now(),
        task: {
          id: 'malformed-chmod-task',
          type: 'r2r',
          name: 'chmod release-note.md',
          source: '/release-note.md',
          target: 'permissions',
          progress: 100,
          speed: 'failed',
          status: 'failed'
        }
      }
    } as any)
    await chmodBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(chmodBrowser.text()).toContain('文件服务返回数据无效')
    expect(chmodBrowser.text()).not.toContain('权限已更新为 744')
    expect(store.fileTransferTasks.some((task) => task.id === 'malformed-chmod-task')).toBe(false)
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(chmodListCallsBefore)
    chmodBrowser.unmount()

    const copyBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const copyRow = copyBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await copyRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await copyBrowser.find('.file-more-menu').findAll('button').find((button) => button.text().includes('复制'))!.trigger('click')
    await copyBrowser.find('.move-path-edit-trigger').trigger('click')
    await copyBrowser.find('.move-target-input').setValue('/tmp/local-picked/new-target')
    await copyBrowser.find('.move-target-input').trigger('keydown', { key: 'Enter' })
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        affected: 1,
        path: '/tmp/local-picked/new-target/release-note.md',
        mtimeMs: Date.now(),
        task: {
          id: 'malformed-copy-task',
          type: 'r2r',
          name: 'release-note.md',
          source: '/other/source.md',
          target: '/tmp/local-picked/new-target/release-note.md',
          progress: 100,
          speed: 'done',
          status: 'success'
        }
      }
    } as any)
    await copyBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(copyBrowser.text()).toContain('冲突提示')
    const copyListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    await copyBrowser.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('覆盖'))!.trigger('click')
    await flushPromises()
    expect(copyBrowser.text()).toContain('文件服务返回数据无效')
    expect(copyBrowser.text()).not.toContain('复制成功')
    expect(store.fileTransferTasks.some((task) => task.id === 'malformed-copy-task')).toBe(false)
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(copyListCallsBefore)
    copyBrowser.unmount()

    const moveBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const moveRow = moveBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await moveRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await moveBrowser.find('.file-more-menu').findAll('button').find((button) => button.text().includes('移动'))!.trigger('click')
    await moveBrowser.find('.move-path-edit-trigger').trigger('click')
    await moveBrowser.find('.move-target-input').setValue('/tmp/local-picked/new-target')
    await moveBrowser.find('.move-target-input').trigger('keydown', { key: 'Enter' })
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        affected: 1,
        path: '/tmp/local-picked/new-target/other-target.md',
        mtimeMs: Date.now(),
        task: {
          id: 'malformed-move-task',
          type: 'r2r',
          name: 'release-note.md',
          source: '/tmp/local-picked/release-note.md',
          target: '/tmp/local-picked/new-target/other-target.md',
          progress: 100,
          speed: 'done',
          status: 'success'
        }
      }
    } as any)
    await moveBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(moveBrowser.text()).toContain('冲突提示')
    const moveListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    await moveBrowser.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('覆盖'))!.trigger('click')
    await flushPromises()
    expect(moveBrowser.text()).toContain('文件服务返回数据无效')
    expect(moveBrowser.text()).not.toContain('移动成功')
    expect(store.fileTransferTasks.some((task) => task.id === 'malformed-move-task')).toBe(false)
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(moveListCallsBefore)
    moveBrowser.unmount()

    const deleteBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const deleteRow = deleteBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await deleteRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await deleteBrowser.find('.file-more-menu').findAll('button').find((button) => button.text().includes('删除'))!.trigger('click')
    const deleteListCallsBefore = vi.mocked(window.aiops.listFiles).mock.calls.length
    vi.mocked(window.aiops.mutateFileEntry).mockResolvedValueOnce({
      ok: true,
      data: {
        affected: 1,
        path: '/release-note.md',
        mtimeMs: Date.now()
      }
    } as any)
    await deleteBrowser.find('.file-delete-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(deleteBrowser.text()).toContain('文件服务返回数据无效')
    expect(deleteBrowser.text()).not.toContain('删除成功')
    expect(deleteBrowser.text()).toContain('release-note.md')
    expect(store.fileTransferTasks.some((task) => task.source === '/release-note.md')).toBe(false)
    expect(vi.mocked(window.aiops.listFiles).mock.calls.length).toBe(deleteListCallsBefore)
    deleteBrowser.unmount()
  })

  it('preserves confirmed Files browser rows and paths when directory refresh fails closed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const localSession = await loadTestFileSession('local')
    const browser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await browser.vm.$nextTick()
    const pathInput = () => browser.find('.file-path-input').element as HTMLInputElement

    expect(pathInput().value).toBe('/')
    expect(browser.text()).toContain('release-note.md')

    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('files list backend rejected'))
    await browser.findAll('.file-icon-button').find((button) => button.attributes('title') === '刷新')!.trigger('click')
    await flushPromises()
    expect(browser.text()).toContain('files list backend rejected')
    expect(browser.text()).toContain('release-note.md')
    expect(pathInput().value).toBe('/')

    const bootRow = browser.findAll('tbody tr').find((row) => row.text().includes('boot'))!
    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      {
        name: 'bad-entry-without-path',
        type: 'file',
        size: 1,
        modifiedAt: Date.now()
      }
    ] as any)
    await bootRow.find('.file-name-cell').trigger('click')
    await flushPromises()
    expect(browser.text()).toContain('文件服务返回数据无效')
    expect(browser.text()).toContain('release-note.md')
    expect(browser.text()).toContain('boot')
    expect(browser.text()).not.toContain('bad-entry-without-path')
    expect(pathInput().value).toBe('/')

    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      { name: 'linked-dir', path: '/linked-dir', type: 'link', size: 0, modifiedAt: Date.now(), mode: 'lrwxrwxrwx' },
      { name: 'release-note.md', path: '/release-note.md', type: 'file', size: 2048, modifiedAt: Date.now(), mode: '-rw-r--r--' }
    ])
    await browser.findAll('.file-icon-button').find((button) => button.attributes('title') === '刷新')!.trigger('click')
    await flushPromises()
    const linkedDirRow = browser.findAll('tbody tr').find((row) => row.text().includes('linked-dir'))!
    expect(linkedDirRow.attributes('draggable')).toBe('false')
    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      { name: 'inside-link.md', path: '/linked-dir/inside-link.md', type: 'file', size: 12, modifiedAt: Date.now(), mode: '-rw-r--r--' }
    ])
    await linkedDirRow.find('td').trigger('click')
    await flushPromises()
    expect(window.aiops.listFiles).toHaveBeenCalledWith('/linked-dir', expect.objectContaining({ kind: 'local', sessionId: 'local' }))
    expect(pathInput().value).toBe('/linked-dir')
    expect(browser.text()).toContain('inside-link.md')
    await browser.find('.file-path-input').setValue('/')
    await browser.find('.file-path-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(pathInput().value).toBe('/')

    await browser.find('.file-path-input').setValue('/tmp/local-picked')
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('manual path list failed'))
    await browser.find('.file-path-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(browser.text()).toContain('manual path list failed')
    expect(browser.text()).toContain('release-note.md')
    expect(pathInput().value).toBe('/')

    const releaseRow = browser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await releaseRow.find('.file-row-actions button[title="重命名"]').trigger('click')
    await releaseRow.find('.file-rename-row input').setValue('release-note-v2.md')
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('post-rename list failed'))
    await releaseRow.find('.file-rename-row button[title="确认"]').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'rename', oldPath: '/release-note.md', newPath: '/release-note-v2.md' },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(browser.text()).toContain('post-rename list failed')
    expect(browser.text()).not.toContain('重命名成功')
    expect(browser.find('.file-rename-row input').exists()).toBe(true)
    expect((browser.find('.file-rename-row input').element as HTMLInputElement).value).toBe('release-note-v2.md')
    expect(pathInput().value).toBe('/')

    browser.unmount()

    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    const chmodBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const chmodRow = chmodBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await chmodRow.find('.file-row-actions button[title="权限"]').trigger('click')
    await chmodBrowser.findAll('.permission-check input').find((input) => (input.element as HTMLInputElement).value === '执行')!.setValue(true)
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('post-chmod list failed'))
    await chmodBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(chmodBrowser.text()).toContain('post-chmod list failed')
    expect(chmodBrowser.text()).not.toContain('权限已更新为 744')
    expect(chmodBrowser.find('.file-modal-card.permission-modal').text()).toContain('权限设置 - release-note.md')
    expect(chmodBrowser.text()).toContain('release-note.md')
    chmodBrowser.unmount()

    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    const moveBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const moveRow = moveBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await moveRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await moveBrowser.find('.file-more-menu').findAll('button').find((button) => button.text().includes('移动'))!.trigger('click')
    await moveBrowser.find('.move-path-edit-trigger').trigger('click')
    await moveBrowser.find('.move-target-input').setValue('/tmp/move-target')
    await moveBrowser.find('.move-target-input').trigger('keydown', { key: 'Enter' })
    const moveMutationCallsBeforeTargetFailure = vi.mocked(window.aiops.mutateFileEntry).mock.calls.length
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('move target list failed'))
    await moveBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(moveBrowser.text()).toContain('move target list failed')
    expect(moveBrowser.text()).not.toContain('移动成功')
    expect(moveBrowser.find('.file-modal-card').text()).toContain('移动到')
    expect(vi.mocked(window.aiops.mutateFileEntry).mock.calls.length).toBe(moveMutationCallsBeforeTargetFailure)
    await moveBrowser.find('.move-path-edit-trigger').trigger('click')
    await moveBrowser.find('.move-target-input').setValue('/')
    await moveBrowser.find('.move-target-input').trigger('keydown', { key: 'Enter' })
    await moveBrowser.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect(moveBrowser.text()).toContain('冲突提示')
    vi.mocked(window.aiops.listFiles).mockRejectedValueOnce(new Error('post-move list failed'))
    await moveBrowser.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('覆盖'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.mutateFileEntry).toHaveBeenCalledWith(
      { kind: 'move', srcPath: '/release-note.md', targetPath: '/release-note.md', overwrite: true },
      expect.objectContaining({ kind: 'local', sessionId: 'local' })
    )
    expect(moveBrowser.text()).toContain('post-move list failed')
    expect(moveBrowser.text()).not.toContain('移动成功')
    expect(moveBrowser.find('.file-modal-card').text()).toContain('移动到')
    expect(moveBrowser.text()).toContain('release-note.md')
    moveBrowser.unmount()

    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    const deleteBrowser = mount(FileBrowser, {
      props: {
        session: localSession,
        uiMode: 'default'
      },
      global: { plugins: [pinia] }
    })
    await flushPromises()
    const deleteRow = deleteBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await deleteRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await deleteBrowser.find('.file-more-menu').findAll('button').find((button) => button.text().includes('删除'))!.trigger('click')
    vi.mocked(window.aiops.listFiles).mockResolvedValueOnce([
      {
        name: 'bad-refresh-entry-without-path',
        type: 'file',
        size: 1,
        modifiedAt: Date.now()
      }
    ] as any)
    await deleteBrowser.find('.file-delete-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(deleteBrowser.text()).toContain('文件服务返回数据无效')
    expect(deleteBrowser.text()).not.toContain('删除成功')
    expect(deleteBrowser.find('.file-delete-confirm').text()).toContain('/release-note.md')
    expect(deleteBrowser.text()).toContain('release-note.md')
    expect(deleteBrowser.text()).not.toContain('bad-refresh-entry-without-path')
    deleteBrowser.unmount()
  })

  it('keeps Files editor dirty when save succeeds without a backend-owned task', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(FilesWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await waitForSelector(wrapper, 'tbody tr')

    const fileRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await fileRow.trigger('dblclick')
    await flushPromises()
    expect(wrapper.find('.files-floating-editor').exists()).toBe(true)

    await wrapper.find('.files-editor-body').setValue('changed without backend task')
    vi.mocked(window.aiops.writeFileContent).mockResolvedValueOnce({
      ok: true,
      data: {
        size: 28,
        mtimeMs: Date.now()
      }
    } as any)
    const tasksBefore = store.fileTransferTasks.length
    await wrapper.find('.files-editor-toolbar .primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('文件服务返回数据无效')
    expect(store.fileTransferTasks).toHaveLength(tasksBefore)
    await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
    expect(wrapper.find('.file-modal-card.small').text()).toContain('保存确认')
  })

  it('keeps Files editor dirty when the backend rejects a stale save', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(FilesWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await waitForSelector(wrapper, 'tbody tr')

    const fileRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
    await fileRow.trigger('dblclick')
    await flushPromises()
    expect(wrapper.find('.files-floating-editor').exists()).toBe(true)

    await wrapper.find('.files-editor-body').setValue('stale editor content')
    vi.mocked(window.aiops.writeFileContent).mockResolvedValueOnce({
      ok: false,
      errorCode: 'conflict',
      errorMessage: 'File changed on disk. Reload before saving.'
    })
    const tasksBefore = store.fileTransferTasks.length
    await wrapper.find('.files-editor-toolbar .primary').trigger('click')
    await flushPromises()

    expect(window.aiops.writeFileContent).toHaveBeenCalledWith(
      '/release-note.md',
      'stale editor content',
      expect.objectContaining({
        kind: 'local',
        sessionId: 'local',
        expectedAction: 'edit',
        expectedMtimeMs: 1717200000000,
        expectedSize: '/release-note.md'.length + 64
      })
    )
    expect(wrapper.text()).toContain('File changed on disk. Reload before saving.')
    expect(store.fileTransferTasks).toHaveLength(tasksBefore)
    await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
    expect(wrapper.find('.file-modal-card.small').text()).toContain('保存确认')
  })

  it('fails closed when Files editor read succeeds with malformed backend data', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(FilesWorkspace, {
      global: { plugins: [pinia] }
    })
    await waitForSelector(wrapper, 'tbody tr')

    vi.mocked(window.aiops.readFileContent).mockResolvedValueOnce({
      ok: true,
      data: {
        action: 'edit',
        size: 28,
        mtimeMs: Date.now()
      }
    } as any)
    wrapper.findComponent(TransferSide).vm.$emit('openFile', {
      filePath: '/release-note.md',
      sessionId: 'local',
      sessionLabel: 'Local',
      host: '127.0.0.1'
    })
    await flushPromises()
    expect(window.aiops.readFileContent).toHaveBeenCalledWith('/release-note.md', expect.objectContaining({ kind: 'local', sessionId: 'local' }))
    expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
    await vi.mocked(window.aiops.readFileContent).mock.results.at(-1)?.value
    await flushPromises()
    await waitForText(wrapper, '文件服务返回数据无效')
    expect((wrapper.find('.files-editor-body').element as HTMLTextAreaElement).value).toBe('')
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
      const remoteSession = await loadTestFileSession('asset-2')
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

    await wrapper.find('button[title="新建快捷命令"]').trigger('click')
    expect(wrapper.text()).toContain('新建快捷命令')
    expect(wrapper.text()).toContain('脚本语法说明')
    await wrapper.find('.snippet-edit-panel footer').findAll('button')[1].trigger('click')
    expect(wrapper.text()).toContain('请输入快捷命令名称')
    await wrapper.find('.script-help .help-header').trigger('click')
    await wrapper.find('.copy-example').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('sleep==2000'))
    expect(wrapper.find('.copy-example').text()).toBe('已复制')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable'))
    const originalExecCommand = document.execCommand
    const execCommandSpy = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy
    })
    try {
      await wrapper.find('.copy-example').trigger('click')
      await flushPromises()
      expect(execCommandSpy).toHaveBeenCalledWith('copy')
      expect(wrapper.find('.copy-example').text()).toBe('已复制')
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: originalExecCommand
        })
      } else {
        Reflect.deleteProperty(document, 'execCommand')
      }
    }
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable again'))
    const originalExecCommandForFailure = document.execCommand
    const failedExecCommandSpy = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: failedExecCommandSpy
    })
    try {
      await wrapper.find('.copy-example').trigger('click')
      await flushPromises()
      expect(failedExecCommandSpy).toHaveBeenCalledWith('copy')
      expect(wrapper.find('.copy-example').text()).toBe('复制')
      expect(store.topNotice).toBe('示例脚本复制失败')
    } finally {
      if (originalExecCommandForFailure) {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: originalExecCommandForFailure
        })
      } else {
        Reflect.deleteProperty(document, 'execCommand')
      }
    }
    await wrapper.find('.snippet-edit-panel input').setValue('新片段')
    await wrapper.find('.script-editor-container textarea').setValue('pwd\nsleep==1000\nctrl+c')
    await wrapper.find('.snippet-edit-panel footer').findAll('button')[1].trigger('click')
    await flushPromises()
    expect(store.quickCommands.some((command) => command.snippet_name === '新片段')).toBe(true)
    expect(store.topNotice).toBe('快捷命令已保存。')
    expect((window.aiops as any).saveQuickCommands).toBeUndefined()

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
    expect(store.topNotice).toBe('宏录制已保存为快捷命令。')
    expect(window.aiops.saveQuickCommandMacro).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ command: 'uptime' })]
      })
    )

    await wrapper.find('button[title="宏录制"]').trigger('click')
    store.recordMacroTerminalInput(store.activePanelId, 'date')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('date')
    await wrapper.findAll('.recording-status-bar button').find((button) => button.text().includes('停止录制'))!.trigger('click')
    await flushPromises()
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-'))).toBe(true)
  })

  it('keeps the quick command edit panel open when the backend save result is malformed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SnippetsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await flushPromises()
    await wrapper.vm.$nextTick()

    const beforeCount = store.quickCommands.length
    vi.mocked(window.aiops.saveQuickCommandSnippet).mockResolvedValueOnce({
      ok: true,
      data: {
        groups: store.snippetGroups.map((item) => ({ ...item })),
        snippets: [
          ...store.quickCommands.map((item) => ({ ...item })),
          {
            id: 999,
            uuid: 'detached-panel-save',
            snippet_name: '失败片段',
            snippet_content: 'echo failed',
            group_uuid: null
          }
        ]
      }
    } as any)

    await wrapper.find('button[title="新建快捷命令"]').trigger('click')
    await wrapper.find('.snippet-edit-panel input').setValue('失败片段')
    await wrapper.find('.script-editor-container textarea').setValue('echo failed')
    await wrapper.find('.snippet-edit-panel footer').findAll('button')[1].trigger('click')
    await flushPromises()

    expect(store.topNotice).toBe('快捷命令服务返回数据无效')
    expect(store.quickCommands).toHaveLength(beforeCount)
    expect(store.quickCommands.some((command) => command.snippet_name === '失败片段')).toBe(false)
    expect(wrapper.find('.snippet-edit-panel').exists()).toBe(true)
    expect((wrapper.find('.snippet-edit-panel input').element as HTMLInputElement).value).toBe('失败片段')
    expect((wrapper.find('.script-editor-container textarea').element as HTMLTextAreaElement).value).toBe('echo failed')
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
    expect(window.aiops.saveQuickCommandMacro).toHaveBeenCalledWith(
      expect.objectContaining({
        sleepThresholdMs: 400,
        entries: [
          expect.objectContaining({ command: 'uptime', timestamp: 1000 }),
          expect.objectContaining({ command: 'up', timestamp: 1600 }),
          expect.objectContaining({ command: 'whoami', timestamp: 1650 })
        ]
      })
    )

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

    vi.mocked(window.aiops.kbMove).mockClear()
    const dragMarkdownTransfer = createTestDataTransfer()
    const markdownDragNode = wrapper.findAll('.kb-tree-node').find((node) => node.text().includes('Markdown语法指南.md'))!
    const commandsDropNode = wrapper.findAll('.kb-tree-node').find((node) => node.text().includes('commands'))!
    await markdownDragNode.trigger('dragstart', { dataTransfer: dragMarkdownTransfer })
    await commandsDropNode.trigger('dragover', { dataTransfer: dragMarkdownTransfer })
    expect(commandsDropNode.classes()).toContain('drag-over')
    await commandsDropNode.trigger('drop', { dataTransfer: dragMarkdownTransfer })
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.kbMove).toHaveBeenCalledWith('Markdown语法指南.md', 'commands')
    expect(store.findKnowledgeNode('commands/Markdown语法指南.md')).toBeTruthy()

    await commandsDropNode.trigger('contextmenu')
    expect(wrapper.find('.kb-context-menu').text()).toContain('上传文件')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.kb-context-menu').exists()).toBe(false)
    vi.mocked(window.aiops.kbCheckPath).mockClear()
    vi.mocked(window.aiops.kbImportFile).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/commands-upload.md'] })
    await commandsDropNode.trigger('contextmenu')
    await wrapper.find('.kb-context-menu').findAll('button').find((button) => button.text().includes('上传文件'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(window.aiops.kbCheckPath).toHaveBeenCalledWith('/tmp/commands-upload.md')
    expect(window.aiops.kbImportFile).toHaveBeenCalledWith('/tmp/commands-upload.md', 'commands')
    expect(wrapper.find('.kb-context-menu').exists()).toBe(false)

    const markdownNode = wrapper.findAll('.kb-tree-node').find((node) => node.text().includes('Markdown语法指南.md'))!
    await markdownNode.trigger('contextmenu')
    expect(wrapper.find('.kb-context-menu').exists()).toBe(true)
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await wrapper.find('.kb-context-menu').findAll('button').find((button) => button.text().includes('复制路径'))!.trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('commands/Markdown语法指南.md')
    expect(store.topNotice).toBe('知识库路径已复制')

    await markdownNode.trigger('contextmenu')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable'))
    const originalExecCommand = document.execCommand
    const failedExecCommandSpy = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: failedExecCommandSpy
    })
    try {
      await wrapper.find('.kb-context-menu').findAll('button').find((button) => button.text().includes('复制路径'))!.trigger('click')
      await flushPromises()
      expect(failedExecCommandSpy).toHaveBeenCalledWith('copy')
      expect(store.topNotice).toBe('知识库路径复制失败')
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: originalExecCommand
        })
      } else {
        Reflect.deleteProperty(document, 'execCommand')
      }
    }

    await wrapper.find('.kb-capacity-detail-link').trigger('click')
    expect(wrapper.text()).toContain('容量来源明细')
    await wrapper.find('.file-modal-card header button').trigger('click')

    store.kbSelectedKeys = []
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

    vi.mocked(window.aiops.kbCheckPath).mockClear()
    vi.mocked(window.aiops.kbImportFile).mockClear()
    vi.mocked(window.aiops.kbImportFolder).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/malformed-path.md'] })
    vi.mocked(window.aiops.kbCheckPath).mockResolvedValueOnce({ exists: true, isDirectory: false } as any)
    await wrapper.find('.kb-add-button').trigger('click')
    await wrapper.find('.kb-add-menu').findAll('button').find((button) => button.text().includes('上传文件'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('知识库服务返回数据无效')
    expect(window.aiops.kbImportFile).not.toHaveBeenCalled()
    expect(window.aiops.kbImportFolder).not.toHaveBeenCalled()

    vi.mocked(window.aiops.kbCheckPath).mockClear()
    vi.mocked(window.aiops.kbImportFile).mockClear()
    vi.mocked(window.aiops.kbImportFolder).mockClear()
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/ambiguous-path.md'] })
    vi.mocked(window.aiops.kbCheckPath).mockResolvedValueOnce({ exists: true, isDirectory: true, isFile: true } as any)
    await wrapper.find('.kb-add-button').trigger('click')
    await wrapper.find('.kb-add-menu').findAll('button').find((button) => button.text().includes('上传文件'))!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(store.topNotice).toBe('知识库服务返回数据无效')
    expect(window.aiops.kbImportFile).not.toHaveBeenCalled()
    expect(window.aiops.kbImportFolder).not.toHaveBeenCalled()

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
    vi.useFakeTimers()
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
    const activeMarkdownTextarea = workspace.find('.kb-editor-textarea')
    expect((activeMarkdownTextarea.element as HTMLTextAreaElement).value).toBe('content:Markdown语法指南.md')
    await activeMarkdownTextarea.setValue(markdownContent)
    await workspace.findAll('.kb-editor-mode button').find((button) => button.text().includes('渲染'))!.trigger('click')
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

    await workspace.findAll('.kb-editor-mode button').find((button) => button.text().includes('源码'))!.trigger('click')
    await workspace.vm.$nextTick()
    const editedTextarea = workspace.find('.kb-editor-textarea')
    await editedTextarea.setValue('updated markdown')
    vi.advanceTimersByTime(900)
    await flushPromises()
    expect(window.aiops.kbWriteFile).toHaveBeenCalledWith('Markdown语法指南.md', 'updated markdown')
    vi.useRealTimers()

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

    await enableCatalogModelOptions(store)
    const aiPanel = mount(AiPanel, {
      global: { plugins: [pinia] }
    })
    await flushPromises()
    await aiPanel.vm.$nextTick()
    await switchAiPanelToClassic(aiPanel)
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
    expect(aiPanel.findAll('.input-context-row .context-tag').some((tag) => tag.text().includes('interface.png'))).toBe(true)
    expect(aiPanel.find('.chat-editable .mention-chip-images').exists()).toBe(false)

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

  it('fails closed on malformed Knowledge editor read, save, and image paste results', async () => {
    const malformedMessage = '知识库服务返回数据无效'
    const originalAiops = {
      kbReadFile: window.aiops.kbReadFile,
      kbWriteFile: window.aiops.kbWriteFile,
      kbPasteImageFromClipboard: window.aiops.kbPasteImageFromClipboard
    }

    const mountEditor = async (props: { relPath: string; isImage?: boolean }) => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const wrapper = mount(KnowledgeCenterEditor, {
        attachTo: document.body,
        props,
        global: {
          plugins: [pinia],
          stubs: {
            KnowledgeMonacoEditor: {
              props: ['modelValue'],
              emits: ['update:modelValue', 'save'],
              template:
                '<textarea class="kb-editor-textarea" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown.ctrl.s.prevent="$emit(\'save\')" />'
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
      vi.mocked(window.aiops.kbReadFile).mockResolvedValueOnce({ content: 42, mtimeMs: 1717200000000 } as any)
      const malformedTextRead = await mountEditor({ relPath: 'runbooks/broken.md' })
      expect(malformedTextRead.text()).toContain(malformedMessage)
      expect(malformedTextRead.find('.kb-editor-textarea').exists()).toBe(false)
      malformedTextRead.unmount()

      vi.mocked(window.aiops.kbReadFile).mockResolvedValueOnce({ content: '', mtimeMs: 1717200000000, mimeType: 'image/png', isImage: true } as any)
      const malformedImageRead = await mountEditor({ relPath: 'images/broken.png', isImage: true })
      expect(malformedImageRead.text()).toContain(malformedMessage)
      expect(malformedImageRead.find('.kb-editor-image img').exists()).toBe(false)
      malformedImageRead.unmount()

      const malformedSave = await mountEditor({ relPath: 'runbooks/save.md' })
      vi.useFakeTimers()
      await malformedSave.find('.kb-editor-textarea').setValue('dirty backend-only content')
      await malformedSave.vm.$nextTick()
      expect(malformedSave.text()).toContain('unsaved')
      vi.mocked(window.aiops.kbWriteFile).mockResolvedValueOnce({ mtimeMs: Number.NaN } as any)
      vi.advanceTimersByTime(900)
      await flushPromises()
      await malformedSave.vm.$nextTick()
      vi.useRealTimers()
      expect(malformedSave.text()).toContain(malformedMessage)
      expect(malformedSave.text()).toContain('unsaved')
      malformedSave.unmount()

      const malformedPaste = await mountEditor({ relPath: 'runbooks/paste.md' })
      vi.mocked(window.aiops.kbPasteImageFromClipboard).mockResolvedValueOnce({
        relPath: 'runbooks/pasted.png',
        fileName: '',
        dataUrl: 'data:image/png;base64,cGFzdGU=',
        mimeType: 'image/png',
        size: 12,
        mtimeMs: 1717200000000
      } as any)
      vi.mocked(window.aiops.kbWriteFile).mockClear()
      const pasteEvent = createImagePasteEvent()
      malformedPaste.find('.kb-editor-root').element.dispatchEvent(pasteEvent)
      await flushPromises()
      await malformedPaste.vm.$nextTick()
      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(malformedPaste.text()).toContain(malformedMessage)
      expect(malformedPaste.text()).not.toContain('pasted-image')
      expect(window.aiops.kbWriteFile).not.toHaveBeenCalled()
      malformedPaste.unmount()
    } finally {
      Object.assign(window.aiops, originalAiops)
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
    expect(panel.text()).not.toContain('Store')
    expect(panel.text()).not.toContain('Private')
    expect(panel.find('button[title="安装"]').exists()).toBe(false)
    expect(panel.find('button[title="订阅"]').exists()).toBe(false)

    ;(globalThis as any).__loadExtensionPluginStoreFixtureMock?.()
    await store.refreshExtensionPlugins()
    await panel.vm.$nextTick()

    expect(panel.text()).toContain('Store')
    expect(panel.text()).toContain('Private')
    expect(panel.find('button[title="安装"]').exists()).toBe(true)
    expect(panel.find('button[title="订阅"]').exists()).toBe(true)
    expect(panel.find('button[title="更新"]').exists()).toBe(false)

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
    expect(window.aiops.installExtensionPackage).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'local-tools.external-reference',
      filePath: '/tmp/local-tools.external-reference',
      size: 4096,
      existingPluginIds: expect.arrayContaining(['jumpserverSupport', 'Alias', 'cloud-assets'])
    }))
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
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Jumpserver Support')
    expect(workspace.text()).toContain('同步资产并确认主机分组')
    expect(window.aiops.listAssets).toHaveBeenCalled()
    expect(workspace.text()).toContain('资产同步状态')
    expect(workspace.text()).toContain('Jumpserver 数据源')
    expect(workspace.text()).toContain('已同步主机')
    expect(workspace.text()).toContain('jumpserver-org')
    expect(workspace.text()).not.toContain('prod-bastion')
    expect(workspace.text()).not.toContain('connected to bastion host')
    expect(workspace.find('.connection_log_terminal').exists()).toBe(false)
    expect(workspace.find('.mock_terminal').exists()).toBe(false)
    const wrongOrganizationAssets = await window.aiops.listAssets()
    vi.mocked(window.aiops.refreshOrganizationAssets).mockClear()
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: {
        ...wrongOrganizationAssets,
        organizationId: 'other-org',
        refreshed: 1,
        created: 1,
        updated: 0
      }
    } as any)
    await workspace.findAll('.jumpserver_asset_actions button').find((button) => button.text().includes('刷新组织资产'))!.trigger('click')
    await flushPromises()
    expect(window.aiops.refreshOrganizationAssets).toHaveBeenCalledWith({ organizationId: 'asset-5' })
    expect(workspace.text()).toContain('资产服务返回数据无效')
    expect(workspace.text()).not.toContain('jumpserver-org-synced-asset')
    vi.mocked(window.aiops.refreshOrganizationAssets).mockResolvedValueOnce({
      ok: true,
      data: await buildNonJumpserverOrganizationRefreshData()
    } as any)
    await workspace.findAll('.jumpserver_asset_actions button').find((button) => button.text().includes('刷新组织资产'))!.trigger('click')
    await flushPromises()
    expect(workspace.text()).toContain('资产服务返回数据无效')
    expect(workspace.text()).toContain('jumpserver-org')
    expect(workspace.text()).not.toContain('not-jumpserver-org')
    expect(workspace.text()).not.toContain('jumpserver-org-synced-asset')
    await workspace.findAll('.jumpserver_asset_actions button').find((button) => button.text().includes('刷新组织资产'))!.trigger('click')
    await flushPromises()
    expect(workspace.text()).toContain('jumpserver-org-synced-asset')
    await workspace.findAll('.jumpserver_asset_actions button').find((button) => button.text().includes('打开资产管理'))!.trigger('click')
    expect(store.activeModule).toBe('assets')
    expect(store.assetManagementOpenRequest.organizationId).toBe('asset-5')

    store.selectExtension('ops-runbook')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Ops Runbook')
    expect(workspace.text()).toContain('插件功能')
    expect(workspace.text()).toContain('插件标识')
    expect(workspace.text()).toContain('最后更新')
    expect(workspace.text()).toContain('插件分类')
    expect(workspace.text()).toContain('Runbook')
    expect(workspace.text()).toContain('安装')
    expect(workspace.findAll('button').map((button) => button.text())).toContain('安装')
    expect(workspace.findAll('button').map((button) => button.text())).not.toContain('卸载')
    expect(workspace.findAll('button').map((button) => button.text())).not.toContain('更新')

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

    store.selectExtension('cloud-assets')
    await store.installExtensionPlugin('cloud-assets')
    await workspace.vm.$nextTick()
    expect(window.aiops.installExtensionPlugin).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ pluginId: 'cloud-assets', installed: false, latestVersion: '0.9.1' })
    })
    expect(store.extensionInstallLoadingMap['cloud-assets']).toBeUndefined()
    expect(store.extensionInstallProgressMap['cloud-assets']?.stage).toBe('error')
    expect(store.extensionPlugins.find((plugin) => plugin.pluginId === 'cloud-assets')?.installed).toBe(false)
    expect(store.extensionNotice).toContain('requires a real .external-reference package')
    expect(workspace.text()).toContain('Error')
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
      store.requestDeleteK8sCluster('k8s-1')
      await workspace.vm.$nextTick()
      await panel.vm.$nextTick()
      expect(panel.findAll('.k8s-delete-confirm')).toHaveLength(0)
      expect(workspace.findAll('.k8s-delete-confirm')).toHaveLength(1)
      store.cancelDeleteK8sCluster()
      await workspace.vm.$nextTick()

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
    expect(window.aiops.writeKubernetesTerminal).toHaveBeenCalledWith(expect.stringMatching(/^k8s-session-test-/), 'kubectl get pods -A\n')
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl get pods -A')
    await workspace.vm.$nextTick()
    expect(workspace.find('.k8s-terminal-history').text()).toContain('kubectl get pods -A')
    const firstTerminalId = store.k8sActiveTerminal!.id
    await workspace.find('.k8s-terminal-tabs .k8s-workspace-button').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(store.k8sActiveTerminal?.id).not.toBe(firstTerminalId)
    expect(store.k8sTerminalTabs.filter((tab) => tab.clusterId === 'k8s-1')).toHaveLength(2)
    vi.mocked(window.aiops.writeKubernetesTerminal).mockClear()
    const chatCountBeforeBlankAiCommand = store.chatMessages.length
    await workspace.find('.k8s-terminal-meta button[title="采集命令输出到 AI"]').trigger('click')
    await flushPromises()
    expect(window.aiops.writeKubernetesTerminal).not.toHaveBeenCalled()
    expect(store.chatMessages).toHaveLength(chatCountBeforeBlankAiCommand)
    expect(store.k8sActiveTerminal?.collectingAiOutput).toBe(false)
    expect(store.k8sClusterNotice).toBe('当前没有可采集到 AI 的 kubectl 命令')
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
    await flushPromises()
    expect(window.aiops.executeKubernetesResourceAction).toHaveBeenCalledWith({ resourceId: 'k8s-pod-worker-1', action: 'describe' })
    expect(store.k8sResourceOutput).toContain('kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    await billingRow.find('button[title="Logs"]').trigger('click')
    await flushPromises()
    expect(window.aiops.executeKubernetesResourceAction).toHaveBeenCalledWith({ resourceId: 'k8s-pod-worker-1', action: 'logs' })
    expect(store.k8sResourceOutput).toContain('kubectl logs billing-worker-7f9d6f9dd9-rx8mm -n ops --tail=120')
    await workspace.find('.k8s-resource-output-actions button[title="复制输出"]').trigger('click')
    await flushPromises()
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
    expect(window.aiops.planKubernetesResourceAction).toHaveBeenCalledWith({ resourceId: 'k8s-pod-worker-1', action: 'describe' })
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
    expect(window.aiops.importKubernetesKubeconfig).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^k8s-kubeconfig-import-/),
      kubeconfigPath: '/tmp/prod-kubeconfig.yaml'
    })
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
    expect(wrapper.findAll('.db-workspace-tab')).toHaveLength(1)
    expect(wrapper.find('.db-workspace-tab').text()).toContain('Overview')
    expect(wrapper.text()).not.toContain('SQL Console')
    expect(wrapper.text()).not.toContain('select id, service, status, owner')
    expect(wrapper.text()).toContain('New Connection')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Create connection')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Explore schemas')
    expect(wrapper.find('.db-overview-hero').text()).toContain('Query console')
    expect(wrapper.find('.db-engine-grid').text()).toContain('MySQL')
    expect(wrapper.find('.db-engine-grid').text()).toContain('SQLServer')
    expect(wrapper.find('.db-engine-grid').text()).toContain('MariaDB')
    expect(wrapper.find('.db-engine-grid').text()).toContain('ClickHouse')
    expect(wrapper.find('.db-engine-grid').text()).toContain('Presto')
    expect(wrapper.find('.db-engine-grid').text()).toContain('OceanBase')
    expect(wrapper.find('.db-engine-grid').text()).toContain('KingBase')
    expect(wrapper.find('.db-engine-grid').text()).not.toContain('H2')
    expect(wrapper.find('.db-engine-grid').text()).not.toContain('Timeplus')
    expect(wrapper.findAll('.db-engine-grid button')).toHaveLength(10)
    expect(wrapper.findAll('.db-engine-grid button').filter((button) => button.classes().includes('disabled'))).toHaveLength(0)
    await wrapper.findAll('.db-overview-tips button').find((button) => button.text().includes('Explore schemas'))!.trigger('click')
    expect(document.activeElement).toBe(wrapper.find('.db-search input').element)
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('SQLServer'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('SQLServer')
    const sqlServerOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((sqlServerOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('1433')
    expect((sqlServerOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:sqlserver://127.0.0.1:1433')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('MariaDB'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('MariaDB')
    const mariaDbOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((mariaDbOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('3306')
    expect((mariaDbOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:mariadb://127.0.0.1:3306')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('ClickHouse'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('ClickHouse')
    const clickHouseOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((clickHouseOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('8123')
    expect((clickHouseOverviewInputs.at(3)!.element as HTMLInputElement).value).toBe('default')
    expect((clickHouseOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('http://127.0.0.1:8123')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('Presto'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('Presto')
    const prestoOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((prestoOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('8080')
    expect((prestoOverviewInputs.at(3)!.element as HTMLInputElement).value).toBe('presto')
    expect((prestoOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('http://127.0.0.1:8080')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('OceanBase'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('OceanBase')
    const oceanBaseOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((oceanBaseOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('2881')
    expect((oceanBaseOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:oceanbase://127.0.0.1:2881')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await wrapper.findAll('.db-engine-grid button').find((button) => button.text().includes('KingBase'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('KingBase')
    expect(wrapper.find('.db-connection-modal').text()).toContain('SSL Mode')
    const kingBaseOverviewInputs = wrapper.findAll('.db-connection-modal input')
    expect((kingBaseOverviewInputs.at(2)!.element as HTMLInputElement).value).toBe('54321')
    expect((kingBaseOverviewInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:kingbase8://127.0.0.1:54321')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
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
    expect(wrapper.find('.db-add-menu').text()).not.toContain('H2')
    expect(wrapper.find('.db-add-menu').text()).toContain('SQLServer')
    expect(wrapper.find('.db-add-menu').text()).toContain('ClickHouse')
    expect(wrapper.find('.db-add-menu').text()).toContain('Presto')
    expect(wrapper.find('.db-add-menu').text()).toContain('OceanBase')
    expect(wrapper.find('.db-add-menu').text()).toContain('KingBase')
    expect(wrapper.find('.db-add-menu').text()).not.toContain('Timeplus')
    expect(wrapper.find('.db-add-menu').findAll('button')).toHaveLength(11)
    expect(wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('ClickHouse'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('Presto'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('OceanBase'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('KingBase'))!.attributes('disabled')).toBeUndefined()
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
    expect((pgModalInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:postgresql://127.0.0.1:5432')
    await pgModalInputs.at(7)!.setValue('jdbc:postgresql://manual-host:15432/manualdb')
    await pgModalInputs.at(1)!.setValue('10.10.10.20')
    expect((wrapper.findAll('.db-connection-modal input').at(7)!.element as HTMLInputElement).value).toBe('jdbc:postgresql://manual-host:15432/manualdb')
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
    await oracleInputs.at(7)!.setValue('jdbc:oracle:thin:@//db.example.test:1521/ORCLPDB1')
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
    expect(wrapper.find('.db-popup-submenu').text()).toContain('MariaDB')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('ClickHouse')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('Presto')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('OceanBase')
    expect(wrapper.find('.db-popup-submenu').text()).toContain('KingBase')
    expect(wrapper.find('.db-popup-submenu').text()).not.toContain('Timeplus')
    expect(wrapper.find('.db-popup-submenu').findAll('button')).toHaveLength(10)
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('SQLServer'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('MariaDB'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('ClickHouse'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Presto'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('OceanBase'))!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('KingBase'))!.attributes('disabled')).toBeUndefined()
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('SQLServer'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('SQLServer')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('MariaDB'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('MariaDB')
    const mariaDbGroupInputs = wrapper.findAll('.db-connection-modal input')
    expect((mariaDbGroupInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:mariadb://127.0.0.1:3306')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('ClickHouse'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('ClickHouse')
    const clickHouseGroupInputs = wrapper.findAll('.db-connection-modal input')
    expect((clickHouseGroupInputs.at(7)!.element as HTMLInputElement).value).toBe('http://127.0.0.1:8123')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Presto'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('Presto')
    const prestoGroupInputs = wrapper.findAll('.db-connection-modal input')
    expect((prestoGroupInputs.at(2)!.element as HTMLInputElement).value).toBe('8080')
    expect((prestoGroupInputs.at(3)!.element as HTMLInputElement).value).toBe('presto')
    expect((prestoGroupInputs.at(7)!.element as HTMLInputElement).value).toBe('http://127.0.0.1:8080')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('OceanBase'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('OceanBase')
    const oceanBaseGroupInputs = wrapper.findAll('.db-connection-modal input')
    expect((oceanBaseGroupInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:oceanbase://127.0.0.1:2881')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('KingBase'))!.trigger('click')
    expect(wrapper.find('.db-connection-modal').text()).toContain('KingBase')
    const kingBaseGroupInputs = wrapper.findAll('.db-connection-modal input')
    expect((kingBaseGroupInputs.at(7)!.element as HTMLInputElement).value).toBe('jdbc:kingbase8://127.0.0.1:54321')
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')
    await defaultGroupRow.trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('New Connection'))!.trigger('mouseenter')
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
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Not saved')
    expect(wrapper.find('button[title="Save"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('button[title="Save As"]').exists()).toBe(true)
    expect(wrapper.find('button[title="Save As"]').attributes('disabled')).toBeUndefined()
    await workbenchEditor.setValue('select id, service from public.orders where status = \'open\' order by updated_at desc limit 5; select * from public.orders where service = \'billing\';')
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Not saved')
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/aiopsterm-sql/query-one.sql' })
    await wrapper.find('button[title="Save As"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(/Query-.*orders.*public\.sql$/),
      filters: [{ name: 'SQL Files', extensions: ['sql'] }]
    })
    expect(window.aiops.writeLocalFile).toHaveBeenCalledWith(
      '/tmp/aiopsterm-sql/query-one.sql',
      "select id, service from public.orders where status = 'open' order by updated_at desc limit 5; select * from public.orders where service = 'billing';"
    )
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Saved: query-one.sql')
    await workbenchEditor.setValue('select id, service from public.orders where status = \'open\' order by updated_at desc limit 10;')
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Unsaved changes')
    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
    await wrapper.find('button[title="Save"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).not.toHaveBeenCalled()
    expect(window.aiops.writeLocalFile).toHaveBeenCalledWith(
      '/tmp/aiopsterm-sql/query-one.sql',
      "select id, service from public.orders where status = 'open' order by updated_at desc limit 10;"
    )
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Saved: query-one.sql')
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('1')
    await workbenchEditor.setValue('select id, service from public.orders where status = \'open\' order by updated_at desc limit 5; select * from public.orders where service = \'billing\';')
    await wrapper.find('button[title="Format"]').trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT\n  id')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('\nFROM\n  public.orders')
    expect(wrapper.find('.db-sql-editor-gutter').text()).toContain('2')
    await workbenchEditor.setValue('select id from public.orders;\nselect * from ops.ops_incidents;')
    const formatEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const formatSelectionEnd = 'select id from public.orders'.length
    formatEditorElement.setSelectionRange(0, formatSelectionEnd)
    await workbenchEditor.trigger('select')
    expect(wrapper.find('.db-sql-editor-footer').text()).toContain(`${formatSelectionEnd} selected`)
    await wrapper.find('button[title="Format"]').trigger('click')
    await flushPromises()
    const selectionFormattedSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(selectionFormattedSql).toContain('SELECT\n  id')
    expect(selectionFormattedSql).toContain('select * from ops.ops_incidents;')
    await wrapper.find('button[title="Run all"]').trigger('click')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-tabs').text()).toContain('#1-1')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-status-bar').text()).toContain('Execution OK (4 rows)')
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
	    expect(wrapper.find('.db-sql-overview').text()).toContain('Execution OK (4 rows)')
	    expect(wrapper.find('.db-sql-overview').text()).toContain('ms')
	    const firstHistoryRow = wrapper.find('.db-sql-overview tbody tr')
	    expect(firstHistoryRow.attributes('data-execution-id')).toBe('sql-exec-test-1')
	    expect(firstHistoryRow.attributes('title')).toBe('2026-06-10T00:00:01.000Z')
	    await firstHistoryRow.trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-filter-chip').text()).toContain('EQ payment-api')
    expect(wrapper.find('.db-result-table').text()).not.toContain('orders-worker')
    vi.mocked(window.aiops.exportDatabaseRows).mockClear()
    const sqlExportButton = wrapper.find('.db-sql-results .db-toolbar-export')
    expect(sqlExportButton.attributes('disabled')).toBeUndefined()
    expect(sqlExportButton.attributes('title')).toBe('Export current SQL result page')
    const sqlChartButton = wrapper.find('.db-sql-results .db-toolbar-btn-chart')
    expect(sqlChartButton.attributes('disabled')).toBeUndefined()
    await sqlChartButton.trigger('click')
    expect(wrapper.find('.db-chart-modal').text()).toContain('SQL page 1')
    expect(wrapper.find('.db-chart-modal').text()).toContain('id')
    await wrapper.find('.db-chart-modal header button').trigger('click')
    vi.mocked(window.aiops.getDatabasePageComment).mockClear()
    const sqlCommentButton = wrapper.find('.db-sql-results .db-toolbar-btn-comment')
    expect(sqlCommentButton.attributes('disabled')).toBeUndefined()
    await sqlCommentButton.trigger('click')
    await flushPromises()
    expect(window.aiops.getDatabasePageComment).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'sql-result',
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        sql: expect.stringContaining('public.orders')
      })
    )
    await wrapper.find('.db-comment-modal header button').trigger('click')
    await sqlExportButton.trigger('click')
    await flushPromises()
    expect(window.aiops.exportDatabaseRows).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Query'),
        kind: 'sql-result',
        columns: ['id', 'service', 'status', 'owner', 'updated_at'],
        rows: [expect.objectContaining({ id: 1001, service: 'payment-api', status: 'investigating' })],
        metadata: expect.objectContaining({
          connectionName: 'orders-pg-edited',
          databaseName: 'orders',
          schemaName: 'public',
          sql: expect.stringContaining('public.orders'),
          page: 1,
          pageSize: 100,
          total: 1
        })
      })
    )
    expect(wrapper.text()).toContain('Exported 1 row to')
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('keydown', { key: ' ' })
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    await firstResultTab.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    await firstResultTab.find('.db-result-tab-close').trigger('click')
    expect(wrapper.find('.db-sql-overview tbody tr').classes()).toContain('closed')
    expect(wrapper.find('.db-sql-overview-open').exists()).toBe(false)
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    await workbenchEditor.setValue('select * from public.orders; select * from ops.ops_incidents;')
    const editorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const secondStatementOffset = editorElement.value.indexOf('select * from ops.ops_incidents')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-sql-overview').exists()).toBe(false)
    expect(wrapper.find('.db-result-table').text()).toContain('checkout')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#2-1')
    editorElement.setSelectionRange(0, 'select * from public.orders'.length)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Explain"]').trigger('click')
    await waitForDatabaseSqlResult()
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('EXPLAIN select * from ops.ops_incidents')

    await workbenchEditor.setValue('select id from "public"."orders" where status = \'open\';\nselect * from ops.ops_incidents;')
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
    expect(wrapper.findAll('.db-ai-dialect-row option').map((option) => option.text())).toContain('Presto')
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
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-tabs').text()).toContain('#')
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Replace Selection'))!.trigger('click')
    await flushPromises()
    const replacedConvertSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(replacedConvertSql).toContain('LIMIT 100;')
    expect(replacedConvertSql).toContain('select * from ops.ops_incidents;')
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
    await workbenchEditor.setValue('select 1;\nselect * from ops.ops_incidents;\n-- after cursor')
    const prefixEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const prefixOffset = prefixEditorElement.value.indexOf('select * from ops.ops_incidents') + 'select * from ops.ops_incidents'.length
    prefixEditorElement.setSelectionRange(prefixOffset, prefixOffset)
    await wrapper.find('button[title="AI Complete SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('select 1;')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('select * from ops.ops_incidents')
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
    await flushPromises()
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
    const tableChartButton = wrapper.find('.db-data-workspace .db-toolbar-btn-chart')
    expect(tableChartButton.attributes('disabled')).toBeUndefined()
    expect(tableChartButton.attributes('title')).toBe('Chart current table page')
    await tableChartButton.trigger('click')
    expect(wrapper.find('.db-chart-modal').text()).toContain('orders - page 1')
    expect(wrapper.find('.db-chart-modal').text()).toContain('Rows')
    expect(wrapper.find('.db-chart-modal').text()).toContain('payment-api')
    await wrapper.find('.db-chart-modal header button').trigger('click')
    vi.mocked(window.aiops.getDatabasePageComment).mockClear()
    vi.mocked(window.aiops.saveDatabasePageComment).mockClear()
    const tableCommentButton = wrapper.find('.db-data-workspace .db-toolbar-btn-comment')
    expect(tableCommentButton.attributes('disabled')).toBeUndefined()
    expect(tableCommentButton.attributes('title')).toBe('Comment current table page')
    await tableCommentButton.trigger('click')
    await flushPromises()
    expect(window.aiops.getDatabasePageComment).toHaveBeenCalledWith({
      scope: 'table-page',
      connectionId: 'conn-prod-pg',
      databaseName: 'orders',
      schemaName: 'public',
      tableName: 'orders'
    })
    await wrapper.find('.db-comment-modal textarea').setValue('Review rows with stale owners before paging.')
    await wrapper.find('.db-comment-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(window.aiops.saveDatabasePageComment).toHaveBeenCalledWith({
      key: {
        scope: 'table-page',
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      },
      comment: 'Review rows with stale owners before paging.'
    })
    expect(wrapper.text()).toContain('Comment saved')
    await wrapper.find('.db-comment-modal header button').trigger('click')
    const tableExportButton = wrapper.find('.db-data-workspace .db-toolbar-export')
    expect(tableExportButton.attributes('disabled')).toBeUndefined()
    expect(tableExportButton.attributes('title')).toBe('Export current table page')
    vi.mocked(window.aiops.exportDatabaseRows).mockClear()
    await tableExportButton.trigger('click')
    await flushPromises()
    expect(window.aiops.exportDatabaseRows).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'orders-page-1',
        kind: 'table-page',
        columns: ['id', 'service', 'status', 'owner', 'updated_at'],
        rows: [
          expect.objectContaining({ id: 1001, service: 'payment-api' }),
          expect.objectContaining({ id: 1002, service: 'orders-worker' }),
          expect.objectContaining({ id: 1003, service: 'k8s-ingress' }),
          expect.objectContaining({ id: 1004, service: 'billing-sync' })
        ],
        metadata: expect.objectContaining({
          connectionName: 'orders-pg-edited',
          databaseName: 'orders',
          schemaName: 'public',
          tableName: 'orders',
          page: 1,
          pageSize: 10,
          total: 4
        })
      })
    )
    expect(wrapper.text()).toContain('Exported 4 rows to')
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
    vi.mocked(window.aiops.planDatabaseTableMutation).mockClear()
    await dataRow.trigger('click')
    expect(wrapper.find('.db-toolbar-btn-delete-row').attributes('disabled')).toBeUndefined()
    const ownerCell = dataRow.findAll('td').at(4)!
    await ownerCell.trigger('dblclick')
    const dataEditInput = wrapper.find('.db-result-table td input')
    expect(document.activeElement).toBe(dataEditInput.element)
    expect((dataEditInput.element as HTMLInputElement).selectionStart).toBe(0)
    await dataEditInput.setValue('alice-edited')
    await dataEditInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()
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
    expect(window.aiops.planDatabaseTableMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders',
        mutations: [
          expect.objectContaining({
            kind: 'update',
            primaryKey: ['id'],
            patch: { owner: 'alice-edited' },
            originalRow: expect.objectContaining({ id: 1001, owner: 'alice' })
          })
        ]
      })
    )
    await wrapper.find('.db-toolbar button[title="Undo"]').trigger('click')
    await flushPromises()
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
    await flushPromises()
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
    await flushPromises()
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 Deleted')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('DELETE FROM "public"."orders"')
    await wrapper.findAll('.db-edit-summary-actions button').find((button) => button.text().includes('Copy Preview'))!.trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "public"."orders"'))
    await wrapper.findAll('.db-edit-summary-actions button').find((button) => button.text().includes('Discard All'))!.trigger('click')
    expect(wrapper.find('.db-result-table tbody tr.deleted').exists()).toBe(false)
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    await wrapper.find('.db-result-table tbody tr').trigger('click')
    await wrapper.find('.db-toolbar button[title="Delete row"]').trigger('click')
    await flushPromises()
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
    await flushPromises()
    expect(wrapper.find('.db-edit-summary').text()).toContain('No primary key detected')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('UPDATE `metrics`.`metric_events`')
    expect(wrapper.find('.db-edit-summary pre').text()).toContain('LIMIT 1')
    await wrapper.find('.db-toolbar button[title="Add row"]').trigger('click')
    const metricNewRow = wrapper.find('.db-result-table tbody tr.new')
    await metricNewRow.findAll('td').at(1)!.trigger('dblclick')
    await wrapper.find('.db-result-table tbody tr.new input').setValue('search')
    await wrapper.find('.db-result-table tbody tr.new input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
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
    await flushPromises()
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
    await flushPromises()
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
    expect(wrapper.text()).toContain('Generated SQL copied')

    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard unavailable again'))
    const originalExecCommandForFailedCopy = document.execCommand
    const failedExecCommandSpy = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: failedExecCommandSpy
    })
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Copy'))!.trigger('click')
    await flushPromises()
    expect(failedExecCommandSpy).toHaveBeenCalledWith('copy')
    if (originalExecCommandForFailedCopy) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommandForFailedCopy
      })
    } else {
      Reflect.deleteProperty(document, 'execCommand')
    }
    expect(wrapper.text()).toContain('Copy failed')
    expect(wrapper.text()).not.toContain('Generated SQL copied')
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
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-result-error').text()).toContain('Backend SQL executor rejected')
    const dbAiRequestCountBeforeDiagnose = wrapper.findAll('.db-ai-request-list button').length
    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockClear()
    vi.mocked(window.aiops.createDatabaseAiDrawerRequest).mockClear()
    vi.mocked(window.aiops.startDatabaseAiDrawerResponse).mockClear()
    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockClear()
    await wrapper.find('.db-result-error button').trigger('click')
    expect(window.aiops.diagnoseDatabaseSqlError).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^dbai-diagnose-/),
        sourceSql: 'syntax_error',
        targetDialect: 'postgresql',
        context: expect.objectContaining({
          connectionId: 'conn-prod-pg',
          dbType: 'postgresql',
          databaseName: 'orders',
          schemaName: 'public'
        }),
        errorMessage: expect.stringContaining('Backend SQL executor rejected')
      })
    )
    expect(window.aiops.createDatabaseAiDrawerRequest).not.toHaveBeenCalled()
    expect(window.aiops.startDatabaseAiDrawerResponse).not.toHaveBeenCalled()
    expect(window.aiops.generateDatabaseAiDrawerResponse).not.toHaveBeenCalled()
    expect(wrapper.find('.db-result-diagnose-btn').classes()).toContain('loading')
    expect(wrapper.find('.db-result-diagnose-spinner').exists()).toBe(true)
    expect(wrapper.findAll('.db-ai-request-list button')).toHaveLength(dbAiRequestCountBeforeDiagnose)
    await new Promise((resolve) => window.setTimeout(resolve, 190))
    await flushPromises()
    expect(wrapper.find('.db-result-diagnose-success').text()).toContain('Diagnosed and replaced editor SQL')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('LIMIT 100')
    await wrapper.find('button[title="Run all"]').trigger('click')
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
  }, 15_000)

  it('fails closed when Database backend success envelopes are malformed', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    const findOrdersTable = () => wrapper.findAll('.db-tree-row.table').find((row) => row.text().trim().includes('orders'))!

    vi.mocked(window.aiops.getDatabaseTableDdl).mockResolvedValueOnce({ ok: true, data: {} } as any)
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await findOrdersTable().trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('View DDL'))!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.db-ddl-error').text()).toContain('Database DDL backend returned malformed result data.')
    expect(wrapper.find('.db-ddl-modal textarea').exists()).toBe(false)
    expect(wrapper.find('.db-ddl-toolbar').findAll('button').find((button) => button.text().includes('Copy'))!.attributes('disabled')).toBeDefined()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    await wrapper.find('.db-ddl-modal header button').trigger('click')

    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue('select * from public.orders;')
    vi.mocked(window.aiops.executeDatabaseSql).mockResolvedValueOnce({ ok: true } as any)
    await wrapper.find('button[title="Run all"]').trigger('click')
	    await waitForDatabaseSqlResult()

    expect(wrapper.find('.db-result-error').text()).toContain('Backend SQL executor returned malformed result data.')
    expect(wrapper.find('.db-status-bar').text()).toContain('Backend SQL executor returned malformed result data.')
    expect(wrapper.find('.db-status-bar').text()).not.toContain('Execution OK')
    await wrapper.find('.db-result-tabs [role="tab"]').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('Run SQL to create a result tab.')
    expect(wrapper.find('.db-sql-overview').text()).not.toContain('Backend SQL executor returned malformed result data.')
    expect(wrapper.find('.db-sql-overview').text()).not.toContain('Execution OK')

    const originalExecuteDatabaseSql = window.aiops.executeDatabaseSql
    try {
      ;(window.aiops as any).executeDatabaseSql = undefined
      await wrapper.find('button[title="Run all"]').trigger('click')
      await waitForDatabaseSqlResult()
      expect(wrapper.find('.db-result-error').text()).toContain('Database SQL executor service unavailable')
      expect(wrapper.find('.db-status-bar').text()).toContain('Database SQL executor service unavailable')
      expect(wrapper.find('.db-status-bar').text()).not.toContain('Execution OK')
    } finally {
      ;(window.aiops as any).executeDatabaseSql = originalExecuteDatabaseSql
    }

    await findOrdersTable().trigger('dblclick')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).toContain('Execution OK')

    vi.mocked(window.aiops.exportDatabaseRows).mockResolvedValueOnce({ ok: true, data: { exported: 1 } } as any)
    await wrapper.find('.db-data-workspace .db-toolbar-export').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database export backend returned malformed result data.')
    expect(wrapper.text()).not.toContain('Exported 1 row to')

    vi.mocked(window.aiops.exportDatabaseRows).mockResolvedValueOnce({
      ok: true,
      data: {
        exported: 1,
        fileName: 'orders-page.csv',
        filePath: '/tmp/orders-page.csv'
      }
    } as any)
    await wrapper.find('.db-data-workspace .db-toolbar-export').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database export backend returned malformed result data.')
    expect(wrapper.text()).not.toContain('Exported 1 row to orders-page.csv')

    vi.mocked(window.aiops.saveDatabasePageComment).mockResolvedValueOnce({ ok: true, data: { message: 'Comment saved' } } as any)
    await wrapper.find('.db-data-workspace .db-toolbar-btn-comment').trigger('click')
    await flushPromises()
    await wrapper.find('.db-comment-modal textarea').setValue('Malformed save should not be accepted.')
    await wrapper.find('.db-comment-modal footer button:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database comment backend returned malformed result data.')
    expect(wrapper.text()).not.toContain('Saved ')
    await wrapper.find('.db-comment-modal header button').trigger('click')

    vi.mocked(window.aiops.queryDatabaseTable).mockResolvedValueOnce({ ok: true } as any)
    await wrapper.find('.db-data-workspace .db-toolbar button[title="Refresh"]').trigger('click')
    await waitForDatabaseTableData(wrapper)

    expect(wrapper.find('.db-data-workspace .db-result-error').text()).toContain('Backend table query returned malformed result data.')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).toContain('Backend table query returned malformed result data.')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).not.toContain('Execution OK')

    vi.mocked(window.aiops.queryDatabaseTable).mockRejectedValueOnce(new Error('table query rejected'))
    await wrapper.find('.db-data-workspace .db-toolbar button[title="Refresh"]').trigger('click')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.find('.db-data-workspace .db-result-error').text()).toContain('table query rejected')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).toContain('table query rejected')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).not.toContain('Execution OK')

    await wrapper.find('.db-data-workspace .db-toolbar button[title="Refresh"]').trigger('click')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-data-workspace .db-status-bar').text()).toContain('Execution OK')

    wrapper.unmount()
  })

  it('keeps Database SQL save state unchanged when file save bridges cancel or fail', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()
    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue('select * from public.orders;')

    vi.mocked(window.aiops.showSaveDialog).mockClear()
    vi.mocked(window.aiops.writeLocalFile).mockClear()
    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: true })
    await wrapper.find('button[title="Save As"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalled()
    expect(window.aiops.writeLocalFile).not.toHaveBeenCalled()
    expect(wrapper.find('.db-sql-save-state').text()).toContain('Not saved')
    expect(wrapper.text()).toContain('SQL save cancelled')

    const originalAiops = {
      showSaveDialog: window.aiops.showSaveDialog,
      writeLocalFile: window.aiops.writeLocalFile
    }
    try {
      ;(window.aiops as any).showSaveDialog = undefined
      await wrapper.find('button[title="Save As"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-sql-save-state').text()).toContain('SQL save dialog service unavailable')

      ;(window.aiops as any).showSaveDialog = originalAiops.showSaveDialog
      vi.mocked(window.aiops.showSaveDialog!).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/aiopsterm-sql/failing.sql' })
      vi.mocked(window.aiops.writeLocalFile).mockRejectedValueOnce(new Error('disk denied'))
      await wrapper.find('button[title="Save As"]').trigger('click')
      await flushPromises()
      expect(window.aiops.writeLocalFile).toHaveBeenCalledWith('/tmp/aiopsterm-sql/failing.sql', 'select * from public.orders;')
      expect(wrapper.find('.db-sql-save-state').text()).toContain('disk denied')

      vi.mocked(window.aiops.showSaveDialog!).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/aiopsterm-sql/malformed.sql' })
      vi.mocked(window.aiops.writeLocalFile).mockResolvedValueOnce({
        ok: true,
        data: { filePath: '/tmp/aiopsterm-sql/other.sql', bytes: 1, size: 1, mtimeMs: 1717200000000 }
      } as any)
      await wrapper.find('button[title="Save As"]').trigger('click')
      await flushPromises()
      expect(window.aiops.writeLocalFile).toHaveBeenCalledWith('/tmp/aiopsterm-sql/malformed.sql', 'select * from public.orders;')
      expect(wrapper.find('.db-sql-save-state').text()).toContain('SQL file writer returned malformed result data.')
      expect(wrapper.find('.db-sql-save-state').text()).not.toContain('Saved: malformed.sql')

      vi.mocked(window.aiops.showSaveDialog!).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/aiopsterm-sql/unverified.sql' })
      vi.mocked(window.aiops.writeLocalFile).mockResolvedValueOnce({
        ok: true,
        data: {
          filePath: '/tmp/aiopsterm-sql/unverified.sql',
          bytes: new TextEncoder().encode('select * from public.orders;').byteLength,
          size: 1,
          mtimeMs: 1717200000000
        }
      } as any)
      await wrapper.find('button[title="Save As"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-sql-save-state').text()).toContain('SQL file writer returned malformed result data.')
      expect(wrapper.find('.db-sql-save-state').text()).not.toContain('Saved: unverified.sql')

      ;(window.aiops as any).writeLocalFile = undefined
      await wrapper.find('button[title="Save"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-sql-save-state').text()).toContain('SQL file writer service unavailable')
    } finally {
      ;(window.aiops as any).showSaveDialog = originalAiops.showSaveDialog
      ;(window.aiops as any).writeLocalFile = originalAiops.writeLocalFile
    }

    wrapper.unmount()
  })

  it('fails closed when Database catalog mutation success envelopes are malformed', async () => {
    vi.mocked(window.aiops.listDatabaseCatalog).mockResolvedValueOnce({ ok: true, data: { groups: [] } } as any)
    const malformedCatalogWrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    expect(malformedCatalogWrapper.text()).toContain('Database catalog backend returned malformed result data.')
    expect(malformedCatalogWrapper.text()).not.toContain('Default Group')
    expect(malformedCatalogWrapper.text()).not.toContain('orders-postgres')
    expect(malformedCatalogWrapper.text()).not.toContain('SQL Console')
    expect(malformedCatalogWrapper.text()).not.toContain('select id, service, status, owner')
    malformedCatalogWrapper.unmount()

    const mixedEngineCatalogImplementation = vi.mocked(window.aiops.listDatabaseCatalog).getMockImplementation()
    expect(mixedEngineCatalogImplementation).toBeDefined()
    vi.mocked(window.aiops.listDatabaseCatalog).mockImplementationOnce(async () => {
      const result = await mixedEngineCatalogImplementation!()
      if (!result.ok || !result.data) return result
      return {
        ...result,
        data: {
          ...result.data,
          engines: [
            ...result.data.engines,
            { code: 'h2' as const, name: 'H2', enabled: false, accent: '#7c3aed' }
          ]
        }
      }
    })
    const mixedEngineWrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()
    expect(mixedEngineWrapper.find('.db-engine-grid').text()).not.toContain('H2')
    await mixedEngineWrapper.find('button[title="Add"]').trigger('click')
    expect(mixedEngineWrapper.find('.db-add-menu').text()).not.toContain('H2')
    mixedEngineWrapper.unmount()

    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    const connectionRow = (label: string) => wrapper.findAll('.db-tree-row.connection').find((row) => row.text().includes(label))!
    const groupRow = (label: string) => wrapper.findAll('.db-tree-row.group').find((row) => row.text().includes(label))!
    const tableRow = (label: string) => wrapper.findAll('.db-tree-row.table').find((row) => row.text().trim().includes(label))!
    const contextButton = (label: string) => wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes(label))!
    const validConnectionTestData = {
      dbType: 'postgresql' as const,
      serverVersion: 'PostgreSQL 16 local backend validation',
      endpoint: 'test-backend',
      durationMs: 1
    }

    await wrapper.find('button[title="Add"]').trigger('click')
    await wrapper.find('.db-add-menu').findAll('button').find((button) => button.text().includes('PostgreSQL'))!.trigger('click')
    await wrapper.findAll('.db-connection-modal input').at(0)!.setValue('malformed-pg')

    vi.mocked(window.aiops.testDatabaseConnection).mockResolvedValueOnce({ ok: true, data: { serverVersion: 'partial' } } as any)
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-modal-feedback').text()).toContain('Database connection test backend returned malformed result data.')
    expect(wrapper.find('.db-modal-feedback').text()).not.toContain('Connection successful')

    vi.mocked(window.aiops.saveDatabaseConnection).mockClear()
    vi.mocked(window.aiops.testDatabaseConnection).mockResolvedValueOnce({ ok: true, data: { serverVersion: 'partial' } } as any)
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(window.aiops.saveDatabaseConnection).not.toHaveBeenCalled()
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)

    vi.mocked(window.aiops.testDatabaseConnection).mockResolvedValueOnce({ ok: true, data: validConnectionTestData })
    vi.mocked(window.aiops.saveDatabaseConnection).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.db-modal-feedback').text()).toContain('Database connection save backend returned malformed result data.')
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('malformed-pg'))).toBe(false)

    vi.mocked(window.aiops.testDatabaseConnection).mockResolvedValueOnce({ ok: true, data: validConnectionTestData })
    vi.mocked(window.aiops.saveDatabaseConnection).mockResolvedValueOnce({
      ok: true,
      data: {
        engines: [],
        groups: [{ id: 'group-default', name: 'Default Group' }],
        groupParents: { 'group-default': null },
        connections: [
          {
            id: 'conn-wrong-save',
            name: 'wrong-save',
            dbType: 'postgresql',
            env: 'Production',
            groupId: 'group-default',
            host: '127.0.0.2',
            port: 5432,
            authentication: 'UserAndPassword',
            user: 'wrong',
            database: 'wrong',
            status: 'idle',
            catalogs: []
          }
        ],
        defaults: { selectedNodeId: 'conn-wrong-save', expandedGroupIds: ['group-default'], expandedConnectionIds: [], expandedCatalogIds: [], expandedSchemaIds: [], expandedSchemaObjectFolderIds: [] },
        connection: {
          id: 'conn-wrong-save',
          name: 'wrong-save',
          dbType: 'postgresql',
          env: 'Production',
          groupId: 'group-default',
          host: '127.0.0.2',
          port: 5432,
          authentication: 'UserAndPassword',
          user: 'wrong',
          database: 'wrong',
          status: 'idle',
          catalogs: []
        },
        message: 'Connection saved'
      }
    } as any)
    await wrapper.find('.db-connection-modal').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.db-modal-feedback').text()).toContain('Database connection save backend returned malformed result data.')
    expect(wrapper.find('.db-connection-modal').exists()).toBe(true)
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('wrong-save'))).toBe(false)
    await wrapper.find('.db-connection-modal > button[title="Close"]').trigger('click')

    vi.mocked(window.aiops.createDatabaseGroup).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await groupRow('Default Group').trigger('contextmenu')
    await contextButton('New Group').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database group backend returned malformed result data.')
    expect(wrapper.find('.db-tree-edit').exists()).toBe(false)

    vi.mocked(window.aiops.connectDatabaseConnection).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await connectionRow('metrics-mysql').trigger('contextmenu')
    await contextButton('Open Connection').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database connection backend returned malformed result data.')
    await connectionRow('metrics-mysql').trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').text()).toContain('Open Connection')
    expect(wrapper.find('.db-context-menu').text()).not.toContain('Close Connection')

    vi.mocked(window.aiops.refreshDatabaseConnection).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await connectionRow('orders-postgres').trigger('contextmenu')
    await contextButton('Refresh').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database connection backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('orders-postgres'))).toBe(true)

    vi.mocked(window.aiops.moveDatabaseConnection).mockResolvedValueOnce({
      ok: true,
      data: {
        engines: [],
        groups: [{ id: 'group-default', name: 'Default Group' }],
        groupParents: { 'group-default': null },
        connections: [
          {
            id: 'conn-metrics-mysql',
            name: 'metrics-mysql',
            dbType: 'mysql',
            env: 'Staging',
            groupId: 'group-default',
            host: '10.32.6.18',
            port: 3306,
            authentication: 'UserAndPassword',
            user: 'ops',
            database: 'metrics',
            status: 'idle',
            catalogs: []
          }
        ],
        defaults: { selectedNodeId: 'conn-metrics-mysql', expandedGroupIds: ['group-default'], expandedConnectionIds: [], expandedCatalogIds: [], expandedSchemaIds: [], expandedSchemaObjectFolderIds: [] },
        connection: {
          id: 'conn-metrics-mysql',
          name: 'metrics-mysql',
          dbType: 'mysql',
          env: 'Staging',
          groupId: 'group-default',
          host: '10.32.6.18',
          port: 3306,
          authentication: 'UserAndPassword',
          user: 'ops',
          database: 'metrics',
          status: 'idle',
          catalogs: []
        },
        message: 'Connection moved'
      }
    } as any)
    await connectionRow('metrics-mysql').trigger('contextmenu')
    await wrapper.findAll('.db-popup-submenu-wrap').find((item) => item.text().includes('Move To'))!.trigger('mouseenter')
    await wrapper.find('.db-popup-submenu').findAll('button').find((button) => button.text().includes('Production'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database connection backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree > ul > li').find((group) => group.text().includes('Production'))!.text()).not.toContain('metrics-mysql')

    const tabCountBeforeRemove = wrapper.findAll('.db-workspace-tab').length
    vi.mocked(window.aiops.removeDatabaseConnection).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await connectionRow('orders-postgres').trigger('contextmenu')
    await contextButton('Remove').trigger('click')
    await wrapper.find('.db-operation-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database connection backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('orders-postgres'))).toBe(true)
    expect(wrapper.findAll('.db-workspace-tab')).toHaveLength(tabCountBeforeRemove)

    vi.mocked(window.aiops.removeDatabaseConnection).mockResolvedValueOnce({
      ok: true,
      data: {
        engines: [],
        groups: [{ id: 'group-default', name: 'Default Group' }],
        groupParents: { 'group-default': null },
        connections: [],
        defaults: { selectedNodeId: 'group-default', expandedGroupIds: ['group-default'], expandedConnectionIds: [], expandedCatalogIds: [], expandedSchemaIds: [], expandedSchemaObjectFolderIds: [] },
        connectionId: 'conn-other',
        message: 'Connection removed'
      }
    } as any)
    await connectionRow('orders-postgres').trigger('contextmenu')
    await contextButton('Remove').trigger('click')
    await wrapper.find('.db-operation-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Database connection backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree-row.connection').some((row) => row.text().includes('orders-postgres'))).toBe(true)
    expect(wrapper.findAll('.db-workspace-tab')).toHaveLength(tabCountBeforeRemove)

    vi.mocked(window.aiops.createDatabaseCatalog).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await connectionRow('orders-postgres').trigger('contextmenu')
    await contextButton('Create Database').trigger('click')
    await wrapper.find('.db-create-modal input').setValue('malformed_catalog')
    await wrapper.find('.db-create-modal').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.db-create-modal').exists()).toBe(true)
    expect(wrapper.find('.db-create-modal .db-modal-feedback').text()).toContain('Create database backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree-row.database').some((row) => row.text().includes('malformed_catalog'))).toBe(false)

    vi.mocked(window.aiops.createDatabaseCatalog).mockResolvedValueOnce({
      ok: true,
      data: {
        engines: [],
        groups: [{ id: 'group-default', name: 'Default Group' }],
        groupParents: { 'group-default': null },
        connections: [
          {
            id: 'conn-prod-pg',
            name: 'orders-postgres',
            dbType: 'postgresql',
            env: 'Production',
            groupId: 'group-default',
            host: '10.32.6.9',
            port: 5432,
            authentication: 'UserAndPassword',
            user: 'readonly',
            database: 'orders',
            status: 'connected',
            catalogs: [{ name: 'wrong_catalog', schemas: [] }]
          }
        ],
        defaults: { selectedNodeId: 'conn-prod-pg:wrong_catalog', expandedGroupIds: ['group-default'], expandedConnectionIds: ['conn-prod-pg'], expandedCatalogIds: [], expandedSchemaIds: [], expandedSchemaObjectFolderIds: [] },
        connection: {
          id: 'conn-prod-pg',
          name: 'orders-postgres',
          dbType: 'postgresql',
          env: 'Production',
          groupId: 'group-default',
          host: '10.32.6.9',
          port: 5432,
          authentication: 'UserAndPassword',
          user: 'readonly',
          database: 'orders',
          status: 'connected',
          catalogs: [{ name: 'wrong_catalog', schemas: [] }]
        },
        catalog: { name: 'wrong_catalog', schemas: [] },
        message: 'Database created in workspace catalog'
      }
    } as any)
    await wrapper.find('.db-create-modal input').setValue('malformed_catalog')
    await wrapper.find('.db-create-modal').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.db-create-modal').exists()).toBe(true)
    expect(wrapper.find('.db-create-modal .db-modal-feedback').text()).toContain('Create database backend returned malformed result data.')
    expect(wrapper.findAll('.db-tree-row.database').some((row) => row.text().includes('wrong_catalog'))).toBe(false)
    await wrapper.find('.db-create-modal footer button[type="button"]').trigger('click')

    await tableRow('orders').trigger('dblclick')
    await waitForDatabaseTableData(wrapper)
    expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')

    vi.mocked(window.aiops.planDatabaseTableMutation).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await wrapper.find('.db-result-table tbody tr').trigger('click')
    await wrapper.find('.db-result-table tbody tr').findAll('td').at(4)!.trigger('dblclick')
    const editInput = wrapper.find('.db-result-table td input')
    await editInput.setValue('malformed-owner')
    await editInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('.db-edit-summary').text()).toContain('Backend table mutation returned malformed result data.')

    const originalPlanDatabaseTableMutation = window.aiops.planDatabaseTableMutation
    try {
      ;(window.aiops as any).planDatabaseTableMutation = undefined
      await wrapper.find('.db-result-table tbody tr').findAll('td').at(4)!.trigger('dblclick')
      const plannerMissingInput = wrapper.find('.db-result-table td input')
      await plannerMissingInput.setValue('planner-missing-owner')
      await plannerMissingInput.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.find('.db-edit-summary').text()).toContain('Database table mutation planner service unavailable')
    } finally {
      ;(window.aiops as any).planDatabaseTableMutation = originalPlanDatabaseTableMutation
    }

    vi.mocked(window.aiops.mutateDatabaseTable).mockClear()
    vi.mocked(window.aiops.planDatabaseTableMutation).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateDatabaseTable).not.toHaveBeenCalled()
    expect(wrapper.find('.db-edit-summary').text()).toContain('Backend table mutation returned malformed result data.')

    vi.mocked(window.aiops.mutateDatabaseTable).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    await flushPromises()
    expect(window.aiops.mutateDatabaseTable).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-prod-pg',
        databaseName: 'orders',
        schemaName: 'public',
        tableName: 'orders'
      })
    )
    expect(wrapper.find('.db-edit-summary').text()).toContain('Backend table mutation returned malformed result data.')
    expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')

    vi.mocked(window.aiops.mutateDatabaseTable).mockRejectedValueOnce(new Error('table mutation rejected'))
    await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-edit-summary').text()).toContain('table mutation rejected')
    expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')
    expect(wrapper.find('.db-toolbar-btn-save').attributes('disabled')).toBeUndefined()

    const originalMutateDatabaseTable = window.aiops.mutateDatabaseTable
    try {
      ;(window.aiops as any).mutateDatabaseTable = undefined
      await wrapper.find('.db-toolbar button[title="Save changes"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-edit-summary').text()).toContain('Database table mutation service unavailable')
      expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')
      expect(wrapper.find('.db-toolbar-btn-save').attributes('disabled')).toBeUndefined()
    } finally {
      ;(window.aiops as any).mutateDatabaseTable = originalMutateDatabaseTable
    }

    await wrapper.findAll('.db-edit-summary-actions button').find((button) => button.text().includes('Discard All'))!.trigger('click')
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)

    vi.mocked(window.aiops.mutateDatabaseTable).mockRejectedValueOnce(new Error('truncate rejected'))
    await tableRow('orders').trigger('contextmenu')
    await contextButton('Truncate').trigger('click')
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('truncate rejected')
    expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
    expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')
    await wrapper.find('.db-danger-confirm footer button').trigger('click')

    try {
      ;(window.aiops as any).mutateDatabaseTable = undefined
      await tableRow('orders').trigger('contextmenu')
      await contextButton('Truncate').trigger('click')
      await wrapper.find('.db-danger-confirm input').setValue('orders')
      await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Database table mutation service unavailable')
      expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
      expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')
      await wrapper.find('.db-danger-confirm footer button').trigger('click')
    } finally {
      ;(window.aiops as any).mutateDatabaseTable = originalMutateDatabaseTable
    }

    vi.mocked(window.aiops.mutateDatabaseTable).mockResolvedValueOnce({ ok: true, data: {} } as any)
    await tableRow('orders').trigger('contextmenu')
    await contextButton('Truncate').trigger('click')
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Backend table mutation returned malformed result data.')
    expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
    expect(wrapper.find('.db-data-workspace .db-result-table').text()).toContain('payment-api')
    await wrapper.find('.db-danger-confirm footer button').trigger('click')

    vi.mocked(window.aiops.mutateDatabaseTable).mockRejectedValueOnce(new Error('drop rejected'))
    await tableRow('orders').trigger('contextmenu')
    await contextButton('Drop').trigger('click')
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('drop rejected')
    expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
    expect(wrapper.findAll('.db-tree-row.table').some((row) => row.text().trim().includes('orders'))).toBe(true)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(true)
    await wrapper.find('.db-danger-confirm footer button').trigger('click')

    try {
      ;(window.aiops as any).mutateDatabaseTable = undefined
      await tableRow('orders').trigger('contextmenu')
      await contextButton('Drop').trigger('click')
      await wrapper.find('.db-danger-confirm input').setValue('orders')
      await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Database table mutation service unavailable')
      expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
      expect(wrapper.findAll('.db-tree-row.table').some((row) => row.text().trim().includes('orders'))).toBe(true)
      expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(true)
      await wrapper.find('.db-danger-confirm footer button').trigger('click')
    } finally {
      ;(window.aiops as any).mutateDatabaseTable = originalMutateDatabaseTable
    }

    vi.mocked(window.aiops.mutateDatabaseTable).mockResolvedValueOnce({ ok: true, data: { affected: 1, durationMs: 1 } } as any)
    await tableRow('orders').trigger('contextmenu')
    await contextButton('Drop').trigger('click')
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Backend table mutation returned malformed result data.')
    expect(wrapper.find('.db-danger-confirm').exists()).toBe(true)
    expect(wrapper.findAll('.db-tree-row.table').some((row) => row.text().trim().includes('orders'))).toBe(true)
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(true)

    wrapper.unmount()
  })

  it('does not fabricate Database refresh success when no connections are connected', async () => {
    const listDatabaseCatalogImplementation = vi.mocked(window.aiops.listDatabaseCatalog).getMockImplementation()
    expect(listDatabaseCatalogImplementation).toBeDefined()
    vi.mocked(window.aiops.listDatabaseCatalog).mockImplementationOnce(async () => {
      const result = await listDatabaseCatalogImplementation!()
      if (!result.ok || !result.data) return result
      return {
        ...result,
        data: {
          ...result.data,
          connections: result.data.connections.map((connection) => ({ ...connection, status: 'idle' as const })),
          defaults: {
            ...result.data.defaults,
            expandedConnectionIds: []
          }
        }
      }
    })
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    vi.mocked(window.aiops.refreshDatabaseConnection).mockClear()
    await wrapper.find('button[title="Refresh connected"]').trigger('click')
    await flushPromises()

    expect(window.aiops.refreshDatabaseConnection).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('No connected database schemas to refresh')
    expect(wrapper.text()).not.toContain('Connected database schemas refreshed')

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

    const executeDatabaseSqlImplementation = vi.mocked(window.aiops.executeDatabaseSql).getMockImplementation()
    expect(executeDatabaseSqlImplementation).toBeDefined()
    vi.mocked(window.aiops.executeDatabaseSql).mockImplementationOnce(
      async (input) =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve(executeDatabaseSqlImplementation!(input)), 20)
        })
    )
    await wrapper.find('button[title="New SQL"]').trigger('click')
    await wrapper.find('.db-sql-editor').setValue('select * from public.orders;')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-running').text()).toContain('Running query')

    const runningResultTab = wrapper.findAll('.db-result-tabs [role="tab"]').find((tab) => tab.text().includes('#1-1'))!
    await runningResultTab.find('.db-result-tab-close').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    expect(wrapper.find('.db-sql-overview').text()).not.toContain('#1-1')

    await new Promise((resolve) => window.setTimeout(resolve, 30))
    await waitForDatabaseSqlResult()
    expect(wrapper.find('.db-sql-overview').text()).toContain('select * from public.orders')
    const closedHistoryRow = wrapper.find('.db-sql-overview tbody tr')
    expect(closedHistoryRow.classes()).toContain('closed')
    expect(closedHistoryRow.attributes('data-execution-id')).toBe('sql-exec-test-1')
    expect(closedHistoryRow.attributes('title')).toBe('2026-06-10T00:00:01.000Z')
    expect(wrapper.find('.db-sql-overview-open').exists()).toBe(false)
    await closedHistoryRow.trigger('click')
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

  it('fails closed when Database DB AI success envelopes are malformed', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const editor = wrapper.find('.db-sql-editor')
    await editor.setValue('select id from "public"."orders";')

    vi.mocked(window.aiops.createDatabaseAiDrawerRequest).mockResolvedValueOnce({
      ok: true,
      data: { id: 'dbai-drawer-malformed-create' }
    } as any)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DB AI drawer backend returned malformed request data.')
    expect(wrapper.find('.db-ai-drawer').exists()).toBe(false)

    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockClear()
    vi.mocked(window.aiops.startDatabaseAiDrawerResponse).mockResolvedValueOnce({
      ok: true,
      data: { id: 'dbai-drawer-request-test-1', status: 'streaming' }
    } as any)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ai-drawer').exists()).toBe(true)
    expect(wrapper.find('.db-ai-status').text()).toContain('Queued')
    expect(wrapper.find('.db-ai-status').text()).not.toContain('Error')
    expect(wrapper.text()).toContain('DB AI drawer backend returned malformed lifecycle data.')
    expect(window.aiops.generateDatabaseAiDrawerResponse).not.toHaveBeenCalled()
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        request: { id: 'dbai-drawer-request-test-2' }
      }
    } as any)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    expect(wrapper.find('.db-ai-status').text()).not.toContain('Error')
    expect(wrapper.text()).toContain('DB AI drawer backend returned malformed response data.')
    expect(wrapper.find('.db-ai-sql-actions').exists()).toBe(false)
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    await wrapper.find('button[title="Toggle DB AI Pane"]').trigger('click')
    vi.mocked(window.aiops.createDatabaseAiPaneRequest).mockResolvedValueOnce({
      ok: true,
      data: { requestId: 'dbai-pane-malformed-create' }
    } as any)
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Summarize schema')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DB AI pane backend returned malformed request data.')
    expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(0)

    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockClear()
    vi.mocked(window.aiops.startDatabaseAiPaneResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        assistantMessage: {
          id: 'dbai-pane-request-test-1-assistant',
          requestId: 'wrong-request',
          role: 'assistant',
          status: 'streaming',
          content: '',
          contextSummary: 'malformed',
          createdAt: 1,
          updatedAt: 1
        }
      }
    } as any)
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Start malformed')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(2)
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Queued')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('Error')
    expect(wrapper.text()).toContain('DB AI pane backend returned malformed lifecycle data.')
    expect(window.aiops.generateDatabaseAiPaneResponse).not.toHaveBeenCalled()
    await wrapper.find('.db-ai-pane-composer-actions button[title="Reset conversation"]').trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockResolvedValueOnce({
      ok: true,
      data: {
        requestId: 'dbai-pane-request-test-2',
        text: 'missing assistant message',
        provider: 'aiopsterm-local',
        durationMs: 1
      }
    } as any)
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Response malformed')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(2)
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('Error')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('missing assistant message')
    expect(wrapper.text()).toContain('DB AI pane backend returned malformed response data.')

    await editor.setValue('syntax_error')
    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockResolvedValueOnce({
      ok: true,
      data: { sql: 'SELECT fixed;' }
    } as any)
    await wrapper.find('button[title="Run all"]').trigger('click')
    await waitForDatabaseSqlResult()
    await wrapper.find('.db-result-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-result-diagnose-error').text()).toContain('DB AI diagnosis backend returned malformed result data.')
    expect((editor.element as HTMLTextAreaElement).value).toBe('syntax_error')

    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockImplementationOnce(async (input: any) => ({
      ok: true,
      data: {
        request: {
          id: `${input.requestId}-forged`,
          action: 'diagnose',
          label: 'Diagnose SQL',
          status: 'done',
          contextSummary: '',
          sourceSql: input.sourceSql,
          text: 'Reasoning\n\n```sql\nSELECT forged;\n```',
          targetDialect: input.targetDialect,
          backendContext: input.context,
          createdAt: 1,
          updatedAt: 2
        },
        text: 'Reasoning\n\n```sql\nSELECT forged;\n```',
        reasoning: 'Reasoning',
        sql: 'SELECT forged;',
        provider: 'aiopsterm-local',
        durationMs: 1
      }
    }))
    await wrapper.find('.db-result-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-result-diagnose-error').text()).toContain('DB AI diagnosis backend returned malformed result data.')
    expect((editor.element as HTMLTextAreaElement).value).toBe('syntax_error')

    wrapper.unmount()
  })

  it('ignores stale SQL diagnosis completions after a newer request starts', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const editor = wrapper.find('.db-sql-editor')
    await editor.setValue('syntax_error')
    await wrapper.find('button[title="Run all"]').trigger('click')
    await waitForDatabaseSqlResult()

    let resolveFirstDiagnosis: (value: any) => void = () => undefined
    const firstDiagnosis = new Promise<any>((resolve) => {
      resolveFirstDiagnosis = resolve
    })
    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockImplementationOnce((input: any) =>
      firstDiagnosis.then(() => ({
        ok: true,
        data: {
          request: {
            id: input.requestId,
            action: 'diagnose',
            label: 'Diagnose SQL',
            status: 'done',
            contextSummary: '',
            sourceSql: input.sourceSql,
            text: 'Reasoning\n\n```sql\nSELECT stale;\n```',
            targetDialect: input.targetDialect,
            backendContext: input.context,
            createdAt: 1,
            updatedAt: 2
          },
          text: 'Reasoning\n\n```sql\nSELECT stale;\n```',
          reasoning: 'Reasoning',
          sql: 'SELECT stale;',
          provider: 'aiopsterm-local',
          durationMs: 1
        }
      }))
    )
    await wrapper.find('.db-result-error button').trigger('click')
    await flushPromises()
    const firstRequestId = vi.mocked(window.aiops.diagnoseDatabaseSqlError).mock.calls.at(-1)?.[0]?.requestId
    expect(firstRequestId).toMatch(/^dbai-diagnose-/)

    await wrapper.find('button[title="Run all"]').trigger('click')
    await waitForDatabaseSqlResult()

    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockImplementationOnce(async (input: any) => ({
      ok: true,
      data: {
        request: {
          id: input.requestId,
          action: 'diagnose',
          label: 'Diagnose SQL',
          status: 'done',
          contextSummary: '',
          sourceSql: input.sourceSql,
          text: 'Reasoning\n\n```sql\nSELECT fresh;\n```',
          targetDialect: input.targetDialect,
          backendContext: input.context,
          createdAt: 3,
          updatedAt: 4
        },
        text: 'Reasoning\n\n```sql\nSELECT fresh;\n```',
        reasoning: 'Reasoning',
        sql: 'SELECT fresh;',
        provider: 'aiopsterm-local',
        durationMs: 1
      }
    }))
    await wrapper.find('.db-result-error button').trigger('click')
    await flushPromises()
    const secondRequestId = vi.mocked(window.aiops.diagnoseDatabaseSqlError).mock.calls.at(-1)?.[0]?.requestId
    expect(secondRequestId).toMatch(/^dbai-diagnose-/)
    expect(secondRequestId).not.toBe(firstRequestId)
    expect((editor.element as HTMLTextAreaElement).value).toBe('SELECT fresh;')

    resolveFirstDiagnosis(null)
    await flushPromises()
    expect((editor.element as HTMLTextAreaElement).value).toBe('SELECT fresh;')
    expect(wrapper.find('.db-result-diagnose-success').text()).toContain('Diagnosed and replaced editor SQL')

    wrapper.unmount()
  })

  it('fails closed when Database DB AI bridges are missing or rejected', async () => {
    const wrapper = mount(DatabaseWorkspace, {
      attachTo: document.body,
      global: { plugins: [createPinia()] }
    })
    await waitForDatabaseCatalog()

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const editor = wrapper.find('.db-sql-editor')
    await editor.setValue('select id from "public"."orders";')

    const originalCreateDrawer = window.aiops.createDatabaseAiDrawerRequest
    const originalStartDrawer = window.aiops.startDatabaseAiDrawerResponse
    const originalGenerateDrawer = window.aiops.generateDatabaseAiDrawerResponse
    const originalCancelDrawer = window.aiops.cancelDatabaseAiDrawerResponse
    const originalCreatePane = window.aiops.createDatabaseAiPaneRequest
    const originalStartPane = window.aiops.startDatabaseAiPaneResponse
    const originalGeneratePane = window.aiops.generateDatabaseAiPaneResponse
    const originalCancelPane = window.aiops.cancelDatabaseAiPaneResponse
    const originalDiagnose = window.aiops.diagnoseDatabaseSqlError

    try {
      ;(window.aiops as any).createDatabaseAiDrawerRequest = undefined
      await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('DB AI drawer request service unavailable')
      expect(wrapper.find('.db-ai-drawer').exists()).toBe(false)
    } finally {
      ;(window.aiops as any).createDatabaseAiDrawerRequest = originalCreateDrawer
    }

    vi.mocked(window.aiops.createDatabaseAiDrawerRequest).mockRejectedValueOnce(new Error('drawer create rejected'))
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('drawer create rejected')
    expect(wrapper.find('.db-ai-drawer').exists()).toBe(false)

    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockClear()
    try {
      ;(window.aiops as any).startDatabaseAiDrawerResponse = undefined
      await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-ai-drawer').exists()).toBe(true)
      expect(wrapper.find('.db-ai-status').text()).toContain('Queued')
      expect(wrapper.find('.db-ai-status').text()).not.toContain('Error')
      expect(wrapper.text()).toContain('DB AI drawer start service unavailable')
      expect(window.aiops.generateDatabaseAiDrawerResponse).not.toHaveBeenCalled()
    } finally {
      ;(window.aiops as any).startDatabaseAiDrawerResponse = originalStartDrawer
    }
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    try {
      ;(window.aiops as any).generateDatabaseAiDrawerResponse = undefined
      await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
      expect(wrapper.find('.db-ai-status').text()).not.toContain('Error')
      expect(wrapper.text()).toContain('DB AI drawer response service unavailable')
    } finally {
      ;(window.aiops as any).generateDatabaseAiDrawerResponse = originalGenerateDrawer
    }
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockRejectedValueOnce(new Error('drawer response rejected'))
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await waitForDatabaseDbAiDone()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    expect(wrapper.find('.db-ai-status').text()).not.toContain('Error')
    expect(wrapper.text()).toContain('drawer response rejected')
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiDrawerResponse).mockImplementationOnce(() => new Promise(() => {}) as any)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    try {
      ;(window.aiops as any).cancelDatabaseAiDrawerResponse = undefined
      await wrapper.find('.db-ai-drawer footer').findAll('button').find((button) => button.text().includes('Cancel'))!.trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
      expect(wrapper.text()).toContain('DB AI drawer cancel service unavailable')
    } finally {
      ;(window.aiops as any).cancelDatabaseAiDrawerResponse = originalCancelDrawer
    }
    vi.mocked(window.aiops.cancelDatabaseAiDrawerResponse).mockRejectedValueOnce(new Error('drawer cancel rejected'))
    await wrapper.find('.db-ai-drawer footer').findAll('button').find((button) => button.text().includes('Cancel'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-ai-status').text()).toContain('Streaming')
    expect(wrapper.text()).toContain('drawer cancel rejected')
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    await wrapper.find('button[title="Toggle DB AI Pane"]').trigger('click')
    try {
      ;(window.aiops as any).createDatabaseAiPaneRequest = undefined
      await wrapper.find('.db-ai-pane-composer textarea').setValue('Summarize schema')
      await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('DB AI pane request service unavailable')
      expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(0)
    } finally {
      ;(window.aiops as any).createDatabaseAiPaneRequest = originalCreatePane
    }

    vi.mocked(window.aiops.createDatabaseAiPaneRequest).mockRejectedValueOnce(new Error('pane create rejected'))
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Summarize schema')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('pane create rejected')
    expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(0)

    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockClear()
    try {
      ;(window.aiops as any).startDatabaseAiPaneResponse = undefined
      await wrapper.find('.db-ai-pane-composer textarea').setValue('Start pane missing')
      await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.db-ai-pane-message')).toHaveLength(2)
      expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Queued')
      expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('Error')
      expect(wrapper.text()).toContain('DB AI pane start service unavailable')
      expect(window.aiops.generateDatabaseAiPaneResponse).not.toHaveBeenCalled()
    } finally {
      ;(window.aiops as any).startDatabaseAiPaneResponse = originalStartPane
    }
    await wrapper.find('.db-ai-pane-composer-actions button[title="Reset conversation"]').trigger('click')

    try {
      ;(window.aiops as any).generateDatabaseAiPaneResponse = undefined
      await wrapper.find('.db-ai-pane-composer textarea').setValue('Generate pane missing')
      await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
      expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('Error')
      expect(wrapper.text()).toContain('DB AI pane response service unavailable')
    } finally {
      ;(window.aiops as any).generateDatabaseAiPaneResponse = originalGeneratePane
    }
    await wrapper.find('.db-ai-pane-composer-actions button[title="Reset conversation"]').trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockRejectedValueOnce(new Error('pane response rejected'))
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Generate pane rejected')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('Error')
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).not.toContain('pane response rejected')
    expect(wrapper.text()).toContain('pane response rejected')
    await wrapper.find('.db-ai-pane-composer-actions button[title="Reset conversation"]').trigger('click')

    vi.mocked(window.aiops.generateDatabaseAiPaneResponse).mockImplementationOnce(() => new Promise(() => {}) as any)
    await wrapper.find('.db-ai-pane-composer textarea').setValue('Cancel pane rejected')
    await wrapper.find('.db-ai-pane-composer-actions .primary').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    try {
      ;(window.aiops as any).cancelDatabaseAiPaneResponse = undefined
      await wrapper.find('.db-ai-pane-composer-actions button[title="Stop response"]').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
      expect(wrapper.text()).toContain('DB AI pane cancel service unavailable')
    } finally {
      ;(window.aiops as any).cancelDatabaseAiPaneResponse = originalCancelPane
    }
    vi.mocked(window.aiops.cancelDatabaseAiPaneResponse).mockRejectedValueOnce(new Error('pane cancel rejected'))
    await wrapper.find('.db-ai-pane-composer-actions button[title="Stop response"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.db-ai-pane-message').at(1)!.text()).toContain('Streaming')
    expect(wrapper.text()).toContain('pane cancel rejected')
    await wrapper.find('.db-ai-pane-composer-actions button[title="Reset conversation"]').trigger('click')

    await editor.setValue('syntax_error')
    try {
      ;(window.aiops as any).diagnoseDatabaseSqlError = undefined
      await wrapper.find('button[title="Run all"]').trigger('click')
      await waitForDatabaseSqlResult()
      await wrapper.find('.db-result-error button').trigger('click')
      await flushPromises()
      expect(wrapper.find('.db-result-diagnose-error').text()).toContain('DB AI diagnosis service unavailable')
      expect((editor.element as HTMLTextAreaElement).value).toBe('syntax_error')
    } finally {
      ;(window.aiops as any).diagnoseDatabaseSqlError = originalDiagnose
    }

    vi.mocked(window.aiops.diagnoseDatabaseSqlError).mockRejectedValueOnce(new Error('diagnosis rejected'))
    await wrapper.find('.db-result-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.db-result-diagnose-error').text()).toContain('diagnosis rejected')
    expect((editor.element as HTMLTextAreaElement).value).toBe('syntax_error')

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
    expect(window.aiops.openSettingsDocumentation).toHaveBeenCalled()

    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    expect(workspace.find('.settings-documentation-page').exists()).toBe(true)
    expect(workspace.find('.settings-documentation-markdown').text()).toContain('aiopsterm Docs')
    vi.mocked(window.aiops.openSettingsDocumentation).mockClear()
    await workspace.find('.settings-documentation-markdown a').trigger('click')
    await flushPromises()
    expect(window.aiops.openSettingsDocumentation).toHaveBeenCalledWith({
      documentPath: 'usage/index.md',
      basePath: '/tmp/aiopsterm/docs/zh-CN/index.md'
    })
    expect(workspace.find('.settings-documentation-markdown').text()).toContain('Usage Docs')
    await workspace.find('.settings-documentation-toolbar .settings-button').trigger('click')
    await workspace.vm.$nextTick()

    expect(workspace.text()).toContain('基础设置')
    const generalHelpButton = workspace.find('.settings-page-help-button')
    expect(generalHelpButton.exists()).toBe(true)
    expect(generalHelpButton.attributes('aria-label')).toBe('打开本页帮助文档')
    vi.mocked(window.aiops.openSettingsDocumentation).mockClear()
    await generalHelpButton.trigger('click')
    await flushPromises()
    expect(window.aiops.openSettingsDocumentation).toHaveBeenCalledWith({ page: 'general', locale: 'zh-CN' })
    expect(workspace.find('.settings-documentation-page').exists()).toBe(true)
    expect(workspace.find('.settings-documentation-markdown').text()).toContain('通用设置')
    expect(workspace.find('.settings-documentation-markdown').text()).toContain('主题控制应用主题')
    await workspace.find('.settings-documentation-toolbar .settings-button').trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.find('.settings-documentation-page').exists()).toBe(false)
    await store.updateLanguage('en-US')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.find('.settings-page-help-button').attributes('aria-label')).toBe('Open this settings page help document')
    vi.mocked(window.aiops.openSettingsDocumentation).mockClear()
    await workspace.find('.settings-page-help-button').trigger('click')
    await flushPromises()
    expect(window.aiops.openSettingsDocumentation).toHaveBeenCalledWith({ page: 'general', locale: 'en-US' })
    expect(workspace.find('.settings-documentation-markdown').text()).toContain('General Settings')
    await workspace.find('.settings-documentation-toolbar .settings-button').trigger('click')
    await workspace.vm.$nextTick()
    await store.updateLanguage('zh-CN')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('默认背景')
    expect(workspace.text()).toContain('自定义上传（支持JPG、PNG、WebP、GIF）')
    expect(workspace.text()).toContain('Termius Light')
    expect(workspace.text()).toContain('Kanagawa Dragon')
    expect(workspace.text()).toContain('Catppuccin Latte')
    expect(workspace.text()).toContain('打开入门引导')
    const generatedBackgroundPreset = settingsBackgroundPresets.find((preset) => preset.id === 'aurora-glass-image')
    expect(generatedBackgroundPreset?.image).toContain('aurora-glass')
    expect(workspace.findAll('.settings-bg-tile.preset')).toHaveLength(settingsBackgroundPresets.length)
    const generatedBackgroundTile = workspace.findAll('.settings-bg-tile.preset').at(settingsBackgroundPresets.findIndex((preset) => preset.id === 'aurora-glass-image'))!
    expect(generatedBackgroundTile.attributes('style')).toContain('aurora-glass')
    await generatedBackgroundTile.trigger('click')
    await flushPromises()
    expect(store.config.background.mode).toBe('preset')
    expect(store.config.background.image).toBe('aurora-glass-image')
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
    expect(store.config.background.opacity).toBe(0.68)
    expect(store.config.background.brightness).toBe(0.92)
    await workspace.find('.settings-sliders input[type="range"]').setValue('0.5')
    await flushPromises()
    expect(store.config.background.opacity).toBe(0.5)
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/settings-custom-bg.webp'] })
    vi.mocked(window.aiops.saveCustomBackground).mockResolvedValueOnce({
      filePath: '/tmp/aiopsterm/backgrounds/settings-custom-bg.webp',
      url: 'aiopsterm-background://local/settings-custom-bg.webp',
      name: 'settings-custom-bg.webp',
      size: 256,
      bytes: 256,
      mtimeMs: 1717200000000
    })
    await workspace.find('.settings-bg-tile.upload').trigger('click')
    await flushPromises()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    expect(window.aiops.saveCustomBackground).toHaveBeenCalledWith('/tmp/settings-custom-bg.webp')
    expect(store.config.background.mode).toBe('custom')
    expect(store.config.background.image).toBe('aiopsterm-background://local/settings-custom-bg.webp')
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
    expect(workspace.find('.settings-page-help-button').exists()).toBe(true)
    expect(workspace.text()).toContain('终端类型')
    expect(workspace.text()).toContain('字体只有系统已安装或能匹配到对应字体时才会明显变化')
    expect(workspace.text()).toContain('DejaVu Sans Mono')
    expect(workspace.text()).toContain('Liberation Mono')
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
    expect(workspace.findAll('.settings-form-row').some((row) => row.text().includes('代理设置'))).toBe(false)

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('模型'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.find('.settings-page-help-button').exists()).toBe(true)
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
    const openAiInputs = openAiCard.findAll('.settings-input')
    const openAiApiKeyInput = openAiInputs[1]
    expect((openAiApiKeyInput.element as HTMLInputElement).type).toBe('password')
    await openAiApiKeyInput.setValue('sk-visible-test')
    const openAiSecretToggle = openAiCard.find('[data-testid="provider-secret-toggle-openai-apiKey"]')
    expect(openAiSecretToggle.exists()).toBe(true)
    await openAiSecretToggle.trigger('click')
    expect((openAiApiKeyInput.element as HTMLInputElement).type).toBe('text')
    expect((openAiApiKeyInput.element as HTMLInputElement).value).toBe('sk-visible-test')
    await openAiSecretToggle.trigger('click')
    expect((openAiApiKeyInput.element as HTMLInputElement).type).toBe('password')
    await openAiInputs[0].setValue('https://ark.example.test/api/coding/v3#')
    await workspace.vm.$nextTick()
    expect(openAiCard.text()).toContain('Preview: https://ark.example.test/api/coding/v3/responses')
    const openAiFormatSelect = openAiCard.find('.settings-select')
    await openAiFormatSelect.setValue('chat-completions')
    await workspace.vm.$nextTick()
    expect(openAiCard.text()).toContain('Preview: https://ark.example.test/api/coding/v3/chat/completions')
    await openAiInputs[0].setValue('https://api.openai.com')
    await openAiFormatSelect.setValue('responses')
    await openAiApiKeyInput.setValue('')
    await workspace.vm.$nextTick()
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
    vi.mocked(window.aiops.checkModelProvider).mockResolvedValueOnce({
      ok: true,
      data: {
        provider: 'openai',
        label: 'OpenAI Compatible',
        modelId: 'other-model',
        endpoint: 'https://api.openai.com/v1/responses',
        message: 'This malformed check must not be shown.',
        durationMs: 1
      }
    } as any)
    await openAiCard.findAll('button').find((button) => button.text() === 'Check')!.trigger('click')
    await flushPromises()
    expect(store.modelCheckState.openai).toBe('error')
    expect(store.settingsNotice).toBe('模型 Provider 检查服务返回数据无效')
    expect(workspace.text()).toContain('模型 Provider 检查服务返回数据无效')
    expect(workspace.text()).not.toContain('This malformed check must not be shown.')

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('AI 偏好设置'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.find('.settings-page-help-button').exists()).toBe(true)
    expect(workspace.text()).toContain('启用 Extended Thinking')
    expect(workspace.text()).toContain('OpenAI Reasoning Effort')
    expect(workspace.text()).toContain('AI 会话休眠')
    expect(workspace.text()).toContain('通知')
    expect(workspace.text()).toContain('自动化与开发者')
    const shellTimeoutRow = workspace.findAll('.settings-form-row.full-label').find((row) => row.text().includes('Shell Integration Timeout'))!
    expect(shellTimeoutRow.find('.settings-number.wide').attributes('max')).toBe('300')
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
    await workspace.findAll('.settings-checkbox-item').find((row) => row.text().includes('自动执行只读命令'))!.find('input').setValue(true)
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

  it('renders readable model management rows with provider identity and editable display names', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    await enableCatalogModelOptions(store)
    store.setActiveSettingsSection('models')
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.vm.$nextTick()

    expect(workspace.find('.model-names-card').exists()).toBe(true)
    expect(workspace.text()).toContain('Ollama Coder')
    expect(workspace.text()).toContain('qwen2.5-coder')
    expect(workspace.text()).toContain('Ollama')
    expect(workspace.text()).toContain('管理名称')
    const aliasInput = workspace.findAll('.model-alias-input').find((input) => (input.element as HTMLInputElement).value === 'Ollama Coder')!
    expect(aliasInput.exists()).toBe(true)

    await aliasInput.setValue('Volcano Ark Code')
    await aliasInput.trigger('blur')
    await flushPromises()

    expect(store.settingModelOptions.find((model) => model.name === 'qwen2.5-coder')?.displayName).toBe('Volcano Ark Code')
    expect(workspace.text()).toContain('Volcano Ark Code')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          options: expect.arrayContaining([expect.objectContaining({ name: 'qwen2.5-coder', displayName: 'Volcano Ark Code' })])
        })
      })
    )

    workspace.unmount()
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
    await expect(store.selectBackground('none')).resolves.toBe(true)
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
    expect((opacityInput.element as HTMLInputElement).value).toBe('0.68')

    vi.mocked(window.aiops.saveConfig).mockResolvedValueOnce({
      ...store.config,
      background: { ...store.config.background }
    })
    await opacityInput.setValue('0.65')
    await flushPromises()
    expect(store.settingsNotice).toBe('背景设置保存失败')
    expect(store.config.background.opacity).toBe(0.68)
    expect((opacityInput.element as HTMLInputElement).value).toBe('0.68')

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/rejected-bg.webp'] })
    vi.mocked(window.aiops.saveCustomBackground).mockResolvedValueOnce({
      filePath: '/tmp/aiopsterm/backgrounds/rejected-bg.webp',
      url: 'aiopsterm-background://local/rejected-bg.webp',
      name: 'rejected-bg.webp',
      size: 256,
      bytes: 256,
      mtimeMs: 1717200000000
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

  it('renders AI session agent hook installer controls and calls the bridge explicitly', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('ai')
    vi.mocked(window.aiops.listAgentHookInstallers).mockClear()
    vi.mocked(window.aiops.installAgentHook).mockClear()

    await store.refreshAgentHookInstallers()
    await workspace.vm.$nextTick()

    expect(window.aiops.listAgentHookInstallers).toHaveBeenCalled()
    expect(workspace.find('.agent-hook-installer-card').exists()).toBe(true)
    expect(workspace.text()).toContain('Agent Hook 安装器')
    expect(workspace.text()).toContain('Codex / Claude Code 会话管理 Hook')
    expect(workspace.text()).toContain('/home/test/.codex/hooks.json')
    expect(workspace.text()).toContain('/home/test/.claude/settings.json')
    expect(workspace.text()).toContain('OpenCode')
    expect(workspace.text()).toContain('Amp')
    expect(workspace.text()).toContain('Rovo Dev')
    expect(workspace.findAll('.agent-hook-installer-row').length).toBeGreaterThanOrEqual(15)
    expect(workspace.text()).toContain('只会捕获通过 aiopsterm 本地连接终端启动的会话')

    const codexRow = workspace.findAll('.agent-hook-installer-row').find((row) => row.text().includes('Codex'))!
    expect(codexRow.text()).toContain('可安装')
    await codexRow.findAll('button').find((button) => button.text() === '安装')!.trigger('click')
    await flushPromises()
    expect(window.aiops.installAgentHook).toHaveBeenCalledWith({ source: 'codex' })
    expect(store.agentHookInstallers.find((installer) => installer.source === 'codex')?.installed).toBe(true)
    expect(workspace.text()).toContain('已安装')
  })

  it('persists AI hibernation and notification settings from the AI preferences page', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()
    store.setActiveSettingsSection('ai')
    vi.mocked(window.aiops.setAgentHibernationConfig).mockClear()
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.vm.$nextTick()
    await flushPromises()

    const row = (label: string) => workspace.findAll('.settings-form-row.full-label').find((item) => item.text().includes(label))!
    expect(row('空闲时间').exists()).toBe(true)
    await row('空闲时间').find('input.settings-number').setValue('120')
    await flushPromises()
    expect(window.aiops.setAgentHibernationConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        idleSeconds: 120,
        maxLiveTerminals: 12,
        confirmationSeconds: 60
      })
    )
    expect(store.agentHibernationConfig.idleSeconds).toBe(120)

    const desktopNotification = workspace.findAll('.settings-checkbox-item').find((item) => item.text().includes('桌面通知'))!.find('input')
    expect((desktopNotification.element as HTMLInputElement).checked).toBe(true)
    await desktopNotification.setValue(false)
    await flushPromises()

    expect(store.notificationSettings.desktopNotifications).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({
          desktopNotifications: false,
          controlNotificationBell: true
        })
      })
    )

    workspace.unmount()
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
      expect(workspace.find('.settings-page-help-button').exists()).toBe(true)
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
    const mcpToolInput = workspace.find('.mcp-tool-item .mcp-operation-input')
    expect((mcpToolInput.element as HTMLTextAreaElement).placeholder).toContain('"path"')
    await mcpToolInput.setValue('{"path":"/tmp/readme.md"}')
    vi.mocked(window.aiops.callMcpTool).mockClear()
    await workspace.find('.mcp-operation-actions .settings-button.primary').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.callMcpTool).toHaveBeenCalledWith('filesystem', 'read_file', { path: '/tmp/readme.md' })
    expect(workspace.text()).toContain('MCP tool filesystem:read_file executed.')
    expect(workspace.text()).toContain('Result')

    await workspace.findAll('.settings-tab-bar button').find((button) => button.text().includes('Resources'))!.trigger('click')
    await workspace.vm.$nextTick()
    vi.mocked(window.aiops.readMcpResource).mockClear()
    await workspace.find('.mcp-resource-header .settings-button.primary').trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.readMcpResource).toHaveBeenCalledWith('filesystem', 'file:///workspace')
    expect(workspace.text()).toContain('MCP resource file:///workspace')

    await workspace.findAll('.settings-tab-bar button').find((button) => button.text().includes('Tools'))!.trigger('click')
    await workspace.vm.$nextTick()
    await workspace.find('.mcp-tool-header button').trigger('click')
    await flushPromises()
    expect(store.mcpServers[0].tools[0].enabled).toBe(false)
    expect(window.aiops.setMcpToolState).toHaveBeenCalledWith('filesystem', 'read_file', false)

    vi.mocked(window.aiops.setMcpToolAutoApprove).mockClear()
    const autoApproveInput = workspace.find('.mcp-auto-approve-row input')
    expect((autoApproveInput.element as HTMLInputElement).checked).toBe(false)
    await autoApproveInput.setValue(true)
    await flushPromises()
    await workspace.vm.$nextTick()
    expect(window.aiops.setMcpToolAutoApprove).toHaveBeenCalledWith('filesystem', 'read_file', true)
    expect(store.mcpServers[0].tools[0].autoApprove).toBe(true)
    expect((workspace.find('.mcp-auto-approve-row input').element as HTMLInputElement).checked).toBe(true)

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
    const dataSyncRadios = workspace.findAll('input[name="dataSync"]')
    await dataSyncRadios[0].setValue(true)
    await flushPromises()
    expect(store.privacySettings.dataSyncStatus).toBe('synced')
    expect(workspace.text()).toContain('Runtime:')
    expect(workspace.text()).toContain('local-file')
    expect(workspace.text()).toContain('Status:')
    expect(workspace.text()).toContain('synced')
    expect(workspace.text()).toContain('Scopes:')
    expect(workspace.text()).toContain('config')
    expect(workspace.text()).toContain('/tmp/aiopsterm/data-sync-runtime.json')
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
    await clickNav('可信设备')
    expect(workspace.text()).toContain('登录后可查看和管理当前账户的可信设备。')
    expect(workspace.text()).not.toContain('Linux Workstation')
    vi.mocked(window.aiops.openUserLogin).mockClear()
    await workspace.find('.trusted-devices-card.settings-empty-state .settings-button.primary').trigger('click')
    await flushPromises()
    expect(window.aiops.openUserLogin).toHaveBeenCalled()

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
    await workspace.findAll('.diagnostics-card .settings-button').find((button) => button.text().includes('Open Feedback Report'))!.trigger('click')
    expect(window.aiops.submitSettingsFeedbackReport).toHaveBeenCalled()
  })
})
