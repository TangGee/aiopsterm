import { DOMWrapper, enableAutoUnmount, mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

enableAutoUnmount(afterEach)

const context = vi.hoisted(() => ({ runtime: null as any }))

vi.mock('@/services/ai/aiPanelContext', () => ({
  useAiPanelRuntimeContext: () => context.runtime
}))

import AiPanelHeader from '@/components/ai/AiPanelHeader.vue'

const translations: Record<string, string> = {
  'ai.panelMode': 'AI panel mode',
  'ai.classicChatMode': 'Classic Chat',
  'ai.codexCliMode': 'Codex CLI',
  'ai.conversationTabs': 'Conversation tabs',
  'ai.closeTab': 'Close tab',
  'ai.newChat': 'New chat',
  'ai.moreActions': 'More',
  'ai.searchChat': 'Search chat',
  'ai.exportChat': 'Export chat',
  'ai.codexWorkspaceLinkOn': 'Follow workspace',
  'ai.codexWorkspaceLinkOff': 'Manual target',
  'ai.codexRestart': 'Restart Codex',
  'module.files': 'Files'
}

const makeRuntime = () => ({
  activeCodexConversationId: ref(''),
  aiPanelWorkspaceLinkMode: ref<'manual' | 'follow-workspace'>('manual'),
  aiPanelMode: ref<'classic' | 'codex'>('classic'),
  closeCodexConversation: vi.fn(),
  closeConversationTab: vi.fn(),
  closePopups: vi.fn(function (this: void) {
    context.runtime.moreActionsMenuOpen.value = false
    context.runtime.panelModeMenuOpen.value = false
  }),
  codexConversations: ref<any[]>([]),
  codexConversationTitle: (conversation: { title: string }) => conversation.title,
  conversationTabTooltip: (conversation: { title: string }) => conversation.title,
  createNewAiConversation: vi.fn(),
  createNewCodexConversation: vi.fn(),
  currentAiPanelModeLabel: ref('Classic Chat'),
  displayConversationTitle: (conversation: { title: string }) => conversation.title,
  exportCurrentChat: vi.fn(),
  moreActionsMenuOpen: ref(false),
  openChatSearch: vi.fn(),
  panelModeMenuOpen: ref(false),
  restartCodexSession: vi.fn(),
  restoreConversationFromTab: vi.fn(),
  selectAiPanelMode: vi.fn(),
  selectCodexConversation: vi.fn(),
  t: (key: string) => translations[key] || key,
  toggleAiPanelModeMenu: vi.fn(function (this: void) {
    context.runtime.panelModeMenuOpen.value = !context.runtime.panelModeMenuOpen.value
  }),
  toggleAiPanelWorkspaceLinkMode: vi.fn(),
  toggleMoreActionsMenu: vi.fn(function (this: void) {
    context.runtime.moreActionsMenuOpen.value = !context.runtime.moreActionsMenuOpen.value
  }),
  visibleConversationTabs: ref<any[]>([]),
  workspace: reactive({ selectedConversationId: '' })
})

const bodyWrapper = () => new DOMWrapper(document.body)

describe('AiPanelHeader compact controls', () => {
  beforeEach(() => {
    context.runtime = makeRuntime()
  })

  it('uses an icon-only mode trigger and keeps Classic history out of the header', async () => {
    context.runtime.visibleConversationTabs.value = [{ id: 'classic-1', title: 'Audit', favorite: false }]
    context.runtime.workspace.selectedConversationId = 'classic-1'
    const wrapper = mount(AiPanelHeader)

    const modeTrigger = wrapper.find('[data-testid="ai-panel-mode-open"]')
    expect(modeTrigger.text()).toBe('')
    expect(modeTrigger.attributes('title')).toContain('Classic Chat')
    expect(modeTrigger.find('svg').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-history-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-codex-history-open"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-new-chat"]').trigger('click')
    expect(context.runtime.createNewAiConversation).toHaveBeenCalledTimes(1)
    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    expect(context.runtime.closePopups).toHaveBeenCalledTimes(1)
    expect(context.runtime.closePopups.mock.invocationCallOrder[0]).toBeLessThan(
      context.runtime.toggleMoreActionsMenu.mock.invocationCallOrder[0]
    )
    expect(bodyWrapper().findAll('[data-testid="ai-more-actions-menu"] button')).toHaveLength(2)
    expect(bodyWrapper().find('[data-testid="ai-chat-search-open"]').exists()).toBe(true)
    expect(bodyWrapper().find('[data-testid="ai-chat-export"]').exists()).toBe(true)

    await wrapper.find('.ai-conversation-tab-close').trigger('click')
    expect(context.runtime.closeConversationTab).toHaveBeenCalledWith('classic-1')
  })

  it('shows the project files action only when the selected managed session supports it', async () => {
    const wrapper = mount(AiPanelHeader, {
      props: {
        projectFilesAvailable: false,
        projectFilesActive: false
      }
    })

    expect(wrapper.find('[data-testid="ai-project-files-toggle"]').exists()).toBe(false)

    await wrapper.setProps({
      projectFilesAvailable: true,
      projectFilesActive: false
    })
    const toggle = wrapper.get('[data-testid="ai-project-files-toggle"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')
    expect(wrapper.emitted('toggleProjectFiles')).toHaveLength(1)

    await wrapper.setProps({ projectFilesActive: true })
    expect(wrapper.get('[data-testid="ai-project-files-toggle"]').classes()).toContain('active')
    expect(wrapper.get('[data-testid="ai-project-files-toggle"]').attributes('aria-pressed')).toBe('true')
  })

  it('returns to the AI surface when a conversation action is selected from project files', async () => {
    context.runtime.visibleConversationTabs.value = [{ id: 'classic-1', title: 'Audit', favorite: false }]
    context.runtime.workspace.selectedConversationId = 'classic-1'
    context.runtime.selectAiPanelMode.mockResolvedValue(true)
    const wrapper = mount(AiPanelHeader, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: true
      }
    })

    await wrapper.get('[data-testid="ai-conversation-tab"]').trigger('click')
    expect(context.runtime.restoreConversationFromTab).toHaveBeenCalledWith('classic-1')
    expect(wrapper.emitted('activateAiSurface')).toHaveLength(1)

    context.runtime.panelModeMenuOpen.value = true
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="ai-mode-codex"]').trigger('click')
    expect(context.runtime.selectAiPanelMode).toHaveBeenCalledWith('codex')
    expect(wrapper.emitted('activateAiSurface')).toHaveLength(2)

    await wrapper.get('[data-testid="ai-new-chat"]').trigger('click')
    expect(context.runtime.createNewAiConversation).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('activateAiSurface')).toHaveLength(3)
  })

  it('returns to the AI surface when a Codex conversation is selected from project files', async () => {
    context.runtime.aiPanelMode.value = 'codex'
    context.runtime.activeCodexConversationId.value = 'codex-1'
    context.runtime.codexConversations.value = [{ id: 'codex-1', title: 'Codex CLI' }]
    const wrapper = mount(AiPanelHeader, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: true
      }
    })

    await wrapper.get('[data-testid="ai-codex-tab"]').trigger('click')
    expect(context.runtime.selectCodexConversation).toHaveBeenCalledWith('codex-1')
    expect(wrapper.emitted('activateAiSurface')).toHaveLength(1)

    await wrapper.get('[data-testid="ai-codex-new"]').trigger('click')
    expect(context.runtime.createNewCodexConversation).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('activateAiSurface')).toHaveLength(2)
  })

  it('puts Codex target-link and restart actions under More and supports zero tabs', async () => {
    context.runtime.aiPanelMode.value = 'codex'
    context.runtime.currentAiPanelModeLabel.value = 'Codex CLI'
    const wrapper = mount(AiPanelHeader)

    expect(wrapper.find('[data-testid="ai-codex-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-codex-history-open"]').exists()).toBe(false)
    await wrapper.find('[data-testid="ai-codex-new"]').trigger('click')
    expect(context.runtime.createNewCodexConversation).toHaveBeenCalledTimes(1)

    context.runtime.panelModeMenuOpen.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="ai-panel-mode-dropdown"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    expect(context.runtime.closePopups).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="ai-panel-mode-dropdown"]').exists()).toBe(false)
    expect(bodyWrapper().findAll('[data-testid="ai-more-actions-menu"] button')).toHaveLength(2)
    expect(bodyWrapper().find('[data-testid="ai-codex-workspace-link"]').exists()).toBe(true)
    expect(bodyWrapper().find('[data-testid="ai-codex-restart"]').exists()).toBe(true)
    expect(bodyWrapper().find('[data-testid="ai-chat-search-open"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')
    expect(context.runtime.closePopups).toHaveBeenCalledTimes(1)
    expect(bodyWrapper().find('[data-testid="ai-more-actions-menu"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-more-actions-open"]').trigger('click')

    await bodyWrapper().find('[data-testid="ai-codex-restart"]').trigger('click')
    expect(context.runtime.restartCodexSession).toHaveBeenCalledTimes(1)
  })

  it('renders More as a viewport-clamped global overlay', async () => {
    const wrapper = mount(AiPanelHeader)
    const trigger = wrapper.get('[data-testid="ai-more-actions-open"]')
    vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({
      x: 84,
      y: 20,
      left: 84,
      right: 108,
      top: 20,
      bottom: 44,
      width: 24,
      height: 24,
      toJSON: () => ({})
    })
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 120 })
    try {
      await trigger.trigger('click')
      await wrapper.vm.$nextTick()
      const menu = bodyWrapper().get('[data-testid="ai-more-actions-menu"]')
      expect(menu.classes()).toContain('ai-more-actions-menu-floating')
      expect(menu.classes()).toContain('ready')
      expect(menu.attributes('style')).toContain('left: 8px')
      expect(wrapper.find('[data-testid="ai-more-actions-menu"]').exists()).toBe(false)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    }
  })

  it('scrolls a newly active Codex conversation tab into view', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView
    })
    try {
      context.runtime.aiPanelMode.value = 'codex'
      context.runtime.activeCodexConversationId.value = 'codex-first'
      context.runtime.codexConversations.value = [{ id: 'codex-first', title: 'First' }]
      const wrapper = mount(AiPanelHeader)

      context.runtime.codexConversations.value = [
        ...context.runtime.codexConversations.value,
        { id: 'codex-second', title: 'Second' }
      ]
      context.runtime.activeCodexConversationId.value = 'codex-second'
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      const tabs = wrapper.findAll('[data-testid="ai-codex-tab"]')
      expect(tabs).toHaveLength(2)
      expect(tabs[1].classes()).toContain('active')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
      expect(scrollIntoView.mock.instances.at(-1)).toBe(tabs[1].element)
      wrapper.unmount()
    } finally {
      if (originalDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalDescriptor)
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })
})
