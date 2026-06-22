import { reactive, ref, toRef } from 'vue'
import { createAiPanelChatSearchRuntime, createEmptyAiPanelChatSearchRuntimeState } from '@/services/aiPanelChatSearchRuntime'
import type { AiPanelHistoryRuntimeState } from '@/services/aiPanelHistoryRuntime'

export type AiPanelChatViewportRuntimeOptions = {
  historyState: AiPanelHistoryRuntimeState
  closePopups: () => void
  closeMoreActionsMenu: () => void
  afterDomUpdate: (callback?: () => void) => void | Promise<void>
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
  setSearchTimer: (callback: () => void, delay: number) => unknown
  clearSearchTimer: (timer: unknown) => void
}

export const createAiPanelChatViewportRuntime = (options: AiPanelChatViewportRuntimeOptions) => {
  const chatScrollRef = ref<HTMLElement | null>(null)
  const chatSearchInputRef = ref<HTMLInputElement | null>(null)
  const chatSearchRuntimeState = reactive(createEmptyAiPanelChatSearchRuntimeState())
  const chatSearchOpen = toRef(options.historyState, 'chatSearchOpen')
  const chatSearchTerm = toRef(chatSearchRuntimeState, 'term')
  const chatSearchMatchCount = toRef(chatSearchRuntimeState, 'matchCount')
  const chatSearchCurrentIndex = toRef(chatSearchRuntimeState, 'currentIndex')
  let chatScrollFrame: number | undefined

  const scrollChatToBottom = () => {
    const root = chatScrollRef.value
    if (!root) return
    root.scrollTop = root.scrollHeight
  }

  const scheduleChatScrollToBottom = () => {
    void Promise.resolve(options.afterDomUpdate()).then(() => {
      if (chatScrollFrame !== undefined) options.cancelFrame(chatScrollFrame)
      chatScrollFrame = options.requestFrame(() => {
        chatScrollFrame = undefined
        scrollChatToBottom()
      })
    })
  }

  const aiPanelChatSearchRuntime = createAiPanelChatSearchRuntime({
    state: chatSearchRuntimeState,
    isOpen: () => chatSearchOpen.value,
    setOpen: (open) => {
      chatSearchOpen.value = open
      if (open) options.closeMoreActionsMenu()
    },
    root: () => chatScrollRef.value,
    closePopups: options.closePopups,
    focusSearchInput: () => chatSearchInputRef.value?.focus(),
    afterDomUpdate: () => options.afterDomUpdate(),
    scheduleScrollToBottom: scheduleChatScrollToBottom,
    setSearchTimer: options.setSearchTimer,
    clearSearchTimer: options.clearSearchTimer
  })

  const cancelChatScrollFrame = () => {
    if (chatScrollFrame === undefined) return
    options.cancelFrame(chatScrollFrame)
    chatScrollFrame = undefined
  }

  const dispose = () => {
    cancelChatScrollFrame()
    aiPanelChatSearchRuntime.dispose()
  }

  return {
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    cancelChatScrollFrame,
    clearChatSearch: () => aiPanelChatSearchRuntime.clearSearch(),
    closeChatSearch: () => aiPanelChatSearchRuntime.closeSearch(),
    dispose,
    findNextChatMatch: () => aiPanelChatSearchRuntime.findNextMatch(),
    findPreviousChatMatch: () => aiPanelChatSearchRuntime.findPreviousMatch(),
    handleSearchTermChanged: () => aiPanelChatSearchRuntime.handleSearchTermChanged(),
    openChatSearch: () => aiPanelChatSearchRuntime.openSearch(),
    scheduleChatScrollToBottom,
    scrollChatToBottom,
    syncSearchForMessages: () => aiPanelChatSearchRuntime.syncSearchForMessages()
  }
}
