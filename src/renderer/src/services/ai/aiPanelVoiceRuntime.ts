import { computed, ref } from 'vue'
import {
  aiPanelVoiceRecordingLimitMs,
  bestVoiceMimeType as bestAiPanelVoiceMimeType,
  prepareVoiceTranscriptionCompletion,
  prepareVoiceTranscriptionInputFromBlob,
  voiceRecordingStartFailureMessage,
  voiceTextFromTranscriptionResult
} from '@/services/ai/aiPanelMediaRuntime'
import { voiceClient } from '@/services/ai/voiceClient'
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

type AiPanelVoiceTranscriber = (input: VoiceTranscriptionInput) => Promise<VoiceTranscriptionResult>

export type AiPanelVoiceRuntimeOptions = {
  streaming: () => boolean
  draft: () => string
  closePopups: () => void
  restoreSelection: () => void
  insertTranscription: (text: string) => void | Promise<void>
  afterInsert?: () => void | Promise<void>
  sendAfterTranscription: () => void | Promise<void>
  notify: (message: string) => void
  transcribeVoiceInput?: () => AiPanelVoiceTranscriber | undefined
  getMediaRecorder?: () => typeof MediaRecorder | undefined
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  now?: () => number
  setTimeout?: typeof window.setTimeout
  clearTimeout?: typeof window.clearTimeout
  createBlob?: (chunks: BlobPart[], options?: BlobPropertyBag) => Blob
}

const defaultMediaRecorder = () => (typeof MediaRecorder === 'undefined' ? undefined : MediaRecorder)

const defaultGetUserMedia = (constraints: MediaStreamConstraints) => {
  const getUserMedia = navigator.mediaDevices?.getUserMedia
  if (!getUserMedia) return Promise.reject(new Error('Browser voice recording is unavailable.'))
  return getUserMedia.call(navigator.mediaDevices, constraints)
}

export const createAiPanelVoiceRuntime = (options: AiPanelVoiceRuntimeOptions) => {
  const voiceRecording = ref(false)
  const voiceTranscribing = ref(false)
  const voiceRecordingStartedAt = ref(0)
  const voiceAutoSendAfterInput = ref(false)
  const voiceMediaRecorder = ref<MediaRecorder | null>(null)
  const voiceMediaStream = ref<MediaStream | null>(null)
  const voiceAudioChunks = ref<Blob[]>([])
  const voiceRecordingMimeType = ref('')
  let voiceRecordingLimitTimer: number | undefined

  const now = () => options.now?.() ?? Date.now()
  const setRuntimeTimeout = options.setTimeout ?? window.setTimeout.bind(window)
  const clearRuntimeTimeout = options.clearTimeout ?? window.clearTimeout.bind(window)
  const createBlob = options.createBlob ?? ((chunks, blobOptions) => new Blob(chunks, blobOptions))
  const transcribeVoiceInput = options.transcribeVoiceInput ?? voiceClient.transcribeVoiceInput
  const getMediaRecorder = options.getMediaRecorder ?? defaultMediaRecorder
  const getUserMedia = options.getUserMedia ?? defaultGetUserMedia

  const voiceButtonTitle = computed(() => {
    if (voiceRecording.value) return '停止语音录制'
    if (voiceTranscribing.value) return '语音转写中'
    return '开始语音输入'
  })

  const clearVoiceTimers = () => {
    if (voiceRecordingLimitTimer) {
      clearRuntimeTimeout(voiceRecordingLimitTimer)
      voiceRecordingLimitTimer = undefined
    }
  }

  const clearVoiceMedia = () => {
    const recorder = voiceMediaRecorder.value
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
    }
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Recorder can already be inactive while the stop event is queued.
      }
    }
    voiceMediaRecorder.value = null
    voiceMediaStream.value?.getTracks().forEach((track) => track.stop())
    voiceMediaStream.value = null
    voiceAudioChunks.value = []
    voiceRecordingMimeType.value = ''
  }

  const bestVoiceMimeType = () => {
    const recorder = getMediaRecorder()
    if (!recorder) return ''
    return bestAiPanelVoiceMimeType((format) => recorder.isTypeSupported(format))
  }

  const canUseBrowserVoiceRecorder = () => Boolean(getMediaRecorder() && getUserMedia)

  const handleVoiceTranscriptionComplete = async (text: string) => {
    const completion = prepareVoiceTranscriptionCompletion(text, options.draft(), voiceAutoSendAfterInput.value)
    if (!completion.ok) {
      options.notify(completion.message)
      return
    }
    await options.insertTranscription(completion.data.insertionText)
    options.notify(completion.data.notice)
    if (completion.data.autoSend) {
      await options.afterInsert?.()
      await options.sendAfterTranscription()
    }
  }

  const transcribeVoice = async (input: VoiceTranscriptionInput) => {
    const transcribe = transcribeVoiceInput()
    if (typeof transcribe !== 'function') {
      options.notify('语音识别失败：语音识别服务不可用')
      return
    }
    voiceTranscribing.value = true
    try {
      const result = await transcribe(input)
      const text = voiceTextFromTranscriptionResult(result)
      if (!text.ok) {
        options.notify(`语音识别失败：${text.message}`)
        return
      }
      await handleVoiceTranscriptionComplete(text.data)
    } catch (error) {
      options.notify(`语音识别失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      voiceTranscribing.value = false
    }
  }

  const processVoiceRecording = async (elapsed: number, processOptions: { reachedLimit?: boolean; audioBlob?: Blob } = {}) => {
    const transcriptionInput = await prepareVoiceTranscriptionInputFromBlob(elapsed, processOptions)
    if (!transcriptionInput.ok) {
      options.notify(transcriptionInput.message)
      return
    }
    await transcribeVoice(transcriptionInput.data)
  }

  const scheduleVoiceRecordingLimit = () => {
    voiceRecordingStartedAt.value = now()
    voiceRecording.value = true
    voiceRecordingLimitTimer = setRuntimeTimeout(() => {
      if (!voiceRecording.value) return
      options.notify('录制时间到达上限，已自动停止录制。')
      void finishVoiceRecording({ reachedLimit: true })
    }, aiPanelVoiceRecordingLimitMs)
  }

  const startBrowserVoiceRecorder = async () => {
    const Recorder = getMediaRecorder()
    if (!canUseBrowserVoiceRecorder() || !Recorder) {
      throw new Error('Browser voice recording is unavailable.')
    }
    const stream = await getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    })
    const mimeType = bestVoiceMimeType()
    const recorder = new Recorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128000
    })

    voiceMediaStream.value = stream
    voiceMediaRecorder.value = recorder
    voiceRecordingMimeType.value = mimeType
    voiceAudioChunks.value = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) voiceAudioChunks.value.push(event.data)
    }
    recorder.onerror = () => {
      voiceRecording.value = false
      clearVoiceTimers()
      clearVoiceMedia()
      options.notify('语音录制失败。')
    }
    recorder.onstop = () => {
      const elapsed = now() - voiceRecordingStartedAt.value
      const audioBlob = createBlob(voiceAudioChunks.value, { type: voiceRecordingMimeType.value || 'audio/webm' })
      clearVoiceMedia()
      void processVoiceRecording(elapsed, { audioBlob })
    }
    recorder.start(100)
    scheduleVoiceRecordingLimit()
  }

  const startVoiceRecording = async () => {
    if (options.streaming() || voiceRecording.value || voiceTranscribing.value) return
    options.closePopups()
    options.restoreSelection()
    try {
      await startBrowserVoiceRecorder()
    } catch (error) {
      options.notify(voiceRecordingStartFailureMessage(error))
      clearVoiceMedia()
    }
  }

  const finishVoiceRecording = async (finishOptions: { reachedLimit?: boolean } = {}) => {
    if (!voiceRecording.value) return
    const elapsed = now() - voiceRecordingStartedAt.value
    voiceRecording.value = false
    clearVoiceTimers()
    const recorder = voiceMediaRecorder.value
    if (recorder) {
      if (recorder.state !== 'inactive') recorder.stop()
      return
    }
    await processVoiceRecording(elapsed, finishOptions)
  }

  const toggleVoiceInput = () => {
    if (options.streaming() || voiceTranscribing.value) return
    if (voiceRecording.value) {
      void finishVoiceRecording()
      return
    }
    void startVoiceRecording()
  }

  const dispose = () => {
    voiceRecording.value = false
    clearVoiceTimers()
    clearVoiceMedia()
  }

  return {
    voiceRecording,
    voiceTranscribing,
    voiceAutoSendAfterInput,
    voiceButtonTitle,
    toggleVoiceInput,
    startVoiceRecording,
    finishVoiceRecording,
    clearVoiceTimers,
    clearVoiceMedia,
    dispose
  }
}
