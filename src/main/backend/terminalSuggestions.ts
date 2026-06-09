import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { mkdirSync } from 'fs'
import { pathToFileURL } from 'url'
import type {
  ModelProviderCheckKey,
  ModelProviderUserConfig,
  TerminalCommandGenerationInput,
  TerminalCommandGenerationResult,
  TerminalCommandSuggestion,
  TerminalCommandSuggestionContext,
  UserConfig
} from '@shared/preload'

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

type AiSuggestProviderConfig = {
  provider: ModelProviderCheckKey
  config: ModelProviderUserConfig
}

type TerminalSuggestionRuntimeConfig = {
  getConfig?: () => UserConfig
  databasePath?: string
  now?: () => number
  fetch?: typeof fetch
  figBuildDir?: string
}

type TerminalSuggestionStore = {
  record(command: string, host?: string): void
  query(command: string, host?: string, limit?: number): TerminalCommandSuggestion[]
}

type AiSuggestRequest = {
  provider: ModelProviderCheckKey
  config: ModelProviderUserConfig
  endpoint: string
  headers: Record<string, string>
  body: string
  parseText: (payload: unknown) => string
}

const maxSuggestionRows = 6
const maxStoredCommandLength = 255
const defaultAiSuggestTimeoutMs = 2000
const specCache = new Map<string, FigSpec | null>()
let availableSpecNames: Set<string> | null = null
let storeInstance: TerminalSuggestionStore | null = null
let runtimeConfig: TerminalSuggestionRuntimeConfig = {}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
        .map((subcommand) => ({
          command: `${lower} ${resolveNames(subcommand.name)[0]}`,
          source: 'base' as const,
          explanation: subcommand.description || 'subcommand'
        }))
        .filter((item) => item.command.trim() !== lower)
    }
    const commands: TerminalCommandSuggestion[] = []
    for (const name of specs) {
      if (name.includes('/')) continue
      if (!name.startsWith(lower) || name === lower) continue
      commands.push({ command: name, source: 'base', explanation: 'command spec' })
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
    suggestions.push({
      command: rebuildCommand(tokens, wordIndex, replacement),
      source: 'base',
      explanation: explanation || 'command spec'
    })
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

function providerForModel(config: UserConfig, requestedModel?: string): AiSuggestProviderConfig | null {
  const modelName = normalizeText(requestedModel) || normalizeText(config.modelName)
  if (!modelName || modelName === 'aiopsterm-local-agent') return null
  const modelSettings = config.modelSettings
  if (!modelSettings) return null
  const option = modelSettings.options?.find((item) => item.name === modelName && item.checked && !item.locked)
  const rawProvider = option?.apiProvider || config.modelProvider
  const provider =
    rawProvider === 'openai-compatible'
      ? 'openai'
      : rawProvider === 'openai'
        ? 'openai'
        : rawProvider === 'litellm' || rawProvider === 'bedrock' || rawProvider === 'deepseek' || rawProvider === 'anthropic' || rawProvider === 'ollama'
          ? rawProvider
          : null
  if (!provider) return null
  const providerConfig = modelSettings.providers?.[provider]
  if (!providerConfig) return null
  return {
    provider,
    config: {
      ...providerConfig,
      modelId: normalizeText(providerConfig.modelId) || modelName
    }
  }
}

function appendEndpointPath(baseUrl: string, path: string): string {
  try {
    const parsed = new URL(baseUrl)
    const existing = parsed.pathname.split('/').filter(Boolean)
    const segments = path.split('/').filter(Boolean)
    if (!segments.every((segment, index) => existing[existing.length - segments.length + index] === segment)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/${segments.join('/')}`
    }
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
  if (!baseUrl) return ''
  try {
    const parsed = new URL(baseUrl)
    const hasV1 = parsed.pathname.split('/').filter(Boolean).includes('v1')
    if (!hasV1) parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/v1`
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseUrl
  }
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

function createAiSuggestRequest(input: AiSuggestProviderConfig, partialCommand: string, context?: TerminalCommandSuggestionContext): AiSuggestRequest | null {
  const model = normalizeText(input.config.modelId)
  const apiKey = normalizeText(input.config.apiKey)
  const baseUrl = normalizeText(input.config.baseUrl)
  const prompt = createAiSuggestPrompt(partialCommand, context)
  if (!model) return null

  if (input.provider === 'ollama') {
    const endpoint = appendEndpointPath(baseUrl || 'http://localhost:11434', 'api/chat')
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'You are a terminal autocomplete engine.' },
          { role: 'user', content: prompt }
        ],
        options: { num_predict: 80 }
      }),
      parseText: (payload) => {
        if (!isRecord(payload)) return ''
        return isRecord(payload.message) ? normalizeText(payload.message.content) : normalizeText(payload.response)
      }
    }
  }

  if (input.provider === 'anthropic') {
    if (!apiKey) return null
    const endpoint = appendEndpointPath(baseUrl || 'https://api.anthropic.com', 'v1/messages')
    return {
      provider: input.provider,
      config: input.config,
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 80,
        system: 'You are a terminal autocomplete engine.',
        messages: [{ role: 'user', content: prompt }]
      }),
      parseText: (payload) => {
        if (!isRecord(payload) || !Array.isArray(payload.content)) return ''
        return payload.content.map((part: unknown) => (isRecord(part) && part.type === 'text' ? normalizeText(part.text) : '')).join('')
      }
    }
  }

  if (input.provider === 'bedrock') return null
  if (!apiKey) return null

  const endpoint =
    input.provider === 'litellm'
      ? appendEndpointPath(normalizeOpenAiBaseUrl(baseUrl || 'http://localhost:4000'), 'chat/completions')
      : input.provider === 'deepseek'
        ? appendEndpointPath(normalizeOpenAiBaseUrl(baseUrl || 'https://api.deepseek.com'), 'chat/completions')
        : input.config.apiFormat === 'responses'
          ? appendEndpointPath(normalizeOpenAiBaseUrl(baseUrl || 'https://api.openai.com'), 'responses')
          : appendEndpointPath(normalizeOpenAiBaseUrl(baseUrl || 'https://api.openai.com'), 'chat/completions')

  const useResponses = input.provider === 'openai' && input.config.apiFormat === 'responses'
  return {
    provider: input.provider,
    config: input.config,
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(
      useResponses
        ? {
            model,
            input: [
              { role: 'system', content: 'You are a terminal autocomplete engine.' },
              { role: 'user', content: prompt }
            ],
            max_output_tokens: 80
          }
        : {
            model,
            messages: [
              { role: 'system', content: 'You are a terminal autocomplete engine.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 80
          }
    ),
    parseText: (payload) => {
      if (!isRecord(payload)) return ''
      if (Array.isArray(payload.choices)) {
        const first = payload.choices[0]
        if (!isRecord(first)) return ''
        return isRecord(first.message) ? normalizeText(first.message.content) : normalizeText(first.text)
      }
      if (typeof payload.output_text === 'string') return payload.output_text
      if (Array.isArray(payload.output)) {
        return payload.output
          .flatMap((item: unknown) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
          .map((part: unknown) => (isRecord(part) ? normalizeText(part.text) : ''))
          .join('')
      }
      return ''
    }
  }
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

async function fetchAiSuggestion(query: string, context?: TerminalCommandSuggestionContext): Promise<TerminalCommandSuggestion[]> {
  const getConfig = runtimeConfig.getConfig
  if (!getConfig || query.trim().length < 3) return []
  const provider = providerForModel(getConfig(), context?.modelName)
  if (!provider) return []
  const request = createAiSuggestRequest(provider, query.trim(), context)
  if (!request) return []
  const fetchImpl = runtimeConfig.fetch || fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), defaultAiSuggestTimeoutMs)
  try {
    const response = await fetchImpl(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    })
    if (!response.ok) return []
    const payload = await response.json().catch(() => null)
    const parsed = parseAiSuggestResponse(request.parseText(payload), query)
    return parsed ? [parsed] : []
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
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

export const generateTerminalCommand = (input: TerminalCommandGenerationInput): TerminalCommandGenerationResult => {
  try {
    const instruction = normalizeText(input.instruction)
    if (!instruction) {
      return {
        ok: false,
        errorCode: 'TERMINAL_COMMAND_EMPTY',
        errorMessage: 'Command instruction is required'
      }
    }

    const command = inferGeneratedCommand(instruction, input.context.cwd)
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
        modelName: input.modelName || 'aiopsterm-local-agent',
        context: input.context,
        status: 'done',
        createdAt: Date.now(),
        provider: 'aiopsterm-local'
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
