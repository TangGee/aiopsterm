import { agentHookClient } from '@/services/settings/agentHookClient'
import {
  isAgentHookInstallOperationData,
  isAgentHookInstallerSnapshot
} from '@/services/ai/managedAiBackendGuards'
import type { I18nKey } from '@/i18n/messages'
import type { AgentHookInstallerSource, AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { WorkspaceManagedAiControllerState } from '@/services/ai/workspaceManagedAiTypes'

export const createWorkspaceAgentHookInstallerRuntime = (input: {
  state: Pick<
    WorkspaceManagedAiControllerState,
    'agentHookInstallers' | 'agentHookInstallersLoading' | 'agentHookInstallerBusySource' | 'agentHookInstallerError'
  >
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
}) => {
  const { state, setTopNotice, i18nText } = input
  const { agentHookInstallers, agentHookInstallersLoading, agentHookInstallerBusySource, agentHookInstallerError } = state

  const applyAgentHookInstallerSnapshot = (snapshot: { installers: AgentHookInstallerStatus[] }) => {
    agentHookInstallers.value = snapshot.installers.map((installer) => ({
      ...installer,
      warnings: [...installer.warnings]
    }))
    agentHookInstallerError.value = ''
  }

  const refreshAgentHookInstallers = async (options: { silent?: boolean } = {}) => {
    const listAgentHookInstallers = agentHookClient.listAgentHookInstallers()
    if (!listAgentHookInstallers) {
      agentHookInstallerError.value = i18nText('settings.ai.agentHook.serviceUnavailable')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    }
    agentHookInstallersLoading.value = true
    try {
      const result = await listAgentHookInstallers()
      if (!result?.ok) {
        agentHookInstallerError.value = result?.errorMessage || i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      if (!isAgentHookInstallerSnapshot(result.data)) {
        agentHookInstallerError.value = i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('settings.ai.agentHook.statusRefreshed'))
      return true
    } catch (error) {
      agentHookInstallerError.value = error instanceof Error ? error.message : i18nText('settings.ai.agentHook.statusLoadFailed')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    } finally {
      agentHookInstallersLoading.value = false
    }
  }

  const runAgentHookInstallerOperation = async (source: AgentHookInstallerSource, operation: 'install' | 'uninstall') => {
    const runOperation = operation === 'install' ? agentHookClient.installAgentHook() : agentHookClient.uninstallAgentHook()
    if (!runOperation) {
      setTopNotice(i18nText('settings.ai.agentHook.serviceUnavailable'))
      return false
    }
    agentHookInstallerBusySource.value = source
    agentHookInstallerError.value = ''
    try {
      const result = await runOperation({ source })
      if (!result?.ok) {
        const message =
          result?.errorMessage ||
          (operation === 'install'
            ? i18nText('settings.ai.agentHook.installFailed')
            : i18nText('settings.ai.agentHook.uninstallFailed'))
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      if (!isAgentHookInstallOperationData(result.data)) {
        const message =
          operation === 'install'
            ? i18nText('settings.ai.agentHook.installMalformed')
            : i18nText('settings.ai.agentHook.uninstallMalformed')
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data.snapshot)
      setTopNotice(
        i18nText(operation === 'install' ? 'settings.ai.agentHook.installedNotice' : 'settings.ai.agentHook.uninstalledNotice', {
          label: result.data.status.label
        })
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : operation === 'install'
            ? i18nText('settings.ai.agentHook.installFailed')
            : i18nText('settings.ai.agentHook.uninstallFailed')
      agentHookInstallerError.value = message
      setTopNotice(message)
      return false
    } finally {
      agentHookInstallerBusySource.value = ''
    }
  }

  return {
    refreshAgentHookInstallers,
    installAgentHookInstaller: (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'install'),
    uninstallAgentHookInstaller: (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'uninstall')
  }
}
