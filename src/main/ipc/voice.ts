import { app, BrowserWindow, globalShortcut, safeStorage, net, session, type IpcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { installVoiceModel, voiceInstallEnvironment } from '../backend/ai/voiceModelInstaller'
import Store from 'electron-store'
import { transcribeGlobalVoice, validateVoicePreferences } from '../backend/ai/voiceInputService'
import { shutdownVoiceEngineServer } from '../backend/ai/voiceEngineServer'
import type { VoiceInputPreferences, VoiceInputStatus, VoiceInstallProgress, VoiceTranscriptionInput } from '@shared/contracts/voice'
import { createVoiceInstallLog, voiceInstallError } from '../backend/ai/voiceInstallDiagnostics'
import { preloadZipformer, shutdownZipformerRuntime, startZipformerStream, pushZipformerStream, finishZipformerStream, cancelZipformerStream } from '../backend/ai/zipformerRuntime'
import { logRuntimeEvent } from '../backend/app/runtimeLog'
import type { VoiceStreamChunk } from '@shared/contracts/voice'

export const registerVoiceIpc = (ipcMain: IpcMain) => {
  const store = new Store<{ preferences: VoiceInputPreferences; encryptedKey?: string; previousSenseVoice?: VoiceInputPreferences }>({
    name: 'voice-input',
    defaults: { preferences: { mode: 'local', localEngine: 'zipformer', tokensPath: '', endpoint: '', model: '', executablePath: '', modelPath: '', shortcut: 'CommandOrControl+Alt+R', headsetEnabled: false } }
  })
  const saved = store.get('preferences')
  if (saved.localEngine === 'sensevoice') {
    store.set('previousSenseVoice', saved)
    store.set('preferences', { ...saved, localEngine: 'zipformer', executablePath: '', modelPath: '', tokensPath: '', decoderPath: '', joinerPath: '', punctuationPath: '' })
  }
  const streams = new Map<string, { owner: number; timer: ReturnType<typeof setTimeout> }>()
  const dropStream = (id: string) => {
    const current = streams.get(id)
    if (current) clearTimeout(current.timer)
    streams.delete(id)
    void cancelZipformerStream(id).catch(() => undefined)
  }
  let warmed = ''
  const requests = new Map<string, AbortController>()
  let installation: VoiceInstallProgress = { phase: 'idle', received: 0, total: 0 }
  let installer: AbortController | undefined
  let installerOwner: number | undefined
  let keyboard = ''
  let headsetRegistered = false
  let owner: Electron.WebContents | undefined
  const preferences = () => ({ showFloatingButton: true, ...store.get('preferences') })
  const warm = () => {
    const value = preferences()
    if (value.mode !== 'local' || value.localEngine !== 'zipformer' || !value.executablePath || !value.punctuationPath) return
    const identity = JSON.stringify(value)
    if (warmed === identity || installer) return
    warmed = identity
    void preloadZipformer(value).catch(error => logRuntimeEvent('warn', 'voice.runtime.preload-failed', { error: voiceInstallError(error) }))
  }
  const readKey = () => {
    const encrypted = store.get('encryptedKey')
    if (!encrypted) return ''
    try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { return '' }
  }
  const status = (): VoiceInputStatus => ({
    installation, environment: voiceInstallEnvironment(),
    preferences: { ...preferences(), hasApiKey: Boolean(store.get('encryptedKey')) },
    shortcutRegistered: Boolean(keyboard && globalShortcut.isRegistered(keyboard)),
    headsetRegistered
  })
  const publish = () => { if (owner && !owner.isDestroyed()) owner.send('voice:status-changed', status()) }
  const emit = (source: 'shortcut' | 'headset') => {
    if (!owner || owner.isDestroyed()) return
    const window = BrowserWindow.fromWebContents(owner)
    const background = !window?.isFocused()
    owner.send('voice:trigger', { source, background })
    if (background) { window?.show(); window?.focus() }
  }
  const unbind = () => {
    if (keyboard) globalShortcut.unregister(keyboard)
    if (headsetRegistered) globalShortcut.unregister('MediaPlayPause')
    keyboard = ''
    headsetRegistered = false
  }
  const bind = () => {
    unbind()
    const config = preferences()
    try { if (config.shortcut && globalShortcut.register(config.shortcut, () => emit('shortcut'))) keyboard = config.shortcut } catch { /* Registration status is returned to the UI. */ }
    try { if (config.headsetEnabled) headsetRegistered = globalShortcut.register('MediaPlayPause', () => emit('headset')) } catch { /* Some systems do not expose headset media keys. */ }
  }
  ipcMain.handle('voice:status', (event) => {
    if (owner !== event.sender) {
      owner = event.sender
      const sender = event.sender
      owner.once('destroyed', () => {
        if (owner === sender) { unbind(); owner = undefined }
        for (const [id, request] of requests) {
          if (id.startsWith(`${sender.id}:`)) { request.abort(); requests.delete(id) }
        }
        for (const [id, stream] of streams) if (stream.owner === sender.id) dropStream(id)
      })
      bind()
    }
    warm()
    return status()
  })
  ipcMain.handle('voice:preferences', (_event, input: Partial<VoiceInputPreferences>) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid voice preferences.')
    const previous = preferences()
    const next = { ...previous }
    for (const key of ['endpoint', 'model', 'doubaoAppId', 'executablePath', 'modelPath', 'tokensPath', 'decoderPath', 'joinerPath', 'punctuationPath', 'shortcut'] as const) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'string' || input[key].length > 4096) throw new Error('Invalid voice preference.')
        next[key] = input[key].trim()
      }
    }
    if (input.serviceProvider === 'compatible' || input.serviceProvider === 'doubao') next.serviceProvider = input.serviceProvider
    if (input.localEngine === 'whisper' || input.localEngine === 'zipformer') next.localEngine = input.localEngine
    if (input.mode === 'local' || input.mode === 'service') next.mode = input.mode
    if (typeof input.headsetEnabled === 'boolean') next.headsetEnabled = input.headsetEnabled
    if (typeof input.showFloatingButton === 'boolean') next.showFloatingButton = input.showFloatingButton
    if (input.position && Number.isFinite(input.position.right) && Number.isFinite(input.position.bottom)) next.position = { right: Math.max(8, input.position.right), bottom: Math.max(8, input.position.bottom) }
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string') throw new Error('Invalid API key.')
      if (input.apiKey) {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('System credential encryption is unavailable.')
        store.set('encryptedKey', safeStorage.encryptString(input.apiKey).toString('base64'))
      } else store.delete('encryptedKey')
    }
    if (input.apiKey === undefined && (previous.endpoint !== next.endpoint || (previous.serviceProvider || 'compatible') !== (next.serviceProvider || 'compatible'))) store.delete('encryptedKey')
    store.set('preferences', next)
    // Keep the resident engine in sync with the engine/model it was started with.
    if (['mode', 'localEngine', 'executablePath', 'modelPath', 'tokensPath', 'decoderPath', 'joinerPath', 'punctuationPath'].some(field => previous[field as keyof VoiceInputPreferences] !== next[field as keyof VoiceInputPreferences])) {
      shutdownVoiceEngineServer(); void shutdownZipformerRuntime(); warmed = ''
      for (const stream of streams.values()) clearTimeout(stream.timer)
      streams.clear(); warm()
    }
    if (previous.shortcut !== next.shortcut || previous.headsetEnabled !== next.headsetEnabled) bind()
    const value = status()
    if (owner && !owner.isDestroyed()) owner.send('voice:status-changed', value)
    return value
  })
  ipcMain.handle('voice:install', (event) => {
    if (installer) return status()
    const controller = new AbortController()
    installer = controller
    installerOwner = event.sender.id
    const installationId = randomUUID()
    const started = Date.now()
    const log = createVoiceInstallLog({ installationId })
    log('info', 'started', { ...voiceInstallEnvironment() })
    for (const host of ['github.com', 'api.github.com']) {
      void session.defaultSession.resolveProxy(`https://${host}`).then((route) => {
        log('info', 'network-route', { host, route: route.replace(/[^;\s]+@/g, '[redacted]@') })
      }).catch((error) => log('warn', 'network-route-failed', { host, error: voiceInstallError(error) }))
    }
    installation = { phase: 'downloading', asset: 'engine', received: 0, total: 0 }
    publish()
    const timeout = setTimeout(() => controller.abort(new Error('Voice installation exceeded the 30 minute deadline.')), 30 * 60_000)
    let lastPhase = ''
    void installVoiceModel(join(app.getPath('userData'), 'voice-models'), controller.signal, (progress) => {
      installation = progress; publish()
      const phase = `${progress.phase}:${progress.asset || ''}`
      if (phase !== lastPhase) {
        log('info', 'phase', { ...progress, elapsedMs: Date.now() - started })
        lastPhase = phase
      }
    }, net.fetch.bind(net) as typeof fetch, installationId).then((installed) => {
      controller.signal.throwIfAborted()
      shutdownVoiceEngineServer()
      store.set('preferences', { ...preferences(), ...installed })
      installation = { phase: 'complete', received: 0, total: 0 }
      log('info', 'completed', { elapsedMs: Date.now() - started })
    }).catch((error: unknown) => {
      log(controller.signal.aborted ? 'info' : 'error', controller.signal.aborted ? 'cancelled' : 'failed', {
        ...installation, elapsedMs: Date.now() - started,
        error: voiceInstallError(controller.signal.aborted ? controller.signal.reason : error)
      })
      installation = { phase: controller.signal.aborted ? 'cancelled' : 'error', received: 0, total: 0,
        errorMessage: controller.signal.aborted ? undefined : error instanceof Error ? error.message : String(error) }
    }).finally(() => {
      clearTimeout(timeout); installer = undefined; installerOwner = undefined; publish()
    })
    return status()
  })
  ipcMain.handle('voice:install-cancel', (event) => { if (event.sender.id === installerOwner) installer?.abort() })
  ipcMain.handle('voice:stream-start', async (event) => {
    const config = preferences()
    if (config.mode !== 'local' || config.localEngine !== 'zipformer' || installer) throw new Error('Install and select Zipformer before starting live recognition.')
    if (streams.size >= 4) throw new Error('Too many active voice recordings.')
    await validateVoicePreferences(config)
    const id = randomUUID()
    streams.set(id, { owner: event.sender.id, timer: setTimeout(() => dropStream(id), 90_000) })
    try {
      await startZipformerStream(config, id)
      if (event.sender.isDestroyed() || !streams.has(id)) throw new Error('Voice recording was cancelled.')
      return id
    } catch (error) { dropStream(id); throw error }
  })
  const owned = (ownerId: number, id: string) => {
    if (typeof id !== 'string' || streams.get(id)?.owner !== ownerId) throw new Error('Voice recording is no longer active.')
  }
  ipcMain.handle('voice:stream-push', (event, input: VoiceStreamChunk) => {
    owned(event.sender.id, input?.sessionId)
    if (!(input.samples instanceof Float32Array) || input.samples.length > 16000 || !Number.isSafeInteger(input.sequence)) throw new Error('Invalid voice PCM frame.')
    return pushZipformerStream(input.sessionId, input.samples, input.sequence)
  })
  ipcMain.handle('voice:stream-finish', async (event, id: string) => {
    owned(event.sender.id, id)
    try { return await finishZipformerStream(id) } finally { dropStream(id) }
  })
  ipcMain.handle('voice:stream-cancel', (event, id: string) => {
    if (streams.get(id)?.owner === event.sender.id) dropStream(id)
  })
  ipcMain.handle('voice:validate', async (_event, input: VoiceInputPreferences) => {
    try { await validateVoicePreferences(input); return { ok: true } }
    catch (error) { return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('voice:transcribe', async (event, input: VoiceTranscriptionInput = {}) => {
    const id = `${event.sender.id}:${input.requestId || 'classic'}`
    requests.get(id)?.abort()
    const controller = new AbortController()
    requests.set(id, controller)
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try { return await transcribeGlobalVoice(input, { ...preferences(), apiKey: readKey() }, controller.signal) }
    finally { clearTimeout(timeout); if (requests.get(id) === controller) requests.delete(id) }
  })
  ipcMain.handle('voice:cancel', (event, requestId: string) => requests.get(`${event.sender.id}:${requestId}`)?.abort())
  app.once('will-quit', () => {
    unbind(); installer?.abort(); requests.forEach((request) => request.abort()); shutdownVoiceEngineServer()
    for (const stream of streams.values()) clearTimeout(stream.timer)
    streams.clear(); void shutdownZipformerRuntime()
  })
}
