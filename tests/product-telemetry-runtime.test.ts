import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type PrivacyUserConfig = {
  telemetry: 'undecided' | 'enabled' | 'disabled'
  telemetryConsentVersion?: 0 | 1
  secretRedaction: 'enabled' | 'disabled'
  dataSync: 'enabled' | 'disabled'
}

type TelemetryWorkerHandle = {
  postMessage: (message: unknown) => void
  onMessage: (listener: (message: { ok: boolean; code: string }) => void) => void
  onExit: (listener: () => void) => void
  kill: () => void
}

type ProductTelemetryRuntimeFactory = (options: Record<string, unknown>) => {
  runNowForTests: () => Promise<void>
}

let createProductTelemetryRuntime: ProductTelemetryRuntimeFactory

const tempDirectories: string[] = []

beforeEach(async () => {
  const modulePath = '../src/main/backend/app/productTelemetryRuntime'
  const backend = await import(modulePath) as { createProductTelemetryRuntime: ProductTelemetryRuntimeFactory }
  createProductTelemetryRuntime = backend.createProductTelemetryRuntime
})

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const createHarness = async (input: {
  privacy?: PrivacyUserConfig
  consent?: 'enabled' | 'disabled' | null
  workerResult?: { ok: boolean; code: string } | null
  spawnThrows?: boolean
} = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'aiopsterm-product-telemetry-'))
  tempDirectories.push(directory)
  const stateFilePath = join(directory, 'state.json')
  let privacy: PrivacyUserConfig = input.privacy || {
    telemetry: 'undecided',
    telemetryConsentVersion: 0,
    secretRedaction: 'disabled',
    dataSync: 'disabled'
  }
  const requests: Array<Record<string, unknown>> = []
  const failures: string[] = []
  const spawnWorker = () => {
    if (input.spawnThrows) throw new Error('spawn failed')
    let messageListener: (message: { ok: boolean; code: string }) => void = () => undefined
    const handle: TelemetryWorkerHandle = {
      postMessage: (message: unknown) => {
        requests.push(message as unknown as Record<string, unknown>)
        if (input.workerResult !== null) queueMicrotask(() => messageListener(input.workerResult || { ok: true, code: 'ok' }))
      },
      onMessage: (listener) => {
        messageListener = listener
      },
      onExit: () => undefined,
      kill: () => undefined
    }
    return handle
  }
  const runtime = createProductTelemetryRuntime({
    stateFilePath,
    endpoint: 'https://api.aiopsterm.com/v1/telemetry/active',
    appVersion: '0.1.0',
    platform: 'linux',
    arch: 'x64',
    locale: () => 'en-US',
    releaseChannel: 'stable',
    enabled: true,
    getPrivacy: () => privacy,
    savePrivacy: (next: PrivacyUserConfig) => {
      privacy = next
    },
    requestConsent: async () => input.consent ?? null,
    spawnWorker,
    logFailure: (code: string) => failures.push(code),
    requestTimeoutMs: 250,
    workerTimeoutMs: 500,
    now: () => new Date('2026-08-10T12:00:00.000Z'),
    createId: () => 'install-test-id'
  })
  return { runtime, requests, failures, stateFilePath, privacy: () => privacy }
}

describe('product telemetry runtime', () => {
  it('sends nothing until the user makes a choice', async () => {
    const harness = await createHarness()
    await expect(harness.runtime.runNowForTests()).resolves.toBeUndefined()
    expect(harness.requests).toEqual([])
    expect(harness.privacy().telemetry).toBe('undecided')
  })

  it('persists explicit refusal without creating an installation id', async () => {
    const harness = await createHarness({ consent: 'disabled' })
    await expect(harness.runtime.runNowForTests()).resolves.toBeUndefined()
    expect(harness.privacy()).toMatchObject({ telemetry: 'disabled', telemetryConsentVersion: 1 })
    expect(harness.requests).toEqual([])
  })

  it('attempts one active heartbeat per UTC day', async () => {
    const harness = await createHarness({ consent: 'enabled' })
    await harness.runtime.runNowForTests()
    await harness.runtime.runNowForTests()
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]).toMatchObject({
      action: 'active',
      body: expect.objectContaining({
        anonymousInstallId: 'install-test-id',
        appVersion: '0.1.0',
        platform: 'linux'
      })
    })
    const state = JSON.parse(await readFile(harness.stateFilePath, 'utf-8')) as Record<string, unknown>
    expect(state.lastActiveAttemptDay).toBe('2026-08-10')
  })

  it('contains worker spawn failures and resolves normally', async () => {
    const harness = await createHarness({
      privacy: {
        telemetry: 'enabled',
        telemetryConsentVersion: 1,
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      spawnThrows: true
    })
    await expect(harness.runtime.runNowForTests()).resolves.toBeUndefined()
    expect(harness.failures).toContain('runtime-failed')
  })

  it('terminates a hanging worker without rejecting the caller', async () => {
    const harness = await createHarness({
      privacy: {
        telemetry: 'enabled',
        telemetryConsentVersion: 1,
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      workerResult: null
    })
    await expect(harness.runtime.runNowForTests()).resolves.toBeUndefined()
    expect(harness.failures).toContain('worker-timeout')
  })

  it('revokes an existing installation after telemetry is disabled', async () => {
    const harness = await createHarness({ consent: 'enabled' })
    await harness.runtime.runNowForTests()
    harness.privacy().telemetry = 'disabled'
    await harness.runtime.runNowForTests()
    expect(harness.requests.map((request) => request.action)).toEqual(['active', 'revoke'])
    const state = JSON.parse(await readFile(harness.stateFilePath, 'utf-8')) as Record<string, unknown>
    expect(state.anonymousInstallId).toBe('')
    expect(state.pendingRevoke).toBe(false)
  })
})
