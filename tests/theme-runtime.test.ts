import { describe, expect, it } from 'vitest'
import { isThemeId, resolveThemePreset, themeCssVariables, themeModuleKeys, themePresets } from '@/services/app/themeRuntime'
import { terminalThemeForAppTheme } from '@/services/terminal/terminalThemeRuntime'
import { settingsThemeOptions } from '@/config/settings'

describe('theme runtime', () => {
  it('registers Ubuntu Terminal as an official app theme', () => {
    expect(isThemeId('ubuntu-terminal')).toBe(true)
    expect(resolveThemePreset('ubuntu-terminal')).toMatchObject({
      id: 'ubuntu-terminal',
      name: 'Ubuntu Terminal',
      appearance: 'dark',
      core: expect.objectContaining({
        bg: '#300A24',
        accent: '#3465a4',
        accentSecondary: '#4e9a06'
      }),
      terminalPalette: expect.objectContaining({
        background: '#300A24',
        contrastBackground: '#300A24',
        minimumContrastRatio: 3,
        base: expect.objectContaining({
          runtimeBackground: '#300A24',
          xtermViewportBg: '#300A24',
          ansiBackground: expect.objectContaining({ black: '#2e3436' }),
          codexAnsiBackground: expect.objectContaining({ black: '#2e3436' })
        }),
        withBackground: expect.objectContaining({
          runtimeBackground: 'rgba(48, 10, 36, 0.7)',
          xtermViewportBg: 'rgba(0, 0, 0, 0)',
          ansiBackground: expect.objectContaining({ black: '#2e3436' }),
          codexAnsiBackground: expect.objectContaining({ black: '#2e3436' })
        })
      })
    })
    expect(settingsThemeOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'ubuntu-terminal',
          label: 'Ubuntu Terminal',
          group: 'official',
          background: '#300A24'
        })
      ])
    )
  })

  it('defines complete module regions for every built-in theme without old css token output', () => {
    const oldTokenPattern = /^--(bg|surface|surface-1|surface-2|surface-3|surface-4|text|muted|border|accent|accent-2|success|warn|warning|danger|shadow|workspace-bg|glass-surface|readable-surface|terminal-host-bg)/
    for (const theme of Object.values(themePresets)) {
      expect(Object.keys(theme.modules).sort()).toEqual([...themeModuleKeys].sort())
      for (const key of themeModuleKeys) {
        expect(theme.modules[key]).toEqual(
          expect.objectContaining({
            text: expect.any(String),
            textMuted: expect.any(String),
            accent: expect.any(String),
            icon: expect.any(String),
            base: expect.objectContaining({
              workspaceBg: expect.any(String),
              panelBg: expect.any(String),
              cardBg: expect.any(String),
              inputBg: expect.any(String),
              border: expect.any(String)
            }),
            withBackground: expect.objectContaining({
              workspaceBg: expect.any(String),
              panelBg: expect.any(String),
              readableBg: expect.any(String),
              border: expect.any(String),
              backdropFilter: expect.any(String)
            })
          })
        )
      }
      const variables = themeCssVariables(theme)
      expect(Object.keys(variables).some((key) => oldTokenPattern.test(key))).toBe(false)
      expect(variables['--theme-module-database-with-background-readable-bg']).toBeTruthy()
      expect(variables['--theme-module-ai-panel-base-panel-bg']).toBeTruthy()
      expect(variables['--theme-terminal-base-pane-bg']).toBeTruthy()
      expect(variables['--theme-terminal-with-background-xterm-viewport-bg']).toBeTruthy()
    }
  })

  it('keeps light terminal palettes and background surfaces readable under app backgrounds', () => {
    const lightThemes = Object.values(themePresets).filter((theme) => theme.appearance === 'light')
    expect(lightThemes.length).toBeGreaterThan(0)
    for (const theme of lightThemes) {
      const clear = theme.surfaceFinish === 'clear'
      expect(theme.shell.bg).toBe(theme.core.bg)
      expect(theme.shell.bgWashWithBackground).not.toContain('46%')
      expect(theme.shell.backdropFilter).toBe(clear ? 'none' : 'blur(16px)')
      for (const key of themeModuleKeys) {
        expect(theme.modules[key].withBackground.workspaceBg).toBe('rgba(0, 0, 0, 0)')
        expect(theme.modules[key].withBackground.panelBg).toMatch(/color-mix/)
        expect(theme.modules[key].withBackground.backdropFilter).toBe(clear ? 'none' : 'blur(16px)')
        expect(theme.modules[key].withBackground.readableBg).toMatch(/color-mix/)
        expect(theme.modules[key].withBackground.overlayBg).toMatch(/color-mix/)
        expect(theme.modules[key].base.border).toBe(theme.core.border)
        expect(theme.modules[key].withBackground.border).toMatch(/color-mix/)
      }
      expect(theme.terminalPalette.black).not.toBe(theme.terminalPalette.background)
      expect(theme.terminalPalette.black).not.toBe(theme.core.bg)
      expect(theme.terminalPalette.white).not.toBe(theme.core.bg)
      expect(theme.terminalPalette.contrastBackground).toBe(theme.core.bg)
      expect(theme.terminalPalette.minimumContrastRatio).toBeGreaterThanOrEqual(3)
      // 浅色主题的终端体在背景图之上必须保留高不透明度洗底,文字才可读;
      // CSS 层的 viewport/screen 保持透明,由 xterm/threaded canvas 绘制洗底。
      expect(theme.terminalPalette.withBackground.paneBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.titleBg).toMatch(/^rgba\(/)
      expect(theme.terminalPalette.withBackground.titleBg).not.toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.runtimeBackground).toMatch(/0\.94\)$/)
      expect(theme.terminalPalette.withBackground.xtermViewportBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.xtermScreenBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.codexStackBg).not.toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.codexStackBackdropFilter).toBe(clear ? 'none' : 'blur(10px)')
      expect(theme.terminalPalette.withBackground.codexRuntimeBackground).toBe(theme.terminalPalette.withBackground.runtimeBackground)
      expect(theme.terminalPalette.withBackground.codexXtermViewportBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.codexXtermScreenBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.ansiBackground.black).toBe(theme.terminalPalette.black)
      // Codex 的 ANSI 黑背景映射到可读洗底表面,而不是全透明或前景黑
      expect(theme.terminalPalette.withBackground.codexAnsiBackground.black).toBe(theme.terminalPalette.withBackground.codexRuntimeBackground)
      expect(theme.terminalPalette.withBackground.codexAnsiBackground.black).not.toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.codexAnsiBackground.black).not.toBe(theme.terminalPalette.black)
      expect(terminalThemeForAppTheme(theme.id, { surfaceMode: 'withBackground' })).toEqual(
        expect.objectContaining({
          background: theme.terminalPalette.withBackground.runtimeBackground,
          ansiBackground: expect.objectContaining({ black: theme.terminalPalette.black })
        })
      )
      expect(terminalThemeForAppTheme(theme.id, { surface: 'codex', surfaceMode: 'withBackground' })).toEqual(
        expect.objectContaining({
          background: theme.terminalPalette.withBackground.codexRuntimeBackground,
          ansiBackground: expect.objectContaining({ black: theme.terminalPalette.withBackground.codexAnsiBackground.black })
        })
      )
    }
  })

  it('keeps every theme fully solid without a background and translucent when one is set', () => {
    // 质感契约:不设背景图时 base 层必须全部是实色表面(没有任何透出);
    // 用户设置了背景图,withBackground 层必须让它透出(半透明表面 + 终端半透明洗底)。
    for (const theme of Object.values(themePresets)) {
      const dark = theme.appearance === 'dark'
      for (const key of themeModuleKeys) {
        const base = theme.modules[key].base
        expect(base.workspaceBg).toBe(theme.core.bg)
        expect(base.panelBg).toBe(theme.core.surface)
        expect(base.backdropFilter).toBe('none')
        for (const value of [base.workspaceBg, base.panelBg, base.cardBg, base.inputBg, base.readableBg, base.overlayBg, base.border]) {
          expect(value, `theme ${theme.id} module ${key} base surface must be opaque`).not.toContain('transparent')
          expect(value).not.toMatch(/rgba\(/)
        }
        const withBackground = theme.modules[key].withBackground
        expect(withBackground.panelBg, `theme ${theme.id} module ${key} must reveal the background`).toMatch(/color-mix.*transparent/)
        // 怎么透由材质决定:亮面(clear)清透无模糊,毛玻璃(frosted)磨砂透出
        expect(withBackground.backdropFilter).toBe(theme.surfaceFinish === 'clear' ? 'none' : 'blur(16px)')
      }
      const terminalBase = theme.terminalPalette.base
      const terminalBg = theme.terminalPalette.background
      expect(terminalBase.paneBg).toBe(terminalBg)
      expect(terminalBase.runtimeBackground).toBe(terminalBg)
      expect(terminalBase.codexRuntimeBackground).toBe(terminalBg)
      expect(terminalBase.codexStackBg).toBe(terminalBg)
      const terminalWithBackground = theme.terminalPalette.withBackground
      expect(terminalWithBackground.runtimeBackground, `theme ${theme.id} terminal must reveal the background`).toMatch(
        dark ? /0\.7\)$/ : /0\.94\)$/
      )
      expect(theme.shell.backdropFilter).toBe(theme.surfaceFinish === 'clear' ? 'none' : 'blur(16px)')
    }
  })

  it('defines a distinguishable 16-color ANSI palette for every built-in theme', () => {
    for (const theme of Object.values(themePresets)) {
      const palette = theme.terminalPalette
      const slots = [
        palette.black,
        palette.red,
        palette.green,
        palette.yellow,
        palette.blue,
        palette.magenta,
        palette.cyan,
        palette.white,
        palette.brightBlack,
        palette.brightRed,
        palette.brightGreen,
        palette.brightYellow,
        palette.brightBlue,
        palette.brightMagenta,
        palette.brightCyan,
        palette.brightWhite
      ]
      expect(new Set(slots.map((color) => color.toLowerCase())).size, `theme ${theme.id} has duplicate ansi slots`).toBe(16)
      expect(palette.black.toLowerCase(), `theme ${theme.id} ansi black is invisible on terminal background`).not.toBe(
        palette.background.toLowerCase()
      )
    }
  })

  it('keeps threaded terminal pane surfaces from covering the shared render canvas', () => {
    for (const theme of Object.values(themePresets)) {
      expect(theme.terminalPalette.base.threadedPaneBg).toBe('rgba(0, 0, 0, 0)')
      expect(theme.terminalPalette.withBackground.threadedPaneBg).toBe('rgba(0, 0, 0, 0)')
    }
  })

  it('uses the Ubuntu/GNOME Terminal ANSI palette for Ubuntu Terminal', () => {
    expect(terminalThemeForAppTheme('ubuntu-terminal')).toEqual(
      expect.objectContaining({
        background: '#300A24',
        contrastBackground: '#300A24',
        foreground: '#ffffff',
        minimumContrastRatio: 3,
        cursor: '#ffffff',
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
        brightWhite: '#eeeeec'
      })
    )
    expect(terminalThemeForAppTheme('ubuntu-terminal', { surfaceMode: 'withBackground' })).toEqual(
      expect.objectContaining({
        background: 'rgba(48, 10, 36, 0.7)',
        cursorAccent: '#300A24',
        green: '#4e9a06',
        blue: '#3465a4'
      })
    )
  })
})
