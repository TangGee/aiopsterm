import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { promisify } from 'util'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionLifecycleEvent,
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
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): CodexPtyProcess
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
}

type CodexEventSink = {
  lifecycle: (event: CodexSessionLifecycleEvent) => void
  exit: (event: CodexSessionLifecycleEvent, code?: number | null) => void
  data: (id: string, chunk: string | Buffer) => void
  closed?: (id: string) => void
}

type CodexSessionRecord = {
  id: string
  process: CodexPtyProcess | CodexProcessSession
  binaryPath: string
  cwd: string
  codexHome: string
  pendingContextPath: string
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
  runtimeConfig.getUserDataPath = config.getUserDataPath
  runtimeConfig.getAppPath = config.getAppPath
  runtimeConfig.getResourcesPath = config.getResourcesPath
  runtimeConfig.getConfig = config.getConfig
  runtimeConfig.getEnv = config.getEnv
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
  sessions.clear()
  codexBinaryHealthChecks.clear()
}

const codexHomePath = () => {
  const userDataPath = runtimeConfig.getUserDataPath?.()
  if (!userDataPath) throw Object.assign(new Error('Codex userData path is unavailable.'), { code: 'CODEX_USER_DATA_UNAVAILABLE' })
  return join(userDataPath, 'codex-agent')
}

const codexPendingContextPath = (codexHome: string, id: string) => join(codexHome, 'aiopsterm-pending-context', `${id}.txt`)

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
  const cwd = codexHome
  const cols = Math.max(20, Math.min(400, Math.round(Number(options.cols) || 100)))
  const rows = Math.max(8, Math.min(120, Math.round(Number(options.rows) || 30)))
  const codexProvider = resolveCodexProviderConfig()
  const env = codexTerminalEnv({
    ...defaultEnv(),
    ...(runtimeConfig.getEnv?.() || {}),
    ...(codexProvider?.env || {}),
    AIOPSTERM_CODEX_FLAT_MCP_TOOLS: '1',
    AIOPSTERM_CODEX_PENDING_CONTEXT_FILE: pendingContextPath,
    ...(codexPackageRoot ? { CODEX_MANAGED_PACKAGE_ROOT: codexPackageRoot } : {}),
    CODEX_HOME: codexHome
  })

  await getMkdir()(codexHome, { recursive: true })
  await getMkdir()(dirname(pendingContextPath), { recursive: true })
  await getWriteFile()(pendingContextPath, '', 'utf-8')
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
    sessions.delete(id)
    sink.closed?.(id)
    const lifecycle = createLifecycleEvent(id, {
      stage: 'closed',
      binaryPath: record.binaryPath,
      codexHome: record.codexHome,
      cwd: record.cwd,
      runtimeKind: record.runtimeKind,
      code,
      message
    })
    sink.lifecycle(lifecycle)
    sink.exit(lifecycle, code)
  }

  const fail = (record: CodexSessionRecord | null, error: unknown, message = 'Codex CLI failed to start.') => {
    if (record?.closed) return
    if (record) {
      record.closed = true
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
    const ptyProcess = ptyRuntime.spawn(binaryPath, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env
    })
    const record: CodexSessionRecord = {
      id,
      process: ptyProcess,
      binaryPath,
      cwd,
      codexHome,
      pendingContextPath,
      runtimeKind: 'pty',
      closed: false
    }
    sessions.set(id, record)
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
    const child = getProcessRuntime().spawn(binaryPath, [], {
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
      process: session,
      binaryPath,
      cwd,
      codexHome,
      pendingContextPath,
      runtimeKind: 'process',
      closed: false
    }
    sessions.set(id, record)
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
  session.process.kill()
  return { ok: true, data: { id } }
}

export const __getCodexSessionCountForTests = () => sessions.size
