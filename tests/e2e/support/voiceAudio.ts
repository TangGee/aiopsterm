import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { encodeVoiceWav } from '../../../src/renderer/src/services/voice/voiceWav'

export const fakeVoiceMicrophoneArgs = async (directory: string) => {
  // Chromium's default test microphone has very short beeps, which speech gating drops.
  const audioFile = path.join(directory, 'microphone.wav')
  const samples = Float32Array.from({ length: 16000 * 10 }, (_, index) => 0.3 * Math.sin(2 * Math.PI * (220 + 40 * Math.sin(index / 800)) * index / 16000))
  await writeFile(audioFile, Buffer.from(encodeVoiceWav([samples], 16000)))
  return ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${audioFile}`]
}
