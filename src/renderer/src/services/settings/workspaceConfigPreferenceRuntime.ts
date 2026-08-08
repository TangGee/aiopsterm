import type {
  EditorUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  TerminalMouseEventAction,
  TerminalUserConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { ExtensionUserConfig } from '@shared/contracts/extensions'
import {
  crossPlatformTerminalFontFamily,
  defaultEditorSettings,
  defaultExtensionSettings,
  defaultTerminalSettings,
  defaultWorkspacePreferences,
  editorWordWrapValues,
  legacyTerminalFontFamilies,
  middleMouseEventActions,
  rightMouseEventActions,
  sshProxyTypes,
  terminalCursorStyles,
  terminalTypes,
  type EditorSettings,
  type ExtensionSettings,
  type TerminalSettings
} from './workspaceConfigDefaults'
import { isRecord, numberInRange, stringFromOptions } from './workspaceConfigPrimitives'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  LEGACY_DEFAULT_TERMINAL_FONT_FAMILY,
  LEGACY_DEFAULT_TERMINAL_FONT_SIZE,
  LEGACY_DEFAULT_TERMINAL_LINE_HEIGHT
} from '@shared/terminalTypography'

export const normalizeTerminalConfig = (source?: Partial<TerminalUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingFontFamily = typeof incoming.fontFamily === 'string' ? incoming.fontFamily.trim() : ''
  const migratingLegacyTypography =
    incomingFontFamily === LEGACY_DEFAULT_TERMINAL_FONT_FAMILY &&
    incoming.fontSize === LEGACY_DEFAULT_TERMINAL_FONT_SIZE &&
    incoming.lineHeight === LEGACY_DEFAULT_TERMINAL_LINE_HEIGHT
  const migratingOlderLegacyTypography =
    legacyTerminalFontFamilies.has(incomingFontFamily) &&
    incoming.fontSize === LEGACY_DEFAULT_TERMINAL_FONT_SIZE &&
    incoming.lineHeight === 1
  const migratingTypography = migratingLegacyTypography || migratingOlderLegacyTypography
  const normalized: TerminalSettings = {
    terminalType: stringFromOptions(incoming.terminalType, terminalTypes, defaultTerminalSettings.terminalType),
    fontFamily: incomingFontFamily
      ? (migratingTypography ? crossPlatformTerminalFontFamily : incomingFontFamily)
      : defaultTerminalSettings.fontFamily,
    fontSize: migratingTypography
      ? DEFAULT_TERMINAL_FONT_SIZE
      : numberInRange(incoming.fontSize, defaultTerminalSettings.fontSize, 8, 64),
    scrollBack: numberInRange(incoming.scrollBack, defaultTerminalSettings.scrollBack, 1, 100000),
    cursorStyle: stringFromOptions(incoming.cursorStyle, terminalCursorStyles, defaultTerminalSettings.cursorStyle),
    cursorBlink: typeof incoming.cursorBlink === 'boolean' ? incoming.cursorBlink : defaultTerminalSettings.cursorBlink,
    lineHeight: migratingTypography
      ? DEFAULT_TERMINAL_LINE_HEIGHT
      : numberInRange(incoming.lineHeight, defaultTerminalSettings.lineHeight, 1, 3),
    pinchZoomStatus: typeof incoming.pinchZoomStatus === 'boolean' ? incoming.pinchZoomStatus : defaultTerminalSettings.pinchZoomStatus,
    showCloseButton: typeof incoming.showCloseButton === 'boolean' ? incoming.showCloseButton : defaultTerminalSettings.showCloseButton,
    sshAgentsStatus: typeof incoming.sshAgentsStatus === 'boolean' ? incoming.sshAgentsStatus : defaultTerminalSettings.sshAgentsStatus,
    middleMouseEvent: stringFromOptions(incoming.middleMouseEvent, middleMouseEventActions, defaultTerminalSettings.middleMouseEvent),
    rightMouseEvent: stringFromOptions(incoming.rightMouseEvent, rightMouseEventActions, defaultTerminalSettings.rightMouseEvent)
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof TerminalSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const isTerminalSettingsSnapshot = (source: unknown): source is TerminalUserConfig => {
  if (!isRecord(source)) return false
  return (
    (terminalTypes as readonly string[]).includes(source.terminalType as string) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.scrollBack === 'number' &&
    Number.isFinite(source.scrollBack) &&
    (terminalCursorStyles as readonly string[]).includes(source.cursorStyle as string) &&
    typeof source.cursorBlink === 'boolean' &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.pinchZoomStatus === 'boolean' &&
    typeof source.showCloseButton === 'boolean' &&
    typeof source.sshAgentsStatus === 'boolean' &&
    middleMouseEventActions.includes(source.middleMouseEvent as TerminalMouseEventAction) &&
    rightMouseEventActions.includes(source.rightMouseEvent as TerminalSettings['rightMouseEvent'])
  )
}

export const normalizeWorkspacePreferences = (source?: Partial<WorkspaceUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingExpandedGroups = Array.isArray(incoming.expandedGroups)
    ? incoming.expandedGroups.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.expandedGroups
  const incomingRecentAssetIds = Array.isArray(incoming.recentAssetIds)
    ? incoming.recentAssetIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.recentAssetIds || []
  const normalized: WorkspaceUserConfig = {
    expandedGroups: Array.from(new Set(incomingExpandedGroups)),
    showIpMode: typeof incoming.showIpMode === 'boolean' ? incoming.showIpMode : defaultWorkspacePreferences.showIpMode,
    recentAssetIds: Array.from(new Set(incomingRecentAssetIds)).slice(0, 10)
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.expandedGroups) ||
    !Array.isArray(incoming.recentAssetIds) ||
    incoming.expandedGroups.length !== normalized.expandedGroups.length ||
    incoming.expandedGroups.some((item, index) => item !== normalized.expandedGroups[index]) ||
    incoming.showIpMode !== normalized.showIpMode ||
    incoming.recentAssetIds.length !== (normalized.recentAssetIds || []).length ||
    incoming.recentAssetIds.some((item, index) => item !== (normalized.recentAssetIds || [])[index])

  return {
    normalized,
    changed
  }
}

export const isWorkspacePreferencesSnapshot = (source: unknown): source is WorkspaceUserConfig => {
  if (!isRecord(source) || !Array.isArray(source.expandedGroups) || typeof source.showIpMode !== 'boolean' || !Array.isArray(source.recentAssetIds)) return false
  const { changed } = normalizeWorkspacePreferences(source)
  return !changed
}

export const cloneWorkspacePreferencesSnapshot = (preferences: WorkspaceUserConfig): WorkspaceUserConfig => ({
  showIpMode: preferences.showIpMode,
  expandedGroups: [...preferences.expandedGroups],
  recentAssetIds: [...(preferences.recentAssetIds || [])]
})

export const workspacePreferenceSnapshotsMatch = (left: WorkspaceUserConfig, right: WorkspaceUserConfig) =>
  JSON.stringify(cloneWorkspacePreferencesSnapshot(left)) === JSON.stringify(cloneWorkspacePreferencesSnapshot(right))

export const normalizeEditorSettingsConfig = (source?: Partial<EditorUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: EditorSettings = {
    fontSize: numberInRange(incoming.fontSize, defaultEditorSettings.fontSize, 8, 32),
    lineHeight: numberInRange(incoming.lineHeight, defaultEditorSettings.lineHeight, 0, 48),
    fontFamily: typeof incoming.fontFamily === 'string' && incoming.fontFamily.trim() ? incoming.fontFamily.trim() : defaultEditorSettings.fontFamily,
    tabSize: numberInRange(incoming.tabSize, defaultEditorSettings.tabSize, 1, 8),
    wordWrap: stringFromOptions(incoming.wordWrap, editorWordWrapValues, defaultEditorSettings.wordWrap),
    minimap: typeof incoming.minimap === 'boolean' ? incoming.minimap : defaultEditorSettings.minimap,
    mouseWheelZoom: typeof incoming.mouseWheelZoom === 'boolean' ? incoming.mouseWheelZoom : defaultEditorSettings.mouseWheelZoom
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof EditorSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

export const isEditorSettingsSnapshot = (source: unknown): source is EditorUserConfig => {
  if (!isRecord(source)) return false
  return (
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.tabSize === 'number' &&
    Number.isFinite(source.tabSize) &&
    editorWordWrapValues.includes(source.wordWrap as EditorSettings['wordWrap']) &&
    typeof source.minimap === 'boolean' &&
    typeof source.mouseWheelZoom === 'boolean'
  )
}

export const normalizeSshProxyConfigs = (source?: unknown) => {
  const rawConfigs = Array.isArray(source) ? source : []
  const seenNames = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshProxyConfig[] = []

  rawConfigs.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const host = typeof item.host === 'string' ? item.host.trim() : ''
    if (!name || !host || seenNames.has(name)) {
      changed = true
      return
    }
    const proxyConfig: SshProxyConfig = {
      name,
      type: stringFromOptions(item.type, sshProxyTypes, 'SOCKS5'),
      host,
      port: numberInRange(item.port, 22, 1, 65535),
      enableProxyIdentity: typeof item.enableProxyIdentity === 'boolean' ? item.enableProxyIdentity : false,
      username: typeof item.username === 'string' ? item.username : '',
      password: typeof item.password === 'string' ? item.password : ''
    }
    seenNames.add(name)
    normalized.push(proxyConfig)
    const allowedKeys = new Set(['name', 'type', 'host', 'port', 'enableProxyIdentity', 'username', 'password'])
    if (
      item.name !== proxyConfig.name ||
      item.type !== proxyConfig.type ||
      item.host !== proxyConfig.host ||
      item.port !== proxyConfig.port ||
      item.enableProxyIdentity !== proxyConfig.enableProxyIdentity ||
      item.username !== proxyConfig.username ||
      item.password !== proxyConfig.password ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const normalizeSshAgentKeys = (source?: unknown) => {
  const rawKeys = Array.isArray(source) ? source : []
  const seenIds = new Set<string>()
  const seenKeyChainIds = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshAgentKeyConfig[] = []

  rawKeys.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    const keyChainIdSource = typeof item.keyChainId === 'string' ? item.keyChainId.trim() : typeof item.key === 'string' ? item.key.trim() : ''
    const keyChainId = keyChainIdSource || id
    if (!id || !fingerprint || !comment || seenIds.has(id) || seenKeyChainIds.has(keyChainId)) {
      changed = true
      return
    }
    const key: SshAgentKeyConfig = {
      id,
      fingerprint,
      comment,
      keyType: typeof item.keyType === 'string' && item.keyType.trim() ? item.keyType.trim().toUpperCase() : 'UNKNOWN',
      keyChainId
    }
    seenIds.add(id)
    seenKeyChainIds.add(keyChainId)
    normalized.push(key)
    const allowedKeys = new Set(['id', 'fingerprint', 'comment', 'keyType', 'keyChainId'])
    if (
      item.id !== key.id ||
      item.fingerprint !== key.fingerprint ||
      item.comment !== key.comment ||
      item.keyType !== key.keyType ||
      item.keyChainId !== key.keyChainId ||
      Object.keys(item).some((itemKey) => !allowedKeys.has(itemKey))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

export const sshProxyConfigSnapshotsMatch = (left: SshProxyConfig[], right: SshProxyConfig[]) =>
  JSON.stringify(normalizeSshProxyConfigs(left).normalized) === JSON.stringify(normalizeSshProxyConfigs(right).normalized)

export const sshAgentKeySnapshotsMatch = (left: SshAgentKeyConfig[], right: SshAgentKeyConfig[]) =>
  JSON.stringify(normalizeSshAgentKeys(left).normalized) === JSON.stringify(normalizeSshAgentKeys(right).normalized)

export const normalizeSshAgentKeychainOptions = (source?: unknown): SshAgentKeychainOption[] => {
  const rawOptions = Array.isArray(source) ? source : []
  const seenKeys = new Set<string>()
  const normalized: SshAgentKeychainOption[] = []

  rawOptions.forEach((item) => {
    if (!isRecord(item)) return
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const keyType = typeof item.keyType === 'string' ? item.keyType.trim().toUpperCase() : ''
    if (!key || !label || !fingerprint || !keyType || seenKeys.has(key)) return
    seenKeys.add(key)
    normalized.push({ key, label, fingerprint, keyType })
  })

  return normalized
}

export const readSshAgentKeychainOptionsSnapshot = (source: unknown): SshAgentKeychainOption[] | null => {
  if (!Array.isArray(source)) return null
  const normalized = normalizeSshAgentKeychainOptions(source)
  return normalized.length === source.length ? normalized : null
}

const booleanFromExtensionStatus = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 2) return false
  return fallback
}

export const normalizeExtensionSettingsConfig = (source?: Partial<ExtensionSettings>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: ExtensionSettings = {
    autoCompleteStatus: booleanFromExtensionStatus(incoming.autoCompleteStatus, defaultExtensionSettings.autoCompleteStatus),
    quickVimStatus: booleanFromExtensionStatus(incoming.quickVimStatus, defaultExtensionSettings.quickVimStatus),
    highlightStatus: booleanFromExtensionStatus(incoming.highlightStatus, defaultExtensionSettings.highlightStatus)
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof ExtensionSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}
