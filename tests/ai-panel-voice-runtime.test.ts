import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAiPanelVoiceRuntime } from '@/services/ai/aiPanelVoiceRuntime'
import type { VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

type MockRecorderInstance = {
  state: RecordingState
  stream: MediaStream
  options: MediaRecorderOptions
  ondataavailable: ((event: BlobEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onstop: ((event: Event) => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  emitData: (data: Blob) => void
  emitError: () => void
}

const createRecorderClass = () => {
  const instances: MockRecorderInstance[] = []
  class MockMediaRecorder {
    static isTypeSupported = vi.fn((format: string) => format === 'audio/webm')
    state: RecordingState = 'inactive'
    ondataavailable: ((event: BlobEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onstop: ((event: Event) => void) | null = null
    start = vi.fn(() => {
      this.state = 'recording'
    })
    stop = vi.fn(() => {
      if (this.state === 'inactive') return
      this.state = 'inactive'
      this.onstop?.(new Event('stop'))
    })
    constructor(
      public stream: MediaStream,
      public options: MediaRecorderOptions
    ) {
      instances.push(this)
    }
    emitData(data: Blob) {
      this.ondataavailable?.({ data } as BlobEvent)
    }
    emitError() {
      this.onerror?.(new Event('error'))
    }
  }
  return {
    Recorder: MockMediaRecorder as unknown as typeof MediaRecorder,
    instances
  }
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('aiPanelVoiceRuntime', () => {
  it('records browser audio, transcribes it, inserts the transcript, and resets recording state', async () => {
    const { Recorder, instances } = createRecorderClass()
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream)
    const transcribe = vi.fn(async (_input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> => ({
      ok: true,
      data: { text: 'diagnose service', provider: 'aiopsterm-local' }
    }))
    const inserted: string[] = []
    const notices: string[] = []
    let now = 1_000

    const runtime = createAiPanelVoiceRuntime({
      streaming: () => false,
      draft: () => 'check',
      closePopups: vi.fn(),
      restoreSelection: vi.fn(),
      insertTranscription: (text) => {
        inserted.push(text)
      },
      sendAfterTranscription: vi.fn(),
      notify: (message) => notices.push(message),
      transcribeVoiceInput: () => transcribe,
      getMediaRecorder: () => Recorder,
      getUserMedia,
      now: () => now,
      setTimeout: vi.fn(() => 12 as unknown as number) as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
      createBlob: (_chunks, options) => ({
        size: 4096,
        type: options?.type || 'audio/webm',
        arrayBuffer: async () => new ArrayBuffer(4096)
      }) as Blob
    })

    await runtime.startVoiceRecording()
    expect(runtime.voiceRecording.value).toBe(true)
    expect(runtime.voiceButtonTitle.value).toBe('停止语音录制')
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    })
    expect(instances).toHaveLength(1)
    expect(instances[0].options).toMatchObject({ mimeType: 'audio/webm', audioBitsPerSecond: 128000 })

    instances[0].emitData(new Blob([new Uint8Array(4096)], { type: 'audio/webm' }))
    now = 1_420
    await runtime.finishVoiceRecording()
    await flushMicrotasks()

    expect(runtime.voiceRecording.value).toBe(false)
    await vi.waitFor(() => expect(runtime.voiceTranscribing.value).toBe(false))
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'browser',
        durationMs: 420,
        audioFormat: 'audio/webm',
        audioSize: 4096,
        audioBytes: expect.any(ArrayBuffer)
      })
    )
    expect(inserted).toEqual([' diagnose service'])
    expect(notices.at(-1)).toBe('语音转写完成：diagnose service')
    expect(stopTrack).toHaveBeenCalled()
    expect(runtime.voiceButtonTitle.value).toBe('开始语音输入')
  })

  it('fails closed when recording or transcription services are unavailable', async () => {
    const notices: string[] = []
    const runtime = createAiPanelVoiceRuntime({
      streaming: () => false,
      draft: () => '',
      closePopups: vi.fn(),
      restoreSelection: vi.fn(),
      insertTranscription: vi.fn(),
      sendAfterTranscription: vi.fn(),
      notify: (message) => notices.push(message),
      transcribeVoiceInput: () => undefined,
      getMediaRecorder: () => undefined
    })

    await runtime.startVoiceRecording()
    expect(runtime.voiceRecording.value).toBe(false)
    expect(notices.at(-1)).toContain('麦克风不可用')

    const { Recorder, instances } = createRecorderClass()
    let now = 2_000
    const serviceMissingRuntime = createAiPanelVoiceRuntime({
      streaming: () => false,
      draft: () => '',
      closePopups: vi.fn(),
      restoreSelection: vi.fn(),
      insertTranscription: vi.fn(),
      sendAfterTranscription: vi.fn(),
      notify: (message) => notices.push(message),
      transcribeVoiceInput: () => undefined,
      getMediaRecorder: () => Recorder,
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
      now: () => now,
      setTimeout: vi.fn(() => 21 as unknown as number) as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
      createBlob: (_chunks, options) => ({
        size: 2048,
        type: options?.type || 'audio/webm',
        arrayBuffer: async () => new ArrayBuffer(2048)
      }) as Blob
    })

    await serviceMissingRuntime.startVoiceRecording()
    now = 2_300
    await serviceMissingRuntime.finishVoiceRecording()
    await flushMicrotasks()
    expect(instances).toHaveLength(1)
    expect(notices.at(-1)).toBe('语音识别失败：语音识别服务不可用')
    expect(serviceMissingRuntime.voiceTranscribing.value).toBe(false)
  })

  it('honors recording limit, recorder errors, auto-send, and dispose cleanup', async () => {
    const { Recorder, instances } = createRecorderClass()
    const notices: string[] = []
    const sendAfterTranscription = vi.fn()
    const clearTimeout = vi.fn()
    let timer: (() => void) | undefined
    let now = 5_000
    const runtime = createAiPanelVoiceRuntime({
      streaming: () => false,
      draft: () => 'ready ',
      closePopups: vi.fn(),
      restoreSelection: vi.fn(),
      insertTranscription: vi.fn(),
      afterInsert: vi.fn(),
      sendAfterTranscription,
      notify: (message) => notices.push(message),
      transcribeVoiceInput: () =>
        vi.fn(async (): Promise<VoiceTranscriptionResult> => ({ ok: true, data: { text: 'ship it', provider: 'aiopsterm-local' } })),
      getMediaRecorder: () => Recorder,
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream),
      now: () => now,
      setTimeout: vi.fn((callback) => {
        timer = callback as () => void
        return 44 as unknown as number
      }) as unknown as typeof window.setTimeout,
      clearTimeout,
      createBlob: (_chunks, options) => ({
        size: 4096,
        type: options?.type || 'audio/webm',
        arrayBuffer: async () => new ArrayBuffer(4096)
      }) as Blob
    })
    runtime.voiceAutoSendAfterInput.value = true

    await runtime.startVoiceRecording()
    expect(runtime.voiceRecording.value).toBe(true)
    now = 65_000
    timer?.()
    await flushMicrotasks()
    expect(notices).toContain('录制时间到达上限，已自动停止录制。')
    await vi.waitFor(() => expect(sendAfterTranscription).toHaveBeenCalled())
    expect(clearTimeout).toHaveBeenCalledWith(44)

    await runtime.startVoiceRecording()
    instances.at(-1)?.emitError()
    expect(runtime.voiceRecording.value).toBe(false)
    expect(notices.at(-1)).toBe('语音录制失败。')

    await runtime.startVoiceRecording()
    const activeRecorder = instances.at(-1)
    expect(activeRecorder?.state).toBe('recording')
    runtime.dispose()
    expect(runtime.voiceRecording.value).toBe(false)
    expect(activeRecorder?.stop).toHaveBeenCalled()
  })
})
