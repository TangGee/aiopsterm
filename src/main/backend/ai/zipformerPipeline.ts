import type { VoiceInputPreferences, VoiceStreamResult } from '@shared/contracts/voice'

export type SherpaStream = { acceptWaveform: (audio: { samples: Float32Array; sampleRate: number }) => void; inputFinished: () => void }
export type SherpaRecognizer = {
  createStream: () => SherpaStream; isReady: (stream: SherpaStream) => boolean
  decode: (stream: SherpaStream) => void; getResult: (stream: SherpaStream) => { text: string }
  isEndpoint: (stream: SherpaStream) => boolean; reset: (stream: SherpaStream) => void
}
export type SherpaModule = {
  version: string | (() => string)
  OnlineRecognizer: new (config: unknown) => SherpaRecognizer
  OfflinePunctuation: new (config: unknown) => { addPunct: (text: string) => string }
}
const append = (left: string, right: string) => left + (/[a-z0-9]$/i.test(left) && /^[a-z0-9]/i.test(right) ? ' ' : '') + right
const words = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, '')

export const createZipformerPipeline = (sherpa: SherpaModule, preferences: VoiceInputPreferences) => {
  const version = typeof sherpa.version === 'function' ? sherpa.version() : sherpa.version
  if (version !== '1.12.40') throw new Error(`Expected sherpa-onnx 1.12.40, received ${version}. Reinstall the voice engine.`)
  const recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: preferences.modelPath, decoder: preferences.decoderPath, joiner: preferences.joinerPath },
      tokens: preferences.tokensPath, provider: 'cpu', numThreads: 2, debug: false
    },
    decodingMethod: 'greedy_search', enableEndpoint: true,
    rule1MinTrailingSilence: 8, rule2MinTrailingSilence: 1.5, rule3MinUtteranceLength: 60
  })
  const punctuation = new sherpa.OfflinePunctuation({
    model: { ctTransformer: preferences.punctuationPath, provider: 'cpu', numThreads: 2, debug: false }
  })
  const streams = new Map<string, { stream: SherpaStream; text: string; count: number; sequence: number }>()
  const decode = (stream: SherpaStream) => { while (recognizer.isReady(stream)) recognizer.decode(stream) }
  return {
    start(id: string) {
      if (streams.size >= 4 || streams.has(id)) throw new Error('Too many active voice recordings.')
      streams.set(id, { stream: recognizer.createStream(), text: '', count: 0, sequence: 0 })
    },
    push(id: string, samples: Float32Array, sequence: number): VoiceStreamResult {
      const current = streams.get(id)
      if (!current || sequence !== current.sequence++) throw new Error('Voice recording is no longer active or audio arrived out of order.')
      if (!(samples instanceof Float32Array) || !samples.length || samples.length > 16000 || samples.some(value => !Number.isFinite(value) || Math.abs(value) > 2)) throw new Error('Invalid voice PCM frame.')
      current.count += samples.length
      if (current.count > 16000 * 65) { streams.delete(id); throw new Error('Voice recording exceeded 60 seconds.') }
      current.stream.acceptWaveform({ samples, sampleRate: 16000 })
      decode(current.stream)
      const text = recognizer.getResult(current.stream).text.trim()
      const result = append(current.text, text)
      const endpoint = recognizer.isEndpoint(current.stream)
      if (endpoint) {
        current.text = result
        recognizer.reset(current.stream)
      }
      return { text: result, final: false, ...(endpoint ? { endpoint: true } : {}) }
    },
    finish(id: string): VoiceStreamResult {
      const current = streams.get(id)
      if (!current) throw new Error('Voice recording is no longer active.')
      streams.delete(id)
      current.stream.acceptWaveform({ samples: new Float32Array(16000 * 0.8), sampleRate: 16000 })
      current.stream.inputFinished()
      decode(current.stream)
      const raw = append(current.text, recognizer.getResult(current.stream).text.trim())
      if (!raw) return { text: '', final: true }
      try {
        const text = punctuation.addPunct(raw).trim()
        if (words(text) !== words(raw)) throw new Error('Punctuation changed recognized words.')
        return { text, final: true }
      } catch {
        return { text: raw, final: true, warning: 'Punctuation could not be applied. The original recognized text was preserved.' }
      }
    },
    cancel(id: string) { streams.delete(id) }
  }
}
