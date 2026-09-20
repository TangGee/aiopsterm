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

describe('terminal font settings', () => {
  it('offers presets and file import without a manual font name entry', async () => {
    const { wrapper, save } = create()
    await flushPromises()
    expect(wrapper.find('option[value="__custom__"]').exists()).toBe(false)
    expect(wrapper.find('input[type="text"], #terminal-font-name, form').exists()).toBe(false)
    expect(wrapper.get('#terminal-font-file').attributes('accept')).toBe('.ttf,.otf,.woff,.woff2')
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('switches an existing saved font to a preset without changing the value before saving', async () => {
    const { wrapper, save } = create('"My Font"')
    await wrapper.get('select').setValue('monospace')
    await flushPromises()
    expect(save).toHaveBeenCalledWith('monospace')
    expect(wrapper.props('value')).toBe('"My Font"')
    await wrapper.setProps({ value: 'monospace' })
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('monospace')
    wrapper.unmount()
  })

  it('keeps the existing saved font selected when a preset save fails', async () => {
    const { wrapper, save } = create('"My Font"')
    save.mockResolvedValueOnce(false)
    await wrapper.get('select').setValue('monospace')
    await flushPromises()
    expect(save).toHaveBeenCalledWith('monospace')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('"My Font"')
    expect(wrapper.find('#terminal-font-name').exists()).toBe(false)
    wrapper.unmount()
  })
})
