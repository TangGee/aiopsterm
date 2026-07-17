import type { NotificationSoundPreset, NotificationUserConfig } from '@shared/contracts/appRuntime'
import { isSupportedLocale } from '@/i18n/runtime'
import { translateStaticText } from '@/i18n/staticText'
import type { SupportedLocale } from '@/i18n/messages'

export type NotificationSoundContext = {
  title?: string
  summary?: string
}

type AudioContextConstructor = typeof AudioContext

const approvalVoiceText = '启禀殿下，AI需要你审批了'

// 通知声音属于独立 runtime,不依赖 store;locale 以 applyDocumentLocale 写入的 document lang 为准。
const documentLocale = (): SupportedLocale => {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang
  return isSupportedLocale(lang) ? lang : 'zh-CN'
}

const audioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext || null
}

const playToneSequence = (frequencies: number[], durationMs = 90, gapMs = 28) => {
  const AudioContextImpl = audioContextConstructor()
  if (!AudioContextImpl) return false
  try {
    const context = new AudioContextImpl()
    if (context.state === 'suspended') void context.resume()
    const startAt = context.currentTime + 0.01
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const toneStart = startAt + (index * (durationMs + gapMs)) / 1000
      const toneEnd = toneStart + durationMs / 1000
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, toneStart)
      gain.gain.setValueAtTime(0.0001, toneStart)
      gain.gain.exponentialRampToValueAtTime(0.12, toneStart + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(toneStart)
      oscillator.stop(toneEnd + 0.02)
    })
    const closeAfter = startAt + (frequencies.length * (durationMs + gapMs) + 80) / 1000
    window.setTimeout(() => {
      void context.close().catch(() => undefined)
    }, Math.max(80, Math.ceil((closeAfter - context.currentTime) * 1000)))
    return true
  } catch {
    return false
  }
}

const playCustomSound = (url: string) => {
  if (!url || typeof Audio === 'undefined') return false
  try {
    const audio = new Audio(url)
    audio.preload = 'auto'
    audio.volume = 0.86
    void audio.play().catch(() => undefined)
    return true
  } catch {
    return false
  }
}

const speakApprovalVoice = () => {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false
  try {
    const locale = documentLocale()
    const utterance = new SpeechSynthesisUtterance(translateStaticText(locale, approvalVoiceText))
    utterance.lang = locale.startsWith('zh') ? locale : 'en-US'
    utterance.rate = 1.02
    utterance.pitch = 1.03
    utterance.volume = 0.96
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    return false
  }
}

const playBuiltInPreset = (preset: NotificationSoundPreset) => {
  if (preset === 'soft-ding') return playToneSequence([523, 659], 120, 42)
  if (preset === 'approval-voice') {
    const tonePlayed = playToneSequence([659, 784, 988], 72, 24)
    const voicePlayed = speakApprovalVoice()
    return tonePlayed || voicePlayed
  }
  return playToneSequence([880, 1175], 86, 28)
}

export const playAiNotificationSound = (settings: NotificationUserConfig, _context: NotificationSoundContext = {}) => {
  if (!settings.soundEnabled) return false
  if (settings.soundPreset === 'custom') {
    return playCustomSound(settings.customSoundUrl || settings.customSoundPath) || playBuiltInPreset('chime')
  }
  return playBuiltInPreset(settings.soundPreset)
}

export const notificationSoundPreviewContext = (): NotificationSoundContext => ({
  title: translateStaticText(documentLocale(), 'AI需要你审批了'),
  summary: translateStaticText(documentLocale(), approvalVoiceText)
})
