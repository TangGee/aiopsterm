const envFlagEnabled = (name: string) => {
  try {
    const runtimeEnv = (globalThis as {
      __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined>
    }).__AIOPSTERM_RUNTIME_ENV__
    if (String(runtimeEnv?.[name] || '').trim() === '1') return true
    return typeof process !== 'undefined' && String(process.env?.[name] || '').trim() === '1'
  } catch {
    return false
  }
}

export const shouldUseAiChatBackendDouble = () => envFlagEnabled('AIOPSTERM_AI_CHAT_BACKEND_DOUBLE')

export const shouldUseAliasesSeedData = () => envFlagEnabled('AIOPSTERM_ALIASES_ENABLE_SEED')

export const shouldUseAiTodoSeedData = () => envFlagEnabled('AIOPSTERM_AI_TODO_ENABLE_SEED')

export const shouldUseAssetsSeedData = () => envFlagEnabled('AIOPSTERM_ASSETS_ENABLE_SEED')

export const shouldUseChatHistorySeedData = () => envFlagEnabled('AIOPSTERM_CHAT_HISTORY_ENABLE_SEED')

export const shouldUseDataSyncBackendDouble = () => envFlagEnabled('AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE')

export const shouldUseDatabaseAiBackendDouble = () => envFlagEnabled('AIOPSTERM_DB_AI_BACKEND_DOUBLE')

export const shouldUseDatabaseSeedData = () => envFlagEnabled('AIOPSTERM_DATABASE_ENABLE_SEED')

export const shouldUseE2eDialogFixtures = () => envFlagEnabled('AIOPSTERM_E2E_DIALOG_FIXTURES')

export const shouldUseFilesSeedData = () => envFlagEnabled('AIOPSTERM_FILES_ENABLE_SEED')

export const shouldUseKnowledgeSeedData = () => envFlagEnabled('AIOPSTERM_KNOWLEDGE_ENABLE_SEED')

export const shouldUseKubernetesSeedData = () => envFlagEnabled('AIOPSTERM_KUBERNETES_ENABLE_SEED')

export const shouldUseMcpSeedData = () => envFlagEnabled('AIOPSTERM_MCP_ENABLE_SEED')

export const shouldUseModelSettingsSeedData = () => envFlagEnabled('AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED')

export const shouldUseQuickCommandsSeedData = () => envFlagEnabled('AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED')

export const shouldRunMcpDiscovery = () => !envFlagEnabled('AIOPSTERM_MCP_DISCOVERY_DISABLE')

export const shouldUseSettingsPreferencesSeedData = () => envFlagEnabled('AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED')

export const shouldUseSkillsSeedData = () => envFlagEnabled('AIOPSTERM_SKILLS_ENABLE_SEED')

export const shouldUseSshTerminalBackendDouble = () => envFlagEnabled('AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE')

export const shouldUseThreadedTerminal = () => envFlagEnabled('AIOPSTERM_THREADED_TERMINAL')

export const shouldUseUserAccountCodeBackendDouble = () => envFlagEnabled('AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE')

export const shouldUseUserAccountSeedData = () => envFlagEnabled('AIOPSTERM_USER_ACCOUNT_ENABLE_SEED')

export const shouldUseUserExternalOpenBackendDouble = () => envFlagEnabled('AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE')

export const shouldUseWorkspacePreferencesSeedData = () => envFlagEnabled('AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED')
