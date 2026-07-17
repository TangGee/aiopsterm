import { computed, reactive, ref, toRef } from 'vue'
import {
  activateAiChatSearchMatch,
  clearAiChatSearchHighlights,
  findAiChatTextRanges,
  runAiChatSearchHighlights,
  type AiPanelChatSearchMatch
} from '@/services/ai/aiPanelConversationRuntime'
import { createEmptyAiPanelChatSearchRuntimeState } from '@/services/ai/aiPanelChatSearchRuntime'
import type { AiPanelHistoryRuntimeState } from '@/services/ai/aiPanelHistoryRuntime'

export const classicChatInitialWindowSize = 80
export const classicChatMaximumWindowSize = 120
export const classicChatWindowShiftSize = 40

const classicChatWindowScrollThreshold = 72
const classicChatLatestEdgeThreshold = 2

export type AiPanelChatResizeObserverLike = {
  observe: (target: Element) => void
  unobserve: (target: Element) => void
  disconnect: () => void
}

export type AiPanelChatViewportMessage = {
  id: string
  role?: string
}

export type AiPanelChatViewportRuntimeOptions<TMessage extends AiPanelChatViewportMessage> = {
  historyState: AiPanelHistoryRuntimeState
  messages: () => TMessage[]
  selectedConversationId: () => string
  closePopups: () => void
  closeMoreActionsMenu: () => void
  afterDomUpdate: (callback?: () => void) => void | Promise<void>
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
  setSearchTimer: (callback: () => void, delay: number) => unknown
  clearSearchTimer: (timer: unknown) => void
  loadOlderMessages?: () => Promise<number>
  resizeObserverFactory?: (callback: ResizeObserverCallback) => AiPanelChatResizeObserverLike | null
}

type ChatWindowAnchor = {
  messageId: string
  viewportOffset: number
  previousScrollHeight: number
}

type ChatSearchTranscriptMatch = {
  messageId: string
  occurrence: number
}

const defaultResizeObserverFactory = (callback: ResizeObserverCallback): AiPanelChatResizeObserverLike | null =>
  typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(callback)

export const createAiPanelChatViewportRuntime = <TMessage extends AiPanelChatViewportMessage>(
  options: AiPanelChatViewportRuntimeOptions<TMessage>
) => {
  const chatScrollRef = ref<HTMLElement | null>(null)
  const chatSearchInputRef = ref<HTMLInputElement | null>(null)
  const chatSearchRuntimeState = reactive(createEmptyAiPanelChatSearchRuntimeState())
  const chatSearchOpen = toRef(options.historyState, 'chatSearchOpen')
  const chatSearchTerm = toRef(chatSearchRuntimeState, 'term')
  const chatSearchMatchCount = toRef(chatSearchRuntimeState, 'matchCount')
  const chatSearchCurrentIndex = toRef(chatSearchRuntimeState, 'currentIndex')
  const initialMessageCount = options.messages().length
  const chatWindowStart = ref(Math.max(0, initialMessageCount - classicChatInitialWindowSize))
  const chatWindowEnd = ref(initialMessageCount)
  const visibleChatMessages = computed(() => options.messages().slice(chatWindowStart.value, chatWindowEnd.value))
  const searchMarks: HTMLElement[] = []
  const searchDomMatches: AiPanelChatSearchMatch[] = []
  let searchTranscriptMatches: ChatSearchTranscriptMatch[] = []
  let chatScrollFrame: number | undefined
  let chatScrollSequence = 0
  let searchTimer: unknown
  let searchRenderSequence = 0
  let activeSearchScan: Promise<ChatSearchTranscriptMatch[] | null> | null = null
  let disposed = false
  let windowShiftPending = false
  let projectionPageLoading = false
  let followingLatest = true
  let followCancellationSequence = 0
  let touchScrollStartY: number | undefined
  let lastSelectedConversationId = options.selectedConversationId()
  let lastSyncedMessageIds = options.messages().map((message) => message.id)

  const cancelFollowingLatest = () => {
    followingLatest = false
    followCancellationSequence += 1
    cancelChatScrollFrame()
  }

  const isEditableEventTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  const handleChatUserScrollIntent = (event: Event) => {
    if (event.type === 'wheel') {
      if ((event as WheelEvent).deltaY >= 0) return
      cancelFollowingLatest()
      return
    }
    if (event.type === 'keydown') {
      if (isEditableEventTarget(event.target)) return
      const keyboardEvent = event as KeyboardEvent
      const scrollsUp = keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'PageUp' || keyboardEvent.key === 'Home' || (keyboardEvent.key === ' ' && keyboardEvent.shiftKey)
      if (scrollsUp) cancelFollowingLatest()
      return
    }
    if (event.type === 'touchstart' || event.type === 'touchmove' || event.type === 'touchend' || event.type === 'touchcancel') {
      const touchEvent = event as TouchEvent
      const touch = touchEvent.touches[0]
      if (event.type === 'touchstart') {
        touchScrollStartY = touch?.clientY
        return
      }
      if (event.type === 'touchend' || event.type === 'touchcancel') {
        touchScrollStartY = undefined
        return
      }
      if (touch && touchScrollStartY !== undefined && touch.clientY > touchScrollStartY + 3) {
        cancelFollowingLatest()
      }
      if (touch) touchScrollStartY = touch.clientY
      return
    }
    if (event.type === 'pointerdown') {
      const pointerEvent = event as PointerEvent
      const root = chatScrollRef.value
      if (!root || pointerEvent.target !== root) return
      const rect = root.getBoundingClientRect()
      const scrollbarHitWidth = Math.max(12, root.offsetWidth - root.clientWidth)
      if (pointerEvent.clientX >= rect.right - scrollbarHitWidth) cancelFollowingLatest()
    }
  }

  const messageElements = () =>
    Array.from(chatScrollRef.value?.querySelectorAll<HTMLElement>('.message[data-message-id]') || [])

  const messageElementById = (messageId: string) =>
    messageElements().find((element) => element.dataset.messageId === messageId)

  const observedChatElements = new Set<Element>()
  const resizeObserver = (options.resizeObserverFactory || defaultResizeObserverFactory)(() => {
    if (disposed || !followingLatest || chatSearchOpen.value) return
    scheduleChatScrollToBottom()
  })

  const syncChatResizeObservation = () => {
    if (!resizeObserver) return
    const root = chatScrollRef.value
    const nextElements = new Set<Element>(root ? [root, ...messageElements()] : [])
    observedChatElements.forEach((element) => {
      if (nextElements.has(element)) return
      resizeObserver.unobserve(element)
      observedChatElements.delete(element)
    })
    nextElements.forEach((element) => {
      if (observedChatElements.has(element)) return
      resizeObserver.observe(element)
      observedChatElements.add(element)
    })
  }

  const captureWindowAnchor = (): ChatWindowAnchor | null => {
    const root = chatScrollRef.value
    if (!root) return null
    const elements = messageElements()
    const anchor = elements.find((element) => element.offsetTop + element.offsetHeight >= root.scrollTop) || elements[0]
    if (!anchor?.dataset.messageId) return null
    return {
      messageId: anchor.dataset.messageId,
      viewportOffset: anchor.offsetTop - root.scrollTop,
      previousScrollHeight: root.scrollHeight
    }
  }

  const restoreWindowAnchor = (anchor: ChatWindowAnchor | null, direction: 'older' | 'newer') => {
    const root = chatScrollRef.value
    if (!root || !anchor) return
    const element = messageElementById(anchor.messageId)
    if (element) {
      root.scrollTop = Math.max(0, element.offsetTop - anchor.viewportOffset)
      return
    }
    if (direction === 'older') {
      root.scrollTop += Math.max(0, root.scrollHeight - anchor.previousScrollHeight)
    }
  }

  const clearSearchTimer = () => {
    if (!searchTimer) return
    options.clearSearchTimer(searchTimer)
    searchTimer = undefined
  }

  const clearSearchHighlights = (resetState = true, invalidatePendingRender = true) => {
    if (invalidatePendingRender) searchRenderSequence += 1
    clearAiChatSearchHighlights(searchMarks)
    searchDomMatches.splice(0)
    if (!resetState) return
    searchTranscriptMatches = []
    chatSearchRuntimeState.matchCount = 0
    chatSearchRuntimeState.currentIndex = 0
  }

  const scanSearchMatches = async (term: string, renderSequence: number) => {
    const root = chatScrollRef.value
    if (!root) return []
    const originalStart = chatWindowStart.value
    const originalEnd = chatWindowEnd.value
    const originalAnchor = captureWindowAnchor()
    // Scan the same rendered text nodes used by highlighting, one bounded DOM window at a time.
    const matches: ChatSearchTranscriptMatch[] = []
    const count = options.messages().length
    let restoreOriginalWindow = true
    try {
      for (let start = 0; start < count; start += classicChatMaximumWindowSize) {
        chatWindowStart.value = start
        chatWindowEnd.value = Math.min(count, start + classicChatMaximumWindowSize)
        await Promise.resolve(options.afterDomUpdate())
        if (renderSequence !== searchRenderSequence) return null
        const occurrencesByMessage = new Map<string, number>()
        findAiChatTextRanges(root, term).forEach((range) => {
          const messageId = range.startContainer.parentElement
            ?.closest<HTMLElement>('.message[data-message-id]')
            ?.dataset.messageId
          if (!messageId) return
          const occurrence = occurrencesByMessage.get(messageId) || 0
          occurrencesByMessage.set(messageId, occurrence + 1)
          matches.push({ messageId, occurrence })
        })
      }
      restoreOriginalWindow = !matches.length
      return matches
    } finally {
      if (restoreOriginalWindow && !disposed) {
        chatWindowEnd.value = Math.min(originalEnd, count)
        chatWindowStart.value = Math.min(originalStart, chatWindowEnd.value)
        await Promise.resolve(options.afterDomUpdate())
        if (!disposed) restoreWindowAnchor(originalAnchor, 'newer')
      }
    }
  }

  const setWindowAroundMessage = (messageId: string) => {
    const messages = options.messages()
    const messageIndex = messages.findIndex((message) => message.id === messageId)
    if (messageIndex < 0) return
    followingLatest = false
    if (messageIndex >= chatWindowStart.value && messageIndex < chatWindowEnd.value) return
    const windowSize = Math.min(classicChatMaximumWindowSize, messages.length)
    const maximumStart = Math.max(0, messages.length - windowSize)
    const start = Math.min(maximumStart, Math.max(0, messageIndex - Math.floor(windowSize / 2)))
    chatWindowStart.value = start
    chatWindowEnd.value = start + windowSize
  }

  const renderSearchHighlights = async () => {
    const renderSequence = ++searchRenderSequence
    clearSearchHighlights(false, false)
    const root = chatScrollRef.value
    const term = chatSearchRuntimeState.term.trim()
    if (!root || !term || !searchTranscriptMatches.length) return
    const activeTranscriptMatch = searchTranscriptMatches[Math.max(0, chatSearchRuntimeState.currentIndex - 1)]
    if (!activeTranscriptMatch) return
    setWindowAroundMessage(activeTranscriptMatch.messageId)
    await Promise.resolve(options.afterDomUpdate())
    if (renderSequence !== searchRenderSequence) return
    const result = runAiChatSearchHighlights(root, term)
    searchMarks.push(...result.marks)
    searchDomMatches.push(...result.matches)
    const messageMatches = searchDomMatches.filter(
      (match) => match.element.closest<HTMLElement>('.message[data-message-id]')?.dataset.messageId === activeTranscriptMatch.messageId
    )
    const activeDomMatch = messageMatches[Math.min(activeTranscriptMatch.occurrence, Math.max(0, messageMatches.length - 1))]
    if (activeDomMatch) activateAiChatSearchMatch(searchDomMatches, searchDomMatches.indexOf(activeDomMatch))
  }

  const runSearch = async (activeIndex = 0) => {
    clearSearchTimer()
    clearSearchHighlights()
    const term = chatSearchRuntimeState.term.trim()
    if (!term) return
    const renderSequence = searchRenderSequence
    if (activeSearchScan) await activeSearchScan.catch(() => undefined)
    if (renderSequence !== searchRenderSequence || disposed) return
    const scan = scanSearchMatches(term, renderSequence)
    activeSearchScan = scan
    let scannedMatches: ChatSearchTranscriptMatch[] | null
    try {
      scannedMatches = await scan
    } finally {
      if (activeSearchScan === scan) activeSearchScan = null
    }
    if (!scannedMatches || renderSequence !== searchRenderSequence) return
    searchTranscriptMatches = scannedMatches
    chatSearchRuntimeState.matchCount = searchTranscriptMatches.length
    if (!searchTranscriptMatches.length) return
    const normalizedIndex = ((activeIndex % searchTranscriptMatches.length) + searchTranscriptMatches.length) % searchTranscriptMatches.length
    chatSearchRuntimeState.currentIndex = normalizedIndex + 1
    await renderSearchHighlights()
  }

  const scrollChatToBottom = () => {
    const root = chatScrollRef.value
    if (!root) return
    root.scrollTop = root.scrollHeight
    followingLatest = true
  }

  /**
   * Queue a scroll after Vue has rendered the new projection. `forceFollow` is
   * captured by the message synchronisation pass, before projection growth can
   * emit a browser scroll-anchor event. That event briefly sees the old
   * bounded-window end and must not cancel a follow request that was already
   * valid at the time of the update.
   */
  const scheduleChatScrollToBottom = (forceFollow = false) => {
    const scrollSequence = ++chatScrollSequence
    const followAtSchedule = forceFollow || followingLatest
    const cancellationSequence = followCancellationSequence
    void Promise.resolve(options.afterDomUpdate()).then(() => {
      if (
        disposed ||
        scrollSequence !== chatScrollSequence ||
        cancellationSequence !== followCancellationSequence ||
        (!forceFollow && !followingLatest)
      ) return
      syncChatResizeObservation()
      if (chatScrollFrame !== undefined) {
        options.cancelFrame(chatScrollFrame)
        chatScrollFrame = undefined
      }
      let requestedFrame: number | undefined
      requestedFrame = options.requestFrame(() => {
        if (chatScrollFrame === requestedFrame) chatScrollFrame = undefined
        if (
          disposed ||
          scrollSequence !== chatScrollSequence ||
          cancellationSequence !== followCancellationSequence ||
          (!followAtSchedule && !followingLatest)
        ) return
        scrollChatToBottom()
      })
      chatScrollFrame = requestedFrame
    })
  }

  const resetChatWindowToLatest = () => {
    const count = options.messages().length
    chatWindowEnd.value = count
    chatWindowStart.value = Math.max(0, count - classicChatInitialWindowSize)
    followingLatest = true
  }

  const activateChatViewport = () => {
    resetChatWindowToLatest()
    scheduleChatScrollToBottom(true)
  }

  const preserveChatWindow = (messageIds: string[]) => {
    const count = messageIds.length
    const currentSize = Math.min(classicChatMaximumWindowSize, chatWindowEnd.value - chatWindowStart.value)
    const previousStartId = lastSyncedMessageIds[chatWindowStart.value]
    const anchoredStart = previousStartId ? messageIds.indexOf(previousStartId) : -1
    if (anchoredStart >= 0) {
      chatWindowStart.value = anchoredStart
      chatWindowEnd.value = Math.min(count, anchoredStart + currentSize)
      return
    }
    chatWindowEnd.value = Math.min(chatWindowEnd.value, count)
    chatWindowStart.value = Math.max(0, Math.min(chatWindowStart.value, chatWindowEnd.value - currentSize))
  }

  const shiftChatWindow = async (direction: 'older' | 'newer') => {
    if (windowShiftPending) return
    const count = options.messages().length
    const canShiftOlder = direction === 'older' && chatWindowStart.value > 0
    const canShiftNewer = direction === 'newer' && chatWindowEnd.value < count
    if (!canShiftOlder && !canShiftNewer) return
    windowShiftPending = true
    try {
      const anchor = captureWindowAnchor()
      const currentSize = chatWindowEnd.value - chatWindowStart.value
      if (direction === 'older') {
        const start = Math.max(0, chatWindowStart.value - classicChatWindowShiftSize)
        const size = Math.min(classicChatMaximumWindowSize, currentSize + (chatWindowStart.value - start))
        chatWindowStart.value = start
        chatWindowEnd.value = Math.min(count, start + size)
      } else {
        const end = Math.min(count, chatWindowEnd.value + classicChatWindowShiftSize)
        const size = Math.min(classicChatMaximumWindowSize, currentSize + (end - chatWindowEnd.value))
        chatWindowEnd.value = end
        chatWindowStart.value = Math.max(0, end - size)
      }
      await Promise.resolve(options.afterDomUpdate())
      restoreWindowAnchor(anchor, direction)
      followingLatest = false
      syncChatResizeObservation()
    } finally {
      windowShiftPending = false
    }
  }

  const loadOlderProjectionPage = async () => {
    if (projectionPageLoading || !options.loadOlderMessages) return false
    const anchor = captureWindowAnchor()
    const previousCount = options.messages().length
    projectionPageLoading = true
    windowShiftPending = true
    try {
      const added = await options.loadOlderMessages()
      if (!added || options.messages().length <= previousCount) return false
      const messages = options.messages()
      const anchorIndex = anchor ? messages.findIndex((message) => message.id === anchor.messageId) : added
      const start = Math.max(0, (anchorIndex < 0 ? added : anchorIndex) - classicChatWindowShiftSize)
      chatWindowStart.value = start
      chatWindowEnd.value = Math.min(messages.length, start + classicChatMaximumWindowSize)
      lastSyncedMessageIds = messages.map((message) => message.id)
      await Promise.resolve(options.afterDomUpdate())
      restoreWindowAnchor(anchor, 'older')
      followingLatest = false
      syncChatResizeObservation()
      return true
    } finally {
      projectionPageLoading = false
      windowShiftPending = false
    }
  }

  const handleChatScroll = async () => {
    const root = chatScrollRef.value
    if (!root || windowShiftPending || chatSearchOpen.value) return
    const distanceFromBottom = root.scrollHeight - root.clientHeight - root.scrollTop
    const messageCount = options.messages().length
    const messageProjectionPending = messageCount !== lastSyncedMessageIds.length
    if (chatWindowEnd.value >= messageCount && distanceFromBottom <= classicChatLatestEdgeThreshold) {
      followingLatest = true
    }
    if (!followingLatest && root.scrollTop <= classicChatWindowScrollThreshold && chatWindowStart.value > 0) {
      await shiftChatWindow('older')
      return
    }
    if (!followingLatest && root.scrollTop <= classicChatWindowScrollThreshold && chatWindowStart.value === 0) {
      if (await loadOlderProjectionPage()) return
    }
    if (!messageProjectionPending && distanceFromBottom <= classicChatWindowScrollThreshold && chatWindowEnd.value < messageCount) {
      await shiftChatWindow('newer')
    }
  }

  const openChatSearch = async () => {
    chatSearchOpen.value = true
    options.closePopups()
    options.closeMoreActionsMenu()
    await Promise.resolve(options.afterDomUpdate())
    chatSearchInputRef.value?.focus()
    if (chatSearchRuntimeState.term.trim()) await runSearch()
  }

  const closeChatSearch = async () => {
    chatSearchOpen.value = false
    chatSearchRuntimeState.term = ''
    clearSearchTimer()
    clearSearchHighlights()
    await activeSearchScan?.catch(() => undefined)
  }

  const clearChatSearch = async () => {
    chatSearchRuntimeState.term = ''
    clearSearchHighlights()
    await activeSearchScan?.catch(() => undefined)
    await Promise.resolve(options.afterDomUpdate())
    chatSearchInputRef.value?.focus()
  }

  const handleSearchTermChanged = () => {
    if (!chatSearchOpen.value) return
    clearSearchTimer()
    searchTimer = options.setSearchTimer(() => {
      searchTimer = undefined
      void runSearch()
    }, 200)
  }

  const findNextChatMatch = () => {
    if (!searchTranscriptMatches.length) return Promise.resolve()
    const activeIndex = chatSearchRuntimeState.currentIndex >= searchTranscriptMatches.length
      ? 0
      : chatSearchRuntimeState.currentIndex
    chatSearchRuntimeState.currentIndex = activeIndex + 1
    return renderSearchHighlights()
  }

  const findPreviousChatMatch = () => {
    if (!searchTranscriptMatches.length) return Promise.resolve()
    const activeIndex = chatSearchRuntimeState.currentIndex <= 1
      ? searchTranscriptMatches.length - 1
      : chatSearchRuntimeState.currentIndex - 2
    chatSearchRuntimeState.currentIndex = activeIndex + 1
    return renderSearchHighlights()
  }

  const syncSearchForMessages = async () => {
    const messages = options.messages()
    const messageIds = messages.map((message) => message.id)
    const selectedConversationId = options.selectedConversationId()
    if (projectionPageLoading) {
      lastSelectedConversationId = selectedConversationId
      lastSyncedMessageIds = messageIds
      return
    }
    if (chatSearchOpen.value && chatSearchRuntimeState.term.trim()) {
      lastSelectedConversationId = selectedConversationId
      lastSyncedMessageIds = messageIds
      await runSearch()
      return
    }
    const previousCount = lastSyncedMessageIds.length
    const wasNearLatest = followingLatest
    const previousIds = new Set(lastSyncedMessageIds)
    const hasNewUserMessage = messages.some((message) => message.role === 'user' && !previousIds.has(message.id))
    const conversationChanged = selectedConversationId !== lastSelectedConversationId
    lastSelectedConversationId = selectedConversationId
    const forceLatest = conversationChanged || previousCount === 0 || hasNewUserMessage || wasNearLatest
    if (forceLatest) {
      lastSyncedMessageIds = messageIds
      resetChatWindowToLatest()
      scheduleChatScrollToBottom(forceLatest)
      return
    }
    preserveChatWindow(messageIds)
    lastSyncedMessageIds = messageIds
    await Promise.resolve(options.afterDomUpdate())
    syncChatResizeObservation()
  }

  const cancelChatScrollFrame = () => {
    chatScrollSequence += 1
    if (chatScrollFrame === undefined) return
    options.cancelFrame(chatScrollFrame)
    chatScrollFrame = undefined
  }

  const dispose = () => {
    disposed = true
    cancelChatScrollFrame()
    clearSearchTimer()
    clearSearchHighlights()
    resizeObserver?.disconnect()
    observedChatElements.clear()
  }

  return {
    activateChatViewport,
    chatScrollRef,
    chatSearchCurrentIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchOpen,
    chatSearchTerm,
    chatWindowEnd,
    chatWindowStart,
    cancelChatScrollFrame,
    clearChatSearch,
    closeChatSearch,
    dispose,
    findNextChatMatch,
    findPreviousChatMatch,
    handleChatScroll,
    handleChatUserScrollIntent,
    handleSearchTermChanged,
    openChatSearch,
    resetChatWindowToLatest,
    scheduleChatScrollToBottom,
    scrollChatToBottom,
    shiftChatWindow,
    loadOlderProjectionPage,
    syncSearchForMessages,
    visibleChatMessages
  }
}
