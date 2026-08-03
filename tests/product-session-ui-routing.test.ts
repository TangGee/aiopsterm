import { shallowMount } from '@vue/test-utils'
import { computed, defineComponent, reactive, watch } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appShellContext = vi.hoisted(() => ({ runtime: null as any }))

vi.mock('@/services/app/appShellRuntime', () => ({
  useAppShellRuntime: () => appShellContext.runtime
}))

import AgentsSidebar from '@/components/AgentsSidebar.vue'
import AppShell from '@/components/AppShell.vue'

const makeRuntime = () => {
  const workspace = reactive({
    activeModule: 'workspace',
    agentsLeftOpen: true,
    config: { background: { mode: 'none' }, watermark: 'closed' },
    isLeftVisible: false,
    isRightVisible: false,
    mode: 'agents',
    setWorkspaceMode: vi.fn((mode: 'terminal' | 'agents') => {
      workspace.mode = mode
    }),
    setActiveModule: vi.fn((module: string) => {
      workspace.activeModule = module
    })
  })
  return {
    appBackgroundStyle: {},
    cancelTerminalMfa: vi.fn(),
    displayAgentsLeftWidth: 280,
    displayLeftPanelWidth: 280,
    displayRightPanelWidth: 360,
    draggingSide: null,
    hasLeftPane: computed(() => workspace.mode === 'agents'),
    hasRightPane: computed(() => workspace.mode === 'agents'),
    setTerminalMfaInputRef: vi.fn(),
    showAgentsLeftPane: computed(() => workspace.mode === 'agents'),
    showTerminalLeftPane: false,
    showTerminalPasswordRemember: false,
    showTerminalRightPane: false,
    showRightPane: computed(() => workspace.mode === 'agents'),
    showTerminalWorkspace: computed(() => workspace.mode === 'agents'),
    startResize: vi.fn(),
    submitTerminalMfa: vi.fn(),
    terminalAuthDescription: '',
    terminalAuthPromptFallback: '',
    terminalAuthRequired: '',
    terminalAuthTitle: '',
    terminalMfaDialog: reactive({ open: false, request: null, responses: [], rememberPassword: false, submitting: false, error: '' }),
    terminalMfaPrompts: [],
    t: (key: string) => key,
    workspace
  }
}

describe('AppShell product session routing', () => {
  const databaseRequests: unknown[] = []
  const PassiveRightAssistantPanel = defineComponent({
    name: 'PassiveRightAssistantPanel',
    props: ['agentMode', 'productSessionRequest'],
    emits: ['productSessionRequestConsumed'],
    template: '<div />'
  })
  const PassiveDatabaseWorkspace = defineComponent({
    name: 'PassiveDatabaseWorkspace',
    props: ['productSessionRequest'],
    emits: ['productSessionRequestConsumed'],
    setup(props) {
      watch(
        () => props.productSessionRequest,
        (request) => {
          if (request) databaseRequests.push(request)
        },
        { immediate: true }
      )
    },
    template: '<div />'
  })
  const mountShell = () => shallowMount(AppShell, {
    global: {
      stubs: {
        RightAssistantPanel: PassiveRightAssistantPanel,
        DatabaseWorkspace: PassiveDatabaseWorkspace,
        KeepAlive: { template: '<div><slot /></div>' }
      }
    }
  })

  beforeEach(() => {
    databaseRequests.length = 0
    appShellContext.runtime = makeRuntime()
  })

  it('routes Classic and Codex requests to the Agents AI panel with a fresh sequence', async () => {
    const wrapper = mountShell()
    const sidebar = wrapper.findComponent(AgentsSidebar)

    sidebar.vm.$emit('requestProductSession', { action: 'restore', surface: 'classic', sessionId: 'classic-1' })
    const assistantPanel = wrapper.findComponent(PassiveRightAssistantPanel)
    await vi.waitFor(() => expect(assistantPanel.props('productSessionRequest')).toEqual({
      action: 'restore', surface: 'classic', sessionId: 'classic-1', sequence: 1
    }))
    expect(assistantPanel.props('agentMode')).toBe(true)
    expect(appShellContext.runtime.workspace.setActiveModule).toHaveBeenCalledWith('workspace')
    assistantPanel.vm.$emit('productSessionRequestConsumed', 1)
    await wrapper.vm.$nextTick()
    expect(assistantPanel.props('productSessionRequest')).toBeNull()

    sidebar.vm.$emit('requestProductSession', { action: 'restore', surface: 'codex', sessionId: 'codex-1' })
    await vi.waitFor(() => expect(assistantPanel.props('productSessionRequest')).toEqual({
      action: 'restore',
      surface: 'codex',
      sessionId: 'codex-1',
      sequence: 2
    }))
    assistantPanel.vm.$emit('productSessionRequestConsumed', 2)
    await wrapper.vm.$nextTick()
    expect(assistantPanel.props('productSessionRequest')).toBeNull()
  })

  it('switches to Database and forwards the same central request', async () => {
    const wrapper = mountShell()
    wrapper.findComponent(AgentsSidebar).vm.$emit('requestProductSession', {
      action: 'focus',
      surface: 'database',
      sessionId: 'db-1'
    })
    expect(appShellContext.runtime.workspace.setActiveModule).toHaveBeenCalledWith('database')
    expect(appShellContext.runtime.workspace.mode).toBe('terminal')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(PassiveRightAssistantPanel).exists()).toBe(false)
    const databaseWorkspace = wrapper.findComponent(PassiveDatabaseWorkspace)
    await vi.waitFor(() => expect(databaseRequests).toContainEqual({
      action: 'focus',
      surface: 'database',
      sessionId: 'db-1',
      sequence: 1
    }))
    databaseWorkspace.vm.$emit('productSessionRequestConsumed', 1)
    await wrapper.vm.$nextTick()
    expect(databaseWorkspace.props('productSessionRequest')).toBeNull()
  })
})
