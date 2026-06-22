import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  aiPanelContextUsageColor,
  aiPanelContextUsageDisplay,
  aiPanelContextUsageTooltip,
  aiPanelContextUsageTrackColor,
  aiPanelDragLeaveKeepsDropActive,
  createAiPanelSurfaceRuntime
} from '@/services/aiPanelSurfaceRuntime'
import { aiPanelTerminalTabDragType } from '@/services/aiPanelMediaRuntime'
import type { AiPanelMode } from '@/services/aiPanelModeRuntime'

const transferFrom = (data: Record<string, string>) => ({
  dropEffect: 'none',
  getData: (type: string) => data[type] || ''
})

const createRuntime = (modeRef = ref<AiPanelMode>('classic')) => {
  const dropActive = ref(false)
  const inputPlaceholderNotice = ref('')
  const draft = ref('')
  const timers = new Map<number, () => void>()
  let timerId = 0
  const calls = {
    addedKnowledge: [] as string[][],
    boundPanels: [] as Array<{ panelId: string; source: string }>,
    boundHosts: [] as string[],
    closedPopups: 0,
    caretMoves: 0,
    createdConversations: 0,
    clearedTimers: [] as number[]
  }

  const runtime = createAiPanelSurfaceRuntime({
    state: { dropActive, inputPlaceholderNotice },
    mode: () => modeRef.value,
    selectedConversationId: () => '',
    panels: () => [{ id: 'panel-1', sessionId: 'session-1' }, { id: 'panel-2' }],
    createConversation: async () => {
      calls.createdConversations += 1
      return { id: 'created-chat' }
    },
    addKnowledgeFilesToChat: async (relPaths) => {
      calls.addedKnowledge.push(relPaths)
    },
    bindTerminalPanelToCodex: async (panel, source) => {
      calls.boundPanels.push({ panelId: panel.id, source })
    },
    bindHostContextToCodex: async (context) => {
      calls.boundHosts.push(context.id)
    },
    draftText: () => draft.value,
    setDraft: (value) => {
      draft.value = value
    },
    closePopups: () => {
      calls.closedPopups += 1
    },
    moveCaretToEnd: () => {
      calls.caretMoves += 1
    },
    requestFrame: (callback) => {
      callback()
      return 1
    },
    setNoticeTimer: (callback) => {
      timerId += 1
      timers.set(timerId, callback)
      return timerId
    },
    clearNoticeTimer: (timer) => {
      calls.clearedTimers.push(timer)
      timers.delete(timer)
    }
  })

  return { calls, draft, dropActive, inputPlaceholderNotice, modeRef, runtime, timers }
}

describe('aiPanelSurfaceRuntime', () => {
  it('owns context usage display labels and thresholds', () => {
    expect(aiPanelContextUsageDisplay(null)).toEqual({ used: 0, contextWindow: 0, percent: 0 })
    expect(aiPanelContextUsageDisplay({ used: 1536, contextWindow: 128000, percent: 72 })).toEqual({
      used: 1536,
      contextWindow: 128000,
      percent: 72
    })
    expect(aiPanelContextUsageColor({ percent: 12 })).toBe('#3b82f6')
    expect(aiPanelContextUsageColor({ percent: 70 })).toBe('#f59e0b')
    expect(aiPanelContextUsageColor({ percent: 90 })).toBe('#ef4444')
    expect(aiPanelContextUsageTrackColor()).toBe('rgba(128, 128, 128, 0.2)')
    expect(aiPanelContextUsageTooltip({ used: 1536, contextWindow: 128000, percent: 72 })).toBe('72% - 1.5K / 128.0K context used')
  })

  it('keeps drop state active only while dragging inside the panel', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('span')
    outer.appendChild(inner)

    expect(aiPanelDragLeaveKeepsDropActive(outer, inner)).toBe(true)
    expect(aiPanelDragLeaveKeepsDropActive(outer, document.createElement('button'))).toBe(false)
    expect(aiPanelDragLeaveKeepsDropActive(null, inner)).toBe(false)
  })

  it('runs classic knowledge drops through the surface boundary', async () => {
    const { calls, draft, dropActive, runtime } = createRuntime()
    const dataTransfer = transferFrom({
      'application/x-aiopsterm-context': JSON.stringify({ contextType: 'doc', relPath: 'Runbooks/rollback.md', name: 'Rollback.md' })
    })

    runtime.handleDragEnter({ dataTransfer } as DragEvent)
    expect(dropActive.value).toBe(true)
    runtime.handleDragOver({ dataTransfer } as DragEvent)
    expect(dataTransfer.dropEffect).toBe('copy')

    await runtime.handleDrop({ dataTransfer } as DragEvent)
    expect(dropActive.value).toBe(false)
    expect(calls.addedKnowledge).toEqual([['Runbooks/rollback.md']])
    expect(draft.value).toBe('引用知识库：Rollback.md')
    expect(calls.caretMoves).toBe(1)
    expect(calls.closedPopups).toBe(1)
  })

  it('runs Codex terminal and host drops without leaking DataTransfer handling to callers', async () => {
    const modeRef = ref<AiPanelMode>('codex')
    const { calls, runtime } = createRuntime(modeRef)

    await runtime.handleDrop({ dataTransfer: transferFrom({ [aiPanelTerminalTabDragType]: 'panel-1' }) } as DragEvent)
    expect(calls.boundPanels).toEqual([{ panelId: 'panel-1', source: 'drop-terminal-tab' }])

    await runtime.handleDrop({
      dataTransfer: transferFrom({
        'application/x-aiopsterm-context': JSON.stringify({ contextType: 'host', id: 'host-1', host: '10.0.0.8', name: 'Prod' })
      })
    } as DragEvent)
    expect(calls.boundHosts).toEqual(['host-1'])

    await runtime.handleDrop({ dataTransfer: transferFrom({ [aiPanelTerminalTabDragType]: 'panel-2' }) } as DragEvent)
    expect(calls.boundPanels).toHaveLength(1)
  })

  it('owns input placeholder notice timers and attachment conversation fallback', async () => {
    const { calls, inputPlaceholderNotice, runtime, timers } = createRuntime()

    runtime.showInputPlaceholderNotice('first')
    expect(inputPlaceholderNotice.value).toBe('first')
    runtime.showInputPlaceholderNotice('second')
    expect(calls.clearedTimers).toEqual([1])
    expect(inputPlaceholderNotice.value).toBe('second')

    timers.get(2)?.()
    expect(inputPlaceholderNotice.value).toBe('')
    expect(await runtime.ensureAttachmentConversationId()).toBe('created-chat')
    expect(calls.createdConversations).toBe(1)

    runtime.showInputPlaceholderNotice('third')
    runtime.dispose()
    expect(calls.clearedTimers).toEqual([1, 3])
  })
})
