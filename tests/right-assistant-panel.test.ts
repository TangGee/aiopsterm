import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import RightAssistantPanel from '@/components/RightAssistantPanel.vue'

const PassivePanel = defineComponent({
  props: ['agentMode', 'productSessionRequest'],
  emits: ['productSessionRequestConsumed'],
  template: '<div />'
})

describe('RightAssistantPanel', () => {
  beforeEach(() => localStorage.clear())

  it('preserves the Files tab and switches to AI for routed session requests', async () => {
    localStorage.setItem('aiopsterm.rightAssistantTab', 'files')
    const wrapper = mount(RightAssistantPanel, {
      props: {
        agentMode: true,
        productSessionRequest: null
      },
      global: {
        stubs: {
          AiPanel: PassivePanel,
          ProjectFilesPanel: PassivePanel
        }
      }
    })

    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Files')
    await wrapper.setProps({
      productSessionRequest: {
        action: 'restore',
        surface: 'codex',
        sessionId: 'session-1',
        sequence: 1
      }
    })
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('AI')
    expect(localStorage.getItem('aiopsterm.rightAssistantTab')).toBe('ai')
  })
})
