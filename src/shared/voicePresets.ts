import type { VoiceInputPreferences } from './contracts/voice'

export const voiceModelPresets = {
  sensevoice: {
    engine: 'sensevoice', name: 'SenseVoiceSmall INT8', executable: 'sherpa-onnx-offline',
    modelFile: 'model.int8.onnx',
    engineUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases',
    modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    helpUrl: 'https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html'
  },
  whisper: {
    engine: 'whisper', name: 'Whisper small', executable: 'whisper-cli',
    modelFile: 'ggml-small.bin',
    engineUrl: 'https://github.com/ggml-org/whisper.cpp/releases',
    modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    helpUrl: 'https://github.com/ggml-org/whisper.cpp#quick-start'
  }
} as const

export const doubaoSpeechEndpoint = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
export const doubaoSpeechHelpUrl = 'https://www.volcengine.com/docs/6561/1631584'

export const isVoiceInputConfigured = (preferences?: VoiceInputPreferences): boolean => {
  if (!preferences) return false
  if (preferences.mode === 'local') return Boolean(preferences.executablePath.trim() && preferences.modelPath.trim()
    && (preferences.localEngine !== 'sensevoice' || preferences.tokensPath?.trim()))
  try {
    const url = new URL(preferences.endpoint)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && Boolean(preferences.model.trim())
      && (preferences.serviceProvider !== 'doubao' || Boolean(preferences.apiKey?.trim() || preferences.hasApiKey))
  } catch { return false }
}
