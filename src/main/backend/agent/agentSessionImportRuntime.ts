import { createHash, randomUUID } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { copyFile, mkdir, readFile, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { openSqliteDatabase, type SqliteDatabase } from '@shared/databaseSqliteRuntime'
import type {
  AiAgentSessionSource,
  ManagedAiSessionRecord,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import {
  cleanOptionalText,
  compactRawRecord,
  resumeCommandFor,
  sessionKey,
  sourceLabel
} from './agentSessionNormalization'

export type ImportedAgentSession = Omit<ManagedAiSessionRecord, 'decisions'>

export type AgentSessionImportRuntime = {
  configure: (input?: Partial<AgentSessionImportRuntimeConfig>) => void
  importSessions: () => Promise<ImportedAgentSession[]>
}

type AgentSessionImportRuntimeConfig = {
  getHomeDir: () => string
  getEnv: () => NodeJS.ProcessEnv
  now: () => number
  maxPerSource: number
  enabled: boolean
  cacheTtlMs: number
  importSessions?: () => Promise<ImportedAgentSession[]>
}

type CandidateBase = {
  source: AiAgentSessionSource
  sessionId: string
  title?: string
  summary?: string
  cwd?: string
  transcriptPath?: string
  modifiedAt: number
  model?: string
  launchCommand?: string
  resumeCommand?: string
}

type CodexThreadRow = {
  id?: string
  rollout_path?: string
  cwd?: string
  title?: string
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

const defaultMaxPerSource = 40
const maxScanFiles = 1600
const maxJsonlReadBytes = 4 * 1024 * 1024

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
  const resumeCommand = candidate.resumeCommand || resumeCommandFor(candidate.source, candidate.sessionId, candidate.cwd, candidate.launchCommand)
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
    ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
    raw: compactRawRecord({
      imported: true,
      source: candidate.source,
      model: candidate.model,
      transcriptPath: candidate.transcriptPath
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
    ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
    requestKind: 'telemetry',
    decisionMode: 'telemetry',
    ...(candidate.launchCommand ? { launchCommand: candidate.launchCommand } : {}),
    ...(resumeCommand ? { resumeCommand } : {}),
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

const collectFiles = (root: string, extension = '.jsonl') => {
  const out: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]
  while (stack.length && out.length < maxScanFiles) {
    const current = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry)
      let stat
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(path)
      } else if (stat.isFile() && path.endsWith(extension)) {
        out.push({ path, mtimeMs: stat.mtimeMs })
        if (out.length >= maxScanFiles) break
      }
    }
  }
  return out.sort((first, second) => second.mtimeMs - first.mtimeMs)
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

const importCodexFromSqlite = async (codexHome: string, limit: number): Promise<CandidateBase[] | null> => {
  const dbPath = join(codexHome, 'state_5.sqlite')
  const snapshot = await snapshotSqliteDatabase(dbPath, 'aiopsterm-codex-sessions')
  if (!snapshot) return null
  let db: SqliteDatabase | null = null
  try {
    db = openSqliteDatabase(snapshot.path, true)
    const rows = queryRows<CodexThreadRow>(
      db,
      `SELECT id, rollout_path, cwd, title, model, git_branch, approval_mode, sandbox_policy, reasoning_effort, first_user_message, updated_at_ms
       FROM threads
       WHERE archived = 0
       ORDER BY updated_at_ms DESC
       LIMIT ?`,
      [limit]
    )
    return rows
      .map((row) => {
        const sessionId = cleanOptionalText(row.id)
        if (!sessionId) return null
        const cwd = cleanOptionalText(row.cwd)
        return {
          source: 'codex' as const,
          sessionId,
          title: cleanOptionalText(row.title) || realCodexUserMessage(row.first_user_message),
          summary: realCodexUserMessage(row.first_user_message) || cleanOptionalText(row.title),
          cwd,
          transcriptPath: cleanOptionalText(row.rollout_path),
          modifiedAt: Number(row.updated_at_ms || 0) || safeStatMtime(cleanOptionalText(row.rollout_path) || ''),
          model: cleanOptionalText(row.model),
          resumeCommand: codexResumeCommand(row, cwd)
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
  for (const obj of lines) {
    const type = cleanOptionalText(obj.type)
    const payload = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload) ? (obj.payload as Record<string, unknown>) : {}
    if (type === 'session_meta') {
      sessionId = cleanOptionalText(payload.id) || sessionId
      cwd = cleanOptionalText(payload.cwd) || cwd
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
  return {
    source: 'codex',
    sessionId,
    title: title || firstUserMessage,
    summary: firstUserMessage || title,
    cwd,
    transcriptPath: path,
    modifiedAt: mtimeMs,
    model,
    resumeCommand: codexResumeCommand(
      {
        id: sessionId,
        model,
        approval_mode: approvalPolicy,
        sandbox_policy: sandboxMode ? JSON.stringify({ type: sandboxMode }) : undefined,
        reasoning_effort: effort
      },
      cwd
    )
  }
}

const importCodexFromDisk = async (codexHome: string, limit: number) => {
  const files = collectFiles(join(codexHome, 'sessions')).slice(0, Math.min(limit * 2, maxScanFiles))
  const candidates = await Promise.all(files.map((file) => parseCodexJsonl(file.path, file.mtimeMs)))
  return candidates.filter(Boolean).slice(0, limit) as CandidateBase[]
}

const importCodexSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const home = codexHomeFor(config.getEnv(), config.getHomeDir())
  const sql = await importCodexFromSqlite(home, config.maxPerSource)
  return sql ?? importCodexFromDisk(home, config.maxPerSource)
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
  let cwd = decodeClaudeProjectDir(projectDirName)
  let model: string | undefined
  let permissionMode: string | undefined
  for (const obj of lines) {
    cwd = cleanOptionalText(obj.cwd) || cwd
    permissionMode = cleanOptionalText(obj.permissionMode) || permissionMode
    const message = obj.message && typeof obj.message === 'object' && !Array.isArray(obj.message) ? obj.message as Record<string, unknown> : null
    if (!message) continue
    if (message.role === 'user' && !title) title = claudeDisplayTitle(textFromClaudeContent(message.content))
    if (message.role === 'assistant') model = cleanOptionalText(message.model) || model
  }
  const sessionId = resolve(path).replace(/\.[^.]+$/, '').split(/[\\/]/).pop() || ''
  if (!sessionId) return null
  const launchCommand = ['claude', model ? `--model '${model.replace(/'/g, `'\\''`)}'` : '', permissionMode ? `--permission-mode '${permissionMode.replace(/'/g, `'\\''`)}'` : '']
    .filter(Boolean)
    .join(' ')
  return {
    source: 'claude-code',
    sessionId,
    title,
    summary: title,
    cwd,
    transcriptPath: path,
    modifiedAt: mtimeMs,
    model,
    launchCommand
  }
}

const importClaudeSessions = async (config: AgentSessionImportRuntimeConfig) => {
  const candidates: CandidateBase[] = []
  for (const claudeHome of claudeHomesFor(config.getEnv(), config.getHomeDir())) {
    const projectsRoot = join(claudeHome, 'projects')
    let projectDirs: string[]
    try {
      projectDirs = readdirSync(projectsRoot)
    } catch {
      continue
    }
    const files = projectDirs.flatMap((projectDirName) =>
      collectFiles(join(projectsRoot, projectDirName))
        .map((file) => ({ ...file, projectDirName }))
    )
    files.sort((first, second) => second.mtimeMs - first.mtimeMs)
    const parsed = await Promise.all(files.slice(0, config.maxPerSource * 2).map((file) => parseClaudeJsonl(file.path, file.projectDirName, file.mtimeMs)))
    candidates.push(...(parsed.filter(Boolean) as CandidateBase[]))
  }
  return candidates.sort((first, second) => second.modifiedAt - first.modifiedAt).slice(0, config.maxPerSource)
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
    db = openSqliteDatabase(snapshot.path, true)
    const rows = queryRows<OpenCodeSessionRow>(
      db,
      `SELECT s.id, s.title, s.directory, s.time_updated, (
           SELECT data FROM message
           WHERE session_id = s.id AND data LIKE '%"role":"assistant"%'
           ORDER BY time_created DESC LIMIT 1
       ) AS last_assistant
       FROM session s
       ORDER BY s.time_updated DESC
       LIMIT ?`,
      [config.maxPerSource]
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
  const defaultConfig: AgentSessionImportRuntimeConfig = {
    getHomeDir: defaultHomeDir,
    getEnv: () => process.env,
    now: () => Date.now(),
    maxPerSource: defaultMaxPerSource,
    enabled: process.env.AIOPSTERM_AGENT_SESSION_IMPORT_DISABLED !== '1',
    cacheTtlMs: 30_000
  }
  let runtimeConfig: AgentSessionImportRuntimeConfig = { ...defaultConfig, ...config }
  let cachedAt = 0
  let cachedSessions: ImportedAgentSession[] = []

  return {
    configure: (input = {}) => {
      runtimeConfig = { ...defaultConfig, ...input }
      cachedAt = 0
      cachedSessions = []
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
        importOpenCodeSessions(runtimeConfig)
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
