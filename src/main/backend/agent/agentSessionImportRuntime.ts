import { createHash, randomUUID } from 'crypto'
import { existsSync, statSync, type Dirent } from 'fs'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { openSqliteDatabase, type SqliteDatabase } from '@shared/databaseSqliteRuntime'
import type {
  AiAgentSessionSource,
  ManagedAiSessionKind,
  ManagedAiSessionRecord,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import type { AgentSessionParserDefinition } from '@shared/contracts/agentSessionParsers'
import {
  canonicalCwdFor,
  cleanOptionalText,
  compactRawRecord,
  resumeCommandFor,
  sessionKey,
  sourceLabel
} from './agentSessionNormalization'

export type ImportedAgentSession = Omit<ManagedAiSessionRecord, 'decisions'>

export type AgentSessionImportRuntime = {
  configure: (input?: Partial<AgentSessionImportRuntimeConfig>) => void
  invalidateCache: () => void
  importSessions: () => Promise<ImportedAgentSession[]>
}

type AgentSessionImportRuntimeConfig = {
  getHomeDir: () => string
  getEnv: () => NodeJS.ProcessEnv
  now: () => number
  enabled: boolean
  cacheTtlMs: number
  openSqliteDatabase: (filePath: string, readonly: boolean) => SqliteDatabase
  jsonlParseCache: Map<string, JsonlParseCacheEntry>
  getParserDefinitions: () => AgentSessionParserDefinition[]
  importSessions?: () => Promise<ImportedAgentSession[]>
}

type CandidateBase = {
  source: AiAgentSessionSource
  sessionId: string
  title?: string
  summary?: string
  cwd?: string
  canonicalCwd?: string
  gitBranch?: string
  gitDirty?: boolean
  gitStatusUpdatedAt?: number
  transcriptPath?: string
  modifiedAt: number
  model?: string
  launchCommand?: string
  resumeCommand?: string
  sessionKind?: ManagedAiSessionKind
  parentSessionId?: string
  restorable?: boolean
}

type CollectedSessionFile = {
  path: string
  mtimeMs: number
  size: number
}

type JsonlParseCacheEntry = {
  mtimeMs: number
  size: number
  candidate: CandidateBase | null
}

type CodexThreadRow = {
  id?: string
  rollout_path?: string
  cwd?: string
  title?: string
  source?: string
  thread_source?: string
  has_user_event?: number | boolean
  model?: string
  git_branch?: string
  approval_mode?: string
  sandbox_policy?: string
  reasoning_effort?: string
  first_user_message?: string
  updated_at_ms?: number
}

type OpenCodeSessionRow = {
  id?: string
  title?: string
  directory?: string
  time_updated?: number
  last_assistant?: string
}

const maxJsonlReadBytes = 4 * 1024 * 1024
const maxCollectedSessionFiles = 2400

const cleanPath = (value: unknown) => cleanOptionalText(value)?.replace(/^~(?=$|\/)/, defaultHomeDir()) || undefined

const defaultHomeDir = () => process.env.HOME || process.env.USERPROFILE || ''

const pathInHome = (home: string, relative: string) => join(home || defaultHomeDir(), relative)

const safeStatMtime = (path: string) => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

const safeReadJson = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const valueAtPointer = (value: unknown, pointer?: string) => {
  if (!pointer || pointer === '/') return value
  let current = value
  for (const rawSegment of pointer.replace(/^\$/, '').split('/').filter(Boolean)) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (current && typeof current === 'object') current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

const scalarTextAtPointer = (value: unknown, pointer?: string) => cleanOptionalText(valueAtPointer(value, pointer))

const expandParserPath = (value: string, home: string) =>
  value.replace(/^~(?=$|[\\/])/, home).replace(/\$\{HOME\}/g, home)

const normalizedGlobPath = (value: string) => resolve(value).replace(/\\/g, '/')

const globRegexFor = (pattern: string) => {
  const normalized = normalizedGlobPath(pattern)
  let expression = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (character === '*' && normalized[index + 1] === '*') {
      index += 1
      if (normalized[index + 1] === '/') {
        index += 1
        expression += '(?:.*/)?'
      } else expression += '.*'
    } else if (character === '*') expression += '[^/]*'
    else if (character === '?') expression += '[^/]'
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${expression}$`)
}

const filesForParserPath = async (pattern: string, extension: string) => {
  const wildcardIndex = pattern.search(/[?*]/)
  if (wildcardIndex < 0) {
    const info = await stat(pattern).catch(() => null)
    if (!info) return []
    if (info.isFile()) return [{ path: pattern, mtimeMs: info.mtimeMs, size: info.size }]
    return collectFiles(pattern, extension)
  }
  const prefix = pattern.slice(0, wildcardIndex)
  const root = prefix.slice(0, Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'))) || dirname(prefix)
  const matcher = globRegexFor(pattern)
  return (await collectFiles(root, extension)).filter((file) => matcher.test(normalizedGlobPath(file.path)))
}

const parserSessionRecords = async (definition: AgentSessionParserDefinition, path: string) => {
  if (definition.storage.kind === 'jsonl') return readJsonLines(path)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'))
    if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
    return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []
  } catch {
    return []
  }
}

const importParserConfiguredSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const home = config.getHomeDir()
  const candidates: CandidateBase[] = []
  for (const definition of config.getParserDefinitions()) {
    const isCustomSource = definition.source.startsWith('custom:')
    if (!isCustomSource && definition.storage.discover !== true) continue
    if (definition.storage.kind !== 'jsonl' && definition.storage.kind !== 'json') continue
    const extension = definition.storage.kind === 'jsonl' ? '.jsonl' : '.json'
    const groups = await Promise.all((definition.storage.paths || []).map((pattern) => filesForParserPath(expandParserPath(pattern, home), extension)))
    const seenPaths = new Set<string>()
    for (const file of groups.flat().sort((first, second) => second.mtimeMs - first.mtimeMs)) {
      if (seenPaths.has(file.path)) continue
      seenPaths.add(file.path)
      const records = await parserSessionRecords(definition, file.path)
      if (!records.length) continue
      const firstScalarAt = (pointer?: string) => {
        if (!pointer) return undefined
        for (const record of records) {
          const value = scalarTextAtPointer(record, pointer)
          if (value) return value
        }
        return undefined
      }
      const fallbackId = isCustomSource
        ? resolve(file.path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() || randomUUID()
        : createHash('sha1').update(resolve(file.path)).digest('hex')
      let rawTimestamp: unknown
      if (definition.storage.timestampPointer) {
        for (const record of records) {
          rawTimestamp = valueAtPointer(record, definition.storage.timestampPointer)
          if (rawTimestamp !== undefined && rawTimestamp !== null && rawTimestamp !== '') break
        }
      }
      const parsedTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Date.parse(cleanOptionalText(rawTimestamp) || '')
      const cwd = firstScalarAt(definition.storage.cwdPointer)
      candidates.push({
        source: definition.source,
        sessionId: firstScalarAt(definition.storage.sessionIdPointer) || fallbackId,
        title: firstScalarAt(definition.storage.titlePointer) || (cwd ? undefined : definition.displayName),
        summary: firstScalarAt(definition.storage.summaryPointer),
        cwd,
        transcriptPath: file.path,
        modifiedAt: Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : file.mtimeMs,
        restorable: false
      })
    }
  }
  return candidates
}

const normalizeImportedTitle = (source: AiAgentSessionSource, title: unknown, cwd?: string) => {
  const text = cleanOptionalText(title)
  if (text) return text.slice(0, 120)
  const project = cleanOptionalText(cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop())
  return project ? `${sourceLabel(source)} · ${project}` : sourceLabel(source)
}

const normalizeImportedSummary = (value: unknown, fallback: string) => {
  const text = cleanOptionalText(value) || fallback
  return text.slice(0, 240)
}

const importedCandidateAllowsResume = (candidate: Pick<CandidateBase, 'sessionKind' | 'restorable'>) =>
  candidate.restorable !== false && candidate.sessionKind !== 'subagent' && candidate.sessionKind !== 'internal'

const normalizeImportedSessionKind = (value: unknown): ManagedAiSessionKind | undefined => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) return undefined
  if (normalized === 'user' || normalized === 'main' || normalized === 'primary' || normalized === 'root' || normalized === 'cli') return 'main'
  if (normalized === 'subagent' || normalized === 'sidechain' || normalized === 'child' || normalized === 'agent') return 'subagent'
  if (normalized === 'internal' || normalized === 'system' || normalized === 'exec' || normalized === 'review' || normalized === 'oneshot') return 'internal'
  return undefined
}

const firstDeepText = (value: unknown, keys: string[], depth = 0): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return undefined
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const text = cleanOptionalText(record[key])
    if (text) return text
  }
  for (const item of Object.values(record)) {
    const found = firstDeepText(item, keys, depth + 1)
    if (found) return found
  }
  return undefined
}

const codexSourceRecord = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  const text = cleanOptionalText(value)
  return text ? safeReadJson(text) : null
}

const codexSessionClassification = (input: {
  source?: unknown
  threadSource?: unknown
}): Pick<CandidateBase, 'sessionKind' | 'parentSessionId' | 'restorable'> => {
  const threadKind = normalizeImportedSessionKind(input.threadSource)
  const sourceKind = normalizeImportedSessionKind(input.source)
  if (threadKind === 'subagent') {
    const source = codexSourceRecord(input.source)
    return {
      sessionKind: 'subagent',
      parentSessionId: firstDeepText(source, ['parent_thread_id', 'parentThreadId', 'parent_session_id', 'parentSessionId']),
      restorable: false
    }
  }
  const source = codexSourceRecord(input.source)
  if (source && (source.subagent !== undefined || source.subAgent !== undefined || source.thread_spawn !== undefined || source.threadSpawn !== undefined)) {
    return {
      sessionKind: 'subagent',
      parentSessionId: firstDeepText(source, ['parent_thread_id', 'parentThreadId', 'parent_session_id', 'parentSessionId']),
      restorable: false
    }
  }
  if (sourceKind === 'subagent') {
    return { sessionKind: 'subagent', restorable: false }
  }
  if (sourceKind === 'internal') {
    return { sessionKind: 'internal', restorable: false }
  }
  if (threadKind === 'main' || sourceKind === 'main') return { sessionKind: 'main', restorable: true }
  return {}
}

const importedEventId = (candidate: CandidateBase) => {
  const hash = createHash('sha1')
    .update([candidate.source, candidate.sessionId, candidate.modifiedAt, candidate.title || '', candidate.cwd || ''].join('\0'))
    .digest('hex')
    .slice(0, 12)
  return `${Math.round(candidate.modifiedAt)}-${hash}`
}

const importedRecordFor = (candidate: CandidateBase, now: number): ImportedAgentSession => {
  const title = normalizeImportedTitle(candidate.source, candidate.title, candidate.cwd)
  const summary = normalizeImportedSummary(candidate.summary, 'Imported from local agent history')
  const resumeCommand = importedCandidateAllowsResume(candidate)
    ? candidate.resumeCommand || resumeCommandFor(candidate.source, candidate.sessionId, candidate.cwd, candidate.launchCommand)
    : undefined
  const canonicalCwd = canonicalCwdFor(candidate.cwd, candidate.canonicalCwd)
  const event: ManagedAiSessionTimelineEvent = {
    id: importedEventId(candidate),
    source: candidate.source,
    event: 'session_start',
    sessionId: candidate.sessionId,
    title,
    summary,
    receivedAt: candidate.modifiedAt || now,
    requestKind: 'telemetry',
    decisionMode: 'telemetry',
    ...(candidate.cwd ? { cwd: candidate.cwd } : {}),
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(candidate.gitBranch ? { gitBranch: candidate.gitBranch } : {}),
    ...(typeof candidate.gitDirty === 'boolean' ? { gitDirty: candidate.gitDirty } : {}),
    ...(candidate.gitStatusUpdatedAt ? { gitStatusUpdatedAt: candidate.gitStatusUpdatedAt } : {}),
    ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(candidate.sessionKind ? { sessionKind: candidate.sessionKind } : {}),
    ...(candidate.parentSessionId ? { parentSessionId: candidate.parentSessionId } : {}),
    ...(typeof candidate.restorable === 'boolean' ? { restorable: candidate.restorable } : {}),
    raw: compactRawRecord({
      imported: true,
      source: candidate.source,
      model: candidate.model,
      transcriptPath: candidate.transcriptPath,
      sessionKind: candidate.sessionKind,
      parentSessionId: candidate.parentSessionId,
      restorable: candidate.restorable
    })
  }
  return {
    id: candidate.sessionId,
    source: candidate.source,
    title,
    summary,
    state: 'idle',
    lastEvent: 'session_start',
    lastActivityAt: candidate.modifiedAt || now,
    createdAt: candidate.modifiedAt || now,
    updatedAt: now,
    ...(candidate.cwd ? { cwd: candidate.cwd } : {}),
    ...(canonicalCwd ? { canonicalCwd } : {}),
    ...(candidate.gitBranch ? { gitBranch: candidate.gitBranch } : {}),
    ...(typeof candidate.gitDirty === 'boolean' ? { gitDirty: candidate.gitDirty } : {}),
    ...(candidate.gitStatusUpdatedAt ? { gitStatusUpdatedAt: candidate.gitStatusUpdatedAt } : {}),
    ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
    requestKind: 'telemetry',
    decisionMode: 'telemetry',
    ...(candidate.launchCommand ? { launchCommand: candidate.launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    ...(candidate.sessionKind ? { sessionKind: candidate.sessionKind } : {}),
    ...(candidate.parentSessionId ? { parentSessionId: candidate.parentSessionId } : {}),
    ...(typeof candidate.restorable === 'boolean' ? { restorable: candidate.restorable } : {}),
    agentLifecycle: 'idle',
    events: [event]
  }
}

const codexHomeFor = (env: NodeJS.ProcessEnv, home: string) => cleanPath(env.CODEX_HOME) || pathInHome(home, '.codex')

const claudeHomesFor = (env: NodeJS.ProcessEnv, home: string) => {
  const roots: string[] = []
  const add = (path?: string) => {
    const normalized = cleanPath(path)
    if (normalized && !roots.includes(normalized)) roots.push(normalized)
  }
  add(env.CLAUDE_CONFIG_DIR)
  add(pathInHome(home, '.claude'))
  return roots
}

const decodeClaudeProjectDir = (dirName: string) => {
  if (!dirName) return undefined
  const stripped = dirName.startsWith('-') ? dirName.slice(1) : dirName
  const candidate = `/${stripped.replace(/-/g, '/')}`
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory() ? candidate : undefined
  } catch {
    return undefined
  }
}

const realCodexUserMessage = (value: unknown) => {
  const text = cleanOptionalText(value)
  if (!text) return undefined
  if (
    text.startsWith('<environment_context') ||
    text.startsWith('<user_instructions') ||
    text.startsWith('<permissions') ||
    text.startsWith('<system') ||
    text.startsWith('# AGENTS.md')
  ) {
    return undefined
  }
  return text
}

const readJsonLines = async (path: string, maxBytes = maxJsonlReadBytes) => {
  try {
    const raw = await readFile(path)
    const text = raw.subarray(0, maxBytes).toString('utf8')
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(safeReadJson)
      .filter(Boolean) as Record<string, unknown>[]
  } catch {
    return []
  }
}

const collectFiles = async (root: string, extension = '.jsonl') => {
  const out: CollectedSessionFile[] = []
  const stack = [root]
  while (stack.length && out.length < maxCollectedSessionFiles) {
    const current = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && path.endsWith(extension)) {
        try {
          const fileStat = await stat(path)
          out.push({ path, mtimeMs: fileStat.mtimeMs, size: fileStat.size })
          if (out.length >= maxCollectedSessionFiles) break
        } catch {
          continue
        }
      }
    }
  }
  return out.sort((first, second) => second.mtimeMs - first.mtimeMs)
}

const parseCachedJsonl = async (
  cache: Map<string, JsonlParseCacheEntry>,
  kind: string,
  file: CollectedSessionFile,
  parse: (path: string, mtimeMs: number) => Promise<CandidateBase | null>
) => {
  const key = `${kind}:${file.path}`
  const cached = cache.get(key)
  if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) return cached.candidate
  const candidate = await parse(file.path, file.mtimeMs)
  cache.set(key, {
    mtimeMs: file.mtimeMs,
    size: file.size,
    candidate
  })
  return candidate
}

const snapshotSqliteDatabase = async (sourcePath: string, prefix: string) => {
  if (!existsSync(sourcePath)) return null
  const snapshotDir = join(tmpdir(), `${prefix}-${randomUUID()}`)
  await mkdir(snapshotDir, { recursive: true })
  const snapshotPath = join(snapshotDir, sourcePath.split(/[\\/]/).pop() || 'state.db')
  try {
    await copyFile(sourcePath, snapshotPath)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(sourcePath + suffix)) await copyFile(sourcePath + suffix, snapshotPath + suffix)
    }
    return { path: snapshotPath, dispose: () => rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined) }
  } catch {
    await rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined)
    return null
  }
}

const queryRows = <T extends Record<string, unknown>>(db: SqliteDatabase, sql: string, params: unknown[] = []) => {
  const statement = db.prepare(sql)
  return (params.length ? statement.all(...params) : statement.all()) as T[]
}

const sqliteColumnsForTable = (db: SqliteDatabase, table: string) =>
  new Set(
    queryRows<{ name?: string }>(db, `PRAGMA table_info(${table})`)
      .map((row) => cleanOptionalText(row.name))
      .filter((value): value is string => Boolean(value))
  )

const sqliteSelectColumn = (columns: Set<string>, column: string) => (columns.has(column) ? column : `NULL AS ${column}`)

const parseSandboxMode = (value: unknown) => {
  const raw = cleanOptionalText(value)
  if (!raw) return undefined
  const parsed = safeReadJson(raw)
  return cleanOptionalText(parsed?.type)
}

const codexResumeCommand = (row: Pick<CodexThreadRow, 'id' | 'model' | 'approval_mode' | 'sandbox_policy' | 'reasoning_effort'>, cwd?: string) => {
  const sessionId = cleanOptionalText(row.id)
  if (!sessionId) return undefined
  const parts = [`codex resume '${sessionId.replace(/'/g, `'\\''`)}'`]
  const model = cleanOptionalText(row.model)
  const approval = cleanOptionalText(row.approval_mode)
  const sandbox = parseSandboxMode(row.sandbox_policy)
  const effort = cleanOptionalText(row.reasoning_effort)
  if (model) parts.push(`-m '${model.replace(/'/g, `'\\''`)}'`)
  if (approval === 'never' && sandbox === 'disabled') {
    parts.push('--dangerously-bypass-approvals-and-sandbox')
  } else {
    if (approval) parts.push(`-a '${approval.replace(/'/g, `'\\''`)}'`)
    if (sandbox && ['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox)) {
      parts.push(`-s '${sandbox.replace(/'/g, `'\\''`)}'`)
    }
  }
  if (effort) parts.push(`-c model_reasoning_effort='${effort.replace(/'/g, `'\\''`)}'`)
  const command = parts.join(' ')
  return cwd ? `cd '${cwd.replace(/'/g, `'\\''`)}' && ${command}` : command
}

const importCodexFromSqlite = async (
  codexHome: string,
  openDatabase: AgentSessionImportRuntimeConfig['openSqliteDatabase']
): Promise<CandidateBase[] | null> => {
  const dbPath = join(codexHome, 'state_5.sqlite')
  const snapshot = await snapshotSqliteDatabase(dbPath, 'aiopsterm-codex-sessions')
  if (!snapshot) return null
  let db: SqliteDatabase | null = null
  try {
    db = openDatabase(snapshot.path, true)
    const columns = sqliteColumnsForTable(db, 'threads')
    const rows = queryRows<CodexThreadRow>(
      db,
      `SELECT id, rollout_path, cwd, title, ${sqliteSelectColumn(columns, 'source')}, ${sqliteSelectColumn(columns, 'thread_source')}, ${sqliteSelectColumn(columns, 'has_user_event')}, model, git_branch, approval_mode, sandbox_policy, reasoning_effort, first_user_message, updated_at_ms
       FROM threads
       WHERE archived = 0
       ORDER BY updated_at_ms DESC`
    )
    return rows
      .map((row) => {
        const sessionId = cleanOptionalText(row.id)
        if (!sessionId) return null
        const cwd = cleanOptionalText(row.cwd)
        const classification = codexSessionClassification({
          source: row.source,
          threadSource: row.thread_source
        })
        const resumeCommand = importedCandidateAllowsResume(classification) ? codexResumeCommand(row, cwd) : undefined
        return {
          source: 'codex' as const,
          sessionId,
          title: cleanOptionalText(row.title) || realCodexUserMessage(row.first_user_message),
          summary: realCodexUserMessage(row.first_user_message) || cleanOptionalText(row.title),
          cwd,
          transcriptPath: cleanOptionalText(row.rollout_path),
          modifiedAt: Number(row.updated_at_ms || 0) || safeStatMtime(cleanOptionalText(row.rollout_path) || ''),
          model: cleanOptionalText(row.model),
          gitBranch: cleanOptionalText(row.git_branch),
          resumeCommand,
          ...classification
        } satisfies CandidateBase
      })
      .filter(Boolean) as CandidateBase[]
  } catch {
    return null
  } finally {
    db?.close()
    await snapshot.dispose()
  }
}

const parseCodexJsonl = async (path: string, mtimeMs: number): Promise<CandidateBase | null> => {
  const lines = await readJsonLines(path)
  let sessionId = ''
  let cwd: string | undefined
  let title: string | undefined
  let firstUserMessage: string | undefined
  let model: string | undefined
  let approvalPolicy: string | undefined
  let sandboxMode: string | undefined
  let effort: string | undefined
  let codexSource: unknown
  let threadSource: unknown
  for (const obj of lines) {
    const type = cleanOptionalText(obj.type)
    const payload = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload) ? (obj.payload as Record<string, unknown>) : {}
    if (type === 'session_meta') {
      sessionId = cleanOptionalText(payload.id) || sessionId
      cwd = cleanOptionalText(payload.cwd) || cwd
      codexSource = payload.source ?? codexSource
      threadSource = payload.thread_source ?? payload.threadSource ?? threadSource
    } else if (type === 'turn_context') {
      model = cleanOptionalText(payload.model) || model
      approvalPolicy = cleanOptionalText(payload.approval_policy) || approvalPolicy
      effort = cleanOptionalText(payload.effort) || effort
      const sandbox = payload.sandbox_policy && typeof payload.sandbox_policy === 'object' && !Array.isArray(payload.sandbox_policy) ? payload.sandbox_policy as Record<string, unknown> : null
      sandboxMode = cleanOptionalText(sandbox?.type) || sandboxMode
    } else if (type === 'event_msg') {
      if (payload.type === 'thread_name_updated') title = cleanOptionalText(payload.thread_name) || title
      if (!firstUserMessage && payload.type === 'user_message') firstUserMessage = realCodexUserMessage(payload.message)
    }
  }
  if (!sessionId) sessionId = resolve(path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() || ''
  if (!sessionId) return null
  const classification = codexSessionClassification({
    source: codexSource,
    threadSource
  })
  const resumeCommand = importedCandidateAllowsResume(classification)
    ? codexResumeCommand(
        {
          id: sessionId,
          model,
          approval_mode: approvalPolicy,
          sandbox_policy: sandboxMode ? JSON.stringify({ type: sandboxMode }) : undefined,
          reasoning_effort: effort
        },
        cwd
      )
    : undefined
  return {
    source: 'codex',
    sessionId,
    title: title || firstUserMessage,
    summary: firstUserMessage || title,
    cwd,
    transcriptPath: path,
    modifiedAt: mtimeMs,
    model,
    resumeCommand,
    ...classification
  }
}

const importCodexFromDisk = async (codexHome: string, jsonlParseCache: Map<string, JsonlParseCacheEntry>) => {
  const files = await collectFiles(join(codexHome, 'sessions'))
  const candidates = await Promise.all(files.map((file) => parseCachedJsonl(jsonlParseCache, 'codex', file, parseCodexJsonl)))
  return candidates.filter(Boolean) as CandidateBase[]
}

const importCodexSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const home = codexHomeFor(config.getEnv(), config.getHomeDir())
  const sql = await importCodexFromSqlite(home, config.openSqliteDatabase)
  return sql ?? importCodexFromDisk(home, config.jsonlParseCache)
}

const claudeDisplayTitle = (raw: unknown) => {
  const text = cleanOptionalText(raw)
  if (!text || text.startsWith('<system-reminder>') || text.startsWith('<local-command-')) return undefined
  return text.slice(0, 120)
}

const textFromClaudeContent = (value: unknown) => {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record.type === 'text') return cleanOptionalText(record.text)
  }
  return undefined
}

const parseClaudeJsonl = async (path: string, projectDirName: string, mtimeMs: number): Promise<CandidateBase | null> => {
  const lines = await readJsonLines(path)
  let title: string | undefined
  let sidechainTitle: string | undefined
  let cwd = decodeClaudeProjectDir(projectDirName)
  let sidechainCwd: string | undefined
  let model: string | undefined
  let sidechainModel: string | undefined
  let permissionMode: string | undefined
  let sidechainMessages = 0
  let mainMessages = 0
  for (const obj of lines) {
    const isSidechain = obj.isSidechain === true
    if (isSidechain) {
      sidechainCwd = cleanOptionalText(obj.cwd) || sidechainCwd
    } else {
      cwd = cleanOptionalText(obj.cwd) || cwd
      permissionMode = cleanOptionalText(obj.permissionMode) || permissionMode
    }
    const message = obj.message && typeof obj.message === 'object' && !Array.isArray(obj.message) ? obj.message as Record<string, unknown> : null
    if (!message) continue
    if (isSidechain) sidechainMessages += 1
    else mainMessages += 1
    if (message.role === 'user') {
      const displayTitle = claudeDisplayTitle(textFromClaudeContent(message.content))
      if (isSidechain && !sidechainTitle) sidechainTitle = displayTitle
      if (!isSidechain && !title) title = displayTitle
    }
    if (message.role === 'assistant') {
      if (isSidechain) sidechainModel = cleanOptionalText(message.model) || sidechainModel
      else model = cleanOptionalText(message.model) || model
    }
  }
  const sessionId = resolve(path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() || ''
  if (!sessionId) return null
  const isSubagent = sessionId.startsWith('agent-') || (sidechainMessages > 0 && mainMessages === 0)
  const sessionKind: ManagedAiSessionKind | undefined = isSubagent ? 'subagent' : undefined
  const parentSessionId = isSubagent ? claudeParentSessionIdFromPath(path) : undefined
  const restorable = isSubagent ? false : undefined
  const effectiveModel = isSubagent ? sidechainModel || model : model
  const effectiveCwd = isSubagent ? sidechainCwd || cwd : cwd
  const effectiveTitle = isSubagent ? sidechainTitle || title : title
  const launchCommand = ['claude', model ? `--model '${model.replace(/'/g, `'\\''`)}'` : '', permissionMode ? `--permission-mode '${permissionMode.replace(/'/g, `'\\''`)}'` : '']
    .filter(Boolean)
    .join(' ')
  return {
    source: 'claude-code',
    sessionId,
    title: effectiveTitle,
    summary: effectiveTitle,
    cwd: effectiveCwd,
    transcriptPath: path,
    modifiedAt: mtimeMs,
    model: effectiveModel,
    launchCommand: isSubagent ? undefined : launchCommand,
    ...(sessionKind ? { sessionKind } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(typeof restorable === 'boolean' ? { restorable } : {})
  }
}

const claudeParentSessionIdFromPath = (path: string) => {
  const parts = resolve(path).split(/[\\/]+/)
  const subagentsIndex = parts.lastIndexOf('subagents')
  if (subagentsIndex <= 0) return undefined
  return cleanOptionalText(parts[subagentsIndex - 1])
}

const importClaudeSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const candidates: CandidateBase[] = []
  for (const claudeHome of claudeHomesFor(config.getEnv(), config.getHomeDir())) {
    const projectsRoot = join(claudeHome, 'projects')
    let projectDirs: string[]
    try {
      projectDirs = (await readdir(projectsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      continue
    }
    const files = (await Promise.all(
      projectDirs.map(async (projectDirName) =>
        (await collectFiles(join(projectsRoot, projectDirName)))
          .map((file) => ({ ...file, projectDirName }))
      )
    )).flat()
    files.sort((first, second) => second.mtimeMs - first.mtimeMs)
    const parsed = await Promise.all(
      files.map((file) =>
        parseCachedJsonl(config.jsonlParseCache, 'claude-code', file, (path, mtimeMs) => parseClaudeJsonl(path, file.projectDirName, mtimeMs))
      )
    )
    candidates.push(...(parsed.filter(Boolean) as CandidateBase[]))
  }
  return candidates.sort((first, second) => second.modifiedAt - first.modifiedAt)
}

const opencodeConfigPath = (env: NodeJS.ProcessEnv, home: string) => cleanPath(env.OPENCODE_CONFIG_DIR) || pathInHome(home, '.local/share/opencode')

const parseOpenCodeAssistant = (raw: unknown) => {
  const text = cleanOptionalText(raw)
  if (!text) return {}
  const obj = safeReadJson(text)
  const providerId = cleanOptionalText(obj?.providerID)
  const modelId = cleanOptionalText(obj?.modelID)
  const agentName = cleanOptionalText(obj?.agent)
  return {
    model: providerId && modelId ? `${providerId}/${modelId}` : modelId,
    agentName
  }
}

const importOpenCodeSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const dbPath = join(opencodeConfigPath(config.getEnv(), config.getHomeDir()), 'opencode.db')
  const snapshot = await snapshotSqliteDatabase(dbPath, 'aiopsterm-opencode-sessions')
  if (!snapshot) return []
  let db: SqliteDatabase | null = null
  try {
    db = config.openSqliteDatabase(snapshot.path, true)
    const rows = queryRows<OpenCodeSessionRow>(
      db,
      `SELECT s.id, s.title, s.directory, s.time_updated, (
           SELECT data FROM message
           WHERE session_id = s.id AND data LIKE '%"role":"assistant"%'
           ORDER BY time_created DESC LIMIT 1
       ) AS last_assistant
       FROM session s
       ORDER BY s.time_updated DESC`
    )
    return rows
      .map((row) => {
        const sessionId = cleanOptionalText(row.id)
        if (!sessionId) return null
        const assistant = parseOpenCodeAssistant(row.last_assistant)
        return {
          source: 'opencode' as const,
          sessionId,
          title: cleanOptionalText(row.title),
          summary: assistant.model ? `Model: ${assistant.model}` : cleanOptionalText(row.title),
          cwd: cleanOptionalText(row.directory),
          modifiedAt: Number(row.time_updated || 0),
          model: assistant.model
        } satisfies CandidateBase
      })
      .filter(Boolean) as CandidateBase[]
  } catch {
    return []
  } finally {
    db?.close()
    await snapshot.dispose()
  }
}

export const createAgentSessionImportRuntime = (config: Partial<AgentSessionImportRuntimeConfig> = {}): AgentSessionImportRuntime => {
  let jsonlParseCache = new Map<string, JsonlParseCacheEntry>()
  const defaultConfig: AgentSessionImportRuntimeConfig = {
    getHomeDir: defaultHomeDir,
    getEnv: () => process.env,
    now: () => Date.now(),
    enabled: process.env.AIOPSTERM_AGENT_SESSION_IMPORT_DISABLED !== '1',
    cacheTtlMs: 30_000,
    openSqliteDatabase,
    jsonlParseCache,
    getParserDefinitions: config.getParserDefinitions || (() => [])
  }
  let runtimeConfig: AgentSessionImportRuntimeConfig = { ...defaultConfig, ...config, jsonlParseCache: config.jsonlParseCache || jsonlParseCache }
  let cachedAt = 0
  let cachedSessions: ImportedAgentSession[] = []

  return {
    configure: (input = {}) => {
      jsonlParseCache = input.jsonlParseCache || new Map<string, JsonlParseCacheEntry>()
      runtimeConfig = { ...defaultConfig, ...input, jsonlParseCache }
      cachedAt = 0
      cachedSessions = []
    },
    invalidateCache: () => {
      cachedAt = 0
      cachedSessions = []
      jsonlParseCache.clear()
    },
    importSessions: async () => {
      if (runtimeConfig.importSessions) return runtimeConfig.importSessions()
      if (!runtimeConfig.enabled) return []
      const now = runtimeConfig.now()
      if (runtimeConfig.cacheTtlMs > 0 && cachedAt > 0 && now - cachedAt < runtimeConfig.cacheTtlMs) {
        return cachedSessions
      }
      const imported = await Promise.all([
        importCodexSessions(runtimeConfig),
        importClaudeSessions(runtimeConfig),
        importOpenCodeSessions(runtimeConfig),
        importParserConfiguredSessions(runtimeConfig)
      ])
      const seen = new Set<string>()
      const importedSessions = imported
        .flat()
        .filter((candidate) => {
          if (!candidate.sessionId || !Number.isFinite(candidate.modifiedAt) || candidate.modifiedAt <= 0) return false
          const key = sessionKey(candidate.source, candidate.sessionId)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((first, second) => second.modifiedAt - first.modifiedAt)
        .map((candidate) => importedRecordFor(candidate, runtimeConfig.now()))
      cachedAt = now
      cachedSessions = importedSessions
      return importedSessions
    }
  }
}
