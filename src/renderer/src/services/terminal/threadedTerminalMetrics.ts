import type { ThreadedTerminalCellMetrics } from '@/services/terminal/threadedTerminalProtocol'

type TextMeasureContext = Pick<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>
type TerminalFontSettings = {
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
}

const fallbackFontFamily = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
const asciiMeasureChars = Array.from({ length: 0x7f - 0x21 }, (_item, index) => String.fromCharCode(0x21 + index))

export const terminalFontSpec = (
  settings: Pick<TerminalFontSettings, 'fontFamily' | 'fontSize'>,
  _bold = false,
  _italic = false
) => {
  const weight = '400'
  const style = ''
  return `${style}${weight} ${Math.max(8, Number(settings.fontSize || 12))}px ${settings.fontFamily || fallbackFontFamily}`
}

export const fallbackTerminalCellMetrics = (
  settings: Pick<TerminalFontSettings, 'fontSize' | 'lineHeight'>
): ThreadedTerminalCellMetrics => {
  const fontSize = Number(settings.fontSize || 12)
  const lineHeight = Number(settings.lineHeight || 1)
  const height = Math.max(10, Math.ceil(fontSize * lineHeight))
  return {
    width: Math.max(4, Math.ceil(fontSize * 0.62)),
    height,
    baseline: Math.max(8, Math.floor(height * 0.78))
  }
}

export const measureTerminalCellMetrics = (
  context: TextMeasureContext | null | undefined,
  settings: Pick<TerminalFontSettings, 'fontFamily' | 'fontSize' | 'lineHeight'>
): ThreadedTerminalCellMetrics => {
  const fallback = fallbackTerminalCellMetrics(settings)
  if (!context) return fallback
  context.font = terminalFontSpec(settings)
  let width = 0
  for (const char of asciiMeasureChars) width = Math.max(width, context.measureText(char).width || 0)
  return {
    ...fallback,
    width: Math.max(4, Math.ceil(width || fallback.width))
  }
}
