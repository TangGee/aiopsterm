import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  agentMode: { value: false },
  aiPanelMode: { __v_isRef: true, value: 'classic' as 'classic' | 'codex' },
  chatExportNotice: { value: '' },
  closePopups: vi.fn(),
  handleDragEnter: vi.fn(),
  handleDragLeave: vi.fn(),
  handleDragOver: vi.fn(),
  handleDrop: vi.fn(),
  handlePanelKeydown: vi.fn()
}))

vi.mock('@/services/ai/aiPanelContext', () => ({
  useAiPanelRuntimeContext: () => runtime
}))

import AiPanelPresentation from '@/components/ai/AiPanelPresentation.vue'

const HeaderStub = defineComponent({
  props: ['projectFilesAvailable', 'projectFilesActive'],
  emits: ['toggleProjectFiles', 'activateAiSurface'],
  template: '<header data-testid="ai-header-stub" />'
})

const ProjectFilesStub = defineComponent({
  emits: ['close'],
  template: '<section data-testid="project-files-drawer-stub"><button @click="$emit(\'close\')" /></section>'
})

const passiveStubs = {
  AiPanelClassicComposer: { template: '<div data-testid="classic-composer-stub" />' },
  AiPanelClassicConversation: { template: '<div data-testid="classic-conversation-stub" />' },
  AiPanelCodexShell: { template: '<div data-testid="codex-shell-stub" />' },
  AiPanelCommandAuditDialog: { template: '<div />' },
  AiPanelHeader: HeaderStub,
  ProjectFilesPanel: ProjectFilesStub,
  Transition: false
}

describe('AiPanel project files surface', () => {
  beforeEach(() => {
    runtime.aiPanelMode.value = 'classic'
    vi.clearAllMocks()
  })

  it('switches the content area to project files while keeping AI content mounted', async () => {
    const wrapper = mount(AiPanelPresentation, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: true
      },
      global: {
        stubs: passiveStubs
      }
    })

    expect(wrapper.get('.ai-panel').classes()).toContain('project-files-active')
    expect(wrapper.find('[data-testid="classic-conversation-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="classic-conversation-stub"]').isVisible()).toBe(false)
    expect(wrapper.find('[data-testid="classic-composer-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="classic-composer-stub"]').isVisible()).toBe(false)
    expect(wrapper.find('[data-testid="project-files-drawer-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="project-files-drawer-stub"]').classes()).not.toContain('project-files-drawer-codex')

    wrapper.getComponent(HeaderStub).vm.$emit('activateAiSurface')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('closeProjectFiles')).toHaveLength(1)

    await wrapper.get('[data-testid="project-files-drawer-stub"] button').trigger('click')
    expect(wrapper.emitted('closeProjectFiles')).toHaveLength(2)

    await wrapper.get('.ai-panel').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('closeProjectFiles')).toHaveLength(3)
    expect(runtime.handlePanelKeydown).not.toHaveBeenCalled()
  })

  it('keeps the Codex target surface hidden while project files are active', () => {
    runtime.aiPanelMode.value = 'codex'
    const wrapper = mount(AiPanelPresentation, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: true
      },
      global: {
        stubs: passiveStubs
      }
    })

    expect(wrapper.find('[data-testid="codex-shell-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="codex-shell-stub"]').isVisible()).toBe(false)
    expect(wrapper.find('[data-testid="project-files-drawer-stub"]').isVisible()).toBe(true)
  })

  it('shows only the surface selected by the AI panel mode', () => {
    runtime.aiPanelMode.value = 'codex'
    const codexWrapper = mount(AiPanelPresentation, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: false
      },
      global: {
        stubs: passiveStubs
      }
    })

    expect(codexWrapper.find('[data-testid="codex-shell-stub"]').isVisible()).toBe(true)
    expect(codexWrapper.find('[data-testid="classic-conversation-stub"]').isVisible()).toBe(false)
    expect(codexWrapper.find('[data-testid="classic-composer-stub"]').isVisible()).toBe(false)
    codexWrapper.unmount()

    runtime.aiPanelMode.value = 'classic'
    const classicWrapper = mount(AiPanelPresentation, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: false
      },
      global: {
        stubs: passiveStubs
      }
    })

    expect(classicWrapper.find('[data-testid="codex-shell-stub"]').isVisible()).toBe(false)
    expect(classicWrapper.find('[data-testid="classic-conversation-stub"]').isVisible()).toBe(true)
    expect(classicWrapper.find('[data-testid="classic-composer-stub"]').isVisible()).toBe(true)
  })
})
