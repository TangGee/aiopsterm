import { X } from 'lucide-vue-next'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'
import { createSettingsWorkspaceAdvancedPages } from '@/services/settings/settingsWorkspaceAdvancedPagesRuntime'
import { createSettingsWorkspaceGeneralTerminalPages } from '@/services/settings/settingsWorkspaceGeneralTerminalPagesRuntime'
import { createSettingsWorkspaceModelAiPages } from '@/services/settings/settingsWorkspaceModelAiPagesRuntime'
import { createSettingsWorkspacePageContext } from '@/services/settings/settingsWorkspacePageContext'
import type { SettingsWorkspaceStore, SettingsWorkspaceTranslate } from '@/services/settings/settingsWorkspacePageContext'

export const createSettingsWorkspacePages = (workspace: SettingsWorkspaceStore, t: SettingsWorkspaceTranslate) => {
  const context = createSettingsWorkspacePageContext(workspace, t)

  return {
    ...createSettingsWorkspaceAdvancedPages(workspace, t, context),
    ...createSettingsWorkspaceGeneralTerminalPages(workspace, t, context),
    ...createSettingsWorkspaceModelAiPages(workspace, t, context),
    OnboardingGuide,
    SettingsDocumentationReaderPage: context.SettingsDocumentationReaderPage,
    SettingsPanel,
    X
  }
}
