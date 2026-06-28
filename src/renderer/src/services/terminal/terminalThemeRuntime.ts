import { resolveThemePreset } from '@/services/app/themeRuntime'
import type { ThreadedTerminalTheme } from '@/services/terminal/threadedTerminalProtocol'

export type TerminalRuntimeTheme = Required<
  Pick<
    ThreadedTerminalTheme,
    | 'background'
    | 'foreground'
    | 'cursor'
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
    | 'scrollbarTrack'
    | 'scrollbarThumb'
    | 'scrollbarThumbHover'
  >
>

const alpha = (hex: string, value: string) => `${hex}${value}`

const safeSystemTheme = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  if (window.matchMedia('(prefers-color-scheme: dark)')?.matches) return 'dark'
  if (window.matchMedia('(prefers-color-scheme: light)')?.matches) return 'light'
  return 'dark'
}

export const terminalThemeForAppTheme = (themeId: string, options: { transparentBackground?: boolean } = {}): TerminalRuntimeTheme => {
  const preset = resolveThemePreset(themeId, safeSystemTheme())
  const tokens = preset.tokens
  const background = options.transparentBackground ? 'rgba(0, 0, 0, 0)' : tokens['--bg']
  return {
    background,
    foreground: tokens['--text'],
    cursor: tokens['--accent-2'],
    selectionBackground: alpha(tokens['--accent'], preset.appearance === 'dark' ? '55' : '3d'),
    black: tokens['--bg'],
    red: tokens['--danger'],
    green: tokens['--success'],
    yellow: tokens['--warn'],
    blue: tokens['--accent'],
    magenta: tokens['--accent-2'],
    cyan: tokens['--accent'],
    white: tokens['--text'],
    brightBlack: tokens['--muted'],
    brightRed: tokens['--danger'],
    brightGreen: tokens['--success'],
    brightYellow: tokens['--warn'],
    brightBlue: tokens['--accent'],
    brightMagenta: tokens['--accent-2'],
    brightCyan: tokens['--accent-2'],
    brightWhite: tokens['--text'],
    scrollbarTrack: alpha(tokens['--border'], preset.appearance === 'dark' ? '66' : '80'),
    scrollbarThumb: alpha(tokens['--muted'], preset.appearance === 'dark' ? '99' : 'b3'),
    scrollbarThumbHover: tokens['--accent']
  }
}
