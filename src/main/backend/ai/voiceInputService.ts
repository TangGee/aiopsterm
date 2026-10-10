import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { VoiceInputPreferences, VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

const failure = (errorMessage: string): VoiceTranscriptionResult => ({ ok: false, errorCode: 'VOICE_INPUT_FAILED', errorMessage })

export const transcribeGlobalVoice = async (
  input: VoiceTranscriptionInput,
  preferences: VoiceInputPreferences,
  signal: AbortSignal
): Promise<VoiceTranscriptionResult> => {
  let directory = ''
  try {
    const bytes = input.audioBytes ? Buffer.from(new Uint8Array(input.audioBytes as ArrayBuffer)) : Buffer.from(input.audioData || '', 'base64')
    if (bytes.length < 1024 || bytes.length > 50 * 1024 * 1024) return failure('Audio must be between 1 KiB and 50 MiB.')
    signal.throwIfAborted()
    if (preferences.mode === 'local') {
      if (!isAbsolute(preferences.executablePath) || !isAbsolute(preferences.modelPath)) return failure('Select the local whisper-cli executable and model in voice settings.')
      if (!(await stat(preferences.executablePath)).isFile() || !(await stat(preferences.modelPath)).isFile()) return failure('The executable or model is not a file.')
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return failure('Local recognition requires WAV audio. Use the global voice button.')
      directory = await mkdtemp(join(tmpdir(), 'aiopsterm-voice-'))
      const audioPath = join(directory, 'input.wav')
      const outputPath = join(directory, 'result')
      await writeFile(audioPath, bytes, { mode: 0o600 })
      await new Promise<void>((resolve, reject) => {
        execFile(preferences.executablePath, ['-m', preferences.modelPath, '-f', audioPath, '-l', 'auto', '-otxt', '-of', outputPath, '-np'], {
          signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true
        }, (error) => error ? reject(new Error(error.name === 'AbortError' ? 'Recognition cancelled.' : 'Local recognition failed. Check the executable and model.')) : resolve())
      })
      signal.throwIfAborted()
      const text = (await readFile(`${outputPath}.txt`, 'utf8')).trim()
      return text ? { ok: true, data: { text, provider: 'aiopsterm-local', model: preferences.modelPath } } : failure('No speech was recognized.')
    }
    const endpoint = new URL(preferences.endpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) return failure('Use an HTTP or HTTPS transcription endpoint without URL credentials.')
    if (!preferences.model.trim()) return failure('Set a speech recognition model in voice settings.')
    const form = new FormData()
    form.append('model', preferences.model.trim())
    form.append('response_format', 'json')
    const isWav = bytes.toString('ascii', 0, 4) === 'RIFF'
    const format = isWav ? 'wav' : input.audioFormat?.includes('ogg') ? 'ogg' : 'webm'
    form.append('file', new Blob([bytes], { type: `audio/${format}` }), `voice.${format}`)
    const response = await fetch(endpoint, {
      method: 'POST', body: form, signal,
      headers: preferences.apiKey ? { Authorization: `Bearer ${preferences.apiKey}` } : {},
      redirect: 'error'
    })
    if (!response.ok) return failure(`Speech service returned HTTP ${response.status}.`)
    const payload = await response.json() as { text?: unknown }
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    return text ? { ok: true, data: { text, provider: 'openai', model: preferences.model } } : failure('No speech was recognized.')
  } catch (error) {
    return failure(signal.aborted ? 'Recognition cancelled or timed out.' : error instanceof Error ? error.message : String(error))
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
