import { useI18n } from '@/i18n'
import { createSettingsWorkspacePages } from '@/services/settingsWorkspacePagesRuntime'
import { useWorkspaceStore } from '@/stores/workspace'

export const useSettingsWorkspaceContainerRuntime = () => {
  const workspace = useWorkspaceStore()
  const { t } = useI18n()

  return {
    ...createSettingsWorkspacePages(workspace, t),
    t,
    workspace
  }
}
