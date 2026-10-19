import { randomUUID } from 'node:crypto'
import { transcribeViaSenseVoiceServer } from './voiceEngineServer'
import { doubaoSpeechEndpoint } from '../../../shared/voicePresets'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { VoiceInputPreferences, VoiceTranscriptionInput, VoiceTranscriptionResult } from '@shared/contracts/voice'

const failure = (errorMessage: string): VoiceTranscriptionResult => ({ ok: false, errorCode: 'VOICE_INPUT_FAILED', errorMessage })
const noSpeech = (): VoiceTranscriptionResult => ({ ok: false, errorCode: 'VOICE_NO_SPEECH', errorMessage: 'No speech was recognized.' })

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
    if (preferences.serviceProvider === 'doubao' && preferences.endpoint !== doubaoSpeechEndpoint) throw new Error('Use the official Doubao speech endpoint.')
    if (preferences.serviceProvider === 'doubao' && !preferences.apiKey?.trim() && !preferences.hasApiKey) throw new Error('Enter the Doubao speech API Key or Access Token.')
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
      const sensevoice = preferences.localEngine === 'sensevoice'
      if (sensevoice) {
        try {
          const text = (await transcribeViaSenseVoiceServer(preferences, bytes, signal)).replace(/<\|[^|]*\|>/g, '').trim()
          return text ? { ok: true, data: { text, provider: 'aiopsterm-local', model: preferences.modelPath } } : noSpeech()
        } catch (error) {
          signal.throwIfAborted()
          // Fall back to the one-shot CLI below when the resident engine is unavailable.
        }
      }
      directory = await mkdtemp(join(tmpdir(), 'aiopsterm-voice-'))
      const audioPath = join(directory, 'input.wav')
      const outputPath = join(directory, 'result')
      await writeFile(audioPath, bytes, { mode: 0o600 })
      const args = sensevoice
        ? [`--sense-voice-model=${preferences.modelPath}`, `--tokens=${preferences.tokensPath}`, '--sense-voice-language=auto', '--sense-voice-use-itn=1', '--num-threads=2', audioPath]
        : ['-m', preferences.modelPath, '-f', audioPath, '-l', 'auto', '-otxt', '-of', outputPath, '-np']
      const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(preferences.executablePath, args, {
          signal, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true
        }, (error, stdout, stderr) => error ? reject(new Error(error.name === 'AbortError' ? 'Recognition cancelled.' : 'Local recognition failed. Check the executable and model.')) : resolve({ stdout, stderr }))
      })
      signal.throwIfAborted()
      let text: string
      if (sensevoice) {
        // The official CLI writes the filename and JSON result to stderr, alongside diagnostics.
        // Some wrappers emit only JSON on stdout; accept both without inserting log text.
        let result: { text?: unknown }
        try { result = JSON.parse(output.stdout.trim()) as { text?: unknown } } catch {
          const stderr = output.stderr.replace(/\r\n/g, '\n')
          const marker = `${audioPath}\n`
          const start = stderr.lastIndexOf(marker)
          const end = stderr.indexOf('\n----', start + marker.length)
          if (start < 0 || end < 0) return failure('The local engine did not return a recognition result.')
          result = JSON.parse(stderr.slice(start + marker.length, end).trim()) as { text?: unknown }
        }
        text = typeof result.text === 'string' ? result.text.replace(/<\|[^|]*\|>/g, '').trim() : ''
      } else text = (await readFile(`${outputPath}.txt`, 'utf8')).trim()
      return text ? { ok: true, data: { text, provider: 'aiopsterm-local', model: preferences.modelPath } } : noSpeech()
    }
    const endpoint = new URL(preferences.endpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) return failure('Use an HTTP or HTTPS transcription endpoint without URL credentials.')
    if (!preferences.model.trim()) return failure('Set a speech recognition model in voice settings.')
    if (preferences.serviceProvider === 'doubao') {
      if (!preferences.apiKey?.trim()) return failure('Enter the Doubao speech API Key or Access Token.')
      const response = await fetch(endpoint, {
        method: 'POST', signal, redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Resource-Id': preferences.model,
          'X-Api-Request-Id': randomUUID(), 'X-Api-Sequence': '-1',
          ...(preferences.doubaoAppId?.trim()
            ? { 'X-Api-App-Key': preferences.doubaoAppId.trim(), 'X-Api-Access-Key': preferences.apiKey }
            : { 'X-Api-Key': preferences.apiKey })
        },
        body: JSON.stringify({ user: { uid: 'aiopsterm' }, audio: { data: bytes.toString('base64') }, request: { model_name: 'bigmodel' } })
      })
      if (!response.ok) return failure(`Doubao speech returned HTTP ${response.status}. Check speech service credentials and quota.`)
      const code = response.headers.get('X-Api-Status-Code')
      if (code === '20000003') return noSpeech()
      if (code !== '20000000') return failure(`Doubao speech failed (${code || 'missing status'}). Check credentials and the volc.bigasr.auc_turbo resource in the speech console.`)
      const payload = await response.json() as { result?: { text?: unknown } }
      const text = typeof payload.result?.text === 'string' ? payload.result.text.trim() : ''
      return text ? { ok: true, data: { text, provider: 'doubao', model: preferences.model } } : noSpeech()
    }
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
    return text ? { ok: true, data: { text, provider: 'openai', model: preferences.model } } : noSpeech()
  } catch (error) {
    return failure(signal.aborted ? 'Recognition cancelled or timed out.' : error instanceof Error ? error.message : String(error))
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
