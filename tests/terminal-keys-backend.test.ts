import { describe, expect, it } from 'vitest'
import { keyDataForTerminal } from '../src/shared/terminalKeys'

describe('explicit terminal keys', () => {
  it.each([
    ['ctrl shift c', '\x1b[99;6u'], ['CTRL+SHIFT+C', '\x1b[99;6u'], ['shift-control-c', '\x1b[99;6u'],
    ['ctrl alt c', '\x1b\x03'], ['alt ctrl c', '\x1b\x03'], ['alt shift c', '\x1bC'],
    ['ctrl shift up', '\x1b[1;6A'], ['ctrl alt delete', '\x1b[3;7~'], ['alt shift f5', '\x1b[15;4~'],
    ['ctrl shift f1', '\x1b[1;6P'], ['ctrl shift home', '\x1b[1;6H'], ['ctrl shift page-down', '\x1b[6;6~'],
    ['ctrl shift tab', '\x1b[9;6u'], ['ctrl shift enter', '\x1b[13;6u'], ['shift tab', '\x1b[Z'],
    ['ctrl c', '\x03'], ['ctrl+c', '\x03'], ['^C', '\x03'], ['ctrl+?', '\x7f'], ['ctrl space', '\x00'],
    ['alt enter', '\x1b\r'], ['alt shift 1', '\x1b!'], ['alt shift space', '\x1b[32;4u'],
    ['esc', '\x1b'], ['enter', '\r'], ['up', '\x1b[A']
  ])('encodes %s without adding a separate Return', (key, data) => {
    expect(keyDataForTerminal(key)).toEqual({ key, data })
  })
  it.each(['ctrl ctrl c', 'ctrl control c', 'ctrl alt', 'ctrl meta c', 'ctrl shift unknown', 'esc enter', 'constructor', 'ctrl\nc', 'ctrl \x1b', '', 'x'.repeat(81)])('rejects invalid key %j', key => {
    expect(keyDataForTerminal(key)).toBeNull()
  })
  it('preserves the Shift modifier instead of interrupting as plain Ctrl+C', () => {
    expect(keyDataForTerminal('ctrl shift c')?.data).not.toBe(keyDataForTerminal('ctrl c')?.data)
  })
})
