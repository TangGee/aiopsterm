import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTerminalFontFamily, TERMINAL_FONT_FAMILY } from '../src/shared/terminalTypography'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('terminal font fallback', () => {
  it.each(['document', 'worker'])('loads imported font files once into the %s font set', async (scope) => {
    const add = vi.fn()
    const constructor = vi.fn((family: string) => ({ family, load: async () => undefined }))
    vi.stubGlobal('FontFace', constructor)
    vi.stubGlobal('document', scope === 'document' ? { fonts: { add } } : undefined)
    if (scope === 'worker') vi.stubGlobal('fonts', { add })
    const id = 'a'.repeat(64)
    const family = `"AIOpsTerm Imported ${id}"`
    const { loadTerminalFonts } = await import('../src/renderer/src/services/terminal/terminalFontRuntime')
    expect(await Promise.all([loadTerminalFonts(family), loadTerminalFonts(family)])).toEqual([true, true])
    expect(constructor).toHaveBeenCalledWith(`AIOpsTerm Imported ${id}`, `url("aiopsterm-font://local/${id}")`)
    expect(add.mock.calls.filter(([face]) => face.family.startsWith('AIOpsTerm Imported'))).toHaveLength(1)
  })

  it('accepts installed CSS family names even when the platform uses another full font name', async () => {
    vi.stubGlobal('FontFace', vi.fn(() => ({ load: async () => { throw new Error('No matching full name') } })))
    const context = {
      font: '',
      measureText() { return { width: this.font.includes('"Installed Family"') ? 120 : 90 } }
    }
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
    const { isLocalTerminalFontAvailable } = await import('../src/renderer/src/services/terminal/terminalFontRuntime')
    expect(await isLocalTerminalFontAvailable('Installed Family')).toBe(true)
    expect(await isLocalTerminalFontAvailable('Missing Family')).toBe(false)
  })

  it('preserves the user font and inserts symbols before the final generic fallback', () => {
    expect(resolveTerminalFontFamily('"My Font", monospace')).toBe('"My Font", "AIOpsTerm Symbols", monospace')
    expect(resolveTerminalFontFamily('monospace')).toBe('"AIOpsTerm Symbols", monospace')
    expect(resolveTerminalFontFamily('"My Font"')).toBe('"My Font", "AIOpsTerm Symbols", monospace')
    expect(resolveTerminalFontFamily()).toContain(TERMINAL_FONT_FAMILY.split(',')[0])
    const resolved = resolveTerminalFontFamily('Consolas')
    expect(resolveTerminalFontFamily(resolved)).toBe(resolved)
  })

  it.each(['document', 'worker'])('registers one loaded face per %s scope', async (scope) => {
    const add = vi.fn()
    const face = { load: vi.fn(async () => face) }
    const constructor = vi.fn(() => face)
    vi.stubGlobal('FontFace', constructor)
    if (scope === 'worker') {
      vi.stubGlobal('document', undefined)
      vi.stubGlobal('fonts', { add })
    } else {
      vi.stubGlobal('document', { fonts: { add } })
    }
    const { loadTerminalSymbolFont } = await import('../src/renderer/src/services/terminal/terminalFontRuntime')
    expect(await Promise.all([loadTerminalSymbolFont(), loadTerminalSymbolFont()])).toEqual([true, true])
    expect(constructor).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledWith(face)
    expect(add).toHaveBeenCalledOnce()
  })

  it('keeps terminal startup available on load failure and retries later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const add = vi.fn()
    const face = { load: vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(undefined) }
    vi.stubGlobal('document', { fonts: { add } })
    vi.stubGlobal('FontFace', vi.fn(() => face))
    const { loadTerminalSymbolFont } = await import('../src/renderer/src/services/terminal/terminalFontRuntime')
    expect(await loadTerminalSymbolFont()).toBe(false)
    expect(add).not.toHaveBeenCalled()
    expect(await loadTerminalSymbolFont()).toBe(true)
    expect(add).toHaveBeenCalledOnce()
  })
})
