import type { ThreadedTerminalCellMetrics } from '@/services/terminal/threadedTerminalProtocol'
import { DEFAULT_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_LINE_HEIGHT, TERMINAL_FONT_FAMILY } from '@shared/terminalTypography'

type TextMeasureContext = Pick<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>
type TerminalFontSettings = {
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
}

const widthMeasureText = '0'.repeat(32)
const boundsMeasureText = 'Mg'
const subpixelPrecision = 64
const roundSubpixel = (value: number) => Math.round(value * subpixelPrecision) / subpixelPrecision

export const terminalFontSpec = (
  settings: Pick<TerminalFontSettings, 'fontFamily' | 'fontSize'>,
  bold = false,
  italic = false
) => {
  const weight = bold ? '700' : '400'
  const style = italic ? 'italic ' : ''
  return `${style}${weight} ${Math.max(8, Number(settings.fontSize || DEFAULT_TERMINAL_FONT_SIZE))}px ${settings.fontFamily || TERMINAL_FONT_FAMILY}`
}

export const fallbackTerminalCellMetrics = (
  settings: Pick<TerminalFontSettings, 'fontSize' | 'lineHeight'>
): ThreadedTerminalCellMetrics => {
  const fontSize = Number(settings.fontSize || DEFAULT_TERMINAL_FONT_SIZE)
  const lineHeight = Number(settings.lineHeight || DEFAULT_TERMINAL_LINE_HEIGHT)
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
  const singleWidth = context.measureText('0').width
  const averagedWidth = context.measureText(widthMeasureText).width / widthMeasureText.length
  const measuredWidth = averagedWidth >= singleWidth * 0.5 ? averagedWidth : singleWidth
  const bounds = context.measureText(boundsMeasureText)
  const ascent = Number(bounds.actualBoundingBoxAscent || 0)
  const descent = Number(bounds.actualBoundingBoxDescent || 0)
  const glyphHeight = ascent + descent
  const measuredBaseline = glyphHeight > 0
    ? Math.max(1, Math.min(fallback.height - 1, (fallback.height - glyphHeight) / 2 + ascent))
    : fallback.baseline
  return {
    ...fallback,
    width: Number.isFinite(measuredWidth) && measuredWidth > 0 ? Math.max(4, roundSubpixel(measuredWidth)) : fallback.width,
    baseline: roundSubpixel(measuredBaseline)
  }
}
