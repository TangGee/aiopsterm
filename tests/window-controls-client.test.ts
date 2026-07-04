import { afterEach, describe, expect, it, vi } from 'vitest'
import { windowControlsClient } from '@/services/app/windowControlsClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('windowControlsClient', () => {
  it('returns undefined for unavailable bridge methods and binds window control methods', async () => {
    const offMaximized = vi.fn()
    const offUnmaximized = vi.fn()
    const onMaximized = vi.fn()
    const onUnmaximized = vi.fn()

    window.aiops = {
      ...originalAiops,
      platform: vi.fn(async () => 'linux'),
      minimizeWindow: vi.fn(async () => undefined),
      maximizeWindow: vi.fn(async () => undefined),
      unmaximizeWindow: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => true),
      newWindow: vi.fn(async () => undefined),
      toggleFullScreen: vi.fn(async () => true),
      closeWindow: vi.fn(async () => undefined),
      onMaximized: vi.fn(() => offMaximized),
      onUnmaximized: vi.fn(() => offUnmaximized)
    }

    await expect(windowControlsClient.platform()?.()).resolves.toBe('linux')
    await expect(windowControlsClient.minimizeWindow()?.()).resolves.toBeUndefined()
    await expect(windowControlsClient.maximizeWindow()?.()).resolves.toBeUndefined()
    await expect(windowControlsClient.unmaximizeWindow()?.()).resolves.toBeUndefined()
    await expect(windowControlsClient.isMaximized()?.()).resolves.toBe(true)
    await expect(windowControlsClient.newWindow()?.()).resolves.toBeUndefined()
    await expect(windowControlsClient.toggleFullScreen()?.()).resolves.toBe(true)
    await expect(windowControlsClient.closeWindow()?.()).resolves.toBeUndefined()
    expect(windowControlsClient.onMaximized()?.(onMaximized)).toBe(offMaximized)
    expect(windowControlsClient.onUnmaximized()?.(onUnmaximized)).toBe(offUnmaximized)

    expect(window.aiops.platform).toHaveBeenCalledTimes(1)
    expect(window.aiops.minimizeWindow).toHaveBeenCalledTimes(1)
    expect(window.aiops.maximizeWindow).toHaveBeenCalledTimes(1)
    expect(window.aiops.unmaximizeWindow).toHaveBeenCalledTimes(1)
    expect(window.aiops.isMaximized).toHaveBeenCalledTimes(1)
    expect(window.aiops.newWindow).toHaveBeenCalledTimes(1)
    expect(window.aiops.toggleFullScreen).toHaveBeenCalledTimes(1)
    expect(window.aiops.closeWindow).toHaveBeenCalledTimes(1)
    expect(window.aiops.onMaximized).toHaveBeenCalledWith(onMaximized)
    expect(window.aiops.onUnmaximized).toHaveBeenCalledWith(onUnmaximized)

    window.aiops = {
      ...originalAiops,
      platform: undefined as any,
      minimizeWindow: undefined as any,
      maximizeWindow: undefined as any,
      unmaximizeWindow: undefined as any,
      isMaximized: undefined as any,
      newWindow: undefined as any,
      toggleFullScreen: undefined as any,
      closeWindow: undefined as any,
      onMaximized: undefined as any,
      onUnmaximized: undefined as any
    }

    expect(windowControlsClient.platform()).toBeUndefined()
    expect(windowControlsClient.minimizeWindow()).toBeUndefined()
    expect(windowControlsClient.maximizeWindow()).toBeUndefined()
    expect(windowControlsClient.unmaximizeWindow()).toBeUndefined()
    expect(windowControlsClient.isMaximized()).toBeUndefined()
    expect(windowControlsClient.newWindow()).toBeUndefined()
    expect(windowControlsClient.toggleFullScreen()).toBeUndefined()
    expect(windowControlsClient.closeWindow()).toBeUndefined()
    expect(windowControlsClient.onMaximized()).toBeUndefined()
    expect(windowControlsClient.onUnmaximized()).toBeUndefined()
  })
})
