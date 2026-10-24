import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import VoiceInputSettings from '@/components/voice/VoiceInputSettings.vue'
import type { VoiceInputPreferences, VoiceInputStatus, VoiceInputTrigger } from '@shared/contracts/voice'

vi.mock('@/i18n', () => ({ useI18n: () => ({ locale: ref('zh-CN') }) }))
const original = window.aiops
let wrapper: VueWrapper | undefined
let changed: ((value: VoiceInputStatus) => void) | undefined
let trigger: ((event: VoiceInputTrigger) => void) | undefined
const defaults: VoiceInputPreferences = { mode: 'local', localEngine: 'zipformer', executablePath: '', modelPath: '', tokensPath: '', endpoint: '', model: '', shortcut: 'CommandOrControl+Alt+R', headsetEnabled: false }
const status = (preferences = defaults) => ({ preferences: { ...preferences }, shortcutRegistered: true, headsetRegistered: preferences.headsetEnabled })
const render = async () => { wrapper = mount(VoiceInputSettings); await flushPromises(); return wrapper }
beforeEach(() => {
  window.aiops = { ...original,
    onVoiceInputStatusChanged: vi.fn((listener) => { changed = listener; return vi.fn() }),
    installVoiceInputModel: vi.fn(async () => ({ ...status(), installation: { phase: 'downloading' as const, received: 10, total: 100 } })),
    cancelVoiceInputInstall: vi.fn(async () => undefined),
    getVoiceInputStatus: vi.fn(async () => status()),
    saveVoiceInputPreferences: vi.fn(async (patch) => status({ ...defaults, ...patch })),
    validateVoiceInputPreferences: vi.fn(async () => ({ ok: true })),
    onVoiceInputTrigger: vi.fn((listener) => { trigger = listener; return vi.fn() }),
    openExternalUrl: vi.fn(async () => undefined) as any
  }
})
afterEach(() => { wrapper?.unmount(); window.aiops = original; vi.useRealTimers(); vi.restoreAllMocks() })

describe('voice setup and presets', () => {
  it('recommends Zipformer, explains installation and offers official downloads', async () => {
    const view = await render()
    expect((view.get('[data-testid="voice-preset"]').element as HTMLSelectElement).value).toBe('zipformer')
    expect(view.text()).toContain('请先配置语音识别')
    expect(view.text()).toContain('应用未内置引擎和模型')
    expect(view.text()).toContain('不纠正同音错字')
    await view.findAll('button').find((button) => button.text() === '下载模型')!.trigger('click')
    expect(window.aiops.openExternalUrl).toHaveBeenCalledWith(expect.stringContaining('sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2'))
  })
  it('blocks incomplete setup, validates files and saves a usable preset', async () => {
    const view = await render()
    await view.get('form').trigger('submit'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).not.toHaveBeenCalled()
    await view.get('[data-testid="voice-executable"]').setValue('/engine')
    await view.get('[data-testid="voice-model-file"]').setValue('/model.int8.onnx')
    await view.get('form').trigger('submit'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).not.toHaveBeenCalled()
    await view.get('[data-testid="voice-tokens"]').setValue('/tokens.txt')
    await view.get('[data-testid="voice-decoder"]').setValue('/decoder.onnx')
    await view.get('[data-testid="voice-joiner"]').setValue('/joiner.int8.onnx')
    await view.get('[data-testid="voice-punctuation"]').setValue('/punctuation/model.int8.onnx')
    vi.mocked(window.aiops.validateVoiceInputPreferences!).mockResolvedValueOnce({ ok: false, errorMessage: 'missing file' })
    await view.get('form').trigger('submit'); await flushPromises()
    expect(view.text()).toContain('配置检查失败')
    expect(window.aiops.saveVoiceInputPreferences).not.toHaveBeenCalled()
    await view.get('form').trigger('submit'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).toHaveBeenCalledWith(expect.objectContaining({ localEngine: 'zipformer', tokensPath: '/tokens.txt', modelPath: '/model.int8.onnx' }))
    expect(view.text()).toContain('设置已保存')
    expect(view.text()).not.toContain('请先配置语音识别')
  })
  it('preserves legacy custom Whisper paths and clears incompatible files on preset changes', async () => {
    vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue(status({ ...defaults, localEngine: undefined, executablePath: '/custom/whisper-cli', modelPath: '/models/base.bin' }))
    const view = await render()
    expect((view.get('[data-testid="voice-preset"]').element as HTMLSelectElement).value).toBe('whisper')
    expect((view.get('[data-testid="voice-model-file"]').element as HTMLInputElement).value).toBe('/models/base.bin')
    expect(view.find('[data-testid="voice-tokens"]').exists()).toBe(false)
    await view.get('[data-testid="voice-preset"]').setValue('zipformer')
    expect((view.get('[data-testid="voice-model-file"]').element as HTMLInputElement).value).toBe('')
  })
  it('keeps service settings and saved credentials when no replacement key is entered', async () => {
    vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue(status({ ...defaults, mode: 'service', endpoint: 'https://speech.local/transcribe', model: 'my-speech', hasApiKey: true }))
    const view = await render()
    await view.get('form').trigger('submit'); await flushPromises()
    const patch = vi.mocked(window.aiops.saveVoiceInputPreferences!).mock.calls[0][0]
    expect(patch).toMatchObject({ mode: 'service', model: 'my-speech' })
    expect(patch).not.toHaveProperty('apiKey')
    expect(patch).not.toHaveProperty('position')
    expect(view.text()).toContain('SenseVoice 原生 /api/v1/asr')
  })
  it('detects the headset button without saving an unfinished model setup', async () => {
    const view = await render()
    await view.findAll('button').find((button) => button.text() === '检测耳机按键')!.trigger('click'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).toHaveBeenCalledWith({ headsetEnabled: true })
    trigger?.({ source: 'headset', background: false }); await flushPromises()
    expect(view.text()).toContain('已检测到耳机按键')
  })
  it('does not overwrite stored settings after a load failure', async () => {
    vi.mocked(window.aiops.getVoiceInputStatus!).mockRejectedValue(new Error('offline'))
    const view = await render()
    expect(view.text()).toContain('加载失败')
    await view.get('form').trigger('submit')
    expect(window.aiops.saveVoiceInputPreferences).not.toHaveBeenCalled()
  })
})


describe('one-click and cloud voice setup', () => {
  it('shows one-click setup first and keeps manual configuration collapsed', async () => {
    const view = await render()
    expect(view.get('[data-testid="voice-manual-setup"]').attributes('open')).toBeUndefined()
    await view.get('[data-testid="voice-auto-install"]').trigger('click'); await flushPromises()
    expect(window.aiops.installVoiceInputModel).toHaveBeenCalledOnce()
    expect(view.get('progress').attributes('value')).toBe('10')
    changed?.({ ...status(), installation: { phase: 'downloading', asset: 'model', received: 50, total: 100 } }); await flushPromises()
    expect(view.text()).toContain('50%')
    expect(view.text()).toContain('正在下载语音模型')
    changed?.({ ...status({ ...defaults, executablePath: '/auto/engine', modelPath: '/auto/model', tokensPath: '/auto/tokens' }), installation: { phase: 'complete', received: 0, total: 0 } }); await flushPromises()
    expect((view.get('[data-testid="voice-model-file"]').element as HTMLInputElement).value).toBe('/auto/model')
    expect(view.text()).toContain('安装完成并已启用')
  })
  it('restores active progress after reopening and allows cancellation and retry', async () => {
    vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue({ ...status(), installation: { phase: 'extracting', received: 0, total: 0 } })
    const view = await render()
    expect(view.text()).toContain('正在解压文件')
    await view.get('[data-testid="voice-install-progress"] button').trigger('click')
    expect(window.aiops.cancelVoiceInputInstall).toHaveBeenCalledOnce()
    changed?.({ ...status(), installation: { phase: 'cancelled', received: 0, total: 0 } }); await flushPromises()
    expect(view.get('[data-testid="voice-auto-install"]').attributes('disabled')).toBeUndefined()
  })
  it('configures Doubao with the official endpoint, resource and encrypted-key save path', async () => {
    const view = await render()
    await view.get('[data-testid="voice-mode"]').setValue('service')
    await view.get('[data-testid="voice-service-provider"]').setValue('doubao')
    expect(view.text()).toContain('App ID')
    await view.get('form').trigger('submit'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).not.toHaveBeenCalled()
    await view.get('[data-testid="voice-api-key"]').setValue('speech-key')
    await view.get('form').trigger('submit'); await flushPromises()
    expect(window.aiops.saveVoiceInputPreferences).toHaveBeenCalledWith(expect.objectContaining({ serviceProvider: 'doubao', model: 'volc.bigasr.auc_turbo', apiKey: 'speech-key', endpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash' }))
    expect((view.get('[data-testid="voice-api-key"]').element as HTMLInputElement).value).toBe('')
  })
})

it('allows removal of a saved Doubao key without requiring a replacement', async () => {
  vi.mocked(window.aiops.getVoiceInputStatus!).mockResolvedValue(status({ ...defaults, mode: 'service', serviceProvider: 'doubao', endpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash', model: 'volc.bigasr.auc_turbo', hasApiKey: true }))
  const view = await render()
  await view.findAll('label').find((label) => label.text().includes('删除已保存的密钥'))!.get('input').setValue(true)
  await view.get('form').trigger('submit'); await flushPromises()
  expect(window.aiops.saveVoiceInputPreferences).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }))
})
