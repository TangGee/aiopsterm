import symbolFontUrl from '@/assets/fonts/SymbolsNerdFontMono-Regular.ttf?url'
import { TERMINAL_SYMBOL_FONT_FAMILY } from '@shared/terminalTypography'
import { importedTerminalFontFamily, importedTerminalFontId, importedTerminalFontUrl } from '@shared/terminalFonts'

let symbolFontLoad: Promise<boolean> | undefined
const importedFontLoads = new Map<string, Promise<boolean>>()

export const loadTerminalFonts = async (family = ''): Promise<boolean> => {
  const symbols = loadTerminalSymbolFont()
  const id = importedTerminalFontId(family)
  if (!id) return symbols
  let load = importedFontLoads.get(id)
  if (!load) {
    load = Promise.resolve().then(async () => {
      try {
        const fonts = typeof document !== 'undefined' ? document.fonts : (globalThis as unknown as { fonts: FontFaceSet }).fonts
        const face = new FontFace(importedTerminalFontFamily(id), `url("${importedTerminalFontUrl(id)}")`)
        await face.load()
        fonts.add(face)
        return true
      } catch (error) {
        importedFontLoads.delete(id)
        console.warn('Unable to load imported terminal font.', error)
        return false
      }
    })
    importedFontLoads.set(id, load)
  }
  const [loaded] = await Promise.all([load, symbols])
  return loaded
}

// Each document and render worker owns its own FontFaceSet.
export const loadTerminalSymbolFont = (): Promise<boolean> => {
  if (symbolFontLoad) return symbolFontLoad
  const fonts = typeof document !== 'undefined'
    ? document.fonts
    : (globalThis as unknown as { fonts?: FontFaceSet }).fonts
  if (!fonts || typeof FontFace === 'undefined') return Promise.resolve(false)
  symbolFontLoad = Promise.resolve().then(async () => {
    try {
      const face = new FontFace(TERMINAL_SYMBOL_FONT_FAMILY, `url("${symbolFontUrl}")`)
      await face.load()
      fonts.add(face)
      return true
    } catch (error) {
      symbolFontLoad = undefined
      console.warn('Unable to load bundled terminal symbols font.', error)
      return false
    }
  })
  return symbolFontLoad
}
