import type { ExtensionInstallStage, ExtensionPluginRuntimeConfig } from '@shared/contracts/extensions'

export const extensionPluginSourceText = (plugin: ExtensionPluginRuntimeConfig) => {
  if (plugin.source === 'builtin') return 'Built-in'
  if (plugin.source === 'local') return 'Local'
  return 'Store'
}

export const formatExtensionPluginSize = (size?: number) => {
  if (!size) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export const extensionInstallStageText = (stage?: ExtensionInstallStage) => {
  if (stage === 'downloading') return 'Downloading'
  if (stage === 'verifying') return 'Verifying'
  if (stage === 'installing') return 'Installing'
  if (stage === 'done') return 'Done'
  if (stage === 'cancelled') return 'Cancelled'
  if (stage === 'error') return 'Error'
  return ''
}

export const extensionPluginVersion = (plugin: ExtensionPluginRuntimeConfig) => plugin.installedVersion || plugin.latestVersion || '0.0.0'

export const extensionPluginTags = (plugin: ExtensionPluginRuntimeConfig) =>
  plugin.categories || [plugin.source || 'store', plugin.installed ? 'installed' : 'available']
