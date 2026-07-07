import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
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
  parseFirstContributedViewName,
  parseManifestFunctions,
  parseStringArray,
  trimText,
  type ExtensionBackendRuntimeConfig,
  type ExtensionFetch,
  type ExtensionPackageRuntimeConfig,
  type RemoteExtensionCatalogManifest,
  type RemoteExtensionCatalogPluginManifest
} from './extensionsRuntimeCore'
import { configureExtensionPackageRuntime, latestStorePluginsFromPackageDir, walkStorePackageFiles } from './extensionsPackageRuntime'

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

type RuntimeConfig = Required<ExtensionBackendRuntimeConfig>

let runtimeConfig: RuntimeConfig = {
  extensionRootDir: defaultExtensionRootDir(),
  storePackageDir: defaultStorePackageDir(),
  storeCatalogUrl: defaultStoreCatalogUrl(),
  remotePackageCacheDir: defaultRemotePackageCacheDir(),
  fetch: defaultExtensionFetch
}

const builtinExtensionCatalog: ExtensionPluginRuntimeConfig[] = [
  {
    pluginId: 'jumpserverSupport',
    name: 'Jumpserver Support',
    description: '支持资产同步与资产直连',
    iconKey: 'jumpserver',
    tabName: 'jumpserverSupport',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['SSH', 'Tools'],
    detailSummary: '支持资产同步与资产直连，保留堡垒机连接、目标资产连接、认证和代理阶段的运行状态。',
    functions: [
      { title: '资产同步', desc: '从堡垒机同步组织、主机和账号信息。' },
      { title: '资产直连', desc: '在终端中选择同步资产后直接建立 SSH 会话。' },
      { title: '认证联动', desc: '保留 Jumpserver 会话认证、审计和代理链路状态。' },
      { title: '同步状态', desc: '展示后端资产同步数量、数据源和已同步主机状态。' }
    ],
    guideSteps: [
      '在资产管理中新增 Jumpserver 数据源。',
      '填写堡垒机地址、组织和认证信息。',
      '同步资产并确认主机分组。',
      '从终端或文件管理中选择资产直连。'
    ]
  },
  {
    pluginId: 'Alias',
    name: 'Alias',
    description: '全局Alias配置',
    iconKey: 'alias',
    tabName: 'aliasConfig',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['Tools']
  }
]

let extensionCatalog = builtinExtensionCatalog.map(clonePlugin)

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
    const isLocal = source === 'local'
    const categories = parseStringArray(record.categories)
    const functions = parseManifestFunctions(record.functions)
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
      description: trimText(record.description) || catalogPlugin?.description || 'Installed from a .external-reference package.',
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
          : [{ title: 'Installed plugin', desc: 'Installed from a .external-reference package through the backend boundary.' }]
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

const remoteCatalogPluginFromManifest = (
  manifest: RemoteExtensionCatalogPluginManifest,
  catalogUrl: string
): ExtensionPluginRuntimeConfig | null => {
  const pluginId = trimText(manifest.id)
  const version = trimText(manifest.version)
  const displayName = trimText(manifest.displayName) || trimText(manifest.name) || pluginId
  if (!pluginId || !version || !displayName) return null
  const packageSource = extractPackageManifestSource(manifest, catalogUrl)
  if (!packageSource.packageUrl) return null
  const categories = parseStringArray(manifest.categories)
  const functions = parseManifestFunctions(manifest.functions)
  const storeFlags = extractStoreManifestFlags(manifest)
  const viewName = parseFirstContributedViewName(manifest)
  const packageSize = Number(manifest.size)
  return {
    pluginId,
    name: displayName,
    description: trimText(manifest.description) || 'Available from a remote aiopsterm extension catalog.',
    iconKey: normalizeExtensionIconKey(manifest.iconKey),
    tabName: viewName || displayName,
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: version,
    installable: storeFlags.installable,
    isPrivate: storeFlags.isPrivate,
    source: 'store',
    lastUpdated: trimText(manifest.lastUpdated) || undefined,
    size: Number.isFinite(packageSize) && packageSize >= 0 ? packageSize : undefined,
    readme: trimText(manifest.readme) || `${displayName} is available from a remote aiopsterm extension catalog.`,
    categories: categories.length ? categories : ['Store'],
    functions: functions.length ? functions : [{ title: 'Remote store plugin', desc: 'Available from a real remote .external-reference package catalog.' }],
    packageUrl: packageSource.packageUrl,
    packageSha256: packageSource.packageSha256 || undefined,
    subscriptionUrl: storeFlags.subscriptionUrl || undefined
  }
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
  extensionCatalog = builtinExtensionCatalog.map(clonePlugin)
  for (const plugin of readStoreExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of readLocalExtensionRegistry()) upsertExtensionCatalogPlugin(plugin, { persist: false })
}

const reloadExtensionCatalogFromSources = async () => {
  extensionCatalog = builtinExtensionCatalog.map(clonePlugin)
  for (const plugin of readStoreExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of await readRemoteExtensionCatalog()) upsertExtensionCatalogPlugin(plugin, { persist: false })
  for (const plugin of readLocalExtensionRegistry()) upsertExtensionCatalogPlugin(plugin, { persist: false })
}

export const configureExtensionBackendRuntimeState = (config: ExtensionBackendRuntimeConfig = {}) => {
  const extensionRootDir = resolveOptionalPath(config.extensionRootDir, defaultExtensionRootDir())
  const storePackageDir = resolveOptionalPath(config.storePackageDir, defaultStorePackageDir())
  const storeCatalogUrl = trimText(config.storeCatalogUrl) || defaultStoreCatalogUrl()
  const remotePackageCacheDir = resolveOptionalPath(config.remotePackageCacheDir, join(extensionRootDir, 'cache'))
  runtimeConfig = {
    extensionRootDir,
    storePackageDir,
    storeCatalogUrl,
    remotePackageCacheDir,
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

export const cloneExtensionCatalog = () => extensionCatalog.map(clonePlugin)

export const packageRuntimeConfig = (): ExtensionPackageRuntimeConfig => ({
  extensionRootDir: runtimeConfig.extensionRootDir,
  storePackageDir: runtimeConfig.storePackageDir,
  remotePackageCacheDir: runtimeConfig.remotePackageCacheDir,
  fetch: runtimeConfig.fetch
})

syncPackageRuntime()
