<template>
  <section
    class="settings-workspace"
    data-ui-focus-scope="settings"
    data-ui-focus-primary
    tabindex="-1"
  >
    <header class="settings-workspace-title">
      <h2>{{ t('common.settings') }}</h2>
      <button
        class="settings-tab-close"
        :title="t('common.close')"
        @click="workspace.setActiveModule('workspace')"
      >
        <X />
      </button>
    </header>

    <main class="settings-workspace-body">
      <SettingsPanel />

      <div class="settings-content-scroll">
        <section
          v-if="workspace.onboardingGuideOpen"
          class="settings-content-page"
        >
          <OnboardingGuide />
        </section>

        <section
          v-else-if="workspace.keywordHighlightEditorOpen"
          class="settings-content-page keyword-highlight-page"
        >
          <KeywordHighlightEditorPage />
        </section>

        <section
          v-else-if="workspace.securityConfigEditorOpen"
          class="settings-content-page security-config-page"
        >
          <SecurityConfigEditorPage />
        </section>

        <section
          v-else-if="workspace.mcpConfigEditorOpen"
          class="settings-content-page mcp-config-page"
        >
          <McpConfigEditorPage />
        </section>

        <section
          v-else-if="workspace.settingsDocumentationOpen"
          class="settings-content-page settings-documentation-page"
        >
          <SettingsDocumentationReaderPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'general'"
          class="settings-content-page"
          data-onboarding-id="settings-general-content"
        >
          <GeneralSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'terminal'"
          class="settings-content-page"
          data-onboarding-id="settings-terminal-options"
        >
          <TerminalSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'models'"
          class="settings-content-page"
        >
          <ModelSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'aiNotifications'"
          class="settings-content-page"
        >
          <AiNotificationSettings />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'exportMcp'"
          class="settings-content-page"
        >
          <ExportMcpSettingsPage />
        </section>

        <section
          v-else-if="isAiAgentSettingsSection"
          class="settings-content-page"
          data-onboarding-id="settings-ai-remote-host-management-content"
        >
          <div class="settings-agent-tabs settings-tab-bar">
            <button
              v-for="item in aiAgentSettingsTabs"
              :key="item.key"
              :class="{ active: workspace.activeSettingsSection === item.key }"
              @click="workspace.setActiveSettingsSection(item.key)"
            >
              {{ t(item.labelKey) }}
            </button>
          </div>
          <McpSettingsPage v-if="workspace.activeSettingsSection === 'mcp'" />
          <SkillsSettingsPage v-else-if="workspace.activeSettingsSection === 'skills'" />
          <RulesSettingsPage v-else-if="workspace.activeSettingsSection === 'rules'" />
          <AiRemoteHostManagementSettings v-else />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'extensions'"
          class="settings-content-page"
        >
          <ExtensionSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'billing'"
          class="settings-content-page"
        >
          <BillingSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'shortcuts'"
          class="settings-content-page"
        >
          <ShortcutsSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'trustedDevices'"
          class="settings-content-page"
        >
          <TrustedDevicesSettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'privacy'"
          class="settings-content-page"
        >
          <PrivacySettingsPage />
        </section>

        <section
          v-else-if="workspace.activeSettingsSection === 'about'"
          class="settings-content-page"
        >
          <AboutSettingsPage />
        </section>

        <section
          v-else
          class="settings-content-page"
        >
          <GeneralSettings />
        </section>
      </div>
    </main>

    <div
      v-if="workspace.settingsNotice"
      class="settings-toast"
    >
      {{ workspace.settingsNotice }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { I18nKey } from '@/i18n'
import type { SettingSectionKey } from '@/config/settings'
import { useSettingsWorkspaceContainerRuntime } from '@/services/settings/settingsWorkspaceContainerRuntime'

const {
  AboutSettingsPage,
  AiNotificationSettings,
  AiRemoteHostManagementSettings,
  BillingSettingsPage,
  ExtensionSettingsPage,
  ExportMcpSettingsPage,
  GeneralSettings,
  KeywordHighlightEditorPage,
  McpConfigEditorPage,
  McpSettingsPage,
  ModelSettings,
  OnboardingGuide,
  PrivacySettingsPage,
  RulesSettingsPage,
  SecurityConfigEditorPage,
  SettingsDocumentationReaderPage,
  SettingsPanel,
  ShortcutsSettingsPage,
  SkillsSettingsPage,
  TerminalSettings,
  TrustedDevicesSettingsPage,
  X,
  t,
  workspace,
} = useSettingsWorkspaceContainerRuntime()

const aiAgentSettingsTabs: Array<{ key: SettingSectionKey; labelKey: I18nKey }> = [
  { key: 'aiRemoteHostManagement', labelKey: 'settings.ai.agentManagement.conversationAndHosts' },
  { key: 'mcp', labelKey: 'settings.nav.mcp' },
  { key: 'skills', labelKey: 'settings.nav.skills' },
  { key: 'rules', labelKey: 'settings.nav.rules' }
]
const aiAgentSettingsSections = new Set<SettingSectionKey>(aiAgentSettingsTabs.map((item) => item.key))
const isAiAgentSettingsSection = computed(() => aiAgentSettingsSections.has(workspace.activeSettingsSection))
</script>
