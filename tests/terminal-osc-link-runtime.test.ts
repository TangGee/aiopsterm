import { describe, expect, it } from 'vitest'
import { parseTerminalCurrentDirectoryOsc } from '@/services/terminal/terminalOscRuntime'
import { findTerminalHttpLinks, terminalColumnAtTextIndex, terminalHttpLinkAtIndex } from '@/services/terminal/terminalLinkRuntime'

describe('terminal current directory OSC', () => {
  it('accepts encoded absolute file paths and rejects unsafe values', () => {
    expect(parseTerminalCurrentDirectoryOsc('file://workstation/home/ops/a%20b')).toBe('/home/ops/a b')
    expect(parseTerminalCurrentDirectoryOsc('https://workstation/home/ops')).toBeNull()
    expect(parseTerminalCurrentDirectoryOsc('file://user@workstation/home/ops')).toBeNull()
    expect(parseTerminalCurrentDirectoryOsc('file://workstation/../ops?query=1')).toBeNull()
  })
})

describe('terminal HTTP links', () => {
  it('finds links and removes surrounding punctuation', () => {
    expect(findTerminalHttpLinks('查看 https://example.com/a?q=1).')).toEqual([
      expect.objectContaining({ text: 'https://example.com/a?q=1' })
    ])
  })

  it('maps wide terminal text and hit tests a link', () => {
    const text = '中文 https://example.com/path'
    const link = findTerminalHttpLinks(text)[0]
    expect(terminalColumnAtTextIndex(text, link.start)).toBe(5)
    expect(terminalHttpLinkAtIndex(text, link.start + 5)?.text).toBe(link.text)
  })
})
