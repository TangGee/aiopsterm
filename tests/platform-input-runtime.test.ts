import { describe, expect, it, vi } from 'vitest'
import { configurePlatformInputRuntime } from '../src/shared/platformInputRuntime'

describe('platform input runtime', () => {
  it('enables native key repeat for letters inside the macOS app', () => {
    const setUserDefault = vi.fn()

    expect(configurePlatformInputRuntime({ platform: 'darwin', setUserDefault })).toBe(true)
    expect(setUserDefault).toHaveBeenCalledWith('ApplePressAndHoldEnabled', 'boolean', false)
  })

  it.each(['win32', 'linux'] as const)('leaves %s keyboard behavior unchanged', (platform) => {
    const setUserDefault = vi.fn()

    expect(configurePlatformInputRuntime({ platform, setUserDefault })).toBe(false)
    expect(setUserDefault).not.toHaveBeenCalled()
  })

  it('does not prevent startup when macOS rejects the preference update', () => {
    const setUserDefault = vi.fn(() => {
      throw new Error('preference unavailable')
    })

    expect(configurePlatformInputRuntime({ platform: 'darwin', setUserDefault })).toBe(false)
  })
})
