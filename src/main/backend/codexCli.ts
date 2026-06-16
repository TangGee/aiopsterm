import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionLifecycleEvent,
  CodexSessionWriteResult,
  CodexSessionKillResult
} from '@shared/preload'
import { buildAiopstermCodexConfigToml, codexBridgeScriptPath } from './codexConfig'

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

type CodexRuntimeConfig = {
  getUserDataPath?: () => string
  getAppPath?: () => string
  getResourcesPath?: () => string
  getEnv?: () => NodeJS.ProcessEnv
  loadPty?: () => CodexPtyRuntime | null
  processRuntime?: CodexProcessRuntime
  mkdir?: typeof mkdir
  writeFile?: typeof writeFile
  existsSync?: typeof existsSync
  binaryPath?: string
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
const getWriteFile = () => runtimeConfig.writeFile || writeFile
const getPtyRuntime = () => (runtimeConfig.loadPty || defaultLoadPty)()
const getProcessRuntime = () => runtimeConfig.processRuntime || { spawn }

export const configureCodexCliRuntime = (config: CodexRuntimeConfig = {}) => {
  runtimeConfig.getUserDataPath = config.getUserDataPath
  runtimeConfig.getAppPath = config.getAppPath
  runtimeConfig.getResourcesPath = config.getResourcesPath
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.loadPty = config.loadPty
  runtimeConfig.processRuntime = config.processRuntime
  runtimeConfig.mkdir = config.mkdir
  runtimeConfig.writeFile = config.writeFile
  runtimeConfig.existsSync = config.existsSync
  runtimeConfig.binaryPath = config.binaryPath
  runtimeConfig.getBridgeSocketPath = config.getBridgeSocketPath
  sessions.clear()
}

const codexHomePath = () => {
  const userDataPath = runtimeConfig.getUserDataPath?.()
  if (!userDataPath) throw Object.assign(new Error('Codex userData path is unavailable.'), { code: 'CODEX_USER_DATA_UNAVAILABLE' })
  return join(userDataPath, 'codex-agent')
}

const candidateCodexBinaryPaths = () => {
  const configured = runtimeConfig.binaryPath || process.env.AIOPSTERM_CODEX_BIN
  const appPath = runtimeConfig.getAppPath?.() || defaultAppPath()
  const resourcesPath = runtimeConfig.getResourcesPath?.() || defaultResourcesPath()
  return [
    configured,
    join(appPath, 'codex', 'codex-rs', 'target', 'release', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    join(appPath, 'codex', 'codex-rs', 'target', 'debug', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    join(resourcesPath, 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    join(resourcesPath, 'app.asar.unpacked', 'codex', process.platform === 'win32' ? 'codex.exe' : 'codex')
  ]
    .filter((path): path is string => Boolean(path && String(path).trim()))
    .map((path) => resolve(path))
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

const writeCodexConfig = async (codexHome: string, options: CodexSessionCreateOptions) => {
  const appPath = runtimeConfig.getAppPath?.() || defaultAppPath()
  const resourcesPath = runtimeConfig.getResourcesPath?.() || defaultResourcesPath()
  const config = buildAiopstermCodexConfigToml({
    bridgeScriptPath: codexBridgeScriptPath(appPath, resourcesPath),
    bridgeSocketPath: runtimeConfig.getBridgeSocketPath?.() || '',
    target: options.target
  })
  await getWriteFile()(join(codexHome, 'config.toml'), `${config}\n`, 'utf-8')
}

export const createCodexSession = async (
  id: string,
  options: CodexSessionCreateOptions,
  sink: CodexEventSink
): Promise<CodexSessionInfo> => {
  const binaryPath = resolveCodexBinaryPath()
  const codexHome = codexHomePath()
  const cwd = codexHome
  const cols = Math.max(20, Math.min(400, Math.round(Number(options.cols) || 100)))
  const rows = Math.max(8, Math.min(120, Math.round(Number(options.rows) || 30)))
  const env = {
    ...defaultEnv(),
    ...(runtimeConfig.getEnv?.() || {}),
    CODEX_HOME: codexHome,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  }

  await getMkdir()(codexHome, { recursive: true })
  await writeCodexConfig(codexHome, options)

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
