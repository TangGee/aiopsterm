import { X } from 'lucide-vue-next'
import SettingsPanel from '@/components/panels/SettingsPanel.vue'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide.vue'
import { createSettingsWorkspaceAdvancedPages } from '@/services/settingsWorkspaceAdvancedPagesRuntime'
import { createSettingsWorkspaceGeneralTerminalPages } from '@/services/settingsWorkspaceGeneralTerminalPagesRuntime'
import { createSettingsWorkspaceModelAiPages } from '@/services/settingsWorkspaceModelAiPagesRuntime'
import { createSettingsWorkspacePageContext } from '@/services/settingsWorkspacePageContext'
import type { SettingsWorkspaceStore, SettingsWorkspaceTranslate } from '@/services/settingsWorkspacePageContext'

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
