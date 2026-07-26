import type { AiopsMutationResult } from './common'

export type ExtensionUserConfig = {
  autoCompleteStatus: boolean
  quickVimStatus: boolean
  highlightStatus: boolean
}

export type ExtensionInstallStage = 'downloading' | 'verifying' | 'installing' | 'done' | 'error' | 'cancelled' | ''

export type ExtensionPluginSource = 'preinstalled' | 'store' | 'local'

export type ExtensionIconKey = 'jumpserver' | 'runbook' | 'cloud' | 'private' | 'local'

export type ExtensionFunctionConfig = {
  title: string
  desc: string
}

export type ExtensionConnectionLogConfig = {
  time: string
  status: 'progress' | 'success' | 'error'
  message: string
}

export type ExtensionPluginRuntimeConfig = {
  pluginId: string
  name: string
  description: string
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
  detailSummary?: string
  guideSteps?: string[]
  connectionLog?: ExtensionConnectionLogConfig[]
}

export type ExtensionPluginOperation = 'install' | 'update' | 'uninstall' | 'package'

export type ExtensionPluginOperationInput = {
  plugin: ExtensionPluginRuntimeConfig
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
