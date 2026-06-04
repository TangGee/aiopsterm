import { describe, expect, it } from 'vitest'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import type { KeywordHighlightUserConfig } from '@shared/preload'

const createConfig = (rules: KeywordHighlightUserConfig['keyword-highlight']['rules'], applyTo = { output: true, input: true }): KeywordHighlightUserConfig => ({
  'keyword-highlight': {
    enabled: true,
    applyTo,
    rules
  }
})

describe('keyword highlight runtime', () => {
  it('applies regex rules with External reference-style case-insensitive prefix', () => {
    const config = createConfig([
      {
        name: 'error',
        enabled: true,
        scope: 'output',
        matchType: 'regex',
        pattern: '(?i)\\berror\\b',
        style: {
          foreground: '#FF0000',
          fontStyle: 'bold'
        }
      }
    ])

    const result = applyKeywordHighlight(config, 'ERROR occurred', 'output')

    expect(result).toContain('\x1b[1;38;5;')
    expect(result).toContain('ERROR')
    expect(result).not.toBe('ERROR occurred')
  })

  it('respects output and input scopes', () => {
    const config = createConfig([
      {
        name: 'sudo',
        enabled: true,
        scope: 'input',
        matchType: 'regex',
        pattern: 'sudo',
        style: {
          foreground: '#E6B450',
          fontStyle: 'bold'
        }
      }
    ])

    expect(applyKeywordHighlight(config, 'sudo systemctl restart nginx', 'output')).toBe('sudo systemctl restart nginx')
    expect(applyKeywordHighlight(config, 'sudo systemctl restart nginx', 'input')).not.toBe('sudo systemctl restart nginx')
  })

  it('applies wildcard arrays and skips disabled rules', () => {
    const config = createConfig([
      {
        name: 'disabled',
        enabled: false,
        scope: 'output',
        matchType: 'regex',
        pattern: 'ignored',
        style: {
          foreground: '#FF0000',
          fontStyle: 'bold'
        }
      },
      {
        name: 'config files',
        enabled: true,
        scope: 'output',
        matchType: 'wildcard',
        pattern: ['/etc/*', '*.conf'],
        style: {
          foreground: '#00FFFF',
          fontStyle: 'normal'
        }
      }
    ])

    const result = applyKeywordHighlight(config, 'open /etc/nginx/nginx.conf', 'output')

    expect(result).toContain('/etc/nginx/nginx.conf')
    expect(result).toContain('\x1b[38;5;')
    expect(applyKeywordHighlight(config, 'ignored only', 'output')).toBe('ignored only')
  })

  it('preserves existing ANSI state around highlighted matches', () => {
    const config = createConfig([
      {
        name: 'sudo',
        enabled: true,
        scope: 'output',
        matchType: 'regex',
        pattern: 'sudo',
        style: {
          foreground: '#AF52DE',
          fontStyle: 'bold'
        }
      }
    ])

    const result = applyKeywordHighlight(config, '\x1b[31m\x1b[47msudo command\x1b[0m', 'output')

    expect(result).toContain('\x1b[31m\x1b[47m')
    expect(result).toContain('sudo')
    expect(result).toContain('\x1b[0m')
  })

  it('returns original text when disabled or applyTo scope is off', () => {
    const config: KeywordHighlightUserConfig = {
      'keyword-highlight': {
        enabled: false,
        applyTo: {
          output: true,
          input: true
        },
        rules: [
          {
            name: 'error',
            enabled: true,
            scope: 'both',
            matchType: 'regex',
            pattern: 'error',
            style: {
              foreground: '#FF0000',
              fontStyle: 'bold'
            }
          }
        ]
      }
    }

    expect(applyKeywordHighlight(config, 'error', 'output')).toBe('error')
    config['keyword-highlight'].enabled = true
    config['keyword-highlight'].applyTo.output = false
    expect(applyKeywordHighlight(config, 'error', 'output')).toBe('error')
  })
})
