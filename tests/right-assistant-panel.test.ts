import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RightAssistantPanel from '@/components/RightAssistantPanel.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const getProjectFileContext = vi.fn()

const PassivePanel = defineComponent({
  props: [
    'agentMode',
    'productSessionRequest',
    'projectFilesAvailable',
    'projectFilesActive'
  ],
  emits: [
    'productSessionRequestConsumed',
    'toggleProjectFiles',
    'closeProjectFiles'
  ],
  template: `
    <div>
      <button
        v-if="projectFilesAvailable"
        data-testid="project-files-toggle"
        @click="$emit('toggleProjectFiles')"
      />
      <div v-if="projectFilesActive" data-testid="project-files-drawer">
        <button data-testid="project-files-close" @click="$emit('closeProjectFiles')" />
      </div>
    </div>
  `
})

const mountPanel = () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(RightAssistantPanel, {
    props: {
      agentMode: true,
      productSessionRequest: null
    },
    global: {
      plugins: [pinia],
      stubs: {
        AiPanel: PassivePanel
      }
    }
  })
}

const selectManagedSession = (sessionId: string, cwd: string) => {
  const workspace = useWorkspaceStore()
  workspace.upsertManagedAiSession({
    source: 'codex',
    event: 'session_start',
    sessionId,
    title: sessionId,
    summary: '',
    panelId: `panel-${sessionId}`,
    terminalSessionId: `terminal-${sessionId}`,
    cwd,
    receivedAt: Date.now()
  })
  workspace.selectedManagedAiSessionKey = `codex:${sessionId}`
}

describe('RightAssistantPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    getProjectFileContext.mockReset()
    Object.assign(window.aiops, { getProjectFileContext })
  })

  it('keeps project files hidden without a selected managed AI session', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(false)
    expect(localStorage.getItem('aiopsterm.rightAssistantTab')).toBeNull()
  })

  it('shows the contextual entry for an eligible session and closes it for an ineligible session', async () => {
    getProjectFileContext.mockImplementation(async ({ sessionId }: { sessionId: string }) => sessionId === 'eligible'
      ? {
          ok: true,
          data: {
            source: 'codex',
            sessionId,
            projectRoot: '/work/eligible',
            capability: 'adapter',
            recent: []
          }
        }
      : {
          ok: false,
          errorMessage: 'No eligible local project.'
        })

    const wrapper = mountPanel()
    selectManagedSession('eligible', '/work/eligible')
    await flushPromises()

    await wrapper.get('[data-testid="project-files-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(true)

    selectManagedSession('ineligible', '/work/ineligible')
    await flushPromises()

    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(false)
  })

  it('closes project files when a product session request takes focus', async () => {
    getProjectFileContext.mockResolvedValue({
      ok: true,
      data: {
        source: 'codex',
        sessionId: 'eligible',
        projectRoot: '/work/eligible',
        capability: 'adapter',
        recent: []
      }
    })

    const wrapper = mountPanel()
    selectManagedSession('eligible', '/work/eligible')
    await flushPromises()
    await wrapper.get('[data-testid="project-files-toggle"]').trigger('click')

    await wrapper.setProps({
      productSessionRequest: {
        action: 'restore',
        surface: 'codex',
        sessionId: 'session-1',
        sequence: 1
      }
    })

    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(false)
  })
})
