import { describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import {
  classicChatInitialWindowSize,
  classicChatMaximumWindowSize,
  createAiPanelChatViewportRuntime
} from '@/services/ai/aiPanelChatViewportRuntime'
import { createEmptyAiPanelHistoryRuntimeState } from '@/services/ai/aiPanelHistoryRuntime'

const createResizeObserverHarness = () => {
  let callback: ResizeObserverCallback | undefined
  const observed = new Set<Element>()
  const observer = {
    observe: vi.fn((element: Element) => observed.add(element)),
    unobserve: vi.fn((element: Element) => observed.delete(element)),
    disconnect: vi.fn(() => observed.clear())
  }
  return {
    factory: vi.fn((nextCallback: ResizeObserverCallback) => {
      callback = nextCallback
      return observer
    }),
    notify: () => callback?.([], observer as unknown as ResizeObserver),
    observed,
    observer
  }
}

const createHarness = () => {
  const historyState = createEmptyAiPanelHistoryRuntimeState()
  const messages = [
    { id: 'message-1', role: 'user', text: 'rollback first', state: 'done' },
    { id: 'message-2', role: 'assistant', text: 'second rollback', state: 'done' }
  ]
  const root = document.createElement('div')
  root.style.height = '100px'
  root.innerHTML = `
    <article class="message" data-message-id="message-1"><p>rollback first</p><button>rollback ignored</button></article>
    <article class="message" data-message-id="message-2"><p>second rollback</p></article>
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
    messages: () => messages,
    selectedConversationId: () => 'conversation-1',
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
  return { calls, frameCallbacks, historyState, input, messages, root, runtime, timers }
}

const createStreamingScrollHarness = () => {
  const historyState = createEmptyAiPanelHistoryRuntimeState()
  const messages = [
    { id: 'user-1', role: 'user', text: 'question', state: 'done' },
    { id: 'assistant-1', role: 'assistant', text: 'answer', state: 'streaming' }
  ]
  const root = document.createElement('div')
  root.innerHTML = messages
    .map((message) => `<article class="message" data-message-id="${message.id}">${message.text}</article>`)
    .join('')
  let selectedConversationId = 'conversation-1'
  let scrollHeight = 200
  let deferDomUpdates = false
  let nextFrameId = 0
  const activeFrames = new Map<number, () => void>()
  const pendingDomUpdates: Array<() => void> = []
  const resizeObserver = createResizeObserverHarness()
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  const calls = {
    afterDomUpdate: vi.fn((callback?: () => void) => {
      callback?.()
      if (!deferDomUpdates) return Promise.resolve()
      return new Promise<void>((resolve) => pendingDomUpdates.push(resolve))
    }),
    requestFrame: vi.fn((callback: () => void) => {
      const id = ++nextFrameId
      activeFrames.set(id, callback)
      return id
    }),
    cancelFrame: vi.fn((frame: number) => {
      activeFrames.delete(frame)
    })
  }
  const runtime = createAiPanelChatViewportRuntime({
    historyState,
    messages: () => messages,
    selectedConversationId: () => selectedConversationId,
    closePopups: vi.fn(),
    closeMoreActionsMenu: vi.fn(),
    afterDomUpdate: calls.afterDomUpdate,
    requestFrame: calls.requestFrame,
    cancelFrame: calls.cancelFrame,
    setSearchTimer: vi.fn((callback) => callback),
    clearSearchTimer: vi.fn(),
    resizeObserverFactory: resizeObserver.factory
  })
  runtime.chatScrollRef.value = root
  const flushMicrotasks = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }
  const runActiveFrame = () => {
    const entry = [...activeFrames.entries()].at(-1)
    if (!entry) return false
    activeFrames.delete(entry[0])
    entry[1]()
    return true
  }
  return {
    activeFrames,
    calls,
    flushMicrotasks,
    messages,
    pendingDomUpdates,
    resizeObserver,
    root,
    runActiveFrame,
    runtime,
    setDeferDomUpdates: (value: boolean) => {
      deferDomUpdates = value
    },
    setScrollHeight: (value: number) => {
      scrollHeight = value
    },
    setSelectedConversationId: (value: string) => {
      selectedConversationId = value
    }
  }
}

const createLongScrolledUpHarness = async () => {
  const harness = createStreamingScrollHarness()
  harness.messages.splice(
    0,
    harness.messages.length,
    ...Array.from({ length: 160 }, (_, index) => ({
      id: `long-message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `long message ${index}`,
      state: 'done' as const
    }))
  )
  harness.setScrollHeight(3200)
  await harness.runtime.syncSearchForMessages()
  await harness.flushMicrotasks()
  expect(harness.runActiveFrame()).toBe(true)
  harness.root.scrollTop = 200
  harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
  await harness.runtime.handleChatScroll()
  return harness
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

  it('follows text growth on the same streaming message only while the user remains at the latest position', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 100
    await harness.runtime.handleChatScroll()

    const originalIds = harness.messages.map((message) => message.id)
    harness.messages[1].text = 'answer with another streamed paragraph'
    harness.setScrollHeight(280)
    await harness.runtime.syncSearchForMessages()
    await harness.flushMicrotasks()

    expect(harness.messages.map((message) => message.id)).toEqual(originalIds)
    expect(harness.activeFrames.size).toBe(1)
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(280)

    harness.root.scrollTop = 20
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.messages[1].text += ' and more streamed text'
    harness.setScrollHeight(360)
    await harness.runtime.syncSearchForMessages()
    await harness.flushMicrotasks()

    expect(harness.activeFrames.size).toBe(0)
    expect(harness.root.scrollTop).toBe(20)
  })

  it('invalidates deferred and stale streaming scroll frames when the user scrolls up', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 100
    await harness.runtime.handleChatScroll()
    harness.setDeferDomUpdates(true)
    harness.messages[1].text += ' first delta'
    harness.setScrollHeight(260)
    await harness.runtime.syncSearchForMessages()
    expect(harness.pendingDomUpdates).toHaveLength(1)

    harness.root.scrollTop = 10
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.pendingDomUpdates.shift()?.()
    await harness.flushMicrotasks()

    expect(harness.calls.requestFrame).not.toHaveBeenCalled()
    expect(harness.activeFrames.size).toBe(0)
    expect(harness.root.scrollTop).toBe(10)
  })

  it('keeps the latest follow request through a browser anchor event before message projection sync', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 100
    await harness.runtime.handleChatScroll()
    harness.setDeferDomUpdates(true)
    harness.messages.push({ id: 'tool-call-1', role: 'assistant', text: 'uptime', state: 'done' })
    harness.setScrollHeight(260)

    // Projection growth can emit this scroll event before the lifecycle watcher
    // has synchronised the bounded message window.
    await harness.runtime.handleChatScroll()
    await harness.runtime.syncSearchForMessages()
    expect(harness.pendingDomUpdates).toHaveLength(1)
    harness.pendingDomUpdates.shift()?.()
    await harness.flushMicrotasks()

    expect(harness.activeFrames.size).toBe(1)
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(260)
  })

  it('keeps a forced follow when layout growth moves the viewport more than the near-bottom threshold', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 100
    await harness.runtime.handleChatScroll()
    harness.setDeferDomUpdates(true)
    harness.messages[1].text += ' tool result'
    harness.setScrollHeight(300)

    await harness.runtime.syncSearchForMessages()
    expect(harness.pendingDomUpdates).toHaveLength(1)
    // The browser has not moved scrollTop, but the newly rendered card made
    // the measured distance temporarily exceed the normal threshold.
    await harness.runtime.handleChatScroll()
    harness.pendingDomUpdates.shift()?.()
    await harness.flushMicrotasks()

    expect(harness.activeFrames.size).toBe(1)
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(300)
  })

  it('reactivates an unchanged transcript and follows late message layout growth through ResizeObserver', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 20
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.setScrollHeight(420)

    harness.runtime.activateChatViewport()
    await harness.flushMicrotasks()
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(420)
    expect(harness.resizeObserver.observed.has(harness.root)).toBe(true)
    expect(harness.resizeObserver.observed.has(harness.root.querySelector('[data-message-id="assistant-1"]')!)).toBe(true)

    harness.setScrollHeight(680)
    await harness.runtime.handleChatScroll()
    harness.resizeObserver.notify()
    await harness.flushMicrotasks()
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(680)

    harness.root.scrollTop = 40
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.setScrollHeight(900)
    harness.resizeObserver.notify()
    await harness.flushMicrotasks()
    expect(harness.activeFrames.size).toBe(0)
    expect(harness.root.scrollTop).toBe(40)

    harness.runtime.dispose()
    expect(harness.resizeObserver.observer.disconnect).toHaveBeenCalledTimes(1)
  })

  it('forces a new user message to the bottom after a long conversation was scrolled up', async () => {
    const harness = await createLongScrolledUpHarness()
    harness.setDeferDomUpdates(true)
    harness.messages.push({ id: 'long-user-160', role: 'user', text: 'new question', state: 'done' })
    harness.setScrollHeight(3400)

    await harness.runtime.syncSearchForMessages()
    expect(harness.pendingDomUpdates).toHaveLength(1)
    harness.pendingDomUpdates.shift()?.()
    await harness.flushMicrotasks()
    expect(harness.activeFrames.size).toBe(1)

    // Simulate a layout scroll after the DOM patch but before rAF. The old
    // viewport was intentionally away from the bottom, but the new user
    // message is an explicit request to resume following the latest turn.
    await harness.runtime.handleChatScroll()
    expect(harness.activeFrames.size).toBe(1)
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(3400)
  })

  it('forces a conversation switch through layout scroll but still honors explicit user scroll intent', async () => {
    const harness = await createLongScrolledUpHarness()
    harness.setDeferDomUpdates(true)
    harness.setSelectedConversationId('conversation-2')
    harness.setScrollHeight(3500)

    await harness.runtime.syncSearchForMessages()
    expect(harness.pendingDomUpdates).toHaveLength(1)
    harness.pendingDomUpdates.shift()?.()
    await harness.flushMicrotasks()
    expect(harness.activeFrames.size).toBe(1)

    await harness.runtime.handleChatScroll()
    expect(harness.activeFrames.size).toBe(1)
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    expect(harness.activeFrames.size).toBe(0)
    expect(harness.root.scrollTop).toBe(200)
  })

  it('coalesces continuous deltas and still follows a new user message or conversation switch', async () => {
    const harness = createStreamingScrollHarness()
    harness.root.scrollTop = 100
    await harness.runtime.handleChatScroll()
    harness.setDeferDomUpdates(true)

    for (const delta of [' first', ' second', ' third']) {
      harness.messages[1].text += delta
      await harness.runtime.syncSearchForMessages()
    }
    expect(harness.pendingDomUpdates).toHaveLength(3)
    harness.pendingDomUpdates.splice(0).reverse().forEach((resolve) => resolve())
    await harness.flushMicrotasks()

    expect(harness.calls.requestFrame).toHaveBeenCalledTimes(1)
    expect(harness.activeFrames.size).toBe(1)
    expect(harness.runActiveFrame()).toBe(true)

    harness.root.scrollTop = 10
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.setDeferDomUpdates(false)
    harness.messages.push({ id: 'user-2', role: 'user', text: 'new question', state: 'done' })
    harness.setScrollHeight(420)
    await harness.runtime.syncSearchForMessages()
    await harness.flushMicrotasks()
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(420)

    harness.root.scrollTop = 10
    harness.runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await harness.runtime.handleChatScroll()
    harness.setSelectedConversationId('conversation-2')
    harness.setScrollHeight(500)
    await harness.runtime.syncSearchForMessages()
    await harness.flushMicrotasks()
    expect(harness.runActiveFrame()).toBe(true)
    expect(harness.root.scrollTop).toBe(500)
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

  it('keeps 560 live messages in a bounded sliding DOM window and preserves the scroll anchor', async () => {
    const historyState = createEmptyAiPanelHistoryRuntimeState()
    const messages = Array.from({ length: 560 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `message body ${index}`,
      state: 'done' as const
    }))
    const root = document.createElement('div')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => root.querySelectorAll('.message').length * 20
    })
    let runtime: ReturnType<typeof createAiPanelChatViewportRuntime<(typeof messages)[number]>>
    const syncRoot = () => {
      root.replaceChildren(
        ...runtime.visibleChatMessages.value.map((message, index) => {
          const article = document.createElement('article')
          article.className = 'message'
          article.dataset.messageId = message.id
          article.textContent = message.text
          Object.defineProperty(article, 'offsetTop', { configurable: true, value: index * 20 })
          Object.defineProperty(article, 'offsetHeight', { configurable: true, value: 20 })
          return article
        })
      )
    }
    runtime = createAiPanelChatViewportRuntime({
      historyState,
      messages: () => messages,
      selectedConversationId: () => 'conversation-1',
      closePopups: vi.fn(),
      closeMoreActionsMenu: vi.fn(),
      afterDomUpdate: async (callback) => {
        syncRoot()
        callback?.()
      },
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      setSearchTimer: vi.fn((callback) => callback),
      clearSearchTimer: vi.fn()
    })
    runtime.chatScrollRef.value = root
    syncRoot()

    expect(messages).toHaveLength(560)
    expect(runtime.visibleChatMessages.value).toHaveLength(classicChatInitialWindowSize)
    expect(runtime.visibleChatMessages.value[0].id).toBe('message-480')
    expect(root.querySelectorAll('.message')).toHaveLength(classicChatInitialWindowSize)

    root.scrollTop = 0
    runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))
    await runtime.handleChatScroll()
    expect(runtime.visibleChatMessages.value).toHaveLength(classicChatMaximumWindowSize)
    expect(runtime.visibleChatMessages.value[0].id).toBe('message-440')
    expect(root.scrollTop).toBe(800)

    root.scrollTop = 0
    await runtime.handleChatScroll()
    expect(runtime.visibleChatMessages.value).toHaveLength(classicChatMaximumWindowSize)
    expect(runtime.visibleChatMessages.value[0].id).toBe('message-400')
    expect(runtime.visibleChatMessages.value.at(-1)?.id).toBe('message-519')
    expect(root.querySelectorAll('.message')).toHaveLength(classicChatMaximumWindowSize)
    expect(messages).toHaveLength(560)

    messages.push({ id: 'message-560', role: 'assistant', text: 'background append', state: 'done' })
    await runtime.syncSearchForMessages()
    syncRoot()
    expect(runtime.visibleChatMessages.value[0].id).toBe('message-400')
    expect(runtime.visibleChatMessages.value.at(-1)?.id).toBe('message-519')
    expect(root.querySelectorAll('.message')).toHaveLength(classicChatMaximumWindowSize)

    while (runtime.chatWindowStart.value > 0) {
      root.scrollTop = 0
      await runtime.handleChatScroll()
      expect(root.querySelectorAll('.message').length).toBeLessThanOrEqual(classicChatMaximumWindowSize)
    }
    expect(runtime.visibleChatMessages.value[0].id).toBe('message-0')

    while (runtime.chatWindowEnd.value < messages.length) {
      root.scrollTop = root.scrollHeight - root.clientHeight
      await runtime.handleChatScroll()
      expect(root.querySelectorAll('.message').length).toBeLessThanOrEqual(classicChatMaximumWindowSize)
    }
    expect(runtime.visibleChatMessages.value.at(-1)?.id).toBe('message-560')
    expect(messages).toHaveLength(561)
  })

  it('searches all 560 messages and moves the bounded window to off-DOM matches', async () => {
    const historyState = createEmptyAiPanelHistoryRuntimeState()
    const matchedIndexes = new Set([10, 250, 550])
    const messages = Array.from({ length: 560 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: matchedIndexes.has(index) ? `needle at ${index}` : `message body ${index}`,
      state: 'done' as const,
      followupOptions: index === 42 ? ['button-only option'] : undefined
    }))
    const root = document.createElement('div')
    const input = document.createElement('input')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => root.querySelectorAll('.message').length * 20
    })
    let runtime: ReturnType<typeof createAiPanelChatViewportRuntime<(typeof messages)[number]>>
    const syncRoot = () => {
      root.replaceChildren(
        ...runtime.visibleChatMessages.value.map((message, index) => {
          const article = document.createElement('article')
          article.className = `message ${message.role}`
          article.dataset.messageId = message.id
          Object.defineProperty(article, 'offsetTop', { configurable: true, value: index * 20 })
          Object.defineProperty(article, 'offsetHeight', { configurable: true, value: 20 })
          const role = document.createElement('span')
          role.textContent = message.role
          const body = document.createElement('p')
          body.textContent = message.text
          article.append(role, body)
          return article
        })
      )
    }
    runtime = createAiPanelChatViewportRuntime({
      historyState,
      messages: () => messages,
      selectedConversationId: () => 'conversation-1',
      closePopups: vi.fn(),
      closeMoreActionsMenu: vi.fn(),
      afterDomUpdate: async (callback) => {
        syncRoot()
        callback?.()
      },
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      setSearchTimer: vi.fn((callback) => callback),
      clearSearchTimer: vi.fn()
    })
    runtime.chatScrollRef.value = root
    runtime.chatSearchInputRef.value = input
    syncRoot()
    runtime.chatSearchTerm.value = 'needle'

    await runtime.openChatSearch()
    expect(runtime.chatSearchMatchCount.value).toBe(3)
    expect(runtime.chatSearchCurrentIndex.value).toBe(1)
    expect(runtime.visibleChatMessages.value.some((message) => message.id === 'message-10')).toBe(true)
    expect(root.querySelectorAll('.message').length).toBeLessThanOrEqual(classicChatMaximumWindowSize)
    expect(root.querySelector('.ai-chat-search-highlight.active')?.textContent).toBe('needle')

    await runtime.findNextChatMatch()
    expect(runtime.chatSearchCurrentIndex.value).toBe(2)
    expect(runtime.visibleChatMessages.value.some((message) => message.id === 'message-250')).toBe(true)
    expect(root.querySelectorAll('.message').length).toBeLessThanOrEqual(classicChatMaximumWindowSize)

    await runtime.findNextChatMatch()
    expect(runtime.chatSearchCurrentIndex.value).toBe(3)
    expect(runtime.visibleChatMessages.value.some((message) => message.id === 'message-550')).toBe(true)
    expect(root.querySelectorAll('.message').length).toBeLessThanOrEqual(classicChatMaximumWindowSize)

    await runtime.findPreviousChatMatch()
    expect(runtime.chatSearchCurrentIndex.value).toBe(2)
    expect(runtime.visibleChatMessages.value.some((message) => message.id === 'message-250')).toBe(true)
    expect(messages).toHaveLength(560)

    const originalStart = runtime.chatWindowStart.value
    const originalEnd = runtime.chatWindowEnd.value
    root.scrollTop = 600
    runtime.chatSearchTerm.value = 'button-only'
    await runtime.openChatSearch()
    expect(runtime.chatSearchMatchCount.value).toBe(0)
    expect(runtime.chatSearchCurrentIndex.value).toBe(0)
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
    expect(runtime.chatWindowStart.value).toBe(originalStart)
    expect(runtime.chatWindowEnd.value).toBe(originalEnd)
    expect(root.scrollTop).toBe(600)

    runtime.chatSearchTerm.value = 'needle'
    const openingSearch = runtime.openChatSearch()
    await Promise.resolve()
    await Promise.resolve()
    const closingSearch = runtime.closeChatSearch()
    await Promise.all([openingSearch, closingSearch])
    expect(runtime.chatSearchOpen.value).toBe(false)
    expect(runtime.chatWindowStart.value).toBe(originalStart)
    expect(runtime.chatWindowEnd.value).toBe(originalEnd)
    expect(root.scrollTop).toBe(600)
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
  })

  it('loads an older projection page at the top while keeping the anchor and DOM window bounded', async () => {
    const historyState = createEmptyAiPanelHistoryRuntimeState()
    const messages = Array.from({ length: 80 }, (_, index) => ({
      id: `latest-${index}`,
      role: index % 2 ? 'assistant' as const : 'user' as const,
      text: `latest ${index}`
    }))
    const root = document.createElement('div')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => root.querySelectorAll('.message').length * 20
    })
    let runtime!: ReturnType<typeof createAiPanelChatViewportRuntime<(typeof messages)[number]>>
    const render = () => {
      root.replaceChildren(...runtime.visibleChatMessages.value.map((message, index) => {
        const article = document.createElement('article')
        article.className = 'message'
        article.dataset.messageId = message.id
        Object.defineProperty(article, 'offsetTop', { configurable: true, value: index * 20 })
        Object.defineProperty(article, 'offsetHeight', { configurable: true, value: 20 })
        return article
      }))
    }
    const loadOlderMessages = vi.fn(async () => {
      messages.unshift(...Array.from({ length: 40 }, (_, index) => ({
        id: `older-${index}`,
        role: index % 2 ? 'assistant' as const : 'user' as const,
        text: `older ${index}`
      })))
      return 40
    })
    runtime = createAiPanelChatViewportRuntime({
      historyState,
      messages: () => messages,
      selectedConversationId: () => 'conversation-paged',
      closePopups: vi.fn(),
      closeMoreActionsMenu: vi.fn(),
      afterDomUpdate: async () => render(),
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      setSearchTimer: vi.fn((callback) => callback),
      clearSearchTimer: vi.fn(),
      loadOlderMessages
    })
    runtime.chatScrollRef.value = root
    render()
    root.scrollTop = 10
    runtime.handleChatUserScrollIntent(new WheelEvent('wheel', { deltaY: -120 }))

    await runtime.handleChatScroll()

    expect(loadOlderMessages).toHaveBeenCalledTimes(1)
    expect(runtime.visibleChatMessages.value).toHaveLength(classicChatMaximumWindowSize)
    expect(root.querySelectorAll('.message')).toHaveLength(classicChatMaximumWindowSize)
    expect(runtime.visibleChatMessages.value[0].id).toBe('older-0')
    expect(root.scrollTop).toBe(810)
  })
})
