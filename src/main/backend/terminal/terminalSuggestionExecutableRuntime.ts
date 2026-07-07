import { delimiter, join } from 'path'
import { readdir, stat } from 'fs/promises'
import type { Dirent } from 'fs'
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
  getSuggestions(partialCommand: string): Promise<ScoredTerminalCommandSuggestion[]>
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

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return false
    if (process.platform === 'win32') return true
    return Boolean(stats.mode & 0o111)
  } catch {
    return false
  }
}

function normalizeExecutableName(rawName: string): string {
  const name = normalizeText(rawName)
  if (process.platform === 'win32') return name.replace(/\.(exe|cmd|bat|ps1)$/i, '')
  return name
}

async function scanExecutableCommandNames(paths: string[]): Promise<string[]> {
  const seen = new Set<string>()
  const commands: string[] = []
  for (const dir of paths) {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const name = normalizeExecutableName(entry.name)
      if (!name || seen.has(name)) continue
      if (!(await isExecutableFile(join(dir, entry.name)))) continue
      if (!isValidTerminalCommandForHistory(name)) continue
      seen.add(name)
      commands.push(name)
      if (commands.length >= 4096) break
    }
    if (commands.length >= 4096) break
  }
  commands.sort((a, b) => a.localeCompare(b))
  return commands
}

export function createTerminalSuggestionExecutableRuntime(getConfig: () => TerminalSuggestionRuntimeConfig): TerminalSuggestionExecutableRuntime {
  let executableCommandCache: { key: string; commands: string[] } | null = null
  let executableCommandScan: { key: string; promise: Promise<string[]> } | null = null

  // PATH 扫描全程走 fs.promises，同一配置的并发请求共享一次扫描，完成后写入缓存
  const loadExecutableCommandNames = (): Promise<string[]> => {
    const paths = resolveExecutableSearchPaths(getConfig())
    const key = paths.join('\0')
    if (executableCommandCache?.key === key) return Promise.resolve(executableCommandCache.commands)
    if (executableCommandScan?.key === key) return executableCommandScan.promise
    const scan: { key: string; promise: Promise<string[]> } = {
      key,
      promise: scanExecutableCommandNames(paths).then((commands) => {
        if (executableCommandScan === scan) {
          executableCommandCache = { key, commands }
          executableCommandScan = null
        }
        return commands
      })
    }
    executableCommandScan = scan
    return scan.promise
  }

  return {
    async getSuggestions(partialCommand: string) {
      const tokens = splitCommandLine(partialCommand)
      if (tokens.length !== 1 || tokens[0].includes('/') || tokens[0].includes('\\')) return []
      const lower = tokens[0].toLowerCase()
      if (lower.length < 3) return []
      const commands = await loadExecutableCommandNames()
      return commands
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
      executableCommandScan = null
    }
  }
}
