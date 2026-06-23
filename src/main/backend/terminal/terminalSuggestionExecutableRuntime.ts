import { delimiter, join } from 'path'
import { readdirSync, statSync, type Dirent } from 'fs'
import type {
  ScoredTerminalCommandSuggestion,
  TerminalSuggestionRuntimeConfig
} from './terminalSuggestionCommon'
import {
  isValidTerminalCommandForHistory,
  maxSuggestionRows,
  normalizeText,
  splitCommandLine
} from './terminalSuggestionCommon'

export type TerminalSuggestionExecutableRuntime = {
  getSuggestions(partialCommand: string): ScoredTerminalCommandSuggestion[]
  reset(): void
}

function resolveExecutableSearchPaths(config: TerminalSuggestionRuntimeConfig): string[] {
  const rawPaths =
    config.executableSearchPaths && config.executableSearchPaths.length
      ? config.executableSearchPaths
      : normalizeText(config.envPath ?? process.env.PATH)
          .split(delimiter)
          .map((item) => item.trim())
  const seen = new Set<string>()
  const paths: string[] = []
  for (const path of rawPaths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths.slice(0, 96)
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return false
    if (process.platform === 'win32') return true
    return Boolean(stat.mode & 0o111)
  } catch {
    return false
  }
}

function normalizeExecutableName(rawName: string): string {
  const name = normalizeText(rawName)
  if (process.platform === 'win32') return name.replace(/\.(exe|cmd|bat|ps1)$/i, '')
  return name
}

export function createTerminalSuggestionExecutableRuntime(getConfig: () => TerminalSuggestionRuntimeConfig): TerminalSuggestionExecutableRuntime {
  let executableCommandCache: { key: string; commands: string[] } | null = null

  const loadExecutableCommandNames = (): string[] => {
    const paths = resolveExecutableSearchPaths(getConfig())
    const key = paths.join('\0')
    if (executableCommandCache?.key === key) return executableCommandCache.commands
    const seen = new Set<string>()
    const commands: string[] = []
    for (const dir of paths) {
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const name = normalizeExecutableName(entry.name)
        if (!name || seen.has(name)) continue
        if (!isExecutableFile(join(dir, entry.name))) continue
        if (!isValidTerminalCommandForHistory(name)) continue
        seen.add(name)
        commands.push(name)
        if (commands.length >= 4096) break
      }
      if (commands.length >= 4096) break
    }
    commands.sort((a, b) => a.localeCompare(b))
    executableCommandCache = { key, commands }
    return commands
  }

  return {
    getSuggestions(partialCommand: string) {
      const tokens = splitCommandLine(partialCommand)
      if (tokens.length !== 1 || tokens[0].includes('/') || tokens[0].includes('\\')) return []
      const lower = tokens[0].toLowerCase()
      if (lower.length < 3) return []
      return loadExecutableCommandNames()
        .filter((command) => {
          const normalized = command.toLowerCase()
          return normalized.startsWith(lower) && normalized !== lower
        })
        .slice(0, maxSuggestionRows)
        .map((command, index) => ({
          command,
          source: 'ai' as const,
          explanation: 'local backend PATH executable',
          score: 80 - index
        }))
    },
    reset() {
      executableCommandCache = null
    }
  }
}
