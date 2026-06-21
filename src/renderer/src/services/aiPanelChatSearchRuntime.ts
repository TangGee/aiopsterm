import {
  activateAiChatSearchMatch,
  clearAiChatSearchHighlights,
  nextAiChatSearchPosition,
  previousAiChatSearchPosition,
  runAiChatSearchHighlights,
  type AiPanelChatSearchMatch
} from '@/services/aiPanelConversationRuntime'

export type AiPanelChatSearchRuntimeState = {
  term: string
  matchCount: number
  currentIndex: number
}

export type AiPanelChatSearchRuntimeOptions = {
  state: AiPanelChatSearchRuntimeState
  isOpen: () => boolean
  setOpen: (open: boolean) => void
  root: () => HTMLElement | null
  closePopups: () => void
  focusSearchInput: () => void | Promise<void>
  afterDomUpdate: () => void | Promise<void>
  scheduleScrollToBottom: () => void
  setSearchTimer: (callback: () => void, delay: number) => unknown
  clearSearchTimer: (timer: unknown) => void
}

export const createEmptyAiPanelChatSearchRuntimeState = (): AiPanelChatSearchRuntimeState => ({
  term: '',
  matchCount: 0,
  currentIndex: 0
})

export const createAiPanelChatSearchRuntime = (options: AiPanelChatSearchRuntimeOptions) => {
  const marks: HTMLElement[] = []
  const matches: AiPanelChatSearchMatch[] = []
  let searchTimer: unknown

  const clearSearchTimer = () => {
    if (!searchTimer) return
    options.clearSearchTimer(searchTimer)
    searchTimer = undefined
  }

  const clearHighlights = () => {
    clearAiChatSearchHighlights(marks)
    matches.splice(0)
    options.state.matchCount = 0
    options.state.currentIndex = 0
  }

  const setActiveMatch = (index: number) => {
    activateAiChatSearchMatch(matches, index)
  }

  const runSearch = () => {
    const root = options.root()
    clearHighlights()
    const term = options.state.term.trim()
    if (!root || !term) return

    const result = runAiChatSearchHighlights(root, term)
    marks.push(...result.marks)
    matches.push(...result.matches)
    options.state.matchCount = result.matchCount
    options.state.currentIndex = result.currentIndex
  }

  const scheduleSearch = () => {
    clearSearchTimer()
    searchTimer = options.setSearchTimer(() => {
      runSearch()
      searchTimer = undefined
    }, 200)
  }

  const openSearch = async () => {
    options.setOpen(true)
    options.closePopups()
    await options.afterDomUpdate()
    await options.focusSearchInput()
    if (options.state.term.trim()) runSearch()
  }

  const closeSearch = () => {
    options.setOpen(false)
    options.state.term = ''
    clearSearchTimer()
    clearHighlights()
  }

  const clearSearch = async () => {
    options.state.term = ''
    clearHighlights()
    await options.afterDomUpdate()
    await options.focusSearchInput()
  }

  const findNextMatch = () => {
    const next = nextAiChatSearchPosition(options.state.currentIndex, matches.length)
    if (!next) return
    options.state.currentIndex = next.currentIndex
    setActiveMatch(next.activeIndex)
  }

  const findPreviousMatch = () => {
    const previous = previousAiChatSearchPosition(options.state.currentIndex, matches.length)
    if (!previous) return
    options.state.currentIndex = previous.currentIndex
    setActiveMatch(previous.activeIndex)
  }

  const handleSearchTermChanged = () => {
    if (!options.isOpen()) return
    scheduleSearch()
  }

  const syncSearchForMessages = async () => {
    if (!options.isOpen() || !options.state.term.trim()) {
      options.scheduleScrollToBottom()
      return
    }
    await options.afterDomUpdate()
    runSearch()
  }

  const dispose = () => {
    clearSearchTimer()
    clearHighlights()
  }

  return {
    clearHighlights,
    clearSearch,
    closeSearch,
    dispose,
    findNextMatch,
    findPreviousMatch,
    handleSearchTermChanged,
    openSearch,
    runSearch,
    scheduleSearch,
    syncSearchForMessages
  }
}
