import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { createAiPanelChatViewportRuntime } from '@/services/aiPanelChatViewportRuntime'
import { createEmptyAiPanelHistoryRuntimeState } from '@/services/aiPanelHistoryRuntime'

const createHarness = () => {
  const historyState = createEmptyAiPanelHistoryRuntimeState()
  const root = document.createElement('div')
  root.style.height = '100px'
  root.innerHTML = `
    <article class="message"><p>rollback first</p><button>rollback ignored</button></article>
    <article class="message"><p>second rollback</p></article>
    <form class="chat-input">rollback ignored</form>
  `
  Object.defineProperty(root, 'scrollHeight', { value: 480, configurable: true })
  const input = document.createElement('input')
  const frameCallbacks: Array<() => void> = []
  const timers: Array<() => void> = []
  const calls = {
    closePopups: vi.fn(),
    closeMoreActionsMenu: vi.fn(),
    afterDomUpdate: vi.fn(async (callback?: () => void) => callback?.()),
    requestFrame: vi.fn((callback: () => void) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    }),
    cancelFrame: vi.fn(),
    clearSearchTimer: vi.fn()
  }
  const runtime = createAiPanelChatViewportRuntime({
    historyState,
    closePopups: calls.closePopups,
    closeMoreActionsMenu: calls.closeMoreActionsMenu,
    afterDomUpdate: calls.afterDomUpdate,
    requestFrame: calls.requestFrame,
    cancelFrame: calls.cancelFrame,
    setSearchTimer: (callback) => {
      timers.push(callback)
      return callback
    },
    clearSearchTimer: calls.clearSearchTimer
  })
  runtime.chatScrollRef.value = root
  runtime.chatSearchInputRef.value = input
  return { calls, frameCallbacks, historyState, input, root, runtime, timers }
}

describe('aiPanelChatViewportRuntime', () => {
  it('owns chat search refs, open state, highlights, and navigation while preserving public fields', async () => {
    const { calls, historyState, root, runtime } = createHarness()
    runtime.chatSearchTerm.value = 'rollback'

    await runtime.openChatSearch()

    expect(historyState.chatSearchOpen).toBe(true)
    expect(runtime.chatSearchOpen.value).toBe(true)
    expect(calls.closePopups).toHaveBeenCalled()
    expect(calls.closeMoreActionsMenu).toHaveBeenCalled()
    expect(runtime.chatSearchMatchCount.value).toBe(2)
    expect(runtime.chatSearchCurrentIndex.value).toBe(1)
    expect(root.querySelectorAll('.ai-chat-search-highlight')).toHaveLength(2)

    runtime.findNextChatMatch()
    expect(runtime.chatSearchCurrentIndex.value).toBe(2)
    runtime.findPreviousChatMatch()
    expect(runtime.chatSearchCurrentIndex.value).toBe(1)

    await runtime.clearChatSearch()
    expect(runtime.chatSearchTerm.value).toBe('')
    expect(runtime.chatSearchMatchCount.value).toBe(0)
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
  })

  it('schedules bottom scrolling, cancels pending frames, and disposes search state', async () => {
    const { calls, frameCallbacks, root, runtime, timers } = createHarness()

    runtime.scheduleChatScrollToBottom()
    await Promise.resolve()
    expect(calls.requestFrame).toHaveBeenCalledTimes(1)
    frameCallbacks[0]()
    expect(root.scrollTop).toBe(480)

    runtime.scheduleChatScrollToBottom()
    await Promise.resolve()
    runtime.scheduleChatScrollToBottom()
    await Promise.resolve()
    expect(calls.cancelFrame).toHaveBeenCalledWith(2)

    runtime.chatSearchTerm.value = 'rollback'
    await runtime.openChatSearch()
    runtime.chatSearchTerm.value = 'second'
    runtime.handleSearchTermChanged()
    expect(timers).toHaveLength(1)

    runtime.dispose()
    expect(calls.clearSearchTimer).toHaveBeenCalled()
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
  })

  it('syncs search for message changes or delegates inactive searches to scroll scheduling', async () => {
    const { calls, runtime } = createHarness()
    runtime.chatSearchTerm.value = 'rollback'

    await runtime.syncSearchForMessages()
    await Promise.resolve()
    expect(calls.requestFrame).toHaveBeenCalled()

    await runtime.openChatSearch()
    calls.requestFrame.mockClear()
    await runtime.syncSearchForMessages()
    expect(runtime.chatSearchMatchCount.value).toBe(2)
    expect(calls.requestFrame).not.toHaveBeenCalled()
  })

  it('exposes reactive search refs for component v-model watchers', async () => {
    const { runtime, timers } = createHarness()
    const stop = watch(runtime.chatSearchTerm, () => runtime.handleSearchTermChanged())

    await runtime.openChatSearch()
    runtime.chatSearchTerm.value = 'rollback'
    await Promise.resolve()

    expect(timers).toHaveLength(1)
    stop()
  })
})
