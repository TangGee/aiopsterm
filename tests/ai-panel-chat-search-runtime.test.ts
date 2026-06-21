import { describe, expect, it, vi } from 'vitest'
import {
  createAiPanelChatSearchRuntime,
  createEmptyAiPanelChatSearchRuntimeState
} from '@/services/aiPanelChatSearchRuntime'

const createHarness = () => {
  const state = createEmptyAiPanelChatSearchRuntimeState()
  let open = false
  const root = document.createElement('div')
  root.innerHTML = `
    <article class="message"><p>rollback first</p><button>rollback ignored</button></article>
    <article class="message"><p>second rollback</p></article>
    <form class="chat-input">rollback ignored</form>
  `
  const timers: Array<() => void> = []
  const calls = {
    closePopups: vi.fn(),
    focusSearchInput: vi.fn(async () => undefined),
    afterDomUpdate: vi.fn(async () => undefined),
    scheduleScrollToBottom: vi.fn(),
    clearSearchTimer: vi.fn()
  }
  const runtime = createAiPanelChatSearchRuntime({
    state,
    isOpen: () => open,
    setOpen: (nextOpen) => {
      open = nextOpen
    },
    root: () => root,
    closePopups: calls.closePopups,
    focusSearchInput: calls.focusSearchInput,
    afterDomUpdate: calls.afterDomUpdate,
    scheduleScrollToBottom: calls.scheduleScrollToBottom,
    setSearchTimer: (callback) => {
      timers.push(callback)
      return callback
    },
    clearSearchTimer: calls.clearSearchTimer
  })

  return {
    calls,
    isOpen: () => open,
    root,
    runtime,
    state,
    timers
  }
}

describe('aiPanelChatSearchRuntime', () => {
  it('opens search, highlights matches, and navigates active match state', async () => {
    const { calls, isOpen, root, runtime, state } = createHarness()
    state.term = 'rollback'

    await runtime.openSearch()

    expect(isOpen()).toBe(true)
    expect(calls.closePopups).toHaveBeenCalled()
    expect(calls.focusSearchInput).toHaveBeenCalled()
    expect(state.matchCount).toBe(2)
    expect(state.currentIndex).toBe(1)
    expect(root.querySelectorAll('.ai-chat-search-highlight')).toHaveLength(2)

    runtime.findNextMatch()
    expect(state.currentIndex).toBe(2)
    expect(root.querySelectorAll('.ai-chat-search-highlight.active')[0]?.textContent).toBe('rollback')

    runtime.findPreviousMatch()
    expect(state.currentIndex).toBe(1)
  })

  it('schedules, clears, closes, and disposes search state through one boundary', async () => {
    const { calls, isOpen, root, runtime, state, timers } = createHarness()
    state.term = 'rollback'
    await runtime.openSearch()

    state.term = 'second'
    runtime.handleSearchTermChanged()
    expect(timers).toHaveLength(1)
    timers[0]()
    expect(state.matchCount).toBe(1)
    expect(state.currentIndex).toBe(1)

    await runtime.clearSearch()
    expect(state.term).toBe('')
    expect(state.matchCount).toBe(0)
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()

    state.term = 'rollback'
    runtime.handleSearchTermChanged()
    runtime.closeSearch()
    expect(isOpen()).toBe(false)
    expect(state.term).toBe('')
    expect(calls.clearSearchTimer).toHaveBeenCalled()

    state.term = 'rollback'
    await runtime.openSearch()
    runtime.dispose()
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
  })

  it('syncs message updates or defers to bottom scrolling when search is inactive', async () => {
    const { calls, runtime, state } = createHarness()
    state.term = 'rollback'

    await runtime.syncSearchForMessages()
    expect(calls.scheduleScrollToBottom).toHaveBeenCalled()

    await runtime.openSearch()
    calls.scheduleScrollToBottom.mockClear()
    await runtime.syncSearchForMessages()
    expect(state.matchCount).toBe(2)
    expect(calls.scheduleScrollToBottom).not.toHaveBeenCalled()
  })
})
