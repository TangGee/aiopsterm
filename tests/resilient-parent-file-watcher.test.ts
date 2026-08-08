import { afterEach, describe, expect, it, vi } from 'vitest'

describe('resilient parent file watcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to portable polling when the native watcher fails asynchronously', async () => {
    const modulePath = '../src/main/backend/files/resilientParentFileWatcher'
    const { createResilientParentFileWatcher } = await import(modulePath)
    vi.useFakeTimers()
    let onError: ((error: Error) => void) | null = null
    const close = vi.fn()
    const inspect = vi.fn()
    const watcher = createResilientParentFileWatcher({
      parentPath: '/project',
      onChange: vi.fn(),
      inspect,
      pollIntervalMs: 50
    }, () => ({
      close,
      on: (_event: 'error', listener: (error: Error) => void) => {
        onError = listener
      }
    }))

    expect(onError).not.toBeNull()
    ;(onError as unknown as (error: Error) => void)(new Error('EMFILE'))
    expect(close).toHaveBeenCalledOnce()
    expect(inspect).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(120)
    expect(inspect).toHaveBeenCalledTimes(3)
    watcher.close()
    await vi.advanceTimersByTimeAsync(120)
    expect(inspect).toHaveBeenCalledTimes(3)
  })
})
