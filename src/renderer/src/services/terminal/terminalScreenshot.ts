import type { ThreadedTerminalCapture } from './threadedTerminalProtocol'

// Render only the requested terminal's core cells, including background tabs.
// No desktop, unrelated panel, cursor blinking or application chrome is captured.
export const renderTerminalCapture = (capture: ThreadedTerminalCapture): string => {
  if (!Number.isInteger(capture.cols) || !Number.isInteger(capture.rows) || capture.cols < 1 || capture.rows < 1 || capture.cols > 500 || capture.rows > 500) throw new Error('Invalid terminal capture size.')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Terminal image rendering is unavailable.')
  const fontSize = Math.max(10, Math.min(24, capture.settings.fontSize || 14))
  const family = capture.settings.fontFamily || 'monospace'
  context.font = `${fontSize}px ${family}`
  const cellWidth = Math.max(1, context.measureText('M').width)
  const cellHeight = Math.ceil(fontSize * Math.max(1.2, capture.settings.lineHeight || 1))
  const padding = 12
  const width = capture.cols * cellWidth + padding * 2
  const height = capture.rows * cellHeight + padding * 2
  const scale = Math.min(1, 4096 / width, 4096 / height)
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  context.scale(scale, scale)
  context.fillStyle = capture.theme.background
  context.fillRect(0, 0, width, height)
  context.textBaseline = 'top'
  for (const line of capture.lines) {
    if (line.y < 0 || line.y >= capture.rows) continue
    const y = padding + line.y * cellHeight
    for (const run of line.runs || []) {
      const chars = run.chars || Array.from(run.text)
      const widths = chars.map((_, index) => run.widths?.[index] || 1)
      let x = padding + run.x * cellWidth
      context.fillStyle = run.bg || capture.theme.background
      context.fillRect(x, y, widths.reduce((a, b) => a + b, 0) * cellWidth, cellHeight)
      if (run.hidden) continue
      context.font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${fontSize}px ${family}`
      context.fillStyle = run.fg || capture.theme.foreground
      context.globalAlpha = run.dim ? 0.5 : 1
      chars.forEach((char, index) => {
        context.fillText(char, x, y + (cellHeight - fontSize) / 2)
        if (run.underline) context.fillRect(x, y + cellHeight - 2, widths[index] * cellWidth, 1)
        if (run.strikethrough) context.fillRect(x, y + cellHeight / 2, widths[index] * cellWidth, 1)
        x += widths[index] * cellWidth
      })
      context.globalAlpha = 1
    }
  }
  const image = canvas.toDataURL('image/png')
  if (!image.startsWith('data:image/png;base64,') || image.length > 8 * 1024 * 1024) throw new Error('Terminal image is too large.')
  return image
}
