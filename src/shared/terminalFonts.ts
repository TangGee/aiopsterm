export const TERMINAL_FONT_PROTOCOL = 'aiopsterm-font'
export const MAX_TERMINAL_FONT_BYTES = 20 * 1024 * 1024
export const TERMINAL_FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2']
export type ImportedTerminalFont = { id: string; name: string; family: string }

export const importedTerminalFontFamily = (id: string) => `AIOpsTerm Imported ${id}`
export const importedTerminalFontId = (family: string) =>
  /^"?AIOpsTerm Imported ([a-f0-9]{64})"?$/.exec(family)?.[1]
export const importedTerminalFontUrl = (id: string) => `${TERMINAL_FONT_PROTOCOL}://local/${id}`
