import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { promisify } from 'util'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionLifecycleEvent,
  CodexSessionThreadEvent,
  CodexSessionPendingContextResult,
  CodexSessionWriteResult,
  CodexSessionKillResult
} from '@shared/contracts/codexSessions'
import type { UserConfig } from '@shared/contracts/userConfig'
import { codexBridgeScriptPath, mergeAiopstermCodexConfigToml, resolveAiopstermCodexProviderConfig } from './codexConfig'

export type CodexPtyProcess = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

export type CodexPtyRuntime = {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; useConpty?: boolean }
  ): CodexPtyProcess
}

export type CodexProcessRuntime = Pick<typeof import('child_process'), 'spawn'>
type CodexBinaryHealthCheckRunner = (
  binaryPath: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv }
) => Promise<unknown>

type CodexRuntimeConfig = {
  getUserDataPath?: () => string
  getAppPath?: () => string
  getResourcesPath?: () => string
  getConfig?: () => UserConfig
  getEnv?: () => NodeJS.ProcessEnv
  getPlatform?: () => NodeJS.Platform
  loadPty?: () => CodexPtyRuntime | null
  processRuntime?: CodexProcessRuntime
  mkdir?: typeof mkdir
  readFile?: typeof readFile
  writeFile?: typeof writeFile
  existsSync?: typeof existsSync
  execFile?: CodexBinaryHealthCheckRunner
  binaryPath?: string
  binaryHealthCheck?: false | ((binaryPath: string) => void | Promise<void>)
  binaryHealthCheckTimeoutMs?: number
  getBridgeSocketPath?: () => string
  resolveThreadTitle?: (codexHome: string, threadId: string) => Promise<string | undefined> | string | undefined
}

type CodexEventSink = {
  lifecycle: (event: CodexSessionLifecycleEvent) => void
  exit: (event: CodexSessionLifecycleEvent, code?: number | null) => void
  data: (id: string, chunk: string | Buffer) => void
  thread?: (event: CodexSessionThreadEvent) => Promise<void> | void
  closed?: (id: string) => void
}

type CodexSessionRecord = {
  id: string
  productSessionId: string
  process: CodexPtyProcess | CodexProcessSession
  binaryPath: string
  cwd: string
  codexHome: string
  pendingContextPath: string
  threadInfoPath: string
  threadInfoTimer: ReturnType<typeof setInterval> | null
  threadInfoPollInFlight: boolean
  threadInfoPollPromise: Promise<void> | null
  lastThreadInfoReadAt: number
  launchThreadId: string
  lastThreadCandidateId: string
  lastThreadId: string
  lastThreadTitle: string
  lastThreadRolloutPath: string
  lastThreadRolloutCheckAt: number
  lastThreadTitleCheckAt: number
  runtimeKind: 'pty' | 'process'
  closed: boolean
}

type CodexProcessSession = {
  write(data: string | Buffer): void
  resize(cols: number, rows: number): void
  kill(): void
}

const runtimeConfig: CodexRuntimeConfig = {}
const sessions = new Map<string, CodexSessionRecord>()
let lastCodexRolloutFallbackScanAt = 0
// 健康检查结果按 binaryPath+mtime 缓存，避免每次创建会话都执行 codex --version。
const codexBinaryHealthChecks = new Map<string, Promise<void>>()

const defaultLoadPty = (): CodexPtyRuntime | null => {
  try {
    return require('node-pty') as CodexPtyRuntime
  } catch {
    return null
  }
}

const defaultAppPath = () => process.cwd()
const defaultResourcesPath = () => process.resourcesPath || process.cwd()
const defaultEnv = () => process.env
const getExistsSync = () => runtimeConfig.existsSync || existsSync
const getMkdir = () => runtimeConfig.mkdir || mkdir
const getReadFile = () => runtimeConfig.readFile || readFile
const getWriteFile = () => runtimeConfig.writeFile || writeFile
const getPtyRuntime = () => (runtimeConfig.loadPty || defaultLoadPty)()
const getProcessRuntime = () => runtimeConfig.processRuntime || { spawn }
const getPlatform = () => runtimeConfig.getPlatform?.() || process.platform
const execFileAsync = promisify(execFile)
const getExecFile = (): CodexBinaryHealthCheckRunner => runtimeConfig.execFile || ((file, args, options) => execFileAsync(file, args, options))

const codexTerminalEnv = (baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1'
  }
  delete env.NO_COLOR
  return env
}

export const configureCodexCliRuntime = (config: CodexRuntimeConfig = {}) => {
  for (const record of sessions.values()) stopThreadInfoPolling(record)
  runtimeConfig.getUserDataPath = config.getUserDataPath
  runtimeConfig.getAppPath = config.getAppPath
  runtimeConfig.getResourcesPath = config.getResourcesPath
  runtimeConfig.getConfig = config.getConfig
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.getPlatform = config.getPlatform
  runtimeConfig.loadPty = config.loadPty
  runtimeConfig.processRuntime = config.processRuntime
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.readFile = config.readFile
  runtimeConfig.writeFile = config.writeFile
  runtimeConfig.existsSync = config.existsSync
  runtimeConfig.execFile = config.execFile
  runtimeConfig.binaryPath = config.binaryPath
  runtimeConfig.binaryHealthCheck = config.binaryHealthCheck
  runtimeConfig.binaryHealthCheckTimeoutMs = config.binaryHealthCheckTimeoutMs
  runtimeConfig.getBridgeSocketPath = config.getBridgeSocketPath
  runtimeConfig.resolveThreadTitle = config.resolveThreadTitle
  sessions.clear()
  lastCodexRolloutFallbackScanAt = 0
  codexBinaryHealthChecks.clear()
}

const codexHomePath = () => {
  const userDataPath = runtimeConfig.getUserDataPath?.()
  if (!userDataPath) throw Object.assign(new Error('Codex userData path is unavailable.'), { code: 'CODEX_USER_DATA_UNAVAILABLE' })
  return join(userDataPath, 'codex-agent')
}

const codexPendingContextPath = (codexHome: string, id: string) => join(codexHome, 'aiopsterm-pending-context', `${id}.txt`)

export const codexThreadInfoPath = (codexHome: string, id: string) => join(codexHome, 'aiopsterm-thread-info', `${id}.json`)

const codexSavedSessionRoots = (codexHome: string) => [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')]

const codexWorkspaceIdentity = (options: CodexSessionCreateOptions) => {
  const target = options.target
  if (target?.kind === 'local') return 'local'
  if (target?.kind === 'ssh') {
    if (target.assetId?.trim()) return `asset:${target.assetId.trim()}`
    return `ssh:${target.username?.trim() || 'unknown'}@${target.host?.trim() || 'unknown'}:${target.port || 22}`
  }
  return 'unbound'
}

export const codexWorkspaceDirectory = (codexHome: string, options: CodexSessionCreateOptions) => {
  const identity = codexWorkspaceIdentity(options)
  if (identity === 'local') return join(codexHome, 'workspaces', 'local')
  const readable = identity
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  return join(codexHome, 'workspaces', `${readable}-${digest}`)
}
const codexThreadIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const codexThreadDeletionAlreadyAbsent = (error: unknown) => {
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown } | null
  const detail = [candidate?.message, candidate?.stderr, candidate?.stdout]
    .filter((value): value is string | Buffer => typeof value === 'string' || Buffer.isBuffer(value))
    .map((value) => String(value))
    .join('\n')
    .toLowerCase()
  return detail.includes('thread not found:')
}
const codexRolloutTimestampPattern = /^\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}$/
const codexThreadInfoPollMs = 250
const codexSettledThreadInfoPollMs = 1000
const codexThreadFallbackScanCooldownMs = 5000
const codexThreadTitlePollMs = 1000
const codexThreadTitleRefreshMs = 5000
const codexRolloutFallbackScanMaxEntries = 50_000
const isMissingFilesystemEntry = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const pathIsInside = (root: string, candidate: string) => {
  const child = relative(root, candidate)
  return Boolean(child) && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

const rolloutFileBelongsToThread = (path: string, threadId: string) => {
  const fileName = basename(path).toLowerCase()
  const plainFileName = fileName.endsWith('.jsonl.zst') ? fileName.slice(0, -4) : fileName
  const suffix = `-${threadId.toLowerCase()}.jsonl`
  if (!plainFileName.startsWith('rollout-') || !plainFileName.endsWith(suffix)) return false
  return codexRolloutTimestampPattern.test(plainFileName.slice('rollout-'.length, -suffix.length))
}

const durableCodexRolloutPath = async (candidate: string, roots: string[], threadId: string) => {
  const absoluteCandidate = resolve(candidate)
  const lexicalRoot = roots.find((root) => pathIsInside(resolve(root), absoluteCandidate))
  if (!lexicalRoot || !rolloutFileBelongsToThread(absoluteCandidate, threadId)) return null
  try {
    const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(lexicalRoot), realpath(absoluteCandidate)])
    if (!pathIsInside(resolvedRoot, resolvedCandidate) || !rolloutFileBelongsToThread(resolvedCandidate, threadId)) return null
    const metadata = await stat(resolvedCandidate)
    return metadata.isFile() && metadata.size > 0 ? resolvedCandidate : null
  } catch (error) {
    if (isMissingFilesystemEntry(error)) return null
    throw error
  }
}

const findCodexRolloutInRoot = async (
  root: string,
  roots: string[],
  threadId: string,
  budget: { remaining: number }
) => {
  const pending = [root]
  while (pending.length) {
    if (budget.remaining <= 0) return null
    budget.remaining -= 1
    const directory = pending.pop()
    if (!directory) continue
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissingFilesystemEntry(error)) continue
      throw error
    }
    for (const entry of entries) {
      if (budget.remaining <= 0) return null
      budget.remaining -= 1
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (!entry.isFile() || !rolloutFileBelongsToThread(path, threadId)) continue
      const durablePath = await durableCodexRolloutPath(path, roots, threadId)
      if (durablePath) return durablePath
    }
  }
  return null
}

export const findCodexSavedSessionRolloutPath = async (
  threadId: string,
  rolloutPathHint?: string,
  options: { scanFallback?: boolean } = {}
): Promise<string | null> => {
  const normalizedThreadId = String(threadId || '').trim().toLowerCase()
  if (!codexThreadIdPattern.test(normalizedThreadId)) return null
  const roots = codexSavedSessionRoots(codexHomePath()).map((root) => resolve(root))
  const hint = String(rolloutPathHint || '').trim()
  if (hint) {
    const durableHint = await durableCodexRolloutPath(hint, roots, normalizedThreadId)
    if (durableHint) return durableHint
  }
  if (options.scanFallback === false) return null
  const budget = { remaining: codexRolloutFallbackScanMaxEntries }
  for (const root of roots) {
    const durablePath = await findCodexRolloutInRoot(root, roots, normalizedThreadId, budget)
    if (durablePath) return durablePath
  }
  return null
}

export const normalizeCodexThreadTitle = (value: unknown) => {
  const text = typeof value === 'string'
    ? value
      .replace(/^## My request for Codex:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    : ''
  if (!text) return ''
  if (
    text.startsWith('<environment_context') ||
    text.startsWith('<user_instructions') ||
    text.startsWith('<permissions') ||
    text.startsWith('<system') ||
    text.startsWith('# AGENTS.md')
  ) return ''
  let title = ''
  for (const codePoint of text) {
    if (title.length + codePoint.length > 256) break
    title += codePoint
  }
  return title
}

type CodexStateDatabase = {
  prepare: (sql: string) => { get: (...params: unknown[]) => Record<string, unknown> | undefined }
  close: () => void
}

const resolveCodexThreadTitleFromState = (codexHome: string, threadId: string) => {
  const statePath = join(codexHome, 'state_5.sqlite')
  if (!getExistsSync()(statePath)) return ''
  let db: CodexStateDatabase | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('better-sqlite3') as
      | (new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => CodexStateDatabase)
      | { default?: new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => CodexStateDatabase }
    const Database = typeof loaded === 'function' ? loaded : loaded.default
    if (!Database) return ''
    db = new Database(statePath, { readonly: true, fileMustExist: true })
    const row = db.prepare('SELECT title, first_user_message FROM threads WHERE id = ? LIMIT 1').get(threadId)
    return normalizeCodexThreadTitle(row?.title) || normalizeCodexThreadTitle(row?.first_user_message)
  } catch {
    return ''
  } finally {
    db?.close()
  }
}

const codexThreadExistsInState = (codexHome: string, threadId: string): boolean | null => {
  const statePath = join(codexHome, 'state_5.sqlite')
  if (!getExistsSync()(statePath)) return false
  let db: CodexStateDatabase | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('better-sqlite3') as
      | (new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => CodexStateDatabase)
      | { default?: new (path: string, options: { readonly: boolean; fileMustExist: boolean }) => CodexStateDatabase }
    const Database = typeof loaded === 'function' ? loaded : loaded.default
    if (!Database) return null
    db = new Database(statePath, { readonly: true, fileMustExist: true })
    return Boolean(db.prepare('SELECT id FROM threads WHERE id = ? LIMIT 1').get(threadId))
  } catch {
    return null
  } finally {
    db?.close()
  }
}

const codexThreadPersistenceState = async (
  codexHome: string,
  threadId: string
): Promise<'present' | 'absent' | 'unknown'> => {
  const existsInState = codexThreadExistsInState(codexHome, threadId)
  const rolloutPath = await findCodexSavedSessionRolloutPath(threadId)
  if (existsInState || rolloutPath) return 'present'
  return existsInState === false ? 'absent' : 'unknown'
}

const resolveCodexThreadTitle = (codexHome: string, threadId: string) =>
  runtimeConfig.resolveThreadTitle
    ? runtimeConfig.resolveThreadTitle(codexHome, threadId)
    : resolveCodexThreadTitleFromState(codexHome, threadId)

const codexLaunchArgs = (options: CodexSessionCreateOptions) => {
  const launch = options.launch || { mode: 'new' as const }
  if (launch.mode === 'new') return []
  const threadId = String(launch.threadId || '').trim()
  if (!threadId || threadId.length > 256 || /[\u0000-\u001f\u007f]/.test(threadId)) {
    throw Object.assign(new Error('A valid Codex thread id is required for resume or fork.'), {
      code: 'CODEX_THREAD_ID_INVALID'
    })
  }
  return [launch.mode, threadId]
}

const parseCodexThreadInfo = (id: string, raw: string): CodexSessionThreadEvent | null => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const threadId = String(source.threadId || '').trim()
  if (!threadId || threadId.length > 256 || /[\u0000-\u001f\u007f]/.test(threadId)) return null
  const rawReason = String(source.reason || '').trim()
  const reason = rawReason === 'resume' || rawReason === 'fork' || rawReason === 'switch' ? rawReason : 'new'
  const title = normalizeCodexThreadTitle(source.title)
  const cwd = typeof source.cwd === 'string' && source.cwd.trim() ? source.cwd : undefined
  const rolloutPath = typeof source.rolloutPath === 'string' && source.rolloutPath.trim() ? source.rolloutPath : undefined
  return {
    id,
    threadId,
    reason,
    at: Date.now(),
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(rolloutPath ? { rolloutPath } : {})
  }
}

const stopThreadInfoPolling = (record: CodexSessionRecord) => {
  if (record.threadInfoTimer) clearInterval(record.threadInfoTimer)
  record.threadInfoTimer = null
  void rm(record.threadInfoPath, { force: true }).catch(() => undefined)
}

const startThreadInfoPolling = (record: CodexSessionRecord, sink: CodexEventSink) => {
  const poll = () => {
    if (record.closed || record.threadInfoPollInFlight) return
    const readInterval = record.lastThreadTitle ? codexSettledThreadInfoPollMs : codexThreadInfoPollMs
    const startedAt = Date.now()
    if (startedAt - record.lastThreadInfoReadAt < readInterval) return
    record.lastThreadInfoReadAt = startedAt
    record.threadInfoPollInFlight = true
    let pending!: Promise<void>
    pending = (async () => {
      try {
        const event = parseCodexThreadInfo(record.id, String(await getReadFile()(record.threadInfoPath, 'utf-8')))
        if (!event) return
        const now = Date.now()
        if (event.threadId !== record.lastThreadCandidateId) {
          record.lastThreadCandidateId = event.threadId
          record.lastThreadTitle = ''
          record.lastThreadRolloutPath = ''
          record.lastThreadRolloutCheckAt = 0
          record.lastThreadTitleCheckAt = 0
        }
        const sameThread = event.threadId === record.lastThreadId
        if (!record.lastThreadRolloutPath && now - record.lastThreadRolloutCheckAt < codexThreadInfoPollMs) return
        record.lastThreadRolloutCheckAt = now
        let rolloutPath = record.lastThreadRolloutPath || await findCodexSavedSessionRolloutPath(
          event.threadId,
          event.rolloutPath,
          { scanFallback: false }
        )
        if (!rolloutPath && now - lastCodexRolloutFallbackScanAt >= codexThreadFallbackScanCooldownMs) {
          lastCodexRolloutFallbackScanAt = now
          rolloutPath = await findCodexSavedSessionRolloutPath(event.threadId, event.rolloutPath)
        }
        if (!rolloutPath || record.closed || !record.threadInfoTimer) return
        record.lastThreadRolloutPath = rolloutPath
        let title = event.title || ''
        const titlePollInterval = record.lastThreadTitle ? codexThreadTitleRefreshMs : codexThreadTitlePollMs
        if (!title && now - record.lastThreadTitleCheckAt >= titlePollInterval) {
          record.lastThreadTitleCheckAt = now
          try {
            title = normalizeCodexThreadTitle(await resolveCodexThreadTitle(record.codexHome, event.threadId))
          } catch {
            title = ''
          }
        }
        if (sameThread && (!title || title === record.lastThreadTitle)) return
        await sink.thread?.({
          ...event,
          previousThreadId: record.lastThreadId || record.launchThreadId || null,
          rolloutPath,
          ...(title ? { title } : {})
        })
        record.lastThreadId = event.threadId
        if (title) record.lastThreadTitle = title
      } catch {
        // The TUI creates thread info first; its rollout becomes durable after the first persisted turn.
      } finally {
        record.threadInfoPollInFlight = false
        if (record.threadInfoPollPromise === pending) record.threadInfoPollPromise = null
      }
    })()
    record.threadInfoPollPromise = pending
    return pending
  }
  record.threadInfoTimer = setInterval(() => void poll(), codexThreadInfoPollMs)
  record.threadInfoTimer.unref?.()
  void poll()
}

const codexBinaryName = () => (process.platform === 'win32' ? 'codex.exe' : 'codex')

const codexTargetTriple = () => {
  if (process.platform === 'linux' || process.platform === 'android') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-musl'
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-musl'
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'x86_64-apple-darwin'
    if (process.arch === 'arm64') return 'aarch64-apple-darwin'
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'x86_64-pc-windows-msvc'
    if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc'
  }
  return ''
}

const codexDevTargetTriple = () => {
  if (process.platform === 'linux' || process.platform === 'android') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-gnu'
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  }
  return codexTargetTriple()
}

const candidateCodexBinaryPaths = () => {
  const configured = runtimeConfig.binaryPath || process.env.AIOPSTERM_CODEX_BIN
  const configuredPackage = process.env.AIOPSTERM_CODEX_PACKAGE_DIR
  const appPath = runtimeConfig.getAppPath?.() || defaultAppPath()
  const resourcesPath = runtimeConfig.getResourcesPath?.() || defaultResourcesPath()
  const binaryName = codexBinaryName()
  const targetTriple = codexTargetTriple()
  const devTargetTriple = codexDevTargetTriple()
  return [
    configured,
    configuredPackage ? join(configuredPackage, 'bin', binaryName) : '',
    join(resourcesPath, 'codex', 'bin', binaryName),
    join(resourcesPath, 'app.asar.unpacked', 'codex', 'bin', binaryName),
    devTargetTriple ? join(appPath, 'codex', 'codex-rs', 'target', devTargetTriple, 'aiopsterm-codex-dev-package', 'bin', binaryName) : '',
    targetTriple ? join(appPath, 'codex', 'codex-rs', 'target', targetTriple, 'aiopsterm-codex-package', 'bin', binaryName) : '',
    targetTriple ? join(appPath, 'codex', 'codex-rs', 'target', targetTriple, 'release', binaryName) : '',
    targetTriple ? join(appPath, 'codex', 'codex-rs', 'target', targetTriple, 'debug', binaryName) : ''
  ]
    .filter((path): path is string => Boolean(path && String(path).trim()))
    .map((path) => resolve(path))
}

const codexPackageRootForBinary = (binaryPath: string) => {
  const binDir = dirname(binaryPath)
  const packageRoot = dirname(binDir)
  if (basename(binDir) !== 'bin') return ''
  return getExistsSync()(join(packageRoot, 'codex-package.json')) ? packageRoot : ''
}

const normalizeCodexBinaryHealthCheckTimeoutMs = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30000
  return Math.max(1000, Math.min(120000, Math.round(parsed)))
}

const codexBinaryHealthCheckTimeoutMs = () =>
  normalizeCodexBinaryHealthCheckTimeoutMs(runtimeConfig.binaryHealthCheckTimeoutMs ?? process.env.AIOPSTERM_CODEX_HEALTH_CHECK_TIMEOUT_MS)

const defaultCodexBinaryHealthCheck = async (binaryPath: string) => {
  const timeout = codexBinaryHealthCheckTimeoutMs()
  try {
    await getExecFile()(binaryPath, ['--version'], {
      timeout,
      env: {
        ...process.env,
        CODEX_HOME: process.env.CODEX_HOME || ''
      }
    })
  } catch (error) {
    const record = error as { code?: string; killed?: boolean; signal?: string; stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    const details = [record.stderr, record.stdout, record.message]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n')
    const timedOut =
      String(record.code || '').toUpperCase() === 'ETIMEDOUT' ||
      /\bETIMEDOUT\b/i.test(String(record.message || '')) ||
      (record.killed === true && Boolean(record.signal))
    const reason = timedOut ? `timed out after ${timeout}ms running ${binaryPath} --version` : details || binaryPath
    throw Object.assign(new Error(`Codex binary failed health check: ${reason}${timedOut && details ? `\n${details}` : ''}`), {
      code: 'CODEX_BINARY_UNUSABLE',
      binaryPath,
      timeoutMs: timeout
    })
  }
}

const codexBinaryMtimeMs = async (binaryPath: string) => {
  try {
    return (await stat(binaryPath)).mtimeMs
  } catch {
    return 0
  }
}

export const checkCodexBinary = async (binaryPath: string) => {
  if (runtimeConfig.binaryHealthCheck === false) return
  if (runtimeConfig.binaryHealthCheck) {
    await runtimeConfig.binaryHealthCheck(binaryPath)
    return
  }
  const cacheKey = `${binaryPath}:${await codexBinaryMtimeMs(binaryPath)}`
  const cached = codexBinaryHealthChecks.get(cacheKey)
  if (cached) return cached
  const check = defaultCodexBinaryHealthCheck(binaryPath)
  codexBinaryHealthChecks.set(cacheKey, check)
  try {
    await check
  } catch (error) {
    // 失败不缓存：二进制未变时也允许下次会话重试（如瞬时超时）。
    codexBinaryHealthChecks.delete(cacheKey)
    throw error
  }
}

export const resolveCodexBinaryPath = () => {
  const exists = getExistsSync()
  const candidates = candidateCodexBinaryPaths()
  const found = candidates.find((path) => exists(path))
  if (found) return found
  const error = new Error(`Codex binary was not found. Checked: ${candidates.join(', ')}`)
  throw Object.assign(error, { code: 'CODEX_BINARY_NOT_FOUND', candidates })
}

export const deleteCodexNativeThread = async (threadIdInput: string) => {
  const threadId = String(threadIdInput || '').trim().toLowerCase()
  if (!codexThreadIdPattern.test(threadId)) {
    throw Object.assign(new Error('A valid Codex thread UUID is required for permanent deletion.'), {
      code: 'CODEX_THREAD_ID_INVALID'
    })
  }
  const binaryPath = resolveCodexBinaryPath()
  await checkCodexBinary(binaryPath)
  const codexHome = codexHomePath()
  for (const record of [...sessions.values()]) {
    const activeThreadId = record.lastThreadId || record.launchThreadId
    if (activeThreadId.toLowerCase() !== threadId) continue
    stopThreadInfoPolling(record)
    record.process.kill()
  }
  try {
    await getExecFile()(binaryPath, ['delete', '--force', threadId], {
      timeout: 120_000,
      env: {
        ...(runtimeConfig.getEnv?.() || defaultEnv()),
        CODEX_HOME: codexHome,
        NO_COLOR: '1'
      }
    })
  } catch (error) {
    if (codexThreadDeletionAlreadyAbsent(error)) return false
    try {
      if (await codexThreadPersistenceState(codexHome, threadId) === 'absent') return false
    } catch {
      // Preserve the original Codex deletion error when persistence cannot be inspected.
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw Object.assign(new Error(`Codex thread deletion failed: ${reason}`), {
      code: 'CODEX_THREAD_DELETE_FAILED',
      cause: error
    })
  }
  return true
}

const createLifecycleEvent = (
  id: string,
  event: Omit<CodexSessionLifecycleEvent, 'id' | 'at'> & { at?: number }
): CodexSessionLifecycleEvent => ({
  id,
  stage: event.stage,
  at: Number.isFinite(event.at) ? Number(event.at) : Date.now(),
  ...(event.binaryPath ? { binaryPath: event.binaryPath } : {}),
  ...(event.codexHome ? { codexHome: event.codexHome } : {}),
  ...(event.cwd ? { cwd: event.cwd } : {}),
  ...(event.runtimeKind ? { runtimeKind: event.runtimeKind } : {}),
  ...(event.code === null || Number.isFinite(event.code) ? { code: event.code === null ? null : Number(event.code) } : {}),
  ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
  ...(event.message ? { message: event.message } : {})
})

const errorMessage = (error: unknown) => (error instanceof Error && error.message.trim() ? error.message : String(error || 'Codex session failed.'))
const errorCode = (error: unknown) => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  return String(record.code || record.errno || 'CODEX_SESSION_ERROR').toUpperCase()
}

const resolveCodexProviderConfig = () => resolveAiopstermCodexProviderConfig(runtimeConfig.getConfig?.())

const readExistingCodexConfig = async (configPath: string) => {
  try {
    return String(await getReadFile()(configPath, 'utf-8'))
  } catch (error) {
    const code = typeof error === 'object' && error ? String((error as { code?: unknown }).code || '') : ''
    if (code === 'ENOENT') return ''
    throw error
  }
}

const writeCodexConfig = async (codexHome: string, options: CodexSessionCreateOptions, provider = resolveCodexProviderConfig()) => {
  const appPath = runtimeConfig.getAppPath?.() || defaultAppPath()
  const resourcesPath = runtimeConfig.getResourcesPath?.() || defaultResourcesPath()
  const configPath = join(codexHome, 'config.toml')
  const existing = await readExistingCodexConfig(configPath)
  const config = mergeAiopstermCodexConfigToml(existing, {
    bridgeScriptPath: codexBridgeScriptPath(appPath, resourcesPath),
    bridgeSocketPath: runtimeConfig.getBridgeSocketPath?.() || '',
    target: options.target,
    provider
  })
  await getWriteFile()(configPath, config, 'utf-8')
}

export const refreshCodexConfig = async (options: CodexSessionCreateOptions = {}) => {
  const codexHome = codexHomePath()
  await getMkdir()(codexHome, { recursive: true })
  await writeCodexConfig(codexHome, options)
  return { codexHome, configPath: join(codexHome, 'config.toml') }
}

export const createCodexSession = async (
  id: string,
  options: CodexSessionCreateOptions,
  sink: CodexEventSink
): Promise<CodexSessionInfo> => {
  const binaryPath = resolveCodexBinaryPath()
  await checkCodexBinary(binaryPath)
  const codexPackageRoot = codexPackageRootForBinary(binaryPath)
  const codexHome = codexHomePath()
  const pendingContextPath = codexPendingContextPath(codexHome, id)
  const threadInfoPath = codexThreadInfoPath(codexHome, id)
  const launchArgs = codexLaunchArgs(options)
  const cwd = codexWorkspaceDirectory(codexHome, options)
  const cols = Math.max(20, Math.min(400, Math.round(Number(options.cols) || 100)))
  const rows = Math.max(8, Math.min(120, Math.round(Number(options.rows) || 30)))
  const codexProvider = resolveCodexProviderConfig()
  const env = codexTerminalEnv({
    ...defaultEnv(),
    ...(runtimeConfig.getEnv?.() || {}),
    ...(codexProvider?.env || {}),
    AIOPSTERM_CODEX_FLAT_MCP_TOOLS: '1',
    AIOPSTERM_CODEX_RUNTIME_ID: id,
    AIOPSTERM_CODEX_PENDING_CONTEXT_FILE: pendingContextPath,
    AIOPSTERM_CODEX_THREAD_INFO_FILE: threadInfoPath,
    AIOPSTERM_CODEX_THREAD_REASON: options.launch?.mode || 'new',
    ...(codexPackageRoot ? { CODEX_MANAGED_PACKAGE_ROOT: codexPackageRoot } : {}),
    CODEX_HOME: codexHome
  })

  await getMkdir()(codexHome, { recursive: true })
  await getMkdir()(cwd, { recursive: true })
  await getMkdir()(dirname(pendingContextPath), { recursive: true })
  await getMkdir()(dirname(threadInfoPath), { recursive: true })
  await getWriteFile()(pendingContextPath, '', 'utf-8')
  await rm(threadInfoPath, { force: true })
  await writeCodexConfig(codexHome, options, codexProvider)

  const starting = createLifecycleEvent(id, {
    stage: 'starting',
    binaryPath,
    codexHome,
    cwd,
    message: 'Starting Codex CLI'
  })
  sink.lifecycle(starting)

  const finish = (record: CodexSessionRecord, code: number | null, message: string) => {
    if (record.closed) return
    record.closed = true
    stopThreadInfoPolling(record)
    sessions.delete(id)
    sink.closed?.(id)
    const nonzeroExit = typeof code === 'number' && code !== 0
    const exitErrorMessage = nonzeroExit ? `Codex CLI exited with code ${code}.` : ''
    const lifecycle = createLifecycleEvent(id, {
      stage: nonzeroExit ? 'error' : 'closed',
      binaryPath: record.binaryPath,
      codexHome: record.codexHome,
      cwd: record.cwd,
      runtimeKind: record.runtimeKind,
      code,
      ...(nonzeroExit ? { errorCode: 'CODEX_CLI_EXIT_NONZERO', errorMessage: exitErrorMessage } : {}),
      message: nonzeroExit ? exitErrorMessage : message
    })
    sink.lifecycle(lifecycle)
    sink.exit(lifecycle, code)
  }

  const fail = (record: CodexSessionRecord | null, error: unknown, message = 'Codex CLI failed to start.') => {
    if (record?.closed) return
    if (record) {
      record.closed = true
      stopThreadInfoPolling(record)
      sessions.delete(id)
      sink.closed?.(id)
    }
    const lifecycle = createLifecycleEvent(id, {
      stage: 'error',
      binaryPath,
      codexHome,
      cwd,
      runtimeKind: record?.runtimeKind,
      code: 1,
      errorCode: errorCode(error),
      errorMessage: errorMessage(error),
      message
    })
    sink.lifecycle(lifecycle)
    sink.exit(lifecycle, 1)
  }

  const ptyRuntime = getPtyRuntime()
  if (ptyRuntime) {
    const ptyProcess = ptyRuntime.spawn(binaryPath, launchArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
      ...(getPlatform() === 'win32' ? { useConpty: false } : {})
    })
    const record: CodexSessionRecord = {
      id,
      productSessionId: String(options.productSessionId || '').trim(),
      process: ptyProcess,
      binaryPath,
      cwd,
      codexHome,
      pendingContextPath,
      threadInfoPath,
      threadInfoTimer: null,
      threadInfoPollInFlight: false,
      threadInfoPollPromise: null,
      lastThreadInfoReadAt: 0,
      launchThreadId: options.launch?.mode === 'resume' || options.launch?.mode === 'fork'
        ? String(options.launch.threadId || '').trim()
        : '',
      lastThreadCandidateId: '',
      lastThreadId: '',
      lastThreadTitle: '',
      lastThreadRolloutPath: '',
      lastThreadRolloutCheckAt: 0,
      lastThreadTitleCheckAt: 0,
      runtimeKind: 'pty',
      closed: false
    }
    sessions.set(id, record)
    startThreadInfoPolling(record, sink)
    ptyProcess.onData((data) => sink.data(id, data))
    ptyProcess.onExit((event) => finish(record, event.exitCode, 'Codex CLI exited.'))
    const ready = createLifecycleEvent(id, {
      stage: 'ready',
      binaryPath,
      codexHome,
      cwd,
      runtimeKind: 'pty',
      message: 'Codex CLI ready'
    })
    sink.lifecycle(ready)
    return { id, binaryPath, cwd, codexHome, runtimeKind: 'pty', lifecycle: ready }
  }

  try {
    const child = getProcessRuntime().spawn(binaryPath, launchArgs, {
      cwd,
      env,
      shell: false
    }) as ChildProcessWithoutNullStreams
    const session: CodexProcessSession = {
      write(data: string | Buffer) {
        child.stdin.write(data)
      },
      resize() {
        /* Subprocess fallback has no PTY window to resize. */
      },
      kill() {
        child.kill()
      }
    }
    const record: CodexSessionRecord = {
      id,
      productSessionId: String(options.productSessionId || '').trim(),
      process: session,
      binaryPath,
      cwd,
      codexHome,
      pendingContextPath,
      threadInfoPath,
      threadInfoTimer: null,
      threadInfoPollInFlight: false,
      threadInfoPollPromise: null,
      lastThreadInfoReadAt: 0,
      launchThreadId: options.launch?.mode === 'resume' || options.launch?.mode === 'fork'
        ? String(options.launch.threadId || '').trim()
        : '',
      lastThreadCandidateId: '',
      lastThreadId: '',
      lastThreadTitle: '',
      lastThreadRolloutPath: '',
      lastThreadRolloutCheckAt: 0,
      lastThreadTitleCheckAt: 0,
      runtimeKind: 'process',
      closed: false
    }
    sessions.set(id, record)
    startThreadInfoPolling(record, sink)
    child.stdout.on('data', (chunk: Buffer) => sink.data(id, chunk))
    child.stderr.on('data', (chunk: Buffer) => sink.data(id, chunk))
    child.on('exit', (code) => finish(record, code, 'Codex CLI exited.'))
    child.on('error', (error) => fail(record, error, 'Codex CLI failed.'))
    const ready = createLifecycleEvent(id, {
      stage: 'ready',
      binaryPath,
      codexHome,
      cwd,
      runtimeKind: 'process',
      message: 'Codex CLI ready'
    })
    sink.lifecycle(ready)
    return { id, binaryPath, cwd, codexHome, runtimeKind: 'process', lifecycle: ready }
  } catch (error) {
    fail(null, error)
    throw error
  }
}

export const setCodexSessionPendingContext = async (id: string, text?: string): Promise<CodexSessionPendingContextResult> => {
  const session = sessions.get(id)
  if (!session) {
    return {
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    }
  }
  const value = String(text || '')
  await getMkdir()(dirname(session.pendingContextPath), { recursive: true })
  await getWriteFile()(session.pendingContextPath, value, 'utf-8')
  return {
    ok: true,
    data: {
      id,
      bytes: Buffer.byteLength(value, 'utf8'),
      cleared: value.trim().length === 0
    }
  }
}

export const writeCodexSession = (id: string, data: string): CodexSessionWriteResult => {
  const session = sessions.get(id)
  const bytes = Buffer.byteLength(String(data || ''), 'utf8')
  if (!session) {
    return {
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    }
  }
  session.process.write(data)
  return { ok: true, data: { id, bytes } }
}

export const resizeCodexSession = (id: string, cols: number, rows: number) => {
  const session = sessions.get(id)
  if (!session) return false
  session.process.resize(Math.max(20, Math.round(cols)), Math.max(8, Math.round(rows)))
  return true
}

export const killCodexSession = (id: string): CodexSessionKillResult => {
  const session = sessions.get(id)
  if (!session) {
    return {
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    }
  }
  stopThreadInfoPolling(session)
  session.process.kill()
  return { ok: true, data: { id } }
}

export const stopCodexProductSessionRuntimes = async (productSessionIdInput: string) => {
  const productSessionId = String(productSessionIdInput || '').trim()
  if (!productSessionId) return false
  let stopped = false
  const pendingPolls: Promise<void>[] = []
  for (const record of [...sessions.values()]) {
    if (record.productSessionId !== productSessionId) continue
    stopThreadInfoPolling(record)
    if (record.threadInfoPollPromise) pendingPolls.push(record.threadInfoPollPromise)
    record.process.kill()
    stopped = true
  }
  await Promise.all(pendingPolls)
  return stopped
}

export const __getCodexSessionCountForTests = () => sessions.size
