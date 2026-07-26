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
    'projectFilesActive',
    'projectFilesSession'
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

const mountPanel = (pinia = createPinia()) => {
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
  const panel = workspace.panels.find((item) => item.id === workspace.activePanelId)!
  panel.sessionId = `terminal-${sessionId}`
  panel.cwd = cwd
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
  workspace.activePanelId = panel.id
}

describe('RightAssistantPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    getProjectFileContext.mockReset()
    Object.assign(window.aiops, { getProjectFileContext })
  })

  it('keeps project files hidden without a managed AI session bound to the active terminal', async () => {
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

  it('retries availability when the binding hook arrives after an optimistic terminal resume', async () => {
    getProjectFileContext
      .mockResolvedValueOnce({
        ok: false,
        errorCode: 'SESSION_NOT_BOUND',
        errorMessage: 'The managed session is not bound yet.'
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          source: 'codex',
          sessionId: 'resumed',
          projectRoot: '/work/resumed',
          capability: 'adapter',
          recent: []
        }
      })

    const wrapper = mountPanel()
    selectManagedSession('resumed', '/work/resumed')
    const workspace = useWorkspaceStore()
    await flushPromises()

    expect(getProjectFileContext).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(false)

    const session = workspace.managedAiSessions.find((item) => item.id === 'resumed')!
    workspace.upsertManagedAiSession({
      source: 'codex',
      event: 'session_start',
      sessionId: 'resumed',
      title: 'resumed',
      summary: '',
      panelId: session.panelId,
      terminalSessionId: session.terminalSessionId,
      cwd: session.cwd,
      receivedAt: session.lastActivityAt + 1
    })
    await flushPromises()

    expect(getProjectFileContext).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(true)
  })

  it('follows the active terminal instead of the AI inbox selection', async () => {
    getProjectFileContext.mockImplementation(async ({ sessionId }: { sessionId: string }) => ({
      ok: true,
      data: {
        source: 'codex',
        sessionId,
        projectRoot: `/work/${sessionId}`,
        capability: 'adapter',
        recent: []
      }
    }))
    const wrapper = mountPanel()
    selectManagedSession('terminal-owner', '/work/terminal-owner')
    const workspace = useWorkspaceStore()
    workspace.upsertManagedAiSession({
      source: 'claude-code',
      event: 'session_start',
      sessionId: 'inbox-selection',
      title: 'Inbox selection',
      summary: '',
      terminalSessionId: 'terminal-other',
      cwd: '/work/inbox-selection',
      receivedAt: Date.now() + 1
    })
    workspace.selectedManagedAiSessionKey = 'claude-code:inbox-selection'
    await flushPromises()

    expect(getProjectFileContext).toHaveBeenLastCalledWith({
      source: 'codex',
      sessionId: 'terminal-owner'
    })
    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(true)
  })

  it('remembers the selected surface independently for each terminal', async () => {
    getProjectFileContext.mockImplementation(async ({ sessionId }: { sessionId: string }) => ({
      ok: true,
      data: {
        source: 'codex',
        sessionId,
        projectRoot: `/work/${sessionId}`,
        capability: 'adapter',
        recent: []
      }
    }))

    const wrapper = mountPanel()
    selectManagedSession('first', '/work/first')
    const workspace = useWorkspaceStore()
    const firstPanelId = workspace.activePanelId
    await flushPromises()
    await wrapper.get('[data-testid="project-files-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(true)

    const secondPanel = workspace.createPanel()
    secondPanel.sessionId = 'terminal-second'
    workspace.upsertManagedAiSession({
      source: 'codex',
      event: 'session_start',
      sessionId: 'second',
      title: 'second',
      summary: '',
      panelId: secondPanel.id,
      terminalSessionId: 'terminal-second',
      cwd: '/work/second',
      receivedAt: Date.now() + 1
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="project-files-toggle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(false)

    workspace.activePanelId = firstPanelId
    await flushPromises()
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(true)
  })

  it('keeps the files surface when the same terminal changes managed session', async () => {
    getProjectFileContext.mockImplementation(async ({ sessionId }: { sessionId: string }) => ({
      ok: true,
      data: {
        source: 'codex',
        sessionId,
        projectRoot: `/work/${sessionId}`,
        capability: 'adapter',
        recent: []
      }
    }))

    const wrapper = mountPanel()
    selectManagedSession('before-resume', '/work/before-resume')
    const workspace = useWorkspaceStore()
    await flushPromises()
    await wrapper.get('[data-testid="project-files-toggle"]').trigger('click')

    workspace.upsertManagedAiSession({
      source: 'codex',
      event: 'session_start',
      sessionId: 'after-resume',
      title: 'after-resume',
      summary: '',
      terminalSessionId: 'terminal-before-resume',
      cwd: '/work/after-resume',
      receivedAt: Date.now() + 1
    })
    await flushPromises()

    expect(getProjectFileContext).toHaveBeenLastCalledWith({
      source: 'codex',
      sessionId: 'after-resume'
    })
    expect(wrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(true)
  })

  it('keeps the terminal preference when the panel component is remounted', async () => {
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

    const pinia = createPinia()
    const firstWrapper = mountPanel(pinia)
    selectManagedSession('eligible', '/work/eligible')
    await flushPromises()
    await firstWrapper.get('[data-testid="project-files-toggle"]').trigger('click')
    firstWrapper.unmount()

    const secondWrapper = mountPanel(pinia)
    await flushPromises()
    expect(secondWrapper.find('[data-testid="project-files-drawer"]').exists()).toBe(true)
  })

  it('releases the remembered surface when the terminal session closes', async () => {
    const wrapper = mountPanel()
    selectManagedSession('eligible', '/work/eligible')
    const workspace = useWorkspaceStore()
    workspace.setRightAssistantSurfaceForTerminal('terminal-eligible', 'files')

    const panel = workspace.panels.find((item) => item.id === workspace.activePanelId)!
    panel.sessionId = undefined
    await flushPromises()

    expect(workspace.rightAssistantSurfaceForTerminal('terminal-eligible')).toBe('ai')
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
