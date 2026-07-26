import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import type {
  ExtensionCommandExecuteResult,
  ExtensionBastionProviderContribution,
  ExtensionConfigurationGetResult,
  ExtensionConfigurationUpdateInput,
  ExtensionContextSnapshotResult,
  ExtensionPluginRuntimeConfig,
  ExtensionRuntimeEvent,
  ExtensionRuntimeStatus,
  ExtensionTreeChildrenResult,
  ExtensionTreeItem
} from '@shared/contracts/extensions'
import type { AiopsAssetInput, AiopsAssetRecord } from '@shared/contracts/assets'
import type { AiopsMutationResult } from '@shared/contracts/common'
import { decryptAssetSecret, encryptAssetSecretForStorage } from '../assets/assetsCredentialRuntime'

type Disposable = { dispose: () => void }
type ExtensionCommandHandler = (...args: unknown[]) => unknown | Promise<unknown>
type ExtensionTreeProvider = {
  getChildren: (parentId?: string) => ExtensionTreeItem[] | Promise<ExtensionTreeItem[]>
}
type ExtensionAssetSyncResult = AiopsAssetInput[] | { assets: AiopsAssetInput[]; removeMissing?: boolean }
type ExtensionAssetProvider = {
  sync: (
    values: Record<string, string>,
    signal?: AbortSignal,
    reportProgress?: (percent: number, message?: string) => void
  ) => ExtensionAssetSyncResult | Promise<ExtensionAssetSyncResult>
}
type ExtensionBastionProvider = {
  connect?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  openShell?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  write?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  resize?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  disconnect?: (input: Record<string, unknown>) => unknown | Promise<unknown>
  refreshAssets?: (input: Record<string, unknown>) => unknown | Promise<unknown>
}

type ExtensionModule = {
  activate?: (context: ExtensionContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}

type StoredRuntimeState = {
  enabled: Record<string, boolean>
  global: Record<string, Record<string, unknown>>
  workspace: Record<string, Record<string, unknown>>
  secrets: Record<string, Record<string, string>>
  configuration: Record<string, Record<string, string | boolean>>
}

type RuntimeRecord = {
  plugin: ExtensionPluginRuntimeConfig
  module?: ExtensionModule
  status: ExtensionRuntimeStatus
  errorMessage?: string
  disposables: Set<Disposable>
}

export type ExtensionHostRuntimeConfig = {
  rootDir?: string
  saveAsset?: (input: AiopsAssetInput) => AiopsMutationResult<AiopsAssetRecord>
  emit?: (event: ExtensionRuntimeEvent) => void
  executeCoreCommand?: (commandId: string, args: unknown[]) => unknown | Promise<unknown>
  activationTimeoutMs?: number
}

export type ExtensionContext = {
  pluginId: string
  extensionPath: string
  storagePath: string
  subscriptions: Disposable[]
  asAbsolutePath: (relativePath: string) => string
  logger: {
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }
  globalState: ExtensionMemento
  workspaceState: ExtensionMemento
  secrets: {
    get: (key: string) => Promise<string | undefined>
    store: (key: string, value: string) => Promise<void>
    delete: (key: string) => Promise<void>
    keys: () => Promise<string[]>
  }
  commands: {
    registerCommand: (commandId: string, handler: ExtensionCommandHandler) => Disposable
    executeCommand: (commandId: string, ...args: unknown[]) => Promise<unknown>
  }
  views: {
    registerTreeDataProvider: (viewId: string, provider: ExtensionTreeProvider) => Disposable
    refresh: (viewId: string) => void
  }
  contexts: {
    set: (key: string, value: boolean | string | number) => void
  }
  configuration: {
    get: <T extends string | boolean>(key: string, defaultValue?: T) => Promise<T | undefined>
    update: (key: string, value: string | boolean) => Promise<void>
  }
  files: {
    readFile: (filePath: string) => Promise<Buffer>
    writeFile: (filePath: string, content: string | Buffer) => Promise<void>
  }
  assets: {
    registerProvider: (providerId: string, provider: ExtensionAssetProvider) => Disposable
    save: (asset: AiopsAssetInput) => AiopsMutationResult<AiopsAssetRecord>
  }
  bastions: {
    registerDefinition: (definition: ExtensionBastionProviderContribution) => Disposable
    registerProvider: (type: string, provider: ExtensionBastionProvider) => Disposable
  }
  versions: {
    registerProvider: (provider: () => unknown | Promise<unknown>) => Disposable
  }
  window: {
    showInformationMessage: (message: string) => void
    showWarningMessage: (message: string) => void
    showErrorMessage: (message: string) => void
  }
}

type ExtensionMemento = {
  get: <T>(key: string, defaultValue?: T) => Promise<T | undefined>
  update: (key: string, value: unknown) => Promise<void>
  keys: () => Promise<string[]>
}

const emptyState = (): StoredRuntimeState => ({
  enabled: {},
  global: {},
  workspace: {},
  secrets: {},
  configuration: {}
})

let runtimeConfig: Required<Pick<ExtensionHostRuntimeConfig, 'rootDir' | 'activationTimeoutMs'>> & Omit<ExtensionHostRuntimeConfig, 'rootDir' | 'activationTimeoutMs'> = {
  rootDir: resolve('.aiopsterm-extensions'),
  activationTimeoutMs: 10000
}
let storedState = emptyState()
const runtimes = new Map<string, RuntimeRecord>()
const commands = new Map<string, { pluginId: string; handler: ExtensionCommandHandler }>()
const treeProviders = new Map<string, { pluginId: string; provider: ExtensionTreeProvider }>()
const contexts = new Map<string, boolean | string | number>()
const assetProviders = new Map<string, { pluginId: string; provider: ExtensionAssetProvider }>()
const activeAssetSyncs = new Map<string, AbortController>()
const bastionProviders = new Map<string, { pluginId: string; provider: ExtensionBastionProvider }>()
const bastionDefinitions = new Map<string, { pluginId: string; definition: ExtensionBastionProviderContribution }>()
const versionProviders = new Map<string, () => unknown | Promise<unknown>>()

const statePath = () => join(runtimeConfig.rootDir, 'runtime-state.json')
const pluginStoragePath = (pluginId: string) => join(runtimeConfig.rootDir, 'data', safeSegment(pluginId))
const logPath = (pluginId: string) => join(runtimeConfig.rootDir, 'logs', `${safeSegment(pluginId)}.log`)

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'plugin'
const isInside = (root: string, target: string) => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
}

const readState = () => {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<StoredRuntimeState>
    storedState = {
      enabled: parsed.enabled || {},
      global: parsed.global || {},
      workspace: parsed.workspace || {},
      secrets: parsed.secrets || {},
      configuration: parsed.configuration || {}
    }
  } catch {
    storedState = emptyState()
  }
}

const writeState = () => {
  mkdirSync(dirname(statePath()), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(storedState, null, 2), 'utf8')
}

const log = (pluginId: string, level: string, message: string, data?: unknown) => {
  const target = logPath(pluginId)
  mkdirSync(dirname(target), { recursive: true })
  const suffix = data === undefined ? '' : ` ${safeJson(data)}`
  appendFileSync(target, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`, 'utf8')
}

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string) => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const disposable = (dispose: () => void): Disposable => {
  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      dispose()
    }
  }
}

const assertOwnedId = (pluginId: string, id: string, kind: string) => {
  if (id !== pluginId && !id.startsWith(`${pluginId}.`)) {
    throw new Error(`${kind} id must start with "${pluginId}."`)
  }
}

const createMemento = (pluginId: string, scope: 'global' | 'workspace'): ExtensionMemento => ({
  get: async <T>(key: string, defaultValue?: T) => {
    const bucket = storedState[scope][pluginId] || {}
    return Object.prototype.hasOwnProperty.call(bucket, key) ? (bucket[key] as T) : defaultValue
  },
  update: async (key: string, value: unknown) => {
    const bucket = { ...(storedState[scope][pluginId] || {}) }
    if (value === undefined) delete bucket[key]
    else bucket[key] = value
    storedState[scope][pluginId] = bucket
    writeState()
  },
  keys: async () => Object.keys(storedState[scope][pluginId] || {})
})

const createContext = (record: RuntimeRecord): ExtensionContext => {
  const { plugin } = record
  const pluginId = plugin.pluginId
  const extensionPath = resolve(plugin.packagePath || '')
  const storagePath = pluginStoragePath(pluginId)
  mkdirSync(storagePath, { recursive: true })
  const track = (item: Disposable) => {
    record.disposables.add(item)
    return item
  }
  const context: ExtensionContext = {
    pluginId,
    extensionPath,
    storagePath,
    subscriptions: [],
    asAbsolutePath: (relativePath) => {
      const target = resolve(extensionPath, relativePath)
      if (!isInside(extensionPath, target)) throw new Error('Extension path escapes the plugin directory')
      return target
    },
    logger: {
      info: (message, data) => log(pluginId, 'info', message, data),
      warn: (message, data) => log(pluginId, 'warn', message, data),
      error: (message, data) => log(pluginId, 'error', message, data)
    },
    globalState: createMemento(pluginId, 'global'),
    workspaceState: createMemento(pluginId, 'workspace'),
    secrets: {
      get: async (key) => {
        const encrypted = storedState.secrets[pluginId]?.[key]
        if (!encrypted) return undefined
        return decryptAssetSecret({ password: encrypted }).password
      },
      store: async (key, value) => {
        const bucket = { ...(storedState.secrets[pluginId] || {}) }
        bucket[key] = encryptAssetSecretForStorage({ password: value }).password || ''
        storedState.secrets[pluginId] = bucket
        writeState()
      },
      delete: async (key) => {
        const bucket = { ...(storedState.secrets[pluginId] || {}) }
        delete bucket[key]
        storedState.secrets[pluginId] = bucket
        writeState()
      },
      keys: async () => Object.keys(storedState.secrets[pluginId] || {})
    },
    commands: {
      registerCommand: (commandId, handler) => {
        assertOwnedId(pluginId, commandId, 'Command')
        const existing = commands.get(commandId)
        if (existing && existing.pluginId !== pluginId) throw new Error(`Command "${commandId}" is already registered`)
        commands.set(commandId, { pluginId, handler })
        return track(disposable(() => {
          if (commands.get(commandId)?.pluginId === pluginId) commands.delete(commandId)
        }))
      },
      executeCommand: (commandId, ...args) => executeCommandValue(commandId, args)
    },
    views: {
      registerTreeDataProvider: (viewId, provider) => {
        assertOwnedId(pluginId, viewId, 'View')
        const existing = treeProviders.get(viewId)
        if (existing && existing.pluginId !== pluginId) throw new Error(`View "${viewId}" is already registered`)
        treeProviders.set(viewId, { pluginId, provider })
        return track(disposable(() => {
          if (treeProviders.get(viewId)?.pluginId === pluginId) treeProviders.delete(viewId)
        }))
      },
      refresh: (viewId) => runtimeConfig.emit?.({ type: 'view-refresh', pluginId, viewId })
    },
    contexts: {
      set: (key, value) => {
        assertOwnedId(pluginId, key, 'Context')
        contexts.set(key, value)
        runtimeConfig.emit?.({ type: 'context-changed', pluginId, key, value })
      }
    },
    configuration: {
      get: async <T extends string | boolean>(key: string, defaultValue?: T) => {
        const encrypted = storedState.secrets[pluginId]?.[key]
        if (encrypted) return (decryptAssetSecret({ password: encrypted }).password as T | undefined) ?? defaultValue
        return (storedState.configuration[pluginId]?.[key] as T | undefined) ?? defaultValue
      },
      update: async (key, value) => {
        storedState.configuration[pluginId] = { ...(storedState.configuration[pluginId] || {}), [key]: value }
        writeState()
      }
    },
    files: {
      readFile: async (filePath) => readFileSync(filePath),
      writeFile: async (filePath, content) => {
        mkdirSync(dirname(filePath), { recursive: true })
        writeFileSync(filePath, content)
      }
    },
    assets: {
      registerProvider: (providerId, provider) => {
        assertOwnedId(pluginId, providerId, 'Asset provider')
        if (assetProviders.has(providerId)) throw new Error(`Asset provider "${providerId}" is already registered`)
        assetProviders.set(providerId, { pluginId, provider })
        return track(disposable(() => {
          if (assetProviders.get(providerId)?.pluginId === pluginId) assetProviders.delete(providerId)
        }))
      },
      save: (asset) => {
        if (!runtimeConfig.saveAsset) return { ok: false, errorCode: 'EXTENSION_ASSET_BACKEND_UNAVAILABLE', errorMessage: 'Asset backend is unavailable.' }
        return runtimeConfig.saveAsset({
          ...asset,
          tags: [...new Set([...(asset.tags || []), `plugin:${pluginId}`])]
        })
      }
    },
    bastions: {
      registerDefinition: (definition) => {
        assertOwnedId(pluginId, definition.type, 'Bastion definition')
        if (bastionDefinitions.has(definition.type)) throw new Error(`Bastion definition "${definition.type}" is already registered`)
        bastionDefinitions.set(definition.type, { pluginId, definition: { ...definition } })
        return track(disposable(() => {
          if (bastionDefinitions.get(definition.type)?.pluginId === pluginId) bastionDefinitions.delete(definition.type)
        }))
      },
      registerProvider: (type, provider) => {
        assertOwnedId(pluginId, type, 'Bastion provider')
        if (bastionProviders.has(type)) throw new Error(`Bastion provider "${type}" is already registered`)
        bastionProviders.set(type, { pluginId, provider })
        return track(disposable(() => {
          if (bastionProviders.get(type)?.pluginId === pluginId) bastionProviders.delete(type)
        }))
      }
    },
    versions: {
      registerProvider: (provider) => {
        versionProviders.set(pluginId, provider)
        return track(disposable(() => versionProviders.delete(pluginId)))
      }
    },
    window: {
      showInformationMessage: (message) => runtimeConfig.emit?.({ type: 'message', pluginId, level: 'info', message }),
      showWarningMessage: (message) => runtimeConfig.emit?.({ type: 'message', pluginId, level: 'warning', message }),
      showErrorMessage: (message) => runtimeConfig.emit?.({ type: 'message', pluginId, level: 'error', message })
    }
  }
  return context
}

const clearRequireCache = (packagePath: string) => {
  const root = resolve(packagePath)
  for (const id of Object.keys(require.cache)) {
    if (isInside(root, id)) delete require.cache[id]
  }
}

const executeCommandValue = async (commandId: string, args: unknown[]) => {
  const registered = commands.get(commandId)
  if (registered) return registered.handler(...args)
  if (runtimeConfig.executeCoreCommand) return runtimeConfig.executeCoreCommand(commandId, args)
  throw new Error(`Command "${commandId}" is not registered`)
}

export const configureExtensionHostRuntime = (config: ExtensionHostRuntimeConfig = {}) => {
  runtimeConfig = {
    rootDir: resolve(config.rootDir || runtimeConfig.rootDir),
    saveAsset: config.saveAsset,
    emit: config.emit,
    executeCoreCommand: config.executeCoreCommand,
    activationTimeoutMs: Math.max(1000, config.activationTimeoutMs || 10000)
  }
  readState()
}

export const activateExtension = async (plugin: ExtensionPluginRuntimeConfig) => {
  if (!plugin.main || !plugin.packagePath) return plugin
  const enabled = storedState.enabled[plugin.pluginId] ?? plugin.enabled !== false
  if (!enabled) return { ...plugin, enabled: false, runtimeStatus: 'disabled' as const }
  const existing = runtimes.get(plugin.pluginId)
  if (existing?.status === 'active' && existing.plugin.installedVersion === plugin.installedVersion) {
    return { ...plugin, enabled: true, runtimeStatus: 'active' as const }
  }
  if (existing) await deactivateExtension(plugin.pluginId)
  const record: RuntimeRecord = {
    plugin: { ...plugin },
    status: 'activating',
    disposables: new Set()
  }
  runtimes.set(plugin.pluginId, record)
  runtimeConfig.emit?.({ type: 'runtime-changed', pluginId: plugin.pluginId, status: 'activating' })
  let activationContext: ExtensionContext | undefined
  try {
    const entryPath = resolve(plugin.packagePath, plugin.main)
    if (!isInside(plugin.packagePath, entryPath) || !existsSync(entryPath)) throw new Error(`Plugin main entry was not found: ${plugin.main}`)
    clearRequireCache(plugin.packagePath)
    const loaded = require(entryPath) as ExtensionModule
    if (typeof loaded.activate !== 'function') throw new Error('Executable plugin must export activate(context)')
    record.module = loaded
    activationContext = createContext(record)
    await withTimeout(
      Promise.resolve(loaded.activate(activationContext)),
      runtimeConfig.activationTimeoutMs,
      `Plugin activation timed out after ${runtimeConfig.activationTimeoutMs} ms`
    )
    for (const item of activationContext.subscriptions) record.disposables.add(item)
    record.status = 'active'
    record.errorMessage = undefined
    log(plugin.pluginId, 'info', 'Plugin activated')
    runtimeConfig.emit?.({ type: 'runtime-changed', pluginId: plugin.pluginId, status: 'active' })
    return { ...plugin, enabled: true, runtimeStatus: 'active' as const, runtimeError: undefined }
  } catch (error) {
    for (const item of activationContext?.subscriptions || []) record.disposables.add(item)
    for (const item of [...record.disposables].reverse()) {
      try {
        item.dispose()
      } catch {}
    }
    record.disposables.clear()
    record.status = 'error'
    record.errorMessage = error instanceof Error ? error.message : String(error)
    log(plugin.pluginId, 'error', 'Plugin activation failed', record.errorMessage)
    runtimeConfig.emit?.({
      type: 'runtime-changed',
      pluginId: plugin.pluginId,
      status: 'error',
      errorMessage: record.errorMessage
    })
    return { ...plugin, enabled: true, runtimeStatus: 'error' as const, runtimeError: record.errorMessage }
  }
}

export const deactivateExtension = async (pluginId: string) => {
  const record = runtimes.get(pluginId)
  if (!record) return
  try {
    await withTimeout(
      Promise.resolve(record.module?.deactivate?.()),
      Math.min(runtimeConfig.activationTimeoutMs, 5000),
      'Plugin deactivation timed out'
    )
  } catch (error) {
    log(pluginId, 'error', 'Plugin deactivation failed', error instanceof Error ? error.message : String(error))
  }
  for (const item of [...record.disposables].reverse()) {
    try {
      item.dispose()
    } catch {}
  }
  for (const [key] of contexts) {
    if (key === pluginId || key.startsWith(`${pluginId}.`)) contexts.delete(key)
  }
  clearRequireCache(record.plugin.packagePath || '')
  runtimes.delete(pluginId)
  runtimeConfig.emit?.({ type: 'runtime-changed', pluginId, status: 'inactive' })
}

export const shutdownExtensionHostRuntime = async () => {
  for (const pluginId of [...runtimes.keys()]) await deactivateExtension(pluginId)
}

export const deleteExtensionData = (pluginId: string) => {
  delete storedState.enabled[pluginId]
  delete storedState.global[pluginId]
  delete storedState.workspace[pluginId]
  delete storedState.secrets[pluginId]
  delete storedState.configuration[pluginId]
  writeState()
  rmSync(pluginStoragePath(pluginId), { recursive: true, force: true })
  rmSync(logPath(pluginId), { force: true })
}

export const setExtensionEnabled = async (plugin: ExtensionPluginRuntimeConfig, enabled: boolean) => {
  storedState.enabled[plugin.pluginId] = enabled
  writeState()
  if (!enabled) {
    await deactivateExtension(plugin.pluginId)
    return { ...plugin, enabled: false, runtimeStatus: 'disabled' as const, runtimeError: undefined }
  }
  return activateExtension({ ...plugin, enabled: true, runtimeStatus: 'inactive' })
}

export const reloadExtension = async (plugin: ExtensionPluginRuntimeConfig) => {
  await deactivateExtension(plugin.pluginId)
  return activateExtension(plugin)
}

export const decorateExtensionPlugin = (plugin: ExtensionPluginRuntimeConfig): ExtensionPluginRuntimeConfig => {
  const runtime = runtimes.get(plugin.pluginId)
  const enabled = storedState.enabled[plugin.pluginId] ?? plugin.enabled !== false
  return {
    ...plugin,
    enabled,
    runtimeStatus: enabled ? runtime?.status || 'inactive' : 'disabled',
    runtimeError: runtime?.errorMessage
  }
}

export const executeExtensionCommand = async (commandId: string, args: unknown[] = []): Promise<ExtensionCommandExecuteResult> => {
  try {
    const value = await executeCommandValue(commandId, args)
    return { ok: true, data: { commandId, ...(value === undefined ? {} : { value }) } }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'EXTENSION_COMMAND_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Plugin command failed.'
    }
  }
}

export const getExtensionTreeChildren = async (viewId: string, parentId?: string): Promise<ExtensionTreeChildrenResult> => {
  const registered = treeProviders.get(viewId)
  if (!registered) return { ok: false, errorCode: 'EXTENSION_VIEW_UNAVAILABLE', errorMessage: 'Plugin view is not registered.' }
  try {
    const items = await registered.provider.getChildren(parentId)
    return { ok: true, data: { viewId, ...(parentId ? { parentId } : {}), items: Array.isArray(items) ? items : [] } }
  } catch (error) {
    return { ok: false, errorCode: 'EXTENSION_VIEW_FAILED', errorMessage: error instanceof Error ? error.message : 'Plugin view failed.' }
  }
}

export const getExtensionContexts = async (): Promise<ExtensionContextSnapshotResult> => ({
  ok: true,
  data: Object.fromEntries(contexts)
})

export const getExtensionConfiguration = async (plugin: ExtensionPluginRuntimeConfig): Promise<ExtensionConfigurationGetResult> => {
  const values: Record<string, string | boolean> = {}
  for (const field of plugin.configuration?.properties || []) {
    if (field.type === 'password') {
      values[field.key] = Boolean(storedState.secrets[plugin.pluginId]?.[field.key])
      continue
    }
    values[field.key] = storedState.configuration[plugin.pluginId]?.[field.key] ?? field.defaultValue ?? ''
  }
  return { ok: true, data: values }
}

export const updateExtensionConfiguration = async (
  plugin: ExtensionPluginRuntimeConfig,
  input: ExtensionConfigurationUpdateInput
): Promise<ExtensionConfigurationGetResult> => {
  const known = new Map((plugin.configuration?.properties || []).map((field) => [field.key, field]))
  const configuration = { ...(storedState.configuration[plugin.pluginId] || {}) }
  const secrets = { ...(storedState.secrets[plugin.pluginId] || {}) }
  for (const [key, value] of Object.entries(input.values || {})) {
    const field = known.get(key)
    if (!field) continue
    if (field.type === 'password') {
      if (typeof value === 'string' && value) secrets[key] = encryptAssetSecretForStorage({ password: value }).password || ''
      continue
    }
    configuration[key] = value
  }
  storedState.configuration[plugin.pluginId] = configuration
  storedState.secrets[plugin.pluginId] = secrets
  writeState()
  return getExtensionConfiguration(plugin)
}

export const syncRuntimeAssetProvider = async (
  pluginId: string,
  providerId: string,
  values: Record<string, string>
): Promise<AiopsMutationResult<{ pluginId: string; providerId: string; imported: number; assets: AiopsAssetRecord[] }>> => {
  const registered = assetProviders.get(providerId)
  if (!registered || registered.pluginId !== pluginId) {
    return { ok: false, errorCode: 'EXTENSION_PROVIDER_UNAVAILABLE', errorMessage: 'Runtime asset provider was not registered.' }
  }
  if (!runtimeConfig.saveAsset) {
    return { ok: false, errorCode: 'EXTENSION_ASSET_BACKEND_UNAVAILABLE', errorMessage: 'Asset backend is unavailable.' }
  }
  const operationKey = `${pluginId}:${providerId}`
  if (activeAssetSyncs.has(operationKey)) {
    return { ok: false, errorCode: 'EXTENSION_PROVIDER_BUSY', errorMessage: 'Provider sync is already running.' }
  }
  const controller = new AbortController()
  activeAssetSyncs.set(operationKey, controller)
  try {
    const result = await registered.provider.sync(values, controller.signal, (percent, message) => {
      runtimeConfig.emit?.({
        type: 'provider-progress',
        pluginId,
        providerId,
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        ...(message ? { message } : {})
      })
    })
    if (controller.signal.aborted) {
      return { ok: false, errorCode: 'EXTENSION_PROVIDER_CANCELLED', errorMessage: 'Provider sync was cancelled.' }
    }
    const inputs = Array.isArray(result) ? result : result.assets
    const assets: AiopsAssetRecord[] = []
    for (const input of inputs) {
      const saved = runtimeConfig.saveAsset({
        ...input,
        tags: [...new Set([...(input.tags || []), `plugin:${pluginId}`, `provider:${providerId}`])]
      })
      if (!saved.ok || !saved.data) {
        return {
          ok: false,
          errorCode: saved.errorCode || 'EXTENSION_PROVIDER_IMPORT_FAILED',
          errorMessage: saved.errorMessage || 'Provider asset could not be saved.'
        }
      }
      assets.push(saved.data)
    }
    return { ok: true, data: { pluginId, providerId, imported: assets.length, assets } }
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof Error && error.name === 'AbortError' ? 'EXTENSION_PROVIDER_CANCELLED' : 'EXTENSION_PROVIDER_SYNC_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Provider sync failed.'
    }
  } finally {
    activeAssetSyncs.delete(operationKey)
  }
}

export const cancelRuntimeAssetProvider = (pluginId: string, providerId: string) => {
  const operation = activeAssetSyncs.get(`${pluginId}:${providerId}`)
  operation?.abort()
  return { ok: true as const, data: { pluginId, providerId, cancelled: Boolean(operation) } }
}

export const invokeExtensionBastion = async (type: string, method: keyof ExtensionBastionProvider, input: Record<string, unknown>) => {
  const registered = bastionProviders.get(type)
  const handler = registered?.provider[method]
  if (typeof handler !== 'function') {
    return { ok: false, errorCode: 'EXTENSION_BASTION_UNAVAILABLE', errorMessage: 'Bastion capability is unavailable.' }
  }
  try {
    return { ok: true, data: await handler(input) }
  } catch (error) {
    return { ok: false, errorCode: 'EXTENSION_BASTION_FAILED', errorMessage: error instanceof Error ? error.message : 'Bastion capability failed.' }
  }
}

export const getExtensionVersions = async () => {
  const versions: Record<string, unknown> = {}
  for (const [pluginId, provider] of versionProviders) {
    try {
      versions[pluginId] = await provider()
    } catch (error) {
      versions[pluginId] = { error: error instanceof Error ? error.message : String(error) }
    }
  }
  return versions
}

export const getExtensionBastionDefinitions = () =>
  [...bastionDefinitions.values()].map(({ pluginId, definition }) => ({ pluginId, ...definition }))

export const resetExtensionHostRuntimeForTests = () => {
  runtimes.clear()
  commands.clear()
  treeProviders.clear()
  contexts.clear()
  assetProviders.clear()
  activeAssetSyncs.clear()
  bastionProviders.clear()
  bastionDefinitions.clear()
  versionProviders.clear()
  storedState = emptyState()
}
