import { describe, expect, it, vi } from 'vitest'
import {
  createDatabaseAiPaneScrollRuntime,
  databaseAiPaneMaximumWindowSize
} from '@/services/database/databaseAiPaneScrollRuntime'

const userMessage = (id: string) => ({ id, role: 'user' as const })
const assistantMessage = (id: string) => ({ id, role: 'assistant' as const })

const createHarness = () => {
  const root = document.createElement('div')
  let scrollHeight = 400
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
  const frames = new Map<number, () => void>()
  let frameSequence = 0
  const requestFrame = vi.fn((callback: () => void) => {
    const id = ++frameSequence
    frames.set(id, callback)
    return id
  })
  const cancelFrame = vi.fn((id: number) => frames.delete(id))
  const runtime = createDatabaseAiPaneScrollRuntime({
    root: () => root,
    afterDomUpdate: () => Promise.resolve(),
    requestFrame,
    cancelFrame
  })
  const flush = async () => {
    await Promise.resolve()
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback())
  }
  return {
    root,
    runtime,
    requestFrame,
    cancelFrame,
    flush,
    setScrollHeight: (value: number) => {
      scrollHeight = value
    }
  }
}

describe('databaseAiPaneScrollRuntime', () => {
  it('follows assistant content growth while the viewport is already at the latest message', async () => {
    const harness = createHarness()
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await harness.flush()
    expect(harness.root.scrollTop).toBe(400)

    harness.setScrollHeight(620)
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await harness.flush()

    expect(harness.root.scrollTop).toBe(620)
  })

  it('preserves an operator scroll-up during streaming and resumes after a new user message', async () => {
    const harness = createHarness()
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await harness.flush()
    harness.root.scrollTop = 120
    harness.runtime.handleScroll()

    harness.setScrollHeight(700)
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await harness.flush()
    expect(harness.root.scrollTop).toBe(120)

    harness.runtime.syncMessages([
      userMessage('user-1'),
      assistantMessage('assistant-1'),
      userMessage('user-2'),
      assistantMessage('assistant-2')
    ])
    await harness.flush()
    expect(harness.root.scrollTop).toBe(700)
  })

  it('coalesces pending stream scrolls and cancels them when the user scrolls away', async () => {
    const harness = createHarness()
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await Promise.resolve()
    harness.runtime.syncMessages([userMessage('user-1'), assistantMessage('assistant-1')])
    await Promise.resolve()

    expect(harness.requestFrame).toHaveBeenCalledTimes(1)
    expect(harness.cancelFrame).not.toHaveBeenCalled()

    harness.root.scrollTop = 0
    harness.runtime.handleScroll()
    expect(harness.cancelFrame).toHaveBeenCalledTimes(1)
    await harness.flush()
    expect(harness.root.scrollTop).toBe(0)
  })

  it('loads older messages with a stable anchor and never renders more than the bounded window', async () => {
    const messages = Array.from({ length: 80 }, (_, index) =>
      index % 2 ? assistantMessage(`latest-${index}`) : userMessage(`latest-${index}`)
    )
    const root = document.createElement('div')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => root.querySelectorAll('.db-ai-pane-message').length * 20
    })
    let runtime!: ReturnType<typeof createDatabaseAiPaneScrollRuntime<(typeof messages)[number]>>
    const render = () => {
      root.replaceChildren(...runtime.visibleMessages.value.map((message, index) => {
        const article = document.createElement('article')
        article.className = 'db-ai-pane-message'
        article.dataset.messageId = message.id
        Object.defineProperty(article, 'offsetTop', { configurable: true, value: index * 20 })
        Object.defineProperty(article, 'offsetHeight', { configurable: true, value: 20 })
        return article
      }))
    }
    const loadOlderMessages = vi.fn(async () => {
      messages.unshift(...Array.from({ length: 40 }, (_, index) =>
        index % 2 ? assistantMessage(`older-${index}`) : userMessage(`older-${index}`)
      ))
      return 40
    })
    runtime = createDatabaseAiPaneScrollRuntime({
      root: () => root,
      afterDomUpdate: async () => render(),
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      messages: () => messages,
      loadOlderMessages
    })
    runtime.syncMessages(messages)
    render()
    root.scrollTop = 10

    await runtime.handleScroll()

    expect(loadOlderMessages).toHaveBeenCalledTimes(1)
    expect(runtime.visibleMessages.value).toHaveLength(databaseAiPaneMaximumWindowSize)
    expect(root.querySelectorAll('.db-ai-pane-message')).toHaveLength(databaseAiPaneMaximumWindowSize)
    expect(runtime.visibleMessages.value[0].id).toBe('older-0')
    expect(root.scrollTop).toBe(810)
  })

  it('moves an older bounded window toward newer messages at its rendered bottom', async () => {
    const messages = Array.from({ length: 200 }, (_, index) =>
      index % 2 ? assistantMessage(`message-${index}`) : userMessage(`message-${index}`)
    )
    const root = document.createElement('div')
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 1_000 })
    const runtime = createDatabaseAiPaneScrollRuntime({
      root: () => root,
      afterDomUpdate: () => Promise.resolve(),
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      messages: () => messages
    })
    runtime.syncMessages(messages)
    await runtime.shiftWindow('older')
    await runtime.shiftWindow('older')
    expect(runtime.windowEnd.value).toBe(160)

    root.scrollTop = 900
    await runtime.handleScroll()

    expect(runtime.windowEnd.value).toBe(200)
    expect(runtime.visibleMessages.value).toHaveLength(databaseAiPaneMaximumWindowSize)
  })
})
