import type { WatchStopHandle } from 'vue'
import type { AiPanelMode } from '@/services/ai/aiPanelModeRuntime'
import type { AiContextOption } from '@shared/contracts/aiChat'

export type AiPanelOnboardingRequest = {
  sequence: number
  action: 'none' | 'open-mode' | 'open-model' | 'open-context-main' | 'open-context-hosts' | 'prepare-send'
}

export type AiPanelLifecycleWatchSource<T> = () => T
export type AiPanelLifecycleWatchCallback<T> = (value: T, oldValue?: T) => void | Promise<void>

export type AiPanelLifecycleWatch = {
  <T>(source: AiPanelLifecycleWatchSource<T>, callback: AiPanelLifecycleWatchCallback<T>, options?: { immediate?: boolean }): WatchStopHandle
  <T extends readonly unknown[]>(sources: { [K in keyof T]: AiPanelLifecycleWatchSource<T[K]> }, callback: AiPanelLifecycleWatchCallback<T>, options?: { immediate?: boolean }): WatchStopHandle
}

export type AiPanelLifecycleRuntimeOptions<AttentionItem = unknown> = {
  watch: AiPanelLifecycleWatch
  onMounted: (callback: () => void) => void
  onBeforeUnmount: (callback: () => void) => void
  afterDomUpdate: (callback: () => void) => void | Promise<void>
  selectedConversationId: () => string
  conversationIdsSignature: () => string
  pruneConversationTabs: () => void
  ensureConversationTab: (id: string) => void
  chatMessagesSignature: () => string
  syncSearchForMessages: () => Promise<void>
  activeCodexTargetSignature: () => string
  syncActiveCodexTargetContext: () => void | Promise<void>
  terminalSettingsSignature: () => string
  applyCodexTerminalSettingsToAll: () => void
  aiAttentionFocusSequence: () => number
  aiAttentionFocusItem: () => AttentionItem | null | undefined
  focusAiAttentionItem: (item: AttentionItem) => void | Promise<void>
  onboardingRequestSequence: () => number
  onboardingRequest: () => AiPanelOnboardingRequest
  openModeOnboarding: () => void
  openModelOnboarding: () => void | Promise<void>
  openContextPopup: (level?: 'main' | 'hosts') => void
  prepareSendOnboarding: () => void
  closePopups: () => void
  draftText: () => string
  setDraft: (value: string) => void
  editableStateSignature: () => readonly string[]
  syncingFromEditable: () => boolean
  renderEditableFromState: () => void
  startInitialMode: () => void
  cancelChatScrollFrame: () => void
  disposeCodexRuntime: () => void
  disposeChatSearchRuntime: () => void
  clearHistoryNoticeTimer: () => void
  disposeSurfaceRuntime: () => void
  disposeVoiceRuntime: () => void
}

export const aiPanelChatMessagesSignature = (
  messages: Array<{
    id: string
    text?: string
    state?: string
    ask?: string
    say?: string
    action?: string
    executedCommand?: string
    commandExecutionStatus?: string
    commandExecutionMessage?: string
    contentParts?: unknown[]
  }>
) =>
  messages
    .map((message) =>
      [
        message.id,
        message.text || '',
        message.state || '',
        message.ask || '',
        message.say || '',
        message.action || '',
        message.executedCommand || '',
        message.commandExecutionStatus || '',
        message.commandExecutionMessage || '',
        message.contentParts?.length || 0
      ].join(':')
    )
    .join('|')

export const aiPanelEditableStateSignature = (input: {
  selectedContexts: AiContextOption[]
  selectedCommandId?: string | null
  selectedCommandRef?: { command?: string; label?: string; path?: string } | null
  fileInputParts: Array<{ ref: { absPath: string; name?: string } }>
}) => [
  input.selectedContexts.map((context) => `${context.id}:${context.label}:${context.data || ''}`).join('|'),
  input.selectedCommandId || '',
  `${input.selectedCommandRef?.command || ''}:${input.selectedCommandRef?.label || ''}:${input.selectedCommandRef?.path || ''}`,
  input.fileInputParts.map((part) => `${part.ref.absPath}:${part.ref.name || ''}`).join('|')
] as const

export const createAiPanelLifecycleRuntime = <AttentionItem = unknown>(options: AiPanelLifecycleRuntimeOptions<AttentionItem>) => {
  const syncConversationTabs = ([selectedConversationId]: readonly [string, string]) => {
    options.pruneConversationTabs()
    options.ensureConversationTab(selectedConversationId)
  }

  const handleChatMessagesChanged = async () => {
    await options.syncSearchForMessages()
  }

  const handleAiAttentionFocusRequest = () => {
    const item = options.aiAttentionFocusItem()
    if (!item) return
    void options.focusAiAttentionItem(item)
  }

  const handleOnboardingRequest = async (sequence: number) => {
    const request = options.onboardingRequest()
    if (sequence === 0 && request.action === 'none') return
    if (request.action === 'open-mode') {
      options.openModeOnboarding()
      return
    }
    if (request.action === 'open-model') {
      await options.openModelOnboarding()
      return
    }
    if (request.action === 'open-context-main') {
      options.openContextPopup('main')
      return
    }
    if (request.action === 'open-context-hosts') {
      options.openContextPopup('hosts')
      return
    }
    if (request.action === 'prepare-send') {
      options.prepareSendOnboarding()
      options.closePopups()
      if (!options.draftText().trim()) options.setDraft('查看本地主机状态')
      return
    }
    options.closePopups()
  }

  const handleEditableStateChanged = () => {
    if (options.syncingFromEditable()) return
    void options.afterDomUpdate(options.renderEditableFromState)
  }

  const start = () => {
    options.watch([options.selectedConversationId, options.conversationIdsSignature], syncConversationTabs, { immediate: true })
    options.watch(options.chatMessagesSignature, handleChatMessagesChanged, { immediate: true })
    options.watch(options.activeCodexTargetSignature, () => void options.syncActiveCodexTargetContext())
    options.watch(options.terminalSettingsSignature, () => options.applyCodexTerminalSettingsToAll())
    options.watch(options.aiAttentionFocusSequence, handleAiAttentionFocusRequest)
    options.watch(options.onboardingRequestSequence, handleOnboardingRequest, { immediate: true })
    options.watch(options.editableStateSignature, handleEditableStateChanged, { immediate: true })

    options.onMounted(() => {
      options.startInitialMode()
    })

    options.onBeforeUnmount(() => {
      options.disposeCodexRuntime()
      options.cancelChatScrollFrame()
      options.disposeChatSearchRuntime()
      options.clearHistoryNoticeTimer()
      options.disposeSurfaceRuntime()
      options.disposeVoiceRuntime()
    })
  }

  return {
    handleAiAttentionFocusRequest,
    handleChatMessagesChanged,
    handleEditableStateChanged,
    handleOnboardingRequest,
    start,
    syncConversationTabs
  }
}
