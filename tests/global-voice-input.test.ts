import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref, reactive } from 'vue'
import GlobalVoiceInput from '@/components/voice/GlobalVoiceInput.vue'
import { registerVoiceInputTarget } from '@/services/voice/voiceInputTargets'
import { globalVoiceController } from '@/services/voice/globalVoiceController'
import type { VoiceInputTrigger } from '@shared/contracts/voice'

const session = vi.hoisted(() => ({ context: null as any }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => session.context }))
const recording = vi.hoisted(() => ({ options: null as any, runtime: null as any }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ locale: ref('zh-CN') }) }))
vi.mock('@/services/voice/voiceRecording', () => ({
  createVoiceRecording: (options: any) => {
    recording.options = options
    const state = ref('idle')
    const runtime = { state, error: ref(''), startedAt: ref(0), start: vi.fn(async () => { state.value = 'recording' }), stop: vi.fn(() => { state.value = 'transcribing' }), cancel: vi.fn(() => { state.value = 'idle' }) }
    recording.runtime = runtime
    return runtime
  }
}))
const original = window.aiops
let wrapper: VueWrapper | undefined
let trigger: ((event: VoiceInputTrigger) => void) | undefined
const preferences = { mode: 'service' as const, endpoint: 'http://localhost/transcribe', model: 'speech', executablePath: '', modelPath: '', shortcut: 'Control+Alt+R', headsetEnabled: false }
const mountInput = async () => { wrapper = mount(GlobalVoiceInput, { attachTo: document.body }); await flushPromises(); return wrapper }
const deliver = async (text = 'spoken') => { recording.options.onText(text); recording.runtime.state.value = 'idle'; await flushPromises() }
const input = () => { const element = document.createElement('textarea'); element.value = 'hello world'; document.body.append(element); element.focus(); element.setSelectionRange(6, 6); return element }
const clickMic = async () => { await wrapper!.get('[data-testid="global-voice-button"]').trigger('pointerdown', { button: 0, clientX: 500, clientY: 500 }); await wrapper!.get('[data-testid="global-voice-button"]').trigger('pointerup'); await wrapper!.get('[data-testid="global-voice-button"]').trigger('click'); await flushPromises() }

beforeEach(() => {
  session.context = reactive({ activePanelId: 'one', selectedConversationId: 'chat-one', selectedManagedAiSessionKey: '', activeModule: 'terminal', activeSettingsSection: 'general', setActiveSettingsSection: vi.fn((value) => { session.context.activeSettingsSection = value }), setActiveModule: vi.fn((value) => { session.context.activeModule = value }), mode: 'terminal' })
  window.aiops = { ...original,
    getVoiceInputStatus: vi.fn(async () => ({ preferences: { ...preferences }, shortcutRegistered: true, headsetRegistered: false })),
    saveVoiceInputPreferences: vi.fn(async (patch) => ({ preferences: { ...preferences, ...patch }, shortcutRegistered: true, headsetRegistered: Boolean(patch.headsetEnabled) })),
    onVoiceInputTrigger: vi.fn((listener) => { trigger = listener; return vi.fn() })
  }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; window.aiops = original; document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks() })

describe('global voice controls', () => {
  it('uses the focused input for composer controls after their pointer event clears focus history', async () => {
    await mountInput(); const originalInput = input()
    const composerButton = document.createElement('button')
    document.body.append(composerButton)
    composerButton.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(document.activeElement).toBe(originalInput)
    globalVoiceController()?.toggle()
    await flushPromises(); await deliver('voice ')
    expect(originalInput.value).toBe('hello voice world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  })
  it('inserts at the original caret even after focus moves to another input', async () => {
    await mountInput(); const originalInput = input(); await clickMic()
    const other = input(); await deliver('voice ')
    expect(originalInput.value).toBe('hello voice world')
    expect(other.value).toBe('hello world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  })
  it('opens an editable dialog with no focused input and retains text when closed', async () => {
    await mountInput(); await clickMic(); expect(wrapper!.find('[role="dialog"]').exists()).toBe(true)
    await deliver(); expect((wrapper!.get('textarea').element as HTMLTextAreaElement).value).toBe('spoken')
    await wrapper!.get('button[aria-label="关闭"]').trigger('click')
    await wrapper!.get('button[aria-label="打开识别结果"]').trigger('click')
    expect((wrapper!.get('textarea').element as HTMLTextAreaElement).value).toBe('spoken')
  })
  it('preserves user edits and routes stale results into the dialog', async () => {
    await mountInput(); const originalInput = input(); await clickMic(); originalInput.value = 'new draft'
    await deliver()
    expect(originalInput.value).toBe('new draft')
    expect((wrapper!.get('textarea').element as HTMLTextAreaElement).value).toBe('spoken')
  })
  it('rejects the same DOM input reused by a different chat session', async () => {
    await mountInput(); const originalInput = input(); await clickMic()
    session.context.selectedConversationId = 'chat-two'
    await deliver()
    expect(originalInput.value).toBe('hello world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(true)
  })
  it('opens the dialog for background shortcuts instead of using an old app input', async () => {
    await mountInput(); const originalInput = input()
    trigger?.({ source: 'shortcut', background: true }); await flushPromises(); await deliver()
    expect(originalInput.value).toBe('hello world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(true)
  })
  it('uses the transcript caret for a shortcut inside the result editor', async () => {
    await mountInput(); const previous = input()
    await wrapper!.get('button[aria-label="打开识别结果"]').trigger('click')
    const draft = wrapper!.get('textarea')
    await draft.setValue('one two')
    const element = draft.element as HTMLTextAreaElement
    element.focus(); element.setSelectionRange(4, 4)
    trigger?.({ source: 'shortcut', background: false }); await flushPromises(); await deliver('voice ')
    expect(element.value).toBe('one voice two')
    expect(previous.value).toBe('hello world')
  })
  it('shares the toggle action between the button and shortcut', async () => {
    await mountInput(); input(); await clickMic()
    trigger?.({ source: 'shortcut', background: false })
    expect(recording.runtime.stop).toHaveBeenCalledOnce()
    trigger?.({ source: 'shortcut', background: false })
    expect(recording.runtime.start).toHaveBeenCalledOnce()
  })
  it('drags without starting recording and persists the new position', async () => {
    await mountInput()
    const button = wrapper!.get('[data-testid="global-voice-button"]')
    await button.trigger('pointerdown', { button: 0, clientX: 500, clientY: 500 })
    await button.trigger('pointermove', { clientX: 400, clientY: 400 })
    await button.trigger('pointerup'); await button.trigger('click')
    expect(recording.runtime.start).not.toHaveBeenCalled()
    expect(window.aiops.saveVoiceInputPreferences).toHaveBeenCalledWith({ position: { right: 124, bottom: 196 } })
  })
  it('directly streams into terminals without a dialog and removes control characters', async () => {
    await mountInput(); const element = input(); const insert = vi.fn(() => true)
    const remove = registerVoiceInputTarget(element, () => ({ kind: 'terminal', insert }))
    await clickMic()
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
    recording.options.onText('echo hi\nwhoami\x1b')
    recording.options.onText('again')
    await flushPromises()
    expect(insert).toHaveBeenNthCalledWith(1, 'echo hi whoami ')
    expect(insert).toHaveBeenNthCalledWith(2, 'again')
    expect(recording.runtime.state.value).toBe('recording')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
    remove()
  })
  it('appends multiple Chinese and English fragments before recording stops', async () => {
    await mountInput(); const element = input(); await clickMic()
    expect(recording.options.streaming).toBe(true)
    for (const text of ['你好', '世界', 'hello', 'world']) recording.options.onText(text)
    await flushPromises()
    expect(element.value).toBe('hello 你好世界hello worldworld')
    expect(recording.runtime.state.value).toBe('recording')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  })
  it('keeps microphone errors dismissible without opening a dialog for a focused input', async () => {
    await mountInput(); input(); await clickMic()
    recording.runtime.error.value = 'Requested device not found'
    recording.runtime.state.value = 'idle'
    await flushPromises()
    expect(wrapper!.get('[role="alert"] span').text()).toContain('未找到可用的麦克风')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
    await wrapper!.get('[role="alert"] button').trigger('click')
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
  })
  it.each(['button', 'body', 'dismiss'])('retains the terminal across failed attempts with focus on %s', async (focus) => {
    await mountInput(); const element = input(); const insert = vi.fn(() => true)
    const remove = registerVoiceInputTarget(element, () => ({ kind: 'terminal', insert }))
    await clickMic()
    recording.runtime.error.value = 'Requested device not found'
    recording.runtime.state.value = 'idle'
    await flushPromises()
    if (focus === 'body') element.blur()
    else if (focus === 'button') (wrapper!.get('[data-testid="global-voice-button"]').element as HTMLElement).focus()
    else (wrapper!.get('[role="alert"] button').element as HTMLElement).focus()
    await clickMic()
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
    await deliver('second attempt')
    expect(insert).toHaveBeenCalledWith('second attempt')
    remove()
  })
  it('uses the original input for shortcut retries from voice controls', async () => {
    await mountInput(); const element = input(); await clickMic()
    recording.runtime.error.value = 'Requested device not found'
    recording.runtime.state.value = 'idle'
    await flushPromises()
    ;(wrapper!.get('[role="alert"] button').element as HTMLElement).focus()
    trigger?.({ source: 'shortcut', background: false })
    await flushPromises(); await deliver('retry ')
    expect(element.value).toBe('hello retry world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  })
  it.each(['outside', 'session'])('forgets the previous input after a deliberate %s change', async (change) => {
    await mountInput(); const element = input(); await clickMic()
    recording.runtime.state.value = 'idle'
    await flushPromises()
    if (change === 'outside') document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    else session.context.activePanelId = 'two'
    element.blur()
    await clickMic(); await deliver('new text')
    expect(element.value).toBe('hello world')
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(true)
  })
  it('routes the gear to formal settings and leaves headset detection to that page', async () => {
    await mountInput(); await wrapper!.get('button[aria-label="语音设置"]').trigger('click')
    expect(session.context.setActiveSettingsSection).toHaveBeenCalledWith('voice')
    expect(session.context.setActiveModule).toHaveBeenCalledWith('settings')
    trigger?.({ source: 'headset', background: false }); await flushPromises()
    expect(recording.runtime.start).not.toHaveBeenCalled()
  })
  it('routes first use to settings without requesting the microphone', async () => {
    vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue({ preferences: { ...preferences, endpoint: '' }, shortcutRegistered: true, headsetRegistered: false })
    await mountInput(); input(); await clickMic()
    expect(session.context.setActiveSettingsSection).toHaveBeenCalledWith('voice')
    expect(recording.runtime.start).not.toHaveBeenCalled()
  })
  it('uses settings changes immediately without restarting the app', async () => {
    let changed!: (status: any) => void
    window.aiops.onVoiceInputStatusChanged = vi.fn((listener) => { changed = listener; return vi.fn() })
    vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue({ preferences: { ...preferences, endpoint: '' }, shortcutRegistered: true, headsetRegistered: false })
    await mountInput()
    changed({ preferences, shortcutRegistered: true, headsetRegistered: false })
    await clickMic()
    expect(recording.runtime.start).toHaveBeenCalledOnce()
  })
})

it('replaces only the current dictation in the focused input and applies final punctuation', async () => {
  vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue({ preferences: { ...preferences, mode: 'local', localEngine: 'zipformer', executablePath: '/runtime', modelPath: '/encoder', decoderPath: '/decoder', joinerPath: '/joiner', tokensPath: '/tokens', punctuationPath: '/punct' }, shortcutRegistered: true, headsetRegistered: false })
  await mountInput(); const originalInput = input(); await clickMic()
  recording.options.online.onPartial('今天天气')
  recording.options.online.onPartial('今天天气很好')
  await flushPromises()
  expect(originalInput.value).toBe('hello 今天天气很好world')
  expect(document.activeElement).toBe(originalInput)
  expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
  await deliver('今天天气很好。')
  expect(originalInput.value).toBe('hello 今天天气很好。world')
})
