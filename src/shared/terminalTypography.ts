export const TERMINAL_FONT_FAMILY =
  'ui-monospace, "SFMono-Regular", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace'

export const LEGACY_DEFAULT_TERMINAL_FONT_FAMILY =
  '"SFMono-Regular", Menlo, Monaco, "DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", Consolas, monospace'

export const TERMINAL_SYMBOL_FONT_FAMILY = 'AIOpsTerm Symbols'

export const resolveTerminalFontFamily = (fontFamily?: string) => {
  const family = fontFamily?.trim() || TERMINAL_FONT_FAMILY
  if (family.includes(`"${TERMINAL_SYMBOL_FONT_FAMILY}"`)) return family
  const primary = family.replace(/(?:^|,)\s*monospace\s*$/i, '').trim()
  return [primary, `"${TERMINAL_SYMBOL_FONT_FAMILY}"`, 'monospace'].filter(Boolean).join(', ')
}

export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.3
export const DEFAULT_TERMINAL_PADDING_HORIZONTAL = 8
export const DEFAULT_TERMINAL_PADDING_VERTICAL = 6
export const LEGACY_DEFAULT_TERMINAL_FONT_SIZE = 12
export const LEGACY_DEFAULT_TERMINAL_LINE_HEIGHT = 1.2
