import { describe, expect, it, vi } from 'vitest'
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

const { mockXtermInstances } = vi.hoisted(() => ({
  mockXtermInstances: [] as MockXtermInstance[]
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
import ExtensionsPanel from '@/components/panels/ExtensionsPanel.vue'
import KubernetesPanel from '@/components/panels/KubernetesPanel.vue'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import SnippetsPanel from '@/components/panels/SnippetsPanel.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'
import OnboardingSpotlight from '@/components/onboarding/OnboardingSpotlight.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { initialFileSessions } from '@/data/mockData'
import type { KeywordHighlightUserConfig } from '@shared/preload'

describe('AppShell', () => {
  it('renders primary product surfaces', () => {
    const wrapper = mount(AppShell, {
      global: {
        plugins: [createPinia()],
        stubs: {
          teleport: true
        }
      }
    })

    expect(wrapper.text()).toContain('aiopsterm')
    expect(wrapper.text()).toContain('直接连接')
    expect(wrapper.text()).toContain('堡垒机资源')
    expect(wrapper.text()).toContain('prod-bastion')
    expect(wrapper.text()).toContain('智能助手')
    expect(wrapper.text()).toContain('local shell')
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
    let assetFormInputs = assets.findAll('.asset-form-panel input')
    await assetFormInputs.at(0)!.setValue('unit-host')
    await assetFormInputs.at(1)!.setValue('10.10.10.10')
    await assetFormInputs.at(2)!.setValue('ops')
    await assetFormInputs.at(4)!.setValue('测试')
    await assetFormInputs.at(5)!.setValue('2222')
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    expect(assets.text()).toContain('unit-host')

    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.trigger('dblclick')
    expect(store.activePanel.title).toBe('unit-host')
    expect(store.activePanel.output).toContain('[mock ssh] unit-host')

    await assets.findAll('.host-card').find((button) => button.text().includes('unit-host'))!.find('button[title="删除"]').trigger('click')
    expect(assets.find('.asset-confirm-modal').text()).toContain('删除主机')
    expect(assets.find('.asset-confirm-modal footer .danger').attributes('disabled')).toBeDefined()
    await assets.find('.asset-confirm-modal input').setValue('unit-host')
    await assets.find('.asset-confirm-modal footer .danger').trigger('click')
    expect(assets.text()).not.toContain('unit-host')

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
    expect((assets.find('.asset-form-panel input').element as HTMLInputElement).value).toBe('onboarding-demo')
    expect(assets.find('[data-onboarding-id="asset-form-fields"]').exists()).toBe(true)
    await assets.find('[data-onboarding-id="asset-form-submit"]').trigger('click')
    expect(store.onboardingActiveStep?.id).toBe('connect-asset')

    const keys = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await keys.findAll('.asset-management-item').find((button) => button.text().includes('密钥管理'))!.trigger('click')
    expect(keys.text()).toContain('prod-ed25519')
    await keys.find('[data-testid="key-new-button"]').trigger('click')
    expect(keys.text()).toContain('新建密钥')
    await keys.find('.key-form-panel input').setValue('unit-key')
    await keys.find('.key-form-panel textarea').setValue('ssh-ed25519 AAAA unit')
    await keys.find('.key-form-panel .asset-submit-button').trigger('click')
    expect(keys.text()).toContain('unit-key')
    await keys.findAll('.keychain-card').find((button) => button.text().includes('unit-key'))!.trigger('contextmenu', {
      clientX: 310,
      clientY: 210
    })
    expect(keys.find('.asset-context-menu').text()).toContain('删除')
    await keys.find('.asset-context-menu .delete').trigger('click')
    expect(keys.find('.asset-confirm-modal').text()).toContain('删除密钥')
    await keys.find('.asset-confirm-modal input').setValue('unit-key')
    await keys.find('.asset-confirm-modal footer .danger').trigger('click')
    expect(keys.text()).not.toContain('unit-key')

    const knowledge = mount(KnowledgePanel, {
      props: { query: 'Markdown' },
      global: { plugins: [createPinia()] }
    })
    expect(knowledge.text()).toContain('Markdown语法指南.md')
    expect(knowledge.text()).not.toContain('interface.png')
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

    expect(assets.text()).toContain('组织资产管理')
    await assets.findAll('.asset-management-item').find((button) => button.text().includes('主机管理'))!.trigger('click')

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
        username: 'root',
        ip: '10.24.8.12',
        label: 'prod-bastion',
        group_name: '生产',
        auth_type: 'password',
        port: 22
      })
    ])
    expect(assets.find('.export-assets-modal').exists()).toBe(false)

    const originalFileReader = window.FileReader
    const originalGlobalFileReader = globalThis.FileReader
    const importPayload = JSON.stringify([
      { username: 'root', ip: '10.24.8.12', label: 'prod-bastion-imported', group_name: '生产', port: 22 },
      { username: 'ops', ip: '10.55.0.9', label: 'imported-json', group_name: 'Imported', port: 2200 }
    ])
    class MockAssetImportFileReader {
      result = importPayload
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      readAsText() {
        this.onload?.()
      }
    }
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: MockAssetImportFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: MockAssetImportFileReader })
    const importFile = new File(
      [importPayload],
      'external-reference-assets.json',
      { type: 'application/json' }
    )
    const input = assets.find('input.asset-hidden-file-input')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [importFile]
    })
    await input.trigger('change')
    await flushPromises()
    expect(assets.find('.import-assets-modal').text()).toContain('其中 1 个与现有主机重复')
    expect(assets.find('.import-assets-modal').text()).toContain('imported-json')
    await assets.findAll('.import-assets-modal footer button').find((button) => button.text().includes('跳过重复'))!.trigger('click')
    expect(assets.text()).toContain('imported-json')
    expect(assets.text()).not.toContain('prod-bastion-imported')
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })

    const managed = mount(AssetsPanel, {
      props: { query: '' },
      global: { plugins: [pinia] }
    })
    await managed.findAll('.asset-management-item').find((button) => button.text().includes('组织资产管理'))!.trigger('click')
    expect(managed.text()).toContain('全部组织资产')
    expect(managed.find('.asset-table-footer').text()).toContain('共 4 条')
    await managed.find('.asset-table-toolbar .asset-search-input input').setValue('mysql')
    expect(managed.text()).toContain('mysql-primary')
    expect(managed.text()).not.toContain('prod-bastion')
    await managed.find('.asset-search-clear').trigger('click')
    await managed.findAll('.asset-table-toolbar .asset-action-button').find((button) => button.text().includes('添加资产'))!.trigger('click')
    await managed.findAll('.managed-asset-form input').at(0)!.setValue('managed-unit')
    await managed.findAll('.managed-asset-form input').at(1)!.setValue('10.77.0.7')
    await managed.find('.managed-asset-form textarea').setValue('手动组织资产')
    await managed.find('.managed-asset-form .asset-submit-button').trigger('click')
    expect(managed.text()).toContain('managed-unit')
    await managed.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('managed-unit'))!.find('input[type="checkbox"]').setValue(true)
    await managed.findAll('.asset-table-toolbar .asset-action-button').find((button) => button.text().includes('批量删除'))!.trigger('click')
    expect(managed.find('.asset-confirm-modal').text()).toContain('批量删除主机')
    await managed.find('.asset-confirm-modal footer .danger').trigger('click')
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
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('刷新资产'))!.trigger('click')
    expect(organization.text()).toContain('jumpserver-org-synced-asset')
    await organization.findAll('.host-card').find((button) => button.text().includes('jumpserver-org'))!.trigger('contextmenu', {
      clientX: 220,
      clientY: 180
    })
    await organization.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('管理资产'))!.trigger('click')
    expect(organization.text()).toContain('管理资产 · jumpserver-org')
    await organization.findAll('.asset-table-scroll tbody tr').find((row) => row.text().includes('jumpserver-org-synced-asset'))!.findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
    expect((organization.findAll('.managed-asset-form input').at(0)!.element as HTMLInputElement).disabled).toBe(true)
    expect((organization.findAll('.managed-asset-form input').at(1)!.element as HTMLInputElement).disabled).toBe(true)
    await organization.find('.managed-asset-form textarea').setValue('刷新备注')
    await organization.find('.managed-asset-form .asset-submit-button').trigger('click')
    expect(organization.text()).toContain('刷新备注')
  })

  it('matches External reference-style SSH resource tree tabs, display toggle, refresh, and context actions', async () => {
    vi.useFakeTimers()
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WorkspacePanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    try {
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
      expect(filesPanel.find('.workspace-button').attributes('title')).toBe('显示主机名')
      expect(filesPanel.text()).toContain('10.24.8.12')

      await wrapper.findAll('.workspace-folder-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
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
      expect(remounted.text()).not.toContain('prod-bastion')
      remounted.unmount()

      await filesPanel.vm.$nextTick()
      expect(filesPanel.text()).not.toContain('10.24.8.12')
      expect(filesPanel.text()).not.toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
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
      expect(store.workspacePreferences.showIpMode).toBe(false)
      expect(window.aiops.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePreferences: expect.objectContaining({ showIpMode: false })
        })
      )
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('prod-bastion')
      expect(wrapper.text()).not.toContain('10.24.8.12')

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
      expect(filesPanel.find('.files-comment-edit').exists()).toBe(false)
      expect(filesPanel.text()).toContain('(新备注)')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
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
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-source-tabs button').find((button) => button.text().includes('直接连接'))!.trigger('click')
      expect(filesPanel.text()).toContain('Local')
      expect(filesPanel.text()).toContain('prod-bastion')
      expect(filesPanel.text()).toContain('核心业务')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('核心业务'))!.trigger('click')
      expect(filesPanel.text()).toContain('staging-files')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('staging-files'))!.trigger('contextmenu')
      expect(filesPanel.find('.asset-context-menu').text()).toContain('从文件夹移除')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('从文件夹移除'))!.trigger('click')
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
      expect(filesPanel.find('.files-folder-modal').exists()).toBe(false)
      expect(filesPanel.text()).toContain('临时归档')
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('临时归档'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('文件夹内 1 个资产将移出文件夹')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.folderUuid).toBeUndefined()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.group).toBe('最近连接')
      expect(filesPanel.text()).not.toContain('临时归档')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('最近连接'))!.trigger('click')
      expect(filesPanel.text()).toContain('prod-bastion')
      await filesPanel.findAll('.files-tree-group-row').find((row) => row.text().includes('核心业务'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('删除文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-confirm').text()).toContain('确定删除文件夹 核心业务')
      await filesPanel.find('.files-folder-confirm footer .danger').trigger('click')
      expect(filesPanel.text()).not.toContain('核心业务')
      await filesPanel.findAll('.files-tree-session').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      await filesPanel.find('.asset-context-menu').findAll('button').find((button) => button.text().includes('移动到文件夹'))!.trigger('click')
      expect(filesPanel.find('.files-folder-modal').text()).toContain('暂无文件夹')
      await filesPanel.find('.files-folder-empty button').trigger('click')
      expect(filesPanel.find('.files-folder-modal').text()).toContain('创建文件夹')
      await filesPanel.find('.files-folder-form input').setValue('新建文件夹')
      await filesPanel.find('.files-folder-form textarea').setValue('从移动弹窗创建')
      await filesPanel.find('.files-folder-form').trigger('submit')
      expect(filesPanel.text()).toContain('新建文件夹')

      await wrapper.findAll('.workspace-tabs button').find((button) => button.text().includes('堡垒机资源'))!.trigger('click')
      expect(wrapper.text()).toContain('jumpserver-org')
      await wrapper.find('.workspace-row-action.refresh').trigger('click')
      expect(wrapper.text()).toContain('正在刷新堡垒机资源')

      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('contextmenu')
      expect(wrapper.find('.workspace-node-menu').exists()).toBe(true)
      await wrapper.find('.workspace-node-menu').findAll('button').find((button) => button.text().includes('编辑备注'))!.trigger('click')
      expect(wrapper.text()).not.toContain('(生产入口)')

      await wrapper.findAll('.workspace-host-row').find((row) => row.text().includes('prod-bastion'))!.trigger('dblclick')
      expect(store.activePanel.title).toBe('prod-bastion')
      expect(store.activePanel.output).toContain('[mock ssh] prod-bastion')
      expect(store.selectedContexts.some((context) => context.id === 'asset-1')).toBe(true)
      filesPanel.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches External reference-style user menu and user info card interactions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const rail = mount(SideRail, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

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

    await panel.find('button[title="编辑"]').trigger('click')
    await panel.findAll('.user-info-form input').at(0)!.setValue('Ops Lead')
    await panel.find('button[title="保存"]').trigger('click')
    expect(store.userProfile.name).toBe('Ops Lead')

    await panel.find('button[title="修改邮箱"]').trigger('click')
    await panel.find('.user-modal-card input').setValue('ops@example.local')
    await panel.findAll('.user-modal-card input').at(1)!.setValue('123456')
    await panel.find('.user-modal-card footer .primary').trigger('click')
    expect(store.userProfile.email).toBe('ops@example.local')

    await panel.find('button[title="重置密码"]').trigger('click')
    await panel.find('.user-modal-card input[type="password"]').setValue('Aa123456!')
    await panel.findAll('.user-modal-card input[type="password"]').at(1)!.setValue('Aa123456!')
    await panel.find('.user-modal-card footer .primary').trigger('click')
    expect(store.userNotice).toContain('密码重置')

    await panel.find('.user-avatar.large').trigger('click')
    await panel.find('.avatar-settings-modal input').setValue('OP')
    await panel.find('.avatar-settings-modal footer .primary').trigger('click')
    expect(store.userProfile.avatarInitials).toBe('OP')

    await panel.find('.user-info-footer .danger').trigger('click')
    expect(store.userProfile.skippedLogin).toBe(true)
    await panel.vm.$nextTick()
    expect(panel.text()).toContain('请先登录')
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
      store.conversations = Array.from({ length: 25 }, (_, index) => ({
        id: `conv-page-${index + 1}`,
        title: `分页会话 ${index + 1}`,
        summary: `summary ${index + 1}`,
        updatedAt: index === 0 ? '刚刚' : '今天',
        ts: 10_000 - index,
        ipAddress: index === 0 ? '10.0.0.1' : undefined
      }))
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.conversation-item')).toHaveLength(20)
      expect(wrapper.text()).toContain('分页会话 20')
      expect(wrapper.text()).not.toContain('分页会话 21')
      expect(wrapper.text()).not.toContain('summary 1')

      const loadMorePromise = wrapper.find('.load-more-btn').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.load-more-btn').text()).toContain('加载中')
      await vi.advanceTimersByTimeAsync(300)
      await loadMorePromise
      await wrapper.vm.$nextTick()
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

      store.conversations = [
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
      await wrapper.find('.agents-search input').setValue('')
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('10:30')
      expect(wrapper.text()).toContain('3天前')
      expect(wrapper.text()).toContain('05/25')

      await wrapper.find('.agents-search input').setValue('conv-2')
      expect(wrapper.text()).toContain('K8s 发布失败')
      expect(wrapper.text()).not.toContain('生产巡检')
      expect(wrapper.text()).not.toContain('检查 Pod 事件和镜像拉取')

      await wrapper.find('.conversation-item').trigger('click')
      expect(store.selectedConversationId).toBe('conv-2')

      await wrapper.find('.delete-btn').trigger('click')
      expect(store.conversations.some((conversation) => conversation.id === 'conv-2')).toBe(false)

      await wrapper.find('.new-chat-btn').trigger('click')
      expect(store.selectedConversationId).toMatch(/^conv-/)
      expect(store.chatMessages.at(-1)?.text).toContain('请输入本次运维目标')
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
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
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
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
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
    await wrapper.vm.$nextTick()
    await findContextButton('commands')!.trigger('click')
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
    await wrapper.vm.$nextTick()

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
    expect(store.config.modelName).toBe('mock-ops-agent')
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
    expect(store.config.modelName).toBe('mock-ops-agent')

    const modelSearchInput = wrapper.find('.ai-model-popup header input')
    expect(modelSearchInput.exists()).toBe(true)
    await modelSearchInput.setValue('qwen')
    expect(wrapper.find('.ai-model-popup .select-list').text()).toContain('qwen2.5-coder')
    expect(wrapper.find('.ai-model-popup .select-list').text()).not.toContain('gpt-5')
    await modelSearchInput.trigger('keydown', { key: 'Enter' })
    expect(store.config.modelName).toBe('qwen2.5-coder')
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
    expect(store.config.modelName).toBe('gpt-5-Thinking')
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
    pathTextNode.remove()
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
    expect(voiceButton.attributes('title')).toBe('语音输入暂未启用')
    expect(voiceButton.attributes('disabled')).toBeUndefined()
    const fileUploadButton = wrapper.find('[data-testid="ai-file-upload-button"]')
    expect(fileUploadButton.exists()).toBe(true)
    expect(fileUploadButton.attributes('title')).toBe('上传文件暂未启用')
    expect(fileUploadButton.attributes('disabled')).toBeUndefined()
    await fileUploadButton.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.input-placeholder-notice').text()).toContain('文件上传为本地占位')
    await voiceButton.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.input-placeholder-notice').text()).toContain('语音输入为本地占位')

    const markdownContext = store.selectedContexts.find((context) => context.label === 'Markdown语法指南.md')!
    await wrapper.find(`.chat-editable [data-context-id="${markdownContext.id}"] button`).trigger('click')
    expect(store.selectedContexts.some((context) => context.id === markdownContext.id)).toBe(false)

    await wrapper.find('.context-trigger-tag').trigger('click')
    const docsCategoryAgain = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('文档'))
    await docsCategoryAgain!.trigger('click')
    await wrapper.find('.context-select-popup header input').setValue('Markdown')
    const markdownDocAgain = wrapper.findAll('.context-select-popup .select-list button').find((button) => button.text().includes('Markdown语法指南.md'))
    await markdownDocAgain!.trigger('click')
    await mainInput.element.appendChild(document.createTextNode('检查回滚窗口'))
    await mainInput.trigger('input')
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], 'input.png', { type: 'image/png' })
    Object.defineProperty(wrapper.find('.chat-input input[type="file"]').element, 'files', {
      configurable: true,
      value: [imageFile]
    })
    await wrapper.find('.chat-input input[type="file"]').trigger('change')
    await flushPromises()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
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
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()
    await wrapper.find('.command-select-popup header input').setValue('rollback')
    await wrapper.find('.command-select-popup .select-list button').trigger('click')
    await wrapper.find('.chat-input button[type="submit"]').trigger('submit')
    await wrapper.vm.$nextTick()
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
    expect(noticeAfterDisabledFileClick.exists() ? noticeAfterDisabledFileClick.text() : '').not.toContain('文件上传为本地占位')
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

    const originalFileReader = window.FileReader
    const originalGlobalFileReader = globalThis.FileReader
    class MockEditFileReader {
      result = 'data:image/png;base64,ZWRpdC1pbWFnZQ=='
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      readAsDataURL() {
        this.onload?.()
      }
    }
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: MockEditFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: MockEditFileReader })
    const editPasteFile = new File([new Uint8Array([137, 80, 78, 71])], 'edit.png', { type: 'image/png' })
    const editPasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(editPasteEvent, 'clipboardData', {
      configurable: true,
      value: {
        getData: vi.fn(() => ''),
        items: [
          {
            type: 'image/png',
            getAsFile: () => editPasteFile
          }
        ]
      }
    })
    editInput.element.dispatchEvent(editPasteEvent)
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.user-message-edit-container .image-preview-wrapper').exists()).toBe(true)
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })
    await wrapper.find('.message-edit-actions .primary').trigger('click')
    await wrapper.vm.$nextTick()
    expect(store.chatMessages.find((message) => message.id === originalUserMessageId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'text' && part.text.includes('编辑后的回滚窗口'))).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'skill')).toBe(true)
    expect(store.chatMessages.at(-2)?.contentParts?.some((part) => part.type === 'image' && part.name === 'edit.png')).toBe(true)
    expect(store.chatMessages.at(-2)?.hosts?.map((context) => context.id)).toEqual(['asset-1', 'opened-mysql'])
    expect(wrapper.find('.user-message-edit-container').exists()).toBe(false)
    expect(wrapper.find('.message.user').text()).toContain('编辑后的回滚窗口')
    expect(wrapper.find('.message.user .message-image-part img').exists()).toBe(true)

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
    await wrapper.vm.$nextTick()
    const suggestions = wrapper.find('.terminal-suggestions')
    expect(suggestions.exists()).toBe(true)
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
    expect(store.activePanel.output).toContain('[mock] df -h')

    await wrapper.find('.command-line input').setValue('top')
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
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('top --help')
    expect(wrapper.find('.terminal-suggestions .ai-trigger').exists()).toBe(false)
    expect(wrapper.find('.terminal-suggestions .ai-trigger-loading').exists()).toBe(false)

    await wrapper.find('.command-line input').setValue('rm /tmp/file')
    await wrapper.find('.command-line input').trigger('keydown', { key: 'Enter' })
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    expect(wrapper.find('.terminal-security-prompt').exists()).toBe(true)
    expect(store.activePanel.output).not.toContain('[mock] rm /tmp/file')
    await wrapper.find('.terminal-security-prompt .primary').trigger('click')
    expect(store.terminalSecurityPrompt).toBeNull()
    expect(store.activePanel.output).toContain('[mock] rm /tmp/file')

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
    expect(store.activePanel.output).toContain('[security] blocked: rm -rf /tmp')

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
    await wrapper.find('.terminal-search-overlay input').setValue('df')
    expect(wrapper.find('.terminal-search-overlay').text()).toContain('1/')
    expect(searchAddon.findNext).toHaveBeenCalledWith('df', { incremental: true, caseSensitive: false })
    await wrapper.find('.terminal-search-overlay button[title="下一个"]').trigger('click')
    expect(searchAddon.findNext).toHaveBeenCalledWith('df', { caseSensitive: false })
    await wrapper.find('.terminal-search-overlay button[title="上一个"]').trigger('click')
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('df', { caseSensitive: false })
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
    expect(store.panels.every((panel) => panel.output.includes('[mock broadcast] uptime'))).toBe(true)

    await wrapper.find('.xterm-host').trigger('contextmenu')
    await wrapper.find('.terminal-context-menu').findAll('button').find((button) => button.text().includes('文件管理'))!.trigger('click')
    expect(store.activeModule).toBe('files')

    store.setActiveModule('workspace')
    store.updateTerminalSettings({ rightMouseEvent: 'paste' })
    await wrapper.find('.xterm-host').trigger('contextmenu')
    expect(store.activePanel.output).toContain('clipboard-command')
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(false)

    store.updateTerminalSettings({ middleMouseEvent: 'contextMenu' })
    await wrapper.find('.xterm-host').trigger('mousedown', { button: 1 })
    expect(wrapper.find('.terminal-context-menu').exists()).toBe(true)

    store.createPanel()
    await wrapper.vm.$nextTick()
    const activePanelId = store.activePanelId
    store.updateTerminalSettings({ middleMouseEvent: 'closeTab' })
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

    try {
      expect(wrapper.text()).toContain('拖拽模式')
      expect(wrapper.find('.files-transfer-layout').exists()).toBe(true)
      expect(wrapper.text()).toContain('新增连接 或 左侧拖拽至此')
      expect(wrapper.text()).toContain('任务列表')
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
      expect(store.fileTransferTasks.find((task) => task.source === '/release-note.md' && task.target === '/home/staging/boot/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'release-note.md',
          fromHost: '127.0.0.1',
          toHost: '10.24.9.20',
          status: 'running'
        })
      )

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload.log'] })
      const uploadFileButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传文件')!
      await uploadFileButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile'], defaultPath: '/home/staging' }))
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload.log' && task.target === '/home/staging')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'local-upload.log',
          toHost: '10.24.9.20',
          status: 'running'
        })
      )

      vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/local-upload-dir'] })
      const uploadDirectoryButton = rightBrowser.findAll('.file-icon-button').find((button) => button.attributes('title') === '上传目录')!
      await uploadDirectoryButton.trigger('click')
      await flushPromises()
      expect(window.aiops.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openDirectory'], defaultPath: '/home/staging' }))
      expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-upload-dir' && task.target === '/home/staging')).toEqual(
        expect.objectContaining({
          type: 'upload',
          name: 'local-upload-dir',
          isGroup: true,
          stage: 'scanning'
        })
      )

      const remoteFileRow = rightBrowser.findAll('tbody tr').find((row) => row.text().includes('release-note.md'))!
      await remoteFileRow.trigger('dblclick')
      await flushPromises()
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
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
      await wrapper.find('.files-floating-editor textarea').setValue('changed remote note')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
      await wrapper.vm.$nextTick()
      expect(store.fileTransferTasks.find((task) => task.name === 'save release-note.md' && task.source === '/home/staging/release-note.md')).toEqual(
        expect.objectContaining({
          type: 'r2r',
          target: '/home/staging/release-note.md',
          status: 'success',
          speed: '已保存'
        })
      )
      await wrapper.find('.files-floating-editor textarea').setValue('changed remote note again')
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      expect(wrapper.find('.file-modal-card.small').text()).toContain('保存确认')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('取消'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(true)
      await wrapper.find('.files-editor-toolbar button[title="关闭"]').trigger('click')
      await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('不保存'))!.trigger('click')
      expect(wrapper.find('.files-floating-editor').exists()).toBe(false)

      store.pushFileTransferTask({
        id: 'test-group-transfer',
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
      await wrapper.vm.$nextTick()
      const groupTransferTask = wrapper.findAll('.transfer-task').find((task) => task.text().includes('deploy-dir'))!
      await groupTransferTask.find('.transfer-task-progress button').trigger('click')
      expect(wrapper.text()).toContain('app.log')
      await groupTransferTask.find('.transfer-task-children button[title="取消"]').trigger('click')
      expect(store.fileTransferTasks.find((task) => task.id === 'test-group-transfer')?.status).toBe('failed')
      await vi.advanceTimersByTimeAsync(800)
      expect(store.fileTransferTasks.some((task) => task.id === 'test-group-transfer')).toBe(false)

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
    const wrapper = mount(FileBrowser, {
      props: {
        session: initialFileSessions[0],
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
    expect(wrapper.text()).toContain('release-note-v2.md')

    const renamedRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note-v2.md'))!
    await renamedRow.find('.file-row-actions button[title="权限"]').trigger('click')
    expect(wrapper.find('.file-modal-card.small').text()).toContain('权限设置 - release-note-v2.md')
    expect((wrapper.find('.permission-code input').element as HTMLInputElement).value).toBe('644')
    await wrapper.findAll('.permission-check input').find((input) => (input.element as HTMLInputElement).value === '执行')!.setValue(true)
    await wrapper.find('.permission-recursive input').setValue(true)
    await wrapper.find('.file-modal-card footer .primary').trigger('click')
    expect(wrapper.text()).toContain('权限已更新为 744')
    expect(wrapper.text()).toContain('-744')

    vi.mocked(window.aiops.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: '/tmp/downloads/release-note-v2.md' })
    await renamedRow.find('.file-row-actions button[title="下载"]').trigger('click')
    await flushPromises()
    expect(window.aiops.showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'release-note-v2.md' })
    expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-picked/release-note-v2.md' && task.target === '/tmp/downloads/release-note-v2.md')).toEqual(
      expect.objectContaining({
        type: 'download',
        name: 'release-note-v2.md',
        fromHost: '127.0.0.1',
        status: 'running'
      })
    )
    expect(wrapper.text()).toContain('release-note-v2.md 已加入下载任务')

    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    expect(wrapper.find('.file-more-menu').exists()).toBe(true)
    vi.mocked(navigator.clipboard.writeText).mockClear()
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('复制绝对路径'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/tmp/local-picked/release-note-v2.md')
    expect(wrapper.text()).toContain('绝对路径已复制')
    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('移动'))!.trigger('click')
    expect(wrapper.text()).toContain('移动到')
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
    expect(store.fileTransferTasks).toHaveLength(beforeConflictTasks + 1)
    expect(store.fileTransferTasks.find((task) => task.target === '/tmp/local-picked/release-note-v2_1.md')).toEqual(
      expect.objectContaining({
        name: 'release-note-v2_1.md',
        source: '/tmp/local-picked/release-note-v2.md',
        target: '/tmp/local-picked/release-note-v2_1.md',
        type: 'r2r',
        status: 'running'
      })
    )

    const secondRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('release-note-v2.md'))!
    await secondRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('移动'))!.trigger('click')
    ;(wrapper.vm as any).entries.push({
      name: 'release-note-v2_1.md',
      path: '/tmp/local-picked/release-note-v2_1.md',
      type: 'file',
      mode: '-rw-r--r--',
      size: 1,
      modifiedAt: '2026-06-04 13:10'
    })
    await wrapper.find('.file-modal-card footer .primary').trigger('click')
    await flushPromises()
    expect((wrapper.find('.file-modal-card.small input').element as HTMLInputElement).value).toBe('release-note-v2_2.md')
    await wrapper.findAll('.file-modal-card.small footer button').find((button) => button.text().includes('覆盖'))!.trigger('click')
    expect(store.fileTransferTasks.find((task) => task.source === '/tmp/local-picked/release-note-v2.md' && task.target === '/tmp/local-picked/release-note-v2.md')).toEqual(
      expect.objectContaining({
        name: 'release-note-v2.md',
        target: '/tmp/local-picked/release-note-v2.md'
      })
    )

    await renamedRow.find('.file-row-actions button[title="更多"]').trigger('click')
    await wrapper.find('.file-more-menu').findAll('button').find((button) => button.text().includes('删除'))!.trigger('click')
    expect(wrapper.find('.file-delete-confirm').text()).toContain('/tmp/local-picked/release-note-v2.md')
    await wrapper.find('.file-delete-confirm footer .danger').trigger('click')
    expect(wrapper.text()).toContain('删除成功')
    expect(wrapper.text()).not.toContain('release-note-v2.md')
  })

  it('matches External reference-style quick command groups, edit panel, search, menus, and recording', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(SnippetsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

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
    expect(store.quickCommands.some((command) => command.snippet_name === '新片段')).toBe(true)

    const commandCard = wrapper.findAll('.snippet-item').find((item) => item.text().includes('磁盘巡检'))!
    await commandCard.trigger('contextmenu')
    expect(wrapper.find('.snippet-context-menu').exists()).toBe(true)
    await wrapper.find('.snippet-context-menu').findAll('button').find((button) => button.text().includes('全部窗口执行'))!.trigger('click')
    expect(store.panels[0].output).toContain('[snippet] 磁盘巡检')

    await wrapper.find('button[title="宏录制"]').trigger('click')
    expect(store.isMacroRecording).toBe(true)
    expect(store.macroTerminalId).toBe(store.activePanelId)
    expect(wrapper.text()).toContain('录制中')
    store.recordMacroTerminalInput(store.activePanelId, 'uptime\n')
    await wrapper.findAll('.recording-status-bar button').find((button) => button.text().includes('停止录制'))!.trigger('click')
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('uptime'))).toBe(true)

    await wrapper.find('button[title="宏录制"]').trigger('click')
    store.recordMacroTerminalInput(store.activePanelId, 'date')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('date')
    await wrapper.findAll('.recording-status-bar button').find((button) => button.text().includes('停止录制'))!.trigger('click')
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
    const saved = store.stopMacroRecording()
    expect(saved?.snippet_content).toBe('uptime\nsleep==600\nup\nwhoami')

    store.startMacroRecording('panel-main')
    for (let index = 0; index < 50; index += 1) {
      store.recordMacroCommand(`cmd-${index}`, 2000 + index)
    }
    expect(store.isMacroRecording).toBe(false)
    expect(store.macroLimitReason).toBe('count')
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('cmd-49'))).toBe(true)

    store.startMacroRecording('panel-main')
    store.recordMacroTerminalInput('panel-main', 'staged command')
    store.cancelMacroRecording()
    expect(store.isMacroRecording).toBe(false)
    expect(store.quickCommands.some((command) => command.snippet_content === 'staged command')).toBe(false)
  })

  it('keeps External reference paste mode from submitting the final quick command after sleep lines', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    const command = store.createQuickCommand({
      snippet_name: '粘贴不执行最后一行',
      snippet_content: 'echo first\nsleep==500\necho second',
      group_uuid: null
    })!

    store.runQuickCommand(command.id, false)
    expect(store.activePanel.output).toContain('echo first')
    expect(store.activePanel.output).toContain('echo second')
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

    expect(wrapper.text()).toContain('知识库')
    expect(wrapper.text()).toContain('commands')
    expect(wrapper.text()).toContain('我的容量')

    await wrapper.find('.kb-search input').setValue('interface')
    expect(wrapper.text()).toContain('interface.png')
    expect(wrapper.text()).not.toContain('Summary to Doc.md')
    await wrapper.find('.kb-search input').setValue('')

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

    const markdownNode = panel.findAll('.kb-tree-node').find((node) => node.text().includes('Markdown语法指南.md'))!
    await markdownNode.trigger('click')
    expect(store.activePanel).toEqual(
      expect.objectContaining({
        id: 'kb:Markdown语法指南.md',
        kind: 'knowledge',
        knowledge: { relPath: 'Markdown语法指南.md', isImage: false }
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
    const textarea = workspace.find('.kb-editor-textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('content:Markdown语法指南.md')

    const markdownContent = '# Runbook\n\n![diagram](images/interface.png)\n\n| Name | State |\n| :--- | ---: |\n| api | ok |\n\n```bash\necho ok\n```'
    await textarea.setValue(markdownContent)
    await workspace.findAll('.kb-editor-mode button').find((button) => button.text().includes('预览'))!.trigger('click')
    await flushPromises()
    await workspace.vm.$nextTick()
    const preview = workspace.find('.kb-markdown-preview')
    expect(preview.exists()).toBe(true)
    expect(preview.find('h1').text()).toBe('Runbook')
    expect(preview.find('table').exists()).toBe(true)
    expect(preview.find('pre code').text()).toContain('echo ok')
    expect(preview.find('img').attributes('src')).toContain(Buffer.from('images/interface.png').toString('base64'))
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
    class MockFileReader {
      result = 'data:image/png;base64,cGFzdGVkLWltYWdl'
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      readAsDataURL() {
        this.onload?.()
      }
    }
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: MockFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: MockFileReader })
    const pastedFile = new File(['image-bytes'], 'clip.png', { type: 'image/png' })
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
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
    workspace.find('.kb-editor-root').element.dispatchEvent(pasteEvent)
    await flushPromises()
    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(window.aiops.kbWriteFile).toHaveBeenCalledWith(expect.stringMatching(/^pasted-image-.*\.png$/), 'cGFzdGVkLWltYWdl', 'base64')
    expect((workspace.find('.kb-editor-textarea').element as HTMLTextAreaElement).value).toContain('![](pasted-image-')
    Object.defineProperty(window, 'FileReader', { configurable: true, writable: true, value: originalFileReader })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, writable: true, value: originalGlobalFileReader })

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
    expect(workspace.find('.kb-editor-image img').attributes('src')).toContain(Buffer.from('images/interface.png').toString('base64'))
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

  it('matches External reference-style extension list, plugin details, built-ins, and Alias CRUD', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const panel = mount(ExtensionsPanel, {
      global: { plugins: [pinia] }
    })
    const store = useWorkspaceStore()

    expect(panel.text()).toContain('插件')
    expect(panel.text()).toContain('Jumpserver Support')
    expect(panel.text()).toContain('支持资产同步与资产直连')
    expect(panel.text()).toContain('Alias')
    expect(panel.text()).toContain('系统')
    expect(panel.find('button[title="安装"]').exists()).toBe(true)
    expect(panel.find('button[title="订阅"]').exists()).toBe(true)
    expect(panel.find('button[title="更新"]').exists()).toBe(true)

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
    Object.defineProperty(validDrop, 'dataTransfer', { configurable: true, value: { files: [{ name: 'local-tools.external-reference' }] } })
    panel.element.dispatchEvent(validDrop)
    await panel.vm.$nextTick()
    expect(store.extensionDragActive).toBe(false)
    expect(store.selectedExtensionId).toBe('local-local-tools')
    expect(store.extensionInstallLoadingMap['local-local-tools']).toBe(true)
    expect(panel.text()).toContain('Installing')

    await panel.find('.extension_search_box input').setValue('Alias')
    expect(panel.text()).toContain('Alias')
    expect(panel.text()).not.toContain('Cloud Assets')

    await panel.find('.extension_item').trigger('click')
    expect(store.selectedExtensionId).toBe('Alias')

    store.updateExtensionSettings({ aliasStatus: false })
    await panel.vm.$nextTick()
    expect(panel.text()).not.toContain('Alias')
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    store.updateExtensionSettings({ aliasStatus: true })
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

    store.selectExtension('ops-runbook')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('Ops Runbook')
    expect(workspace.text()).toContain('插件功能')
    expect(workspace.text()).toContain('插件标识')
    expect(workspace.text()).toContain('卸载')
    expect(workspace.text()).toContain('更新')

    store.updateExtensionPlugin('ops-runbook')
    await workspace.vm.$nextTick()
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
    expect(store.selectedExtensionInstallProgress?.stage).toBe('downloading')
    expect(workspace.text()).toContain('取消')
    store.cancelExtensionInstall('ops-runbook')
    await workspace.vm.$nextTick()
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
    expect(store.selectedExtensionInstallProgress?.stage).toBe('cancelled')

    store.installExtensionPlugin('cloud-assets')
    store.selectExtension('cloud-assets')
    await workspace.vm.$nextTick()
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

      expect(panel.text()).toContain('prod-cluster')
      expect(panel.text()).toContain('staging/devops')
      await panel.find('.k8s-search input').setValue('staging')
      expect(panel.text()).toContain('staging-cluster')
      expect(panel.text()).not.toContain('prod-cluster')
      await panel.find('.k8s-search input').setValue('')

      const stagingRow = panel.findAll('.k8s-cluster-item').find((row) => row.text().includes('staging-cluster'))!
      await stagingRow.find('button[title="更多"]').trigger('click')
      expect(store.k8sClusterActionMenuId).toBe('k8s-2')
      await stagingRow.find('.k8s-cluster-menu').findAll('button').find((button) => button.text().includes('连接'))!.trigger('click')
      expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connecting')
      await vi.advanceTimersByTimeAsync(280)
      expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connected')

      await stagingRow.find('button[title="更多"]').trigger('click')
      await stagingRow.find('.k8s-cluster-menu').findAll('button').find((button) => button.text().includes('编辑'))!.trigger('click')
      expect(store.k8sEditModalOpen).toBe(true)

      const workspace = mount(KubernetesWorkspace, {
        global: { plugins: [pinia] }
      })
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

    await workspace.find('.k8s-command-line input').setValue('kubectl get pods -A')
    await workspace.find('.k8s-command-line').trigger('submit')
    expect(store.k8sActiveTerminal?.output).toContain('[mock kubectl] kubectl get pods -A')

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
    await billingRow.find('button[title="发送到终端"]').trigger('click')
    expect(store.k8sActiveTerminal?.output).toContain('[mock kubectl] kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
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
    await workspace.find('.k8s-file-picker-row button').trigger('click')
    expect(store.k8sClusterNotice).toContain('已选择 kubeconfig 文件')
    await workspace.find('.k8s-test-connection button').trigger('click')
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

    expect(wrapper.text()).toContain('Database')
    expect(wrapper.text()).toContain('Default Group')
    expect(wrapper.text()).toContain('orders-postgres')
    expect(wrapper.find('.db-workspace-tab').text()).toContain('Overview')
    expect(wrapper.text()).toContain('New Connection')

    await wrapper.find('.db-search input').setValue('metrics')
    expect(wrapper.text()).toContain('metrics-mysql')
    expect(wrapper.text()).not.toContain('orders-postgres')
    await wrapper.find('.db-search input').setValue('')

    await wrapper.find('button[title="Add"]').trigger('click')
    expect(wrapper.find('.db-add-menu').exists()).toBe(true)
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
    await wrapper.find('.db-connection-modal footer button').trigger('click')
    expect(wrapper.text()).toContain('PostgreSQL 16 mock')
    await wrapper.find('.db-connection-modal').trigger('submit')
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
    expect(wrapper.text()).toContain('SQLite mock')
    await wrapper.find('.db-connection-modal').trigger('submit')
    expect(wrapper.text()).toContain('unit-sqlite')

    await wrapper.find('button[title="New SQL"]').trigger('click')
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('SQL'))).toBe(true)
    const workbenchEditor = wrapper.find('.db-sql-editor')
    expect(wrapper.find('button[title="Save As"]').exists()).toBe(true)
    expect(wrapper.find('button[title="Save As"]').attributes('disabled')).toBeDefined()
    await workbenchEditor.setValue('select id, service from public.orders where status = \'open\' order by updated_at desc limit 5; select * from public.orders where service = \'billing\';')
    await wrapper.find('button[title="Format"]').trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT\n  id')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('\nFROM\n  public.orders')
    await workbenchEditor.setValue('select id from public.orders;\nselect * from public.audit_events;')
    const formatEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const formatSelectionEnd = 'select id from public.orders'.length
    formatEditorElement.setSelectionRange(0, formatSelectionEnd)
    await wrapper.find('button[title="Format"]').trigger('click')
    await flushPromises()
    const selectionFormattedSql = (wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value
    expect(selectionFormattedSql).toContain('SELECT\n  id')
    expect(selectionFormattedSql).toContain('select * from public.audit_events;')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#1-1')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.text()).toContain('【Rows】')
    const serviceHeader = wrapper.findAll('.db-result-table th').find((header) => header.text().includes('service'))!
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    expect(wrapper.find('.db-filter-popover').text()).toContain('payment-api')
    expect(wrapper.find('.db-filter-mode-row').exists()).toBe(true)
    await wrapper.find('.db-filter-search input').setValue('orders')
    expect(wrapper.find('.db-filter-popover').text()).toContain('orders-worker')
    expect(wrapper.find('.db-filter-popover').text()).not.toContain('payment-api')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('orders-worker')
    expect(wrapper.find('.db-result-table').text()).not.toContain('payment-api')
    expect(wrapper.find('.db-status-bar').text()).toContain('1 row')
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-row.all button').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-mode-row select').setValue('like')
    await wrapper.find('.db-filter-mode-row input').setValue('payment')
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    expect(wrapper.find('.db-result-table').text()).not.toContain('orders-worker')
    expect(wrapper.find('.db-filter-chip').text()).toContain('LIKE payment')
    await serviceHeader.find('button[title="Filter"]').trigger('click')
    await wrapper.find('.db-filter-row.all button').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('orders-worker')
    const firstResultTab = wrapper.findAll('.db-result-tabs button').find((button) => button.text().includes('#1-1'))!
    await wrapper.find('.db-result-tabs button').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('Execution History')
    expect(wrapper.find('.db-sql-overview').text()).toContain('1 executions')
    expect(wrapper.find('.db-sql-overview').text()).toContain('#1-1')
    expect(wrapper.find('.db-sql-overview').text()).toContain('Rows')
    expect(wrapper.find('.db-sql-overview').text()).toContain('Affected rows')
    expect(wrapper.find('.db-sql-overview').text()).toContain('ms')
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    await firstResultTab.find('svg').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('Result tab closed')
    expect(wrapper.find('.db-sql-overview-open').attributes('disabled')).toBeDefined()
    await wrapper.find('.db-sql-overview tbody tr').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(true)
    await workbenchEditor.setValue('select * from public.orders; select * from public.audit_events;')
    const editorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const secondStatementOffset = editorElement.value.indexOf('select * from public.audit_events')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    expect(wrapper.find('.db-sql-overview').exists()).toBe(false)
    expect(wrapper.find('.db-result-table').text()).toContain('mock query ok')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#2-1')
    editorElement.setSelectionRange(0, 'select * from public.orders'.length)
    await wrapper.find('button[title="Run current statement"]').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('payment-api')
    editorElement.setSelectionRange(secondStatementOffset, secondStatementOffset)
    await wrapper.find('button[title="Explain"]').trigger('click')
    await wrapper.find('.db-result-tabs button').trigger('click')
    expect(wrapper.find('.db-sql-overview').text()).toContain('EXPLAIN select * from public.audit_events')

    await workbenchEditor.setValue('select id from "public"."orders" where status = \'open\';\nselect * from public.audit_events;')
    const convertEditorElement = wrapper.find('.db-sql-editor').element as HTMLTextAreaElement
    const selectedConvertSql = 'select id from "public"."orders" where status = \'open\''
    convertEditorElement.setSelectionRange(0, selectedConvertSql.length)
    await wrapper.find('button[title="AI Convert SQL"]').trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Convert SQL')
    expect(wrapper.findAll('.db-ai-section header').map((header) => header.text())).toEqual(['Reasoning', 'Response'])
    expect(wrapper.find('.db-ai-section').text()).toContain('Read the active database context')
    expect(wrapper.find('.db-ai-dialect-row').text()).toContain('Target Dialect')
    expect((wrapper.find('.db-ai-dialect-row select').element as HTMLSelectElement).value).toBe('postgresql')
    await wrapper.find('.db-ai-dialect-row select').setValue('mssql')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.db-ai-drawer').text()).toContain('SQL Server')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Text-only conversion')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('SELECT TOP (100)')
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('[public].[orders]')
    expect(wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.attributes('disabled')).toBeDefined()
    await wrapper.find('.db-ai-dialect-row select').setValue('postgresql')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.db-ai-sql-actions pre').text()).toContain('"public"."orders"')
    expect(wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.attributes('disabled')).toBeUndefined()
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

    const ordersTable = wrapper.findAll('.db-tree-row.table').find((row) => row.text().includes('orders'))!
    await ordersTable.find('button').trigger('click')
    const ownerColumn = wrapper.findAll('.db-tree-row.column').find((row) => row.text().includes('owner'))!
    expect(ownerColumn.text()).toContain('owner')
    await ownerColumn.trigger('click')
    expect(ownerColumn.classes()).toContain('selected')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Copy SELECT'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SELECT * FROM "public"."orders"')
    expect(wrapper.text()).toContain('SELECT copied')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Query Console'))!.trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toBe('SELECT *\nFROM "public"."orders"\nLIMIT 100;')

    await ordersTable.trigger('dblclick')
    expect(wrapper.findAll('.db-workspace-tab').some((tab) => tab.text().includes('orders'))).toBe(true)
    expect(wrapper.find('.db-where-bar').text()).toContain('orders')
    await wrapper.find('.db-where-bar input').setValue('status = investigating')
    await wrapper.find('.db-where-bar button').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('investigating')
    expect(wrapper.find('.db-result-table').text()).not.toContain('mitigated')
    const ownerHeader = wrapper.findAll('.db-result-table th').find((header) => header.text().includes('owner'))!
    await ownerHeader.find('button[title="Filter"]').trigger('click')
    expect(wrapper.find('.db-filter-popover').text()).toContain('alice')
    await wrapper.find('.db-filter-search input').setValue('alice')
    await wrapper.find('.db-filter-popover input[type="checkbox"]').setValue(true)
    await wrapper.find('.db-filter-footer .primary').trigger('click')
    expect(wrapper.find('.db-result-table').text()).toContain('alice')
    expect(wrapper.find('.db-result-table').text()).not.toContain('bob')

    const dataRow = wrapper.find('.db-result-table tbody tr')
    const ownerCell = dataRow.findAll('td').at(4)!
    await ownerCell.trigger('dblclick')
    const dataEditInput = wrapper.find('.db-result-table td input')
    await dataEditInput.setValue('alice-edited')
    await dataEditInput.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.db-result-table tbody tr').classes()).toContain('updated')
    expect(wrapper.find('.db-result-table tbody tr').findAll('td').at(4)!.classes()).toContain('updated')
    expect(wrapper.find('.db-result-table').text()).toContain('alice-edited')
    expect(wrapper.find('.db-edit-summary').text()).toContain('1 Updated')
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
    expect(wrapper.find('.db-result-table tbody tr.deleted').exists()).toBe(false)
    expect(wrapper.find('.db-edit-summary').exists()).toBe(false)
    expect(wrapper.text()).toContain('Changes saved to local mock state')

    await ordersTable.trigger('contextmenu')
    expect(wrapper.find('.db-context-menu').exists()).toBe(true)
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('View DDL'))!.trigger('click')
    expect((wrapper.find('.db-ddl-modal textarea').element as HTMLTextAreaElement).value).toContain('CREATE TABLE')
    await wrapper.find('.db-ddl-modal header button').trigger('click')

    await ordersTable.trigger('contextmenu')
    await wrapper.find('.db-context-menu').findAll('button').find((button) => button.text().includes('Drop'))!.trigger('click')
    expect(wrapper.find('.db-danger-confirm').text()).toContain('DROP TABLE')
    expect(wrapper.find('.db-danger-confirm footer .danger').attributes('disabled')).toBeDefined()
    await wrapper.find('.db-danger-confirm input').setValue('orders')
    await wrapper.find('.db-danger-confirm footer .danger').trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('DROP TABLE public.orders')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('Generated SQL')
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Copy'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('DROP TABLE public.orders;')
    expect(
      wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Insert Into Editor'))!.attributes('disabled')
    ).toBeDefined()
    await wrapper.findAll('.db-ai-drawer footer button').find((button) => button.text().includes('Clear'))!.trigger('click')

    await wrapper.find('button[title="New SQL"]').trigger('click')
    const sqlEditor = wrapper.find('.db-sql-editor')
    await sqlEditor.setValue('syntax_error')
    await wrapper.find('button[title="Run all"]').trigger('click')
    expect(wrapper.find('.db-result-error').text()).toContain('Mock SQL parser rejected')
    await wrapper.find('.db-result-error button').trigger('click')
    expect(wrapper.find('.db-ai-drawer').text()).toContain('SELECT')
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Replace Selection'))!.trigger('click')
    expect((wrapper.find('.db-sql-editor').element as HTMLTextAreaElement).value).toContain('SELECT')
    await wrapper.find('.db-ai-sql-actions').findAll('button').find((button) => button.text().includes('Run ReadOnly'))!.trigger('click')
    expect(wrapper.find('.db-result-tabs').text()).toContain('#')

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

    const workspace = mount(SettingsWorkspace, {
      global: { plugins: [pinia] }
    })

    expect(workspace.text()).toContain('基础设置')
    expect(workspace.text()).toContain('默认背景')
    expect(workspace.text()).toContain('自定义上传（支持JPG、PNG、WebP、GIF）')
    expect(workspace.text()).toContain('打开入门引导')
    await workspace.find('.settings-button.primary').trigger('click')
    expect(store.onboardingGuideOpen).toBe(true)
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('入门引导')
    expect(workspace.text()).toContain('界面导览')
    store.onboardingGuideOpen = false
    await workspace.vm.$nextTick()

    await workspace.findAll('.settings-bg-tile.preset').at(0)!.trigger('click')
    expect(store.config.background.mode).toBe('preset')
    await workspace.find('.settings-sliders input[type="range"]').setValue('0.5')
    expect(store.config.background.opacity).toBe(0.5)

    const layoutRadios = workspace.findAll('input[name="defaultLayout"]')
    await layoutRadios[1].setValue(true)
    expect(store.config.defaultMode).toBe('agents')

    expect(workspace.text()).toContain('编辑器设置')
    expect(workspace.text()).toContain('Minimap')
    expect(workspace.text()).toContain('Mouse Wheel Zoom')
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.findAll('input.settings-number')[0].setValue('18')
    expect(store.editorSettings.fontSize).toBe(18)
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
    await workspace.findAll('input[name="mouseWheelZoom"]')[1].setValue(true)
    expect(store.editorSettings.minimap).toBe(false)
    expect(store.editorSettings.mouseWheelZoom).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        editorSettings: expect.objectContaining({
          fontSize: 18,
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
    expect(workspace.find('.agent-config-modal').exists()).toBe(true)
    expect(workspace.text()).toContain('暂无密钥添加')
    await workspace.find('.agent-config-modal .settings-select').setValue('key-prod-ed25519')
    await workspace.find('.agent-key-form .settings-button.primary').trigger('click')
    expect(store.sshAgentKeys.some((key) => key.id === 'key-prod-ed25519')).toBe(true)
    expect(workspace.text()).toContain('prod-ed25519')
    expect(workspace.text()).toContain('ED25519')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-prod-ed25519',
            fingerprint: 'SHA256:6qY8zR2aQ0prodEd25519',
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-prod-ed25519'
          }
        ]
      })
    )
    vi.mocked(window.aiops.saveConfig).mockClear()
    await workspace.find('.agent-config-table .settings-link-button.danger').trigger('click')
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
    const providerInputs = workspace.findAll('.provider-card .settings-input')
    await providerInputs[0].setValue('http://litellm.internal')
    await workspace.findAll('.provider-card').at(0)!.findAll('button').find((button) => button.text() === 'Save')!.trigger('click')
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

    await panel.findAll('.settings-nav-item').find((item) => item.text().includes('AI 偏好设置'))!.trigger('click')
    await workspace.vm.$nextTick()
    expect(workspace.text()).toContain('启用 Extended Thinking')
    expect(workspace.text()).toContain('OpenAI Reasoning Effort')
    await workspace.find('.settings-budget input[type="range"]').setValue('5000')
    expect(store.aiPreferences.thinkingBudgetTokens).toBe(5000)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          thinkingBudgetTokens: 5000
        })
      })
    )
    await workspace.findAll('.settings-check-line input').find((input) => (input.element as HTMLInputElement).checked === false)!.setValue(true)
    expect(store.aiPreferences.autoExecuteReadOnlyCommands).toBe(true)
    await workspace.findAll('.security-config-row button').find((button) => button.text().includes('打开安全配置'))!.trigger('click')
    expect(store.securityConfigEditorOpen).toBe(true)
    expect(workspace.text()).toContain('security-config.json')
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
    await new Promise((resolve) => window.setTimeout(resolve, 1100))
    expect(store.securitySettings).toEqual(securityConfig)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        securityConfig
      })
    )
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
    store.updateAiPreferences({ autoApproval: true })
    await spotlight.vm.$nextTick()
    expect(store.onboardingCompleted.systemSettings).toBe(true)
    expect(store.onboardingActiveTour).toBeNull()

    spotlight.unmount()
    target.remove()
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
    const clickNav = async (label: string) => {
      await panel.findAll('.settings-nav-item').find((item) => item.text().includes(label))!.trigger('click')
      await workspace.vm.$nextTick()
    }

    await clickNav('扩展')
    expect(workspace.text()).toContain('自动补全')
    await workspace.findAll('.settings-switch input').at(0)!.setValue(false)
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
    await new Promise((resolve) => window.setTimeout(resolve, 1100))
    expect(store.keywordHighlightSettings).toEqual(keywordConfig)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordHighlight: keywordConfig
      })
    )
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
    expect(store.mcpConfigEditorOpen).toBe(true)
    expect(workspace.text()).toContain('mcp_settings.json')
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
    await workspace.findAll('.mcp-config-toolbar .settings-button').find((button) => button.text() === 'Close')!.trigger('click')
    expect(store.mcpConfigEditorOpen).toBe(false)
    await clickNav('MCP')
    await workspace.find('.mcp-tool-header button').trigger('click')
    expect(store.mcpServers[0].tools[0].enabled).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpToolStates: expect.objectContaining({
          'filesystem:read_file': false
        })
      })
    )

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
    expect(store.settingsRules.some((rule) => rule.content === '新增规则')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: '',
        rules: expect.arrayContaining([expect.objectContaining({ content: '新增规则', enabled: true })])
      })
    )

    await clickNav('快捷键')
    expect(workspace.text()).toContain('快捷键设置')
    await workspace.find('.shortcut-display').trigger('click')
    expect(store.shortcutRecording.actionId).toBe('newTerminal')
    await workspace.find('.shortcut-modal input').setValue('Ctrl+K')
    await workspace.find('.shortcut-modal footer .primary').trigger('click')
    expect(store.settingsShortcuts.find((shortcut) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+K')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.arrayContaining([expect.objectContaining({ id: 'newTerminal', shortcut: 'Ctrl+K' })])
      })
    )

    await clickNav('可信设备')
    expect(workspace.text()).toContain('Linux Workstation')
    await workspace.findAll('.trusted-device-item .danger').find((button) => !(button.element as HTMLButtonElement).disabled)!.trigger('click')
    expect(store.trustedDeviceModal.open).toBe(true)
    await workspace.find('.settings-modal-card footer .primary').trigger('click')
    expect(store.trustedDevices).toHaveLength(1)

    await clickNav('隐私')
    expect(workspace.text()).toContain('Secret Redaction')
    const secretRadios = workspace.findAll('input[name="secretRedaction"]')
    await secretRadios[0].setValue(true)
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

    await clickNav('关于')
    expect(workspace.text()).toContain('Log Diagnostics')
    await workspace.find('.about-card .settings-button').trigger('click')
    expect(store.aboutSettings.updateStatus).toBe('checking')
  })
})
