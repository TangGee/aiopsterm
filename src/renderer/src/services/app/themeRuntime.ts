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
  | 'solarized-light'
  | 'one-light'
  | 'gruvbox-light'
  | 'nord-snowstorm'
  | 'rose-pine-dawn'
  | 'ayu-light'
  | 'obsidian-black'
  | 'sakura-blossom'
  | 'neon-pink'
  | 'rose-milk'

export type ConcreteThemeId = Exclude<ThemeId, 'auto'>
export type ThemeGroup = 'default' | 'official'

// 材质属性,只决定设置了背景图之后"怎么透":
// frosted = 毛玻璃,磨砂透出;clear = 亮面,清透无模糊,背景纹理保持锐利。
// 无背景图时两者没有区别,base 层都是全实面。
export type ThemeSurfaceFinish = 'frosted' | 'clear'

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
  border: string
  backdropFilter: string
}

export type ThemeModuleTokens = {
  text: string
  textMuted: string
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
  surfaceFinish: ThemeSurfaceFinish
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
  surfaceFinish?: ThemeSurfaceFinish
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

const makeShellTokens = (core: ThemeCoreTokens, appearance: ThemeAppearance, finish: ThemeSurfaceFinish): ThemeShellTokens => {
  const dark = appearance === 'dark'
  const backgroundAccentWash = `linear-gradient(90deg, color-mix(in srgb, ${core.accent} ${dark ? '8%' : '3%'}, transparent), transparent 26%), ${core.bg}`
  return {
    bg: core.bg,
    bgWash: `linear-gradient(90deg, color-mix(in srgb, ${core.accent} ${dark ? '8%' : '4%'}, transparent), transparent 26%), ${core.bg}`,
    bgWashWithBackground: dark
      ? `linear-gradient(0deg, color-mix(in srgb, ${core.bg} 22%, transparent), color-mix(in srgb, ${core.bg} 22%, transparent)), ${backgroundAccentWash}`
      : backgroundAccentWash,
    topBarBg: `color-mix(in srgb, ${core.surface} ${dark ? '94%' : '96%'}, transparent)`,
    topBarBgWithBackground: `color-mix(in srgb, ${core.surface} ${dark ? '48%' : '50%'}, transparent)`,
    topBarBorder: core.border,
    topBarText: core.textMuted,
    topBarIcon: core.textMuted,
    topBarIconActive: core.text,
    railBg: core.surface,
    railBgWithBackground: `color-mix(in srgb, ${core.surface} ${dark ? '32%' : '44%'}, transparent)`,
    railIcon: core.textMuted,
    railIconActive: core.accent,
    railActiveBg: `color-mix(in srgb, ${core.accent} ${dark ? '20%' : '15%'}, ${core.surfaceMuted})`,
    border: core.border,
    resizerBg: `color-mix(in srgb, ${core.surface} ${dark ? '24%' : '34%'}, transparent)`,
    resizerHoverBg: `color-mix(in srgb, ${core.accent} 14%, transparent)`,
    watermark: `color-mix(in srgb, ${core.textMuted} 22%, transparent)`,
    brandBg: core.accent,
    brandText: dark ? '#071113' : '#ffffff',
    backdropFilter: finish === 'clear' ? 'none' : 'blur(16px)'
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

// 质感模型:不设背景图时 base 层全部是实色主题表面;用户选择了背景图,
// 意图就是要看到它,withBackground 层一律半透明透出,磨砂还是清透由主题材质决定。
const makeLayerTokens = (
  core: ThemeCoreTokens,
  appearance: ThemeAppearance,
  withBackground: boolean,
  finish: ThemeSurfaceFinish
): ThemeLayerTokens => {
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
      border: core.border,
      backdropFilter: 'none'
    }
  }
  return {
    workspaceBg: dark ? `color-mix(in srgb, ${core.bg} 6%, transparent)` : transparent,
    panelBg: dark ? `color-mix(in srgb, ${core.surface} 30%, transparent)` : `color-mix(in srgb, ${core.surface} 40%, transparent)`,
    toolbarBg: dark ? `color-mix(in srgb, ${core.surface} 30%, transparent)` : `color-mix(in srgb, ${core.surface} 48%, transparent)`,
    cardBg: dark ? `color-mix(in srgb, ${core.surfaceMuted} 28%, transparent)` : `color-mix(in srgb, ${core.surfaceMuted} 44%, transparent)`,
    cardStrongBg: dark ? `color-mix(in srgb, ${core.surfaceStrong} 30%, transparent)` : `color-mix(in srgb, ${core.surfaceStrong} 56%, transparent)`,
    inputBg: dark ? `color-mix(in srgb, ${core.surfaceMuted} 82%, transparent)` : `color-mix(in srgb, ${core.surface} 74%, transparent)`,
    readableBg: dark ? `color-mix(in srgb, ${core.surface} 82%, transparent)` : `color-mix(in srgb, ${core.surface} 82%, transparent)`,
    readableStrongBg: dark ? `color-mix(in srgb, ${core.surface} 86%, transparent)` : `color-mix(in srgb, ${core.surface} 86%, transparent)`,
    overlayBg: dark ? `color-mix(in srgb, ${core.surface} 88%, transparent)` : `color-mix(in srgb, ${core.surface} 92%, transparent)`,
    border: dark ? `color-mix(in srgb, ${core.border} 62%, transparent)` : `color-mix(in srgb, ${core.text} 24%, transparent)`,
    backdropFilter: finish === 'clear' ? 'none' : 'blur(16px)'
  }
}

const makeModuleTokens = (
  core: ThemeCoreTokens,
  appearance: ThemeAppearance,
  moduleKey: ThemeModuleKey,
  finish: ThemeSurfaceFinish
): ThemeModuleTokens => {
  const accent = String(core[moduleAccentFallbacks[moduleKey]])
  return {
    text: core.text,
    textMuted: core.textMuted,
    accent,
    accentSecondary: core.accentSecondary,
    icon: core.textMuted,
    iconActive: accent,
    inputText: core.text,
    shadow: core.shadow,
    shadowSoft: core.shadowSoft,
    shadowStrong: core.shadowStrong,
    scrollbarThumb: alpha(core.textMuted, appearance === 'dark' ? '99' : 'b3'),
    base: makeLayerTokens(core, appearance, false, finish),
    withBackground: makeLayerTokens(core, appearance, true, finish)
  }
}

const makeModules = (
  core: ThemeCoreTokens,
  appearance: ThemeAppearance,
  finish: ThemeSurfaceFinish
): Record<ThemeModuleKey, ThemeModuleTokens> =>
  themeModuleKeys.reduce(
    (modules, key) => ({
      ...modules,
      [key]: makeModuleTokens(core, appearance, key, finish)
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

const makeTerminalSurfaceTokens = (
  core: ThemeCoreTokens,
  appearance: ThemeAppearance,
  withBackground: boolean,
  terminalBg: string,
  ansiPalette: ThemeTerminalAnsiPalette,
  finish: ThemeSurfaceFinish
): ThemeTerminalSurfaceTokens => {
  const dark = appearance === 'dark'
  const clear = finish === 'clear'
  if (!withBackground) {
    return {
      paneBg: terminalBg,
      paneBackdropFilter: 'none',
      threadedPaneBg: transparent,
      titleBg: terminalBg,
      titleBackdropFilter: 'none',
      commandLineBg: `color-mix(in srgb, ${terminalBg} 92%, ${core.surface})`,
      commandLineBackdropFilter: 'none',
      xtermViewportBg: terminalBg,
      xtermScreenBg: terminalBg,
      runtimeBackground: terminalBg,
      codexRuntimeBackground: terminalBg,
      codexStackBg: terminalBg,
      codexStackIdleBg: terminalBg,
      codexStackBackdropFilter: 'none',
      codexXtermViewportBg: terminalBg,
      codexXtermScreenBg: terminalBg,
      ansiBackground: terminalAnsiBackgroundPaletteFrom(ansiPalette),
      codexAnsiBackground: codexAnsiBackgroundPalette(terminalAnsiBackgroundPaletteFrom(ansiPalette), core, appearance, terminalBg, false)
    }
  }
  // 终端正文在背景图之上必须保留一层可读洗底:浅色主题文字深、需要接近实底,
  // 深色主题保留更多背景透出。真实绘制发生在 xterm/threaded canvas(runtimeBackground),
  // CSS 层的 viewport/screen 保持透明避免双重叠加。
  const terminalBodyBg = rgba(terminalBg, dark ? '0.7' : '0.94')
  const lightCommandLineBg = rgba(core.surface, '0.78')
  return {
    paneBg: dark ? `color-mix(in srgb, ${terminalBg} 30%, transparent)` : transparent,
    paneBackdropFilter: 'none',
    threadedPaneBg: transparent,
    titleBg: dark ? `color-mix(in srgb, ${terminalBg} 74%, transparent)` : rgba(core.surface, '0.66'),
    titleBackdropFilter: clear ? 'none' : 'blur(10px)',
    commandLineBg: dark ? `color-mix(in srgb, ${terminalBg} 78%, transparent)` : lightCommandLineBg,
    commandLineBackdropFilter: clear ? 'none' : 'blur(14px)',
    xtermViewportBg: transparent,
    xtermScreenBg: transparent,
    runtimeBackground: terminalBodyBg,
    codexRuntimeBackground: terminalBodyBg,
    codexStackBg: dark ? `color-mix(in srgb, ${terminalBg} 76%, transparent)` : rgba(terminalBg, '0.7'),
    codexStackIdleBg: dark ? `color-mix(in srgb, ${terminalBg} 44%, transparent)` : rgba(terminalBg, '0.6'),
    codexStackBackdropFilter: clear ? 'none' : 'blur(10px)',
    codexXtermViewportBg: transparent,
    codexXtermScreenBg: transparent,
    ansiBackground: terminalAnsiBackgroundPaletteFrom(ansiPalette),
    codexAnsiBackground: codexAnsiBackgroundPalette(terminalAnsiBackgroundPaletteFrom(ansiPalette), core, appearance, terminalBodyBg, true)
  }
}

const makeTheme = (seed: ThemeSeed): ThemeDefinition => {
  const core = makeCore(seed)
  const surfaceFinish: ThemeSurfaceFinish = seed.surfaceFinish || 'frosted'
  const { base: baseSeed, withBackground: withBackgroundSeed, ...paletteSeed } = seed.terminalPalette || {}
  const mergedPalette = {
    background: core.bg,
    contrastBackground: core.bg,
    foreground: core.text,
    minimumContrastRatio: 3,
    cursor: core.accentSecondary,
    selectionBackground: alpha(core.accent, seed.appearance === 'dark' ? '55' : '3d'),
    ...terminalAnsiPalette(core, seed.appearance),
    scrollbarTrack: alpha(core.border, seed.appearance === 'dark' ? '66' : '80'),
    scrollbarThumb: alpha(core.textMuted, seed.appearance === 'dark' ? '99' : 'b3'),
    scrollbarThumbHover: core.accent,
    ...paletteSeed
  }
  const terminalBg = mergedPalette.background
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
  const baseSurface = mergeSurface(
    makeTerminalSurfaceTokens(core, seed.appearance, false, terminalBg, finalAnsiBackground, surfaceFinish),
    baseSeed,
    false
  )
  const withBackgroundSurface = mergeSurface(
    makeTerminalSurfaceTokens(core, seed.appearance, true, terminalBg, finalAnsiBackground, surfaceFinish),
    withBackgroundSeed,
    true
  )
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group,
    appearance: seed.appearance,
    surfaceFinish,
    core,
    shell: makeShellTokens(core, seed.appearance, surfaceFinish),
    modules: makeModules(core, seed.appearance, surfaceFinish),
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
    },
    terminalPalette: {
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#ec8b93',
      brightGreen: '#b3d39c',
      brightYellow: '#edd4a6',
      brightBlue: '#8fc6f4',
      brightMagenta: '#d7a1e7',
      brightCyan: '#7bc6d0',
      brightWhite: '#e6eaf2'
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
    },
    terminalPalette: {
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#8c959f',
      brightBlack: '#57606a',
      brightRed: '#e5534b',
      brightGreen: '#2da44e',
      brightYellow: '#bf8700',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#d0d7de'
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
    },
    terminalPalette: {
      black: '#2a333d',
      red: '#f36e6e',
      green: '#7fc06e',
      yellow: '#eebe6c',
      blue: '#6c9cf4',
      magenta: '#c586c0',
      cyan: '#5fb3b3',
      white: '#d9dbde',
      brightBlack: '#55606d',
      brightRed: '#f78c8c',
      brightGreen: '#9bd08a',
      brightYellow: '#f3cf8e',
      brightBlue: '#8fb3f7',
      brightMagenta: '#d8a6d3',
      brightCyan: '#83cccc',
      brightWhite: '#f0f2f4'
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
    },
    terminalPalette: {
      black: '#2a2f33',
      red: '#d03035',
      green: '#22863a',
      yellow: '#b08800',
      blue: '#0366d6',
      magenta: '#6f42c1',
      cyan: '#1b7c83',
      white: '#959da5',
      brightBlack: '#586069',
      brightRed: '#e5534b',
      brightGreen: '#28a745',
      brightYellow: '#dbab09',
      brightBlue: '#2188ff',
      brightMagenta: '#8a63d2',
      brightCyan: '#3192aa',
      brightWhite: '#d1d5da'
    }
  }),
  'ubuntu-terminal': makeTheme({
    id: 'ubuntu-terminal',
    name: 'Ubuntu Terminal',
    group: 'official',
    appearance: 'dark',
    surfaceFinish: 'clear',
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
    },
    terminalPalette: {
      black: '#282726',
      red: '#d14d41',
      green: '#879a39',
      yellow: '#d0a215',
      blue: '#4385be',
      magenta: '#ce5d97',
      cyan: '#3aa99f',
      white: '#b7b5ac',
      brightBlack: '#575653',
      brightRed: '#e8705f',
      brightGreen: '#a0af54',
      brightYellow: '#e3b62f',
      brightBlue: '#66a0d8',
      brightMagenta: '#e47eb0',
      brightCyan: '#5abdb3',
      brightWhite: '#cecdc3'
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
    },
    terminalPalette: {
      black: '#100f0f',
      red: '#af3029',
      green: '#66800b',
      yellow: '#ad8301',
      blue: '#205ea6',
      magenta: '#a02f6f',
      cyan: '#24837b',
      white: '#b7b5ac',
      brightBlack: '#6f6e69',
      brightRed: '#d14d41',
      brightGreen: '#879a39',
      brightYellow: '#d0a215',
      brightBlue: '#4385be',
      brightMagenta: '#ce5d97',
      brightCyan: '#3aa99f',
      brightWhite: '#e6e4d9'
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
    },
    terminalPalette: {
      black: '#090618',
      red: '#c34043',
      green: '#76946a',
      yellow: '#c0a36e',
      blue: '#7e9cd8',
      magenta: '#957fb8',
      cyan: '#6a9589',
      white: '#c8c093',
      brightBlack: '#727169',
      brightRed: '#e82424',
      brightGreen: '#98bb6c',
      brightYellow: '#e6c384',
      brightBlue: '#7fb4ca',
      brightMagenta: '#938aa9',
      brightCyan: '#7aa89f',
      brightWhite: '#dcd7ba'
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
    },
    terminalPalette: {
      black: '#0d0c0c',
      red: '#c4746e',
      green: '#8a9a7b',
      yellow: '#c4b28a',
      blue: '#8ba4b0',
      magenta: '#a292a3',
      cyan: '#8ea4a2',
      white: '#c8c093',
      brightBlack: '#a6a69c',
      brightRed: '#e46876',
      brightGreen: '#87a987',
      brightYellow: '#e6c384',
      brightBlue: '#7fb4ca',
      brightMagenta: '#938aa9',
      brightCyan: '#7aa89f',
      brightWhite: '#c5c9c5'
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
    },
    terminalPalette: {
      black: '#545464',
      red: '#c84053',
      green: '#6f894e',
      yellow: '#836f4a',
      blue: '#4d699b',
      magenta: '#b35b79',
      cyan: '#597b75',
      white: '#a8a48d',
      brightBlack: '#8a8980',
      brightRed: '#d7474b',
      brightGreen: '#7d9868',
      brightYellow: '#a28a50',
      brightBlue: '#6693bf',
      brightMagenta: '#c86a86',
      brightCyan: '#6e8e87',
      brightWhite: '#e7dba0'
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
    },
    terminalPalette: {
      black: '#123055',
      red: '#2a6fc7',
      green: '#66b2ff',
      yellow: '#99ccff',
      blue: '#4d9fff',
      magenta: '#8ab8ff',
      cyan: '#4dc3ff',
      white: '#b3d9ff',
      brightBlack: '#33608f',
      brightRed: '#4d88e0',
      brightGreen: '#85c2ff',
      brightYellow: '#b3dbff',
      brightBlue: '#70b2ff',
      brightMagenta: '#a6c8ff',
      brightCyan: '#7fd7ff',
      brightWhite: '#e0f0ff'
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
    },
    terminalPalette: {
      black: '#0a3d1a',
      red: '#00b300',
      green: '#00ff41',
      yellow: '#7dff7d',
      blue: '#00e6a8',
      magenta: '#00bb88',
      cyan: '#33ffc2',
      white: '#ccffcc',
      brightBlack: '#1f6b38',
      brightRed: '#33cc33',
      brightGreen: '#66ff85',
      brightYellow: '#b3ffb3',
      brightBlue: '#4dffc4',
      brightMagenta: '#33d4a3',
      brightCyan: '#80ffd6',
      brightWhite: '#eaffea'
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
    },
    terminalPalette: {
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
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
    },
    terminalPalette: {
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f37799',
      brightGreen: '#89d88b',
      brightYellow: '#ebd391',
      brightBlue: '#74a8fc',
      brightMagenta: '#f2aede',
      brightCyan: '#6bd7ca',
      brightWhite: '#cdd6f4'
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
    },
    terminalPalette: {
      black: '#5c5f77',
      red: '#d20f39',
      green: '#40a02b',
      yellow: '#df8e1d',
      blue: '#1e66f5',
      magenta: '#ea76cb',
      cyan: '#179299',
      white: '#acb0be',
      brightBlack: '#6c6f85',
      brightRed: '#de293e',
      brightGreen: '#49af3d',
      brightYellow: '#eea02d',
      brightBlue: '#456eff',
      brightMagenta: '#fe85d8',
      brightCyan: '#2d9fa8',
      brightWhite: '#bcc0cc'
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
    },
    terminalPalette: {
      black: '#32302f',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
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
    },
    terminalPalette: {
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#cb727b',
      brightGreen: '#b0c99b',
      brightYellow: '#f0d8a8',
      brightBlue: '#8fabc7',
      brightMagenta: '#c19dbb',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  }),
  'solarized-light': makeTheme({
    id: 'solarized-light',
    name: 'Solarized Light',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#f4eedb',
      surface: '#fdf6e3',
      surfaceMuted: '#eee8d5',
      surfaceStrong: '#e4dcc3',
      border: '#d3cbb7',
      text: '#073642',
      textMuted: '#586e75',
      accent: '#268bd2',
      accentSecondary: '#2aa198',
      success: '#859900',
      warning: '#b58900',
      danger: '#dc322f',
      shadow: '0 18px 42px rgb(88 74 40 / 0.16)'
    },
    terminalPalette: {
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#93a1a1',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#9cb305',
      brightYellow: '#d1a416',
      brightBlue: '#4ba3dd',
      brightMagenta: '#6c71c4',
      brightCyan: '#3cbcb2',
      brightWhite: '#fdf6e3'
    }
  }),
  'one-light': makeTheme({
    id: 'one-light',
    name: 'One Light',
    group: 'official',
    appearance: 'light',
    surfaceFinish: 'clear',
    core: {
      bg: '#f2f2f3',
      surface: '#fafafa',
      surfaceMuted: '#eaeaeb',
      surfaceStrong: '#dbdbdc',
      border: '#c5c5c8',
      text: '#383a42',
      textMuted: '#696c77',
      accent: '#4078f2',
      accentSecondary: '#0184bc',
      success: '#50a14f',
      warning: '#c18401',
      danger: '#e45649',
      shadow: lightShadow
    },
    terminalPalette: {
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#a0a1a7',
      brightBlack: '#565963',
      brightRed: '#ec7063',
      brightGreen: '#67b26a',
      brightYellow: '#d9a441',
      brightBlue: '#6a95f5',
      brightMagenta: '#c05fc0',
      brightCyan: '#2ba4d4',
      brightWhite: '#ffffff'
    }
  }),
  'gruvbox-light': makeTheme({
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    group: 'official',
    appearance: 'light',
    surfaceFinish: 'clear',
    core: {
      bg: '#f5ecc5',
      surface: '#fbf1c7',
      surfaceMuted: '#ebdbb2',
      surfaceStrong: '#d5c4a1',
      border: '#bdae93',
      text: '#3c3836',
      textMuted: '#665c54',
      accent: '#076678',
      accentSecondary: '#427b58',
      success: '#79740e',
      warning: '#b57614',
      danger: '#9d0006',
      shadow: '0 18px 42px rgb(80 66 40 / 0.16)'
    },
    terminalPalette: {
      black: '#3c3836',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#7c6f64',
      brightBlack: '#928374',
      brightRed: '#9d0006',
      brightGreen: '#79740e',
      brightYellow: '#b57614',
      brightBlue: '#076678',
      brightMagenta: '#8f3f71',
      brightCyan: '#427b58',
      brightWhite: '#ebdbb2'
    }
  }),
  'nord-snowstorm': makeTheme({
    id: 'nord-snowstorm',
    name: 'Nord Snow Storm',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#e5e9f0',
      surface: '#eceff4',
      surfaceMuted: '#dde3ec',
      surfaceStrong: '#ccd4e0',
      border: '#b4bfd0',
      text: '#2e3440',
      textMuted: '#556077',
      accent: '#5272a3',
      accentSecondary: '#40808f',
      success: '#5f8752',
      warning: '#9e7c37',
      danger: '#a54e57',
      shadow: '0 18px 42px rgb(46 52 64 / 0.14)'
    },
    terminalPalette: {
      black: '#3b4252',
      red: '#a54e57',
      green: '#5f8752',
      yellow: '#a8853c',
      blue: '#5272a3',
      magenta: '#8d6a92',
      cyan: '#507e88',
      white: '#7b88a1',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#7f9f6e',
      brightYellow: '#c1a15e',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#6e9ba6',
      brightWhite: '#d8dee9'
    }
  }),
  'rose-pine-dawn': makeTheme({
    id: 'rose-pine-dawn',
    name: 'Rose Pine Dawn',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#faf4ed',
      surface: '#fffaf3',
      surfaceMuted: '#f2e9e1',
      surfaceStrong: '#e5dbd2',
      border: '#cecacd',
      text: '#575279',
      textMuted: '#797593',
      accent: '#286983',
      accentSecondary: '#907aa9',
      success: '#56949f',
      warning: '#c98322',
      danger: '#b4637a',
      shadow: '0 18px 42px rgb(87 82 121 / 0.14)'
    },
    terminalPalette: {
      black: '#575279',
      red: '#b4637a',
      green: '#286983',
      yellow: '#c98322',
      blue: '#56949f',
      magenta: '#907aa9',
      cyan: '#d7827e',
      white: '#9893a5',
      brightBlack: '#797593',
      brightRed: '#c98096',
      brightGreen: '#3a7f9c',
      brightYellow: '#ea9d34',
      brightBlue: '#6ba7b3',
      brightMagenta: '#a68abd',
      brightCyan: '#e19c98',
      brightWhite: '#f2e9e1'
    }
  }),
  'ayu-light': makeTheme({
    id: 'ayu-light',
    name: 'Ayu Light',
    group: 'official',
    appearance: 'light',
    surfaceFinish: 'clear',
    core: {
      bg: '#f3f4f5',
      surface: '#fcfcfc',
      surfaceMuted: '#ebedef',
      surfaceStrong: '#dadde1',
      border: '#c4cad1',
      text: '#40454a',
      textMuted: '#656f79',
      accent: '#1c7ec7',
      accentSecondary: '#8757ba',
      success: '#5f8f00',
      warning: '#a87513',
      danger: '#cc4d4d',
      shadow: lightShadow
    },
    terminalPalette: {
      black: '#33383d',
      red: '#cf4f4f',
      green: '#6f9414',
      yellow: '#a87513',
      blue: '#1c7ec7',
      magenta: '#8757ba',
      cyan: '#2f9e83',
      white: '#9da3aa',
      brightBlack: '#5c6166',
      brightRed: '#f07171',
      brightGreen: '#86b300',
      brightYellow: '#f2ae49',
      brightBlue: '#399ee6',
      brightMagenta: '#a37acc',
      brightCyan: '#4cbf99',
      brightWhite: '#e7eaed'
    }
  }),
  // 亮黑:对齐 macOS iTerm2 的观感——纯黑终端底、银灰前景、macOS 系统色点缀、
  // iTerm2 默认 ANSI 调色板(black 槽位提亮避免与纯黑底融合)。
  'obsidian-black': makeTheme({
    id: 'obsidian-black',
    name: 'Obsidian Black',
    group: 'official',
    appearance: 'dark',
    surfaceFinish: 'clear',
    core: {
      bg: '#000000',
      surface: '#111113',
      surfaceMuted: '#1a1a1d',
      surfaceStrong: '#26262a',
      border: '#38383e',
      text: '#dcdcdc',
      textMuted: '#98989f',
      accent: '#0a84ff',
      accentSecondary: '#64d2ff',
      success: '#32d74b',
      warning: '#ffd60a',
      danger: '#ff453a',
      shadow: '0 18px 48px rgb(0 0 0 / 0.55)'
    },
    terminalPalette: {
      foreground: '#c7c7c7',
      cursor: '#c7c7c7',
      selectionBackground: '#4d9dff55',
      black: '#262626',
      red: '#c91b00',
      green: '#00c200',
      yellow: '#c7c400',
      blue: '#2445d4',
      magenta: '#ca30c7',
      cyan: '#00c5c7',
      white: '#c7c7c7',
      brightBlack: '#686868',
      brightRed: '#ff6e67',
      brightGreen: '#5ffa68',
      brightYellow: '#fffc67',
      brightBlue: '#6871ff',
      brightMagenta: '#ff77ff',
      brightCyan: '#60fdff',
      brightWhite: '#ffffff'
    }
  }),
  'sakura-blossom': makeTheme({
    id: 'sakura-blossom',
    name: 'Sakura Blossom',
    group: 'official',
    appearance: 'light',
    core: {
      bg: '#faeef2',
      surface: '#fff7f9',
      surfaceMuted: '#f7e3e9',
      surfaceStrong: '#eed3dc',
      border: '#dcb6c4',
      text: '#4a2c3a',
      textMuted: '#7f576b',
      accent: '#d64d8a',
      accentSecondary: '#9b6bb3',
      success: '#3d8f63',
      warning: '#b8791f',
      danger: '#d23d5e',
      shadow: '0 18px 42px rgb(120 60 90 / 0.16)'
    },
    terminalPalette: {
      black: '#4a2c3a',
      red: '#d23d5e',
      green: '#3d8f63',
      yellow: '#b8791f',
      blue: '#6a7bd8',
      magenta: '#d64d8a',
      cyan: '#3f9baa',
      white: '#c9a8b6',
      brightBlack: '#7d5a6d',
      brightRed: '#e76a85',
      brightGreen: '#57b283',
      brightYellow: '#d9a04a',
      brightBlue: '#8b93e8',
      brightMagenta: '#ea77ab',
      brightCyan: '#5cb4c2',
      brightWhite: '#fff0f5'
    }
  }),
  'neon-pink': makeTheme({
    id: 'neon-pink',
    name: 'Neon Pink',
    group: 'official',
    appearance: 'dark',
    core: {
      bg: '#16080f',
      surface: '#200d18',
      surfaceMuted: '#2a1220',
      surfaceStrong: '#38182b',
      border: '#55243f',
      text: '#f7e3ee',
      textMuted: '#bd8ca6',
      accent: '#ff3d9a',
      accentSecondary: '#c77dff',
      success: '#3ddc97',
      warning: '#ffb454',
      danger: '#ff4d6d',
      shadow: '0 18px 48px rgb(40 5 25 / 0.5)'
    },
    terminalPalette: {
      black: '#3a1830',
      red: '#ff4d6d',
      green: '#3ddc97',
      yellow: '#ffc069',
      blue: '#7a8cff',
      magenta: '#ff3d9a',
      cyan: '#4dd8e6',
      white: '#f2d7e5',
      brightBlack: '#5e2c4c',
      brightRed: '#ff7a90',
      brightGreen: '#6ee9b4',
      brightYellow: '#ffd493',
      brightBlue: '#9fb0ff',
      brightMagenta: '#ff70b5',
      brightCyan: '#79e6f0',
      brightWhite: '#fff0f7'
    }
  }),
  'rose-milk': makeTheme({
    id: 'rose-milk',
    name: 'Rose Milk',
    group: 'official',
    appearance: 'light',
    surfaceFinish: 'clear',
    core: {
      bg: '#f8ecea',
      surface: '#fdf6f4',
      surfaceMuted: '#f2e0dd',
      surfaceStrong: '#e7cdc9',
      border: '#d3aea8',
      text: '#503732',
      textMuted: '#7f5c55',
      accent: '#c25e7d',
      accentSecondary: '#9a6fb5',
      success: '#4f8f5e',
      warning: '#a87513',
      danger: '#c74854',
      shadow: '0 18px 42px rgb(110 70 65 / 0.15)'
    },
    terminalPalette: {
      black: '#503732',
      red: '#c74854',
      green: '#4f8f5e',
      yellow: '#ab7c26',
      blue: '#6a7fc9',
      magenta: '#c25e7d',
      cyan: '#4899a4',
      white: '#c4a8a2',
      brightBlack: '#7f5c55',
      brightRed: '#de6d77',
      brightGreen: '#6cab7a',
      brightYellow: '#c99a44',
      brightBlue: '#8a9cdd',
      brightMagenta: '#d97f9c',
      brightCyan: '#66b3bd',
      brightWhite: '#fbf1ef'
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

// Teleport 到 body 的弹层(右键菜单、下拉、tooltip)不在 .app-body.module-* 作用域内,
// 只能继承 html 上的变量。这里把 workspace 模块的 base 层平铺成 --theme-module-active-*
// 内联默认值;.app-shell 内部的 class 作用域声明仍会按当前模块/背景层覆盖它。
const moduleActiveFallbackVariables = (theme: ThemeDefinition) => {
  const variables: Record<string, string> = {}
  const { base, withBackground, ...plain } = theme.modules.workspace
  void withBackground
  flattenRecord('--theme-module-active', plain as unknown as Record<string, unknown>, variables)
  flattenRecord('--theme-module-active', base as unknown as Record<string, unknown>, variables)
  return variables
}

// setProperty 每次都会重新序列化整个内联样式,主题包含数百个变量时重复全量写入的
// 开销是平方级的;按根元素缓存上次写入的值,只落差量。
const appliedThemeVariables = new WeakMap<HTMLElement, Record<string, string>>()

export const applyThemeToDocument = (theme: string) => {
  if (typeof document === 'undefined') return resolveThemePreset(theme)
  const preset = resolveThemePreset(theme)
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(`theme-${preset.appearance}`)
  root.dataset.theme = preset.appearance
  root.dataset.themeId = preset.id
  root.dataset.themePreference = isThemeId(theme) ? theme : 'dark'
  const variables: Record<string, string> = {
    'color-scheme': preset.appearance,
    ...themeCssVariables(preset),
    ...terminalActiveSurfaceVariables(preset),
    ...moduleActiveFallbackVariables(preset)
  }
  const applied = appliedThemeVariables.get(root) || {}
  for (const [key, value] of Object.entries(variables)) {
    if (applied[key] === value) continue
    root.style.setProperty(key, value)
  }
  for (const key of Object.keys(applied)) {
    if (!(key in variables)) root.style.removeProperty(key)
  }
  appliedThemeVariables.set(root, variables)
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
