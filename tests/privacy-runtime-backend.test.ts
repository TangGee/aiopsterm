import { beforeEach, describe, expect, it } from 'vitest'

type PrivacyRuntimeBackend = {
  configurePrivacyRuntime: (config?: { dataSyncBackendUrl?: string; useDataSyncBackendDouble?: boolean }) => void
  resetPrivacyRuntimeForTests: () => void
  getPrivacyRuntimeSnapshot: () => any
  applyPrivacyRuntimeSettings: (input: any) => any
}

let backend: PrivacyRuntimeBackend

beforeEach(async () => {
  const modulePath = '../src/main/backend/privacyRuntime'
  backend = (await import(modulePath)) as PrivacyRuntimeBackend
  backend.configurePrivacyRuntime({ useDataSyncBackendDouble: false, dataSyncBackendUrl: '' })
  backend.resetPrivacyRuntimeForTests()
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
    backend.configurePrivacyRuntime({ useDataSyncBackendDouble: true })
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
      dataSyncRuntime: 'disabled'
    })
  })

  it('fails closed when data sync enable is requested without a configured backend service', () => {
    const result = backend.applyPrivacyRuntimeSettings({
      previousPrivacy,
      nextPrivacy: {
        ...previousPrivacy,
        telemetry: 'disabled',
        dataSync: 'enabled'
      }
    })

    expect(result).toEqual({
      ok: false,
      errorCode: 'DATA_SYNC_UNAVAILABLE',
      errorMessage: '数据同步服务未配置，无法启用'
    })
    expect(backend.getPrivacyRuntimeSnapshot()).toMatchObject({
      telemetry: 'enabled',
      dataSync: 'disabled',
      dataSyncRuntime: 'disabled'
    })
  })

  it('allows data sync enable through a backend-owned test double', () => {
    backend.configurePrivacyRuntime({ useDataSyncBackendDouble: true })

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
      dataSyncRuntime: 'backend-double'
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
