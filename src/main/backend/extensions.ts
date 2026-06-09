import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { inflateRawSync } from 'zlib'
import type {
  ExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPluginListResult,
  ExtensionPackageInstallInput,
  ExtensionPluginOperation,
  ExtensionPluginOperationInput,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig,
  ExtensionPluginCancelResult,
  ExtensionSubscriptionInput,
  ExtensionSubscriptionResult
} from '@shared/preload'

export const EXTENSION_INSTALL_STEP_DELAY_MS = 120
export const EXTENSION_SUBSCRIPTION_URL = 'https://github.com/external-reference/External reference/discussions/1521'

type ExtensionProgressEmitter = (progress: ExtensionInstallProgress) => void

type ExtensionOperationOptions = {
  stepDelayMs?: number
}

type LocalExtensionPackageManifest = {
  id?: unknown
  name?: unknown
  displayName?: unknown
  version?: unknown
  description?: unknown
  main?: unknown
  categories?: unknown
  readme?: unknown
  functions?: unknown
  contributes?: {
    views?: unknown
  }
}

type LocalExtensionPackageConfig = {
  plugin: ExtensionPluginRuntimeConfig
  entries: LocalZipEntry[]
}

type LocalZipEntry = {
  entryName: string
  isDirectory: boolean
  getData: () => Buffer
}

type ExtensionBackendRuntimeConfig = {
  extensionRootDir?: string
}

type ActiveExtensionOperation = {
  pluginId: string
  cancelled: boolean
}

const activeOperations = new Map<string, ActiveExtensionOperation>()

const defaultExtensionRootDir = () => {
  const envRoot = String(process.env.AIOPSTERM_EXTENSIONS_DIR || '').trim()
  return envRoot ? (isAbsolute(envRoot) ? envRoot : resolve(envRoot)) : join(process.cwd(), '.aiopsterm-extensions')
}

let runtimeConfig: Required<ExtensionBackendRuntimeConfig> = {
  extensionRootDir: defaultExtensionRootDir()
}

const extensionCatalogSeed: ExtensionPluginRuntimeConfig[] = [
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
      { title: '连接日志', desc: '展示堡垒机、目标主机、认证阶段的连接进度。' }
    ],
    guideSteps: [
      '在资产管理中新增 Jumpserver 数据源。',
      '填写堡垒机地址、组织和认证信息。',
      '同步资产并确认主机分组。',
      '从终端或文件管理中选择资产直连。'
    ],
    connectionLog: [
      { time: '10:15:49', status: 'progress', message: 'connecting to bastion host' },
      { time: '10:15:50', status: 'success', message: 'connected to bastion host' },
      { time: '10:15:50', status: 'progress', message: 'connecting to target' },
      { time: '10:15:51', status: 'progress', message: 'authenticating' },
      { time: '10:15:51', status: 'success', message: 'connected to target' }
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
  },
  {
    pluginId: 'ops-runbook',
    name: 'Ops Runbook',
    description: '本地维护流程和技能模板。',
    iconKey: 'runbook',
    tabName: 'Ops Runbook',
    show: true,
    isPlugin: true,
    installed: true,
    hasUpdate: true,
    installedVersion: '1.2.0',
    latestVersion: '1.3.0',
    installable: true,
    source: 'store',
    lastUpdated: '2026-06-01',
    size: 1843200,
    readme: 'Ops Runbook 提供常用巡检、发布前检查和故障复盘模板，可在终端工作区中作为辅助流程打开。',
    categories: ['Tools', 'Runbook'],
    functions: [
      { title: '巡检模板', desc: '生成磁盘、负载、服务状态的检查清单。' },
      { title: '发布守卫', desc: '把发布前后验证步骤整理为可复用流程。' }
    ]
  },
  {
    pluginId: 'local-shell-tools',
    name: 'Local Shell Tools',
    description: '本地 shell 辅助工具集合。',
    iconKey: 'local',
    tabName: 'Local Shell Tools',
    show: true,
    isPlugin: true,
    installed: true,
    hasUpdate: false,
    installedVersion: '0.5.2',
    latestVersion: '',
    installable: true,
    source: 'local',
    lastUpdated: '2026-05-30',
    size: 702464,
    readme: '从本地 .external-reference 包安装的工具插件，当前不在插件商店内。',
    categories: ['Tools', 'Local'],
    functions: [{ title: '本地工具', desc: '提供路径检查、环境变量快照和日志定位入口。' }]
  },
  {
    pluginId: 'cloud-assets',
    name: 'Cloud Assets',
    description: '云资产发现和同步能力占位。',
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
    lastUpdated: '2026-05-28',
    size: 2310144,
    readme: 'Cloud Assets 用于同步云主机、标签和连接入口，安装后可在资产管理中启用。',
    categories: ['Cloud', 'Assets'],
    functions: [
      { title: '云资产同步', desc: '按账号和地域拉取云主机列表。' },
      { title: '标签映射', desc: '把云标签映射到本地资产分组。' }
    ]
  },
  {
    pluginId: 'private-automation-pack',
    name: 'Private Automation Pack',
    description: '私有自动化插件，需要订阅后安装。',
    iconKey: 'private',
    tabName: 'Private Automation Pack',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '2.0.0',
    installable: false,
    isPrivate: true,
    source: 'store',
    lastUpdated: '2026-05-20',
    size: 4194304,
    readme: '私有插件展示订阅入口；未订阅时不可直接安装。',
    categories: ['Private', 'Automation'],
    functions: [{ title: '订阅能力', desc: '开通后启用私有自动化任务模板。' }]
  }
]

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

const trimText = (value: unknown) => String(value || '').trim()

const clonePlugin = (plugin: ExtensionPluginRuntimeConfig): ExtensionPluginRuntimeConfig => ({
  ...plugin,
  categories: plugin.categories ? [...plugin.categories] : undefined,
  functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
  guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
  connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined
})

let extensionCatalog = extensionCatalogSeed.map(clonePlugin)

const extensionRegistryPath = () => join(runtimeConfig.extensionRootDir, 'registry.json')

const installedExtensionDir = (pluginId: string, version: string) => join(runtimeConfig.extensionRootDir, 'installed', pluginId, version)

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
    plugins.push({
      pluginId,
      name,
      description: trimText(record.description) || 'Installed from a local .external-reference package.',
      iconKey: 'local',
      tabName: trimText(record.tabName) || name,
      show: true,
      isPlugin: true,
      installed: true,
      hasUpdate: false,
      installedVersion,
      latestVersion: trimText(record.latestVersion) || installedVersion,
      installable: true,
      isDraggedOnly: true,
      source: 'local',
      lastUpdated: trimText(record.lastUpdated) || trimText(record.installedAt),
      installedAt: trimText(record.installedAt),
      packagePath,
      size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : undefined,
      readme: trimText(record.readme),
      categories: parseStringArray(record.categories),
      functions: parseManifestFunctions(record.functions)
    })
  }
  return plugins
}

const readLocalExtensionRegistry = (): ExtensionPluginRuntimeConfig[] => {
  try {
    const registryPath = extensionRegistryPath()
    if (!existsSync(registryPath)) return []
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as { plugins?: unknown }
    return normalizeLocalRegistryPlugins(parsed.plugins)
  } catch {
    return []
  }
}

const writeLocalExtensionRegistry = () => {
  ensureExtensionRoot()
  const localPlugins = extensionCatalog
    .filter((plugin) => plugin.source === 'local' && plugin.installed && plugin.packagePath)
    .map(clonePlugin)
  writeFileSync(extensionRegistryPath(), JSON.stringify({ plugins: localPlugins }, null, 2), 'utf8')
}

const persistLocalExtensionCatalogPlugin = (plugin: ExtensionPluginRuntimeConfig) => {
  if (plugin.source !== 'local') return
  writeLocalExtensionRegistry()
}

const upsertExtensionCatalogPlugin = (plugin: ExtensionPluginRuntimeConfig, options: { persist?: boolean } = {}) => {
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
  extensionCatalog = extensionCatalogSeed.map(clonePlugin)
  for (const plugin of readLocalExtensionRegistry()) upsertExtensionCatalogPlugin(plugin, { persist: false })
}

export const configureExtensionBackendRuntime = (config: ExtensionBackendRuntimeConfig = {}) => {
  const extensionRootDir = trimText(config.extensionRootDir)
  runtimeConfig = {
    extensionRootDir: extensionRootDir ? (isAbsolute(extensionRootDir) ? extensionRootDir : resolve(extensionRootDir)) : defaultExtensionRootDir()
  }
  reloadExtensionCatalog()
}

export const resetExtensionPluginCatalogForTests = () => {
  reloadExtensionCatalog()
  activeOperations.clear()
}

export const listExtensionPlugins = async (): Promise<ExtensionPluginListResult> => ({
  ok: true,
  data: extensionCatalog.map(clonePlugin)
})

const errorResult = (errorCode: string, errorMessage: string): ExtensionPluginOperationResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const successResult = (
  operation: ExtensionPluginOperation,
  plugin: ExtensionPluginRuntimeConfig,
  message: string
): ExtensionPluginOperationResult => ({
  ok: true,
  data: {
    operation,
    plugin: clonePlugin(plugin),
    message
  }
})

const emitProgress = (
  emit: ExtensionProgressEmitter | undefined,
  pluginId: string,
  operation: ExtensionPluginOperation,
  stage: ExtensionInstallStage,
  percent: number,
  message?: string
) => {
  if (!emit || !stage) return
  emit({
    pluginId,
    operation,
    stage,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    message
  })
}

const validatePluginOperation = (operation: ExtensionPluginOperation, plugin: ExtensionPluginRuntimeConfig): ExtensionPluginOperationResult | null => {
  if (!trimText(plugin.pluginId)) return errorResult('EXTENSION_PLUGIN_ID_REQUIRED', 'Plugin id is required.')
  if (!trimText(plugin.name)) return errorResult('EXTENSION_PLUGIN_NAME_REQUIRED', 'Plugin name is required.')
  if (!plugin.isPlugin) return errorResult('EXTENSION_PLUGIN_SYSTEM_ITEM', 'System extension entries cannot be installed as plugins.')
  if (plugin.required && operation === 'uninstall') return errorResult('EXTENSION_PLUGIN_REQUIRED', 'Required plugins cannot be uninstalled.')
  if (operation === 'install' && plugin.installable === false) return errorResult('EXTENSION_PLUGIN_NOT_INSTALLABLE', 'Plugin is not installable.')
  if (operation === 'update' && (!plugin.installed || !plugin.hasUpdate)) {
    return errorResult('EXTENSION_PLUGIN_UPDATE_UNAVAILABLE', 'Plugin has no available update.')
  }
  return null
}

const subscriptionErrorResult = (errorCode: string, errorMessage: string): ExtensionSubscriptionResult => ({
  ok: false,
  errorCode,
  errorMessage
})

export const openExtensionSubscription = async (
  input: ExtensionSubscriptionInput,
  openExternal?: (url: string) => Promise<void> | void
): Promise<ExtensionSubscriptionResult> => {
  const plugin = input?.plugin ? clonePlugin(input.plugin) : null
  if (!plugin) return subscriptionErrorResult('EXTENSION_PLUGIN_REQUIRED', 'Plugin payload is required.')
  if (!trimText(plugin.pluginId)) return subscriptionErrorResult('EXTENSION_PLUGIN_ID_REQUIRED', 'Plugin id is required.')
  if (!trimText(plugin.name)) return subscriptionErrorResult('EXTENSION_PLUGIN_NAME_REQUIRED', 'Plugin name is required.')
  if (!plugin.isPlugin) return subscriptionErrorResult('EXTENSION_PLUGIN_SYSTEM_ITEM', 'System extension entries cannot open plugin subscriptions.')
  if (plugin.installed) return subscriptionErrorResult('EXTENSION_PLUGIN_ALREADY_INSTALLED', 'Installed plugins do not need a subscription entry.')
  if (plugin.installable !== false && !plugin.isPrivate) {
    return subscriptionErrorResult('EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE', 'Plugin does not require a subscription.')
  }

  try {
    await openExternal?.(EXTENSION_SUBSCRIPTION_URL)
  } catch (error) {
    return subscriptionErrorResult(
      'EXTENSION_SUBSCRIPTION_OPEN_FAILED',
      error instanceof Error ? error.message : 'Subscription entry could not be opened.'
    )
  }

  return {
    ok: true,
    data: {
      pluginId: plugin.pluginId,
      url: EXTENSION_SUBSCRIPTION_URL,
      message: `${plugin.name} subscription entry opened by aiopsterm backend.`
    }
  }
}

const operationSteps = (operation: ExtensionPluginOperation) => {
  if (operation === 'package') {
    return [
      { stage: 'verifying' as const, percent: 100, message: 'Verified local package manifest.' },
      { stage: 'installing' as const, percent: 100, message: 'Installing local package.' }
    ]
  }
  return [
    { stage: 'downloading' as const, percent: 8, message: operation === 'install' ? 'Downloading plugin package.' : 'Downloading plugin update.' },
    { stage: 'downloading' as const, percent: 42, message: 'Downloading plugin package.' },
    { stage: 'downloading' as const, percent: 84, message: 'Downloading plugin package.' },
    { stage: 'verifying' as const, percent: 100, message: 'Verifying package signature.' },
    { stage: 'installing' as const, percent: 100, message: 'Installing plugin.' }
  ]
}

const applyOperation = (operation: ExtensionPluginOperation, plugin: ExtensionPluginRuntimeConfig) => {
  const next = clonePlugin(plugin)
  if (operation === 'install' || operation === 'package') {
    next.installed = true
    next.hasUpdate = false
    next.installedVersion = next.latestVersion || next.installedVersion || '1.0.0'
    next.source = next.source || (operation === 'package' ? 'local' : 'store')
    next.show = true
  }
  if (operation === 'update') {
    next.installed = true
    next.hasUpdate = false
    next.installedVersion = next.latestVersion || next.installedVersion || '1.0.0'
  }
  if (operation === 'uninstall') {
    next.installed = false
    next.installedVersion = ''
    next.hasUpdate = false
    if (next.source === 'local') next.show = false
  }
  return next
}

const localPackageErrorResult = (errorCode: string, errorMessage: string): ExtensionPluginOperationResult => ({
  ok: false,
  errorCode,
  errorMessage
})

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const normalizePackageEntryName = (value: string) => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return ''
  if (normalized.split('/').some((part) => !part || part === '..')) return ''
  return normalized
}

const readUInt32LE = (buffer: Buffer, offset: number) => {
  if (offset + 4 > buffer.length) return -1
  return buffer.readUInt32LE(offset)
}

const readUInt16LE = (buffer: Buffer, offset: number) => {
  if (offset + 2 > buffer.length) return -1
  return buffer.readUInt16LE(offset)
}

const parseLocalZipEntries = (buffer: Buffer): LocalZipEntry[] => {
  const entries: LocalZipEntry[] = []
  let endOffset = -1
  const searchStart = Math.max(0, buffer.length - 0xffff - 22)
  for (let index = buffer.length - 22; index >= searchStart; index--) {
    if (readUInt32LE(buffer, index) === 0x06054b50) {
      endOffset = index
      break
    }
  }
  if (endOffset < 0) throw new Error('Invalid ZIP package.')

  const entryCount = readUInt16LE(buffer, endOffset + 10)
  const centralDirectoryOffset = readUInt32LE(buffer, endOffset + 16)
  if (entryCount < 0 || centralDirectoryOffset < 0 || centralDirectoryOffset >= buffer.length) {
    throw new Error('Invalid ZIP central directory.')
  }

  let cursor = centralDirectoryOffset
  for (let index = 0; index < entryCount; index++) {
    if (readUInt32LE(buffer, cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry.')
    const method = readUInt16LE(buffer, cursor + 10)
    const compressedSize = readUInt32LE(buffer, cursor + 20)
    const uncompressedSize = readUInt32LE(buffer, cursor + 24)
    const fileNameLength = readUInt16LE(buffer, cursor + 28)
    const extraLength = readUInt16LE(buffer, cursor + 30)
    const commentLength = readUInt16LE(buffer, cursor + 32)
    const localHeaderOffset = readUInt32LE(buffer, cursor + 42)
    if ([method, compressedSize, uncompressedSize, fileNameLength, extraLength, commentLength, localHeaderOffset].some((value) => value < 0)) {
      throw new Error('Invalid ZIP entry header.')
    }

    const nameStart = cursor + 46
    const nameEnd = nameStart + fileNameLength
    if (nameEnd > buffer.length) throw new Error('Invalid ZIP entry name.')
    const entryName = buffer.slice(nameStart, nameEnd).toString('utf8')

    if (readUInt32LE(buffer, localHeaderOffset) !== 0x04034b50) throw new Error('Invalid ZIP local file header.')
    const localNameLength = readUInt16LE(buffer, localHeaderOffset + 26)
    const localExtraLength = readUInt16LE(buffer, localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataStart < 0 || dataEnd > buffer.length) throw new Error('Invalid ZIP entry data.')
    const compressedData = buffer.slice(dataStart, dataEnd)
    const isDirectory = entryName.endsWith('/')

    entries.push({
      entryName,
      isDirectory,
      getData: () => {
        if (isDirectory) return Buffer.alloc(0)
        if (method === 0) return Buffer.from(compressedData)
        if (method === 8) return inflateRawSync(compressedData)
        throw new Error(`Unsupported ZIP compression method ${method}.`)
      }
    })

    cursor = nameEnd + extraLength + commentLength
  }

  return entries
}

const findZipEntry = (zipEntries: LocalZipEntry[], entryName: string) => {
  const normalizedEntryName = normalizePackageEntryName(entryName)
  if (!normalizedEntryName) return null
  return zipEntries.find((entry) => !entry.isDirectory && entry.entryName.replace(/\\/g, '/') === normalizedEntryName) || null
}

const findReadmeZipEntry = (zipEntries: LocalZipEntry[], manifest: LocalExtensionPackageManifest) => {
  const manifestReadme = trimText(manifest.readme)
  if (manifestReadme) {
    const entry = findZipEntry(zipEntries, manifestReadme)
    if (entry) return entry
  }
  return (
    zipEntries.find((entry) => !entry.isDirectory && entry.entryName.replace(/\\/g, '/').toLowerCase() === 'readme.md') || null
  )
}

const readZipEntryText = (entry: { getData: () => Buffer }) => entry.getData().toString('utf8')

const safePackagePathSegment = (value: string) => {
  const segment = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return !segment || segment === '.' || segment === '..' ? 'plugin' : segment
}

const isPathInside = (rootDir: string, targetPath: string) => {
  const root = resolve(rootDir)
  const target = resolve(targetPath)
  return target === root || target.startsWith(`${root}${sep}`)
}

const extractLocalPackageEntries = (entries: LocalZipEntry[], targetDir: string) => {
  const resolvedTargetDir = resolve(targetDir)
  rmSync(resolvedTargetDir, { recursive: true, force: true })
  mkdirSync(resolvedTargetDir, { recursive: true })

  for (const entry of entries) {
    const normalizedName = normalizePackageEntryName(entry.entryName)
    if (!normalizedName) {
      if (entry.isDirectory) continue
      throw new Error(`Invalid package entry path "${entry.entryName}".`)
    }
    if (entry.isDirectory) {
      const targetPath = resolve(resolvedTargetDir, normalizedName)
      if (!isPathInside(resolvedTargetDir, targetPath)) throw new Error(`Invalid package entry path "${entry.entryName}".`)
      mkdirSync(targetPath, { recursive: true })
      continue
    }
    const targetPath = resolve(resolvedTargetDir, normalizedName)
    if (!isPathInside(resolvedTargetDir, targetPath)) throw new Error(`Invalid package entry path "${entry.entryName}".`)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, entry.getData())
  }
}

const installLocalPackageToDisk = (packageConfig: LocalExtensionPackageConfig): ExtensionPluginRuntimeConfig | ExtensionPluginOperationResult => {
  const version = packageConfig.plugin.latestVersion || packageConfig.plugin.installedVersion || '1.0.0'
  const targetDir = installedExtensionDir(safePackagePathSegment(packageConfig.plugin.pluginId), safePackagePathSegment(version))
  try {
    extractLocalPackageEntries(packageConfig.entries, targetDir)
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_INSTALL_FAILED',
      error instanceof Error ? error.message : 'Plugin package could not be installed.'
    )
  }
  const installedAt = new Date().toISOString()
  return {
    ...packageConfig.plugin,
    packagePath: targetDir,
    installedAt,
    lastUpdated: installedAt
  }
}

const removeInstalledLocalPackageFiles = (plugin: ExtensionPluginRuntimeConfig) => {
  const packagePath = trimText(plugin.packagePath)
  if (!packagePath) return
  const installedRoot = join(runtimeConfig.extensionRootDir, 'installed')
  if (!isPathInside(installedRoot, packagePath)) return
  rmSync(packagePath, { recursive: true, force: true })
}

const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const normalized = value.map(trimText).filter(Boolean)
  return [...new Set(normalized)]
}

const parseManifestFunctions = (value: unknown): Array<{ title: string; desc: string }> => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const itemRecord = asRecord(item)
      if (!itemRecord) {
        const title = trimText(item)
        return title ? { title, desc: '' } : null
      }
      const title = trimText(itemRecord.title || itemRecord.name)
      const desc = trimText(itemRecord.desc || itemRecord.description)
      return title ? { title, desc } : null
    })
    .filter((item): item is { title: string; desc: string } => Boolean(item))
}

const parseFirstContributedViewName = (manifest: LocalExtensionPackageManifest) => {
  const contributes = asRecord(manifest.contributes)
  const views = contributes ? contributes.views : undefined
  if (!Array.isArray(views)) return ''
  const firstView = views.map(asRecord).find(Boolean)
  if (!firstView) return ''
  return trimText(firstView.name || firstView.id)
}

const parseLocalPackageManifest = (
  input: ExtensionPackageInstallInput
): LocalExtensionPackageConfig | ExtensionPluginOperationResult => {
  const fileName = trimText(input?.fileName)
  if (!fileName) return localPackageErrorResult('EXTENSION_PACKAGE_REQUIRED', 'Plugin package file is required.')
  if (!fileName.toLowerCase().endsWith('.external-reference')) {
    return localPackageErrorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  const filePath = trimText(input?.filePath)
  if (!filePath) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_REQUIRED', 'Plugin package file path is required.')
  if (!isAbsolute(filePath)) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_INVALID', 'Plugin package file path must be absolute.')
  if (!basename(filePath).toLowerCase().endsWith('.external-reference')) {
    return localPackageErrorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  let packageSize = 0
  try {
    const fileStat = statSync(filePath)
    if (!fileStat.isFile()) return localPackageErrorResult('EXTENSION_PACKAGE_PATH_INVALID', 'Plugin package path must point to a file.')
    packageSize = fileStat.size
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_READ_FAILED',
      error instanceof Error ? error.message : 'Plugin package file could not be read.'
    )
  }

  let zipEntries: LocalZipEntry[]
  try {
    zipEntries = parseLocalZipEntries(readFileSync(filePath))
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_READ_FAILED',
      error instanceof Error ? error.message : 'Plugin package file could not be opened.'
    )
  }

  const manifestEntry = findZipEntry(zipEntries, 'plugin.json')
  if (!manifestEntry) {
    return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_MISSING', 'Plugin package must contain plugin.json.')
  }

  let manifest: LocalExtensionPackageManifest
  try {
    const parsed = JSON.parse(readZipEntryText(manifestEntry))
    const manifestRecord = asRecord(parsed)
    if (!manifestRecord) {
      return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must be a JSON object.')
    }
    manifest = manifestRecord as LocalExtensionPackageManifest
  } catch (error) {
    return localPackageErrorResult(
      'EXTENSION_PACKAGE_MANIFEST_INVALID',
      error instanceof Error ? error.message : 'plugin.json could not be parsed.'
    )
  }

  const pluginId = trimText(manifest.id)
  const version = trimText(manifest.version)
  const mainEntryName = normalizePackageEntryName(trimText(manifest.main))
  if (!pluginId) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include an id.')
  if (!version) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include a version.')
  if (!mainEntryName) return localPackageErrorResult('EXTENSION_PACKAGE_MANIFEST_INVALID', 'plugin.json must include a valid main entry.')
  if (!findZipEntry(zipEntries, mainEntryName)) {
    return localPackageErrorResult('EXTENSION_PACKAGE_MAIN_MISSING', `Plugin package main entry "${mainEntryName}" was not found.`)
  }

  const existingPlugin = extensionCatalog.find((plugin) => plugin.pluginId === pluginId)
  if (existingPlugin && existingPlugin.source !== 'local') {
    return localPackageErrorResult('EXTENSION_PACKAGE_PLUGIN_CONFLICT', 'Plugin package id conflicts with an existing non-local extension.')
  }

  const displayName = trimText(manifest.displayName) || trimText(manifest.name) || pluginId
  const viewName = parseFirstContributedViewName(manifest)
  const categories = parseStringArray(manifest.categories)
  const functions = parseManifestFunctions(manifest.functions)
  const readmeEntry = findReadmeZipEntry(zipEntries, manifest)
  const readme = readmeEntry ? readZipEntryText(readmeEntry) : 'Local package installed through the aiopsterm backend plugin boundary.'

  return {
    entries: zipEntries,
    plugin: {
      pluginId,
      name: displayName,
      description: trimText(manifest.description) || 'Installed from a local .external-reference package.',
      iconKey: 'local',
      tabName: viewName || displayName,
      show: true,
      isPlugin: true,
      installed: false,
      hasUpdate: false,
      installedVersion: '',
      latestVersion: version,
      installable: true,
      isDraggedOnly: true,
      source: 'local',
      lastUpdated: new Date().toISOString(),
      size: packageSize,
      readme,
      categories: categories.length ? categories : ['Local'],
      functions: functions.length ? functions : [{ title: 'Local plugin', desc: 'Installed from a .external-reference package through the backend boundary.' }]
    }
  }
}

export const runExtensionPluginOperation = async (
  operation: ExtensionPluginOperation,
  input: ExtensionPluginOperationInput,
  emit?: ExtensionProgressEmitter,
  options: ExtensionOperationOptions = {}
): Promise<ExtensionPluginOperationResult> => {
  const plugin = input?.plugin ? clonePlugin(input.plugin) : null
  if (!plugin) return errorResult('EXTENSION_PLUGIN_REQUIRED', 'Plugin payload is required.')

  const validation = validatePluginOperation(operation, plugin)
  if (validation) return validation

  if (operation === 'uninstall') {
    if (plugin.source === 'local') removeInstalledLocalPackageFiles(plugin)
    const next = applyOperation(operation, plugin)
    upsertExtensionCatalogPlugin(next)
    return successResult(operation, next, `${plugin.name} uninstalled by aiopsterm backend.`)
  }

  const pluginId = plugin.pluginId
  if (activeOperations.has(pluginId)) {
    return errorResult('EXTENSION_PLUGIN_OPERATION_BUSY', 'Plugin operation is already running.')
  }

  const activeOperation = { pluginId, cancelled: false }
  activeOperations.set(pluginId, activeOperation)
  const stepDelayMs = Math.max(0, options.stepDelayMs ?? EXTENSION_INSTALL_STEP_DELAY_MS)

  const cancelledResult = (): ExtensionPluginOperationResult => {
    emitProgress(emit, pluginId, operation, 'cancelled', 0, 'Plugin operation cancelled.')
    activeOperations.delete(pluginId)
    return {
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    }
  }

  for (const step of operationSteps(operation)) {
    if (activeOperation.cancelled) return cancelledResult()
    emitProgress(emit, pluginId, operation, step.stage, step.percent, step.message)
    if (stepDelayMs > 0) await wait(stepDelayMs)
  }

  if (activeOperation.cancelled) return cancelledResult()

  const next = applyOperation(operation, plugin)
  upsertExtensionCatalogPlugin(next)
  emitProgress(emit, pluginId, operation, 'done', 100, `${next.name} operation completed.`)
  activeOperations.delete(pluginId)
  const verb = operation === 'update' ? 'updated' : 'installed'
  return successResult(operation, next, `${next.name} ${verb} by aiopsterm backend.`)
}

export const installExtensionPlugin = (
  input: ExtensionPluginOperationInput,
  emit?: ExtensionProgressEmitter,
  options?: ExtensionOperationOptions
) => runExtensionPluginOperation('install', input, emit, options)

export const updateExtensionPlugin = (
  input: ExtensionPluginOperationInput,
  emit?: ExtensionProgressEmitter,
  options?: ExtensionOperationOptions
) => runExtensionPluginOperation('update', input, emit, options)

export const uninstallExtensionPlugin = (input: ExtensionPluginOperationInput) => runExtensionPluginOperation('uninstall', input)

export const installExtensionPackage = async (
  input: ExtensionPackageInstallInput,
  emit?: ExtensionProgressEmitter,
  options?: ExtensionOperationOptions
): Promise<ExtensionPluginOperationResult> => {
  const packageConfig = parseLocalPackageManifest(input)
  if ('ok' in packageConfig) return packageConfig

  const pluginId = packageConfig.plugin.pluginId
  if (activeOperations.has(pluginId)) {
    return errorResult('EXTENSION_PLUGIN_OPERATION_BUSY', 'Plugin operation is already running.')
  }

  const activeOperation = { pluginId, cancelled: false }
  activeOperations.set(pluginId, activeOperation)
  const stepDelayMs = Math.max(0, options?.stepDelayMs ?? EXTENSION_INSTALL_STEP_DELAY_MS)
  const cancelledResult = (): ExtensionPluginOperationResult => {
    emitProgress(emit, pluginId, 'package', 'cancelled', 0, 'Plugin operation cancelled.')
    activeOperations.delete(pluginId)
    return {
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    }
  }

  emitProgress(emit, pluginId, 'package', 'verifying', 100, 'Verified local package manifest.')
  if (stepDelayMs > 0) await wait(stepDelayMs)
  if (activeOperation.cancelled) return cancelledResult()

  emitProgress(emit, pluginId, 'package', 'installing', 100, 'Installing local package.')
  const installedPlugin = installLocalPackageToDisk(packageConfig)
  if ('ok' in installedPlugin) {
    activeOperations.delete(pluginId)
    emitProgress(emit, pluginId, 'package', 'error', 0, installedPlugin.errorMessage)
    return installedPlugin
  }
  if (stepDelayMs > 0) await wait(stepDelayMs)
  if (activeOperation.cancelled) return cancelledResult()

  const next = applyOperation('package', installedPlugin)
  upsertExtensionCatalogPlugin(next)
  emitProgress(emit, pluginId, 'package', 'done', 100, `${next.name} operation completed.`)
  activeOperations.delete(pluginId)
  return successResult('package', next, `${next.name} installed by aiopsterm backend.`)
}

export const cancelExtensionInstall = (pluginId: string): ExtensionPluginCancelResult => {
  const normalizedPluginId = trimText(pluginId)
  if (!normalizedPluginId) {
    return {
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_ID_REQUIRED',
      errorMessage: 'Plugin id is required.'
    }
  }

  const activeOperation = activeOperations.get(normalizedPluginId)
  if (activeOperation) activeOperation.cancelled = true

  return {
    ok: true,
    data: {
      pluginId: normalizedPluginId,
      stage: 'cancelled',
      percent: 0,
      message: activeOperation ? 'Plugin operation cancellation requested.' : 'No active plugin operation.'
    }
  }
}
