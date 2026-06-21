import type {
  ExtensionPackageDownloadInput,
  ExtensionPackageDownloadResult,
  ExtensionPackageInstallInput,
  ExtensionPluginCancelResult,
  ExtensionPluginListResult,
  ExtensionPluginOperation,
  ExtensionPluginOperationInput,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig,
  ExtensionPluginUrlInstallInput,
  ExtensionSubscriptionInput,
  ExtensionSubscriptionResult
} from '@shared/contracts/extensions'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'
import {
  clonePlugin,
  emitExtensionProgress,
  extensionPluginOperationError,
  normalizeAbsoluteHttpUrl,
  normalizeSha256,
  trimText,
  wait,
  type ExtensionBackendRuntimeConfig,
  type ExtensionOperationOptions,
  type ExtensionProgressEmitter
} from './extensionsRuntimeCore'
import {
  configureExtensionBackendRuntimeState,
  findExtensionCatalogPlugin,
  listExtensionPluginCatalog,
  resetExtensionPluginCatalogState,
  resolveOperationPlugin,
  upsertExtensionCatalogPlugin
} from './extensionsCatalogRuntime'
import {
  downloadStorePackage,
  fetchExtensionPackageBuffer,
  installLocalPackageToDisk,
  parseLocalPackageManifest,
  parsePackageManifestFromInput,
  removeInstalledExtensionPackageFiles,
  resolveStorePackageInput
} from './extensionsPackageRuntime'

export const EXTENSION_INSTALL_STEP_DELAY_MS = 120

type ActiveExtensionOperation = {
  pluginId: string
  cancelled: boolean
  abortController?: AbortController
}

const activeOperations = new Map<string, ActiveExtensionOperation>()

export const configureExtensionBackendRuntime = (config: ExtensionBackendRuntimeConfig = {}) => {
  configureExtensionBackendRuntimeState(config)
}

export const resetExtensionPluginCatalogForTests = () => {
  resetExtensionPluginCatalogState()
  activeOperations.clear()
}

export const listExtensionPlugins = async (): Promise<ExtensionPluginListResult> => listExtensionPluginCatalog()

const errorResult = extensionPluginOperationError

const downloadErrorResult = (errorCode: string, errorMessage: string): ExtensionPackageDownloadResult => ({
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
  const subscriptionUrl = normalizeExternalHttpUrl(plugin.subscriptionUrl)
  if (!subscriptionUrl.valid) {
    return subscriptionErrorResult('EXTENSION_PLUGIN_SUBSCRIPTION_UNAVAILABLE', 'Plugin subscription URL is not available.')
  }

  try {
    await openExternal?.(subscriptionUrl.url)
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
      url: subscriptionUrl.url,
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
  if (operation === 'update') {
    return [
      { stage: 'verifying' as const, percent: 100, message: 'Verified plugin update package.' },
      { stage: 'installing' as const, percent: 100, message: 'Installing plugin update.' }
    ]
  }
  return [
    { stage: 'verifying' as const, percent: 100, message: 'Verified plugin package manifest.' },
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
    next.packagePath = undefined
    next.installedAt = undefined
    if (next.source === 'local') next.show = false
  }
  return next
}

export const runExtensionPluginOperation = async (
  operation: ExtensionPluginOperation,
  input: ExtensionPluginOperationInput,
  emit?: ExtensionProgressEmitter,
  options: ExtensionOperationOptions = {}
): Promise<ExtensionPluginOperationResult> => {
  const plugin = input?.plugin ? resolveOperationPlugin(input.plugin) : null
  if (!plugin) return errorResult('EXTENSION_PLUGIN_REQUIRED', 'Plugin payload is required.')

  const validation = validatePluginOperation(operation, plugin)
  if (validation) return validation

  if (operation === 'uninstall') {
    removeInstalledExtensionPackageFiles(plugin)
    const next = applyOperation(operation, plugin)
    upsertExtensionCatalogPlugin(next)
    return successResult(operation, next, `${plugin.name} uninstalled by aiopsterm backend.`)
  }

  const pluginId = plugin.pluginId
  if (activeOperations.has(pluginId)) {
    return errorResult('EXTENSION_PLUGIN_OPERATION_BUSY', 'Plugin operation is already running.')
  }

  const activeOperation: ActiveExtensionOperation = { pluginId, cancelled: false }
  activeOperations.set(pluginId, activeOperation)
  const stepDelayMs = Math.max(0, options.stepDelayMs ?? EXTENSION_INSTALL_STEP_DELAY_MS)

  const cancelledResult = (): ExtensionPluginOperationResult => {
    emitExtensionProgress(emit, pluginId, operation, 'cancelled', 0, 'Plugin operation cancelled.')
    activeOperations.delete(pluginId)
    return {
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    }
  }

  const packageInput = resolveStorePackageInput(plugin)
  if ('ok' in packageInput) {
    activeOperations.delete(pluginId)
    emitExtensionProgress(emit, pluginId, operation, 'error', 0, packageInput.errorMessage)
    return packageInput
  }

  const parsedPackage =
    packageInput.kind === 'remote'
      ? await downloadStorePackage(packageInput, operation, activeOperation, emit)
      : parsePackageManifestFromInput(packageInput.input)
  activeOperation.abortController = undefined
  if ('ok' in parsedPackage) {
    activeOperations.delete(pluginId)
    if (parsedPackage.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED') return parsedPackage
    emitExtensionProgress(emit, pluginId, operation, 'error', 0, parsedPackage.errorMessage)
    return parsedPackage
  }

  const packageConfig = parseLocalPackageManifest(parsedPackage, {
    source: 'store',
    allowExistingPluginId: plugin.pluginId,
    basePlugin: plugin,
    findExistingPlugin: findExtensionCatalogPlugin
  })
  if ('ok' in packageConfig) {
    activeOperations.delete(pluginId)
    emitExtensionProgress(emit, pluginId, operation, 'error', 0, packageConfig.errorMessage)
    return packageConfig
  }
  const expectedVersion = trimText(plugin.latestVersion) || trimText(plugin.installedVersion)
  const packageVersion = trimText(packageConfig.plugin.latestVersion)
  if (expectedVersion && packageVersion && packageVersion !== expectedVersion) {
    activeOperations.delete(pluginId)
    const result = errorResult(
      'EXTENSION_STORE_PACKAGE_VERSION_MISMATCH',
      `${plugin.name} package version ${packageVersion} does not match expected version ${expectedVersion}.`
    )
    emitExtensionProgress(emit, pluginId, operation, 'error', 0, result.errorMessage)
    return result
  }

  for (const step of operationSteps(operation)) {
    if (activeOperation.cancelled) return cancelledResult()
    emitExtensionProgress(emit, pluginId, operation, step.stage, step.percent, step.message)
    if (stepDelayMs > 0) await wait(stepDelayMs)
  }

  if (activeOperation.cancelled) return cancelledResult()

  const installedPlugin = installLocalPackageToDisk(packageConfig)
  if ('ok' in installedPlugin) {
    activeOperations.delete(pluginId)
    emitExtensionProgress(emit, pluginId, operation, 'error', 0, installedPlugin.errorMessage)
    return installedPlugin
  }

  const next = applyOperation(operation, installedPlugin)
  upsertExtensionCatalogPlugin(next)
  emitExtensionProgress(emit, pluginId, operation, 'done', 100, `${next.name} operation completed.`)
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

export const downloadExtensionPackage = async (input: ExtensionPackageDownloadInput): Promise<ExtensionPackageDownloadResult> => {
  const packageUrl = normalizeAbsoluteHttpUrl(input?.url)
  if (!packageUrl) return downloadErrorResult('EXTENSION_PACKAGE_DOWNLOAD_URL_INVALID', 'Plugin package download URL must be http or https.')
  try {
    const { buffer } = await fetchExtensionPackageBuffer(packageUrl)
    return {
      ok: true,
      data: {
        url: packageUrl,
        bytes: buffer.byteLength,
        data: [...buffer]
      }
    }
  } catch (error) {
    return downloadErrorResult(
      'EXTENSION_STORE_PACKAGE_DOWNLOAD_FAILED',
      error instanceof Error ? error.message : 'Plugin package download failed.'
    )
  }
}

export const installExtensionPluginFromUrl = (
  input: ExtensionPluginUrlInstallInput,
  emit?: ExtensionProgressEmitter,
  options?: ExtensionOperationOptions
): Promise<ExtensionPluginOperationResult> => {
  const pluginId = trimText(input?.pluginId)
  const packageUrl = normalizeAbsoluteHttpUrl(input?.url)
  if (!pluginId) return Promise.resolve(errorResult('EXTENSION_PLUGIN_ID_REQUIRED', 'Plugin id is required.'))
  if (!packageUrl) return Promise.resolve(errorResult('EXTENSION_PACKAGE_DOWNLOAD_URL_INVALID', 'Plugin package download URL must be http or https.'))
  const catalogPlugin = findExtensionCatalogPlugin(pluginId)
  const version = trimText(input?.version) || trimText(catalogPlugin?.latestVersion) || 'latest'
  const plugin: ExtensionPluginRuntimeConfig = {
    ...(catalogPlugin
      ? clonePlugin(catalogPlugin)
      : {
          pluginId,
          name: pluginId,
          description: 'Remote extension package.',
          iconKey: 'local' as const,
          tabName: pluginId,
          show: true,
          isPlugin: true,
          installed: false,
          hasUpdate: false,
          source: 'store' as const,
          categories: ['Store'],
          functions: [{ title: 'Remote store plugin', desc: 'Installed from a remote .external-reference package URL.' }]
        }),
    pluginId,
    latestVersion: version,
    installedVersion: catalogPlugin?.installedVersion || '',
    installable: catalogPlugin?.installable === false ? false : true,
    packageUrl,
    packageSha256: normalizeSha256(input?.sha256) || catalogPlugin?.packageSha256,
    storePackagePath: undefined,
    source: 'store'
  }
  return runExtensionPluginOperation(plugin.installed && plugin.hasUpdate ? 'update' : 'install', { plugin }, emit, options)
}

export const installExtensionPackage = async (
  input: ExtensionPackageInstallInput,
  emit?: ExtensionProgressEmitter,
  options?: ExtensionOperationOptions
): Promise<ExtensionPluginOperationResult> => {
  const packageConfig = parseLocalPackageManifest(input, { findExistingPlugin: findExtensionCatalogPlugin })
  if ('ok' in packageConfig) return packageConfig

  const pluginId = packageConfig.plugin.pluginId
  const requestId = trimText(input?.requestId)
  if (activeOperations.has(pluginId)) {
    return errorResult('EXTENSION_PLUGIN_OPERATION_BUSY', 'Plugin operation is already running.')
  }

  const activeOperation: ActiveExtensionOperation = { pluginId, cancelled: false }
  activeOperations.set(pluginId, activeOperation)
  const stepDelayMs = Math.max(0, options?.stepDelayMs ?? EXTENSION_INSTALL_STEP_DELAY_MS)
  const cancelledResult = (): ExtensionPluginOperationResult => {
    emitExtensionProgress(emit, pluginId, 'package', 'cancelled', 0, 'Plugin operation cancelled.', requestId)
    activeOperations.delete(pluginId)
    return {
      ok: false,
      errorCode: 'EXTENSION_PLUGIN_OPERATION_CANCELLED',
      errorMessage: 'Plugin operation cancelled.'
    }
  }

  emitExtensionProgress(emit, pluginId, 'package', 'verifying', 100, 'Verified local package manifest.', requestId)
  if (stepDelayMs > 0) await wait(stepDelayMs)
  if (activeOperation.cancelled) return cancelledResult()

  emitExtensionProgress(emit, pluginId, 'package', 'installing', 100, 'Installing local package.', requestId)
  const installedPlugin = installLocalPackageToDisk(packageConfig)
  if ('ok' in installedPlugin) {
    activeOperations.delete(pluginId)
    emitExtensionProgress(emit, pluginId, 'package', 'error', 0, installedPlugin.errorMessage, requestId)
    return installedPlugin
  }
  if (stepDelayMs > 0) await wait(stepDelayMs)
  if (activeOperation.cancelled) return cancelledResult()

  const next = applyOperation('package', installedPlugin)
  upsertExtensionCatalogPlugin(next)
  emitExtensionProgress(emit, pluginId, 'package', 'done', 100, `${next.name} operation completed.`, requestId)
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
  if (activeOperation) {
    activeOperation.cancelled = true
    activeOperation.abortController?.abort()
  }

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
