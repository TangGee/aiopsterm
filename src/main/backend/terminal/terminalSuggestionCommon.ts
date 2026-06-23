import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'
import type { UserConfig } from '@shared/contracts/userConfig'

export type TerminalSuggestionRuntimeConfig = {
  getConfig?: () => UserConfig
  databasePath?: string
  now?: () => number
  fetch?: typeof fetch
  figBuildDir?: string
  envPath?: string
  executableSearchPaths?: string[]
}

export type ScoredTerminalCommandSuggestion = TerminalCommandSuggestion & { score: number }

export const maxSuggestionRows = 6
export const maxStoredCommandLength = 255

export const normalizeText = (value: unknown) => String(value || '').trim()
export const normalizeHost = (value: unknown) => normalizeText(value) || 'local'

export const nowSecondsFrom = (now?: () => number) => Math.floor((now ? now() : Date.now()) / 1000)

export const resolveNames = (name: string | string[] | undefined): string[] => {
  if (!name) return []
  return Array.isArray(name) ? name : [name]
}

export const dedupeSuggestions = (items: TerminalCommandSuggestion[], limit = maxSuggestionRows): TerminalCommandSuggestion[] => {
  const seen = new Set<string>()
  const deduped: TerminalCommandSuggestion[] = []
  for (const item of items) {
    const command = normalizeText(item.command)
    if (!command || seen.has(command)) continue
    seen.add(command)
    deduped.push({ ...item, command })
    if (deduped.length >= limit) break
  }
  return deduped
}

export function isValidTerminalCommandForHistory(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || trimmed.length > maxStoredCommandLength) return false
  if (trimmed.includes('\n') || trimmed.includes('\r')) return false
  const invalidStartChars = /^[!@#$%^&*()+=\-[\]{};:'"\\|,<>?`]/
  if (invalidStartChars.test(trimmed)) return false
  if (trimmed.startsWith('.') && !trimmed.startsWith('./')) return false
  if (/^(.)\1{2,}/.test(trimmed)) return false
  const dangerousPatterns = [
    /rm\s+-rf\s+\//i,
    />[>&]?\/dev\/sd[a-z]/i,
    /\bmkfs\./i,
    /\bdd\s+if=.*\bof=\/dev\/sd[a-z]/i,
    /:\(\)\{\s*:\|:&\s*};:/i
  ]
  if (dangerousPatterns.some((pattern) => pattern.test(trimmed))) return false
  return /^(?:\.\/|~\/|[\p{L}_]|\p{N})[\p{L}\p{N}\s\-./:@|&><;+=_~`"'()[\]{}!#$%?\\,^]*$/u.test(trimmed)
}

export function normalizeCommandName(raw: string): string {
  const parts = raw.split('/')
  return (parts[parts.length - 1] || '').replace(/\.(exe|cmd|bat|sh|bash|zsh|fish)$/i, '').toLowerCase()
}

export function splitCommandLine(commandLine: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | '' = ''
  let escaped = false
  for (const char of commandLine) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') {
      current += char
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current || /\s$/.test(commandLine)) tokens.push(current)
  return tokens
}

export function createScoredTerminalAiSuggestion(
  command: string,
  partialCommand: string,
  explanation: string,
  score = 0
): ScoredTerminalCommandSuggestion | null {
  const partial = partialCommand.trim()
  const lower = partial.toLowerCase()
  const normalized = normalizeText(command)
  if (lower.length < 3) return null
  if (!normalized || normalized.toLowerCase() === lower || !normalized.toLowerCase().startsWith(lower)) return null
  if (!isValidTerminalCommandForHistory(normalized)) return null
  return {
    command: normalized,
    source: 'ai',
    explanation,
    score
  }
}
