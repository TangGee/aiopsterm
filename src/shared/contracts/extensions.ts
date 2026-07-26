import type { AiopsMutationResult } from './common'
import type { AiopsAssetRecord } from './assets'

export type ExtensionUserConfig = {
  autoCompleteStatus: boolean
  quickVimStatus: boolean
  highlightStatus: boolean
}

export type ExtensionInstallStage = 'downloading' | 'verifying' | 'installing' | 'done' | 'error' | 'cancelled' | ''

export type ExtensionPluginSource = 'builtin' | 'store' | 'local' | 'development'

export type ExtensionPluginKind = 'content' | 'provider' | 'runtime'

export type ExtensionRuntimeStatus = 'inactive' | 'activating' | 'active' | 'disabled' | 'error'

export type ExtensionIconKey = 'runbook' | 'cloud' | 'private' | 'local'

export type ExtensionFunctionConfig = {
  title: string
  desc: string
}

export type ExtensionCommandContribution = {
  id: string
  title: string
  description: string
  command?: string
}

export type ExtensionViewContribution = {
  id: string
  name: string
  icon?: string
  location?: 'sidebar' | 'extensions'
}

export type ExtensionMenuContribution = {
  command: string
  when?: string
  group?: string
}

export type ExtensionViewWelcomeContribution = {
  view: string
  content: string
  when?: string
}

export type ExtensionConfigurationFieldType = 'text' | 'password' | 'textarea' | 'checkbox' | 'select'

export type ExtensionConfigurationField = {
  key: string
  title: string
  description?: string
  type: ExtensionConfigurationFieldType
  required?: boolean
  defaultValue?: string | boolean
  options?: Array<{ label: string; value: string }>
}

export type ExtensionConfigurationContribution = {
  title: string
  properties: ExtensionConfigurationField[]
}

export type ExtensionProviderField = {
  key: string
  label: string
  type: 'textarea'
  required: boolean
  defaultValue?: string
}

export type ExtensionAssetProviderContribution = {
  id: string
  name: string
  description: string
  adapter: 'json-assets' | 'runtime'
  fields: ExtensionProviderField[]
}

export type ExtensionBastionProviderContribution = {
  type: string
  displayName: string
  description?: string
  authPolicy?: 'password' | 'keyBased' | 'either'
  supportsRefresh?: boolean
  supportsShell?: boolean
}

export type ExtensionRegisteredBastionDefinition = ExtensionBastionProviderContribution & {
  pluginId: string
}

export type ExtensionTreeItem = {
  id: string
  label: string
  description?: string
  tooltip?: string
  icon?: string
  collapsibleState?: 'none' | 'collapsed' | 'expanded'
  contextValue?: string
  command?: string
  commandArgs?: unknown[]
}

export type ExtensionTreeChildrenInput = {
  viewId: string
  parentId?: string
}

export type ExtensionTreeChildrenResult = AiopsMutationResult<{
  viewId: string
  parentId?: string
  items: ExtensionTreeItem[]
}>

export type ExtensionCommandExecuteInput = {
  commandId: string
  args?: unknown[]
  workspaceId?: string
}

export type ExtensionCommandExecuteResult = AiopsMutationResult<{
  commandId: string
  value?: unknown
}>

export type ExtensionContextSnapshotResult = AiopsMutationResult<Record<string, boolean | string | number>>

export type ExtensionConfigurationValue = string | boolean

export type ExtensionConfigurationGetResult = AiopsMutationResult<Record<string, ExtensionConfigurationValue>>

export type ExtensionConfigurationUpdateInput = {
  pluginId: string
  values: Record<string, ExtensionConfigurationValue>
}

export type ExtensionRuntimeAction = 'enable' | 'disable' | 'reload'

export type ExtensionRuntimeActionInput = {
  pluginId: string
  action: ExtensionRuntimeAction
}

export type ExtensionRuntimeActionResult = AiopsMutationResult<{
  plugin: ExtensionPluginRuntimeConfig
  message: string
}>

export type ExtensionRuntimeEvent =
  | { type: 'catalog-changed'; pluginId?: string }
  | { type: 'runtime-changed'; pluginId: string; status: ExtensionRuntimeStatus; errorMessage?: string }
  | { type: 'view-refresh'; pluginId: string; viewId: string }
  | { type: 'context-changed'; pluginId: string; key: string; value: boolean | string | number }
  | { type: 'message'; pluginId: string; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'provider-progress'; pluginId: string; providerId: string; percent: number; message?: string }

export type ExtensionConnectionLogConfig = {
  time: string
  status: 'progress' | 'success' | 'error'
  message: string
}

export type ExtensionPluginRuntimeConfig = {
  pluginId: string
  name: string
  description: string
  kind: ExtensionPluginKind
  iconKey: ExtensionIconKey
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  required?: boolean
  isDraggedOnly?: boolean
  source?: ExtensionPluginSource
  isPrivate?: boolean
  lastUpdated?: string
  installedAt?: string
  packagePath?: string
  storePackagePath?: string
  packageUrl?: string
  packageSha256?: string
  subscriptionUrl?: string
  size?: number
  readme?: string
  categories?: string[]
  functions?: ExtensionFunctionConfig[]
  commands?: ExtensionCommandContribution[]
  assetProviders?: ExtensionAssetProviderContribution[]
  detailSummary?: string
  guideSteps?: string[]
  connectionLog?: ExtensionConnectionLogConfig[]
  manifestVersion?: 1 | 2
  main?: string
  activationEvents?: string[]
  enabled?: boolean
  runtimeStatus?: ExtensionRuntimeStatus
  runtimeError?: string
  views?: ExtensionViewContribution[]
  menus?: Record<string, ExtensionMenuContribution[]>
  viewsWelcome?: ExtensionViewWelcomeContribution[]
  configuration?: ExtensionConfigurationContribution
  bastionProviders?: ExtensionBastionProviderContribution[]
  installHint?: string
}

export type ExtensionPluginOperation = 'install' | 'update' | 'uninstall' | 'package'

export type ExtensionPluginOperationInput = {
  plugin: ExtensionPluginRuntimeConfig
  removeData?: boolean
}

export type ExtensionSubscriptionInput = {
  plugin: ExtensionPluginRuntimeConfig
}

export type ExtensionPackageInstallInput = {
  fileName: string
  filePath?: string
  size?: number
  existingPluginIds?: string[]
  requestId?: string
}

export type ExtensionPackageDownloadInput = {
  pluginId?: string
  url: string
}

export type ExtensionPackageDownloadResult = AiopsMutationResult<{
  url: string
  bytes: number
  data: number[]
}>

export type ExtensionPluginUrlInstallInput = {
  pluginId: string
  version?: string
  fileName?: string
  url: string
  sha256?: string
}

export type ExtensionInstallProgress = {
  pluginId: string
  stage: ExtensionInstallStage
  percent: number
  operation: ExtensionPluginOperation
  message?: string
  requestId?: string
}

export type ExtensionPluginOperationResult = AiopsMutationResult<{
  operation: ExtensionPluginOperation
  plugin: ExtensionPluginRuntimeConfig
  message: string
}>

export type ExtensionPluginListResult = AiopsMutationResult<ExtensionPluginRuntimeConfig[]>

export type ExtensionSubscriptionResult = AiopsMutationResult<{
  pluginId: string
  url: string
  message: string
}>

export type ExtensionPluginCancelResult = AiopsMutationResult<{
  pluginId: string
  stage: Extract<ExtensionInstallStage, 'cancelled'>
  percent: 0
  message: string
}>

export type ExtensionAssetProviderSyncInput = {
  pluginId: string
  providerId: string
  values: Record<string, string>
}

export type ExtensionAssetProviderSyncResult = AiopsMutationResult<{
  pluginId: string
  providerId: string
  imported: number
  assets: AiopsAssetRecord[]
}>

export type ExtensionAssetProviderCancelInput = {
  pluginId: string
  providerId: string
}

export type ExtensionAssetProviderCancelResult = AiopsMutationResult<{
  pluginId: string
  providerId: string
  cancelled: boolean
}>
