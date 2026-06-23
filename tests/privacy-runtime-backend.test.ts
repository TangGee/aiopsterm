import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

type PrivacyRuntimeBackend = {
  configurePrivacyRuntime: (config?: { dataSyncBackendUrl?: string; dataSyncStateFilePath?: string; useDataSyncBackendDouble?: boolean }) => void
  resetPrivacyRuntimeForTests: () => void
  getPrivacyRuntimeSnapshot: () => any
  applyPrivacyRuntimeSettings: (input: any) => any
}

let backend: PrivacyRuntimeBackend
let stateFilePath = ''

beforeEach(async () => {
  const modulePath = '../src/main/backend/app/privacyRuntime'
  backend = (await import(modulePath)) as PrivacyRuntimeBackend
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-privacy-runtime-'))
  stateFilePath = join(dir, 'data-sync-runtime.json')
  backend.configurePrivacyRuntime({ useDataSyncBackendDouble: false, dataSyncBackendUrl: '', dataSyncStateFilePath: stateFilePath })
  backend.resetPrivacyRuntimeForTests()
})

afterEach(async () => {
  if (stateFilePath) await rm(dirname(stateFilePath), { recursive: true, force: true })
})

const previousPrivacy = {
  telemetry: 'enabled',
  secretRedaction: 'disabled',
  dataSync: 'disabled'
}

describe('privacy runtime backend boundary', () => {
  it('applies telemetry changes in the main-process runtime snapshot', () => {
    const result = backend.applyPrivacyRuntimeSettings({
      previousPrivacy,
      nextPrivacy: {
        ...previousPrivacy,
        telemetry: 'disabled'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      telemetry: 'disabled',
      dataSync: 'disabled',
      dataSyncRuntime: 'disabled'
    })
    expect(backend.getPrivacyRuntimeSnapshot()).toMatchObject({
      telemetry: 'disabled',
      dataSync: 'disabled'
    })
  })

  it('disables data sync without requiring a remote service', () => {
    const enabled = backend.applyPrivacyRuntimeSettings({
      previousPrivacy,
      nextPrivacy: {
        ...previousPrivacy,
        dataSync: 'enabled'
      }
    })
    expect(enabled.ok).toBe(true)

    const disabled = backend.applyPrivacyRuntimeSettings({
      previousPrivacy: {
        ...previousPrivacy,
        dataSync: 'enabled'
      },
      nextPrivacy: previousPrivacy
    })

    expect(disabled.ok).toBe(true)
    expect(disabled.data).toMatchObject({
      dataSync: 'disabled',
      dataSyncRuntime: 'disabled',
      syncStatus: 'disabled',
      syncRunId: '',
      syncedScopes: [],
      lastSyncAt: enabled.data.lastSyncAt
    })
  })

  it('enables data sync through a backend-owned local runtime state file', async () => {
    const result = backend.applyPrivacyRuntimeSettings({
      previousPrivacy,
      nextPrivacy: {
        ...previousPrivacy,
        telemetry: 'disabled',
        dataSync: 'enabled'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      telemetry: 'disabled',
      dataSync: 'enabled',
      dataSyncRuntime: 'local-file',
      syncStatus: 'synced',
      syncRunId: expect.stringMatching(/^sync-/),
      syncedScopes: ['config'],
      stateFilePath,
      lastSyncAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      message: '隐私运行时设置已应用，数据同步已启用'
    })
    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as Record<string, unknown>
    expect(persisted).toMatchObject({
      version: 1,
      enabled: true,
      runtime: 'local-file',
      syncStatus: 'synced',
      syncRunId: result.data.syncRunId,
      syncedScopes: ['config'],
      telemetry: 'disabled',
      dataSync: 'enabled'
    })

    backend.configurePrivacyRuntime({ useDataSyncBackendDouble: false, dataSyncBackendUrl: '', dataSyncStateFilePath: stateFilePath })
    expect(backend.getPrivacyRuntimeSnapshot()).toMatchObject({
      telemetry: 'disabled',
      dataSync: 'enabled',
      dataSyncRuntime: 'local-file',
      syncStatus: 'synced',
      syncRunId: result.data.syncRunId,
      syncedScopes: ['config'],
      stateFilePath
    })
  })

  it('allows data sync enable through a backend-owned test double', () => {
    backend.configurePrivacyRuntime({ useDataSyncBackendDouble: true, dataSyncStateFilePath: stateFilePath })

    const result = backend.applyPrivacyRuntimeSettings({
      previousPrivacy,
      nextPrivacy: {
        ...previousPrivacy,
        dataSync: 'enabled'
      }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      telemetry: 'enabled',
      dataSync: 'enabled',
      dataSyncRuntime: 'backend-double',
      syncStatus: 'synced',
      syncedScopes: ['config']
    })
  })

  it('rejects malformed privacy input', () => {
    expect(backend.applyPrivacyRuntimeSettings({ previousPrivacy, nextPrivacy: { dataSync: 'enabled' } })).toEqual({
      ok: false,
      errorCode: 'PRIVACY_RUNTIME_PRIVACY_INVALID',
      errorMessage: 'Privacy runtime settings are invalid.'
    })
  })
})
