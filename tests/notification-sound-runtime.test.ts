import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playAiNotificationSound } from '@/services/ai/notificationSoundRuntime'
import type { NotificationUserConfig } from '@shared/contracts/appRuntime'

const settings = (soundPreset: NotificationUserConfig['soundPreset']): NotificationUserConfig => ({
  desktopNotifications: true,
  controlNotificationBell: true,
  soundEnabled: true,
  soundPreset,
  customSoundPath: '',
  customSoundUrl: '',
  customSoundName: ''
})

describe('notification sound runtime', () => {
  const audioInstances: Array<{ src: string; preload: string; volume: number; play: ReturnType<typeof vi.fn> }> = []

  beforeEach(() => {
    document.documentElement.lang = 'zh-CN'
    audioInstances.length = 0
    vi.stubGlobal(
      'Audio',
      class {
        src: string
        preload = ''
        volume = 1
        play = vi.fn(async () => undefined)

        constructor(src: string) {
          this.src = src
          audioInstances.push(this)
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('plays the bundled Chinese role voice without the system speech synthesizer', () => {
    const speak = vi.fn()
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak } })

    expect(playAiNotificationSound(settings('approval-voice'))).toBe(true)
    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].src).toContain('notification-approval-voice-zh-CN.mp3')
    expect(audioInstances[0].preload).toBe('auto')
    expect(audioInstances[0].volume).toBe(0.96)
    expect(audioInstances[0].play).toHaveBeenCalledOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it('does not create audio while notification sound is disabled', () => {
    expect(playAiNotificationSound({ ...settings('approval-voice'), soundEnabled: false })).toBe(false)
    expect(audioInstances).toHaveLength(0)
  })

  it('keeps custom sound playback independent from the bundled role voice', () => {
    expect(
      playAiNotificationSound({
        ...settings('custom'),
        customSoundUrl: 'file:///tmp/custom-notification.mp3'
      })
    ).toBe(true)
    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].src).toBe('file:///tmp/custom-notification.mp3')
    expect(audioInstances[0].volume).toBe(0.86)
  })
})
