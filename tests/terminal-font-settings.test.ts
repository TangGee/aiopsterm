import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TerminalFontSettings from '../src/renderer/src/components/settings/TerminalFontSettings.vue'

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/terminal/terminalFontRuntime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/renderer/src/services/terminal/terminalFontRuntime')>(),
  loadTerminalFonts: async () => true
}))

afterEach(() => { vi.unstubAllGlobals() })

const create = (value = 'monospace') => {
  const save = vi.fn(async (_value: string) => true)
  const wrapper = mount(TerminalFontSettings, {
    props: { value, fonts: [{ value: 'monospace', label: 'System Monospace' }], save }
  })
  return { wrapper, save }
}

describe('terminal custom font settings', () => {
  it('saves an installed family name without changing the persisted value before confirmation', async () => {
    const load = vi.fn(async () => undefined)
    vi.stubGlobal('FontFace', vi.fn(() => ({ load })))
    const { wrapper, save } = create()
    await wrapper.get('select').setValue('__custom__')
    await wrapper.get('#terminal-font-name').setValue('JetBrainsMono Nerd Font Mono')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).toHaveBeenCalledWith('"JetBrainsMono Nerd Font Mono"')
    expect(wrapper.props('value')).toBe('monospace')
    await wrapper.setProps({ value: '"JetBrainsMono Nerd Font Mono"' })
    expect((wrapper.get('#terminal-font-name').element as HTMLInputElement).value).toBe('JetBrainsMono Nerd Font Mono')
    wrapper.unmount()
  })

  it('rejects unavailable local fonts instead of saving a silent fallback', async () => {
    vi.stubGlobal('FontFace', vi.fn(() => ({ load: async () => { throw new Error('Missing') } })))
    const { wrapper, save } = create()
    await wrapper.get('select').setValue('__custom__')
    await wrapper.get('#terminal-font-name').setValue('Missing Font')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe('settings.terminal.fontMissing')
    wrapper.unmount()
  })

  it('restores custom values on mount and keeps them selected if a preset save fails', async () => {
    const { wrapper, save } = create('"My Font"')
    expect((wrapper.get('#terminal-font-name').element as HTMLInputElement).value).toBe('My Font')
    save.mockResolvedValueOnce(false)
    await wrapper.get('select').setValue('monospace')
    await flushPromises()
    expect(save).toHaveBeenCalledWith('monospace')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('__custom__')
    expect(wrapper.find('#terminal-font-name').exists()).toBe(true)
    wrapper.unmount()
  })
})
