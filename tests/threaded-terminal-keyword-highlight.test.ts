import { describe, expect, it } from 'vitest'
import {
  compileThreadedKeywordHighlightRules,
  findThreadedKeywordHighlightRuns
} from '@/services/terminal/threadedTerminalKeywordHighlight'
import type { ThreadedTerminalKeywordHighlightConfig } from '@/services/terminal/threadedTerminalProtocol'

const config: ThreadedTerminalKeywordHighlightConfig = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: [
      {
        name: 'error',
        enabled: true,
        scope: 'output',
        matchType: 'regex',
        pattern: '(?i)error',
        style: {
          foreground: '#FF0000',
          fontStyle: 'bold'
        }
      },
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
    ]
  }
}

describe('threadedTerminalKeywordHighlight', () => {
  it('compiles output rules into worker-side highlight runs without mutating text', () => {
    const rules = compileThreadedKeywordHighlightRules(config)
    const text = 'ERROR from shell'

    expect(findThreadedKeywordHighlightRuns(text, rules)).toEqual([
      {
        x: 0,
        text: 'ERROR',
        fg: '#FF0000',
        bold: true
      }
    ])
    expect(text).toBe('ERROR from shell')
  })

  it('does not compile input-only rules for threaded screen snapshots', () => {
    const rules = compileThreadedKeywordHighlightRules(config)

    expect(findThreadedKeywordHighlightRuns('sudo systemctl status nginx', rules)).toEqual([])
  })
})
