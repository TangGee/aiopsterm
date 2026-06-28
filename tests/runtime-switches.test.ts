import { afterEach, describe, expect, it } from 'vitest'
import {
  shouldRunMcpDiscovery,
  shouldUseAiChatBackendDouble,
  shouldUseAliasesSeedData,
  shouldUseAiTodoSeedData,
  shouldUseAssetsSeedData,
  shouldUseChatHistorySeedData,
  shouldUseDataSyncBackendDouble,
  shouldUseDatabaseAiBackendDouble,
  shouldUseDatabaseSeedData,
  shouldUseE2eDialogFixtures,
  shouldUseFilesSeedData,
  shouldUseKnowledgeSeedData,
  shouldUseKubernetesSeedData,
  shouldUseMcpSeedData,
  shouldUseModelSettingsSeedData,
  shouldUseQuickCommandsSeedData,
  shouldUseSettingsPreferencesSeedData,
  shouldUseSkillsSeedData,
  shouldUseSshTerminalBackendDouble,
  shouldUseTerminalDebugLogs,
  shouldUseTerminalStressHarness,
  shouldUseThreadedTerminal,
  shouldUseUserAccountCodeBackendDouble,
  shouldUseUserAccountSeedData,
  shouldUseUserExternalOpenBackendDouble,
  shouldUseWorkspacePreferencesSeedData
} from '../src/shared/runtimeSwitches'

const originalNodeEnv = process.env.NODE_ENV
const originalRuntimeEnv = (globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__
const runtimeSwitches = [
  ['AIOPSTERM_AI_CHAT_BACKEND_DOUBLE', shouldUseAiChatBackendDouble],
  ['AIOPSTERM_ALIASES_ENABLE_SEED', shouldUseAliasesSeedData],
  ['AIOPSTERM_AI_TODO_ENABLE_SEED', shouldUseAiTodoSeedData],
  ['AIOPSTERM_ASSETS_ENABLE_SEED', shouldUseAssetsSeedData],
  ['AIOPSTERM_CHAT_HISTORY_ENABLE_SEED', shouldUseChatHistorySeedData],
  ['AIOPSTERM_DATA_SYNC_BACKEND_DOUBLE', shouldUseDataSyncBackendDouble],
  ['AIOPSTERM_DATABASE_ENABLE_SEED', shouldUseDatabaseSeedData],
  ['AIOPSTERM_DB_AI_BACKEND_DOUBLE', shouldUseDatabaseAiBackendDouble],
  ['AIOPSTERM_E2E_DIALOG_FIXTURES', shouldUseE2eDialogFixtures],
  ['AIOPSTERM_FILES_ENABLE_SEED', shouldUseFilesSeedData],
  ['AIOPSTERM_KNOWLEDGE_ENABLE_SEED', shouldUseKnowledgeSeedData],
  ['AIOPSTERM_KUBERNETES_ENABLE_SEED', shouldUseKubernetesSeedData],
  ['AIOPSTERM_MCP_ENABLE_SEED', shouldUseMcpSeedData],
  ['AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED', shouldUseModelSettingsSeedData],
  ['AIOPSTERM_QUICK_COMMANDS_ENABLE_SEED', shouldUseQuickCommandsSeedData],
  ['AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED', shouldUseSettingsPreferencesSeedData],
  ['AIOPSTERM_SKILLS_ENABLE_SEED', shouldUseSkillsSeedData],
  ['AIOPSTERM_SSH_TERMINAL_BACKEND_DOUBLE', shouldUseSshTerminalBackendDouble],
  ['AIOPSTERM_TERMINAL_DEBUG_LOGS', shouldUseTerminalDebugLogs],
  ['AIOPSTERM_TERMINAL_STRESS', shouldUseTerminalStressHarness],
  ['AIOPSTERM_THREADED_TERMINAL', shouldUseThreadedTerminal],
  ['AIOPSTERM_USER_ACCOUNT_CODE_BACKEND_DOUBLE', shouldUseUserAccountCodeBackendDouble],
  ['AIOPSTERM_USER_ACCOUNT_ENABLE_SEED', shouldUseUserAccountSeedData],
  ['AIOPSTERM_USER_EXTERNAL_OPEN_BACKEND_DOUBLE', shouldUseUserExternalOpenBackendDouble],
  ['AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED', shouldUseWorkspacePreferencesSeedData]
] as const
const originalSwitchValues = Object.fromEntries(runtimeSwitches.map(([name]) => [name, process.env[name]]))
const originalMcpDiscoveryDisable = process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE

describe('runtime switch boundaries', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalRuntimeEnv === undefined) {
      delete (globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__
    } else {
      ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = originalRuntimeEnv
    }
    runtimeSwitches.forEach(([name]) => {
      const value = originalSwitchValues[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
    if (originalMcpDiscoveryDisable === undefined) {
      delete process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE
    } else {
      process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE = originalMcpDiscoveryDisable
    }
  })

  it('does not infer explicit runtime switches from NODE_ENV=test or truthy strings', () => {
    process.env.NODE_ENV = 'test'
    runtimeSwitches.forEach(([name, read]) => {
      delete process.env[name]
      expect(read(), name).toBe(false)

      process.env[name] = 'true'
      expect(read(), name).toBe(false)

      process.env[name] = ' 1 '
      expect(read(), name).toBe(true)
    })
  })

  it('accepts explicit renderer runtime env injected outside process.env', () => {
    runtimeSwitches.forEach(([name, read]) => {
      delete process.env[name]
      ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = {
        [name]: 'true'
      }
      expect(read(), name).toBe(false)

      ;(globalThis as { __AIOPSTERM_RUNTIME_ENV__?: Record<string, string | undefined> }).__AIOPSTERM_RUNTIME_ENV__ = {
        [name]: '1'
      }
      expect(read(), name).toBe(true)
    })
  })

  it('runs MCP discovery by default in NODE_ENV=test unless explicitly disabled', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE

    expect(shouldRunMcpDiscovery()).toBe(true)

    process.env.AIOPSTERM_MCP_DISCOVERY_DISABLE = '1'
    expect(shouldRunMcpDiscovery()).toBe(false)
  })
})
