import { randomUUID } from 'crypto'
import { delimiter, dirname, join } from 'path'
import { mkdirSync, readdirSync, statSync, type Dirent } from 'fs'
import { pathToFileURL } from 'url'
import type {
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext
} from '@shared/contracts/terminalTools'
import type { UserConfig } from '@shared/preload'
import type { ModelProviderCheckKey } from '@shared/contracts/appRuntime'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider, type AiProviderResolvedConfig, type AiProviderTextRequest } from './modelProviderText'

type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint }

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): SqliteRunResult
  }
}

type HistoryRow = {
  command: string
  host: string
  count: number
  last_used_at: number
}

type FigArg = {
  name?: string
  description?: string
  suggestions?: Array<string | { name: string | string[]; description?: string }>
  isOptional?: boolean
}

type FigOption = {
  name: string | string[]
  description?: string
  args?: FigArg | FigArg[]
}

type FigSubcommand = {
  name: string | string[]
  description?: string
  subcommands?: FigSubcommand[]
  options?: FigOption[]
  args?: FigArg | FigArg[]
}

type FigSpec = FigSubcommand

type ResolvedFigContext = {
  subcommands?: FigSubcommand[]
  options?: FigOption[]
  inheritedOptions?: FigOption[]
  args?: FigArg | FigArg[]
}

type TerminalSuggestionRuntimeConfig = {
  getConfig?: () => UserConfig
  databasePath?: string
  now?: () => number
  fetch?: typeof fetch
  figBuildDir?: string
  envPath?: string
  executableSearchPaths?: string[]
}

type TerminalSuggestionStore = {
  record(command: string, host?: string): void
  query(command: string, host?: string, limit?: number): TerminalCommandSuggestion[]
}

const maxSuggestionRows = 6
const maxStoredCommandLength = 255
const defaultAiSuggestTimeoutMs = 2000
const defaultCommandGenerationTimeoutMs = 8000
const specCache = new Map<string, FigSpec | null>()
let availableSpecNames: Set<string> | null = null
let executableCommandCache: { key: string; commands: string[] } | null = null
let storeInstance: TerminalSuggestionStore | null = null
let runtimeConfig: TerminalSuggestionRuntimeConfig = {}

const normalizeText = (value: unknown) => String(value || '').trim()
const normalizeHost = (value: unknown) => normalizeText(value) || 'local'
const nowSeconds = () => Math.floor((runtimeConfig.now ? runtimeConfig.now() : Date.now()) / 1000)

const resolveUserDataPath = () => {
  if (process.env.AIOPSTERM_USER_DATA_DIR) return process.env.AIOPSTERM_USER_DATA_DIR
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath(name: 'userData'): string } }
    const userDataPath = electron.app?.getPath?.('userData')
    if (userDataPath) return userDataPath
  } catch {
    // Tests and non-Electron tools can still use an in-process fallback store.
  }
  return process.cwd()
}

const resolveNames = (name: string | string[] | undefined): string[] => {
  if (!name) return []
  return Array.isArray(name) ? name : [name]
}

const dedupeSuggestions = (items: TerminalCommandSuggestion[], limit = maxSuggestionRows): TerminalCommandSuggestion[] => {
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

class MemoryTerminalSuggestionStore implements TerminalSuggestionStore {
  private rows = new Map<string, HistoryRow>()

  record(command: string, host?: string): void {
    const normalized = command.trim()
    if (!isValidTerminalCommandForHistory(normalized)) return
    const normalizedHost = normalizeHost(host)
    const key = `${normalizedHost}\0${normalized}`
    const existing = this.rows.get(key)
    if (existing) {
      existing.count += 1
      existing.last_used_at = nowSeconds()
      return
    }
    this.rows.set(key, {
      command: normalized,
      host: normalizedHost,
      count: 1,
      last_used_at: nowSeconds()
    })
  }

  query(command: string, host?: string, limit = maxSuggestionRows): TerminalCommandSuggestion[] {
    return queryHistoryRows(Array.from(this.rows.values()), command, normalizeHost(host), limit)
  }
}

class SqliteTerminalSuggestionStore implements TerminalSuggestionStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        host TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        UNIQUE(command, host)
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_command_history_host_command ON terminal_command_history(host, command);
      CREATE INDEX IF NOT EXISTS idx_terminal_command_history_last_used ON terminal_command_history(last_used_at DESC);
    `)
  }

  record(command: string, host?: string): void {
    const normalized = command.trim()
    if (!isValidTerminalCommandForHistory(normalized)) return
    const normalizedHost = normalizeHost(host)
    const now = nowSeconds()
    this.db
      .prepare(
        `INSERT INTO terminal_command_history (command, host, count, created_at, updated_at, last_used_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(command, host) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at,
           last_used_at = excluded.last_used_at`
      )
      .run(normalized, normalizedHost, now, now, now)
  }

  query(command: string, host?: string, limit = maxSuggestionRows): TerminalCommandSuggestion[] {
    const normalized = command.trim()
    if (normalized.length < 2) return []
    const rows = this.db
      .prepare(
        `SELECT command, host, count, last_used_at
         FROM terminal_command_history
         WHERE command != ?
         ORDER BY last_used_at DESC
         LIMIT 500`
      )
      .all(normalized) as HistoryRow[]
    return queryHistoryRows(rows, normalized, normalizeHost(host), limit)
  }
}

function createStore(): TerminalSuggestionStore {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    const databasePath = runtimeConfig.databasePath || join(resolveUserDataPath(), 'aiopsterm-state.db')
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    return new SqliteTerminalSuggestionStore(new Database(databasePath))
  } catch {
    return new MemoryTerminalSuggestionStore()
  }
}

function getStore(): TerminalSuggestionStore {
  if (!storeInstance) storeInstance = createStore()
  return storeInstance
}

function decayScore(count: number, lastUsedAt: number): number {
  const ageHours = Math.max(0, (nowSeconds() - lastUsedAt) / 3600)
  return count * Math.pow(0.5, ageHours / 24)
}

function fuzzyScore(query: string, target: string): number {
  if (!query || query.length > target.length) return 0
  let score = 0
  let queryIndex = 0
  let previousMatchIndex = -2
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  for (let index = 0; index < t.length && queryIndex < q.length; index += 1) {
    if (t[index] !== q[queryIndex]) continue
    queryIndex += 1
    if (index === 0) score += 10
    if (index === previousMatchIndex + 1) score += 5
    if (index === 0 || t[index - 1] === ' ' || t[index - 1] === '/' || t[index - 1] === '-' || t[index - 1] === '_') score += 3
    score += 1
    previousMatchIndex = index
  }
  return queryIndex === q.length ? score : 0
}

function queryHistoryRows(rows: HistoryRow[], command: string, host: string, limit: number): TerminalCommandSuggestion[] {
  const query = command.trim().toLowerCase()
  if (query.length < 2) return []
  const seen = new Set<string>()
  const prefixCandidates: Array<{ row: HistoryRow; score: number }> = []

  for (const row of rows) {
    if (seen.has(row.command)) continue
    if (!row.command.toLowerCase().startsWith(query)) continue
    seen.add(row.command)
    const hostBoost = row.host === host ? 10 : 1
    prefixCandidates.push({ row, score: decayScore(row.count, row.last_used_at) * hostBoost })
  }

  prefixCandidates.sort((a, b) => b.score - a.score)
  const suggestions = prefixCandidates.slice(0, limit).map(({ row }) => ({
    command: row.command,
    source: 'history' as const,
    explanation: row.host === host ? 'history on this host' : `history from ${row.host}`
  }))

  if (suggestions.length >= Math.min(3, limit) || query.length < 2) return suggestions.slice(0, limit)

  const fuzzyCandidates = rows
    .filter((row) => !seen.has(row.command))
    .map((row) => ({
      row,
      score: fuzzyScore(query, row.command) * decayScore(row.count, row.last_used_at) * (row.host === host ? 10 : 1)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  for (const { row } of fuzzyCandidates) {
    if (suggestions.length >= limit) break
    seen.add(row.command)
    suggestions.push({
      command: row.command,
      source: 'history',
      explanation: row.host === host ? 'history fuzzy match' : `history from ${row.host}`
    })
  }

  return suggestions
}

function normalizeCommandName(raw: string): string {
  const parts = raw.split('/')
  return (parts[parts.length - 1] || '').replace(/\.(exe|cmd|bat|sh|bash|zsh|fish)$/i, '').toLowerCase()
}

function splitCommandLine(commandLine: string): string[] {
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

async function getFigBuildDir(): Promise<string | null> {
  if (runtimeConfig.figBuildDir) return runtimeConfig.figBuildDir
  try {
    const indexPath = require.resolve('@withfig/autocomplete')
    return dirname(indexPath)
  } catch {
    return null
  }
}

async function loadAvailableSpecs(): Promise<Set<string>> {
  if (availableSpecNames) return availableSpecNames
  try {
    const buildDir = await getFigBuildDir()
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

async function loadFigSpec(commandName: string): Promise<FigSpec | null> {
  if (specCache.has(commandName)) return specCache.get(commandName) || null
  try {
    const buildDir = await getFigBuildDir()
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

async function getFigSuggestions(commandLine: string, limit: number): Promise<TerminalCommandSuggestion[]> {
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

function createAiSuggestPrompt(partialCommand: string, context?: TerminalCommandSuggestionContext): string {
  const host = normalizeText(context?.host)
  const shell = normalizeText(context?.shell)
  return [
    `Partial command: ${partialCommand}`,
    host ? `Host: ${host}` : '',
    shell ? `Shell: ${shell}` : '',
    'Complete this terminal command.',
    'Return exactly two lines:',
    'CMD: <completed command>',
    'EXP: <brief purpose>',
    'The command must start with the partial command and must not be destructive. Return NONE if unsure.'
  ]
    .filter(Boolean)
    .join('\n')
}

function createAiSuggestRequest(input: AiProviderResolvedConfig, partialCommand: string, context?: TerminalCommandSuggestionContext): AiProviderTextRequest | null {
  return createProviderTextRequest(input, 'You are a terminal autocomplete engine.', createAiSuggestPrompt(partialCommand, context), 80)
}

function parseAiSuggestResponse(response: string, partialCommand: string): TerminalCommandSuggestion | null {
  const text = response.trim()
  if (!text || text.toUpperCase() === 'NONE') return null
  const command = normalizeText(text.match(/^CMD:\s*(.+)$/im)?.[1])
  const explanation = normalizeText(text.match(/^EXP:\s*(.+)$/im)?.[1])
  if (!command || !command.startsWith(partialCommand.trim())) return null
  if (!isValidTerminalCommandForHistory(command)) return null
  return { command, source: 'ai', explanation: explanation || 'AI suggestion' }
}

const localFigIntentRank = [
  'status',
  'get',
  'list',
  'show',
  'describe',
  'logs',
  'log',
  'ps',
  'top',
  'version',
  'info',
  'config',
  'help'
]

function toLocalAiSuggestion(
  command: string,
  partialCommand: string,
  explanation: string,
  score = 0
): (TerminalCommandSuggestion & { score: number }) | null {
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

function scoreFigSubcommand(subcommand: FigSubcommand, index: number): number {
  const names = resolveNames(subcommand.name)
  const primary = normalizeText(names[0]).toLowerCase()
  const description = normalizeText(subcommand.description).toLowerCase()
  const intentIndex = localFigIntentRank.indexOf(primary)
  let score = intentIndex >= 0 ? 200 - intentIndex * 8 : 20
  if (/\b(status|state|health)\b/.test(description)) score += 18
  if (/\b(list|show|display|get|describe|logs?)\b/.test(description)) score += 14
  if (/\b(delete|remove|destroy|kill|stop|terminate|prune)\b/.test(`${primary} ${description}`)) score -= 100
  return score - index / 100
}

async function getExactCommandFigAiSuggestion(partialCommand: string): Promise<(TerminalCommandSuggestion & { score: number }) | null> {
  const commandName = normalizeCommandName(partialCommand)
  if (!commandName || commandName !== partialCommand.trim().toLowerCase()) return null
  const specs = await loadAvailableSpecs()
  if (!specs.has(commandName)) return null
  const spec = await loadFigSpec(commandName)
  const ranked = (spec?.subcommands || [])
    .map((subcommand, index) => ({ subcommand, score: scoreFigSubcommand(subcommand, index) }))
    .sort((a, b) => b.score - a.score)
  for (const { subcommand, score } of ranked) {
    const name = resolveNames(subcommand.name)[0]
    const suggestion = toLocalAiSuggestion(
      `${commandName} ${name}`,
      partialCommand,
      `local backend Fig spec: ${subcommand.description || 'subcommand'}`,
      score
    )
    if (suggestion) return suggestion
  }
  return null
}

async function getFigAiSuggestions(partialCommand: string): Promise<Array<TerminalCommandSuggestion & { score: number }>> {
  const suggestions: Array<TerminalCommandSuggestion & { score: number }> = []
  const exact = await getExactCommandFigAiSuggestion(partialCommand)
  if (exact) suggestions.push(exact)
  const figSuggestions = await getFigSuggestions(partialCommand, maxSuggestionRows)
  figSuggestions.forEach((item, index) => {
    const suggestion = toLocalAiSuggestion(
      item.command,
      partialCommand,
      `local backend Fig spec: ${item.explanation || 'command spec'}`,
      160 - index
    )
    if (suggestion) suggestions.push(suggestion)
  })
  return suggestions
}

function resolveExecutableSearchPaths(): string[] {
  const rawPaths =
    runtimeConfig.executableSearchPaths && runtimeConfig.executableSearchPaths.length
      ? runtimeConfig.executableSearchPaths
      : normalizeText(runtimeConfig.envPath ?? process.env.PATH)
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

function loadExecutableCommandNames(): string[] {
  const paths = resolveExecutableSearchPaths()
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

function getExecutableAiSuggestions(partialCommand: string): Array<TerminalCommandSuggestion & { score: number }> {
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
}

async function inferLocalAiSuggestions(partialCommand: string, context?: TerminalCommandSuggestionContext): Promise<TerminalCommandSuggestion[]> {
  const partial = partialCommand.trim()
  if (partial.length < 3) return []
  const suggestions: Array<TerminalCommandSuggestion & { score: number }> = []
  try {
    getStore()
      .query(partial, context?.host, maxSuggestionRows)
      .forEach((item, index) => {
        const suggestion = toLocalAiSuggestion(item.command, partial, `local backend ${item.explanation || 'history'}`, 300 - index)
        if (suggestion) suggestions.push(suggestion)
      })
  } catch {
    // Local AI suggestions are opportunistic; history storage failures fail closed.
  }
  try {
    suggestions.push(...(await getFigAiSuggestions(partial)))
  } catch {
    // Fig catalog lookup must not fabricate fallback rows on failure.
  }
  try {
    suggestions.push(...getExecutableAiSuggestions(partial))
  } catch {
    // PATH discovery is best-effort and stays behind the backend boundary.
  }
  return dedupeSuggestions(
    suggestions
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...item }) => item),
    1
  )
}

async function fetchAiSuggestion(query: string, context?: TerminalCommandSuggestionContext): Promise<TerminalCommandSuggestion[]> {
  const getConfig = runtimeConfig.getConfig
  if (!getConfig || query.trim().length < 3) return []
  const config = getConfig()
  const requestedModel = normalizeText(context?.modelName) || normalizeText(config.modelName) || 'aiopsterm-local-agent'
  const provider = resolveModelProvider(config, context?.modelName)
  if (!provider) {
    if (requestedModel !== 'aiopsterm-local-agent') return []
    return inferLocalAiSuggestions(query, context)
  }
  const request = createAiSuggestRequest(provider, query.trim(), context)
  if (!request) return []
  const response = await fetchProviderText(request, { fetch: runtimeConfig.fetch, timeoutMs: defaultAiSuggestTimeoutMs, errorCodePrefix: 'TERMINAL_SUGGESTION_PROVIDER' })
  if (!response.ok) return []
  const parsed = parseAiSuggestResponse(response.text, query)
  return parsed ? [parsed] : []
}

function createCommandGenerationPrompt(instruction: string, context: TerminalCommandGenerationInput['context']): string {
  return [
    `Instruction: ${instruction}`,
    'Context:',
    `Host: ${context.host || 'local'}`,
    `Username: ${context.username || 'local'}`,
    `Working directory: ${context.cwd || '~'}`,
    `Shell: ${context.shell || 'bash'}`,
    `Connection: ${context.connectionType}`,
    '',
    'Generate exactly one executable terminal command.',
    'Return only the command text. Do not include markdown, labels, commentary, or explanations.',
    'Prefer safe, commonly used commands. Return NONE if a safe command cannot be generated.'
  ].join('\n')
}

function createCommandGenerationRequest(input: AiProviderResolvedConfig, instruction: string, context: TerminalCommandGenerationInput['context']) {
  return createProviderTextRequest(
    input,
    'You generate precise terminal commands from operator instructions.',
    createCommandGenerationPrompt(instruction, context),
    160
  )
}

function extractGeneratedCommand(response: string): string {
  let command = normalizeText(response)
  if (!command || command.toUpperCase() === 'NONE') return ''
  const cmdMatch = command.match(/^CMD:\s*(.+)$/im)
  if (cmdMatch) command = normalizeText(cmdMatch[1])
  command = command.replace(/^```(?:bash|sh|shell|zsh|fish)?\s*\n?/i, '')
  command = command.replace(/\n?```\s*$/i, '')
  command = command.replace(/^(?:Command|Output|Result):\s*/i, '')
  const firstLine = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^EXP:\s*/i.test(line))
  const normalized = normalizeText(firstLine || '')
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1).trim()
  }
  return normalized
}

async function fetchGeneratedCommand(request: AiProviderTextRequest): Promise<{ ok: true; command: string } | { ok: false; errorCode: string; errorMessage: string }> {
  const response = await fetchProviderText(request, {
    fetch: runtimeConfig.fetch,
    timeoutMs: defaultCommandGenerationTimeoutMs,
    errorCodePrefix: 'TERMINAL_COMMAND_PROVIDER'
  })
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage
    }
  }
  const command = extractGeneratedCommand(response.text)
  if (!command) {
    return {
      ok: false,
      errorCode: 'TERMINAL_COMMAND_GENERATION_FAILED',
      errorMessage: 'Command generation failed'
    }
  }
  if (!isValidTerminalCommandForHistory(command)) {
    return {
      ok: false,
      errorCode: 'TERMINAL_COMMAND_UNSAFE',
      errorMessage: 'Generated command did not pass terminal safety validation'
    }
  }
  return { ok: true, command }
}

const inferGeneratedCommand = (instruction: string, cwd = '~') => {
  const text = instruction.trim().toLowerCase()
  if (!text) return ''
  if (/(disk|磁盘|空间|df)/i.test(text)) return 'df -h'
  if (/(memory|内存|mem|free)/i.test(text)) return 'free -h'
  if (/(cpu|load|负载|uptime)/i.test(text)) return 'uptime'
  if (/(process|进程|top|ps)/i.test(text)) return 'ps aux --sort=-%mem | head -n 12'
  if (/(port|端口|listen|监听)/i.test(text)) return 'ss -tulpn'
  if (/(log|日志|journal)/i.test(text)) return 'journalctl -n 120 --no-pager'
  if (/(network|网络|route|ip)/i.test(text)) return 'ip addr && ip route'
  if (/(k8s|kubernetes|pod)/i.test(text)) return 'kubectl get pods -A'
  if (/(docker|container|容器)/i.test(text)) return 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"'
  if (/(file|目录|list|ls)/i.test(text)) return `ls -la ${cwd && cwd !== '~' ? cwd : '.'}`
  return `echo ${JSON.stringify(instruction.trim())}`
}

export const configureTerminalSuggestionsRuntime = (config?: TerminalSuggestionRuntimeConfig) => {
  runtimeConfig = config ? { ...config } : {}
  storeInstance = null
  availableSpecNames = null
  executableCommandCache = null
  specCache.clear()
}

export const recordTerminalCommandHistory = (command: string, context?: Pick<TerminalCommandSuggestionContext, 'host'>) => {
  try {
    getStore().record(command, context?.host)
  } catch {
    // Recording terminal history must never interrupt live terminal writes.
  }
}

export const getTerminalCommandSuggestions = async (
  query: string,
  context?: TerminalCommandSuggestionContext
): Promise<TerminalCommandSuggestion[]> => {
  const trimmed = normalizeText(query)
  if (trimmed.length < 2) return []
  if (context?.mode === 'ai') {
    return fetchAiSuggestion(trimmed, context)
  }
  try {
    const history = getStore().query(trimmed, context?.host, maxSuggestionRows)
    const specs = await getFigSuggestions(trimmed, maxSuggestionRows)
    return dedupeSuggestions([...history, ...specs], maxSuggestionRows)
  } catch {
    return []
  }
}

export const generateTerminalCommand = async (input: TerminalCommandGenerationInput): Promise<TerminalCommandGenerationResult> => {
  try {
    const instruction = normalizeText(input.instruction)
    if (!instruction) {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_EMPTY',
        errorMessage: 'Command instruction is required'
      }
    }

    let command = ''
    let provider: 'aiopsterm-local' | ModelProviderCheckKey = 'aiopsterm-local'
    const modelName = normalizeText(input.modelName) || 'aiopsterm-local-agent'
    const config = runtimeConfig.getConfig?.()
    const providerConfig = config ? resolveModelProvider(config, modelName) : null
    if (providerConfig) {
      const request = createCommandGenerationRequest(providerConfig, instruction, input.context)
      if (!request) {
        return {
          ok: false,
          errorCode: 'TERMINAL_COMMAND_PROVIDER_UNAVAILABLE',
          errorMessage: 'Command generation provider is unavailable'
        }
      }
      const generated = await fetchGeneratedCommand(request)
      if (!generated.ok) {
        return {
          ok: false,
          errorCode: generated.errorCode,
          errorMessage: generated.errorMessage
        }
      }
      command = generated.command
      provider = providerConfig.provider
    } else if (modelName !== 'aiopsterm-local-agent') {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_PROVIDER_UNAVAILABLE',
        errorMessage: 'Command generation provider is unavailable'
      }
    } else {
      command = inferGeneratedCommand(instruction, input.context.cwd)
    }

    if (!command) {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_GENERATION_FAILED',
        errorMessage: 'Command generation failed'
      }
    }

    return {
      ok: true,
      data: {
        id: `terminal-command-${randomUUID()}`,
        panelId: input.panelId,
        instruction,
        command,
        modelName,
        context: input.context,
        status: 'done',
        createdAt: Date.now(),
        provider
      }
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'TERMINAL_COMMAND_BACKEND_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}
