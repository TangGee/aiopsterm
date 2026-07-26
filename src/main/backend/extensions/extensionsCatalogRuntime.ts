import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import type { ExtensionPluginListResult, ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'
import {
  asRecord,
  clonePlugin,
  extractPackageManifestSource,
  extractStoreManifestFlags,
  isVersionNewer,
  normalizeAbsoluteHttpUrl,
  normalizeExtensionIconKey,
  parseManifestAssetProviders,
  parseManifestCommands,
  parseManifestFunctions,
  parseStringArray,
  trimText,
  type ExtensionBackendRuntimeConfig,
  type ExtensionFetch,
  type ExtensionPackageRuntimeConfig,
  type RemoteExtensionCatalogManifest,
  type RemoteExtensionCatalogPluginManifest
} from './extensionsRuntimeCore'
import {
  configureExtensionPackageRuntime,
  latestStorePluginsFromPackageDir,
  pluginFromAiopstermManifest,
  walkStorePackageFiles
} from './extensionsPackageRuntime'

export const defaultExtensionRootDir = () => {
  const envRoot = String(process.env.AIOPSTERM_EXTENSIONS_DIR || '').trim()
  return envRoot ? (isAbsolute(envRoot) ? envRoot : resolve(envRoot)) : join(process.cwd(), '.aiopsterm-extensions')
}

export const defaultStorePackageDir = () => {
  const envRoot = String(process.env.AIOPSTERM_EXTENSION_STORE_DIR || '').trim()
  return envRoot ? (isAbsolute(envRoot) ? envRoot : resolve(envRoot)) : ''
}

const defaultStoreCatalogUrl = () => String(process.env.AIOPSTERM_EXTENSION_STORE_CATALOG_URL || '').trim()

export const defaultRemotePackageCacheDir = () => {
  const envRoot = String(process.env.AIOPSTERM_EXTENSION_PACKAGE_CACHE_DIR || '').trim()
  return envRoot ? (isAbsolute(envRoot) ? envRoot : resolve(envRoot)) : join(defaultExtensionRootDir(), 'cache')
}

const defaultExtensionFetch: ExtensionFetch = async (url, init) => {
  if (typeof fetch !== 'function') throw new Error('Fetch is not available in this runtime.')
  const response = await fetch(url, init)
  return response
}

const resolveOptionalPath = (value: unknown, fallback = '') => {
  const text = trimText(value)
  return text ? (isAbsolute(text) ? text : resolve(text)) : fallback
}

type RuntimeConfig = {
  extensionRootDir: string
  builtinPluginDir: string
  storePackageDir: string
  storeCatalogUrl: string
  remotePackageCacheDir: string
  appVersion: string
  fetch: ExtensionFetch
  saveAsset?: ExtensionBackendRuntimeConfig['saveAsset']
}

let runtimeConfig: RuntimeConfig = {
  extensionRootDir: defaultExtensionRootDir(),
  builtinPluginDir: '',
  storePackageDir: defaultStorePackageDir(),
  storeCatalogUrl: defaultStoreCatalogUrl(),
  remotePackageCacheDir: defaultRemotePackageCacheDir(),
  appVersion: '0.0.0',
  fetch: defaultExtensionFetch
}

let extensionCatalog: ExtensionPluginRuntimeConfig[] = []

const syncPackageRuntime = () => {
  configureExtensionPackageRuntime(packageRuntimeConfig())
}

const extensionRegistryPath = () => join(runtimeConfig.extensionRootDir, 'registry.json')

const ensureExtensionRoot = () => {
  mkdirSync(runtimeConfig.extensionRootDir, { recursive: true })
}

const normalizeLocalRegistryPlugins = (value: unknown): ExtensionPluginRuntimeConfig[] => {
  if (!Array.isArray(value)) return []
  const plugins: ExtensionPluginRuntimeConfig[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const pluginId = trimText(record.pluginId)
    const name = trimText(record.name)
    const installedVersion = trimText(record.installedVersion)
    const packagePath = trimText(record.packagePath)
    if (!pluginId || !name || !installedVersion || !packagePath) continue
    const catalogPlugin = extensionCatalog.find((plugin) => plugin.pluginId === pluginId)
    const source = trimText(record.source) === 'store' ? 'store' : 'local'
    const kind = record.kind === 'provider' ? 'provider' : record.kind === 'content' ? 'content' : null
    if (!kind) continue
    const isLocal = source === 'local'
    const categories = parseStringArray(record.categories)
    const functions = parseManifestFunctions(record.functions)
    const commands = parseManifestCommands({ contributes: { commands: record.commands } })
    const assetProviders = parseManifestAssetProviders({ contributes: { assetProviders: record.assetProviders } })
    const latestVersion =
      source === 'store'
        ? trimText(catalogPlugin?.latestVersion) || trimText(record.latestVersion) || installedVersion
        : trimText(record.latestVersion) || installedVersion
    const storePackagePath = trimText(catalogPlugin?.storePackagePath) || trimText(record.storePackagePath) || undefined
    const packageUrl = trimText(catalogPlugin?.packageUrl) || trimText(record.packageUrl) || undefined
    const packageSha256 = trimText(catalogPlugin?.packageSha256) || trimText(record.packageSha256) || undefined
    plugins.push({
      pluginId,
      name,
      description: trimText(record.description) || catalogPlugin?.description || 'Installed from an aiopsterm plugin package.',
      kind,
      iconKey: normalizeExtensionIconKey(record.iconKey || catalogPlugin?.iconKey),
      tabName: trimText(record.tabName) || name,
      show: record.show === false ? false : true,
      isPlugin: true,
      installed: true,
      hasUpdate: source === 'store' ? isVersionNewer(latestVersion, installedVersion) : false,
      installedVersion,
      latestVersion,
      installable: record.installable === false ? false : true,
      isDraggedOnly: isLocal,
      source,
      lastUpdated: trimText(record.lastUpdated) || trimText(record.installedAt),
      installedAt: trimText(record.installedAt),
      packagePath,
      storePackagePath,
      packageUrl,
      packageSha256,
      subscriptionUrl: trimText(record.subscriptionUrl || catalogPlugin?.subscriptionUrl) || undefined,
      size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : undefined,
      readme: trimText(record.readme) || catalogPlugin?.readme || '',
      categories: categories.length ? categories : catalogPlugin?.categories ? [...catalogPlugin.categories] : [isLocal ? 'Local' : 'Store'],
      functions: functions.length
        ? functions
        : catalogPlugin?.functions
          ? catalogPlugin.functions.map((catalogFunction) => ({ ...catalogFunction }))
          : [{ title: 'Installed plugin', desc: 'Installed from an aiopsterm plugin package through the backend boundary.' }],
      commands,
      assetProviders
    })
  }
  return plugins
}

// extensions:list 会反复触发目录重扫：store 包目录的 zip 解析按文件列表签名缓存，
// registry.json 按文件签名缓存原始内容；签名未变时直接复用，失效才重扫。
let storeCatalogCache: { signature: string; plugins: ExtensionPluginRuntimeConfig[] } | null = null
let localRegistryCache: { signature: string; plugins: unknown } | null = null

const invalidateExtensionSourceCaches = () => {
  storeCatalogCache = null
  localRegistryCache = null
}

const fileSignature = (filePath: string) => {
  try {
    const stats = statSync(filePath)
    return `${filePath}:${stats.mtimeMs}:${stats.size}`
  } catch {
    return `${filePath}:missing`
  }
}

const storePackageDirSignature = (rootDir: string) => {
  if (!rootDir) return 'store:none'
  return ['store', rootDir, ...walkStorePackageFiles(rootDir).map(fileSignature)].join('|')
}

const readLocalExtensionRegistry = (): ExtensionPluginRuntimeConfig[] => {
  const registryPath = extensionRegistryPath()
  const signature = fileSignature(registryPath)
  const cached = localRegistryCache
  // 归一化依赖当前 extensionCatalog（合并 store 端最新版本等），每次都要重新执行。
  if (cached && cached.signature === signature) return normalizeLocalRegistryPlugins(cached.plugins)
  let rawPlugins: unknown = []
  try {
    if (existsSync(registryPath)) {
      rawPlugins = (JSON.parse(readFileSync(registryPath, 'utf8')) as { plugins?: unknown }).plugins
    }
  } catch {
    rawPlugins = []
  }
  localRegistryCache = { signature, plugins: rawPlugins }
  return normalizeLocalRegistryPlugins(rawPlugins)
}

const readStoreExtensionCatalog = (): ExtensionPluginRuntimeConfig[] => {
  const rootDir = trimText(runtimeConfig.storePackageDir)
  const signature = storePackageDirSignature(rootDir)
  const cached = storeCatalogCache
  if (cached && cached.signature === signature) return cached.plugins
  const plugins = latestStorePluginsFromPackageDir(rootDir)
  storeCatalogCache = { signature, plugins }
  return plugins
}

const readBuiltinExtensionCatalog = (): ExtensionPluginRuntimeConfig[] => {
  const rootDir = trimText(runtimeConfig.builtinPluginDir)
  if (!rootDir || !existsSync(rootDir)) return []
  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return []
  }
  const plugins: ExtensionPluginRuntimeConfig[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const packagePath = join(rootDir, entry.name)
    const manifestPath = join(packagePath, 'aiopsterm.plugin.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RemoteExtensionCatalogPluginManifest
      const plugin = pluginFromAiopstermManifest(manifest, {
        source: 'builtin',
        packagePath,
        lastUpdated: new Date(statSync(manifestPath).mtimeMs).toISOString()
      })
      if (!('ok' in plugin)) plugins.push(plugin)
    } catch {}
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name))
}

const remoteCatalogPluginFromManifest = (
  manifest: RemoteExtensionCatalogPluginManifest,
  catalogUrl: string
): ExtensionPluginRuntimeConfig | null => {
  const packageSource = extractPackageManifestSource(manifest, catalogUrl)
  if (!packageSource.packageUrl) return null
  const packageSize = Number(manifest.size)
  const plugin = pluginFromAiopstermManifest(manifest, {
    source: 'store',
    packageSize: Number.isFinite(packageSize) && packageSize >= 0 ? packageSize : undefined,
    readme: trimText(manifest.readme) || undefined,
    lastUpdated: trimText(manifest.lastUpdated) || undefined
  })
  if ('ok' in plugin) return null
  plugin.packageUrl = packageSource.packageUrl
  plugin.packageSha256 = packageSource.packageSha256
  return plugin
}

const readRemoteExtensionCatalog = async (): Promise<ExtensionPluginRuntimeConfig[]> => {
  const catalogUrl = trimText(runtimeConfig.storeCatalogUrl)
  if (!catalogUrl) return []
  const normalizedCatalogUrl = normalizeAbsoluteHttpUrl(catalogUrl)
  if (!normalizedCatalogUrl) return []
  try {
    const response = await runtimeConfig.fetch(normalizedCatalogUrl)
    if (!response.ok) return []
    const text = response.text ? await response.text() : Buffer.from(await response.arrayBuffer()).toString('utf8')
    const parsed = JSON.parse(text) as RemoteExtensionCatalogManifest
    const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : []
    const latestByPlugin = new Map<string, ExtensionPluginRuntimeConfig>()
    for (const item of plugins) {
      const record = asRecord(item)
      if (!record) continue
      const plugin = remoteCatalogPluginFromManifest(record as RemoteExtensionCatalogPluginManifest, normalizedCatalogUrl)
      if (!plugin) continue
      const existing = latestByPlugin.get(plugin.pluginId)
      if (!existing || isVersionNewer(plugin.latestVersion || '', existing.latestVersion || '')) {
        latestByPlugin.set(plugin.pluginId, plugin)
      }
    }
    return [...latestByPlugin.values()].sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}

const writeLocalExtensionRegistry = () => {
  ensureExtensionRoot()
  const installedPlugins = extensionCatalog
    .filter((plugin) => (plugin.source === 'local' || plugin.source === 'store') && plugin.installed && plugin.packagePath)
    .map(clonePlugin)
  writeFileSync(extensionRegistryPath(), JSON.stringify({ plugins: installedPlugins }, null, 2), 'utf8')
  localRegistryCache = null
}

const persistLocalExtensionCatalogPlugin = (plugin: ExtensionPluginRuntimeConfig) => {
  if (plugin.source !== 'local' && plugin.source !== 'store') return
  writeLocalExtensionRegistry()
}

export const upsertExtensionCatalogPlugin = (plugin: ExtensionPluginRuntimeConfig, options: { persist?: boolean } = {}) => {
  const nextPlugin = clonePlugin(plugin)
  const index = extensionCatalog.findIndex((item) => item.pluginId === nextPlugin.pluginId)
  if (nextPlugin.source === 'local' && nextPlugin.show === false) {
    if (index >= 0) extensionCatalog.splice(index, 1)
    if (options.persist !== false) writeLocalExtensionRegistry()
    return
  }
  if (index >= 0) {
    extensionCatalog[index] = { ...extensionCatalog[index], ...nextPlugin }
    if (options.persist !== false) persistLocalExtensionCatalogPlugin(extensionCatalog[index])
    return
  }
  extensionCatalog.push(nextPlugin)
  if (options.persist !== false) persistLocalExtensionCatalogPlugin(nextPlugin)
}

const reloadExtensionCatalog = () => {
  extensionCatalog = readBuiltinExtensionCatalog()
  for (const plugin of readStoreExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of readLocalExtensionRegistry()) upsertExtensionCatalogPlugin(plugin, { persist: false })
}

const reloadExtensionCatalogFromSources = async () => {
  extensionCatalog = readBuiltinExtensionCatalog()
  for (const plugin of readStoreExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of await readRemoteExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of readLocalExtensionRegistry()) upsertExtensionCatalogPlugin(plugin, { persist: false })
}

export const configureExtensionBackendRuntimeState = (config: ExtensionBackendRuntimeConfig = {}) => {
  const extensionRootDir = resolveOptionalPath(config.extensionRootDir, defaultExtensionRootDir())
  const builtinPluginDir = resolveOptionalPath(config.builtinPluginDir)
  const storePackageDir = resolveOptionalPath(config.storePackageDir, defaultStorePackageDir())
  const storeCatalogUrl = trimText(config.storeCatalogUrl) || defaultStoreCatalogUrl()
  const remotePackageCacheDir = resolveOptionalPath(config.remotePackageCacheDir, join(extensionRootDir, 'cache'))
  runtimeConfig = {
    extensionRootDir,
    builtinPluginDir,
    storePackageDir,
    storeCatalogUrl,
    remotePackageCacheDir,
    appVersion: trimText(config.appVersion) || '0.0.0',
    saveAsset: config.saveAsset,
    fetch: config.fetch || defaultExtensionFetch
  }
  syncPackageRuntime()
  invalidateExtensionSourceCaches()
  reloadExtensionCatalog()
}

export const resetExtensionPluginCatalogState = () => {
  invalidateExtensionSourceCaches()
  reloadExtensionCatalog()
}

export const listExtensionPluginCatalog = async (): Promise<ExtensionPluginListResult> => {
  await reloadExtensionCatalogFromSources()
  return {
    ok: true,
    data: extensionCatalog.map(clonePlugin)
  }
}

export const resolveOperationPlugin = (plugin: ExtensionPluginRuntimeConfig) => {
  const incomingPlugin = clonePlugin(plugin)
  const catalogPlugin = extensionCatalog.find((item) => item.pluginId === incomingPlugin.pluginId)
  if (!catalogPlugin) return incomingPlugin
  const resolvedPlugin = clonePlugin(catalogPlugin)
  if (!resolvedPlugin.storePackagePath && incomingPlugin.storePackagePath) resolvedPlugin.storePackagePath = incomingPlugin.storePackagePath
  if (!resolvedPlugin.packageUrl && incomingPlugin.packageUrl) resolvedPlugin.packageUrl = incomingPlugin.packageUrl
  if (!resolvedPlugin.packageSha256 && incomingPlugin.packageSha256) resolvedPlugin.packageSha256 = incomingPlugin.packageSha256
  return resolvedPlugin
}

export const findExtensionCatalogPlugin = (pluginId: string) => extensionCatalog.find((plugin) => plugin.pluginId === pluginId)

export const saveExtensionProviderAsset = (input: Parameters<NonNullable<ExtensionBackendRuntimeConfig['saveAsset']>>[0]) =>
  runtimeConfig.saveAsset?.(input)

export const cloneExtensionCatalog = () => extensionCatalog.map(clonePlugin)

export const packageRuntimeConfig = (): ExtensionPackageRuntimeConfig => ({
  extensionRootDir: runtimeConfig.extensionRootDir,
  storePackageDir: runtimeConfig.storePackageDir,
  remotePackageCacheDir: runtimeConfig.remotePackageCacheDir,
  appVersion: runtimeConfig.appVersion,
  fetch: runtimeConfig.fetch
})

syncPackageRuntime()
