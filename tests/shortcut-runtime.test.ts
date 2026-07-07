import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutRuntime } from '@/services/common/shortcutRuntime'

const dispatchShortcut = (key: string, init: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: init.code,
    ctrlKey: init.ctrlKey,
    shiftKey: init.shiftKey,
    altKey: init.altKey,
    metaKey: init.metaKey,
    bubbles: true,
    cancelable: true
  })
  document.dispatchEvent(event)
  return event.defaultPrevented
}

describe('ShortcutRuntime', () => {
  const runtimes: ShortcutRuntime[] = []

  afterEach(() => {
    runtimes.splice(0).forEach((runtime) => runtime.destroy())
  })

  it('ignores stale shortcut updates from a previous owner after a newer install', () => {
    const runtime = new ShortcutRuntime()
    runtimes.push(runtime)
    const currentToggle = vi.fn()
    const staleToggle = vi.fn()
    const currentHandlers = { toggleAi: currentToggle }
    const staleHandlers = { toggleAi: staleToggle }
    const shortcuts = [{ id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' }]

    runtime.install(shortcuts, currentHandlers)
    runtime.update(shortcuts, staleHandlers)

    expect(dispatchShortcut('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(true)
    expect(currentToggle).toHaveBeenCalledTimes(1)
    expect(staleToggle).not.toHaveBeenCalled()

    runtime.setRecording(true, currentHandlers)
    runtime.setRecording(false, staleHandlers)
    expect(dispatchShortcut('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(false)
    expect(currentToggle).toHaveBeenCalledTimes(1)

    runtime.setRecording(false, currentHandlers)
    expect(dispatchShortcut('A', { ctrlKey: true, shiftKey: true, code: 'KeyA' })).toBe(true)
    expect(currentToggle).toHaveBeenCalledTimes(2)
  })
})
