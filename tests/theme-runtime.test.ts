import { describe, expect, it } from 'vitest'
import { isThemeId, resolveThemePreset } from '@/services/app/themeRuntime'
import { terminalThemeForAppTheme } from '@/services/terminal/terminalThemeRuntime'
import { settingsThemeOptions } from '@/config/settings'

describe('theme runtime', () => {
  it('registers Ubuntu Terminal as an official app theme', () => {
    expect(isThemeId('ubuntu-terminal')).toBe(true)
    expect(resolveThemePreset('ubuntu-terminal')).toMatchObject({
      id: 'ubuntu-terminal',
      name: 'Ubuntu Terminal',
      appearance: 'dark',
      tokens: expect.objectContaining({
        '--bg': '#300A24',
        '--accent': '#3465a4',
        '--accent-2': '#4e9a06'
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

  it('uses the Ubuntu/GNOME Terminal ANSI palette for Ubuntu Terminal', () => {
    expect(terminalThemeForAppTheme('ubuntu-terminal')).toEqual(
      expect.objectContaining({
        background: '#300A24',
        foreground: '#ffffff',
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
    expect(terminalThemeForAppTheme('ubuntu-terminal', { transparentBackground: true })).toEqual(
      expect.objectContaining({
        background: '#300A24',
        green: '#4e9a06',
        blue: '#3465a4'
      })
    )
  })
})
