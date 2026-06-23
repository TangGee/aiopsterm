export type ThemeAppearance = 'dark' | 'light'

export type ThemeId =
  | 'auto'
  | 'dark'
  | 'light'
  | 'termius-dark'
  | 'termius-light'
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

type ThemeTokens = {
  '--bg': string
  '--surface': string
  '--surface-2': string
  '--surface-3': string
  '--border': string
  '--text': string
  '--muted': string
  '--accent': string
  '--accent-2': string
  '--success': string
  '--warn': string
  '--danger': string
  '--shadow': string
}

export type ThemePreset = {
  id: Exclude<ThemeId, 'auto'>
  name: string
  appearance: ThemeAppearance
  tokens: ThemeTokens
}

const darkShadow = '0 18px 48px rgb(0 0 0 / 0.28)'
const lightShadow = '0 18px 42px rgb(36 47 70 / 0.14)'

export const themePresets: Record<Exclude<ThemeId, 'auto'>, ThemePreset> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    appearance: 'dark',
    tokens: {
      '--bg': '#0f1117',
      '--surface': '#151922',
      '--surface-2': '#1b202b',
      '--surface-3': '#232938',
      '--border': '#2b3242',
      '--text': '#e6eaf2',
      '--muted': '#8993a8',
      '--accent': '#56b6c2',
      '--accent-2': '#8ccf7e',
      '--success': '#8ccf7e',
      '--warn': '#e6b450',
      '--danger': '#e06c75',
      '--shadow': darkShadow
    }
  },
  light: {
    id: 'light',
    name: 'Light',
    appearance: 'light',
    tokens: {
      '--bg': '#eef1f6',
      '--surface': '#ffffff',
      '--surface-2': '#f6f8fb',
      '--surface-3': '#e8edf4',
      '--border': '#d7deea',
      '--text': '#1d2430',
      '--muted': '#697386',
      '--accent': '#1677ff',
      '--accent-2': '#2f9e44',
      '--success': '#2f9e44',
      '--warn': '#b7791f',
      '--danger': '#d64545',
      '--shadow': lightShadow
    }
  },
  'termius-dark': {
    id: 'termius-dark',
    name: 'Termius Dark',
    appearance: 'dark',
    tokens: {
      '--bg': '#111417',
      '--surface': '#191f24',
      '--surface-2': '#202830',
      '--surface-3': '#2a3440',
      '--border': '#33414f',
      '--text': '#d9dbde',
      '--muted': '#9aa8b7',
      '--accent': '#6c9cf4',
      '--accent-2': '#7fc06e',
      '--success': '#7fc06e',
      '--warn': '#eebe6c',
      '--danger': '#f36e6e',
      '--shadow': darkShadow
    }
  },
  'termius-light': {
    id: 'termius-light',
    name: 'Termius Light',
    appearance: 'light',
    tokens: {
      '--bg': '#f4f7fb',
      '--surface': '#ffffff',
      '--surface-2': '#eef3f8',
      '--surface-3': '#dfe8f2',
      '--border': '#cad6e2',
      '--text': '#2a2f33',
      '--muted': '#69737d',
      '--accent': '#0366d6',
      '--accent-2': '#22863a',
      '--success': '#22863a',
      '--warn': '#b08800',
      '--danger': '#d03035',
      '--shadow': lightShadow
    }
  },
  'flexoki-dark': {
    id: 'flexoki-dark',
    name: 'Flexoki Dark',
    appearance: 'dark',
    tokens: {
      '--bg': '#100f0f',
      '--surface': '#1c1b1a',
      '--surface-2': '#282726',
      '--surface-3': '#343331',
      '--border': '#403e3c',
      '--text': '#cecdc3',
      '--muted': '#878580',
      '--accent': '#da702c',
      '--accent-2': '#3aa99f',
      '--success': '#879a39',
      '--warn': '#d0a215',
      '--danger': '#d14d41',
      '--shadow': darkShadow
    }
  },
  'flexoki-light': {
    id: 'flexoki-light',
    name: 'Flexoki Light',
    appearance: 'light',
    tokens: {
      '--bg': '#fffcf0',
      '--surface': '#f7f3e3',
      '--surface-2': '#f2edda',
      '--surface-3': '#e6deca',
      '--border': '#d8d0bf',
      '--text': '#100f0f',
      '--muted': '#6f6e69',
      '--accent': '#205ea6',
      '--accent-2': '#24837b',
      '--success': '#66800b',
      '--warn': '#ad8301',
      '--danger': '#af3029',
      '--shadow': lightShadow
    }
  },
  'kanagawa-wave': {
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    appearance: 'dark',
    tokens: {
      '--bg': '#1f1f28',
      '--surface': '#252535',
      '--surface-2': '#2a2a37',
      '--surface-3': '#363646',
      '--border': '#47475c',
      '--text': '#dcd7ba',
      '--muted': '#938aa9',
      '--accent': '#7e9cd8',
      '--accent-2': '#7aa89f',
      '--success': '#98bb6c',
      '--warn': '#e6c384',
      '--danger': '#e82424',
      '--shadow': darkShadow
    }
  },
  'kanagawa-dragon': {
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    appearance: 'dark',
    tokens: {
      '--bg': '#181616',
      '--surface': '#211f1f',
      '--surface-2': '#282424',
      '--surface-3': '#332e2e',
      '--border': '#453f3f',
      '--text': '#c5c9c5',
      '--muted': '#a6a69c',
      '--accent': '#8ba4b0',
      '--accent-2': '#87a987',
      '--success': '#87a987',
      '--warn': '#e6c384',
      '--danger': '#e46876',
      '--shadow': darkShadow
    }
  },
  'kanagawa-lotus': {
    id: 'kanagawa-lotus',
    name: 'Kanagawa Lotus',
    appearance: 'light',
    tokens: {
      '--bg': '#f2ecbc',
      '--surface': '#fff7d6',
      '--surface-2': '#ebe3b1',
      '--surface-3': '#d8cca0',
      '--border': '#c4b985',
      '--text': '#545464',
      '--muted': '#77713f',
      '--accent': '#4d699b',
      '--accent-2': '#597b75',
      '--success': '#6f894e',
      '--warn': '#836f4a',
      '--danger': '#c84053',
      '--shadow': lightShadow
    }
  },
  'hacker-blue': {
    id: 'hacker-blue',
    name: 'Hacker Blue',
    appearance: 'dark',
    tokens: {
      '--bg': '#000814',
      '--surface': '#001529',
      '--surface-2': '#00203d',
      '--surface-3': '#003366',
      '--border': '#0b4f8a',
      '--text': '#b3d9ff',
      '--muted': '#66b2ff',
      '--accent': '#4d9fff',
      '--accent-2': '#4dc3ff',
      '--success': '#66b2ff',
      '--warn': '#80bfff',
      '--danger': '#2a6fc7',
      '--shadow': '0 18px 48px rgb(0 25 80 / 0.36)'
    }
  },
  'hacker-green': {
    id: 'hacker-green',
    name: 'Hacker Green',
    appearance: 'dark',
    tokens: {
      '--bg': '#001000',
      '--surface': '#001a00',
      '--surface-2': '#002400',
      '--surface-3': '#003300',
      '--border': '#006600',
      '--text': '#ccffcc',
      '--muted': '#66ff66',
      '--accent': '#00ff41',
      '--accent-2': '#00bb88',
      '--success': '#00ff41',
      '--warn': '#66ff66',
      '--danger': '#00c000',
      '--shadow': '0 18px 48px rgb(0 80 0 / 0.36)'
    }
  },
  'dracula-night': {
    id: 'dracula-night',
    name: 'Dracula Night',
    appearance: 'dark',
    tokens: {
      '--bg': '#282a36',
      '--surface': '#303241',
      '--surface-2': '#343746',
      '--surface-3': '#44475a',
      '--border': '#55586f',
      '--text': '#f8f8f2',
      '--muted': '#bdc3e6',
      '--accent': '#bd93f9',
      '--accent-2': '#8be9fd',
      '--success': '#50fa7b',
      '--warn': '#f1fa8c',
      '--danger': '#ff5555',
      '--shadow': darkShadow
    }
  },
  'catppuccin-mocha': {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    appearance: 'dark',
    tokens: {
      '--bg': '#1e1e2e',
      '--surface': '#252538',
      '--surface-2': '#313244',
      '--surface-3': '#45475a',
      '--border': '#585b70',
      '--text': '#cdd6f4',
      '--muted': '#a6adc8',
      '--accent': '#89b4fa',
      '--accent-2': '#94e2d5',
      '--success': '#a6e3a1',
      '--warn': '#f9e2af',
      '--danger': '#f38ba8',
      '--shadow': darkShadow
    }
  },
  'catppuccin-latte': {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    appearance: 'light',
    tokens: {
      '--bg': '#eff1f5',
      '--surface': '#ffffff',
      '--surface-2': '#e6e9ef',
      '--surface-3': '#ccd0da',
      '--border': '#bcc0cc',
      '--text': '#4c4f69',
      '--muted': '#6c6f85',
      '--accent': '#1e66f5',
      '--accent-2': '#179299',
      '--success': '#40a02b',
      '--warn': '#df8e1d',
      '--danger': '#d20f39',
      '--shadow': lightShadow
    }
  },
  'gruvbox-dark': {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    appearance: 'dark',
    tokens: {
      '--bg': '#282828',
      '--surface': '#32302f',
      '--surface-2': '#3c3836',
      '--surface-3': '#504945',
      '--border': '#665c54',
      '--text': '#ebdbb2',
      '--muted': '#a89984',
      '--accent': '#83a598',
      '--accent-2': '#8ec07c',
      '--success': '#b8bb26',
      '--warn': '#fabd2f',
      '--danger': '#fb4934',
      '--shadow': darkShadow
    }
  },
  'nord-frost': {
    id: 'nord-frost',
    name: 'Nord Frost',
    appearance: 'dark',
    tokens: {
      '--bg': '#2e3440',
      '--surface': '#343b49',
      '--surface-2': '#3b4252',
      '--surface-3': '#434c5e',
      '--border': '#4c566a',
      '--text': '#d8dee9',
      '--muted': '#aeb8c8',
      '--accent': '#81a1c1',
      '--accent-2': '#88c0d0',
      '--success': '#a3be8c',
      '--warn': '#ebcb8b',
      '--danger': '#bf616a',
      '--shadow': darkShadow
    }
  }
}

const themeVariables = Object.keys(themePresets.dark.tokens) as Array<keyof ThemeTokens>

export const isThemeId = (theme: string): theme is ThemeId => theme === 'auto' || Object.prototype.hasOwnProperty.call(themePresets, theme)

export const getSystemTheme = (): ThemeAppearance => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  return 'light'
}

export const resolveEffectiveThemeId = (theme: string, system: ThemeAppearance = getSystemTheme()): Exclude<ThemeId, 'auto'> => {
  if (theme === 'auto') return system
  return Object.prototype.hasOwnProperty.call(themePresets, theme) ? (theme as Exclude<ThemeId, 'auto'>) : 'dark'
}

export const resolveThemePreset = (theme: string, system: ThemeAppearance = getSystemTheme()) => themePresets[resolveEffectiveThemeId(theme, system)]

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
  for (const key of themeVariables) {
    root.style.setProperty(key, preset.tokens[key])
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
