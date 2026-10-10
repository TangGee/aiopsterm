import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  install: vi.fn<(...args: any[]) => Promise<any>>(),
  stored: new Map<string, any>(), bindings: new Map<string, () => void>(), failKeyboard: false,
  handlers: new Map<string, (...args: any[]) => any>(), focused: true,
  window: { show: vi.fn(), focus: vi.fn() },
  transcribe: vi.fn(async (_input: any, _preferences: any, _signal: AbortSignal): Promise<any> => ({ ok: true, data: { text: 'hello', provider: 'aiopsterm-local' } }))
}))
vi.mock('electron-store', () => ({ default: class {
  constructor(options: any) { for (const [key, value] of Object.entries(options.defaults)) if (!fake.stored.has(key)) fake.stored.set(key, value) }
  get(key: string) { return fake.stored.get(key) }
  set(key: string, value: unknown) { fake.stored.set(key, value) }
  delete(key: string) { fake.stored.delete(key) }
} }))
vi.mock('electron', () => ({
  app: { once: vi.fn(), getPath: () => '/test-user-data' },
  net: { fetch: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({ ...fake.window, isFocused: () => fake.focused }) },
  globalShortcut: {
    register: (key: string, callback: () => void) => { if (fake.failKeyboard && key !== 'MediaPlayPause') return false; fake.bindings.set(key, callback); return true },
    unregister: (key: string) => fake.bindings.delete(key), isRegistered: (key: string) => fake.bindings.has(key)
  },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(`encrypted:${text}`), decryptString: (bytes: Buffer) => bytes.toString().replace('encrypted:', '') }
}))
vi.mock('../src/main/backend/ai/voiceModelInstaller', () => ({ installVoiceModel: fake.install, voiceInstallEnvironment: () => ({ platform: 'linux', arch: 'x64', autoInstallSupported: true }) }))
vi.mock('../src/main/backend/ai/voiceInputService', () => ({ transcribeGlobalVoice: fake.transcribe, validateVoicePreferences: vi.fn(async () => undefined) }))
const sender = { id: 1, send: vi.fn(), once: vi.fn(), isDestroyed: () => false }
const invoke = (name: string, ...args: any[]) => fake.handlers.get(`voice:${name}`)!({ sender }, ...args)

beforeEach(async () => {
  fake.stored.clear(); fake.bindings.clear(); fake.handlers.clear(); fake.focused = true; fake.failKeyboard = false; vi.clearAllMocks()
  const path = '../src/main/ipc/voice'
  const { registerVoiceIpc } = await import(path)
  registerVoiceIpc({ handle: (name: string, callback: (...args: any[]) => any) => fake.handlers.set(name, callback) } as any)
})

describe('global voice IPC', () => {
  it('registers keyboard and media controls and identifies background activation', () => {
    expect(invoke('status').shortcutRegistered).toBe(true)
    fake.bindings.get('CommandOrControl+Alt+R')!()
    expect(sender.send).toHaveBeenCalledWith('voice:trigger', { source: 'shortcut', background: false })
    invoke('preferences', { headsetEnabled: true })
    fake.focused = false
    fake.bindings.get('MediaPlayPause')!()
    expect(sender.send).toHaveBeenCalledWith('voice:trigger', { source: 'headset', background: true })
    expect(fake.window.show).toHaveBeenCalledOnce()
    invoke('preferences', { headsetEnabled: false })
    expect(fake.bindings.has('MediaPlayPause')).toBe(false)
  })
  it('reports registration failures and rebinds changed shortcuts', () => {
    fake.failKeyboard = true
    expect(invoke('status').shortcutRegistered).toBe(false)
    fake.failKeyboard = false
    expect(invoke('preferences', { shortcut: 'Control+Alt+S' }).shortcutRegistered).toBe(true)
    expect(fake.bindings.has('Control+Alt+S')).toBe(true)
    expect(fake.bindings.has('CommandOrControl+Alt+R')).toBe(false)
  })
  it('keeps credentials out of returned preferences and decrypts only for transcription', async () => {
    invoke('status')
    const status = invoke('preferences', { mode: 'service', apiKey: 'private-key', model: 'speech' })
    expect(sender.send).toHaveBeenCalledWith('voice:status-changed', status)
    expect(status.preferences.apiKey).toBeUndefined()
    expect(fake.stored.get('preferences').apiKey).toBeUndefined()
    expect(fake.stored.get('encryptedKey')).not.toContain('private-key')
    await invoke('transcribe', { requestId: 'job' })
    expect(fake.transcribe.mock.calls[0][1]).toMatchObject({ apiKey: 'private-key', model: 'speech' })
    invoke('preferences', { apiKey: '' })
    expect(invoke('status').preferences.hasApiKey).toBe(false)
  })
  it('scopes cancellation to the requesting renderer', async () => {
    let finish!: () => void
    fake.transcribe.mockImplementationOnce((_input: any, _preferences: any, signal: AbortSignal) => new Promise<any>((resolve) => {
      signal.addEventListener('abort', () => resolve({ ok: false }))
      finish = () => resolve({ ok: true })
    }))
    const request = invoke('transcribe', { requestId: 'job' })
    fake.handlers.get('voice:cancel')!({ sender: { id: 2 } }, 'job')
    const signal = fake.transcribe.mock.calls[0][2] as AbortSignal
    expect(signal.aborted).toBe(false)
    invoke('cancel', 'job')
    expect(signal.aborted).toBe(true)
    finish(); await request
  })
})


describe('voice install IPC', () => {
  it('publishes progress and saves model paths only after successful installation', async () => {
    let finish!: (value: unknown) => void
    fake.install.mockImplementationOnce((_root, _signal, report) => {
      report({ phase: 'downloading', asset: 'model', received: 50, total: 100 })
      return new Promise((resolve) => { finish = resolve })
    })
    invoke('status')
    expect(invoke('install').installation).toMatchObject({ received: 50, total: 100 })
    invoke('install')
    expect(fake.install).toHaveBeenCalledTimes(1)
    expect(invoke('status').preferences.modelPath).toBe('')
    invoke('preferences', { shortcut: 'Control+Alt+X' })
    finish({ mode: 'local', localEngine: 'sensevoice', executablePath: '/engine', modelPath: '/model', tokensPath: '/tokens' })
    await vi.waitFor(() => expect(invoke('status').installation.phase).toBe('complete'))
    expect(invoke('status').preferences).toMatchObject({ modelPath: '/model', shortcut: 'Control+Alt+X' })
    expect(sender.send).toHaveBeenCalledWith('voice:status-changed', expect.objectContaining({ installation: expect.objectContaining({ phase: 'complete' }) }))
  })
  it('cancels only the caller installation and preserves previous settings on failure', async () => {
    fake.install.mockImplementationOnce((_root, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')))))
    invoke('status'); invoke('preferences', { modelPath: '/previous' }); invoke('install')
    fake.handlers.get('voice:install-cancel')!({ sender: { id: 2 } })
    expect(fake.install.mock.calls[0][1].aborted).toBe(false)
    invoke('install-cancel')
    await vi.waitFor(() => expect(invoke('status').installation.phase).toBe('cancelled'))
    expect(invoke('status').preferences.modelPath).toBe('/previous')
    fake.install.mockRejectedValueOnce(new Error('network unavailable'))
    invoke('install')
    await vi.waitFor(() => expect(invoke('status').installation.phase).toBe('error'))
    expect(invoke('status').installation.errorMessage).toBe('network unavailable')
    expect(invoke('status').preferences.modelPath).toBe('/previous')
  })
  it('does not reuse a saved service key for a different provider or endpoint', () => {
    invoke('preferences', { serviceProvider: 'doubao', apiKey: 'private-key', endpoint: 'https://speech.test' })
    expect(invoke('status').preferences.hasApiKey).toBe(true)
    invoke('preferences', { serviceProvider: 'compatible' })
    expect(invoke('status').preferences.hasApiKey).toBe(false)
    invoke('preferences', { apiKey: 'new-key' })
    invoke('preferences', { endpoint: 'https://other.test' })
    expect(invoke('status').preferences.hasApiKey).toBe(false)
  })
})
