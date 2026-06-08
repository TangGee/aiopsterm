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

type ActiveExtensionOperation = {
  pluginId: string
  cancelled: boolean
}

const activeOperations = new Map<string, ActiveExtensionOperation>()

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

const upsertExtensionCatalogPlugin = (plugin: ExtensionPluginRuntimeConfig) => {
  const nextPlugin = clonePlugin(plugin)
  const index = extensionCatalog.findIndex((item) => item.pluginId === nextPlugin.pluginId)
  if (index >= 0) {
    extensionCatalog[index] = { ...extensionCatalog[index], ...nextPlugin }
    return
  }
  extensionCatalog.push(nextPlugin)
}

export const resetExtensionPluginCatalogForTests = () => {
  extensionCatalog = extensionCatalogSeed.map(clonePlugin)
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
    return [{ stage: 'installing' as const, percent: 100, message: 'Installing local package.' }]
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
    if (next.source === 'local' && !next.latestVersion) next.show = false
  }
  return next
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

const packageNameFromFile = (fileName: string) => fileName.replace(/\.external-reference$/i, '').replace(/[-_]+/g, ' ').trim()

const packagePluginId = (pluginName: string, existingPluginIds: string[] = []) => {
  const slug = pluginName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin'
  const baseId = `local-${slug}`
  let pluginId = baseId
  let index = 1
  while (existingPluginIds.includes(pluginId)) {
    pluginId = `${baseId}-${index++}`
  }
  return pluginId
}

const pluginFromPackage = (input: ExtensionPackageInstallInput): ExtensionPluginRuntimeConfig | ExtensionPluginOperationResult => {
  const fileName = trimText(input?.fileName)
  if (!fileName) return errorResult('EXTENSION_PACKAGE_REQUIRED', 'Plugin package file is required.')
  if (!fileName.toLowerCase().endsWith('.external-reference')) {
    return errorResult('EXTENSION_PACKAGE_FORMAT_INVALID', 'Plugin package must use the .external-reference extension.')
  }

  const pluginName = packageNameFromFile(fileName) || 'Local Plugin'
  return {
    pluginId: packagePluginId(pluginName, input.existingPluginIds || []),
    name: pluginName,
    description: 'Installed from a local .external-reference package.',
    iconKey: 'local',
    tabName: pluginName,
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    installable: true,
    isDraggedOnly: true,
    source: 'local',
    lastUpdated: 'Just now',
    size: input.size || 524288,
    readme: 'Local package installed through the aiopsterm backend plugin boundary.',
    categories: ['Local', 'Tools'],
    functions: [{ title: 'Local plugin', desc: 'Installed from a .external-reference package through the backend boundary.' }]
  }
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
  const plugin = pluginFromPackage(input)
  if ('ok' in plugin) return plugin
  return runExtensionPluginOperation('package', { plugin }, emit, options)
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
