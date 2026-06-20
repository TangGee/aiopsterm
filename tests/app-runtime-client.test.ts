import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appRuntimeClient,
  hasAvailableAppUpdate,
  isAppUpdateCheckResult,
  isAppUpdateDownloadData,
  isAppUpdateInstallData,
  isAppUpdateProgressEvent,
  isOpenPathResult,
  isSettingsDocumentationResult,
  resolveUpdateVersion
} from '@/services/appRuntimeClient'
import type { UserConfig } from '@shared/contracts/userConfig'

const originalAiops = window.aiops

const configFixture: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.18,
    brightness: 1
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('appRuntimeClient', () => {
  it('returns undefined for unavailable bridge methods and binds available methods', async () => {
    window.aiops = {
      ...originalAiops,
      getConfig: vi.fn(async () => ({ ...configFixture })),
      saveConfig: vi.fn(async (patch) => ({ ...configFixture, ...patch })),
      applyPrivacyRuntimeSettings: vi.fn(async (input) => ({
        ok: true as const,
        data: {
          telemetry: input.nextPrivacy.telemetry,
          dataSync: input.nextPrivacy.dataSync,
          dataSyncRuntime: input.nextPrivacy.dataSync === 'enabled' ? ('local-file' as const) : ('disabled' as const),
          syncStatus: input.nextPrivacy.dataSync === 'enabled' ? ('synced' as const) : ('disabled' as const),
          appliedAt: '2026-06-20T00:00:00.000Z',
          message: 'privacy applied'
        }
      })),
      applyKnowledgeSearchRuntimeSetting: vi.fn(async (input) => ({
        ok: true as const,
        data: {
          enabled: input.nextEnabled,
          appliedAt: '2026-06-20T00:00:00.000Z',
          source: 'settings' as const,
          message: 'knowledge search applied'
        }
      })),
      checkUpdate: vi.fn(async () => ({ available: false, channel: 'local' as const })),
      openSettingsDocumentation: vi.fn(async () => ({ path: '/tmp/docs/index.md', title: 'Docs', content: '# Docs' })),
      openLogDir: undefined as any
    }

    expect(appRuntimeClient.openLogDir()).toBeUndefined()
    await expect(appRuntimeClient.getConfig()?.()).resolves.toEqual(expect.objectContaining({ theme: 'dark' }))
    await expect(appRuntimeClient.saveConfig()?.({ theme: 'light' })).resolves.toEqual(expect.objectContaining({ theme: 'light' }))
    await expect(
      appRuntimeClient.applyPrivacyRuntimeSettings()?.({
        previousPrivacy: { telemetry: 'enabled', secretRedaction: 'enabled', dataSync: 'disabled' },
        nextPrivacy: { telemetry: 'disabled', secretRedaction: 'enabled', dataSync: 'enabled' }
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true, data: expect.objectContaining({ telemetry: 'disabled', dataSync: 'enabled' }) }))
    await expect(appRuntimeClient.applyKnowledgeSearchRuntimeSetting()?.({ previousEnabled: false, nextEnabled: true })).resolves.toEqual(
      expect.objectContaining({ ok: true, data: expect.objectContaining({ enabled: true }) })
    )
    await expect(appRuntimeClient.checkUpdate()?.()).resolves.toEqual({ available: false, channel: 'local' })
    await expect(appRuntimeClient.openSettingsDocumentation()?.({ page: 'general', locale: 'zh-CN' })).resolves.toEqual({
      path: '/tmp/docs/index.md',
      title: 'Docs',
      content: '# Docs'
    })
    expect(window.aiops.getConfig).toHaveBeenCalledTimes(1)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith({ theme: 'light' })
    expect(window.aiops.applyPrivacyRuntimeSettings).toHaveBeenCalledWith({
      previousPrivacy: { telemetry: 'enabled', secretRedaction: 'enabled', dataSync: 'disabled' },
      nextPrivacy: { telemetry: 'disabled', secretRedaction: 'enabled', dataSync: 'enabled' }
    })
    expect(window.aiops.applyKnowledgeSearchRuntimeSetting).toHaveBeenCalledWith({ previousEnabled: false, nextEnabled: true })
    expect(window.aiops.checkUpdate).toHaveBeenCalledTimes(1)
    expect(window.aiops.openSettingsDocumentation).toHaveBeenCalledWith({ page: 'general', locale: 'zh-CN' })

    window.aiops = {
      ...originalAiops,
      getConfig: undefined as any,
      saveConfig: undefined as any,
      applyPrivacyRuntimeSettings: undefined as any,
      applyKnowledgeSearchRuntimeSetting: undefined as any
    }
    expect(appRuntimeClient.getConfig()).toBeUndefined()
    expect(appRuntimeClient.saveConfig()).toBeUndefined()
    expect(appRuntimeClient.applyPrivacyRuntimeSettings()).toBeUndefined()
    expect(appRuntimeClient.applyKnowledgeSearchRuntimeSetting()).toBeUndefined()
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
    expect(isSettingsDocumentationResult({ path: '/tmp/docs/index.md', title: 'Docs', content: '# Docs' })).toBe(true)
    expect(isSettingsDocumentationResult({ path: '/tmp/docs/index.md', title: '   ', content: '# Docs' })).toBe(false)
    expect(isSettingsDocumentationResult({ path: '/tmp/docs/index.md', title: 'Docs' })).toBe(false)
  })
})
