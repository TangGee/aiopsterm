import type {
  ExtensionAssetProviderContribution,
  ExtensionCommandContribution,
  ExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPackageInstallInput,
  ExtensionPluginOperation,
  ExtensionPluginOperationResult,
  ExtensionPluginRuntimeConfig
} from '@shared/contracts/extensions'
import type { AiopsAssetInput, AiopsAssetRecord } from '@shared/contracts/assets'
import type { AiopsMutationResult } from '@shared/contracts/common'
import { normalizeExternalHttpUrl } from '@shared/externalUrl'

export type ExtensionProgressEmitter = (progress: ExtensionInstallProgress) => void

export type ExtensionOperationOptions = {
  stepDelayMs?: number
}

export type LocalExtensionPackageManifest = {
  manifestVersion?: unknown
  id?: unknown
  name?: unknown
  displayName?: unknown
  version?: unknown
  kind?: unknown
  description?: unknown
  engines?: {
    aiopsterm?: unknown
  }
  categories?: unknown
  readme?: unknown
  functions?: unknown
  iconKey?: unknown
  installable?: unknown
  private?: unknown
  isPrivate?: unknown
  subscriptionUrl?: unknown
  packageUrl?: unknown
  downloadUrl?: unknown
  url?: unknown
  sha256?: unknown
  packageSha256?: unknown
  store?: {
    installable?: unknown
    private?: unknown
    isPrivate?: unknown
    subscriptionUrl?: unknown
    packageUrl?: unknown
    downloadUrl?: unknown
    url?: unknown
    sha256?: unknown
    packageSha256?: unknown
  }
  contributes?: {
    commands?: unknown
    assetProviders?: unknown
  }
}

export type RemoteExtensionCatalogPluginManifest = LocalExtensionPackageManifest & {
  fileName?: unknown
  size?: unknown
  lastUpdated?: unknown
  categories?: unknown
}

export type RemoteExtensionCatalogManifest = {
  plugins?: unknown
}

export type LocalZipEntry = {
  entryName: string
  isDirectory: boolean
  getData: () => Buffer
}

export type LocalExtensionPackageConfig = {
  plugin: ExtensionPluginRuntimeConfig
  entries: LocalZipEntry[]
}

export type ParsedExtensionPackageInput = {
  manifest: LocalExtensionPackageManifest
  entries: LocalZipEntry[]
  filePath: string
  packageSize: number
}

export type LocalExtensionPackageParseOptions = {
  source?: 'local' | 'store'
  allowExistingPluginId?: string
  basePlugin?: ExtensionPluginRuntimeConfig
  findExistingPlugin?: (pluginId: string) => ExtensionPluginRuntimeConfig | undefined
}

export type ExtensionFetchResponse = {
  ok: boolean
  status: number
  headers?: {
    get(name: string): string | null
  }
  body?: {
    getReader?: () => {
      read: () => Promise<{ done?: boolean; value?: Uint8Array }>
    }
  } | null
  arrayBuffer: () => Promise<ArrayBuffer>
  text?: () => Promise<string>
}

export type ExtensionFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<ExtensionFetchResponse>

export type ExtensionBackendRuntimeConfig = {
  extensionRootDir?: string
  builtinPluginDir?: string
  storePackageDir?: string
  storeCatalogUrl?: string
  remotePackageCacheDir?: string
  appVersion?: string
  fetch?: ExtensionFetch
  saveAsset?: (input: AiopsAssetInput) => AiopsMutationResult<AiopsAssetRecord>
}

export type ExtensionPackageRuntimeConfig = {
  extensionRootDir: string
  storePackageDir: string
  remotePackageCacheDir: string
  appVersion: string
  fetch: ExtensionFetch
}

export type StorePackageInput =
  | { kind: 'local'; input: ExtensionPackageInstallInput }
  | { kind: 'remote'; plugin: ExtensionPluginRuntimeConfig; url: string; sha256?: string }

export const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

export const trimText = (value: unknown) => String(value || '').trim()

export const booleanFromUnknown = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }
  return undefined
}

const extensionIconKeys = new Set(['runbook', 'cloud', 'private', 'local'])

export const normalizeExtensionIconKey = (value: unknown): ExtensionPluginRuntimeConfig['iconKey'] => {
  const key = trimText(value)
  return extensionIconKeys.has(key) ? (key as ExtensionPluginRuntimeConfig['iconKey']) : 'local'
}

const compareVersion = (left: string, right: string) => {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const maxLength = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < maxLength; index++) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1
  }
  return left.localeCompare(right)
}

export const isVersionNewer = (latestVersion: string, installedVersion: string) =>
  Boolean(latestVersion && installedVersion && compareVersion(latestVersion, installedVersion) > 0)

export const clonePlugin = (plugin: ExtensionPluginRuntimeConfig): ExtensionPluginRuntimeConfig => ({
  ...plugin,
  categories: plugin.categories ? [...plugin.categories] : undefined,
  functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
  commands: plugin.commands ? plugin.commands.map((item) => ({ ...item })) : undefined,
  assetProviders: plugin.assetProviders
    ? plugin.assetProviders.map((provider) => ({
        ...provider,
        fields: provider.fields.map((field) => ({ ...field }))
      }))
    : undefined,
  guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
  connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
  storePackagePath: trimText(plugin.storePackagePath) || undefined,
  packageUrl: trimText(plugin.packageUrl) || undefined,
  packageSha256: trimText(plugin.packageSha256) || undefined,
  subscriptionUrl: trimText(plugin.subscriptionUrl) || undefined
})

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export const normalizeAbsoluteHttpUrl = (value: unknown, baseUrl?: string) => {
  const result = normalizeExternalHttpUrl(value, baseUrl)
  return result.valid ? result.url : ''
}

export const normalizeSha256 = (value: unknown) => {
  const text = trimText(value).toLowerCase()
  return /^[a-f0-9]{64}$/.test(text) ? text : ''
}

export const parseStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const normalized = value.map(trimText).filter(Boolean)
  return [...new Set(normalized)]
}

export const parseManifestFunctions = (value: unknown): Array<{ title: string; desc: string }> => {
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

export const parseManifestCommands = (manifest: LocalExtensionPackageManifest): ExtensionCommandContribution[] => {
  const contributes = asRecord(manifest.contributes)
  const commands = contributes?.commands
  if (!Array.isArray(commands)) return []
  const parsed: ExtensionCommandContribution[] = []
  const ids = new Set<string>()
  for (const item of commands) {
    const record = asRecord(item)
    if (!record) continue
    const id = trimText(record.id)
    const title = trimText(record.title)
    const command = trimText(record.command)
    if (!id || !title || !command || ids.has(id)) continue
    ids.add(id)
    parsed.push({
      id,
      title,
      description: trimText(record.description),
      command
    })
  }
  return parsed
}

export const parseManifestAssetProviders = (manifest: LocalExtensionPackageManifest): ExtensionAssetProviderContribution[] => {
  const contributes = asRecord(manifest.contributes)
  const providers = contributes?.assetProviders
  if (!Array.isArray(providers)) return []
  const parsed: ExtensionAssetProviderContribution[] = []
  const ids = new Set<string>()
  for (const item of providers) {
    const record = asRecord(item)
    if (!record) continue
    const id = trimText(record.id)
    const name = trimText(record.name)
    if (!id || !name || record.adapter !== 'json-assets' || ids.has(id) || !Array.isArray(record.fields)) continue
    const fields: ExtensionAssetProviderContribution['fields'] = []
    for (const field of record.fields) {
      const fieldRecord = asRecord(field)
      if (!fieldRecord) continue
      const key = trimText(fieldRecord.key)
      const label = trimText(fieldRecord.label)
      if (!key || !label || fieldRecord.type !== 'textarea') continue
      const defaultValue = trimText(fieldRecord.defaultValue)
      fields.push({
        key,
        label,
        type: 'textarea',
        required: fieldRecord.required === true,
        ...(defaultValue ? { defaultValue } : {})
      })
    }
    if (!fields.length || !fields.some((field) => field.key === 'payload') || new Set(fields.map((field) => field.key)).size !== fields.length) continue
    ids.add(id)
    parsed.push({
      id,
      name,
      description: trimText(record.description),
      adapter: 'json-assets',
      fields
    })
  }
  return parsed
}

export const extractStoreManifestFlags = (manifest: LocalExtensionPackageManifest) => {
  const store = asRecord(manifest.store)
  const privateFlag =
    booleanFromUnknown(manifest.isPrivate) ??
    booleanFromUnknown(manifest.private) ??
    booleanFromUnknown(store?.isPrivate) ??
    booleanFromUnknown(store?.private) ??
    false
  const installable = booleanFromUnknown(manifest.installable) ?? booleanFromUnknown(store?.installable) ?? !privateFlag
  const subscriptionUrl = trimText(manifest.subscriptionUrl || store?.subscriptionUrl)
  return {
    isPrivate: privateFlag,
    installable,
    subscriptionUrl
  }
}

export const extractPackageManifestSource = (manifest: LocalExtensionPackageManifest, baseUrl?: string) => {
  const store = asRecord(manifest.store)
  const packageUrl = normalizeAbsoluteHttpUrl(
    manifest.packageUrl || manifest.downloadUrl || manifest.url || store?.packageUrl || store?.downloadUrl || store?.url,
    baseUrl
  )
  const packageSha256 = normalizeSha256(manifest.packageSha256 || manifest.sha256 || store?.packageSha256 || store?.sha256)
  return {
    packageUrl,
    packageSha256
  }
}

export const extensionPluginOperationError = (errorCode: string, errorMessage: string): ExtensionPluginOperationResult => ({
  ok: false,
  errorCode,
  errorMessage
})

export const emitExtensionProgress = (
  emit: ExtensionProgressEmitter | undefined,
  pluginId: string,
  operation: ExtensionPluginOperation,
  stage: ExtensionInstallStage,
  percent: number,
  message?: string,
  requestId?: string
) => {
  if (!emit || !stage) return
  emit({
    pluginId,
    operation,
    stage,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    message,
    requestId
  })
}
