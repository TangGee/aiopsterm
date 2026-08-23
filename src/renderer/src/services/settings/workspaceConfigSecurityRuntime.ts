import type {
  KeywordHighlightRuleConfig,
  NotificationUserConfig,
  PrivacyUserConfig
} from '@shared/contracts/appRuntime'
import { notificationSoundPresetValues } from '@shared/contracts/appRuntime'
import {
  defaultKeywordHighlightSettings,
  defaultNotificationSettings,
  defaultPrivacySettings,
  defaultSecuritySettings,
  keywordHighlightFontStyles,
  keywordHighlightHexColorPattern,
  keywordHighlightMatchTypes,
  keywordHighlightScopes,
  privacyRuntimeValues,
  privacyStatusValues,
  telemetryStatusValues,
  privacySyncStatusValues,
  privacySyncedScopeValues,
  type KeywordHighlightSettings,
  type PrivacyRuntimeApplyData,
  type PrivacySettings,
  type SecuritySettings
} from './workspaceConfigDefaults'
import { isRecord, numberInRange, stringFromOptions } from './workspaceConfigPrimitives'

export const normalizeKeywordHighlightConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot['keyword-highlight']) ? incomingRoot['keyword-highlight'] : {}
  const incomingApplyTo = isRecord(incoming.applyTo) ? incoming.applyTo : {}
  const rawRules = Array.isArray(incoming.rules) ? incoming.rules : defaultKeywordHighlightSettings['keyword-highlight'].rules
  const seenNames = new Set<string>()
  let changed = !isRecord(source) || !isRecord(incomingRoot['keyword-highlight']) || !isRecord(incoming.applyTo) || !Array.isArray(incoming.rules)

  const rules: KeywordHighlightRuleConfig[] = []
  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Rule ${index + 1}`
    if (seenNames.has(name)) {
      changed = true
      return
    }
    const rawPattern = item.pattern
    const pattern = Array.isArray(rawPattern)
      ? rawPattern.filter((patternItem): patternItem is string => typeof patternItem === 'string' && patternItem.trim().length > 0).map((patternItem) => patternItem.trim())
      : typeof rawPattern === 'string' && rawPattern.trim()
        ? rawPattern.trim()
        : ''
    if ((Array.isArray(pattern) && pattern.length === 0) || (!Array.isArray(pattern) && !pattern)) {
      changed = true
      return
    }
    const incomingStyle = isRecord(item.style) ? item.style : {}
    const rule: KeywordHighlightRuleConfig = {
      name,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      scope: stringFromOptions(item.scope, keywordHighlightScopes, 'output'),
      matchType: stringFromOptions(item.matchType, keywordHighlightMatchTypes, 'regex'),
      pattern,
      style: {
        foreground:
          typeof incomingStyle.foreground === 'string' && keywordHighlightHexColorPattern.test(incomingStyle.foreground)
            ? incomingStyle.foreground.toUpperCase()
            : '#FF4D4F',
        fontStyle: stringFromOptions(incomingStyle.fontStyle, keywordHighlightFontStyles, 'bold')
      }
    }
    seenNames.add(name)
    rules.push(rule)
    const allowedKeys = new Set(['name', 'enabled', 'scope', 'matchType', 'pattern', 'style'])
    const allowedStyleKeys = new Set(['foreground', 'fontStyle'])
    if (
      item.name !== rule.name ||
      item.enabled !== rule.enabled ||
      item.scope !== rule.scope ||
      item.matchType !== rule.matchType ||
      JSON.stringify(item.pattern) !== JSON.stringify(rule.pattern) ||
      !isRecord(item.style) ||
      incomingStyle.foreground !== rule.style.foreground ||
      incomingStyle.fontStyle !== rule.style.fontStyle ||
      Object.keys(item).some((key) => !allowedKeys.has(key)) ||
      Object.keys(incomingStyle).some((key) => !allowedStyleKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalized: KeywordHighlightSettings = {
    'keyword-highlight': {
      enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : defaultKeywordHighlightSettings['keyword-highlight'].enabled,
      applyTo: {
        output: incomingApplyTo.output !== undefined ? Boolean(incomingApplyTo.output) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.output,
        input: incomingApplyTo.input !== undefined ? Boolean(incomingApplyTo.input) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.input
      },
      rules
    }
  }

  if (
    incoming.enabled !== normalized['keyword-highlight'].enabled ||
    incomingApplyTo.output !== normalized['keyword-highlight'].applyTo.output ||
    incomingApplyTo.input !== normalized['keyword-highlight'].applyTo.input
  ) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

export const keywordHighlightEditorContentFromFile = (content: string) => (content.trim() ? content : JSON.stringify(defaultKeywordHighlightSettings, null, 2))

export const parseKeywordHighlightEditorContent = (content: string) => JSON.parse(content)

export const normalizeSecurityConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot.security) ? incomingRoot.security : {}
  const incomingPolicy = isRecord(incoming.securityPolicy) ? incoming.securityPolicy : {}
  const defaults = defaultSecuritySettings.security
  const blacklist = normalizeStringArray(incoming.blacklistPatterns, defaults.blacklistPatterns)
  const whitelist = normalizeStringArray(incoming.whitelistPatterns, defaults.whitelistPatterns)
  const dangerous = normalizeStringArray(incoming.dangerousCommands, defaults.dangerousCommands)
  const normalized: SecuritySettings = {
    security: {
      enableCommandSecurity: incoming.enableCommandSecurity !== undefined ? Boolean(incoming.enableCommandSecurity) : defaults.enableCommandSecurity,
      enableStrictMode: incoming.enableStrictMode !== undefined ? Boolean(incoming.enableStrictMode) : defaults.enableStrictMode,
      blacklistPatterns: blacklist.normalized,
      whitelistPatterns: whitelist.normalized,
      dangerousCommands: dangerous.normalized,
      maxCommandLength: numberInRange(incoming.maxCommandLength, defaults.maxCommandLength, 1, 100000),
      securityPolicy: {
        blockCritical: incomingPolicy.blockCritical !== undefined ? Boolean(incomingPolicy.blockCritical) : defaults.securityPolicy.blockCritical,
        askForMedium: incomingPolicy.askForMedium !== undefined ? Boolean(incomingPolicy.askForMedium) : defaults.securityPolicy.askForMedium,
        askForHigh: incomingPolicy.askForHigh !== undefined ? Boolean(incomingPolicy.askForHigh) : defaults.securityPolicy.askForHigh,
        askForBlacklist: incomingPolicy.askForBlacklist !== undefined ? Boolean(incomingPolicy.askForBlacklist) : defaults.securityPolicy.askForBlacklist
      }
    }
  }

  const allowedRootKeys = new Set(['security'])
  const allowedSecurityKeys = new Set([
    'enableCommandSecurity',
    'enableStrictMode',
    'blacklistPatterns',
    'whitelistPatterns',
    'dangerousCommands',
    'maxCommandLength',
    'securityPolicy'
  ])
  const allowedPolicyKeys = new Set(['blockCritical', 'askForMedium', 'askForHigh', 'askForBlacklist'])
  const changed =
    !isRecord(source) ||
    !isRecord(incomingRoot.security) ||
    !isRecord(incoming.securityPolicy) ||
    blacklist.changed ||
    whitelist.changed ||
    dangerous.changed ||
    incoming.enableCommandSecurity !== normalized.security.enableCommandSecurity ||
    incoming.enableStrictMode !== normalized.security.enableStrictMode ||
    incoming.maxCommandLength !== normalized.security.maxCommandLength ||
    incomingPolicy.blockCritical !== normalized.security.securityPolicy.blockCritical ||
    incomingPolicy.askForMedium !== normalized.security.securityPolicy.askForMedium ||
    incomingPolicy.askForHigh !== normalized.security.securityPolicy.askForHigh ||
    incomingPolicy.askForBlacklist !== normalized.security.securityPolicy.askForBlacklist ||
    Object.keys(incomingRoot).some((key) => !allowedRootKeys.has(key)) ||
    Object.keys(incoming).some((key) => !allowedSecurityKeys.has(key)) ||
    Object.keys(incomingPolicy).some((key) => !allowedPolicyKeys.has(key))

  return {
    normalized,
    changed
  }
}

const normalizeStringArray = (source: unknown, fallback: string[]) => {
  if (!Array.isArray(source)) return { normalized: [...fallback], changed: true }
  const normalized = source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return {
    normalized,
    changed: normalized.length !== source.length || normalized.some((item, index) => item !== source[index])
  }
}

export const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

export const securityEditorContentFromFile = (content: string) => {
  if (!content.trim()) {
    return JSON.stringify(defaultSecuritySettings, null, 2)
  }
  const cleaned = removeJsonComments(content)
  if (!cleaned) {
    return content
  }
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    return content
  }
}

export const parseSecurityEditorContent = (content: string) => JSON.parse(removeJsonComments(content))

export const keywordHighlightSettingsSnapshotsMatch = (left: KeywordHighlightSettings, right: KeywordHighlightSettings) =>
  JSON.stringify(normalizeKeywordHighlightConfig(left).normalized) === JSON.stringify(normalizeKeywordHighlightConfig(right).normalized)

export const securitySettingsSnapshotsMatch = (left: SecuritySettings, right: SecuritySettings) =>
  JSON.stringify(normalizeSecurityConfig(left).normalized) === JSON.stringify(normalizeSecurityConfig(right).normalized)

const privacyStatusFromOptions = (value: unknown, fallback: 'enabled' | 'disabled') =>
  stringFromOptions(value, privacyStatusValues, fallback)

const telemetryStatusFromOptions = (value: unknown, fallback: PrivacyUserConfig['telemetry']) =>
  stringFromOptions(value, telemetryStatusValues, fallback)

export const normalizePrivacyConfig = (source?: Partial<PrivacyUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const legacyTelemetry = telemetryStatusFromOptions(incoming.telemetry, defaultPrivacySettings.telemetry)
  const telemetryConsentVersion = incoming.telemetryConsentVersion === 1 ? 1 : 0
  const normalized: PrivacyUserConfig = {
    telemetry: legacyTelemetry === 'disabled' ? 'disabled' : 'enabled',
    telemetryConsentVersion: 1,
    secretRedaction: privacyStatusFromOptions(incoming.secretRedaction, defaultPrivacySettings.secretRedaction),
    dataSync: privacyStatusFromOptions(incoming.dataSync, defaultPrivacySettings.dataSync)
  }
  const telemetryChanged = incoming.telemetry !== normalized.telemetry
  const consentChanged = incoming.telemetryConsentVersion !== undefined && incoming.telemetryConsentVersion !== normalized.telemetryConsentVersion
  const changed =
    !isRecord(source) ||
    telemetryChanged ||
    consentChanged ||
    incoming.secretRedaction !== normalized.secretRedaction ||
    incoming.dataSync !== normalized.dataSync

  return {
    normalized,
    changed
  }
}

export const isPrivacyRuntimeSnapshotForRequest = (source: unknown, expectedPrivacy: PrivacyUserConfig): source is PrivacyRuntimeApplyData =>
  isRecord(source) &&
  source.telemetry === expectedPrivacy.telemetry &&
  source.dataSync === expectedPrivacy.dataSync &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  privacyRuntimeValues.includes(source.dataSyncRuntime as (typeof privacyRuntimeValues)[number]) &&
  (expectedPrivacy.dataSync === 'enabled' || source.dataSyncRuntime === 'disabled') &&
  (source.syncStatus === undefined || privacySyncStatusValues.includes(source.syncStatus as (typeof privacySyncStatusValues)[number])) &&
  (expectedPrivacy.dataSync === 'enabled' || source.syncStatus === undefined || source.syncStatus === 'disabled') &&
  (source.syncRunId === undefined || typeof source.syncRunId === 'string') &&
  (source.stateFilePath === undefined || typeof source.stateFilePath === 'string') &&
  (source.lastSyncAt === undefined || typeof source.lastSyncAt === 'string') &&
  (source.errorMessage === undefined || typeof source.errorMessage === 'string') &&
  (source.syncedScopes === undefined ||
    (Array.isArray(source.syncedScopes) && source.syncedScopes.every((scope) => privacySyncedScopeValues.includes(scope as (typeof privacySyncedScopeValues)[number])))) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

export const privacyRuntimeSettingsFromSnapshot = (snapshot?: PrivacyRuntimeApplyData | null) => ({
  dataSyncRuntime: snapshot?.dataSyncRuntime || 'disabled',
  dataSyncStatus: snapshot?.syncStatus || (snapshot?.dataSync === 'enabled' ? 'idle' : 'disabled'),
  dataSyncRunId: snapshot?.syncRunId || '',
  dataSyncStateFilePath: snapshot?.stateFilePath || '',
  dataSyncLastSyncAt: snapshot?.lastSyncAt || '',
  dataSyncSyncedScopes: snapshot?.syncedScopes ? [...snapshot.syncedScopes] : [],
  dataSyncErrorMessage: snapshot?.errorMessage || ''
})

export const normalizeNotificationConfig = (source?: Partial<NotificationUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: NotificationUserConfig = {
    desktopNotifications: typeof incoming.desktopNotifications === 'boolean' ? incoming.desktopNotifications : defaultNotificationSettings.desktopNotifications,
    controlNotificationBell: typeof incoming.controlNotificationBell === 'boolean' ? incoming.controlNotificationBell : defaultNotificationSettings.controlNotificationBell,
    soundEnabled: typeof incoming.soundEnabled === 'boolean' ? incoming.soundEnabled : defaultNotificationSettings.soundEnabled,
    soundPreset: stringFromOptions(incoming.soundPreset, notificationSoundPresetValues, defaultNotificationSettings.soundPreset),
    customSoundPath: typeof incoming.customSoundPath === 'string' ? incoming.customSoundPath : defaultNotificationSettings.customSoundPath,
    customSoundUrl: typeof incoming.customSoundUrl === 'string' ? incoming.customSoundUrl : defaultNotificationSettings.customSoundUrl,
    customSoundName: typeof incoming.customSoundName === 'string' ? incoming.customSoundName : defaultNotificationSettings.customSoundName
  }
  const allowedKeys = new Set(['desktopNotifications', 'controlNotificationBell', 'soundEnabled', 'soundPreset', 'customSoundPath', 'customSoundUrl', 'customSoundName'])
  const changed =
    isRecord(source) &&
    (incoming.desktopNotifications !== normalized.desktopNotifications ||
      incoming.controlNotificationBell !== normalized.controlNotificationBell ||
      incoming.soundEnabled !== normalized.soundEnabled ||
      incoming.soundPreset !== normalized.soundPreset ||
      incoming.customSoundPath !== normalized.customSoundPath ||
      incoming.customSoundUrl !== normalized.customSoundUrl ||
      incoming.customSoundName !== normalized.customSoundName ||
      Object.keys(incoming).some((key) => !allowedKeys.has(key)))

  return {
    normalized,
    changed
  }
}
