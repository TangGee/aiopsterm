export const encodeVoiceWav = (channels: Float32Array[], sampleRate: number): ArrayBuffer => {
  const length = channels[0]?.length || 0
  const output = new ArrayBuffer(44 + length * 2)
  const view = new DataView(output)
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true)
  for (let index = 0; index < length; index++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[index], 0) / channels.length))
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return output
}

export const voiceBlobToWav = async (blob: Blob) => {
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000)
    const source = offline.createBufferSource()
    source.buffer = audio
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodeVoiceWav([rendered.getChannelData(0)], 16000)
  } finally {
    await context.close()
  }
}

