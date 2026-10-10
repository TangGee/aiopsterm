import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { VoiceInputPreferences, VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

const failure = (errorMessage: string): VoiceTranscriptionResult => ({ ok: false, errorCode: 'VOICE_INPUT_FAILED', errorMessage })

export const validateVoicePreferences = async (preferences: VoiceInputPreferences): Promise<void> => {
  if (preferences.mode === 'local') {
    const paths = [preferences.executablePath, preferences.modelPath]
    if (preferences.localEngine === 'sensevoice') paths.push(preferences.tokensPath || '')
    for (const path of paths) {
      if (!path || !isAbsolute(path) || !(await stat(path)).isFile()) throw new Error('Select the local engine, model and required tokens files in voice settings.')
      await access(path, constants.R_OK)
    }
    if (process.platform !== 'win32') await access(preferences.executablePath, constants.X_OK)
  } else {
    const url = new URL(preferences.endpoint)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !preferences.model.trim()) throw new Error('Set an HTTP or HTTPS transcription URL without embedded credentials and a speech model.')
  }
}

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
    await validateVoicePreferences(preferences)
    if (preferences.mode === 'local') {
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return failure('Local recognition requires WAV audio. Use the global voice button.')
      directory = await mkdtemp(join(tmpdir(), 'aiopsterm-voice-'))
      const audioPath = join(directory, 'input.wav')
      const outputPath = join(directory, 'result')
      await writeFile(audioPath, bytes, { mode: 0o600 })
      const sensevoice = preferences.localEngine === 'sensevoice'
      const args = sensevoice
        ? [`--sense-voice-model=${preferences.modelPath}`, `--tokens=${preferences.tokensPath}`, '--sense-voice-language=auto', '--sense-voice-use-itn=1', '--num-threads=2', audioPath]
        : ['-m', preferences.modelPath, '-f', audioPath, '-l', 'auto', '-otxt', '-of', outputPath, '-np']
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(preferences.executablePath, args, {
          signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true
        }, (error, output) => error ? reject(new Error(error.name === 'AbortError' ? 'Recognition cancelled.' : 'Local recognition failed. Check the executable and model.')) : resolve(output))
      })
      signal.throwIfAborted()
      let text: string
      if (sensevoice) {
        const result = JSON.parse(stdout) as { text?: unknown }
        text = typeof result.text === 'string' ? result.text.replace(/<\|[^|]*\|>/g, '').trim() : ''
      } else text = (await readFile(`${outputPath}.txt`, 'utf8')).trim()
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
