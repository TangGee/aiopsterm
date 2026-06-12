import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard, mirrorTextToClipboardQuietly } from '@/services/clipboardRuntime'

const withMockExecCommand = async <T>(handler: () => boolean, callback: (execCommandSpy: ReturnType<typeof vi.fn>) => Promise<T>) => {
  const originalExecCommand = document.execCommand
  const execCommandSpy = vi.fn(handler)
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommandSpy
  })
  try {
    return await callback(execCommandSpy)
  } finally {
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand
      })
    } else {
      Reflect.deleteProperty(document, 'execCommand')
    }
  }
}

describe('clipboard runtime', () => {
  afterEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockReset()
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined)
  })

  it('falls back to textarea copy for user-visible copy actions', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'))

    await withMockExecCommand(
      () => true,
      async (execCommandSpy) => {
        await expect(copyTextToClipboard('visible copy')).resolves.toBe(true)
        expect(execCommandSpy).toHaveBeenCalledWith('copy')
      }
    )
  })

  it('returns false when both user-visible clipboard paths fail', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'))

    await withMockExecCommand(
      () => false,
      async (execCommandSpy) => {
        await expect(copyTextToClipboard('visible copy')).resolves.toBe(false)
        expect(execCommandSpy).toHaveBeenCalledWith('copy')
      }
    )
  })

  it('keeps silent terminal selection mirroring on the Clipboard API path only', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('clipboard denied'))

    await withMockExecCommand(
      () => true,
      async (execCommandSpy) => {
        await expect(mirrorTextToClipboardQuietly('selected terminal text')).resolves.toBe(false)
        expect(execCommandSpy).not.toHaveBeenCalled()
      }
    )
  })
})
