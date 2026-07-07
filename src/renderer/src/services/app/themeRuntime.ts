export type ThemeAppearance = 'dark' | 'light'

export type ThemeId =
  | 'auto'
  | 'dark'
  | 'light'
  | 'termius-dark'
  | 'termius-light'
  | 'ubuntu-terminal'
  | 'flexoki-dark'
  | 'flexoki-light'
  | 'kanagawa-wave'
  | 'kanagawa-dragon'
  | 'kanagawa-lotus'
  | 'hacker-blue'
  | 'hacker-green'
  | 'dracula-night'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'gruvbox-dark'
  | 'nord-frost'

export type ConcreteThemeId = Exclude<ThemeId, 'auto'>
export type ThemeGroup = 'default' | 'official'

export type ThemeModuleKey =
  | 'workspace'
  | 'aiSessions'
  | 'assets'
  | 'files'
  | 'snippets'
  | 'knowledge'
  | 'extensions'
  | 'kubernetes'
  | 'database'
  | 'settings'
  | 'user'
  | 'agents'
  | 'aiPanel'

export const themeModuleKeys = [
  'workspace',
  'aiSessions',
  'assets',
  'files',
  'snippets',
  'knowledge',
  'extensions',
  'kubernetes',
  'database',
  'settings',
  'user',
  'agents',
  'aiPanel'
] as const satisfies readonly ThemeModuleKey[]

export type ThemeCoreTokens = {
  bg: string
  surface: string
  surfaceMuted: string
  surfaceStrong: string
  border: string
  text: string
  textMuted: string
  accent: string
  accentSecondary: string
  success: string
  warning: string
  danger: string
  shadow: string
  shadowSoft: string
  shadowStrong: string
}

export type ThemeShellTokens = {
  bg: string
  bgWash: string
  bgWashWithBackground: string
  topBarBg: string
  topBarBgWithBackground: string
  topBarBorder: string
  topBarText: string
  topBarIcon: string
  topBarIconActive: string
  railBg: string
  railBgWithBackground: string
  railIcon: string
  railIconActive: string
  railActiveBg: string
  border: string
  resizerBg: string
  resizerHoverBg: string
  watermark: string
  brandBg: string
  brandText: string
  backdropFilter: string
}

export type ThemeLayerTokens = {
  workspaceBg: string
  panelBg: string
  toolbarBg: string
  cardBg: string
  cardStrongBg: string
  inputBg: string
  readableBg: string
  readableStrongBg: string
  overlayBg: string
  backdropFilter: string
}

export type ThemeModuleTokens = {
  text: string
  textMuted: string
  border: string
  accent: string
  accentSecondary: string
  icon: string
  iconActive: string
  inputText: string
  shadow: string
  shadowSoft: string
  shadowStrong: string
  scrollbarThumb: string
  base: ThemeLayerTokens
  withBackground: ThemeLayerTokens
}

export type ThemeTerminalSurfaceTokens = {
  paneBg: string
  paneBackdropFilter: string
  threadedPaneBg: string
  titleBg: string
  titleBackdropFilter: string
  commandLineBg: string
  commandLineBackdropFilter: string
  xtermViewportBg: string
  xtermScreenBg: string
  runtimeBackground: string
  codexRuntimeBackground: string
  codexStackBg: string
  codexStackIdleBg: string
  codexStackBackdropFilter: string
  codexXtermViewportBg: string
  codexXtermScreenBg: string
  ansiBackground: ThemeTerminalAnsiPalette
  codexAnsiBackground: ThemeTerminalAnsiPalette
}

export type ThemeTerminalAnsiPalette = {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export type ThemeTerminalPalette = ThemeTerminalAnsiPalette & {
  background: string
  contrastBackground: string
  foreground: string
  minimumContrastRatio: number
  cursor: string
  selectionBackground: string
  scrollbarTrack: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  base: ThemeTerminalSurfaceTokens
  withBackground: ThemeTerminalSurfaceTokens
}

export type ThemeEditorTokens = {
  fontFamily: string
  fontSize: string
  lineHeight: string
  tabSize: string
}

export type ThemeDefinition = {
  id: ConcreteThemeId
  name: string
  group: ThemeGroup
  appearance: ThemeAppearance
  core: ThemeCoreTokens
  shell: ThemeShellTokens
  modules: Record<ThemeModuleKey, ThemeModuleTokens>
  terminalPalette: ThemeTerminalPalette
  editor: ThemeEditorTokens
}

export type ThemeSelectOption = {
  value: ThemeId
  label: string
  group: 'system' | ThemeGroup
  background: string
  surface: string
  accent: string
}

type ThemeSeed = {
  id: ConcreteThemeId
  name: string
  group: ThemeGroup
  appearance: ThemeAppearance
  core: Omit<ThemeCoreTokens, 'shadowSoft' | 'shadowStrong'>
  terminalPalette?: Partial<Omit<ThemeTerminalPalette, 'base' | 'withBackground'>> & {
    base?: ThemeTerminalSurfaceSeed
    withBackground?: ThemeTerminalSurfaceSeed
  }
}

type ThemeTerminalSurfaceSeed = Partial<Omit<ThemeTerminalSurfaceTokens, 'ansiBackground' | 'codexAnsiBackground'>> & {
  ansiBackground?: Partial<ThemeTerminalAnsiPalette>
  codexAnsiBackground?: Partial<ThemeTerminalAnsiPalette>
}

const darkShadow = '0 18px 48px rgb(0 0 0 / 0.28)'
const lightShadow = '0 18px 42px rgb(36 47 70 / 0.14)'
const transparent = 'rgba(0, 0, 0, 0)'

const alpha = (hex: string, value: string) => `${hex}${value}`
const rgba = (hex: string, value: string) => {
  const raw = hex.trim().replace(/^#/, '')
  const normalized = raw.length === 3 ? raw.split('').map((item) => `${item}${item}`).join('') : raw
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return hex
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${value})`
}
const cssModuleName = (key: ThemeModuleKey) => key.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)
const kebab = (value: string) => value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)

const makeCore = (seed: ThemeSeed): ThemeCoreTokens => ({
  ...seed.core,
  shadowSoft: seed.appearance === 'dark' ? '0 12px 32px rgb(0 0 0 / 0.24)' : '0 12px 28px rgb(36 47 70 / 0.12)',
  shadowStrong: seed.appearance === 'dark' ? '0 24px 64px rgb(0 0 0 / 0.34)' : '0 24px 58px rgb(36 47 70 / 0.18)'
})

const makeShellTokens = (core: ThemeCoreTokens, appearance: ThemeAppearance): ThemeShellTokens => {
  const dark = appearance === 'dark'
  const backgroundAccentWash = `linear-gradient(90deg, color-mix(in srgb, ${core.accent} ${dark ? '8%' : '3%'}, transparent), transparent 26%), ${core.bg}`
  return {
    bg: core.bg,
    bgWash: `linear-gradient(90deg, color-mix(in srgb, ${core.accent} ${dark ? '8%' : '4%'}, transparent), transparent 26%), ${core.bg}`,
    bgWashWithBackground: dark
      ? `linear-gradient(0deg, color-mix(in srgb, ${core.bg} 22%, transparent), color-mix(in srgb, ${core.bg} 22%, transparent)), ${backgroundAccentWash}`
      : backgroundAccentWash,
    topBarBg: `color-mix(in srgb, ${core.surface} ${dark ? '94%' : '96%'}, transparent)`,
    topBarBgWithBackground: `color-mix(in srgb, ${core.surface} ${dark ? '54%' : '14%'}, transparent)`,
    topBarBorder: core.border,
    topBarText: core.textMuted,
    topBarIcon: core.textMuted,
    topBarIconActive: core.text,
    railBg: core.surface,
    railBgWithBackground: `color-mix(in srgb, ${core.surface} ${dark ? '38%' : '12%'}, transparent)`,
    railIcon: core.textMuted,
    railIconActive: core.accent,
    railActiveBg: `color-mix(in srgb, ${core.accent} ${dark ? '20%' : '15%'}, ${core.surfaceMuted})`,
    border: core.border,
    resizerBg: `color-mix(in srgb, ${core.surface} ${dark ? '24%' : '34%'}, transparent)`,
    resizerHoverBg: `color-mix(in srgb, ${core.accent} 14%, transparent)`,
    watermark: `color-mix(in srgb, ${core.textMuted} 22%, transparent)`,
    brandBg: core.accent,
    brandText: dark ? '#071113' : '#ffffff',
    backdropFilter: dark ? 'blur(16px)' : 'none'
  }
}

const moduleAccentFallbacks: Record<ThemeModuleKey, keyof ThemeCoreTokens> = {
  workspace: 'accent',
  aiSessions: 'accentSecondary',
  assets: 'success',
  files: 'accent',
  snippets: 'accentSecondary',
  knowledge: 'accent',
  extensions: 'accentSecondary',
  kubernetes: 'success',
  database: 'accent',
  settings: 'accent',
  user: 'accentSecondary',
  agents: 'accentSecondary',
  aiPanel: 'accentSecondary'
}

const makeLayerTokens = (core: ThemeCoreTokens, appearance: ThemeAppearance, withBackground: boolean): ThemeLayerTokens => {
  const dark = appearance === 'dark'
  if (!withBackground) {
    return {
      workspaceBg: core.bg,
      panelBg: core.surface,
      toolbarBg: `color-mix(in srgb, ${core.surface} ${dark ? '86%' : '94%'}, ${core.surfaceMuted})`,
      cardBg: core.surfaceMuted,
      cardStrongBg: core.surfaceStrong,
      inputBg: core.surfaceMuted,
      readableBg: dark ? core.surfaceMuted : core.surface,
      readableStrongBg: core.surface,
      overlayBg: core.surface,
      backdropFilter: 'none'
    }
  }
  return {
    workspaceBg: dark ? `color-mix(in srgb, ${core.bg} 6%, transparent)` : transparent,
    panelBg: dark ? `color-mix(in srgb, ${core.surface} 36%, transparent)` : transparent,
    toolbarBg: dark ? `color-mix(in srgb, ${core.surface} 34%, transparent)` : `color-mix(in srgb, ${core.surface} 10%, transparent)`,
    cardBg: dark ? `color-mix(in srgb, ${core.surfaceMuted} 32%, transparent)` : `color-mix(in srgb, ${core.surfaceMuted} 24%, transparent)`,
    cardStrongBg: dark ? `color-mix(in srgb, ${core.surfaceStrong} 30%, transparent)` : `color-mix(in srgb, ${core.surfaceStrong} 30%, transparent)`,
    inputBg: dark ? `color-mix(in srgb, ${core.surfaceMuted} 82%, transparent)` : `color-mix(in srgb, ${core.surface} 74%, transparent)`,
    readableBg: dark ? `color-mix(in srgb, ${core.surface} 82%, transparent)` : `color-mix(in srgb, ${core.surface} 76%, transparent)`,
    readableStrongBg: dark ? `color-mix(in srgb, ${core.surface} 86%, transparent)` : `color-mix(in srgb, ${core.surface} 86%, transparent)`,
    overlayBg: dark ? `color-mix(in srgb, ${core.surface} 88%, transparent)` : `color-mix(in srgb, ${core.surface} 92%, transparent)`,
    backdropFilter: dark ? 'blur(16px)' : 'none'
  }
}

const makeModuleTokens = (core: ThemeCoreTokens, appearance: ThemeAppearance, moduleKey: ThemeModuleKey): ThemeModuleTokens => {
  const accent = String(core[moduleAccentFallbacks[moduleKey]])
  return {
    text: core.text,
    textMuted: core.textMuted,
    border: core.border,
    accent,
    accentSecondary: core.accentSecondary,
    icon: core.textMuted,
    iconActive: accent,
    inputText: core.text,
    shadow: core.shadow,
    shadowSoft: core.shadowSoft,
    shadowStrong: core.shadowStrong,
    scrollbarThumb: alpha(core.textMuted, appearance === 'dark' ? '99' : 'b3'),
    base: makeLayerTokens(core, appearance, false),
    withBackground: makeLayerTokens(core, appearance, true)
  }
}

const makeModules = (core: ThemeCoreTokens, appearance: ThemeAppearance): Record<ThemeModuleKey, ThemeModuleTokens> =>
  themeModuleKeys.reduce(
    (modules, key) => ({
      ...modules,
      [key]: makeModuleTokens(core, appearance, key)
    }),
    {} as Record<ThemeModuleKey, ThemeModuleTokens>
  )

function terminalAnsiPalette(core: ThemeCoreTokens, appearance: ThemeAppearance): ThemeTerminalAnsiPalette {
  const dark = appearance === 'dark'
  return {
    black: dark ? core.bg : core.text,
    red: core.danger,
    green: core.success,
    yellow: core.warning,
    blue: core.accent,
    magenta: core.accentSecondary,
    cyan: core.accent,
    white: core.text,
    brightBlack: core.textMuted,
    brightRed: core.danger,
    brightGreen: core.success,
    brightYellow: core.warning,
    brightBlue: core.accent,
    brightMagenta: core.accentSecondary,
    brightCyan: core.accentSecondary,
    brightWhite: core.text
  }
}

const terminalAnsiBackgroundPalette = (core: ThemeCoreTokens, appearance: ThemeAppearance): ThemeTerminalAnsiPalette =>
  terminalAnsiPalette(core, appearance)

const terminalAnsiBackgroundPaletteFrom = (palette: ThemeTerminalAnsiPalette): ThemeTerminalAnsiPalette => ({
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
  brightWhite: palette.brightWhite
})

const codexAnsiBackgroundPalette = (
  basePalette: ThemeTerminalAnsiPalette,
  core: ThemeCoreTokens,
  appearance: ThemeAppearance,
  codexBackground: string,
  withBackground: boolean
): ThemeTerminalAnsiPalette => {
  if (appearance === 'dark') return basePalette
  return {
    ...basePalette,
    black: codexBackground,
    brightBlack: withBackground ? rgba(core.surfaceStrong, '0.76') : core.surfaceStrong,
    white: withBackground ? rgba(core.surface, '0.88') : core.surface,
    brightWhite: withBackground ? rgba(core.surface, '0.94') : core.surface
  }
}

const makeTerminalSurfaceTokens = (core: ThemeCoreTokens, appearance: ThemeAppearance, withBackground: boolean): ThemeTerminalSurfaceTokens => {
  const dark = appearance === 'dark'
  if (!withBackground) {
    return {
      paneBg: core.bg,
      paneBackdropFilter: 'none',
      threadedPaneBg: transparent,
      titleBg: core.bg,
      titleBackdropFilter: 'none',
      commandLineBg: `color-mix(in srgb, ${core.bg} 92%, ${core.surface})`,
      commandLineBackdropFilter: 'none',
      xtermViewportBg: core.bg,
      xtermScreenBg: core.bg,
      runtimeBackground: core.bg,
      codexRuntimeBackground: core.bg,
      codexStackBg: core.bg,
      codexStackIdleBg: core.bg,
      codexStackBackdropFilter: 'none',
      codexXtermViewportBg: core.bg,
      codexXtermScreenBg: core.bg,
      ansiBackground: terminalAnsiBackgroundPalette(core, appearance),
      codexAnsiBackground: codexAnsiBackgroundPalette(terminalAnsiBackgroundPalette(core, appearance), core, appearance, core.bg, false)
    }
  }
  const terminalBodyBg = transparent
  const lightCommandLineBg = rgba(core.surface, '0.78')
  return {
    paneBg: dark ? `color-mix(in srgb, ${core.bg} 78%, transparent)` : transparent,
    paneBackdropFilter: 'none',
    threadedPaneBg: transparent,
    titleBg: dark ? `color-mix(in srgb, ${core.bg} 74%, transparent)` : transparent,
    titleBackdropFilter: dark ? 'blur(10px)' : 'none',
    commandLineBg: dark ? `color-mix(in srgb, ${core.bg} 78%, transparent)` : lightCommandLineBg,
    commandLineBackdropFilter: dark ? 'blur(14px)' : 'none',
    xtermViewportBg: terminalBodyBg,
    xtermScreenBg: terminalBodyBg,
    runtimeBackground: terminalBodyBg,
    codexRuntimeBackground: terminalBodyBg,
    codexStackBg: dark ? `color-mix(in srgb, ${core.bg} 76%, transparent)` : transparent,
    codexStackIdleBg: dark ? `color-mix(in srgb, ${core.bg} 52%, transparent)` : transparent,
    codexStackBackdropFilter: dark ? 'blur(10px)' : 'none',
    codexXtermViewportBg: terminalBodyBg,
    codexXtermScreenBg: terminalBodyBg,
    ansiBackground: terminalAnsiBackgroundPalette(core, appearance),
    codexAnsiBackground: codexAnsiBackgroundPalette(terminalAnsiBackgroundPalette(core, appearance), core, appearance, terminalBodyBg, true)
  }
}

const defaultTerminalPalette = (core: ThemeCoreTokens, appearance: ThemeAppearance): ThemeTerminalPalette => ({
  background: core.bg,
  contrastBackground: core.bg,
  foreground: core.text,
  minimumContrastRatio: 3,
  cursor: core.accentSecondary,
  selectionBackground: alpha(core.accent, appearance === 'dark' ? '55' : '3d'),
  ...terminalAnsiPalette(core, appearance),
  scrollbarTrack: alpha(core.border, appearance === 'dark' ? '66' : '80'),
  scrollbarThumb: alpha(core.textMuted, appearance === 'dark' ? '99' : 'b3'),
  scrollbarThumbHover: core.accent,
  base: makeTerminalSurfaceTokens(core, appearance, false),
  withBackground: makeTerminalSurfaceTokens(core, appearance, true)
})

const makeTheme = (seed: ThemeSeed): ThemeDefinition => {
  const core = makeCore(seed)
  const terminalPalette = defaultTerminalPalette(core, seed.appearance)
  const mergedPalette = {
    ...terminalPalette,
    ...(seed.terminalPalette || {})
  }
  const finalAnsiBackground = terminalAnsiBackgroundPaletteFrom(mergedPalette)
  const mergeSurface = (surface: ThemeTerminalSurfaceTokens, override: ThemeTerminalSurfaceSeed | undefined, withBackground: boolean): ThemeTerminalSurfaceTokens => {
    const mergedSurface = {
      ...surface,
      ...(override || {})
    }
    const codexAnsiBackground = codexAnsiBackgroundPalette(finalAnsiBackground, core, seed.appearance, mergedSurface.codexRuntimeBackground, withBackground)
    return {
      ...mergedSurface,
      ansiBackground: {
        ...finalAnsiBackground,
        ...(override?.ansiBackground || {})
      },
      codexAnsiBackground: {
        ...codexAnsiBackground,
        ...(override?.codexAnsiBackground || {})
      }
    }
  }
  const baseSurface = mergeSurface(terminalPalette.base, seed.terminalPalette?.base, false)
  const withBackgroundSurface = mergeSurface(terminalPalette.withBackground, seed.terminalPalette?.withBackground, true)
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group,
    appearance: seed.appearance,
    core,
    shell: makeShellTokens(core, seed.appearance),
    modules: makeModules(core, seed.appearance),
    terminalPalette: {
      ...mergedPalette,
      base: baseSurface,
      withBackground: withBackgroundSurface
    },
    editor: {
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: '14px',
      lineHeight: '20px',
      tabSize: '4'
    }
  }
}

export const themePresets = {
  dark: makeTheme({
    id: 'dark',
    name: 'Dark',
    group: 'default',
    appearance: 'dark',
    core: {
      bg: '#0f1117',
      surface: '#151922',
      surfaceMuted: '#1b202b',
      surfaceStrong: '#232938',
      border: '#2b3242',
      text: '#e6eaf2',
      textMuted: '#8993a8',
      accent: '#56b6c2',
      accentSecondary: '#8ccf7e',
      success: '#8ccf7e',
      warning: '#e6b450',
      danger: '#e06c75',
      shadow: darkShadow
    }
  }),
  light: makeTheme({
    id: 'light',
    name: 'Light',
    group: 'default',
    appearance: 'light',
    core: {
      bg: '#f5f7fb',
      surface: '#ffffff',
      surfaceMuted: '#f0f4f9',
      surfaceStrong: '#e2e8f1',
      border: '#d4dce8',
      text: '#172033',
      textMuted: '#667085',
      accent: '#2f6fed',
      accentSecondary: '#2f9e44',
      success: '#2f9e44',
      warning: '#b7791f',
      danger: '#d64545',
      shadow: lightShadow
    }
  }),
  'termius-dark': makeTheme({
    id: 'termius-dark',
    name: 'Termius Dark',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#111417',
      surface: '#191f24',
      surfaceMuted: '#202830',
      surfaceStrong: '#2a3440',
      border: '#33414f',
      text: '#d9dbde',
      textMuted: '#9aa8b7',
      accent: '#6c9cf4',
      accentSecondary: '#7fc06e',
      success: '#7fc06e',
      warning: '#eebe6c',
      danger: '#f36e6e',
      shadow: darkShadow
    }
  }),
  'termius-light': makeTheme({
    id: 'termius-light',
    name: 'Termius Light',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#f4f7fb',
      surface: '#ffffff',
      surfaceMuted: '#eef3f8',
      surfaceStrong: '#dfe8f2',
      border: '#cad6e2',
      text: '#2a2f33',
      textMuted: '#69737d',
      accent: '#0366d6',
      accentSecondary: '#22863a',
      success: '#22863a',
      warning: '#b08800',
      danger: '#d03035',
      shadow: lightShadow
    }
  }),
  'ubuntu-terminal': makeTheme({
    id: 'ubuntu-terminal',
    name: 'Ubuntu Terminal',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#300A24',
      surface: '#3b102d',
      surfaceMuted: '#461738',
      surfaceStrong: '#512043',
      border: '#6d4f63',
      text: '#ffffff',
      textMuted: '#c8b7c2',
      accent: '#3465a4',
      accentSecondary: '#4e9a06',
      success: '#4e9a06',
      warning: '#c4a000',
      danger: '#cc0000',
      shadow: '0 18px 48px rgb(48 10 36 / 0.38)'
    },
    terminalPalette: {
      background: '#300A24',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selectionBackground: '#75507b88',
      black: '#2e3436',
      red: '#cc0000',
      green: '#4e9a06',
      yellow: '#c4a000',
      blue: '#3465a4',
      magenta: '#75507b',
      cyan: '#06989a',
      white: '#d3d7cf',
      brightBlack: '#555753',
      brightRed: '#ef2929',
      brightGreen: '#8ae234',
      brightYellow: '#fce94f',
      brightBlue: '#729fcf',
      brightMagenta: '#ad7fa8',
      brightCyan: '#34e2e2',
      brightWhite: '#eeeeec',
      scrollbarTrack: '#6d4f6366',
      scrollbarThumb: '#c8b7c299',
      scrollbarThumbHover: '#ad7fa8'
    }
  }),
  'flexoki-dark': makeTheme({
    id: 'flexoki-dark',
    name: 'Flexoki Dark',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#100f0f',
      surface: '#1c1b1a',
      surfaceMuted: '#282726',
      surfaceStrong: '#343331',
      border: '#403e3c',
      text: '#cecdc3',
      textMuted: '#878580',
      accent: '#da702c',
      accentSecondary: '#3aa99f',
      success: '#879a39',
      warning: '#d0a215',
      danger: '#d14d41',
      shadow: darkShadow
    }
  }),
  'flexoki-light': makeTheme({
    id: 'flexoki-light',
    name: 'Flexoki Light',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#fffcf0',
      surface: '#f7f3e3',
      surfaceMuted: '#f2edda',
      surfaceStrong: '#e6deca',
      border: '#d8d0bf',
      text: '#100f0f',
      textMuted: '#6f6e69',
      accent: '#205ea6',
      accentSecondary: '#24837b',
      success: '#66800b',
      warning: '#ad8301',
      danger: '#af3029',
      shadow: lightShadow
    }
  }),
  'kanagawa-wave': makeTheme({
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#1f1f28',
      surface: '#252535',
      surfaceMuted: '#2a2a37',
      surfaceStrong: '#363646',
      border: '#47475c',
      text: '#dcd7ba',
      textMuted: '#938aa9',
      accent: '#7e9cd8',
      accentSecondary: '#7aa89f',
      success: '#98bb6c',
      warning: '#e6c384',
      danger: '#e82424',
      shadow: darkShadow
    }
  }),
  'kanagawa-dragon': makeTheme({
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#181616',
      surface: '#211f1f',
      surfaceMuted: '#282424',
      surfaceStrong: '#332e2e',
      border: '#453f3f',
      text: '#c5c9c5',
      textMuted: '#a6a69c',
      accent: '#8ba4b0',
      accentSecondary: '#87a987',
      success: '#87a987',
      warning: '#e6c384',
      danger: '#e46876',
      shadow: darkShadow
    }
  }),
  'kanagawa-lotus': makeTheme({
    id: 'kanagawa-lotus',
    name: 'Kanagawa Lotus',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#f2ecbc',
      surface: '#fff7d6',
      surfaceMuted: '#ebe3b1',
      surfaceStrong: '#d8cca0',
      border: '#c4b985',
      text: '#545464',
      textMuted: '#77713f',
      accent: '#4d699b',
      accentSecondary: '#597b75',
      success: '#6f894e',
      warning: '#836f4a',
      danger: '#c84053',
      shadow: lightShadow
    }
  }),
  'hacker-blue': makeTheme({
    id: 'hacker-blue',
    name: 'Hacker Blue',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#000814',
      surface: '#001529',
      surfaceMuted: '#00203d',
      surfaceStrong: '#003366',
      border: '#0b4f8a',
      text: '#b3d9ff',
      textMuted: '#66b2ff',
      accent: '#4d9fff',
      accentSecondary: '#4dc3ff',
      success: '#66b2ff',
      warning: '#80bfff',
      danger: '#2a6fc7',
      shadow: '0 18px 48px rgb(0 25 80 / 0.36)'
    }
  }),
  'hacker-green': makeTheme({
    id: 'hacker-green',
    name: 'Hacker Green',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#001000',
      surface: '#001a00',
      surfaceMuted: '#002400',
      surfaceStrong: '#003300',
      border: '#006600',
      text: '#ccffcc',
      textMuted: '#66ff66',
      accent: '#00ff41',
      accentSecondary: '#00bb88',
      success: '#00ff41',
      warning: '#66ff66',
      danger: '#00c000',
      shadow: '0 18px 48px rgb(0 80 0 / 0.36)'
    }
  }),
  'dracula-night': makeTheme({
    id: 'dracula-night',
    name: 'Dracula Night',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#282a36',
      surface: '#303241',
      surfaceMuted: '#343746',
      surfaceStrong: '#44475a',
      border: '#55586f',
      text: '#f8f8f2',
      textMuted: '#bdc3e6',
      accent: '#bd93f9',
      accentSecondary: '#8be9fd',
      success: '#50fa7b',
      warning: '#f1fa8c',
      danger: '#ff5555',
      shadow: darkShadow
    }
  }),
  'catppuccin-mocha': makeTheme({
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#1e1e2e',
      surface: '#252538',
      surfaceMuted: '#313244',
      surfaceStrong: '#45475a',
      border: '#585b70',
      text: '#cdd6f4',
      textMuted: '#a6adc8',
      accent: '#89b4fa',
      accentSecondary: '#94e2d5',
      success: '#a6e3a1',
      warning: '#f9e2af',
      danger: '#f38ba8',
      shadow: darkShadow
    }
  }),
  'catppuccin-latte': makeTheme({
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#eff1f5',
      surface: '#ffffff',
      surfaceMuted: '#e6e9ef',
      surfaceStrong: '#ccd0da',
      border: '#bcc0cc',
      text: '#4c4f69',
      textMuted: '#6c6f85',
      accent: '#1e66f5',
      accentSecondary: '#179299',
      success: '#40a02b',
      warning: '#df8e1d',
      danger: '#d20f39',
      shadow: lightShadow
    }
  }),
  'gruvbox-dark': makeTheme({
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#282828',
      surface: '#32302f',
      surfaceMuted: '#3c3836',
      surfaceStrong: '#504945',
      border: '#665c54',
      text: '#ebdbb2',
      textMuted: '#a89984',
      accent: '#83a598',
      accentSecondary: '#8ec07c',
      success: '#b8bb26',
      warning: '#fabd2f',
      danger: '#fb4934',
      shadow: darkShadow
    }
  }),
  'nord-frost': makeTheme({
    id: 'nord-frost',
    name: 'Nord Frost',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#2e3440',
      surface: '#343b49',
      surfaceMuted: '#3b4252',
      surfaceStrong: '#434c5e',
      border: '#4c566a',
      text: '#d8dee9',
      textMuted: '#aeb8c8',
      accent: '#81a1c1',
      accentSecondary: '#88c0d0',
      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      shadow: darkShadow
    }
  })
} satisfies Record<ConcreteThemeId, ThemeDefinition>

const flattenRecord = (prefix: string, source: Record<string, unknown>, target: Record<string, string>) => {
  for (const [key, value] of Object.entries(source)) {
    const variable = `${prefix}-${kebab(key)}`
    if (typeof value === 'string') {
      target[variable] = value
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenRecord(variable, value as Record<string, unknown>, target)
    }
  }
}

export const themeCssVariables = (theme: ThemeDefinition) => {
  const variables: Record<string, string> = {}
  flattenRecord('--theme-core', theme.core, variables)
  flattenRecord('--theme-shell', theme.shell, variables)
  flattenRecord('--theme-terminal', theme.terminalPalette, variables)
  flattenRecord('--theme-editor', theme.editor, variables)
  for (const moduleKey of themeModuleKeys) {
    flattenRecord(`--theme-module-${cssModuleName(moduleKey)}`, theme.modules[moduleKey] as unknown as Record<string, unknown>, variables)
  }
  return variables
}

export const themeSelectionOptions: ThemeSelectOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    group: 'system',
    background: 'linear-gradient(135deg, #111827 0 49%, #f7fafc 51% 100%)',
    surface: '#2c2f36',
    accent: '#4ea7ff'
  },
  ...Object.values(themePresets).map((theme) => ({
    value: theme.id,
    label: theme.name,
    group: theme.group,
    background: theme.core.bg,
    surface: theme.core.surfaceMuted,
    accent: theme.core.accent
  }))
]

export const isThemeId = (theme: string): theme is ThemeId => theme === 'auto' || Object.prototype.hasOwnProperty.call(themePresets, theme)

export const getSystemTheme = (): ThemeAppearance => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  return 'light'
}

export const resolveEffectiveThemeId = (theme: string, system: ThemeAppearance = getSystemTheme()): ConcreteThemeId => {
  if (theme === 'auto') return system
  return Object.prototype.hasOwnProperty.call(themePresets, theme) ? (theme as ConcreteThemeId) : 'dark'
}

export const resolveThemePreset = (theme: string, system: ThemeAppearance = getSystemTheme()) => themePresets[resolveEffectiveThemeId(theme, system)]

const terminalActiveSurfaceVariables = (theme: ThemeDefinition) => {
  const variables: Record<string, string> = {}
  flattenRecord('--theme-terminal-active', theme.terminalPalette.base as unknown as Record<string, unknown>, variables)
  return variables
}

export const applyThemeToDocument = (theme: string) => {
  if (typeof document === 'undefined') return resolveThemePreset(theme)
  const preset = resolveThemePreset(theme)
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(`theme-${preset.appearance}`)
  root.dataset.theme = preset.appearance
  root.dataset.themeId = preset.id
  root.dataset.themePreference = isThemeId(theme) ? theme : 'dark'
  root.style.setProperty('color-scheme', preset.appearance)
  for (const [key, value] of Object.entries(themeCssVariables(preset))) {
    root.style.setProperty(key, value)
  }
  for (const [key, value] of Object.entries(terminalActiveSurfaceVariables(preset))) {
    root.style.setProperty(key, value)
  }
  return preset
}

export const addSystemThemeListener = (callback: (theme: ThemeAppearance) => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = (event: MediaQueryListEvent | MediaQueryList) => callback(event.matches ? 'dark' : 'light')
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange as EventListener)
    return () => mediaQuery.removeEventListener('change', handleChange as EventListener)
  }
  if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }
  return () => {}
}
