import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
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
  app: { once: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({ ...fake.window, isFocused: () => fake.focused }) },
  globalShortcut: {
    register: (key: string, callback: () => void) => { if (fake.failKeyboard && key !== 'MediaPlayPause') return false; fake.bindings.set(key, callback); return true },
    unregister: (key: string) => fake.bindings.delete(key), isRegistered: (key: string) => fake.bindings.has(key)
  },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(`encrypted:${text}`), decryptString: (bytes: Buffer) => bytes.toString().replace('encrypted:', '') }
}))
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
