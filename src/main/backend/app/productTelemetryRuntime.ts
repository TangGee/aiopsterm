import { randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { PrivacyUserConfig } from '@shared/contracts/appRuntime'

export type ProductTelemetryPayload = {
  schemaVersion: 1
  anonymousInstallId: string
  appVersion: string
  platform: string
  arch: string
  locale: string
  releaseChannel: 'stable' | 'preview'
  sentAt: string
}

type TelemetryWorkerRequest = {
  action: 'active' | 'revoke'
  endpoint: string
  body: Record<string, unknown>
  timeoutMs: number
}

type TelemetryWorkerResult = {
  ok: boolean
  code: string
}

export type TelemetryWorkerHandle = {
  postMessage: (message: TelemetryWorkerRequest) => void
  onMessage: (listener: (message: TelemetryWorkerResult) => void) => void
  onExit: (listener: () => void) => void
  kill: () => void
}

type TelemetryState = {
  version: 1
  anonymousInstallId: string
  lastActiveAttemptDay: string
  pendingRevoke: boolean
  lastRevokeAttemptDay: string
}

type ProductTelemetryRuntimeOptions = {
  stateFilePath: string
  endpoint: string
  appVersion: string
  platform: string
  arch: string
  locale: () => string
  releaseChannel: 'stable' | 'preview'
  enabled: boolean
  getPrivacy: () => PrivacyUserConfig
  savePrivacy: (privacy: PrivacyUserConfig) => void
  requestConsent: () => Promise<'enabled' | 'disabled' | null>
  spawnWorker: () => TelemetryWorkerHandle
  logFailure?: (code: string) => void
  initialDelayMs?: number
  jitterMs?: number
  requestTimeoutMs?: number
  workerTimeoutMs?: number
  now?: () => Date
  createId?: () => string
}

const emptyState = (): TelemetryState => ({
  version: 1,
  anonymousInstallId: '',
  lastActiveAttemptDay: '',
  pendingRevoke: false,
  lastRevokeAttemptDay: ''
})

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeState = (value: unknown): TelemetryState => {
  if (!isRecord(value)) return emptyState()
  return {
    version: 1,
    anonymousInstallId: typeof value.anonymousInstallId === 'string' ? value.anonymousInstallId.slice(0, 128) : '',
    lastActiveAttemptDay: typeof value.lastActiveAttemptDay === 'string' ? value.lastActiveAttemptDay.slice(0, 10) : '',
    pendingRevoke: value.pendingRevoke === true,
    lastRevokeAttemptDay: typeof value.lastRevokeAttemptDay === 'string' ? value.lastRevokeAttemptDay.slice(0, 10) : ''
  }
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10)

export const createProductTelemetryRuntime = (options: ProductTelemetryRuntimeOptions) => {
  const initialDelayMs = Math.max(60_000, options.initialDelayMs ?? 60_000)
  const jitterMs = Math.max(0, options.jitterMs ?? 30_000)
  const requestTimeoutMs = Math.max(250, options.requestTimeoutMs ?? 2_000)
  const workerTimeoutMs = Math.max(requestTimeoutMs + 250, options.workerTimeoutMs ?? 3_000)
  const now = options.now || (() => new Date())
  const createId = options.createId || randomUUID
  let timer: NodeJS.Timeout | null = null
  let activeWorker: TelemetryWorkerHandle | null = null
  let stopped = false
  let operationRunning = false

  const reportFailure = (code: string) => {
    try {
      options.logFailure?.(code.slice(0, 80))
    } catch {
      return
    }
  }

  const readState = async () => {
    try {
      return normalizeState(JSON.parse(await readFile(options.stateFilePath, 'utf-8')) as unknown)
    } catch {
      return emptyState()
    }
  }

  const writeState = async (state: TelemetryState) => {
    await mkdir(dirname(options.stateFilePath), { recursive: true })
    const tempPath = `${options.stateFilePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, JSON.stringify(state), { encoding: 'utf-8', mode: 0o600 })
    await rename(tempPath, options.stateFilePath)
  }

  const runWorker = (request: TelemetryWorkerRequest) =>
    new Promise<TelemetryWorkerResult>((resolve) => {
      if (stopped || activeWorker) {
        resolve({ ok: false, code: 'worker-unavailable' })
        return
      }
      let settled = false
      const worker = options.spawnWorker()
      activeWorker = worker
      const finish = (result: TelemetryWorkerResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (activeWorker === worker) activeWorker = null
        try {
          worker.kill()
        } catch {
          return resolve(result)
        }
        resolve(result)
      }
      const timeout = setTimeout(() => finish({ ok: false, code: 'worker-timeout' }), workerTimeoutMs)
      timeout.unref?.()
      worker.onMessage((message) => finish(message && typeof message.code === 'string' ? message : { ok: false, code: 'worker-invalid-response' }))
      worker.onExit(() => finish({ ok: false, code: 'worker-exit' }))
      try {
        worker.postMessage(request)
      } catch {
        finish({ ok: false, code: 'worker-post-failed' })
      }
    })

  const runRevoke = async (state: TelemetryState, day: string) => {
    if (!state.pendingRevoke || !state.anonymousInstallId || state.lastRevokeAttemptDay === day) return
    state.lastRevokeAttemptDay = day
    await writeState(state)
    const result = await runWorker({
      action: 'revoke',
      endpoint: options.endpoint.replace(/\/active$/, '/revoke'),
      body: { schemaVersion: 1, anonymousInstallId: state.anonymousInstallId },
      timeoutMs: requestTimeoutMs
    })
    if (!result.ok) {
      reportFailure(result.code)
      return
    }
    await writeState(emptyState())
  }

  const runActive = async (state: TelemetryState, day: string) => {
    if (state.lastActiveAttemptDay === day) return
    if (!state.anonymousInstallId) state.anonymousInstallId = createId()
    state.pendingRevoke = false
    state.lastActiveAttemptDay = day
    await writeState(state)
    const payload: ProductTelemetryPayload = {
      schemaVersion: 1,
      anonymousInstallId: state.anonymousInstallId,
      appVersion: options.appVersion.slice(0, 64),
      platform: options.platform.slice(0, 32),
      arch: options.arch.slice(0, 32),
      locale: options.locale().slice(0, 32),
      releaseChannel: options.releaseChannel,
      sentAt: now().toISOString()
    }
    const result = await runWorker({ action: 'active', endpoint: options.endpoint, body: payload, timeoutMs: requestTimeoutMs })
    if (!result.ok) reportFailure(result.code)
  }

  const tick = async () => {
    if (stopped || operationRunning || !options.enabled) return
    operationRunning = true
    try {
      let privacy = options.getPrivacy()
      if (privacy.telemetry === 'undecided' || privacy.telemetryConsentVersion !== 1) {
        const decision = await options.requestConsent()
        if (!decision || stopped) return
        privacy = { ...privacy, telemetry: decision, telemetryConsentVersion: 1 }
        options.savePrivacy(privacy)
      }
      const state = await readState()
      const day = utcDay(now())
      if (privacy.telemetry === 'disabled') {
        if (state.anonymousInstallId && !state.pendingRevoke) {
          state.pendingRevoke = true
          state.lastRevokeAttemptDay = ''
          await writeState(state)
        }
        await runRevoke(state, day)
        return
      }
      if (privacy.telemetry === 'enabled') await runActive(state, day)
    } catch {
      reportFailure('runtime-failed')
    } finally {
      operationRunning = false
    }
  }

  const schedule = (delayMs: number) => {
    if (stopped || !options.enabled) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, Math.max(0, delayMs))
    timer.unref?.()
  }

  return {
    start: () => schedule(initialDelayMs + Math.floor(Math.random() * (jitterMs + 1))),
    syncPrivacy: () => schedule(0),
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      try {
        activeWorker?.kill()
      } catch {
        return
      } finally {
        activeWorker = null
      }
    },
    runNowForTests: tick
  }
}
