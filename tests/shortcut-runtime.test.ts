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

const dispatchShortcutFrom = (target: Element, key: string, init: Partial<KeyboardEventInit> = {}) => {
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
  target.dispatchEvent(event)
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

  it('supports configurable workspace panel shortcuts inside terminal targets', () => {
    const runtime = new ShortcutRuntime()
    runtimes.push(runtime)
    const recentPanels = vi.fn()
    const navigatePanelBack = vi.fn()
    const navigatePanelForward = vi.fn()
    runtime.install(
      [
        { id: 'recentPanels', action: '打开最近面板', shortcut: 'Ctrl+E' },
        { id: 'navigatePanelBack', action: '导航到上一个面板', shortcut: 'Ctrl+Left' },
        { id: 'navigatePanelForward', action: '导航到下一个面板', shortcut: 'Ctrl+Right' }
      ],
      { recentPanels, navigatePanelBack, navigatePanelForward }
    )
    const terminal = document.createElement('div')
    terminal.className = 'xterm-host'
    document.body.appendChild(terminal)

    expect(dispatchShortcutFrom(terminal, 'e', { ctrlKey: true, code: 'KeyE' })).toBe(true)
    expect(dispatchShortcutFrom(terminal, 'ArrowLeft', { ctrlKey: true })).toBe(true)
    expect(dispatchShortcutFrom(terminal, 'ArrowRight', { ctrlKey: true })).toBe(true)
    expect(recentPanels).toHaveBeenCalledTimes(1)
    expect(navigatePanelBack).toHaveBeenCalledTimes(1)
    expect(navigatePanelForward).toHaveBeenCalledTimes(1)
    terminal.remove()
  })

  it('keeps unrelated plain control shortcuts available to the terminal', () => {
    const runtime = new ShortcutRuntime()
    runtimes.push(runtime)
    const handler = vi.fn()
    runtime.install([{ id: 'custom', action: 'Custom', shortcut: 'Ctrl+B' }], { custom: handler })
    const terminal = document.createElement('div')
    terminal.className = 'threaded-terminal-host'
    document.body.appendChild(terminal)

    expect(dispatchShortcutFrom(terminal, 'b', { ctrlKey: true, code: 'KeyB' })).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    terminal.remove()
  })

  it('does not open workspace navigation over another modal dialog', () => {
    const runtime = new ShortcutRuntime()
    runtimes.push(runtime)
    const handler = vi.fn()
    runtime.install([{ id: 'recentPanels', action: '打开最近面板', shortcut: 'Ctrl+E' }], { recentPanels: handler })
    const dialog = document.createElement('section')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)

    expect(dispatchShortcut('e', { ctrlKey: true, code: 'KeyE' })).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    dialog.remove()
  })
})
