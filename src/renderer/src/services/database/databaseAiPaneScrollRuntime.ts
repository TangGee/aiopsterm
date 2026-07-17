import { computed, ref } from 'vue'

export type DatabaseAiPaneScrollMessage = {
  id: string
  role: 'user' | 'assistant'
}

type DatabaseAiPaneScrollRuntimeOptions<TMessage extends DatabaseAiPaneScrollMessage> = {
  root: () => HTMLElement | null
  afterDomUpdate: () => void | Promise<void>
  requestFrame: (callback: () => void) => number
  cancelFrame: (frame: number) => void
  messages?: () => TMessage[]
  loadOlderMessages?: () => Promise<number>
  threshold?: number
}

export const databaseAiPaneInitialWindowSize = 80
export const databaseAiPaneMaximumWindowSize = 120
export const databaseAiPaneWindowShiftSize = 40

export const createDatabaseAiPaneScrollRuntime = <TMessage extends DatabaseAiPaneScrollMessage>(
  options: DatabaseAiPaneScrollRuntimeOptions<TMessage>
) => {
  const threshold = Math.max(0, options.threshold ?? 72)
  let followingLatest = true
  let scrollFrame: number | undefined
  let scrollSequence = 0
  let pendingScrollSequence: number | undefined
  let previousMessageIds: string[] = []
  let windowShiftPending = false
  let pageLoadPending = false
  const initialCount = options.messages?.().length || 0
  const windowStart = ref(Math.max(0, initialCount - databaseAiPaneInitialWindowSize))
  const windowEnd = ref(initialCount)
  const visibleMessages = computed(() => {
    const messages = options.messages?.() || []
    return messages.slice(windowStart.value, windowEnd.value)
  })

  const messageElements = () =>
    Array.from(options.root()?.querySelectorAll<HTMLElement>('.db-ai-pane-message[data-message-id]') || [])

  const captureAnchor = () => {
    const root = options.root()
    if (!root) return null
    const elements = messageElements()
    const element = elements.find((candidate) => candidate.offsetTop + candidate.offsetHeight >= root.scrollTop) || elements[0]
    if (!element?.dataset.messageId) return null
    return {
      messageId: element.dataset.messageId,
      viewportOffset: element.offsetTop - root.scrollTop,
      previousScrollHeight: root.scrollHeight
    }
  }

  const restoreAnchor = (anchor: ReturnType<typeof captureAnchor>) => {
    const root = options.root()
    if (!root || !anchor) return
    const element = messageElements().find((candidate) => candidate.dataset.messageId === anchor.messageId)
    if (element) {
      root.scrollTop = Math.max(0, element.offsetTop - anchor.viewportOffset)
      return
    }
    root.scrollTop += Math.max(0, root.scrollHeight - anchor.previousScrollHeight)
  }

  const resetWindowToLatest = () => {
    const count = options.messages?.().length || 0
    windowEnd.value = count
    windowStart.value = Math.max(0, count - databaseAiPaneInitialWindowSize)
  }

  const cancelScheduledScroll = () => {
    scrollSequence += 1
    pendingScrollSequence = undefined
    if (scrollFrame === undefined) return
    options.cancelFrame(scrollFrame)
    scrollFrame = undefined
  }

  const scrollToBottom = () => {
    const root = options.root()
    if (!root) return
    root.scrollTop = root.scrollHeight
    followingLatest = true
  }

  const shiftWindow = async (direction: 'older' | 'newer') => {
    const count = options.messages?.().length || 0
    const canShift = direction === 'older' ? windowStart.value > 0 : windowEnd.value < count
    if (!canShift || windowShiftPending) return false
    windowShiftPending = true
    try {
      const anchor = captureAnchor()
      const currentSize = windowEnd.value - windowStart.value
      if (direction === 'older') {
        const start = Math.max(0, windowStart.value - databaseAiPaneWindowShiftSize)
        const size = Math.min(databaseAiPaneMaximumWindowSize, currentSize + windowStart.value - start)
        windowStart.value = start
        windowEnd.value = Math.min(count, start + size)
      } else {
        const end = Math.min(count, windowEnd.value + databaseAiPaneWindowShiftSize)
        const size = Math.min(databaseAiPaneMaximumWindowSize, currentSize + end - windowEnd.value)
        windowEnd.value = end
        windowStart.value = Math.max(0, end - size)
      }
      await Promise.resolve(options.afterDomUpdate())
      restoreAnchor(anchor)
      followingLatest = false
      return true
    } finally {
      windowShiftPending = false
    }
  }

  const loadOlderPage = async () => {
    if (!options.loadOlderMessages || pageLoadPending) return false
    const anchor = captureAnchor()
    const previousCount = options.messages?.().length || 0
    pageLoadPending = true
    windowShiftPending = true
    try {
      const added = await options.loadOlderMessages()
      const messages = options.messages?.() || []
      if (!added || messages.length <= previousCount) return false
      const anchorIndex = anchor ? messages.findIndex((message) => message.id === anchor.messageId) : added
      const start = Math.max(0, (anchorIndex < 0 ? added : anchorIndex) - databaseAiPaneWindowShiftSize)
      windowStart.value = start
      windowEnd.value = Math.min(messages.length, start + databaseAiPaneMaximumWindowSize)
      previousMessageIds = messages.map((message) => message.id)
      await Promise.resolve(options.afterDomUpdate())
      restoreAnchor(anchor)
      followingLatest = false
      return true
    } finally {
      pageLoadPending = false
      windowShiftPending = false
    }
  }

  const scheduleScrollToBottom = (force = false) => {
    if (force) followingLatest = true
    if (!followingLatest || pendingScrollSequence !== undefined) return
    const sequence = ++scrollSequence
    pendingScrollSequence = sequence
    void Promise.resolve(options.afterDomUpdate()).then(() => {
      if (!followingLatest || sequence !== pendingScrollSequence) return
      let requestedFrame: number | undefined
      requestedFrame = options.requestFrame(() => {
        if (scrollFrame === requestedFrame) scrollFrame = undefined
        if (sequence !== pendingScrollSequence) return
        pendingScrollSequence = undefined
        if (followingLatest) scrollToBottom()
      })
      scrollFrame = requestedFrame
    })
  }

  const handleScroll = async () => {
    const root = options.root()
    if (!root || windowShiftPending) return
    const distanceFromBottom = root.scrollHeight - root.clientHeight - root.scrollTop
    const atRenderedBottom = distanceFromBottom <= threshold
    const hasNewerWindow = Boolean(options.messages && windowEnd.value < options.messages().length)
    followingLatest = atRenderedBottom && !hasNewerWindow
    if (!followingLatest) cancelScheduledScroll()
    if (!options.messages || followingLatest) return
    if (root.scrollTop <= threshold) {
      if (windowStart.value > 0) await shiftWindow('older')
      else await loadOlderPage()
      return
    }
    if (atRenderedBottom && hasNewerWindow) await shiftWindow('newer')
  }

  const syncMessages = (messages: DatabaseAiPaneScrollMessage[]) => {
    const messageIds = messages.map((message) => message.id)
    const previousIds = new Set(previousMessageIds)
    const hasNewUserMessage = messages.some((message) => message.role === 'user' && !previousIds.has(message.id))
    const transcriptReplaced = previousMessageIds.length > 0 && !messageIds.some((id) => previousIds.has(id))
    const forceLatest = previousMessageIds.length === 0 || hasNewUserMessage || transcriptReplaced
    if (pageLoadPending) {
      previousMessageIds = messageIds
      return
    }
    if (forceLatest || followingLatest) {
      resetWindowToLatest()
    } else {
      const currentSize = Math.min(databaseAiPaneMaximumWindowSize, windowEnd.value - windowStart.value)
      const previousStartId = previousMessageIds[windowStart.value]
      const anchoredStart = previousStartId ? messageIds.indexOf(previousStartId) : -1
      if (anchoredStart >= 0) {
        windowStart.value = anchoredStart
        windowEnd.value = Math.min(messages.length, anchoredStart + currentSize)
      }
    }
    previousMessageIds = messageIds
    scheduleScrollToBottom(forceLatest)
  }

  const dispose = () => cancelScheduledScroll()

  return {
    dispose,
    handleScroll,
    scheduleScrollToBottom,
    scrollToBottom,
    syncMessages,
    shiftWindow,
    loadOlderPage,
    visibleMessages,
    windowStart,
    windowEnd
  }
}
