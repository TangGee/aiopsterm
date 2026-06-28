import type { KeywordHighlightRuleConfig } from '@shared/contracts/appRuntime'
import type {
  ThreadedTerminalHighlightRun,
  ThreadedTerminalKeywordHighlightConfig
} from '@/services/terminal/threadedTerminalProtocol'

type CompiledKeywordRule = {
  regex: RegExp
  style: KeywordHighlightRuleConfig['style']
}

type HighlightMatch = {
  start: number
  end: number
  style: KeywordHighlightRuleConfig['style']
}

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

export const compileThreadedKeywordHighlightRules = (config: ThreadedTerminalKeywordHighlightConfig): CompiledKeywordRule[] => {
  const root = config?.['keyword-highlight']
  if (!root?.enabled || !root.applyTo.output || !root.rules.length) return []

  return root.rules.reduce<CompiledKeywordRule[]>((compiled, rule) => {
    if (!rule.enabled || (rule.scope !== 'output' && rule.scope !== 'both')) return compiled
    try {
      const regex = createRegex(rule)
      if (regex) compiled.push({ regex, style: rule.style })
    } catch {
      return compiled
    }
    return compiled
  }, [])
}

export const findThreadedKeywordHighlightRuns = (text: string, rules: CompiledKeywordRule[]): ThreadedTerminalHighlightRun[] => {
  if (!text || !rules.length) return []
  const matches: HighlightMatch[] = []
  rules.forEach((rule) => {
    rule.regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.regex.exec(text)) !== null) {
      if (!match[0].length) {
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
  return matches.reduce<ThreadedTerminalHighlightRun[]>((runs, match) => {
    const previous = runs[runs.length - 1]
    if (previous && match.start < previous.x + Array.from(previous.text).length) return runs
    const textSlice = text.slice(match.start, match.end)
    if (!textSlice) return runs
    runs.push({
      x: Array.from(text.slice(0, match.start)).length,
      text: textSlice,
      fg: match.style.foreground,
      bold: match.style.fontStyle === 'bold' || undefined
    })
    return runs
  }, [])
}
