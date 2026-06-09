import { access, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync } from 'zlib'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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
  installedAt?: string
  packagePath?: string
  readme?: string
  size?: number
  categories?: string[]
  functions?: Array<{ title: string; desc: string }>
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
  input: { fileName: string; filePath?: string; existingPluginIds?: string[]; size?: number },
  emit?: (progress: ExtensionProgress) => void,
  options?: { stepDelayMs?: number }
) => Promise<any>
let uninstallExtensionPlugin: (input: { plugin: ExtensionPlugin }) => Promise<any>
let listExtensionPlugins: () => Promise<any>
let resetExtensionPluginCatalogForTests: () => void
let configureExtensionBackendRuntime: (config?: { extensionRootDir?: string }) => void
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

const crcTable = new Uint32Array(256).map((_, value) => {
  let crc = value
  for (let index = 0; index < 8; index++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const createZipFixture = (entries: Array<{ name: string; content: string }>) => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const compressedContent = deflateRawSync(content)
    const checksum = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressedContent.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, compressedContent)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressedContent.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + compressedContent.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const endHeader = Buffer.alloc(22)
  endHeader.writeUInt32LE(0x06054b50, 0)
  endHeader.writeUInt16LE(0, 4)
  endHeader.writeUInt16LE(0, 6)
  endHeader.writeUInt16LE(entries.length, 8)
  endHeader.writeUInt16LE(entries.length, 10)
  endHeader.writeUInt32LE(centralSize, 12)
  endHeader.writeUInt32LE(centralOffset, 16)
  endHeader.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, endHeader])
}

const createLocalPackage = async (
  patch: Record<string, unknown> = {},
  options: { includeManifest?: boolean; includeMain?: boolean; readme?: string } = {}
) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-'))
  const filePath = join(dir, `${String(patch.id || 'local-tools')}.external-reference`)
  const manifest = {
    id: 'local-tools',
    displayName: 'Local Tools',
    version: '2.4.0',
    description: 'Local package tools from manifest.',
    main: 'main.js',
    categories: ['Local', 'Tools'],
    functions: [{ title: 'Path check', desc: 'Inspect local path state.' }],
    contributes: { views: [{ id: 'localTools', name: 'Local Tools' }] },
    ...patch
  }
  const entries: Array<{ name: string; content: string }> = []
  if (options.includeManifest !== false) entries.push({ name: 'plugin.json', content: JSON.stringify(manifest) })
  if (options.includeMain !== false) entries.push({ name: String(manifest.main || 'main.js'), content: 'module.exports = {}' })
  if (options.readme !== undefined) entries.push({ name: 'README.md', content: options.readme })
  await writeFile(filePath, createZipFixture(entries))
  return {
    dir,
    filePath,
    fileName: filePath.split(/[\\/]/).pop() || 'local-tools.external-reference'
  }
}

beforeAll(async () => {
  const modulePath = '../src/main/backend/extensions'
  const backend = await import(modulePath)
  installExtensionPlugin = backend.installExtensionPlugin as typeof installExtensionPlugin
  updateExtensionPlugin = backend.updateExtensionPlugin as typeof updateExtensionPlugin
  installExtensionPackage = backend.installExtensionPackage as typeof installExtensionPackage
  uninstallExtensionPlugin = backend.uninstallExtensionPlugin as typeof uninstallExtensionPlugin
  listExtensionPlugins = backend.listExtensionPlugins as typeof listExtensionPlugins
  resetExtensionPluginCatalogForTests = backend.resetExtensionPluginCatalogForTests as typeof resetExtensionPluginCatalogForTests
  configureExtensionBackendRuntime = backend.configureExtensionBackendRuntime as typeof configureExtensionBackendRuntime
  cancelExtensionInstall = backend.cancelExtensionInstall as typeof cancelExtensionInstall
  openExtensionSubscription = backend.openExtensionSubscription as typeof openExtensionSubscription
  EXTENSION_SUBSCRIPTION_URL = backend.EXTENSION_SUBSCRIPTION_URL as string
})

describe('extension plugin backend boundary', () => {
  let extensionRootDir = ''

  beforeEach(async () => {
    extensionRootDir = ''
    resetExtensionPluginCatalogForTests()
    await useExtensionRoot()
  })

  afterEach(async () => {
    await cleanupExtensionRoot()
  })

  const useExtensionRoot = async () => {
    extensionRootDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-root-'))
    configureExtensionBackendRuntime({ extensionRootDir })
    return extensionRootDir
  }

  const cleanupExtensionRoot = async () => {
    if (!extensionRootDir) return
    const rootToRemove = extensionRootDir
    await rm(extensionRootDir, { recursive: true, force: true })
    extensionRootDir = ''
    configureExtensionBackendRuntime({ extensionRootDir: rootToRemove })
    resetExtensionPluginCatalogForTests()
  }

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

  it('rejects local package installs without a real package path', async () => {
    const result = await installExtensionPackage({ fileName: 'local-tools.external-reference' }, undefined, { stepDelayMs: 0 })

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PACKAGE_PATH_REQUIRED',
      errorMessage: 'Plugin package file path is required.'
    })
  })

  it('installs local package plugin metadata from plugin.json behind the backend boundary', async () => {
    const localPackage = await createLocalPackage({}, { readme: '# Local Tools\n\nReal package readme.' })
    const progress: ExtensionProgress[] = []
    try {
      const packageStat = await stat(localPackage.filePath)
      const result = await installExtensionPackage(
        {
          fileName: localPackage.fileName,
          filePath: localPackage.filePath,
          existingPluginIds: ['local-local-tools'],
          size: 4096
        },
        (event) => progress.push(event),
        { stepDelayMs: 0 }
      )

      expect(result.ok).toBe(true)
      expect(result.data.plugin).toMatchObject({
        pluginId: 'local-tools',
        name: 'Local Tools',
        description: 'Local package tools from manifest.',
        tabName: 'Local Tools',
        source: 'local',
        installed: true,
        installedVersion: '2.4.0',
        latestVersion: '2.4.0',
        size: packageStat.size,
        readme: expect.stringContaining('Real package readme.'),
        categories: ['Local', 'Tools'],
        functions: [{ title: 'Path check', desc: 'Inspect local path state.' }],
        packagePath: expect.stringContaining(extensionRootDir),
        installedAt: expect.any(String)
      })
      expect(progress.map((event) => event.stage)).toEqual(['verifying', 'installing', 'done'])
      expect(progress.every((event) => event.pluginId === 'local-tools' && event.operation === 'package')).toBe(true)
      await access(join(result.data.plugin.packagePath, 'plugin.json'))
      await access(join(result.data.plugin.packagePath, 'main.js'))
      expect(await readFile(join(result.data.plugin.packagePath, 'README.md'), 'utf8')).toContain('Real package readme.')
      const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
      expect(registry.plugins).toHaveLength(1)
      expect(registry.plugins[0]).toMatchObject({
        pluginId: 'local-tools',
        installedVersion: '2.4.0',
        packagePath: result.data.plugin.packagePath
      })

      configureExtensionBackendRuntime({ extensionRootDir })

      const catalog = await listExtensionPlugins()
      expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'local-tools')).toMatchObject({
        name: 'Local Tools',
        source: 'local',
        installed: true,
        installedVersion: '2.4.0',
        packagePath: result.data.plugin.packagePath
      })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('rejects local packages without plugin.json', async () => {
    const localPackage = await createLocalPackage({}, { includeManifest: false })
    try {
      const result = await installExtensionPackage({ fileName: localPackage.fileName, filePath: localPackage.filePath }, undefined, { stepDelayMs: 0 })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_MANIFEST_MISSING',
        errorMessage: 'Plugin package must contain plugin.json.'
      })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('rejects local packages when the manifest main entry is missing', async () => {
    const localPackage = await createLocalPackage({}, { includeMain: false })
    try {
      const result = await installExtensionPackage({ fileName: localPackage.fileName, filePath: localPackage.filePath }, undefined, { stepDelayMs: 0 })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_MAIN_MISSING',
        errorMessage: 'Plugin package main entry "main.js" was not found.'
      })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('reinstalls a local package by updating the same manifest id catalog row', async () => {
    const firstPackage = await createLocalPackage({ version: '2.4.0' })
    const secondPackage = await createLocalPackage({ version: '2.5.0', description: 'Updated package tools.' })
    try {
      await installExtensionPackage({ fileName: firstPackage.fileName, filePath: firstPackage.filePath }, undefined, { stepDelayMs: 0 })
      const result = await installExtensionPackage({ fileName: secondPackage.fileName, filePath: secondPackage.filePath }, undefined, { stepDelayMs: 0 })

      expect(result.ok).toBe(true)
      expect(result.data.plugin).toMatchObject({
        pluginId: 'local-tools',
        description: 'Updated package tools.',
        installedVersion: '2.5.0',
        latestVersion: '2.5.0'
      })
      const catalog = await listExtensionPlugins()
      const localRows = catalog.data.filter((plugin: ExtensionPlugin) => plugin.pluginId === 'local-tools')
      expect(localRows).toHaveLength(1)
      expect(localRows[0]).toMatchObject({ installedVersion: '2.5.0' })
      const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
      expect(registry.plugins).toHaveLength(1)
      expect(registry.plugins[0]).toMatchObject({ pluginId: 'local-tools', installedVersion: '2.5.0' })
    } finally {
      await rm(firstPackage.dir, { recursive: true, force: true })
      await rm(secondPackage.dir, { recursive: true, force: true })
    }
  })

  it('removes local package rows from the persisted registry when uninstalled', async () => {
    const localPackage = await createLocalPackage()
    try {
      const installResult = await installExtensionPackage({ fileName: localPackage.fileName, filePath: localPackage.filePath }, undefined, { stepDelayMs: 0 })
      expect(installResult.ok).toBe(true)
      const packagePath = installResult.data.plugin.packagePath

      const uninstallResult = await uninstallExtensionPlugin({ plugin: installResult.data.plugin })
      expect(uninstallResult.ok).toBe(true)
      expect(uninstallResult.data.plugin).toMatchObject({ pluginId: 'local-tools', show: false, installed: false })

      const catalog = await listExtensionPlugins()
      expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'local-tools')).toBeUndefined()
      const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
      expect(registry.plugins).toEqual([])
      await expect(stat(packagePath)).rejects.toThrow()
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
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
