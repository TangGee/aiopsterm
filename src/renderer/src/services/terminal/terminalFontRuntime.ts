import symbolFontUrl from '@/assets/fonts/SymbolsNerdFontMono-Regular.ttf?url'
import { TERMINAL_SYMBOL_FONT_FAMILY } from '@shared/terminalTypography'

let symbolFontLoad: Promise<boolean> | undefined

export const isLocalTerminalFontAvailable = async (family: string): Promise<boolean> => {
  try {
    await new FontFace('AIOpsTerm Font Probe', `local(${JSON.stringify(family)})`).load()
    return true
  } catch {
    // local() matches full or PostScript names, which can differ from family
    // names on macOS and Windows. Check the actual CSS family as well.
    const context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    if (!context) return false
    const sample = 'Wim0123456789@#MWil'
    return ['monospace', 'serif', 'sans-serif'].some((fallback) => {
      context.font = `72px ${fallback}`
      const baseline = context.measureText(sample).width
      context.font = `72px ${JSON.stringify(family)}, ${fallback}`
      return baseline > 0 && Math.abs(context.measureText(sample).width - baseline) > 0.01
    })
  }
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
