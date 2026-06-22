import { describe, expect, it, vi } from 'vitest'
import {
  aiPanelShellPresentationIcons,
  createAiPanelShellAdapterRuntime
} from '@/services/aiPanelShellAdapterRuntime'

const createBrowserAdapter = () => {
  const callbacks: FrameRequestCallback[] = []
  const timers: Array<{ callback: () => void; delay?: number }> = []
  const editTarget = document.createElement('div')
  return {
    callbacks,
    editTarget,
    timers,
    browser: {
      requestFrame: vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback)
        return callbacks.length
      }),
      cancelFrame: vi.fn(),
      setTimer: vi.fn((callback: () => void, delay?: number) => {
        timers.push({ callback, delay })
        return timers.length
      }),
      clearTimer: vi.fn(),
      queryEditTarget: vi.fn(() => editTarget)
    }
  }
}

describe('aiPanelShellAdapterRuntime', () => {
  it('loads classic chat data once through the shell gate', async () => {
    const calls: string[] = []
    const runtime = createAiPanelShellAdapterRuntime({
      refreshClassicCatalog: vi.fn(async () => {
        calls.push('catalog')
      }),
      hydrateClassicChatData: vi.fn(async () => {
        calls.push('chat')
      })
    })

    await Promise.all([runtime.loadClassicChatData(), runtime.loadClassicChatData()])
    await runtime.loadClassicChatData()

    expect(calls.sort()).toEqual(['catalog', 'chat'])
  })

  it('routes frame, timer, defer, and clear helpers through the browser adapter', () => {
    const { browser, callbacks, timers } = createBrowserAdapter()
    const runtime = createAiPanelShellAdapterRuntime({
      refreshClassicCatalog: vi.fn(async () => undefined),
      hydrateClassicChatData: vi.fn(async () => undefined),
      browser
    })
    const frameCallback = vi.fn()
    const timerCallback = vi.fn()
    const deferCallback = vi.fn()

    expect(runtime.requestFrame(frameCallback)).toBe(1)
    expect(callbacks).toEqual([frameCallback])
    runtime.cancelFrame(7)
    expect(browser.cancelFrame).toHaveBeenCalledWith(7)

    expect(runtime.setTimer(timerCallback, 150)).toBe(1)
    expect(timers[0]).toEqual({ callback: timerCallback, delay: 150 })
    runtime.clearTimer(1)
    runtime.clearAnyTimer(2)
    runtime.clearAnyTimer('not-a-timer')
    expect(browser.clearTimer).toHaveBeenCalledTimes(2)
    expect(browser.clearTimer).toHaveBeenNthCalledWith(1, 1)
    expect(browser.clearTimer).toHaveBeenNthCalledWith(2, 2)

    runtime.defer(deferCallback)
    expect(browser.setTimer).toHaveBeenLastCalledWith(deferCallback, 0)
  })

  it('schedules focus restoration for main and edit popup targets', () => {
    const { browser, callbacks } = createBrowserAdapter()
    const runtime = createAiPanelShellAdapterRuntime({
      refreshClassicCatalog: vi.fn(async () => undefined),
      hydrateClassicChatData: vi.fn(async () => undefined),
      browser
    })
    const restoreEditInputSelection = vi.fn()
    const restoreEditableSelection = vi.fn()

    runtime.focusInputForTarget('main', {
      restoreEditInputSelection,
      restoreEditableSelection
    })
    runtime.focusInputForTarget('edit', {
      restoreEditInputSelection,
      restoreEditableSelection
    })

    callbacks[0](1)
    callbacks[1](2)
    expect(restoreEditableSelection).toHaveBeenCalledTimes(1)
    expect(restoreEditInputSelection).toHaveBeenCalledTimes(1)
  })

  it('exposes presentation shell constants and edit target lookup', () => {
    const { browser, editTarget } = createBrowserAdapter()
    const runtime = createAiPanelShellAdapterRuntime({
      refreshClassicCatalog: vi.fn(async () => undefined),
      hydrateClassicChatData: vi.fn(async () => undefined),
      browser
    })

    expect(runtime.maxHostContexts).toBe(5)
    expect(runtime.presentationIcons).toBe(aiPanelShellPresentationIcons)
    expect(runtime.presentationIcons.hosts).toBeTruthy()
    expect(runtime.queryEditTarget()).toBe(editTarget)
    expect(browser.queryEditTarget).toHaveBeenCalledTimes(1)
  })

  it('supports optional and required DOM update callbacks', async () => {
    const afterDomUpdate = vi.fn(async (callback?: () => void) => {
      callback?.()
    })
    const runtime = createAiPanelShellAdapterRuntime({
      refreshClassicCatalog: vi.fn(async () => undefined),
      hydrateClassicChatData: vi.fn(async () => undefined),
      afterDomUpdate
    })
    const optionalCallback = vi.fn()
    const requiredCallback = vi.fn()

    await runtime.afterDomUpdate()
    await runtime.afterDomUpdate(optionalCallback)
    await runtime.afterRequiredDomUpdate(requiredCallback)

    expect(afterDomUpdate).toHaveBeenCalledTimes(3)
    expect(optionalCallback).toHaveBeenCalledTimes(1)
    expect(requiredCallback).toHaveBeenCalledTimes(1)
  })
})
