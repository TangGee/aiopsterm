import { isLocaleSetting } from '@/i18n/runtime'
import type { CustomBackgroundSaveResult } from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import {
  backgroundModeValues,
  defaultAiPreferences,
  defaultConfig,
  defaultEditorSettings,
  defaultExportMcpSettings,
  defaultExtensionSettings,
  defaultNotificationSettings,
  defaultQuickCommands,
  defaultTerminalSettings,
  defaultWorkspacePreferences,
  layoutWidthLimits,
  ONBOARDING_VERSION,
  onboardingModuleIds
} from './workspaceConfigDefaults'
import {
  normalizeAiPreferencesConfig,
  normalizeModelSettingsConfig
} from './workspaceConfigAiModelRuntime'
import {
  normalizeEditorSettingsConfig,
  normalizeExtensionSettingsConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs
} from './workspaceConfigPreferenceRuntime'
import {
  normalizeAliasCommandsConfig,
  normalizeKnowledgeBaseConfig,
  normalizeMcpServersConfig,
  normalizeRulesConfig,
  normalizeShortcutsConfig,
  normalizeSkillsConfig
} from './workspaceConfigResourceRuntime'
import {
  normalizeKeywordHighlightConfig,
  normalizeNotificationConfig,
  normalizePrivacyConfig,
  normalizeSecurityConfig
} from './workspaceConfigSecurityRuntime'
import { isNonEmptyString, isRecord, numberInRange, stringFromOptions } from './workspaceConfigPrimitives'

export type GeneralBaseSettingsPatch = Partial<Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'>>
export type LayoutPreferencesPatch = Partial<
  Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'>
>
export type BackgroundUserConfig = UserConfig['background']

export const normalizeUserModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'local') return 'local'
  if (
    provider === 'litellm' ||
    provider === 'openai-compatible' ||
    provider === 'ollama' ||
    provider === 'lmstudio' ||
    provider === 'bedrock' ||
    provider === 'deepseek' ||
    provider === 'anthropic'
  ) {
    return provider
  }
  return defaultConfig.modelProvider
}

export const normalizeUserModelName = (value: unknown) => {
  const modelName = String(value || '').trim()
  if (!modelName) return defaultConfig.modelName
  return modelName
}

export const normalizeCatalogModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'default' || provider === 'local') return 'local'
  if (provider === 'openai') return 'openai-compatible'
  return normalizeUserModelProvider(provider)
}

const isDefaultModeValue = (value: unknown): value is UserConfig['defaultMode'] => value === 'terminal' || value === 'agents'

const isBooleanValue = (value: unknown): value is boolean => typeof value === 'boolean'

const isWatermarkValue = (value: unknown): value is UserConfig['watermark'] => value === 'open' || value === 'close'

const isSettingsLanguageValue = (value: unknown): value is string => isLocaleSetting(value)

export const normalizeGeneralBaseSettingsPatch = (patch: GeneralBaseSettingsPatch) => {
  const normalized: GeneralBaseSettingsPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.language !== undefined) {
    if (!isSettingsLanguageValue(patch.language)) return null
    normalized.language = patch.language
  }
  if (patch.watermark !== undefined) {
    if (!isWatermarkValue(patch.watermark)) return null
    normalized.watermark = patch.watermark
  }
  return normalized
}

export const generalBaseSettingsPatchMatches = (patch: GeneralBaseSettingsPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.language !== undefined && savedConfig.language !== patch.language) return false
  if (patch.watermark !== undefined && savedConfig.watermark !== patch.watermark) return false
  return true
}

export const isGeneralBaseSettingsSnapshot = (source: unknown): source is Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'> =>
  isRecord(source) && isDefaultModeValue(source.defaultMode) && isSettingsLanguageValue(source.language) && isWatermarkValue(source.watermark)

export const normalizeLayoutPreferencesPatch = (patch: LayoutPreferencesPatch) => {
  const normalized: LayoutPreferencesPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.leftPanelOpen !== undefined) {
    if (!isBooleanValue(patch.leftPanelOpen)) return null
    normalized.leftPanelOpen = patch.leftPanelOpen
  }
  if (patch.rightPanelOpen !== undefined) {
    if (!isBooleanValue(patch.rightPanelOpen)) return null
    normalized.rightPanelOpen = patch.rightPanelOpen
  }
  if (patch.agentsLeftOpen !== undefined) {
    if (!isBooleanValue(patch.agentsLeftOpen)) return null
    normalized.agentsLeftOpen = patch.agentsLeftOpen
  }
  if (patch.leftPanelWidth !== undefined) {
    const width = numberInRange(patch.leftPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.leftPanelWidth = Math.round(width)
  }
  if (patch.rightPanelWidth !== undefined) {
    const width = numberInRange(patch.rightPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.rightPanelWidth = Math.round(width)
  }
  if (patch.agentsLeftWidth !== undefined) {
    const width = numberInRange(patch.agentsLeftWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.agentsLeftWidth = Math.round(width)
  }
  return normalized
}

export const layoutPreferencesPatchMatches = (patch: LayoutPreferencesPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.leftPanelOpen !== undefined && savedConfig.leftPanelOpen !== patch.leftPanelOpen) return false
  if (patch.rightPanelOpen !== undefined && savedConfig.rightPanelOpen !== patch.rightPanelOpen) return false
  if (patch.agentsLeftOpen !== undefined && savedConfig.agentsLeftOpen !== patch.agentsLeftOpen) return false
  if (patch.leftPanelWidth !== undefined && savedConfig.leftPanelWidth !== patch.leftPanelWidth) return false
  if (patch.rightPanelWidth !== undefined && savedConfig.rightPanelWidth !== patch.rightPanelWidth) return false
  if (patch.agentsLeftWidth !== undefined && savedConfig.agentsLeftWidth !== patch.agentsLeftWidth) return false
  return true
}

const isLayoutWidthValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= layoutWidthLimits.min && value <= layoutWidthLimits.max

export const layoutWidthFromConfig = (value: unknown, fallback: number) => numberInRange(value, fallback, layoutWidthLimits.min, layoutWidthLimits.max)

export const isLayoutPreferencesSnapshot = (
  source: unknown
): source is Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'> =>
  isRecord(source) &&
  isDefaultModeValue(source.defaultMode) &&
  isBooleanValue(source.leftPanelOpen) &&
  isBooleanValue(source.rightPanelOpen) &&
  isBooleanValue(source.agentsLeftOpen) &&
  isLayoutWidthValue(source.leftPanelWidth) &&
  isLayoutWidthValue(source.rightPanelWidth) &&
  isLayoutWidthValue(source.agentsLeftWidth)

export const normalizeBackgroundConfig = (source?: Partial<BackgroundUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const mode = stringFromOptions(incoming.mode, backgroundModeValues, defaultConfig.background.mode)
  const normalized: BackgroundUserConfig = {
    mode,
    image: typeof incoming.image === 'string' ? incoming.image : defaultConfig.background.image,
    opacity: numberInRange(incoming.opacity, defaultConfig.background.opacity, 0, 1),
    brightness: numberInRange(incoming.brightness, defaultConfig.background.brightness, 0, 1),
    lastCustomImage: typeof incoming.lastCustomImage === 'string' ? incoming.lastCustomImage : defaultConfig.background.lastCustomImage
  }
  if (normalized.mode === 'none') {
    normalized.image = ''
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof BackgroundUserConfig>).some((key) => incoming[key] !== normalized[key])
  return { normalized, changed }
}

export const isBackgroundSnapshot = (source: unknown): source is BackgroundUserConfig => {
  if (!isRecord(source)) return false
  return (
    backgroundModeValues.includes(source.mode as BackgroundUserConfig['mode']) &&
    typeof source.image === 'string' &&
    typeof source.opacity === 'number' &&
    Number.isFinite(source.opacity) &&
    source.opacity >= 0 &&
    source.opacity <= 1 &&
    typeof source.brightness === 'number' &&
    Number.isFinite(source.brightness) &&
    source.brightness >= 0 &&
    source.brightness <= 1 &&
    (source.lastCustomImage === undefined || typeof source.lastCustomImage === 'string')
  )
}

export const cloneBackgroundSnapshot = (background: BackgroundUserConfig): BackgroundUserConfig => ({ ...background })

export const backgroundSnapshotsMatch = (left: BackgroundUserConfig, right: BackgroundUserConfig) =>
  JSON.stringify(cloneBackgroundSnapshot(left)) === JSON.stringify(cloneBackgroundSnapshot(right))

export const visibleBackgroundTuning = (background: BackgroundUserConfig): BackgroundUserConfig => {
  if (background.mode === 'none') return background
  const wasLegacyLowVisibility = background.opacity <= 0.5 && background.brightness <= 0.85
  if (!wasLegacyLowVisibility) return background
  return {
    ...background,
    opacity: defaultConfig.background.opacity,
    brightness: defaultConfig.background.brightness
  }
}

export const isCustomBackgroundSaveResult = (source: unknown): source is CustomBackgroundSaveResult =>
  isRecord(source) &&
  isNonEmptyString(source.filePath) &&
  isNonEmptyString(source.url) &&
  isNonEmptyString(source.name) &&
  typeof source.size === 'number' &&
  Number.isInteger(source.size) &&
  source.size > 0 &&
  typeof source.bytes === 'number' &&
  Number.isInteger(source.bytes) &&
  source.bytes === source.size &&
  typeof source.mtimeMs === 'number' &&
  Number.isFinite(source.mtimeMs) &&
  source.mtimeMs > 0

const normalizeOnboardingCompleted = (source?: UserConfig['onboarding']) => {
  const incomingCompleted = source?.completedModules || {}
  return {
    interfaceGuide: Boolean(incomingCompleted.interfaceGuide),
    systemSettings: Boolean(incomingCompleted.systemSettings),
    addAndConnectHost: Boolean(incomingCompleted.addAndConnectHost),
    aiChat: Boolean(incomingCompleted.aiChat)
  }
}

export const normalizeOnboardingConfig = (source?: UserConfig['onboarding']) => {
  const completed = normalizeOnboardingCompleted(source)

  const normalized = {
    version: ONBOARDING_VERSION,
    guideTabAutoOpened: Boolean(source?.guideTabAutoOpened),
    completedModules: completed
  }

  const isCurrent =
    source?.version === ONBOARDING_VERSION &&
    onboardingModuleIds.every((moduleId) => typeof source.completedModules?.[moduleId] === 'boolean')

  return {
    normalized,
    changed: !isCurrent
  }
}

export const stripBusinessDataConfig = (source: Partial<UserConfig>): Partial<UserConfig> => {
  const { quickCommands, knowledgeBase, aliasCommands, ...rest } = source
  void quickCommands
  void knowledgeBase
  void aliasCommands
  return rest
}

export const normalizeExportMcpConfig = (source?: UserConfig['exportMcp']) => {
  const incoming: Record<string, unknown> = isRecord(source) ? source : {}
  const normalized: NonNullable<UserConfig['exportMcp']> = {
    allowAgentSshAuthSubmit:
      typeof incoming.allowAgentSshAuthSubmit === 'boolean'
        ? incoming.allowAgentSshAuthSubmit
        : defaultExportMcpSettings.allowAgentSshAuthSubmit
  }
  return {
    normalized,
    changed: !isRecord(source) || incoming.allowAgentSshAuthSubmit !== normalized.allowAgentSshAuthSubmit
  }
}

export const mergeUserConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => {
  const normalizedMcp = normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates)

  return {
    ...base,
    ...patch,
    defaultMode: isDefaultModeValue(patch.defaultMode) ? patch.defaultMode : isDefaultModeValue(base.defaultMode) ? base.defaultMode : defaultConfig.defaultMode,
    leftPanelOpen: typeof patch.leftPanelOpen === 'boolean' ? patch.leftPanelOpen : typeof base.leftPanelOpen === 'boolean' ? base.leftPanelOpen : defaultConfig.leftPanelOpen,
    rightPanelOpen: typeof patch.rightPanelOpen === 'boolean' ? patch.rightPanelOpen : typeof base.rightPanelOpen === 'boolean' ? base.rightPanelOpen : defaultConfig.rightPanelOpen,
    agentsLeftOpen:
      typeof patch.agentsLeftOpen === 'boolean' ? patch.agentsLeftOpen : typeof base.agentsLeftOpen === 'boolean' ? base.agentsLeftOpen : defaultConfig.agentsLeftOpen,
    leftPanelWidth: layoutWidthFromConfig(patch.leftPanelWidth, layoutWidthFromConfig(base.leftPanelWidth, defaultConfig.leftPanelWidth!)),
    rightPanelWidth: layoutWidthFromConfig(patch.rightPanelWidth, layoutWidthFromConfig(base.rightPanelWidth, defaultConfig.rightPanelWidth!)),
    agentsLeftWidth: layoutWidthFromConfig(patch.agentsLeftWidth, layoutWidthFromConfig(base.agentsLeftWidth, defaultConfig.agentsLeftWidth!)),
    modelProvider: normalizeUserModelProvider(patch.modelProvider || base.modelProvider),
    modelName: normalizeUserModelName(patch.modelName || base.modelName),
    background: normalizeBackgroundConfig({
      ...base.background,
      ...(patch.background || {})
    }).normalized,
    terminal: {
      ...(base.terminal || defaultTerminalSettings),
      ...(patch.terminal || {})
    },
    workspacePreferences: {
      ...(base.workspacePreferences || defaultWorkspacePreferences),
      ...(patch.workspacePreferences || {}),
      expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || defaultWorkspacePreferences.expandedGroups,
      recentAssetIds: patch.workspacePreferences?.recentAssetIds || base.workspacePreferences?.recentAssetIds || defaultWorkspacePreferences.recentAssetIds || []
    },
    editorSettings: normalizeEditorSettingsConfig({
      ...(base.editorSettings || defaultEditorSettings),
      ...(patch.editorSettings || {})
    }).normalized,
    sshProxyConfigs: normalizeSshProxyConfigs(patch.sshProxyConfigs || base.sshProxyConfigs).normalized,
    sshAgentKeys: normalizeSshAgentKeys(patch.sshAgentKeys || base.sshAgentKeys).normalized,
    extensionSettings: normalizeExtensionSettingsConfig({
      ...(base.extensionSettings || defaultExtensionSettings),
      ...(patch.extensionSettings || {})
    }).normalized,
    keywordHighlight: normalizeKeywordHighlightConfig(patch.keywordHighlight || base.keywordHighlight).normalized,
    securityConfig: normalizeSecurityConfig(patch.securityConfig || base.securityConfig).normalized,
    privacy: normalizePrivacyConfig({
      ...(base.privacy || defaultConfig.privacy!),
      ...(patch.privacy || {})
    }).normalized,
    aiPreferences: normalizeAiPreferencesConfig({
      ...(base.aiPreferences || defaultAiPreferences),
      ...(patch.aiPreferences || {}),
      proxy: {
        ...(base.aiPreferences?.proxy || defaultAiPreferences.proxy),
        ...(patch.aiPreferences?.proxy || {})
      }
    }).normalized,
    notifications: normalizeNotificationConfig({
      ...(base.notifications || defaultNotificationSettings),
      ...(patch.notifications || {})
    }).normalized,
    exportMcp: normalizeExportMcpConfig({
      ...(base.exportMcp || defaultExportMcpSettings),
      ...(patch.exportMcp || {})
    }).normalized,
    modelSettings: normalizeModelSettingsConfig(patch.modelSettings || base.modelSettings).normalized,
    quickCommands:
      base.quickCommands || patch.quickCommands
        ? {
            groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || defaultQuickCommands.groups)],
            snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || defaultQuickCommands.snippets)]
          }
        : undefined,
    knowledgeBase: patch.knowledgeBase || base.knowledgeBase ? normalizeKnowledgeBaseConfig(patch.knowledgeBase || base.knowledgeBase).normalized : undefined,
    aliasCommands: patch.aliasCommands || base.aliasCommands ? normalizeAliasCommandsConfig(patch.aliasCommands || base.aliasCommands).normalized : undefined,
    shortcuts: normalizeShortcutsConfig(patch.shortcuts || base.shortcuts).normalized,
    rules: normalizeRulesConfig(patch.rules || base.rules, patch.customInstructions !== undefined ? patch.customInstructions : base.customInstructions).normalized,
    skills: normalizeSkillsConfig(patch.skills || base.skills).normalized,
    customInstructions: patch.customInstructions !== undefined ? patch.customInstructions : base.customInstructions,
    mcpServers: normalizedMcp.normalized,
    mcpToolStates: normalizedMcp.toolStates,
    onboarding:
      base.onboarding || patch.onboarding
        ? {
            ...(base.onboarding || defaultConfig.onboarding!),
            ...(patch.onboarding || {}),
            completedModules: {
              ...(base.onboarding?.completedModules || defaultConfig.onboarding!.completedModules),
              ...(patch.onboarding?.completedModules || {})
            }
          }
        : undefined
  }
}

export const mergeGenericSavedConfig = (base: UserConfig, savedConfig: Partial<UserConfig>, patch: Partial<UserConfig> = {}) =>
  mergeUserConfig(base, {
    ...stripBusinessDataConfig(savedConfig),
    ...patch
  })
