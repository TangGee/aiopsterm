import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import {
  CLINE_AGENT_PROTOCOL_VERSION,
  CLINE_AGENT_SDK_VERSION,
  type ClineAgentSidecarCallback,
  type ClineAgentSidecarCallbackResult,
  type ClineAgentSidecarEvent,
  type ClineAgentSidecarMessage,
  type ClineAgentSidecarReady,
  type ClineAgentSidecarRequest,
  type ClineAgentSidecarRequestMethod,
  type ClineAgentSidecarResponse
} from '@shared/contracts/clineAgent'

const MAX_PROTOCOL_FRAME_BYTES = 4 * 1024 * 1024
const MAX_PENDING_REQUESTS = 128
const MAX_STDERR_TAIL_CHARS = 8 * 1024
const START_TIMEOUT_MS = 20_000
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const TURN_REQUEST_TIMEOUT_MS = 30 * 60_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const TERMINATE_TIMEOUT_MS = 2_000

type SidecarLaunch = {
  command: string
  args: string[]
  runtimePath?: string
  bundlePath?: string
  source: 'override' | 'packaged' | 'build' | 'bun-source'
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type ClineAgentSidecarSupervisorOptions = {
  appPath: string
  resourcesPath: string
  userDataPath: string
  isPackaged: boolean
  env?: NodeJS.ProcessEnv
  spawnProcess?: typeof spawn
  onEvent?: (event: ClineAgentSidecarEvent) => void
  onCallback: (callback: ClineAgentSidecarCallback) => Promise<unknown> | unknown
  onExit?: (input: { code: number | null; signal: NodeJS.Signals | null; errorMessage: string }) => void
  log?: (level: 'debug' | 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void
}

const sidecarRuntimeName = () => process.platform === 'win32' ? 'node.exe' : 'node'
const sidecarBundleName = 'cline-agent-sidecar.cjs'

const packagedSidecarLaunch = (directory: string, source: SidecarLaunch['source']): SidecarLaunch | null => {
  const runtimePath = join(directory, sidecarRuntimeName())
  const bundlePath = join(directory, sidecarBundleName)
  if (!existsSync(runtimePath) || !existsSync(bundlePath)) return null
  return { command: runtimePath, args: [bundlePath], runtimePath, bundlePath, source }
}

export const resolveClineAgentSidecarLaunch = (input: {
  appPath: string
  resourcesPath: string
  isPackaged: boolean
  env?: NodeJS.ProcessEnv
}): SidecarLaunch => {
  const env = input.env || process.env
  const override = String(env.AIOPSTERM_CLINE_SIDECAR_BIN || '').trim()
  const overrideBundle = String(env.AIOPSTERM_CLINE_SIDECAR_BUNDLE || '').trim()
  if (override) {
    if (overrideBundle && !existsSync(overrideBundle)) throw new Error(`Cline Agent sidecar override bundle is missing: ${overrideBundle}`)
    return {
      command: override,
      args: overrideBundle ? [overrideBundle] : [],
      runtimePath: override,
      ...(overrideBundle ? { bundlePath: overrideBundle } : {}),
      source: 'override'
    }
  }
  const packagedDirectories = [
    join(input.resourcesPath, 'cline-sidecar'),
    join(input.resourcesPath, 'resources', 'cline-sidecar')
  ]
  const packaged = packagedDirectories.map((directory) => packagedSidecarLaunch(directory, 'packaged')).find(Boolean)
  if (packaged) return packaged
  if (input.isPackaged) {
    throw new Error(`Packaged Cline Agent sidecar is missing: ${packagedDirectories[0]}`)
  }
  const built = packagedSidecarLaunch(join(input.appPath, 'build', 'cline-sidecar'), 'build')
  const useBuilt = String(env.AIOPSTERM_CLINE_USE_BUILT_SIDECAR || '').trim() === '1'
  if (useBuilt && built) return built
  const bun = process.platform === 'win32'
    ? join(input.appPath, 'node_modules', '.bin', 'bun.cmd')
    : join(input.appPath, 'node_modules', '.bin', 'bun')
  const entry = join(input.appPath, 'src', 'sidecar', 'clineAgentSidecar.ts')
  if (existsSync(bun) && existsSync(entry)) return { command: bun, args: ['run', entry], source: 'bun-source' }
  if (built) return built
  throw new Error('Cline Agent sidecar development runtime is unavailable.')
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isResponse = (message: ClineAgentSidecarMessage): message is ClineAgentSidecarResponse => message.kind === 'response'

const isEvent = (message: ClineAgentSidecarMessage): message is ClineAgentSidecarEvent => message.kind === 'event'

const isCallback = (message: ClineAgentSidecarMessage): message is ClineAgentSidecarCallback => message.kind === 'callback'

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'Unknown Cline sidecar error'))

const requestTimeoutFor = (method: ClineAgentSidecarRequestMethod) => {
  if (method === 'session.send') return TURN_REQUEST_TIMEOUT_MS
  if (method === 'runtime.shutdown') return SHUTDOWN_TIMEOUT_MS
  return DEFAULT_REQUEST_TIMEOUT_MS
}

export class ClineAgentSidecarSupervisor {
  private process: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<ClineAgentSidecarReady> | null = null
  private ready: ClineAgentSidecarReady | null = null
  private inputBuffer = ''
  private stderrTail = ''
  private stopping = false
  private pending = new Map<string, PendingRequest>()

  constructor(private readonly options: ClineAgentSidecarSupervisorOptions) {}

  private log(level: 'debug' | 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
    this.options.log?.(level, event, data)
  }

  private write(message: ClineAgentSidecarRequest | ClineAgentSidecarCallbackResult) {
    if (!this.process || this.process.killed || !this.process.stdin.writable) {
      throw new Error('Cline Agent sidecar is not running.')
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private rejectPending(error: Error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  private handleResponse(message: ClineAgentSidecarResponse) {
    const request = this.pending.get(message.id)
    if (!request) return
    this.pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.ok) request.resolve(message.result)
    else request.reject(new Error(message.error?.message || 'Cline Agent sidecar request failed.'))
  }

  private handleEvent(message: ClineAgentSidecarEvent) {
    if (message.event === 'runtime.ready') {
      const payload = (isRecord(message.payload) ? message.payload : {}) as Record<string, unknown>
      if (
        payload.protocolVersion !== CLINE_AGENT_PROTOCOL_VERSION ||
        payload.sdkVersion !== CLINE_AGENT_SDK_VERSION ||
        typeof payload.pid !== 'number'
      ) {
        throw new Error(`Cline Agent sidecar version mismatch: ${JSON.stringify(payload)}`)
      }
      this.ready = payload as ClineAgentSidecarReady
    }
    this.options.onEvent?.(message)
  }

  private handleCallback(message: ClineAgentSidecarCallback) {
    void Promise.resolve()
      .then(() => this.options.onCallback(message))
      .then((result) => {
        this.write({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback-result',
          id: message.id,
          ok: true,
          result
        })
      })
      .catch((error) => {
        try {
          this.write({
            version: CLINE_AGENT_PROTOCOL_VERSION,
            kind: 'callback-result',
            id: message.id,
            ok: false,
            error: { code: 'CLINE_AGENT_CALLBACK_FAILED', message: errorMessage(error) }
          })
        } catch (writeError) {
          this.log('error', 'cline-agent.sidecar.callback-write-failed', { errorMessage: errorMessage(writeError) })
        }
      })
  }

  private handleProtocolMessage(message: ClineAgentSidecarMessage) {
    if (!message || message.version !== CLINE_AGENT_PROTOCOL_VERSION) {
      throw new Error('Cline Agent sidecar sent an unsupported protocol frame.')
    }
    if (isResponse(message)) return this.handleResponse(message)
    if (isEvent(message)) return this.handleEvent(message)
    if (isCallback(message)) return this.handleCallback(message)
  }

  private handleStdout(chunk: Buffer | string) {
    this.inputBuffer += chunk.toString()
    if (Buffer.byteLength(this.inputBuffer, 'utf8') > MAX_PROTOCOL_FRAME_BYTES) {
      throw new Error('Cline Agent sidecar protocol frame exceeded the size limit.')
    }
    for (;;) {
      const newlineIndex = this.inputBuffer.indexOf('\n')
      if (newlineIndex < 0) return
      const line = this.inputBuffer.slice(0, newlineIndex).trim()
      this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1)
      if (!line) continue
      let message: ClineAgentSidecarMessage
      try {
        message = JSON.parse(line) as ClineAgentSidecarMessage
      } catch {
        throw new Error('Cline Agent sidecar sent invalid JSON.')
      }
      this.handleProtocolMessage(message)
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null) {
    const wasStopping = this.stopping
    const error = new Error(
      wasStopping
        ? 'Cline Agent sidecar stopped.'
        : `Cline Agent sidecar exited unexpectedly${code === null ? '' : ` with code ${code}`}.`
    )
    this.process = null
    this.ready = null
    this.starting = null
    this.inputBuffer = ''
    this.rejectPending(error)
    this.log(wasStopping ? 'info' : 'error', 'cline-agent.sidecar.exit', {
      code,
      signal,
      errorMessage: error.message,
      stderrTail: this.stderrTail
    })
    this.options.onExit?.({ code, signal, errorMessage: error.message })
  }

  async ensureStarted(): Promise<ClineAgentSidecarReady> {
    if (this.ready && this.process && !this.process.killed) return this.ready
    if (this.starting) return this.starting
    this.stopping = false
    this.starting = new Promise<ClineAgentSidecarReady>((resolve, reject) => {
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        callback()
      }
      let launch: SidecarLaunch
      try {
        launch = resolveClineAgentSidecarLaunch(this.options)
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(errorMessage(error))))
        return
      }
      const spawnProcess = this.options.spawnProcess || spawn
      const dataDir = join(this.options.userDataPath, 'cline-agent')
      const child = spawnProcess(launch.command, launch.args, {
        cwd: this.options.appPath,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...(this.options.env || process.env),
          CLINE_DATA_DIR: dataDir,
          CLINE_SESSION_DATA_DIR: join(dataDir, 'sessions'),
          AIOPSTERM_CLINE_WORKSPACE_ROOT: this.options.userDataPath,
          NO_COLOR: '1'
        }
      }) as ChildProcessWithoutNullStreams
      this.process = child
      this.stderrTail = ''
      this.log('info', 'cline-agent.sidecar.start', { source: launch.source, pid: child.pid })
      child.stdout.on('data', (chunk) => {
        try {
          this.handleStdout(chunk)
          if (this.ready) finish(() => resolve(this.ready as ClineAgentSidecarReady))
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(errorMessage(error))))
          child.kill()
        }
      })
      child.stderr.on('data', (chunk) => {
        this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-MAX_STDERR_TAIL_CHARS)
      })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('exit', (code, signal) => {
        if (!settled) finish(() => reject(new Error(`Cline Agent sidecar exited before ready: ${this.stderrTail}`)))
        this.handleExit(code, signal)
      })
      timer = setTimeout(() => {
        finish(() => reject(new Error('Cline Agent sidecar startup timed out.')))
        child.kill()
      }, START_TIMEOUT_MS)
      timer.unref?.()
    }).finally(() => {
      if (!this.ready) this.starting = null
    })
    return this.starting
  }

  async request<T = unknown>(method: ClineAgentSidecarRequestMethod, payload?: unknown): Promise<T> {
    await this.ensureStarted()
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new Error('Cline Agent sidecar has too many pending requests.')
    }
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = requestTimeoutFor(method)
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Cline Agent sidecar request timed out: ${method}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.write({ version: CLINE_AGENT_PROTOCOL_VERSION, kind: 'request', id, method, payload })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(errorMessage(error)))
      }
    })
  }

  async shutdown() {
    if (!this.process) return
    this.stopping = true
    const child = this.process
    try {
      await this.request('runtime.shutdown')
    } catch (error) {
      this.log('warn', 'cline-agent.sidecar.graceful-shutdown-failed', { errorMessage: errorMessage(error) })
    }
    if (child.exitCode !== null || child.killed) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        const forceTimer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          resolve()
        }, TERMINATE_TIMEOUT_MS)
        forceTimer.unref?.()
      }, SHUTDOWN_TIMEOUT_MS)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
