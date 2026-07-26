import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateRawSync } from 'zlib'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

type ExtensionPlugin = {
  pluginId: string
  name: string
  description: string
  kind: 'runtime'
  iconKey: 'runbook' | 'cloud' | 'private' | 'local'
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  required?: boolean
  source?: 'builtin' | 'store' | 'local'
  installedAt?: string
  packagePath?: string
  storePackagePath?: string
  packageUrl?: string
  packageSha256?: string
  subscriptionUrl?: string
  readme?: string
  size?: number
  categories?: string[]
  functions?: Array<{ title: string; desc: string }>
  commands?: Array<{ id: string; title: string; description: string; command?: string }>
  assetProviders?: Array<{
    id: string
    name: string
    description: string
    adapter: 'json-assets' | 'runtime'
    fields: Array<{ key: string; label: string; type: 'textarea'; required: boolean; defaultValue?: string }>
  }>
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
  requestId?: string
}

let installExtensionPlugin: (input: { plugin: ExtensionPlugin }, emit?: (progress: ExtensionProgress) => void, options?: { stepDelayMs?: number }) => Promise<any>
let updateExtensionPlugin: (input: { plugin: ExtensionPlugin }, emit?: (progress: ExtensionProgress) => void, options?: { stepDelayMs?: number }) => Promise<any>
let installExtensionPackage: (
  input: { fileName: string; filePath?: string; existingPluginIds?: string[]; size?: number; requestId?: string },
  emit?: (progress: ExtensionProgress) => void,
  options?: { stepDelayMs?: number }
) => Promise<any>
let uninstallExtensionPlugin: (input: { plugin: ExtensionPlugin }) => Promise<any>
let listExtensionPlugins: () => Promise<any>
let resetExtensionPluginCatalogForTests: () => void
let configureExtensionBackendRuntime: (config?: {
  extensionRootDir?: string
  builtinPluginDir?: string
  storePackageDir?: string
  storeCatalogUrl?: string
  remotePackageCacheDir?: string
  appVersion?: string
  saveAsset?: (input: any) => any
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<any>
}) => void
let cancelExtensionInstall: (pluginId: string) => any
let openExtensionSubscription: (input: { plugin: ExtensionPlugin }, openExternal?: (url: string) => Promise<void> | void) => Promise<any>
let downloadExtensionPackage: (input: { url: string }) => Promise<any>
let installExtensionPluginFromUrl: (input: { pluginId: string; version?: string; url: string; sha256?: string }, emit?: (progress: ExtensionProgress) => void, options?: { stepDelayMs?: number }) => Promise<any>
let syncExtensionAssetProvider: (input: { pluginId: string; providerId: string; values: Record<string, string> }) => Promise<any>

const basePlugin = (patch: Partial<ExtensionPlugin> = {}): ExtensionPlugin => ({
  pluginId: 'cloud-assets',
  name: 'Cloud Assets',
  description: 'Cloud asset sync plugin.',
  kind: 'runtime',
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

const sha256Hex = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

const fetchResponse = (body: Buffer | string, options: { status?: number; chunkSize?: number } = {}) => {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
  const status = options.status ?? 200
  const chunkSize = options.chunkSize
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length' ? String(buffer.byteLength) : null)
    },
    body: chunkSize
      ? {
          getReader: () => {
            let offset = 0
            return {
              read: async () => {
                if (offset >= buffer.byteLength) return { done: true }
                const value = buffer.subarray(offset, Math.min(buffer.byteLength, offset + chunkSize))
                offset += value.byteLength
                return { done: false, value }
              }
            }
          }
        }
      : null,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    text: async () => buffer.toString('utf8')
  }
}

const createLocalPackage = async (
  patch: Record<string, unknown> = {},
  options: { includeManifest?: boolean; includeMain?: boolean; readme?: string } = {}
) => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-'))
  const filePath = join(dir, `${String(patch.id || 'local-tools')}.aiopsterm-plugin`)
  const manifest = {
    id: 'local-tools',
    displayName: 'Local Tools',
    version: '2.4.0',
    description: 'Local package tools from manifest.',
    main: 'main.cjs',
    engines: { aiopsterm: '>=0.1.0' },
    categories: ['Local', 'Tools'],
    functions: [{ title: 'Path check', desc: 'Inspect local path state.' }],
    contributes: {
      commands: [{ id: 'local-tools.path-check', title: 'Path check', description: 'Inspect local path state.', command: 'pwd' }]
    },
    ...patch
  }
  const entries: Array<{ name: string; content: string }> = []
  if (options.includeManifest !== false) entries.push({ name: 'aiopsterm.plugin.json', content: JSON.stringify(manifest) })
  if (options.includeMain !== false) entries.push({ name: 'main.cjs', content: 'exports.activate = function () {}' })
  if (options.readme !== undefined) entries.push({ name: 'README.md', content: options.readme })
  await writeFile(filePath, createZipFixture(entries))
  return {
    dir,
    filePath,
    fileName: filePath.split(/[\\/]/).pop() || 'local-tools.aiopsterm-plugin'
  }
}

beforeAll(async () => {
  const modulePath = '../src/main/backend/extensions/extensions'
  const backend = await import(modulePath)
  installExtensionPlugin = backend.installExtensionPlugin as typeof installExtensionPlugin
  updateExtensionPlugin = backend.updateExtensionPlugin as typeof updateExtensionPlugin
  installExtensionPackage = backend.installExtensionPackage as typeof installExtensionPackage
  uninstallExtensionPlugin = backend.uninstallExtensionPlugin as typeof uninstallExtensionPlugin
  listExtensionPlugins = backend.listExtensionPlugins as typeof listExtensionPlugins
  resetExtensionPluginCatalogForTests = backend.resetExtensionPluginCatalogForTests as typeof resetExtensionPluginCatalogForTests
  configureExtensionBackendRuntime = (config = {}) =>
    backend.configureExtensionBackendRuntime({ ...config, appVersion: config.appVersion || '0.1.0' })
  cancelExtensionInstall = backend.cancelExtensionInstall as typeof cancelExtensionInstall
  openExtensionSubscription = backend.openExtensionSubscription as typeof openExtensionSubscription
  downloadExtensionPackage = backend.downloadExtensionPackage as typeof downloadExtensionPackage
  installExtensionPluginFromUrl = backend.installExtensionPluginFromUrl as typeof installExtensionPluginFromUrl
  syncExtensionAssetProvider = backend.syncExtensionAssetProvider as typeof syncExtensionAssetProvider
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
    configureExtensionBackendRuntime({ extensionRootDir, appVersion: '0.1.0' })
    return extensionRootDir
  }

  const configureStorePackageDir = (storePackageDir: string) => {
    configureExtensionBackendRuntime({ extensionRootDir, storePackageDir, appVersion: '0.1.0' })
  }

  const createStorePackage = async (
    storePackageDir: string,
    patch: Record<string, unknown> = {},
    options: { includeManifest?: boolean; includeMain?: boolean; readme?: string } = {}
  ) => {
    const pluginId = String(patch.id || 'cloud-assets')
    const manifest = {
      id: pluginId,
      displayName: 'Cloud Assets',
      version: '0.9.1',
      description: 'Store package from manifest.',
      main: 'main.cjs',
      engines: { aiopsterm: '>=0.1.0' },
      categories: ['Cloud', 'Assets'],
      functions: [{ title: 'Cloud sync', desc: 'Sync cloud hosts from a real package.' }],
      contributes: {
        commands: [{ id: `${pluginId}.sync`, title: 'Cloud sync', description: 'Sync cloud assets.', command: 'echo sync' }]
      },
      ...patch
    }
    const fileName = `${String(manifest.id)}-${String(manifest.version)}.aiopsterm-plugin`
    const filePath = join(storePackageDir, fileName)
    const entries: Array<{ name: string; content: string }> = []
    if (options.includeManifest !== false) entries.push({ name: 'aiopsterm.plugin.json', content: JSON.stringify(manifest) })
    if (options.includeMain !== false) entries.push({ name: 'main.cjs', content: 'exports.activate = function () {}' })
    if (options.readme !== undefined) entries.push({ name: 'README.md', content: options.readme })
    await writeFile(filePath, createZipFixture(entries))
    return {
      fileName,
      filePath
    }
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
    expect(result.data).toEqual([])
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'ops-runbook')).toBeUndefined()
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'local-shell-tools')).toBeUndefined()
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'cloud-assets')).toBeUndefined()
  })

  it('discovers both executable aiopsterm built-in plugins from app resources', async () => {
    configureExtensionBackendRuntime({
      extensionRootDir,
      builtinPluginDir: join(process.cwd(), 'resources', 'builtin-plugins')
    })

    const result = await listExtensionPlugins()

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'aiopsterm.operations-toolkit')).toMatchObject({
      kind: 'runtime',
      source: 'builtin',
      installed: true,
      required: false,
      installable: false,
      main: 'main.cjs',
      runtimeStatus: 'active',
      commands: expect.arrayContaining([expect.objectContaining({ id: 'aiopsterm.operations-toolkit.run' })]),
      views: [expect.objectContaining({ id: 'aiopsterm.operations-toolkit.checks' })]
    })
    expect(result.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'aiopsterm.http-cmdb-provider')).toMatchObject({
      kind: 'runtime',
      source: 'builtin',
      installed: true,
      required: false,
      runtimeStatus: 'active',
      assetProviders: [expect.objectContaining({ id: 'aiopsterm.http-cmdb-provider.assets', adapter: 'runtime' })],
      configuration: expect.objectContaining({ title: 'HTTP CMDB 配置' })
    })
  })

  it('runs the executable Operations Toolkit command and tree provider', async () => {
    configureExtensionBackendRuntime({
      extensionRootDir,
      builtinPluginDir: join(process.cwd(), 'resources', 'builtin-plugins')
    })

    const modulePath = '../src/main/backend/extensions/extensions'
    const backend = await import(modulePath)
    await backend.activateInstalledExtensions()
    await expect(backend.listPluginTreeChildren({ viewId: 'aiopsterm.operations-toolkit.checks' })).resolves.toMatchObject({
      ok: true,
      data: { items: expect.arrayContaining([expect.objectContaining({ id: 'overview', contextValue: 'runnable' })]) }
    })
    await expect(
      backend.executePluginCommand({ commandId: 'aiopsterm.operations-toolkit.run', args: ['overview'] })
    ).resolves.toMatchObject({
      ok: true,
      data: { value: { terminalText: expect.stringContaining('uptime') } }
    })
  })

  it('discovers store plugin catalog rows from configured real package directories', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    try {
      const storePackage = await createStorePackage(storePackageDir, {}, { readme: '# Cloud Assets\n\nReal store package.' })
      configureStorePackageDir(storePackageDir)

      const catalog = await listExtensionPlugins()
      expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'cloud-assets')).toMatchObject({
        pluginId: 'cloud-assets',
        name: 'Cloud Assets',
        source: 'store',
        installed: false,
        latestVersion: '0.9.1',
        storePackagePath: storePackage.filePath,
        readme: expect.stringContaining('Real store package.'),
        categories: ['Cloud', 'Assets'],
        functions: [{ title: 'Cloud sync', desc: 'Sync cloud hosts from a real package.' }]
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('discovers remote store catalog rows from a backend-owned manifest URL', async () => {
    const packageUrl = 'https://extensions.aiopsterm.test/cloud-assets-0.9.1.aiopsterm-plugin'
    const packageBuffer = createZipFixture([
      {
        name: 'aiopsterm.plugin.json',
        content: JSON.stringify({
          id: 'cloud-assets',
          displayName: 'Cloud Assets',
          version: '0.9.1',
          description: 'Remote catalog package.',
          main: 'main.js',
          engines: { aiopsterm: '>=0.1.0' },
          iconKey: 'cloud',
          categories: ['Cloud', 'Remote'],
          functions: [{ title: 'Remote sync', desc: 'Sync from a remote package catalog.' }],
          contributes: {
            commands: [{ id: 'cloud-assets.sync', title: 'Remote sync', description: 'Sync cloud assets.', command: 'echo sync' }]
          }
        })
      },
      { name: 'main.js', content: 'module.exports = {}' }
    ])
    const packageSha256 = sha256Hex(packageBuffer)
    const fetchCalls: string[] = []
    configureExtensionBackendRuntime({
      extensionRootDir,
      storeCatalogUrl: 'https://extensions.aiopsterm.test/catalog.json',
      fetch: async (url: string) => {
        fetchCalls.push(url)
        return fetchResponse(
          JSON.stringify({
            plugins: [
              {
                id: 'cloud-assets',
                displayName: 'Cloud Assets',
                version: '0.9.1',
                main: 'main.js',
                engines: { aiopsterm: '>=0.1.0' },
                description: 'Remote catalog package.',
                iconKey: 'cloud',
                packageUrl,
                packageSha256,
                categories: ['Cloud', 'Remote'],
                functions: [{ title: 'Remote sync', desc: 'Sync from a remote package catalog.' }],
                contributes: {
                  commands: [{ id: 'cloud-assets.sync', title: 'Remote sync', description: 'Sync cloud assets.', command: 'echo sync' }]
                }
              }
            ]
          })
        ) as any
      }
    })

    const catalog = await listExtensionPlugins()

    expect(catalog.ok).toBe(true)
    expect(fetchCalls).toEqual(['https://extensions.aiopsterm.test/catalog.json'])
    expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'cloud-assets')).toMatchObject({
      pluginId: 'cloud-assets',
      name: 'Cloud Assets',
      source: 'store',
      installed: false,
      latestVersion: '0.9.1',
      packageUrl,
      packageSha256,
      categories: ['Cloud', 'Remote'],
      functions: [{ title: 'Remote sync', desc: 'Sync from a remote package catalog.' }]
    })
  })

  it('rejects unsafe remote store catalog package and subscription URLs during discovery', async () => {
    configureExtensionBackendRuntime({
      extensionRootDir,
      storeCatalogUrl: 'https://extensions.aiopsterm.test/catalog.json',
      fetch: async () =>
        fetchResponse(
          JSON.stringify({
            plugins: [
              {
                id: 'unsafe-plugin',
                displayName: 'Unsafe Plugin',
                version: '1.0.0',
                description: 'Unsafe remote catalog package.',
                iconKey: 'private',
                packageUrl: 'javascript:alert(1)',
                subscriptionUrl: 'https://user:pass@extensions.aiopsterm.test/private',
                private: true,
                installable: false
              }
            ]
          })
        ) as any
    })

    const catalog = await listExtensionPlugins()
    const unsafePlugin = catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'unsafe-plugin')

    expect(unsafePlugin).toBeUndefined()
  })

  it('installs a store plugin from a configured real package', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    const progress: ExtensionProgress[] = []
    try {
      const storePackage = await createStorePackage(storePackageDir, {}, { readme: '# Cloud Assets\n\nReal store package.' })
      configureStorePackageDir(storePackageDir)

      const result = await installExtensionPlugin({ plugin: basePlugin() }, (event) => progress.push(event), { stepDelayMs: 0 })

      expect(result.ok).toBe(true)
      expect(result.data.plugin).toMatchObject({
        pluginId: 'cloud-assets',
        name: 'Cloud Assets',
        source: 'store',
        installed: true,
        hasUpdate: false,
        installedVersion: '0.9.1',
        latestVersion: '0.9.1',
        storePackagePath: storePackage.filePath,
        packagePath: expect.stringContaining(extensionRootDir),
        readme: expect.stringContaining('Real store package.'),
        categories: ['Cloud', 'Assets'],
        functions: [{ title: 'Cloud sync', desc: 'Sync cloud hosts from a real package.' }]
      })
      expect(progress.map((event) => event.stage)).toEqual(['verifying', 'installing', 'done'])
      expect(progress.every((event) => event.operation === 'install')).toBe(true)
      await access(join(result.data.plugin.packagePath, 'aiopsterm.plugin.json'))
      await access(join(result.data.plugin.packagePath, 'main.cjs'))
      const catalog = await listExtensionPlugins()
      expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'cloud-assets')).toMatchObject({
        installed: true,
        installedVersion: '0.9.1'
      })
      const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
      expect(registry.plugins).toHaveLength(1)
      expect(registry.plugins[0]).toMatchObject({
        pluginId: 'cloud-assets',
        source: 'store',
        installedVersion: '0.9.1',
        packagePath: result.data.plugin.packagePath
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('installs a store plugin from an explicit package path returned by the backend catalog row', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    try {
      const storePackage = await createStorePackage(storePackageDir)

      const result = await installExtensionPlugin(
        {
          plugin: basePlugin({
            storePackagePath: storePackage.filePath
          })
        },
        undefined,
        { stepDelayMs: 0 }
      )

      expect(result.ok).toBe(true)
      expect(result.data.plugin).toMatchObject({
        pluginId: 'cloud-assets',
        installed: true,
        installedVersion: '0.9.1',
        storePackagePath: storePackage.filePath
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('downloads, verifies and installs a remote store plugin package', async () => {
    const packageUrl = 'https://extensions.aiopsterm.test/cloud-assets-0.9.1.aiopsterm-plugin'
    const packageBuffer = createZipFixture([
      {
        name: 'aiopsterm.plugin.json',
        content: JSON.stringify({
          id: 'cloud-assets',
          displayName: 'Cloud Assets',
          version: '0.9.1',
          description: 'Remote package from catalog.',
          main: 'main.cjs',
          engines: { aiopsterm: '>=0.1.0' },
          iconKey: 'cloud',
          categories: ['Cloud', 'Remote'],
          functions: [{ title: 'Remote sync', desc: 'Sync cloud hosts from a remote package.' }],
          contributes: {
            commands: [{ id: 'cloud-assets.sync', title: 'Remote sync', description: 'Sync cloud assets.', command: 'echo sync' }]
          }
        })
      },
      { name: 'main.cjs', content: 'exports.activate = function () {}' },
      { name: 'README.md', content: '# Cloud Assets\n\nRemote package readme.' }
    ])
    const packageSha256 = sha256Hex(packageBuffer)
    const progress: ExtensionProgress[] = []
    const fetchCalls: string[] = []
    configureExtensionBackendRuntime({
      extensionRootDir,
      fetch: async (url: string) => {
        fetchCalls.push(url)
        return fetchResponse(packageBuffer, { chunkSize: 48 }) as any
      }
    })

    const result = await installExtensionPlugin(
      {
        plugin: basePlugin({
          packageUrl,
          packageSha256
        })
      },
      (event) => progress.push(event),
      { stepDelayMs: 0 }
    )

    expect(result.ok).toBe(true)
    expect(fetchCalls).toEqual([packageUrl])
    expect(result.data.plugin).toMatchObject({
      pluginId: 'cloud-assets',
      source: 'store',
      installed: true,
      installedVersion: '0.9.1',
      packageUrl,
      packageSha256,
      packagePath: expect.stringContaining(join('cloud-assets', '0.9.1')),
      storePackagePath: expect.stringContaining(join('cache', 'cloud-assets', 'cloud-assets-0.9.1.aiopsterm-plugin')),
      readme: expect.stringContaining('Remote package readme.'),
      categories: ['Cloud', 'Remote'],
      functions: [{ title: 'Remote sync', desc: 'Sync cloud hosts from a remote package.' }]
    })
    expect(progress.map((event) => event.stage)).toEqual(expect.arrayContaining(['downloading', 'verifying', 'installing', 'done']))
    expect(progress.some((event) => event.stage === 'downloading' && event.percent > 0)).toBe(true)
    await access(join(result.data.plugin.packagePath, 'aiopsterm.plugin.json'))
    await access(join(result.data.plugin.storePackagePath))
    const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
    expect(registry.plugins[0]).toMatchObject({
      pluginId: 'cloud-assets',
      packageUrl,
      packageSha256
    })
  })

  it('rejects remote store packages with a mismatched checksum before installing', async () => {
    const packageUrl = 'https://extensions.aiopsterm.test/cloud-assets-0.9.1.aiopsterm-plugin'
    const packageBuffer = createZipFixture([
      {
        name: 'aiopsterm.plugin.json',
        content: JSON.stringify({
          id: 'cloud-assets',
          displayName: 'Cloud Assets',
          version: '0.9.1',
          main: 'main.js'
        })
      },
      { name: 'main.js', content: 'module.exports = {}' }
    ])
    configureExtensionBackendRuntime({
      extensionRootDir,
      fetch: async () => fetchResponse(packageBuffer) as any
    })

    const result = await installExtensionPlugin(
      {
        plugin: basePlugin({
          packageUrl,
          packageSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        })
      },
      undefined,
      { stepDelayMs: 0 }
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_STORE_PACKAGE_CHECKSUM_MISMATCH',
      errorMessage: 'Plugin package checksum mismatch.'
    })
    await expect(stat(join(extensionRootDir, 'registry.json'))).rejects.toThrow()
  })

  it('supports aiopsterm explicit URL download and install APIs', async () => {
    const packageUrl = 'https://extensions.aiopsterm.test/direct-runbook-1.0.0.aiopsterm-plugin'
    const packageBuffer = createZipFixture([
      {
        name: 'aiopsterm.plugin.json',
        content: JSON.stringify({
          id: 'direct-runbook',
          displayName: 'Direct Runbook',
          version: '1.0.0',
          main: 'main.cjs',
          engines: { aiopsterm: '>=0.1.0' },
          categories: ['Tools'],
          contributes: {
            commands: [{ id: 'direct-runbook.check', title: 'Direct check', description: 'Run direct check.', command: 'uptime' }]
          }
        })
      },
      { name: 'main.cjs', content: 'exports.activate = function () {}' }
    ])
    const packageSha256 = sha256Hex(packageBuffer)
    configureExtensionBackendRuntime({
      extensionRootDir,
      fetch: async () => fetchResponse(packageBuffer) as any
    })

    const downloadResult = await downloadExtensionPackage({ url: packageUrl })
    expect(downloadResult).toMatchObject({
      ok: true,
      data: {
        url: packageUrl,
        bytes: packageBuffer.byteLength
      }
    })
    expect(Buffer.from(downloadResult.data.data)).toEqual(packageBuffer)

    const installResult = await installExtensionPluginFromUrl(
      {
        pluginId: 'direct-runbook',
        version: '1.0.0',
        url: packageUrl,
        sha256: packageSha256
      },
      undefined,
      { stepDelayMs: 0 }
    )

    expect(installResult.ok).toBe(true)
    expect(installResult.data.plugin).toMatchObject({
      pluginId: 'direct-runbook',
      installed: true,
      installedVersion: '1.0.0',
      packageUrl,
      packageSha256,
      source: 'store'
    })
  })

  it('rejects a store package whose manifest id does not match the catalog plugin', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    try {
      await writeFile(
        join(storePackageDir, 'cloud-assets-0.9.1.aiopsterm-plugin'),
        createZipFixture([
          {
            name: 'aiopsterm.plugin.json',
            content: JSON.stringify({
              id: 'wrong-plugin',
              displayName: 'Cloud Assets',
              version: '0.9.1',
              main: 'main.js'
            })
          },
          { name: 'main.js', content: 'module.exports = {}' }
        ])
      )
      configureStorePackageDir(storePackageDir)

      const result = await installExtensionPlugin({ plugin: basePlugin() }, undefined, { stepDelayMs: 0 })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_STORE_PACKAGE_MANIFEST_MISMATCH',
        errorMessage: 'Store package id "wrong-plugin" does not match catalog plugin "cloud-assets".'
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('updates an installed store plugin from a configured real package', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    const oldPackagePath = join(extensionRootDir, 'installed', 'ops-runbook', '1.2.0')
    const progress: ExtensionProgress[] = []
    try {
      await mkdir(oldPackagePath, { recursive: true })
      await writeFile(join(oldPackagePath, 'main.cjs'), 'exports.activate = function () {}', 'utf8')
      await writeFile(
        join(extensionRootDir, 'registry.json'),
        JSON.stringify(
          {
            plugins: [
              {
                pluginId: 'ops-runbook',
                name: 'Ops Runbook',
                description: 'Installed runbook package.',
                kind: 'runtime',
                iconKey: 'runbook',
                tabName: 'Ops Runbook',
                show: true,
                isPlugin: true,
                installed: true,
                hasUpdate: false,
                installedVersion: '1.2.0',
                latestVersion: '1.2.0',
                installable: true,
                source: 'store',
                packagePath: oldPackagePath,
                main: 'main.cjs',
                categories: ['Tools', 'Runbook'],
                commands: [{ id: 'ops-runbook.check', title: 'Runbook check', description: 'Run checks.', command: 'uptime' }]
              }
            ]
          },
          null,
          2
        ),
        'utf8'
      )
      await createStorePackage(
        storePackageDir,
        {
          id: 'ops-runbook',
          displayName: 'Ops Runbook',
          version: '1.3.0',
          description: 'Updated runbook package.',
          iconKey: 'runbook',
          categories: ['Tools', 'Runbook'],
          functions: [{ title: '发布守卫', desc: 'Updated release guard.' }]
        },
        { readme: '# Ops Runbook\n\nUpdated package.' }
      )
      configureStorePackageDir(storePackageDir)
      const catalogBefore = await listExtensionPlugins()
      const opsRunbook = catalogBefore.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'ops-runbook')
      expect(opsRunbook).toMatchObject({ installed: true, hasUpdate: true, installedVersion: '1.2.0', latestVersion: '1.3.0' })

      const result = await updateExtensionPlugin({ plugin: opsRunbook }, (event) => progress.push(event), { stepDelayMs: 0 })

      expect(result.ok).toBe(true)
      expect(result.data.plugin).toMatchObject({
        pluginId: 'ops-runbook',
        source: 'store',
        installedVersion: '1.3.0',
        latestVersion: '1.3.0',
        hasUpdate: false,
        packagePath: expect.stringContaining(join('ops-runbook', '1.3.0'))
      })
      expect(progress.map((event) => event.stage)).toEqual(['verifying', 'installing', 'done'])
      expect(progress.every((event) => event.operation === 'update')).toBe(true)
      const registry = JSON.parse(await readFile(join(extensionRootDir, 'registry.json'), 'utf8')) as { plugins: ExtensionPlugin[] }
      expect(registry.plugins).toHaveLength(1)
      expect(registry.plugins[0]).toMatchObject({ pluginId: 'ops-runbook', installedVersion: '1.3.0' })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('rejects a store package whose version does not match the catalog version', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    try {
      const mismatchedPackagePath = join(storePackageDir, 'cloud-assets-0.8.0.aiopsterm-plugin')
      await writeFile(mismatchedPackagePath, createZipFixture([
        {
          name: 'aiopsterm.plugin.json',
          content: JSON.stringify({
            id: 'cloud-assets',
            displayName: 'Cloud Assets',
            version: '0.8.0',
            main: 'main.cjs',
            engines: { aiopsterm: '>=0.1.0' },
            contributes: {
              commands: [{ id: 'cloud-assets.sync', title: 'Cloud sync', description: 'Sync cloud assets.', command: 'echo sync' }]
            }
          })
        },
        { name: 'main.cjs', content: 'exports.activate = function () {}' }
      ]))

      const result = await installExtensionPlugin({ plugin: basePlugin({ storePackagePath: mismatchedPackagePath }) }, undefined, { stepDelayMs: 0 })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_STORE_PACKAGE_VERSION_MISMATCH',
        errorMessage: 'Cloud Assets package version 0.8.0 does not match expected version 0.9.1.'
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('does not fabricate updates for installed store plugins without a real store package', async () => {
    const oldPackagePath = join(extensionRootDir, 'installed', 'ops-runbook', '1.2.0')
    await mkdir(oldPackagePath, { recursive: true })
    await writeFile(join(oldPackagePath, 'main.cjs'), 'exports.activate = function () {}', 'utf8')
    await writeFile(
      join(extensionRootDir, 'registry.json'),
      JSON.stringify(
        {
          plugins: [
            {
              pluginId: 'ops-runbook',
              name: 'Ops Runbook',
              description: 'Installed runbook package.',
              kind: 'runtime',
              iconKey: 'runbook',
              tabName: 'Ops Runbook',
              show: true,
              isPlugin: true,
              installed: true,
              hasUpdate: false,
              installedVersion: '1.2.0',
              latestVersion: '1.2.0',
              installable: true,
              source: 'store',
              packagePath: oldPackagePath,
              main: 'main.cjs',
              categories: ['Tools', 'Runbook']
              ,
              commands: [{ id: 'ops-runbook.check', title: 'Runbook check', description: 'Run checks.', command: 'uptime' }]
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    )
    configureExtensionBackendRuntime({ extensionRootDir })
    const catalogBefore = await listExtensionPlugins()
    const opsRunbook = catalogBefore.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'ops-runbook')
    expect(opsRunbook).toMatchObject({
      installed: true,
      hasUpdate: false,
      installedVersion: '1.2.0',
      latestVersion: '1.2.0'
    })
    await expect(updateExtensionPlugin({ plugin: opsRunbook }, undefined, { stepDelayMs: 0 })).resolves.toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_UPDATE_UNAVAILABLE',
      errorMessage: 'Plugin has no available update.'
    })
  })

  it('rejects invalid local package formats before adding plugin metadata', async () => {
    const result = await installExtensionPackage({ fileName: 'plugin.zip' }, undefined, { stepDelayMs: 0 })

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PACKAGE_FORMAT_INVALID',
      errorMessage: 'Plugin package must use the .aiopsterm-plugin extension.'
    })
  })

  it('rejects legacy External reference plugin packages', async () => {
    const result = await installExtensionPackage({ fileName: 'legacy.external-reference', filePath: '/tmp/legacy.external-reference' })

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PACKAGE_FORMAT_INVALID',
      errorMessage: 'Plugin package must use the .aiopsterm-plugin extension.'
    })
  })

  it('rejects local package installs without a real package path', async () => {
    const result = await installExtensionPackage({ fileName: 'local-tools.aiopsterm-plugin' }, undefined, { stepDelayMs: 0 })

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PACKAGE_PATH_REQUIRED',
      errorMessage: 'Plugin package file path is required.'
    })
  })

  it('rejects plugins that require an unsupported aiopsterm version', async () => {
    const localPackage = await createLocalPackage({ engines: { aiopsterm: '>=99.0.0' } })
    try {
      const result = await installExtensionPackage({
        fileName: localPackage.fileName,
        filePath: localPackage.filePath
      })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_ENGINE_UNSUPPORTED',
        errorMessage: 'Plugin requires aiopsterm >=99.0.0, current version is 0.1.0.'
      })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('rejects obsolete versioned and declarative manifest fields', async () => {
    const versionedPackage = await createLocalPackage({ manifestVersion: 2 })
    const declarativePackage = await createLocalPackage({ kind: 'content' })
    try {
      await expect(
        installExtensionPackage({ fileName: versionedPackage.fileName, filePath: versionedPackage.filePath })
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_MANIFEST_INVALID',
        errorMessage: 'aiopsterm.plugin.json must not declare manifestVersion or kind.'
      })
      await expect(
        installExtensionPackage({ fileName: declarativePackage.fileName, filePath: declarativePackage.filePath })
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_MANIFEST_INVALID',
        errorMessage: 'aiopsterm.plugin.json must not declare manifestVersion or kind.'
      })
    } finally {
      await rm(versionedPackage.dir, { recursive: true, force: true })
      await rm(declarativePackage.dir, { recursive: true, force: true })
    }
  })

  it('installs local package plugin metadata from aiopsterm.plugin.json behind the backend boundary', async () => {
    const localPackage = await createLocalPackage({}, { readme: '# Local Tools\n\nReal package readme.' })
    const progress: ExtensionProgress[] = []
    try {
      const packageStat = await stat(localPackage.filePath)
      const result = await installExtensionPackage(
        {
          fileName: localPackage.fileName,
          filePath: localPackage.filePath,
          existingPluginIds: ['local-local-tools'],
          size: 4096,
          requestId: 'extension-package-install-backend-test'
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
      expect(progress.every((event) => event.requestId === 'extension-package-install-backend-test')).toBe(true)
      await access(join(result.data.plugin.packagePath, 'aiopsterm.plugin.json'))
      await access(join(result.data.plugin.packagePath, 'main.cjs'))
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

  it('rejects local packages without aiopsterm.plugin.json', async () => {
    const localPackage = await createLocalPackage({}, { includeManifest: false })
    try {
      const result = await installExtensionPackage({ fileName: localPackage.fileName, filePath: localPackage.filePath }, undefined, { stepDelayMs: 0 })

      expect(result).toEqual({
        ok: false,
        errorCode: 'EXTENSION_PACKAGE_MANIFEST_MISSING',
        errorMessage: 'Plugin package must contain aiopsterm.plugin.json.'
      })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('rejects packages without executable main entries', async () => {
    const localPackage = await createLocalPackage({}, { includeMain: false })
    try {
      const result = await installExtensionPackage({ fileName: localPackage.fileName, filePath: localPackage.filePath }, undefined, { stepDelayMs: 0 })

      expect(result).toMatchObject({ ok: false, errorCode: 'EXTENSION_PACKAGE_MAIN_MISSING' })
    } finally {
      await rm(localPackage.dir, { recursive: true, force: true })
    }
  })

  it('installs and activates an executable package from its declared main entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-runtime-'))
    const filePath = join(dir, 'example-runtime.aiopsterm-plugin')
    const manifest = {
      id: 'example.runtime-package',
      displayName: 'Example Runtime Package',
      version: '1.0.0',
      description: 'Executable package fixture.',
      engines: { aiopsterm: '>=0.1.0' },
      main: 'main.cjs',
      contributes: {
        commands: [
          {
            id: 'example.runtime-package.hello',
            title: 'Hello',
            description: 'Return a runtime value.'
          }
        ],
        views: [
          {
            id: 'example.runtime-package.tree',
            name: 'Runtime Tree'
          }
        ]
      }
    }
    await writeFile(
      filePath,
      createZipFixture([
        { name: 'aiopsterm.plugin.json', content: JSON.stringify(manifest) },
        {
          name: 'main.cjs',
          content:
            "exports.activate = function (context) { context.subscriptions.push(context.commands.registerCommand('example.runtime-package.hello', function () { return 'hello' })); context.subscriptions.push(context.views.registerTreeDataProvider('example.runtime-package.tree', { getChildren: function () { return [{ id: 'node', label: 'Node' }] } })) }"
        }
      ])
    )

    try {
      const result = await installExtensionPackage(
        { fileName: 'example-runtime.aiopsterm-plugin', filePath },
        undefined,
        { stepDelayMs: 0 }
      )
      expect(result).toMatchObject({
        ok: true,
        data: {
          plugin: {
            pluginId: 'example.runtime-package',
            kind: 'runtime',
            runtimeStatus: 'active'
          }
        }
      })
      const modulePath = '../src/main/backend/extensions/extensions'
      const backend = await import(modulePath)
      await expect(backend.executePluginCommand({ commandId: 'example.runtime-package.hello' })).resolves.toEqual({
        ok: true,
        data: { commandId: 'example.runtime-package.hello', value: 'hello' }
      })
      await expect(backend.listPluginTreeChildren({ viewId: 'example.runtime-package.tree' })).resolves.toMatchObject({
        ok: true,
        data: { items: [{ id: 'node', label: 'Node' }] }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects packages with missing main entries or unnamespaced contributions', async () => {
    const missingMain = await createLocalPackage({
      id: 'example.missing-main',
      displayName: 'Missing Main',
      main: 'main.cjs',
      kind: undefined,
      contributes: {
        commands: [{ id: 'example.missing-main.run', title: 'Run', description: 'Run' }]
      }
    }, { includeMain: false })
    const unnamespacedDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-runtime-invalid-'))
    const unnamespacedPath = join(unnamespacedDir, 'unnamespaced.aiopsterm-plugin')
    await writeFile(
      unnamespacedPath,
      createZipFixture([
        {
          name: 'aiopsterm.plugin.json',
          content: JSON.stringify({
            id: 'example.namespaced',
            displayName: 'Namespaced',
            version: '1.0.0',
            engines: { aiopsterm: '>=0.1.0' },
            main: 'main.cjs',
            contributes: {
              commands: [{ id: 'other.run', title: 'Run', description: 'Run' }]
            }
          })
        },
        { name: 'main.cjs', content: 'exports.activate = function () {}' }
      ])
    )

    try {
      await expect(
        installExtensionPackage({ fileName: missingMain.fileName, filePath: missingMain.filePath }, undefined, { stepDelayMs: 0 })
      ).resolves.toMatchObject({ ok: false, errorCode: 'EXTENSION_PACKAGE_MAIN_MISSING' })
      await expect(
        installExtensionPackage({ fileName: 'unnamespaced.aiopsterm-plugin', filePath: unnamespacedPath }, undefined, { stepDelayMs: 0 })
      ).resolves.toMatchObject({ ok: false, errorCode: 'EXTENSION_PACKAGE_CONTRIBUTION_ID_INVALID' })
    } finally {
      await rm(missingMain.dir, { recursive: true, force: true })
      await rm(unnamespacedDir, { recursive: true, force: true })
    }
  })

  it('rolls back an executable package when activation fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-runtime-failure-'))
    const filePath = join(dir, 'activation-failure.aiopsterm-plugin')
    await writeFile(
      filePath,
      createZipFixture([
        {
          name: 'aiopsterm.plugin.json',
          content: JSON.stringify({
            id: 'example.activation-failure',
            displayName: 'Activation Failure',
            version: '1.0.0',
            engines: { aiopsterm: '>=0.1.0' },
            main: 'main.cjs',
            contributes: {
              commands: [{ id: 'example.activation-failure.run', title: 'Run', description: 'Run' }]
            }
          })
        },
        { name: 'main.cjs', content: "exports.activate = function () { throw new Error('fixture activation failure') }" }
      ])
    )

    try {
      await expect(
        installExtensionPackage({ fileName: 'activation-failure.aiopsterm-plugin', filePath }, undefined, { stepDelayMs: 0 })
      ).resolves.toMatchObject({
        ok: false,
        errorCode: 'EXTENSION_PLUGIN_ACTIVATION_FAILED',
        errorMessage: 'fixture activation failure'
      })
      const catalog = await listExtensionPlugins()
      expect(catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'example.activation-failure')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
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
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    const progress: ExtensionProgress[] = []
    try {
      await createStorePackage(storePackageDir)
      configureStorePackageDir(storePackageDir)
      const pending = installExtensionPlugin({ plugin: basePlugin() }, (event) => progress.push(event), { stepDelayMs: 30 })

      await new Promise((resolve) => setTimeout(resolve, 5))
      const cancelResult = cancelExtensionInstall('cloud-assets')
      const result = await pending

      expect(cancelResult.ok).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('EXTENSION_PLUGIN_OPERATION_CANCELLED')
      expect(progress.at(-1)).toMatchObject({ pluginId: 'cloud-assets', stage: 'cancelled', percent: 0 })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('aborts an active remote package download when installation is cancelled', async () => {
    const packageUrl = 'https://extensions.aiopsterm.test/cloud-assets-0.9.1.aiopsterm-plugin'
    const progress: ExtensionProgress[] = []
    let aborted = false
    configureExtensionBackendRuntime({
      extensionRootDir,
      fetch: async (_url: string, init?: { signal?: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true
              reject(new Error('aborted by test'))
            })
          })
        }) as any
    })

    const pending = installExtensionPlugin(
      {
        plugin: basePlugin({
          packageUrl
        })
      },
      (event) => progress.push(event),
      { stepDelayMs: 0 }
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    const cancelResult = cancelExtensionInstall('cloud-assets')
    const result = await pending

    expect(cancelResult.ok).toBe(true)
    expect(aborted).toBe(true)
    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    })
    expect(progress.at(-1)).toMatchObject({ pluginId: 'cloud-assets', stage: 'cancelled', percent: 0 })
  })

  it('opens the private plugin subscription entry behind the backend boundary', async () => {
    const storePackageDir = await mkdtemp(join(tmpdir(), 'aiopsterm-extension-store-'))
    const openedUrls: string[] = []
    const subscriptionUrl = 'https://aiopsterm.local/extensions/private-automation-pack'
    try {
      await createStorePackage(storePackageDir, {
        id: 'private-automation-pack',
        displayName: 'Private Automation Pack',
        version: '2.0.0',
        description: 'Private package metadata from a real store package.',
        iconKey: 'private',
        installable: false,
        isPrivate: true,
        subscriptionUrl,
        categories: ['Private', 'Automation']
      })
      configureStorePackageDir(storePackageDir)
      const catalog = await listExtensionPlugins()
      const privatePlugin = catalog.data.find((plugin: ExtensionPlugin) => plugin.pluginId === 'private-automation-pack')

      const result = await openExtensionSubscription(
        {
          plugin: privatePlugin
        },
        (url) => {
          openedUrls.push(url)
        }
      )

      expect(result.ok).toBe(true)
      expect(openedUrls).toEqual([subscriptionUrl])
      expect(result.data).toMatchObject({
        pluginId: 'private-automation-pack',
        url: subscriptionUrl
      })
    } finally {
      await rm(storePackageDir, { recursive: true, force: true })
    }
  })

  it('rejects private subscription entries without a backend-owned subscription URL', async () => {
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
      () => undefined
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE',
      errorMessage: 'Plugin subscription URL is not available.'
    })
  })

  it('rejects private subscription entries with unsafe subscription URLs before opening the system browser', async () => {
    const openedUrls: string[] = []
    const result = await openExtensionSubscription(
      {
        plugin: basePlugin({
          pluginId: 'private-automation-pack',
          name: 'Private Automation Pack',
          iconKey: 'private',
          installable: false,
          isPrivate: true,
          subscriptionUrl: 'javascript:alert(document.cookie)'
        })
      },
      (url) => {
        openedUrls.push(url)
      }
    )

    expect(result).toEqual({
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE',
      errorMessage: 'Plugin subscription URL is not available.'
    })
    expect(openedUrls).toEqual([])
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
