import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  aiConversationTabTooltip,
  aiHistoryDateLabel,
  clearAiChatSearchHighlights,
  closeAiConversationTab,
  createAiPanelConversationViewRuntime,
  displayAiConversationTitle,
  ensureAiConversationTabId,
  filterAiHistoryConversations,
  formatAiHistoryTime,
  groupAiHistoryConversations,
  hasMoreAiHistoryConversations,
  nextAiChatSearchPosition,
  nextAiHistoryPageAfterDelete,
  previousAiChatSearchPosition,
  pruneAiConversationTabIds,
  runAiChatSearchHighlights,
  visibleAiConversationTabs,
  visibleAiHistoryConversations,
  type AiPanelConversationLike
} from '@/services/ai/aiPanelConversationRuntime'

const conversations: AiPanelConversationLike[] = [
  { id: 'conv-1', title: '生产巡检', summary: 'CPU and disk', ts: 3000, favorite: true },
  { id: 'conv-2', title: '发布回滚会话', summary: 'nginx rollback', ts: 2000 },
  { id: 'conv-3', title: '数据库慢查询', summary: 'slow query', ts: 1000, favorite: true }
]

describe('aiPanelConversationRuntime', () => {
  it('projects conversation tabs and history view state through one runtime boundary', () => {
    const now = new Date('2026-06-20T10:00:00+08:00')
    const viewConversations: AiPanelConversationLike[] = [
      { ...conversations[0], ts: new Date('2026-06-20T09:00:00+08:00').getTime() },
      { ...conversations[1], ts: new Date('2026-06-20T08:00:00+08:00').getTime() },
      { ...conversations[2], ts: new Date('2026-06-19T20:00:00+08:00').getTime() }
    ]
    const openIds = ref(['conv-1', 'missing', 'conv-2'])
    const query = ref('')
    const favoritesOnly = ref(false)
    const page = ref(1)
    const labels = {
      today: '今天',
      yesterday: '昨天',
      favoriteGroup: '收藏',
      daysAgo: (count: number) => `${count}天前`
    }
    const runtime = createAiPanelConversationViewRuntime({
      openIds: () => openIds.value,
      conversations: () => viewConversations,
      sortedConversations: () => viewConversations,
      historySearchTerm: () => query.value,
      historyFavoritesOnly: () => favoritesOnly.value,
      historyCurrentPage: () => page.value,
      historyPageSize: 2,
      locale: () => 'zh-CN',
      labels: () => labels,
      untitledLabel: () => '新会话',
      now: () => now
    })

    expect(runtime.visibleConversationTabs.value.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2'])
    expect(runtime.displayConversationTitle({ title: '  ' })).toBe('新会话')
    expect(runtime.conversationTabTooltip({ title: 'Title', summary: 'Summary' })).toBe('Title\nSummary')
    expect(runtime.visibleHistoryConversations.value.map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2'])
    expect(runtime.hasMoreHistoryConversations.value).toBe(true)
    expect(runtime.groupedVisibleHistory.value).toEqual([{ label: '今天', items: [viewConversations[0], viewConversations[1]] }])

    query.value = '数据库'
    favoritesOnly.value = true
    page.value = 2
    openIds.value = ['conv-3']

    expect(runtime.visibleConversationTabs.value.map((conversation) => conversation.id)).toEqual(['conv-3'])
    expect(runtime.filteredHistoryConversations.value.map((conversation) => conversation.id)).toEqual(['conv-3'])
    expect(runtime.historyFavoriteLabel.value).toBe('收藏')
    expect(runtime.groupedVisibleHistory.value).toEqual([{ label: '收藏', items: [viewConversations[2]] }])
    expect(runtime.formatHistoryTime(new Date('2026-06-20T09:30:00+08:00').getTime())).toContain('09:30')
  })

  it('manages visible conversation tab ids without deleting backend history', () => {
    expect(visibleAiConversationTabs(['conv-1', 'missing', 'conv-2'], conversations).map((conversation) => conversation.id)).toEqual([
      'conv-1',
      'conv-2'
    ])
    expect(displayAiConversationTitle({ title: '  ' }, '新会话')).toBe('新会话')
    expect(aiConversationTabTooltip({ title: 'Title', summary: 'Summary' }, '新会话')).toBe('Title\nSummary')
    expect(ensureAiConversationTabId(['conv-1'], conversations, 'conv-2')).toEqual(['conv-1', 'conv-2'])
    expect(ensureAiConversationTabId(['conv-1'], conversations, 'missing')).toEqual(['conv-1'])
    expect(pruneAiConversationTabIds(['conv-1', 'missing', 'conv-3'], conversations)).toEqual(['conv-1', 'conv-3'])

    expect(closeAiConversationTab(['conv-1'], [conversations[0]], 'conv-1', 'conv-1')).toEqual({
      status: 'keep-one',
      openIds: ['conv-1']
    })
    expect(closeAiConversationTab(['conv-1', 'conv-2'], [conversations[0], conversations[1]], 'conv-1', 'conv-2')).toEqual({
      status: 'closed-inactive',
      openIds: ['conv-1']
    })
    expect(closeAiConversationTab(['conv-1', 'conv-2'], [conversations[0], conversations[1]], 'conv-1', 'conv-1')).toEqual({
      status: 'restore-next',
      openIds: ['conv-2'],
      nextConversationId: 'conv-2'
    })
  })

  it('filters, paginates, groups, and labels history conversations', () => {
    const filtered = filterAiHistoryConversations(conversations, '发布', false)
    expect(filtered.map((conversation) => conversation.id)).toEqual(['conv-2'])
    expect(filterAiHistoryConversations(conversations, '', true).map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-3'])
    expect(visibleAiHistoryConversations(conversations, 1, 2).map((conversation) => conversation.id)).toEqual(['conv-1', 'conv-2'])
    expect(hasMoreAiHistoryConversations(3, 2)).toBe(true)
    expect(nextAiHistoryPageAfterDelete(0, 3)).toBe(2)
    expect(nextAiHistoryPageAfterDelete(1, 3)).toBe(3)

    expect(
      groupAiHistoryConversations(conversations, (conversation) => (conversation.favorite ? '收藏' : '今天'))
    ).toEqual([
      { label: '收藏', items: [conversations[0], conversations[2]] },
      { label: '今天', items: [conversations[1]] }
    ])

    const labels = {
      today: '今天',
      yesterday: '昨天',
      favoriteGroup: '收藏',
      daysAgo: (count: number) => `${count}天前`
    }
    const now = new Date('2026-06-20T10:00:00+08:00')
    expect(aiHistoryDateLabel(new Date('2026-06-20T01:00:00+08:00').getTime(), now, 'zh-CN', labels)).toBe('今天')
    expect(aiHistoryDateLabel(new Date('2026-06-19T23:00:00+08:00').getTime(), now, 'zh-CN', labels)).toBe('昨天')
    expect(aiHistoryDateLabel(new Date('2026-06-17T12:00:00+08:00').getTime(), now, 'zh-CN', labels)).toBe('3天前')
    expect(formatAiHistoryTime(new Date('2026-06-20T09:30:00+08:00').getTime(), now, 'zh-CN', labels)).toContain('09:30')
  })

  it('highlights searchable chat text and supports next and previous navigation', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <article class="message"><p>rollback first</p><button>rollback ignored</button></article>
      <article class="message"><p>second rollback</p></article>
      <form class="chat-input">rollback ignored</form>
    `
    const result = runAiChatSearchHighlights(root, 'rollback')
    expect(result.matchCount).toBe(2)
    expect(result.currentIndex).toBe(1)
    expect(root.querySelectorAll('.ai-chat-search-highlight')).toHaveLength(2)
    expect(root.querySelectorAll('.ai-chat-search-highlight.active')).toHaveLength(1)

    const next = nextAiChatSearchPosition(result.currentIndex, result.matchCount)
    expect(next).toEqual({ activeIndex: 1, currentIndex: 2 })
    const previous = previousAiChatSearchPosition(next!.currentIndex, result.matchCount)
    expect(previous).toEqual({ activeIndex: 0, currentIndex: 1 })

    clearAiChatSearchHighlights(result.marks)
    expect(root.querySelector('.ai-chat-search-highlight')).toBeNull()
    expect(root.textContent).toContain('rollback first')
  })
})
