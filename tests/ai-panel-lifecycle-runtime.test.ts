import { describe, expect, it, vi } from 'vitest'
import {
  aiPanelChatMessagesSignature,
  aiPanelEditableStateSignature,
  createAiPanelLifecycleRuntime,
  type AiPanelLifecycleRuntimeOptions,
  type AiPanelOnboardingRequest
} from '@/services/ai/aiPanelLifecycleRuntime'
import type { AiContextOption } from '@shared/contracts/aiChat'

const host = (input: Partial<AiContextOption> & Pick<AiContextOption, 'id' | 'label'>): AiContextOption => ({
  kind: 'hosts',
  ...input
})

const createHarness = (overrides: Partial<AiPanelLifecycleRuntimeOptions<{ id: string }>> = {}) => {
  const state = {
    selectedConversationId: 'conv-1',
    conversationIdsSignature: 'conv-1|conv-2',
    chatMessagesSignature: 'message-signature',
    activeCodexTargetSignature: 'target-1',
    terminalSettingsSignature: 'settings-1',
    attentionSequence: 1,
    attentionItem: { id: 'attention-1' } as { id: string } | null,
    onboardingSequence: 0,
    onboardingRequest: { sequence: 0, action: 'none' } as AiPanelOnboardingRequest,
    editableStateSignature: ['contexts', 'command', 'command-ref', 'files'] as const,
    syncingFromEditable: false,
    draft: ''
  }
  const mounted: Array<() => void> = []
  const beforeUnmount: Array<() => void> = []
  const watched: Array<{ immediate?: boolean; callback: (value: any) => void | Promise<void>; value: any }> = []
  const calls = {
    applyCodexTerminalSettingsToAll: vi.fn(),
    clearHistoryNoticeTimer: vi.fn(),
    closePopups: vi.fn(),
    disposeChatSearchRuntime: vi.fn(),
    disposeCodexRuntime: vi.fn(),
    disposeSurfaceRuntime: vi.fn(),
    disposeVoiceRuntime: vi.fn(),
    ensureConversationTab: vi.fn(),
    focusAiAttentionItem: vi.fn(),
    openContextPopup: vi.fn(),
    openModeOnboarding: vi.fn(),
    openModelOnboarding: vi.fn(async () => undefined),
    prepareSendOnboarding: vi.fn(),
    pruneConversationTabs: vi.fn(),
    renderEditableFromState: vi.fn(),
    setDraft: vi.fn((value: string) => {
      state.draft = value
    }),
    startInitialMode: vi.fn(),
    syncActiveCodexTargetContext: vi.fn(),
    syncSearchForMessages: vi.fn(async () => undefined),
    cancelChatScrollFrame: vi.fn()
  }
  const runtime = createAiPanelLifecycleRuntime({
    watch: ((source: any, callback: any, options?: { immediate?: boolean }) => {
      const value = Array.isArray(source) ? source.map((item) => item()) : source()
      watched.push({ immediate: options?.immediate, callback, value })
      if (options?.immediate) void callback(value)
      return vi.fn()
    }) as never,
    onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => beforeUnmount.push(callback),
    afterDomUpdate: (callback) => callback(),
    selectedConversationId: () => state.selectedConversationId,
    conversationIdsSignature: () => state.conversationIdsSignature,
    pruneConversationTabs: calls.pruneConversationTabs,
    ensureConversationTab: calls.ensureConversationTab,
    chatMessagesSignature: () => state.chatMessagesSignature,
    syncSearchForMessages: calls.syncSearchForMessages,
    activeCodexTargetSignature: () => state.activeCodexTargetSignature,
    syncActiveCodexTargetContext: calls.syncActiveCodexTargetContext,
    terminalSettingsSignature: () => state.terminalSettingsSignature,
    applyCodexTerminalSettingsToAll: calls.applyCodexTerminalSettingsToAll,
    aiAttentionFocusSequence: () => state.attentionSequence,
    aiAttentionFocusItem: () => state.attentionItem,
    focusAiAttentionItem: calls.focusAiAttentionItem,
    onboardingRequestSequence: () => state.onboardingSequence,
    onboardingRequest: () => state.onboardingRequest,
    openModeOnboarding: calls.openModeOnboarding,
    openModelOnboarding: calls.openModelOnboarding,
    openContextPopup: calls.openContextPopup,
    prepareSendOnboarding: calls.prepareSendOnboarding,
    closePopups: calls.closePopups,
    draftText: () => state.draft || '',
    setDraft: calls.setDraft,
    editableStateSignature: () => state.editableStateSignature,
    syncingFromEditable: () => state.syncingFromEditable,
    renderEditableFromState: calls.renderEditableFromState,
    startInitialMode: calls.startInitialMode,
    cancelChatScrollFrame: calls.cancelChatScrollFrame,
    disposeCodexRuntime: calls.disposeCodexRuntime,
    disposeChatSearchRuntime: calls.disposeChatSearchRuntime,
    clearHistoryNoticeTimer: calls.clearHistoryNoticeTimer,
    disposeSurfaceRuntime: calls.disposeSurfaceRuntime,
    disposeVoiceRuntime: calls.disposeVoiceRuntime,
    ...overrides
  })
  return { beforeUnmount, calls, mounted, runtime, state, watched }
}

describe('aiPanelLifecycleRuntime', () => {
  it('derives stable message and editable state signatures', () => {
    expect(
      aiPanelChatMessagesSignature([
        {
          id: 'assistant-1',
          text: 'Done',
          state: 'done',
          commandExecutionStatus: 'success',
          contentParts: [{ type: 'text' }]
        }
      ])
    ).toBe('assistant-1:Done:done:::::success::1')

    expect(
      aiPanelEditableStateSignature({
        selectedContexts: [host({ id: 'prod', label: '10.0.0.8', data: 'opaque' })],
        selectedCommandId: 'rollback',
        selectedCommandRef: { command: '/rollback', label: 'Rollback', path: 'rollback.md' },
        fileInputParts: [{ ref: { absPath: '/tmp/runbook.md', name: 'runbook.md' } }]
      })
    ).toEqual(['prod:10.0.0.8:opaque', 'rollback', '/rollback:Rollback:rollback.md', '/tmp/runbook.md:runbook.md'])
  })

  it('registers lifecycle watchers and mounted/unmounted callbacks through one boundary', async () => {
    const { beforeUnmount, calls, mounted, runtime, watched } = createHarness()

    runtime.start()

    expect(watched).toHaveLength(7)
    expect(calls.pruneConversationTabs).toHaveBeenCalled()
    expect(calls.ensureConversationTab).toHaveBeenCalledWith('conv-1')
    expect(calls.syncSearchForMessages).toHaveBeenCalled()
    expect(calls.renderEditableFromState).toHaveBeenCalled()

    mounted[0]()
    expect(calls.startInitialMode).toHaveBeenCalled()

    beforeUnmount[0]()
    expect(calls.disposeCodexRuntime).toHaveBeenCalled()
    expect(calls.cancelChatScrollFrame).toHaveBeenCalled()
    expect(calls.disposeChatSearchRuntime).toHaveBeenCalled()
    expect(calls.clearHistoryNoticeTimer).toHaveBeenCalled()
    expect(calls.disposeSurfaceRuntime).toHaveBeenCalled()
    expect(calls.disposeVoiceRuntime).toHaveBeenCalled()
  })

  it('handles attention focus and onboarding request branches', async () => {
    const { calls, runtime, state } = createHarness()

    runtime.handleAiAttentionFocusRequest()
    expect(calls.focusAiAttentionItem).toHaveBeenCalledWith({ id: 'attention-1' })

    state.onboardingRequest = { sequence: 1, action: 'open-mode' }
    await runtime.handleOnboardingRequest(1)
    expect(calls.openModeOnboarding).toHaveBeenCalled()

    state.onboardingRequest = { sequence: 2, action: 'open-context-hosts' }
    await runtime.handleOnboardingRequest(2)
    expect(calls.openContextPopup).toHaveBeenCalledWith('hosts')

    state.onboardingRequest = { sequence: 3, action: 'prepare-send' }
    await runtime.handleOnboardingRequest(3)
    expect(calls.prepareSendOnboarding).toHaveBeenCalled()
    expect(calls.closePopups).toHaveBeenCalled()
    expect(calls.setDraft).toHaveBeenCalledWith('查看本地主机状态')
  })

  it('skips editable render while syncing from editable input', () => {
    const { calls, runtime, state } = createHarness()

    state.syncingFromEditable = true
    runtime.handleEditableStateChanged()
    expect(calls.renderEditableFromState).not.toHaveBeenCalled()

    state.syncingFromEditable = false
    runtime.handleEditableStateChanged()
    expect(calls.renderEditableFromState).toHaveBeenCalled()
  })
})
