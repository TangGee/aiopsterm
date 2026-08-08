import { describe, expect, it, vi } from 'vitest'
import {
  fallbackTerminalCellMetrics,
  measureTerminalCellMetrics,
  terminalFontSpec
} from '@/services/terminal/threadedTerminalMetrics'

describe('threadedTerminalMetrics', () => {
  it('keeps subpixel cell widths and centers measured glyph bounds in the line box', () => {
    const measureText = vi.fn((text: string) => ({
      width: text.length * 7.21875,
      actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3
    }))
    const context = { font: '', measureText } as unknown as CanvasRenderingContext2D

    expect(measureTerminalCellMetrics(context, {
      fontFamily: 'SFMono-Regular',
      fontSize: 13,
      lineHeight: 1.3
    })).toEqual({
      width: 7.21875,
      height: 17,
      baseline: 11.5
    })
    expect(context.font).toBe('400 13px SFMono-Regular')
  })

  it('falls back to single-character measurement for non-scaling canvas implementations', () => {
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 8 }))
    } as unknown as CanvasRenderingContext2D

    expect(measureTerminalCellMetrics(context, { fontSize: 13, lineHeight: 1.2 }).width).toBe(8)
  })

  it('uses stable fallback metrics when canvas measurement is unavailable', () => {
    expect(measureTerminalCellMetrics(null, { fontSize: 13, lineHeight: 1.3 }))
      .toEqual(fallbackTerminalCellMetrics({ fontSize: 13, lineHeight: 1.3 }))
  })

  it('emits real normal, bold, and italic canvas font specifications', () => {
    const settings = { fontFamily: 'Consolas', fontSize: 14 }
    expect(terminalFontSpec(settings)).toBe('400 14px Consolas')
    expect(terminalFontSpec(settings, true)).toBe('700 14px Consolas')
    expect(terminalFontSpec(settings, false, true)).toBe('italic 400 14px Consolas')
    expect(terminalFontSpec(settings, true, true)).toBe('italic 700 14px Consolas')
  })
})
