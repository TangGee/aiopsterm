export type VoicePcmCapture = { stop: () => Promise<void> }
export type VoicePcmFactory = (stream: MediaStream, onSamples: (samples: Float32Array) => void) => Promise<VoicePcmCapture>

// Send independent PCM frames: compressed MediaRecorder fragments cannot be decoded independently.
const processorSource = `
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.stopped = false
    this.port.onmessage = () => {
      this.stopped = true
      this.port.postMessage('stopped')
    }
  }
  process(inputs) {
    if (this.stopped) return false
    const channels = inputs[0]
    if (channels && channels.length) {
      const samples = new Float32Array(channels[0].length)
      for (const channel of channels) {
        for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / channels.length
      }
      this.port.postMessage(samples, [samples.buffer])
    }
    return true
  }
}
registerProcessor('voice-capture', VoiceCapture)
`

export const createVoicePcmCapture: VoicePcmFactory = async (stream, onSamples) => {
  const context = new AudioContext({ sampleRate: 16000 })
  const url = URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, 'voice-capture')
    let finish: (() => void) | undefined
    node.port.onmessage = ({ data }) => {
      if (data === 'stopped') finish?.()
      else if (data instanceof Float32Array) onSamples(data)
    }
    source.connect(node)
    node.connect(context.destination)
    await context.resume()
    let stopping: Promise<void> | undefined
    return {
      stop() {
        stopping ??= (async () => {
          try {
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Audio capture did not stop.')), 1500)
              finish = () => { clearTimeout(timeout); resolve() }
              node.port.postMessage('stop')
            })
          } finally {
            node.port.onmessage = null
            node.port.close()
            source.disconnect()
            node.disconnect()
            await context.close()
          }
        })()
        return stopping
      }
    }
  } catch (error) {
    await context.close()
    throw error
  } finally {
    URL.revokeObjectURL(url)
  }
}
