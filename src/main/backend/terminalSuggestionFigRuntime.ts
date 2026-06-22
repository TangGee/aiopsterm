import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import type { TerminalCommandSuggestion } from '@shared/contracts/terminalTools'
import {
  dedupeSuggestions,
  isValidTerminalCommandForHistory,
  maxSuggestionRows,
  normalizeCommandName,
  normalizeText,
  resolveNames,
  splitCommandLine,
  type TerminalSuggestionRuntimeConfig
} from './terminalSuggestionCommon'

export type FigArg = {
  name?: string
  description?: string
  suggestions?: Array<string | { name: string | string[]; description?: string }>
  isOptional?: boolean
}

export type FigOption = {
  name: string | string[]
  description?: string
  args?: FigArg | FigArg[]
}

export type FigSubcommand = {
  name: string | string[]
  description?: string
  subcommands?: FigSubcommand[]
  options?: FigOption[]
  args?: FigArg | FigArg[]
}

export type FigSpec = FigSubcommand

type ResolvedFigContext = {
  subcommands?: FigSubcommand[]
  options?: FigOption[]
  inheritedOptions?: FigOption[]
  args?: FigArg | FigArg[]
}

export type TerminalSuggestionFigRuntime = {
  getSuggestions(commandLine: string, limit?: number): Promise<TerminalCommandSuggestion[]>
  loadAvailableSpecs(): Promise<Set<string>>
  loadFigSpec(commandName: string): Promise<FigSpec | null>
  reset(): void
}

async function getFigBuildDir(config: TerminalSuggestionRuntimeConfig): Promise<string | null> {
  if (config.figBuildDir) return config.figBuildDir
  try {
    const indexPath = require.resolve('@withfig/autocomplete')
    return dirname(indexPath)
  } catch {
    return null
  }
}

function mergeOptions(left?: FigOption[], right?: FigOption[]): FigOption[] {
  const merged: FigOption[] = []
  const seen = new Set<string>()
  for (const option of [...(left || []), ...(right || [])]) {
    const key = resolveNames(option.name).sort().join('\0')
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(option)
  }
  return merged
}

function resolveFigContext(spec: FigSpec, consumedTokens: string[]): ResolvedFigContext {
  let current: FigSubcommand = spec
  let inheritedOptions: FigOption[] = []
  let skipNext = false

  for (const token of consumedTokens) {
    if (skipNext) {
      skipNext = false
      continue
    }

    if (token.startsWith('-')) {
      const option = [...(current.options || []), ...inheritedOptions].find((item) => resolveNames(item.name).includes(token))
      if (option?.args) {
        const args = Array.isArray(option.args) ? option.args : [option.args]
        if (args[0] && !args[0].isOptional) skipNext = true
      }
      continue
    }

    const subcommand = current.subcommands?.find((item) => resolveNames(item.name).includes(token))
    if (!subcommand) break
    inheritedOptions = mergeOptions(inheritedOptions, current.options)
    current = subcommand
  }

  return {
    subcommands: current.subcommands,
    options: current.options,
    inheritedOptions: inheritedOptions.length ? inheritedOptions : undefined,
    args: current.args
  }
}

function rebuildCommand(tokens: string[], replaceIndex: number, replacement: string): string {
  const rebuilt = [...tokens]
  rebuilt[replaceIndex] = replacement
  return rebuilt.join(' ')
}

function buildFigSuggestion(command: string, explanation?: string, source: TerminalCommandSuggestion['source'] = 'base'): TerminalCommandSuggestion | null {
  const normalized = normalizeText(command)
  if (!normalized || !isValidTerminalCommandForHistory(normalized)) return null
  return {
    command: normalized,
    source,
    explanation: explanation || 'command spec'
  }
}

export function createTerminalSuggestionFigRuntime(getConfig: () => TerminalSuggestionRuntimeConfig): TerminalSuggestionFigRuntime {
  const specCache = new Map<string, FigSpec | null>()
  let availableSpecNames: Set<string> | null = null

  const loadAvailableSpecs = async (): Promise<Set<string>> => {
    if (availableSpecNames) return availableSpecNames
    try {
      const buildDir = await getFigBuildDir(getConfig())
      if (!buildDir) {
        availableSpecNames = new Set()
        return availableSpecNames
      }
      const indexPath = join(buildDir, 'index.js')
      const mod = (await import(pathToFileURL(indexPath).href)) as { default?: string[] }
      availableSpecNames = new Set(Array.isArray(mod.default) ? mod.default : [])
    } catch {
      availableSpecNames = new Set()
    }
    return availableSpecNames
  }

  const loadFigSpec = async (commandName: string): Promise<FigSpec | null> => {
    if (specCache.has(commandName)) return specCache.get(commandName) || null
    try {
      const buildDir = await getFigBuildDir(getConfig())
      if (!buildDir) {
        specCache.set(commandName, null)
        return null
      }
      const specPath = join(buildDir, `${commandName}.js`)
      const mod = (await import(pathToFileURL(specPath).href)) as { default?: FigSpec }
      const spec = mod.default ? (JSON.parse(JSON.stringify(mod.default)) as FigSpec) : null
      specCache.set(commandName, spec)
      return spec
    } catch {
      specCache.set(commandName, null)
      return null
    }
  }

  const getSuggestions = async (commandLine: string, limit = maxSuggestionRows): Promise<TerminalCommandSuggestion[]> => {
    const tokens = splitCommandLine(commandLine)
    if (!tokens.length) return []
    const wordIndex = tokens.length - 1
    const currentWord = tokens[wordIndex] || ''
    const commandName = normalizeCommandName(tokens[0] || '')
    if (!commandName) return []

    const specs = await loadAvailableSpecs()
    if (wordIndex === 0) {
      const lower = currentWord.toLowerCase()
      if (!lower) return []
      if (specs.has(lower)) {
        const spec = await loadFigSpec(lower)
        return (spec?.subcommands || [])
          .slice(0, limit)
          .map((subcommand) => buildFigSuggestion(`${lower} ${resolveNames(subcommand.name)[0]}`, subcommand.description || 'subcommand'))
          .filter((item): item is TerminalCommandSuggestion => Boolean(item && item.command.trim() !== lower))
      }
      const commands: TerminalCommandSuggestion[] = []
      for (const name of specs) {
        if (name.includes('/')) continue
        if (!name.startsWith(lower) || name === lower) continue
        const suggestion = buildFigSuggestion(name, 'command spec')
        if (suggestion) commands.push(suggestion)
        if (commands.length >= limit) break
      }
      return commands
    }

    if (!specs.has(commandName)) return []
    const spec = await loadFigSpec(commandName)
    if (!spec) return []

    const suggestions: TerminalCommandSuggestion[] = []
    const context = resolveFigContext(spec, tokens.slice(1, wordIndex))
    const append = (replacement: string, explanation?: string) => {
      const suggestion = buildFigSuggestion(rebuildCommand(tokens, wordIndex, replacement), explanation)
      if (suggestion) suggestions.push(suggestion)
    }

    for (const subcommand of context.subcommands || []) {
      if (suggestions.length >= limit) break
      const match = resolveNames(subcommand.name).find((name) => name.startsWith(currentWord) && name !== currentWord)
      if (match) append(match, subcommand.description || 'subcommand')
    }

    for (const option of mergeOptions(context.options, context.inheritedOptions)) {
      if (suggestions.length >= limit) break
      const match = resolveNames(option.name).find((name) => name.startsWith(currentWord) && name !== currentWord)
      if (match) append(match, option.description || 'option')
    }

    const args = context.args ? (Array.isArray(context.args) ? context.args : [context.args]) : []
    for (const arg of args) {
      for (const suggestion of arg.suggestions || []) {
        if (suggestions.length >= limit) break
        const name = typeof suggestion === 'string' ? suggestion : resolveNames(suggestion.name)[0]
        const description = typeof suggestion === 'string' ? arg.description : suggestion.description || arg.description
        if (name && name.startsWith(currentWord) && name !== currentWord) append(name, description)
      }
    }

    return dedupeSuggestions(suggestions, limit)
  }

  return {
    getSuggestions,
    loadAvailableSpecs,
    loadFigSpec,
    reset() {
      availableSpecNames = null
      specCache.clear()
    }
  }
}
