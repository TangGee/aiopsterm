import { app, BrowserWindow, globalShortcut, safeStorage, type IpcMain } from 'electron'
import Store from 'electron-store'
import { transcribeGlobalVoice } from '../backend/ai/voiceInputService'
import type { VoiceInputPreferences, VoiceInputStatus, VoiceTranscriptionInput } from '@shared/contracts/voice'

export const registerVoiceIpc = (ipcMain: IpcMain) => {
  const store = new Store<{ preferences: VoiceInputPreferences; encryptedKey?: string }>({
    name: 'voice-input',
    defaults: { preferences: { mode: 'local', endpoint: '', model: '', executablePath: '', modelPath: '', shortcut: 'CommandOrControl+Alt+R', headsetEnabled: false } }
  })
  const requests = new Map<string, AbortController>()
  let keyboard = ''
  let headsetRegistered = false
  let owner: Electron.WebContents | undefined
  const preferences = () => store.get('preferences')
  const readKey = () => {
    const encrypted = store.get('encryptedKey')
    if (!encrypted) return ''
    try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')) } catch { return '' }
  }
  const status = (): VoiceInputStatus => ({
    preferences: { ...preferences(), hasApiKey: Boolean(store.get('encryptedKey')) },
    shortcutRegistered: Boolean(keyboard && globalShortcut.isRegistered(keyboard)),
    headsetRegistered
  })
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
      })
      bind()
    }
    return status()
  })
  ipcMain.handle('voice:preferences', (_event, input: Partial<VoiceInputPreferences>) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid voice preferences.')
    const previous = preferences()
    const next = { ...previous }
    for (const key of ['endpoint', 'model', 'executablePath', 'modelPath', 'shortcut'] as const) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'string' || input[key].length > 4096) throw new Error('Invalid voice preference.')
        next[key] = input[key].trim()
      }
    }
    if (input.mode === 'local' || input.mode === 'service') next.mode = input.mode
    if (typeof input.headsetEnabled === 'boolean') next.headsetEnabled = input.headsetEnabled
    if (input.position && Number.isFinite(input.position.right) && Number.isFinite(input.position.bottom)) next.position = { right: Math.max(8, input.position.right), bottom: Math.max(8, input.position.bottom) }
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string') throw new Error('Invalid API key.')
      if (input.apiKey) {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('System credential encryption is unavailable.')
        store.set('encryptedKey', safeStorage.encryptString(input.apiKey).toString('base64'))
      } else store.delete('encryptedKey')
    }
    store.set('preferences', next)
    if (previous.shortcut !== next.shortcut || previous.headsetEnabled !== next.headsetEnabled) bind()
    return status()
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
  app.once('will-quit', () => { unbind(); requests.forEach((request) => request.abort()) })
}
