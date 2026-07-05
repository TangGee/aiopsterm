import { describe, expect, it, vi } from 'vitest'

type NativeNotificationRuntime = {
  isSupported: () => boolean
  create: (input: { title: string; body?: string; silent?: boolean }) => {
    on: (event: 'click', listener: () => void) => void
    show: () => void
    close?: () => void
  }
}

type NativeNotificationRuntimeModule = {
  shouldShowNativeNotification: (enabled: boolean, isSupported: () => boolean) => boolean
  syncNativeNotificationKeys: (activeKeys: Iterable<string>) => void
  showNativeNotification: (
    runtime: NativeNotificationRuntime,
    input: { title: string; body?: string; silent?: boolean; key?: string; onClick?: () => void },
    enabled?: boolean
  ) => boolean
}

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/app/nativeNotificationRuntime'
  return (await import(modulePath)) as NativeNotificationRuntimeModule
}

const createRuntime = (supported = true) => {
  const clickListeners: Array<() => void> = []
  const show = vi.fn()
  const close = vi.fn()
  const runtime: NativeNotificationRuntime = {
    isSupported: vi.fn(() => supported),
    create: vi.fn(() => ({
      on: (_event: 'click', listener: () => void) => clickListeners.push(listener),
      show,
      close
    }))
  }
  return { runtime, show, close, clickListeners }
}

describe('nativeNotificationRuntime', () => {
  it('gates platform notifications on user settings and platform support', async () => {
    const { shouldShowNativeNotification } = await loadRuntime()

    expect(shouldShowNativeNotification(true, () => true)).toBe(true)
    expect(shouldShowNativeNotification(false, () => true)).toBe(false)
    expect(shouldShowNativeNotification(true, () => false)).toBe(false)
  })

  it('creates and shows native notifications through the injected platform adapter', async () => {
    const { showNativeNotification } = await loadRuntime()
    const { runtime, show, clickListeners } = createRuntime()
    const onClick = vi.fn()

    expect(showNativeNotification(runtime, { title: ' Build done ', body: ' ok ', onClick }, true)).toBe(true)
    expect(runtime.create).toHaveBeenCalledWith({ title: 'Build done', body: 'ok', silent: false })
    expect(show).toHaveBeenCalledTimes(1)
    expect(clickListeners).toHaveLength(1)
    clickListeners[0]()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not construct notifications when disabled or unsupported', async () => {
    const { showNativeNotification } = await loadRuntime()

    const disabled = createRuntime()
    expect(showNativeNotification(disabled.runtime, { title: 'Disabled' }, false)).toBe(false)
    expect(disabled.runtime.create).not.toHaveBeenCalled()

    const unsupported = createRuntime(false)
    expect(showNativeNotification(unsupported.runtime, { title: 'Unsupported' }, true)).toBe(false)
    expect(unsupported.runtime.create).not.toHaveBeenCalled()
  })

  it('keeps keyed native notifications aligned with active attention ids', async () => {
    const { showNativeNotification, syncNativeNotificationKeys } = await loadRuntime()
    const first = createRuntime()
    const second = createRuntime()

    expect(showNativeNotification(first.runtime, { key: 'managed-ai:codex:one', title: 'First' }, true)).toBe(true)
    expect(showNativeNotification(second.runtime, { key: 'managed-ai:codex:one', title: 'Second' }, true)).toBe(true)

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).not.toHaveBeenCalled()

    syncNativeNotificationKeys([])
    expect(second.close).toHaveBeenCalledTimes(1)
  })
})
