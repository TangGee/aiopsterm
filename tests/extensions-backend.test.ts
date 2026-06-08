import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

type ExtensionPlugin = {
  pluginId: string
  name: string
  description: string
  iconKey: 'jumpserver' | 'alias' | 'runbook' | 'cloud' | 'private' | 'local'
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  source?: 'preinstalled' | 'store' | 'local'
  isPrivate?: boolean
  detailSummary?: string
  guideSteps?: string[]
  connectionLog?: Array<{ time: string; status: 'progress' | 'success' | 'error'; message: string }>
}

type ExtensionProgress = {
  pluginId: string
  stage: string
  percent: number
  operation: string
}

let installExtensionPlugin: (input: { plugin: ExtensionPlugin }, emit?: (progress: ExtensionProgress) => void, options?: { stepDelayMs?: number }) => Promise<any>
let updateExtensionPlugin: (input: { plugin: ExtensionPlugin }, emit?: (progress: ExtensionProgress) => void, options?: { stepDelayMs?: number }) => Promise<any>
let installExtensionPackage: (
  input: { fileName: string; existingPluginIds?: string[]; size?: number },
  emit?: (progress: ExtensionProgress) => void,
  options?: { stepDelayMs?: number }
) => Promise<any>
let listExtensionPlugins: () => Promise<any>
let resetExtensionPluginCatalogForTests: () => void
let cancelExtensionInstall: (pluginId: string) => any
let openExtensionSubscription: (input: { plugin: ExtensionPlugin }, openExternal?: (url: string) => Promise<void> | void) => Promise<any>
let EXTENSION_SUBSCRIPTION_URL: string

const basePlugin = (patch: Partial<ExtensionPlugin> = {}): ExtensionPlugin => ({
  pluginId: 'cloud-assets',
  name: 'Cloud Assets',
  description: 'Cloud asset sync plugin.',
  iconKey: 'cloud',
  tabName: 'Cloud Assets',
  show: true,
  isPlugin: true,
  installed: false,
  hasUpdate: false,
  installedVersion: '',
  latestVersion: '0.9.1',
  installable: true,
  source: 'store',
  ...patch
})

beforeAll(async () => {
  const modulePath = '../src/main/backend/extensions'
  const backend = await import(modulePath)
  installExtensionPlugin = backend.installExtensionPlugin as typeof installExtensionPlugin
  updateExtensionPlugin = backend.updateExtensionPlugin as typeof updateExtensionPlugin
  installExtensionPackage = backend.installExtensionPackage as typeof installExtensionPackage
  listExtensionPlugins = backend.listExtensionPlugins as typeof listExtensionPlugins
  resetExtensionPluginCatalogForTests = backend.resetExtensionPluginCatalogForTests as typeof resetExtensionPluginCatalogForTests
  cancelExtensionInstall = backend.cancelExtensionInstall as typeof cancelExtensionInstall
  openExtensionSubscription = backend.openExtensionSubscription as typeof openExtensionSubscription
  EXTENSION_SUBSCRIPTION_URL = backend.EXTENSION_SUBSCRIPTION_URL as string
})

describe('extension plugin backend boundary', () => {
  beforeEach(() => {
    resetExtensionPluginCatalogForTests()
  })

  it('lists the backend-owned extension catalog', async () => {
    const result = await listExtensionPlugins()

    expect(result.ok).toBe(true)
    expect(result.data.map((plugin: ExtensionPlugin) => plugin.pluginId)).toEqual(
      expect.arrayContaining(['jumpserverSupport', 'Alias', 'cloud-assets', 'ops-runbook'])
    )
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'Alias')).toMatchObject({
      source: 'preinstalled',
      isPlugin: false
    })
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'jumpserverSupport')).toMatchObject({
      detailSummary: expect.stringContaining('资产同步'),
      guideSteps: expect.arrayContaining(['同步资产并确认主机分组。']),
      connectionLog: expect.arrayContaining([
        expect.objectContaining({ time: '10:15:50', status: 'success', message: 'connected to bastion host' })
      ])
    })
  })

  it('installs a store plugin with backend-owned progress events', async () => {
    const progress: ExtensionProgress[] = []
    const result = await installExtensionPlugin({ plugin: basePlugin() }, (event) => progress.push(event), { stepDelayMs: 0 })

    expect(result.ok).toBe(true)
    expect(result.data.plugin).toMatchObject({
      pluginId: 'cloud-assets',
      installed: true,
      hasUpdate: false,
      installedVersion: '0.9.1'
    })
    expect(progress.map((event) => event.stage)).toEqual(['downloading', 'downloading', 'downloading', 'verifying', 'installing', 'done'])
    expect(progress.every((event) => event.operation === 'install')).toBe(true)

    const catalog = await listExtensionPlugins()
    expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'cloud-assets')).toMatchObject({
      installed: true,
      installedVersion: '0.9.1'
    })
  })

  it('updates an installed plugin to the backend-returned latest version', async () => {
    const progress: ExtensionProgress[] = []
    const result = await updateExtensionPlugin(
      {
        plugin: basePlugin({
          pluginId: 'ops-runbook',
          name: 'Ops Runbook',
          iconKey: 'runbook',
          installed: true,
          hasUpdate: true,
          installedVersion: '1.2.0',
          latestVersion: '1.3.0'
        })
      },
      (event) => progress.push(event),
      { stepDelayMs: 0 }
    )

    expect(result.ok).toBe(true)
    expect(result.data.plugin).toMatchObject({
      pluginId: 'ops-runbook',
      installedVersion: '1.3.0',
      hasUpdate: false
    })
    expect(progress.at(-1)).toMatchObject({ operation: 'update', stage: 'done', percent: 100 })
  })

  it('rejects invalid local package formats before adding plugin metadata', async () => {
    const result = await installExtensionPackage({ fileName: 'plugin.zip' }, undefined, { stepDelayMs: 0 })

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PACKAGE_FORMAT_INVALID',
      errorMessage: 'Plugin package must use the .external-reference extension.'
    })
  })

  it('derives local package plugin metadata behind the backend boundary', async () => {
    const progress: ExtensionProgress[] = []
    const result = await installExtensionPackage(
      {
        fileName: 'local-tools.external-reference',
        existingPluginIds: ['local-local-tools'],
        size: 4096
      },
      (event) => progress.push(event),
      { stepDelayMs: 0 }
    )

    expect(result.ok).toBe(true)
    expect(result.data.plugin).toMatchObject({
      pluginId: 'local-local-tools-1',
      name: 'local tools',
      source: 'local',
      installed: true,
      installedVersion: '1.0.0',
      size: 4096
    })
    expect(progress.map((event) => event.stage)).toEqual(['installing', 'done'])

    const catalog = await listExtensionPlugins()
    expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'local-local-tools-1')).toMatchObject({
      name: 'local tools',
      source: 'local',
      installed: true
    })
  })

  it('marks an active operation as cancelled', async () => {
    const progress: ExtensionProgress[] = []
    const pending = installExtensionPlugin({ plugin: basePlugin({ pluginId: 'cancel-me' }) }, (event) => progress.push(event), { stepDelayMs: 30 })

    await new Promise((resolve) => setTimeout(resolve, 5))
    const cancelResult = cancelExtensionInstall('cancel-me')
    const result = await pending

    expect(cancelResult.ok).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('EXTENSION_PLUGIN_OPERATION_CANCELLED')
    expect(progress.at(-1)).toMatchObject({ pluginId: 'cancel-me', stage: 'cancelled', percent: 0 })
  })

  it('opens the private plugin subscription entry behind the backend boundary', async () => {
    const openedUrls: string[] = []
    const result = await openExtensionSubscription(
      {
        plugin: basePlugin({
          pluginId: 'private-automation-pack',
          name: 'Private Automation Pack',
          iconKey: 'private',
          installable: false,
          isPrivate: true
        })
      },
      (url) => {
        openedUrls.push(url)
      }
    )

    expect(result.ok).toBe(true)
    expect(openedUrls).toEqual([EXTENSION_SUBSCRIPTION_URL])
    expect(result.data).toMatchObject({
      pluginId: 'private-automation-pack',
      url: EXTENSION_SUBSCRIPTION_URL
    })
  })

  it('rejects subscription entry requests for plugins that do not require subscription', async () => {
    const result = await openExtensionSubscription({ plugin: basePlugin() }, () => undefined)

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE',
      errorMessage: 'Plugin does not require a subscription.'
    })
  })

  it('rejects subscription entry requests for installed plugins', async () => {
    const result = await openExtensionSubscription(
      {
        plugin: basePlugin({
          installed: true,
          installable: false,
          isPrivate: true
        })
      },
      () => undefined
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_ALREADY_INSTALLED',
      errorMessage: 'Installed plugins do not need a subscription entry.'
    })
  })
})
