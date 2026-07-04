import { exportMcpClient } from '@/services/settings/exportMcpClient'
import {
  isExportMcpInstallOperationData,
  isExportMcpInstallerSnapshot
} from '@/services/ai/managedAiBackendGuards'
import type { I18nKey } from '@/i18n/messages'
import type { ExportMcpClientSource, ExportMcpClientStatus, ExportMcpCopyConfigKind, ExportMcpInstallerSnapshot } from '@shared/contracts/exportMcp'
import type { WorkspaceManagedAiControllerState } from '@/services/ai/workspaceManagedAiTypes'

export const createWorkspaceExportMcpInstallerRuntime = (input: {
  state: Pick<
    WorkspaceManagedAiControllerState,
    'exportMcpInstallers' | 'exportMcpInstallerBridge' | 'exportMcpInstallersLoading' | 'exportMcpInstallerBusySource' | 'exportMcpInstallerError'
  >
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
}) => {
  const { state, setTopNotice, i18nText } = input
  const {
    exportMcpInstallers,
    exportMcpInstallerBridge,
    exportMcpInstallersLoading,
    exportMcpInstallerBusySource,
    exportMcpInstallerError
  } = state

  const applyExportMcpInstallerSnapshot = (snapshot: ExportMcpInstallerSnapshot) => {
    exportMcpInstallerBridge.value = { ...snapshot.bridge }
    exportMcpInstallers.value = snapshot.clients.map((client: ExportMcpClientStatus) => ({
      ...client,
      bridge: { ...client.bridge },
      warnings: [...client.warnings]
    }))
    exportMcpInstallerError.value = ''
  }

  const refreshExportMcpInstallers = async (options: { silent?: boolean } = {}) => {
    const listExportMcpInstallers = exportMcpClient.listExportMcpInstallers()
    if (!listExportMcpInstallers) {
      exportMcpInstallerError.value = i18nText('settings.ai.exportMcp.serviceUnavailable')
      if (!options.silent) setTopNotice(exportMcpInstallerError.value)
      return false
    }
    exportMcpInstallersLoading.value = true
    try {
      const result = await listExportMcpInstallers()
      if (!result?.ok) {
        exportMcpInstallerError.value = result?.errorMessage || i18nText('settings.ai.exportMcp.statusLoadFailed')
        if (!options.silent) setTopNotice(exportMcpInstallerError.value)
        return false
      }
      if (!isExportMcpInstallerSnapshot(result.data)) {
        exportMcpInstallerError.value = i18nText('settings.ai.exportMcp.statusLoadFailed')
        if (!options.silent) setTopNotice(exportMcpInstallerError.value)
        return false
      }
      applyExportMcpInstallerSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('settings.ai.exportMcp.statusRefreshed'))
      return true
    } catch (error) {
      exportMcpInstallerError.value = error instanceof Error ? error.message : i18nText('settings.ai.exportMcp.statusLoadFailed')
      if (!options.silent) setTopNotice(exportMcpInstallerError.value)
      return false
    } finally {
      exportMcpInstallersLoading.value = false
    }
  }

  const runExportMcpInstallerOperation = async (source: ExportMcpClientSource, operation: 'install' | 'uninstall') => {
    const runOperation = operation === 'install' ? exportMcpClient.installExportMcp() : exportMcpClient.uninstallExportMcp()
    if (!runOperation) {
      setTopNotice(i18nText('settings.ai.exportMcp.serviceUnavailable'))
      return false
    }
    exportMcpInstallerBusySource.value = source
    exportMcpInstallerError.value = ''
    try {
      const result = await runOperation({ source })
      if (!result?.ok) {
        const message =
          result?.errorMessage ||
          (operation === 'install'
            ? i18nText('settings.ai.exportMcp.installFailed')
            : i18nText('settings.ai.exportMcp.uninstallFailed'))
        exportMcpInstallerError.value = message
        setTopNotice(message)
        return false
      }
      if (!isExportMcpInstallOperationData(result.data)) {
        const message =
          operation === 'install'
            ? i18nText('settings.ai.exportMcp.installMalformed')
            : i18nText('settings.ai.exportMcp.uninstallMalformed')
        exportMcpInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyExportMcpInstallerSnapshot(result.data.snapshot)
      setTopNotice(
        i18nText(operation === 'install' ? 'settings.ai.exportMcp.installedNotice' : 'settings.ai.exportMcp.uninstalledNotice', {
          label: result.data.status.label
        })
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : operation === 'install'
            ? i18nText('settings.ai.exportMcp.installFailed')
            : i18nText('settings.ai.exportMcp.uninstallFailed')
      exportMcpInstallerError.value = message
      setTopNotice(message)
      return false
    } finally {
      exportMcpInstallerBusySource.value = ''
    }
  }

  const copyExportMcpConfig = async (kind: ExportMcpCopyConfigKind) => {
    const copyConfig = exportMcpClient.copyExportMcpConfig()
    if (!copyConfig) {
      setTopNotice(i18nText('settings.ai.exportMcp.serviceUnavailable'))
      return false
    }
    try {
      const result = await copyConfig({ kind })
      if (!result?.ok) {
        const message = result?.errorMessage || i18nText('settings.ai.exportMcp.copyConfigFailed')
        exportMcpInstallerError.value = message
        setTopNotice(message)
        return false
      }
      setTopNotice(i18nText('settings.ai.exportMcp.copyConfigCopied'))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nText('settings.ai.exportMcp.copyConfigFailed')
      exportMcpInstallerError.value = message
      setTopNotice(message)
      return false
    }
  }

  const resetExportMcpToken = async () => {
    const resetToken = exportMcpClient.resetExportMcpToken()
    if (!resetToken) {
      setTopNotice(i18nText('settings.ai.exportMcp.serviceUnavailable'))
      return false
    }
    exportMcpInstallersLoading.value = true
    exportMcpInstallerError.value = ''
    try {
      const result = await resetToken()
      if (!result?.ok || !isExportMcpInstallerSnapshot(result.data?.snapshot)) {
        const message = result?.errorMessage || i18nText('settings.ai.exportMcp.resetTokenFailed')
        exportMcpInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyExportMcpInstallerSnapshot(result.data.snapshot)
      setTopNotice(i18nText('settings.ai.exportMcp.resetTokenNotice'))
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nText('settings.ai.exportMcp.resetTokenFailed')
      exportMcpInstallerError.value = message
      setTopNotice(message)
      return false
    } finally {
      exportMcpInstallersLoading.value = false
    }
  }

  return {
    refreshExportMcpInstallers,
    installExportMcpInstaller: (source: ExportMcpClientSource) => runExportMcpInstallerOperation(source, 'install'),
    uninstallExportMcpInstaller: (source: ExportMcpClientSource) => runExportMcpInstallerOperation(source, 'uninstall'),
    copyExportMcpConfig,
    resetExportMcpToken
  }
}
