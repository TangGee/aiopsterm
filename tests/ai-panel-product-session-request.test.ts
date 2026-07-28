import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductSessionUiRequest } from '@/components/productSessionUiTypes'

const context = vi.hoisted(() => ({ props: null as any, runtime: null as any }))

vi.mock('@/services/ai/aiPanelContainerRuntime', () => ({
  useAiPanelContainerRuntime: (props: unknown) => {
    context.props = props
    return context.runtime
  }
}))

vi.mock('@/components/ai/AiPanelPresentation.vue', () => ({
  default: { name: 'AiPanelPresentation', template: '<div data-testid="ai-panel-presentation" />' }
}))

import AiPanel from '@/components/AiPanel.vue'

const request = (input: Omit<ProductSessionUiRequest, 'sequence'>, sequence: number): ProductSessionUiRequest => ({
  ...input,
  sequence
})

describe('AiPanel product session requests', () => {
  beforeEach(() => {
    context.props = null
    context.runtime = {
      selectAiPanelMode: vi.fn(async () => true),
      createNewAiConversation: vi.fn(async () => undefined),
      createNewCodexConversation: vi.fn(async () => undefined),
      restoreHistoryConversation: vi.fn(async () => undefined),
      restoreCodexProductSession: vi.fn(async () => true),
      t: (key: string) => key,
      workspace: {
        activePanelId: '',
        panels: [],
        aiContextCatalog: { categories: [], openedHosts: [], selectedDefaults: [] },
        setTopNotice: vi.fn(),
        refreshAiContextCatalog: vi.fn(async () => true),
        openTerminalForAiHostContext: vi.fn(async () => null),
        activateTerminalPanel: vi.fn()
      }
    }
  })

  it('keeps agentMode reactive when the shared panel changes shell modes', async () => {
    const wrapper = mount(AiPanel, { props: { agentMode: false } })
    expect(context.props.agentMode).toBe(false)

    await wrapper.setProps({ agentMode: true })
    expect(context.props.agentMode).toBe(true)
  })

  it('creates the requested Classic surface after selecting its mode', async () => {
    const wrapper = mount(AiPanel, {
      props: {
        agentMode: true,
        productSessionRequest: request({ action: 'create', surface: 'classic' }, 1)
      },
      global: { stubs: { Teleport: true } }
    })
    await flushPromises()

    expect(context.runtime.selectAiPanelMode).toHaveBeenCalledWith('classic')
    expect(context.runtime.createNewAiConversation).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="agents-resource-dialog"]').exists()).toBe(true)
    await wrapper.find('[data-testid="agents-resource-create"]').trigger('click')
    await flushPromises()
    expect(context.runtime.createNewAiConversation).toHaveBeenCalledWith([])
    expect(context.runtime.createNewCodexConversation).not.toHaveBeenCalled()
    expect(wrapper.emitted('productSessionRequestConsumed')).toEqual([[1]])
  })

  it('restores Codex once per sequence and ignores DB requests', async () => {
    const wrapper = mount(AiPanel, { props: { agentMode: true } })
    const restore = request({ action: 'restore', surface: 'codex', sessionId: 'codex-1' }, 1)
    await wrapper.setProps({ productSessionRequest: restore })
    await flushPromises()
    expect(context.runtime.selectAiPanelMode).toHaveBeenCalledWith('codex')
    expect(context.runtime.restoreCodexProductSession).toHaveBeenCalledWith('codex-1')
    expect(wrapper.emitted('productSessionRequestConsumed')).toEqual([[1]])

    await wrapper.setProps({ productSessionRequest: { ...restore } })
    await flushPromises()
    expect(context.runtime.restoreCodexProductSession).toHaveBeenCalledTimes(1)

    await wrapper.setProps({
      productSessionRequest: request({ action: 'focus', surface: 'database', sessionId: 'db-1' }, 2)
    })
    await flushPromises()
    expect(context.runtime.selectAiPanelMode).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('productSessionRequestConsumed')).toEqual([[1], [2]])
  })

  it('does not mutate a surface when mode selection is rejected', async () => {
    context.runtime.selectAiPanelMode.mockResolvedValue(false)
    mount(AiPanel, {
      props: {
        productSessionRequest: request({ action: 'focus', surface: 'classic', sessionId: 'classic-1' }, 1)
      }
    })
    await flushPromises()
    expect(context.runtime.restoreHistoryConversation).not.toHaveBeenCalled()
    expect(context.runtime.workspace.setTopNotice).toHaveBeenCalledWith('agents.sessionFocusFailed')
  })
})
