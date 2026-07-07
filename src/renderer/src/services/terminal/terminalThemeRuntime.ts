import { resolveThemePreset } from '@/services/app/themeRuntime'
import type { ThreadedTerminalSurface, ThreadedTerminalTheme } from '@/services/terminal/threadedTerminalProtocol'

export type TerminalSurfaceMode = 'base' | 'withBackground'

export type TerminalRuntimeTheme = Required<
  Pick<
    ThreadedTerminalTheme,
    | 'background'
    | 'contrastBackground'
    | 'foreground'
    | 'minimumContrastRatio'
    | 'cursor'
    | 'cursorAccent'
    | 'selectionBackground'
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'brightBlack'
    | 'brightRed'
    | 'brightGreen'
    | 'brightYellow'
    | 'brightBlue'
    | 'brightMagenta'
    | 'brightCyan'
    | 'brightWhite'
    | 'ansiBackground'
    | 'scrollbarTrack'
    | 'scrollbarThumb'
    | 'scrollbarThumbHover'
  >
>

const safeSystemTheme = () => {
  if (typeof document !== 'undefined') {
    const appliedTheme = document.documentElement.dataset.theme
    if (appliedTheme === 'dark' || appliedTheme === 'light') return appliedTheme
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  if (window.matchMedia('(prefers-color-scheme: dark)')?.matches) return 'dark'
  if (window.matchMedia('(prefers-color-scheme: light)')?.matches) return 'light'
  return 'dark'
}

export const terminalThemeForAppTheme = (
  themeId: string,
  options: { surfaceMode?: TerminalSurfaceMode; surface?: ThreadedTerminalSurface } = {}
): TerminalRuntimeTheme => {
  const preset = resolveThemePreset(themeId, safeSystemTheme())
  const palette = preset.terminalPalette
  const surface = options.surfaceMode === 'withBackground' ? palette.withBackground : palette.base
  const terminalSurface = options.surface || 'workspace'
  return {
    background: terminalSurface === 'codex' ? surface.codexRuntimeBackground : surface.runtimeBackground,
    contrastBackground: palette.contrastBackground,
    foreground: palette.foreground,
    minimumContrastRatio: palette.minimumContrastRatio,
    cursor: palette.cursor,
    cursorAccent: palette.background,
    selectionBackground: palette.selectionBackground,
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: palette.brightBlack,
    brightRed: palette.brightRed,
    brightGreen: palette.brightGreen,
    brightYellow: palette.brightYellow,
    brightBlue: palette.brightBlue,
    brightMagenta: palette.brightMagenta,
    brightCyan: palette.brightCyan,
    brightWhite: palette.brightWhite,
    ansiBackground: terminalSurface === 'codex' ? surface.codexAnsiBackground : surface.ansiBackground,
    scrollbarTrack: palette.scrollbarTrack,
    scrollbarThumb: palette.scrollbarThumb,
    scrollbarThumbHover: palette.scrollbarThumbHover
  }
}
