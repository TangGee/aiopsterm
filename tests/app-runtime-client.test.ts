import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appRuntimeClient,
  hasAvailableAppUpdate,
  isAppUpdateCheckResult,
  isAppUpdateDownloadData,
  isAppUpdateInstallData,
  isAppUpdateProgressEvent,
  isOpenPathResult,
  resolveUpdateVersion
} from '@/services/appRuntimeClient'

const originalAiops = window.aiops

afterEach(() => {
  window.aiops = originalAiops
})

describe('appRuntimeClient', () => {
  it('returns undefined for unavailable bridge methods and binds available methods', async () => {
    window.aiops = {
      ...originalAiops,
      checkUpdate: vi.fn(async () => ({ available: false, channel: 'local' as const })),
      openLogDir: undefined as any
    }

    expect(appRuntimeClient.openLogDir()).toBeUndefined()
    await expect(appRuntimeClient.checkUpdate()?.()).resolves.toEqual({ available: false, channel: 'local' })
    expect(window.aiops.checkUpdate).toHaveBeenCalledTimes(1)
  })

  it('validates app update and open path bridge payloads', () => {
    const checkResult = {
      available: true,
      channel: 'manual',
      isUpdateAvailable: true,
      updateInfo: {
        version: '0.2.0',
        channel: 'manual',
        fileName: 'aiopsterm-0.2.0.AppImage',
        size: 2048,
        sha256: 'abc',
        notes: 'release notes',
        signature: { algorithm: 'ed25519', verified: true, keyId: 'test' }
      }
    } as const
    expect(isAppUpdateCheckResult(checkResult)).toBe(true)
    expect(hasAvailableAppUpdate(checkResult)).toBe(true)
    expect(resolveUpdateVersion(checkResult)).toBe('0.2.0')
    expect(isAppUpdateCheckResult({ ...checkResult, updateInfo: { version: '' } })).toBe(false)

    expect(
      isAppUpdateDownloadData(
        {
          version: '0.2.0',
          status: 'downloaded',
          percent: 100,
          filePath: '/tmp/aiopsterm-0.2.0.AppImage',
          size: 2048,
          sha256: 'abc',
          signature: { algorithm: 'rsa-sha256', verified: true },
          message: 'downloaded'
        },
        '0.2.0'
      )
    ).toBe(true)
    expect(isAppUpdateDownloadData({ version: '0.2.0', status: 'downloaded', percent: 80 }, '0.2.0')).toBe(false)

    expect(
      isAppUpdateInstallData(
        {
          version: '0.2.0',
          status: 'install-requested',
          filePath: '/tmp/aiopsterm-0.2.0.AppImage',
          size: 2048,
          handoff: { kind: 'os-open', accepted: true },
          requestedAt: '2026-06-20T12:00:00.000Z',
          message: 'install requested'
        },
        '0.2.0'
      )
    ).toBe(true)
    expect(isAppUpdateInstallData({ version: '0.2.0', status: 'install-requested', handoff: { kind: 'os-open' } }, '0.2.0')).toBe(false)

    expect(isAppUpdateProgressEvent({ status: 'downloading', version: '0.2.0', percent: 50 })).toBe(true)
    expect(isAppUpdateProgressEvent({ status: 'downloading', version: '', percent: 50 })).toBe(false)
    expect(isOpenPathResult({ path: '/tmp/aiopsterm/logs' })).toBe(true)
    expect(isOpenPathResult({ path: '   ' })).toBe(false)
  })
})
