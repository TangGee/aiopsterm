export type AiPanelConversationLike = {
  id: string
  title: string
  summary?: string
  ts: number
  favorite?: boolean
}

export type AiPanelHistoryLabels = {
  today: string
  yesterday: string
  daysAgo: (count: number) => string
  favoriteGroup: string
}

export type AiPanelHistoryGroup<T extends AiPanelConversationLike> = {
  label: string
  items: T[]
}

export type AiPanelConversationTabCloseResult =
  | {
      status: 'keep-one'
      openIds: string[]
    }
  | {
      status: 'closed-inactive'
      openIds: string[]
    }
  | {
      status: 'restore-next'
      openIds: string[]
      nextConversationId: string
    }
  | {
      status: 'closed'
      openIds: string[]
    }

export type AiPanelChatSearchMatch = {
  element: HTMLElement
}

export type AiPanelChatSearchResult = {
  marks: HTMLElement[]
  matches: AiPanelChatSearchMatch[]
  matchCount: number
  currentIndex: number
}

export const visibleAiConversationTabs = <T extends AiPanelConversationLike>(openIds: string[], conversations: T[]) => {
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]))
  return openIds.map((id) => conversationsById.get(id)).filter((conversation): conversation is T => Boolean(conversation))
}

export const displayAiConversationTitle = (conversation: Pick<AiPanelConversationLike, 'title'>, untitledLabel: string) =>
  conversation.title.trim() || untitledLabel

export const aiConversationTabTooltip = (conversation: Pick<AiPanelConversationLike, 'title' | 'summary'>, untitledLabel: string) => {
  const title = displayAiConversationTitle(conversation, untitledLabel)
  const summary = (conversation.summary || '').trim()
  return summary && summary !== title ? `${title}\n${summary}` : title
}

export const ensureAiConversationTabId = <T extends AiPanelConversationLike>(openIds: string[], conversations: T[], id: string) => {
  if (!id || openIds.includes(id) || !conversations.some((conversation) => conversation.id === id)) return openIds
  return [...openIds, id]
}

export const pruneAiConversationTabIds = <T extends AiPanelConversationLike>(openIds: string[], conversations: T[]) => {
  const existingIds = new Set(conversations.map((conversation) => conversation.id))
  const nextIds = openIds.filter((id) => existingIds.has(id))
  return nextIds.length === openIds.length ? openIds : nextIds
}

export const closeAiConversationTab = <T extends Pick<AiPanelConversationLike, 'id'>>(
  openIds: string[],
  visibleTabs: T[],
  selectedConversationId: string,
  closingId: string
): AiPanelConversationTabCloseResult => {
  if (visibleTabs.length <= 1) return { status: 'keep-one', openIds }
  const nextOpenIds = openIds.filter((openId) => openId !== closingId)
  if (selectedConversationId !== closingId) return { status: 'closed-inactive', openIds: nextOpenIds }
  const closedIndex = visibleTabs.findIndex((conversation) => conversation.id === closingId)
  const nextConversation = visibleTabs[closedIndex + 1] || visibleTabs[closedIndex - 1]
  if (nextConversation) return { status: 'restore-next', openIds: nextOpenIds, nextConversationId: nextConversation.id }
  return { status: 'closed', openIds: nextOpenIds }
}

export const filterAiHistoryConversations = <T extends AiPanelConversationLike>(conversations: T[], query: string, favoritesOnly: boolean) => {
  const keyword = query.trim().toLowerCase()
  return conversations.filter((conversation) => {
    const matchesSearch = !keyword || conversation.title.toLowerCase().includes(keyword)
    const matchesFavorite = !favoritesOnly || conversation.favorite
    return matchesSearch && matchesFavorite
  })
}

export const visibleAiHistoryConversations = <T extends AiPanelConversationLike>(conversations: T[], page: number, pageSize: number) =>
  conversations.slice(0, Math.max(1, page) * Math.max(1, pageSize))

export const hasMoreAiHistoryConversations = (filteredCount: number, visibleCount: number) => visibleCount < filteredCount

export const groupAiHistoryConversations = <T extends AiPanelConversationLike>(
  conversations: T[],
  labelForConversation: (conversation: T) => string
): AiPanelHistoryGroup<T>[] => {
  const groups = new Map<string, T[]>()
  conversations.forEach((conversation) => {
    const label = labelForConversation(conversation)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(conversation)
  })
  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    items: [...items].sort((first, second) => second.ts - first.ts)
  }))
}

export const aiHistoryDateLabel = (timestamp: number, now: Date, locale: string, labels: AiPanelHistoryLabels) => {
  const date = new Date(timestamp || now.getTime())
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.floor((startOfToday - startOfTarget) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return labels.today
  if (diffDays === 1) return labels.yesterday
  if (diffDays < 7) return labels.daysAgo(diffDays)
  return date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })
}

export const formatAiHistoryTime = (timestamp: number, now: Date, locale: string, labels: AiPanelHistoryLabels) => {
  const date = new Date(timestamp || now.getTime())
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  return aiHistoryDateLabel(timestamp, now, locale, labels)
}

export const nextAiHistoryPageAfterDelete = (visibleCount: number, currentPage: number) =>
  visibleCount === 0 && currentPage > 1 ? currentPage - 1 : currentPage

export const clearAiChatSearchHighlights = (marks: HTMLElement[]) => {
  marks.splice(0).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  })
}

export const isSearchableAiChatTextNode = (node: Node) => {
  const parent = node.parentElement
  if (!parent) return false
  if (!node.textContent?.trim()) return false
  if (parent.closest('.ai-chat-search-bar')) return false
  if (parent.closest('.chat-input')) return false
  if (parent.closest('.user-message-edit-container')) return false
  if (parent.closest('button')) return false
  return Boolean(parent.closest('.message'))
}

export const findAiChatTextRanges = (root: HTMLElement, term: string) => {
  const ranges: Range[] = []
  const lowerTerm = term.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isSearchableAiChatTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  let node = walker.nextNode() as Text | null
  while (node) {
    const text = node.data.toLowerCase()
    let offset = 0
    while (true) {
      const index = text.indexOf(lowerTerm, offset)
      if (index === -1) break
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + term.length)
      ranges.push(range)
      offset = index + 1
    }
    node = walker.nextNode() as Text | null
  }
  return ranges
}

export const activateAiChatSearchMatch = (matches: AiPanelChatSearchMatch[], index: number) => {
  matches.forEach((match) => match.element.classList.remove('active'))
  const match = matches[index]
  if (!match) return false
  match.element.classList.add('active')
  if (typeof match.element.scrollIntoView === 'function') {
    match.element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  return true
}

export const runAiChatSearchHighlights = (root: HTMLElement, term: string): AiPanelChatSearchResult => {
  const trimmedTerm = term.trim()
  if (!trimmedTerm) return { marks: [], matches: [], matchCount: 0, currentIndex: 0 }

  const marks: HTMLElement[] = []
  const ranges = findAiChatTextRanges(root, trimmedTerm)
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const mark = document.createElement('mark')
    mark.className = 'ai-chat-search-highlight'
    try {
      ranges[index].surroundContents(mark)
      marks.unshift(mark)
    } catch {
      // Ignore ranges that cannot be wrapped in the rendered DOM.
    }
  }
  const matches = marks.map((element) => ({ element }))
  if (matches.length > 0) activateAiChatSearchMatch(matches, 0)
  return {
    marks,
    matches,
    matchCount: matches.length,
    currentIndex: matches.length > 0 ? 1 : 0
  }
}

export const nextAiChatSearchPosition = (currentIndex: number, matchCount: number) => {
  if (matchCount <= 0) return null
  const activeIndex = currentIndex >= matchCount ? 0 : currentIndex
  return {
    activeIndex,
    currentIndex: activeIndex + 1
  }
}

export const previousAiChatSearchPosition = (currentIndex: number, matchCount: number) => {
  if (matchCount <= 0) return null
  const activeIndex = currentIndex <= 1 ? matchCount - 1 : currentIndex - 2
  return {
    activeIndex,
    currentIndex: activeIndex + 1
  }
}
