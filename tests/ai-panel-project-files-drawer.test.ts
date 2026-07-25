import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  agentMode: { value: false },
  aiPanelMode: { value: 'classic' as const },
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
  emits: ['toggleProjectFiles'],
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

describe('AiPanel project files drawer', () => {
  it('keeps AI content mounted under the drawer and supports close actions', async () => {
    const wrapper = mount(AiPanelPresentation, {
      props: {
        projectFilesAvailable: true,
        projectFilesActive: true
      },
      global: {
        stubs: passiveStubs
      }
    })

    expect(wrapper.find('[data-testid="classic-conversation-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="classic-composer-stub"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="project-files-drawer-stub"]').exists()).toBe(true)

    await wrapper.get('[data-testid="project-files-drawer-stub"] button').trigger('click')
    expect(wrapper.emitted('closeProjectFiles')).toHaveLength(1)

    await wrapper.get('.ai-panel').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('closeProjectFiles')).toHaveLength(2)
    expect(runtime.handlePanelKeydown).not.toHaveBeenCalled()
  })
})
