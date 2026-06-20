import type { KeywordHighlightRuleConfig, KeywordHighlightUserConfig } from '@shared/contracts/appRuntime'

type KeywordHighlightScope = 'output' | 'input'

type CompiledKeywordRule = {
  regex: RegExp
  scope: KeywordHighlightRuleConfig['scope']
  style: KeywordHighlightRuleConfig['style']
}

type PlainSegment = {
  text: string
  ansiState: string
  start: number
}

type HighlightMatch = {
  start: number
  end: number
  style: KeywordHighlightRuleConfig['style']
}

const ansiStyleRegex = /\x1b\[[0-9;]*m/g

const escapeWildcardPattern = (pattern: string) =>
  pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^\\s]*')
    .replace(/\?/g, '[^\\s]')

const createRegex = (rule: KeywordHighlightRuleConfig) => {
  const patterns = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern]
  const cleanedPatterns = patterns.map((pattern) => pattern.trim()).filter(Boolean)
  if (!cleanedPatterns.length) return null

  if (rule.matchType === 'wildcard') {
    return new RegExp(cleanedPatterns.map(escapeWildcardPattern).join('|'), 'g')
  }

  const hasCaseInsensitivePrefix = cleanedPatterns.some((pattern) => pattern.startsWith('(?i)'))
  const regexPattern = cleanedPatterns.map((pattern) => (pattern.startsWith('(?i)') ? pattern.slice(4) : pattern)).join('|')
  return new RegExp(regexPattern, hasCaseInsensitivePrefix ? 'gi' : 'g')
}

const compileRules = (config: KeywordHighlightUserConfig): CompiledKeywordRule[] => {
  const root = config['keyword-highlight']
  if (!root.enabled) return []

  return root.rules.reduce<CompiledKeywordRule[]>((compiled, rule) => {
    if (!rule.enabled) return compiled
    try {
      const regex = createRegex(rule)
      if (regex) {
        compiled.push({
          regex,
          scope: rule.scope,
          style: rule.style
        })
      }
    } catch {
      return compiled
    }
    return compiled
  }, [])
}

const parseAnsiSegments = (text: string) => {
  const segments: PlainSegment[] = []
  let lastIndex = 0
  let plainOffset = 0
  let ansiState = ''
  let match: RegExpExecArray | null

  ansiStyleRegex.lastIndex = 0
  while ((match = ansiStyleRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segmentText = text.slice(lastIndex, match.index)
      segments.push({
        text: segmentText,
        ansiState,
        start: plainOffset
      })
      plainOffset += segmentText.length
    }

    const code = match[0]
    if (code === '\x1b[m' || code === '\x1b[0m') {
      ansiState = ''
    } else if (/^\x1b\[0;/.test(code)) {
      const trailingCodes = code.slice(4, -1)
      ansiState = trailingCodes ? `\x1b[${trailingCodes}m` : ''
    } else {
      ansiState += code
    }
    lastIndex = match.index + code.length
  }

  if (lastIndex < text.length) {
    const segmentText = text.slice(lastIndex)
    if (segmentText) {
      segments.push({
        text: segmentText,
        ansiState,
        start: plainOffset
      })
    }
  }

  return segments
}

const findMatches = (plainText: string, rules: CompiledKeywordRule[], scope: KeywordHighlightScope) => {
  const matches: HighlightMatch[] = []

  rules.forEach((rule) => {
    if (rule.scope !== 'both' && rule.scope !== scope) return
    rule.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.regex.exec(plainText)) !== null) {
      if (match[0].length === 0) {
        rule.regex.lastIndex += 1
        continue
      }
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        style: rule.style
      })
    }
  })

  matches.sort((left, right) => left.start - right.start)

  return matches.reduce<HighlightMatch[]>((nonOverlapping, match) => {
    const previous = nonOverlapping[nonOverlapping.length - 1]
    if (!previous || match.start >= previous.end) {
      nonOverlapping.push(match)
    }
    return nonOverlapping
  }, [])
}

const hexToRgb = (hexColor: string) => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor)
  if (!match) return null
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16)
  }
}

const rgbToAnsi256 = (r: number, g: number, b: number) => {
  const red = Math.round((r / 255) * 5)
  const green = Math.round((g / 255) * 5)
  const blue = Math.round((b / 255) * 5)
  return 16 + 36 * red + 6 * green + blue
}

const getHighlightAnsi = (style: KeywordHighlightRuleConfig['style']) => {
  const rgb = hexToRgb(style.foreground)
  if (!rgb) return ''
  const prefix = style.fontStyle === 'bold' ? '1;' : ''
  return `\x1b[${prefix}38;5;${rgbToAnsi256(rgb.r, rgb.g, rgb.b)}m`
}

const renderMatches = (segments: PlainSegment[], matches: HighlightMatch[]) => {
  let result = ''
  let matchIndex = 0
  let currentAnsiState = ''

  segments.forEach((segment) => {
    const segmentStart = segment.start
    const segmentEnd = segment.start + segment.text.length
    let segmentCursor = 0

    if (currentAnsiState !== segment.ansiState) {
      if (currentAnsiState) result += '\x1b[0m'
      if (segment.ansiState) result += segment.ansiState
      currentAnsiState = segment.ansiState
    }

    while (matchIndex < matches.length && matches[matchIndex].start < segmentEnd) {
      const match = matches[matchIndex]
      if (match.end <= segmentStart) {
        matchIndex += 1
        continue
      }

      const localStart = Math.max(0, match.start - segmentStart)
      const localEnd = Math.min(segment.text.length, match.end - segmentStart)
      if (localStart > segmentCursor) {
        result += segment.text.slice(segmentCursor, localStart)
      }

      result += `${getHighlightAnsi(match.style)}${segment.text.slice(localStart, localEnd)}\x1b[0m`
      if (segment.ansiState) result += segment.ansiState
      currentAnsiState = segment.ansiState
      segmentCursor = localEnd

      if (match.end <= segmentEnd) {
        matchIndex += 1
      } else {
        break
      }
    }

    if (segmentCursor < segment.text.length) {
      result += segment.text.slice(segmentCursor)
    }
  })

  if (currentAnsiState) result += '\x1b[0m'
  return result
}

export const applyKeywordHighlight = (config: KeywordHighlightUserConfig, text: string, scope: KeywordHighlightScope = 'output') => {
  const root = config['keyword-highlight']
  if (!root.enabled || !root.applyTo[scope] || !root.rules.length || !text) return text

  const rules = compileRules(config)
  if (!rules.length) return text

  const segments = parseAnsiSegments(text)
  const plainText = segments.map((segment) => segment.text).join('')
  const matches = findMatches(plainText, rules, scope)
  if (!matches.length) return text

  return renderMatches(segments, matches)
}
