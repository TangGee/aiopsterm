import { describe, expect, it, vi } from 'vitest'
import { renderTerminalCapture } from '@/services/terminal/terminalScreenshot'
import type { ThreadedTerminalCapture } from '@/services/terminal/threadedTerminalProtocol'

describe('terminal screenshot rendering', () => {
  it('preserves cell widths and selected-row colors while hiding invisible text', () => {
    const paints: { text: string; x: number; color: string }[] = []
    const context = { font: '', fillStyle: '', globalAlpha: 1, textBaseline: '', measureText: () => ({ width: 8 }), scale: vi.fn(), fillRect: vi.fn(), fillText(text: string, x: number) { paints.push({ text, x, color: this.fillStyle }) } }
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => 'data:image/png;base64,aW1hZ2U=') }
    const spy = vi.spyOn(document, 'createElement').mockReturnValue(canvas as any)
    try {
      const capture = { cols: 80, rows: 24, theme: { background: '#000000', foreground: '#ffffff' }, settings: { fontSize: 14, fontFamily: 'monospace' }, lines: [
        { y: 0, text: '', runs: [{ x: 0, text: 'wideA', chars: ['wide', 'A'], widths: [2, 1], fg: '#000000', bg: '#ffffff' }] },
        { y: 1, text: '', runs: [{ x: 0, text: 'hidden', hidden: true }] }
      ] } as ThreadedTerminalCapture
      expect(renderTerminalCapture(capture)).toBe('data:image/png;base64,aW1hZ2U=')
      expect(paints).toEqual([{ text: 'wide', x: 12, color: '#000000' }, { text: 'A', x: 28, color: '#000000' }])
      expect(context.fillRect).toHaveBeenCalledWith(12, 12, 24, 17)
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
      expect(() => renderTerminalCapture({ ...capture, rows: 501 })).toThrow('size')
      renderTerminalCapture({ ...capture, rows: 500, cols: 500 })
      expect(canvas.height).toBeLessThanOrEqual(4096)
      canvas.toDataURL.mockReturnValue('data:image/png;base64,' + 'a'.repeat(8 * 1024 * 1024))
      expect(() => renderTerminalCapture(capture)).toThrow('too large')
    } finally { spy.mockRestore() }
  })
})
