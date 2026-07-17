import { mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

let runtime: ReturnType<typeof createRuntime>

vi.mock('@/services/ai/aiPanelContext', () => ({
  useAiPanelRuntimeContext: () => runtime
}))

import AiPanelClassicConversation from '@/components/ai/AiPanelClassicConversation.vue'

const createRuntime = (mode: 'classic' | 'codex') => ({
  activateChatViewport: vi.fn(),
  aiPanelMode: ref(mode),
  chatScrollRef: ref<HTMLElement | null>(null),
  showNoAvailableModelPrompt: ref(false),
  t: (key: string) => key,
  visibleChatMessages: ref<any[]>([]),
  isCommandSuggestionMessage: () => false,
  renderedMarkdownParts: () => [],
  formatMcpToolArguments: (message: any) => JSON.stringify(message.mcpToolCall?.arguments || {}),
  approveMcpToolCall: vi.fn(),
  rejectMcpToolCall: vi.fn(),
  approveMcpResourceAccess: vi.fn(),
  rejectMcpResourceAccess: vi.fn(),
  copyMessageToClipboard: vi.fn(),
  toggleMessageFavorite: vi.fn(),
  setMessageFeedback: vi.fn(),
  retryAssistantMessage: vi.fn(),
  summarizeMessageToKnowledge: vi.fn(),
  summarizeMessageToSkill: vi.fn(),
  workspace: reactive({
    billingSettings: { skippedLogin: false },
    chatMessages: [] as any[],
    config: { modelName: 'test-model' }
  })
})

const mountConversation = () => mount(AiPanelClassicConversation, {
  global: {
    stubs: {
      AiPanelChatSearchBar: true
    }
  }
})

describe('AiPanelClassicConversation', () => {
  it('activates the chat viewport when initially mounted in Classic mode', () => {
    runtime = createRuntime('classic')

    const wrapper = mountConversation()

    expect(runtime.activateChatViewport).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('reactivates the chat viewport whenever the hidden Classic surface becomes visible', async () => {
    runtime = createRuntime('codex')
    const wrapper = mountConversation()
    expect(runtime.activateChatViewport).not.toHaveBeenCalled()

    runtime.aiPanelMode.value = 'classic'
    await nextTick()
    expect(runtime.activateChatViewport).toHaveBeenCalledTimes(1)

    runtime.aiPanelMode.value = 'codex'
    await nextTick()
    runtime.aiPanelMode.value = 'classic'
    await nextTick()
    expect(runtime.activateChatViewport).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('uses the existing tool card without exposing the legacy auto-approve action for sensitive host reads', async () => {
    runtime = createRuntime('classic')
    const message = {
      id: 'cline-sensitive-read',
      role: 'assistant',
      text: 'read_host_file: /var/log/api.log',
      state: 'done',
      ask: 'mcp_tool_call',
      mcpToolCall: {
        serverName: 'production',
        toolName: 'read_host_file',
        arguments: { path: '/var/log/api.log' }
      },
      agentTask: {
        taskId: 'request-read',
        turnId: 'request-read-assistant',
        toolCallId: 'tool-read',
        toolName: 'read_host_file',
        targetId: 'asset-prod',
        targetLabel: 'production',
        terminalSessionId: 'terminal-prod',
        status: 'waiting-approval'
      }
    }
    runtime.visibleChatMessages.value = [message]
    runtime.workspace.chatMessages = [message]

    const wrapper = mountConversation()
    expect(wrapper.get('[data-testid="ai-mcp-tool-call"]').text()).toContain('Target')
    expect(wrapper.find('[data-testid="ai-mcp-tool-auto-approve"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ai-mcp-tool-approve"]').trigger('click')
    expect(runtime.approveMcpToolCall).toHaveBeenCalledWith('cline-sensitive-read')

    wrapper.unmount()
  })
})
