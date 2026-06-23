import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionsClient } from '@/services/extensions/extensionsClient'
import type {
  ExtensionInstallProgress,
  ExtensionPackageDownloadResult,
  ExtensionPluginCancelResult,
  ExtensionPluginOperation,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig
} from '@shared/contracts/extensions'

const originalAiops = window.aiops

const plugin: ExtensionPluginRuntimeConfig = {
  pluginId: 'ops-runbook',
  name: 'Ops Runbook',
  description: 'Runbook helpers',
  iconKey: 'runbook',
  tabName: 'Runbooks',
  show: true,
  isPlugin: true,
  installed: false,
  hasUpdate: false,
  installable: true,
  source: 'store',
  packageUrl: 'https://example.invalid/ops-runbook.external-reference'
}

const operationResult = (operation: ExtensionPluginOperation, nextPlugin: ExtensionPluginRuntimeConfig = plugin): ExtensionPluginOperationResult => ({
  ok: true,
  data: {
    operation,
    plugin: {
      ...nextPlugin,
      installed: operation === 'uninstall' ? false : true,
      hasUpdate: false
    },
    message: `${operation} complete`
  }
})

afterEach(() => {
  window.aiops = originalAiops
})

describe('extensionsClient', () => {
  it('returns undefined for unavailable bridge methods and binds Extensions bridge methods', async () => {
    const unsubscribe = vi.fn()
    window.aiops = {
      ...originalAiops,
      listExtensionPlugins: vi.fn(async () => ({ ok: true, data: [plugin] })),
      installExtensionPlugin: vi.fn(async () => operationResult('install')),
      updateExtensionPlugin: vi.fn(async () => operationResult('update', { ...plugin, installed: true, hasUpdate: true })),
      installExtensionPackage: vi.fn(async (input) =>
        operationResult('package', { ...plugin, pluginId: input.requestId || 'local-package', name: input.fileName, source: 'local' })
      ),
      downloadExtensionPackage: vi.fn(
        async (input): Promise<ExtensionPackageDownloadResult> => ({
          ok: true,
          data: {
            url: input.url,
            bytes: 3,
            data: [1, 2, 3]
          }
        })
      ),
      installExtensionPluginFromUrl: vi.fn(async (input) => operationResult('install', { ...plugin, pluginId: input.pluginId, packageUrl: input.url })),
      uninstallExtensionPlugin: vi.fn(async () => operationResult('uninstall', { ...plugin, installed: true })),
      openExtensionSubscription: vi.fn(async (input) => ({
        ok: true,
        data: {
          pluginId: input.plugin.pluginId,
          url: input.plugin.subscriptionUrl || 'https://example.invalid/subscribe',
          message: 'subscription opened'
        }
      })),
      cancelExtensionInstall: vi.fn(
        async (pluginId): Promise<ExtensionPluginCancelResult> => ({ ok: true, data: { pluginId, stage: 'cancelled', percent: 0, message: 'cancelled' } })
      ),
      onExtensionInstallProgress: vi.fn((listener: (event: ExtensionInstallProgress) => void) => {
        listener({ pluginId: plugin.pluginId, stage: 'installing', percent: 50, operation: 'install' })
        return unsubscribe
      })
    }

    await expect(extensionsClient.listExtensionPlugins()?.()).resolves.toEqual({ ok: true, data: [plugin] })
    await expect(extensionsClient.installExtensionPlugin()?.({ plugin })).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ operation: 'install' }) }))
    await expect(extensionsClient.updateExtensionPlugin()?.({ plugin: { ...plugin, installed: true, hasUpdate: true } })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ operation: 'update' }) })
    )
    await expect(
      extensionsClient.installExtensionPackage()?.({ fileName: 'ops-runbook.external-reference', filePath: '/tmp/ops-runbook.external-reference', requestId: 'request-1' })
    ).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ operation: 'package' }) }))
    await expect(extensionsClient.downloadExtensionPackage()?.({ pluginId: plugin.pluginId, url: 'https://example.invalid/ops-runbook.external-reference' })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ bytes: 3, data: [1, 2, 3] }) })
    )
    await expect(
      extensionsClient.installExtensionPluginFromUrl()?.({ pluginId: plugin.pluginId, url: 'https://example.invalid/ops-runbook.external-reference' })
    ).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ operation: 'install' }) }))
    await expect(extensionsClient.uninstallExtensionPlugin()?.({ plugin: { ...plugin, installed: true } })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ operation: 'uninstall' }) })
    )
    await expect(extensionsClient.openExtensionSubscription()?.({ plugin })).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ pluginId: plugin.pluginId, message: 'subscription opened' }) })
    )
    await expect(extensionsClient.cancelExtensionInstall()?.(plugin.pluginId)).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ pluginId: plugin.pluginId, stage: 'cancelled' }) })
    )

    const listener = vi.fn()
    expect(extensionsClient.onExtensionInstallProgress()?.(listener)).toBe(unsubscribe)
    expect(listener).toHaveBeenCalledWith({ pluginId: plugin.pluginId, stage: 'installing', percent: 50, operation: 'install' })
    expect(window.aiops.installExtensionPlugin).toHaveBeenCalledWith({ plugin })
    expect(window.aiops.updateExtensionPlugin).toHaveBeenCalledWith({ plugin: { ...plugin, installed: true, hasUpdate: true } })
    expect(window.aiops.installExtensionPackage).toHaveBeenCalledWith({ fileName: 'ops-runbook.external-reference', filePath: '/tmp/ops-runbook.external-reference', requestId: 'request-1' })
    expect(window.aiops.downloadExtensionPackage).toHaveBeenCalledWith({ pluginId: plugin.pluginId, url: 'https://example.invalid/ops-runbook.external-reference' })
    expect(window.aiops.installExtensionPluginFromUrl).toHaveBeenCalledWith({ pluginId: plugin.pluginId, url: 'https://example.invalid/ops-runbook.external-reference' })
    expect(window.aiops.uninstallExtensionPlugin).toHaveBeenCalledWith({ plugin: { ...plugin, installed: true } })
    expect(window.aiops.openExtensionSubscription).toHaveBeenCalledWith({ plugin })
    expect(window.aiops.cancelExtensionInstall).toHaveBeenCalledWith(plugin.pluginId)
    expect(window.aiops.onExtensionInstallProgress).toHaveBeenCalledWith(listener)

    window.aiops = {
      ...originalAiops,
      listExtensionPlugins: undefined as any,
      installExtensionPlugin: undefined as any,
      updateExtensionPlugin: undefined as any,
      installExtensionPackage: undefined as any,
      downloadExtensionPackage: undefined as any,
      installExtensionPluginFromUrl: undefined as any,
      uninstallExtensionPlugin: undefined as any,
      openExtensionSubscription: undefined as any,
      cancelExtensionInstall: undefined as any,
      onExtensionInstallProgress: undefined as any
    }
    expect(extensionsClient.listExtensionPlugins()).toBeUndefined()
    expect(extensionsClient.installExtensionPlugin()).toBeUndefined()
    expect(extensionsClient.updateExtensionPlugin()).toBeUndefined()
    expect(extensionsClient.installExtensionPackage()).toBeUndefined()
    expect(extensionsClient.downloadExtensionPackage()).toBeUndefined()
    expect(extensionsClient.installExtensionPluginFromUrl()).toBeUndefined()
    expect(extensionsClient.uninstallExtensionPlugin()).toBeUndefined()
    expect(extensionsClient.openExtensionSubscription()).toBeUndefined()
    expect(extensionsClient.cancelExtensionInstall()).toBeUndefined()
    expect(extensionsClient.onExtensionInstallProgress()).toBeUndefined()
  })
})
