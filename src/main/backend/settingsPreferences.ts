import { app } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type {
  AiopsMutationResult,
  SettingsPreferencesResult,
  SettingsPreferencesSnapshot,
  SettingsRuleDeleteResult,
  SettingsRuleSaveInput,
  SettingsPreferencesMutationResult,
  SettingsShortcutSaveInput,
  ShortcutUserConfig,
  UserRuleConfig
} from '@shared/preload'
import { defaultSettingsRuleSeedData, shouldUseSettingsPreferencesSeedData } from '@shared/settingsPreferencesSeed'

type SettingsPreferencesStoreShape = {
  preferences?: SettingsPreferencesSnapshot
}

type SettingsPreferencesSeedInput = {
  shortcuts?: unknown
  rules?: unknown
  customInstructions?: unknown
}

type SettingsPreferencesRuntimeConfig = {
  useSeedData?: boolean
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
}

const defaultShortcuts: ShortcutUserConfig[] = [
  { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
  { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
  { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
  { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
]

const defaultRules = () => defaultSettingsRuleSeedData()

const defaultSettingsPreferencesSeedMode = () => shouldUseSettingsPreferencesSeedData()

let runtimeConfig: Required<SettingsPreferencesRuntimeConfig> = {
  useSeedData: defaultSettingsPreferencesSeedMode()
}

const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const platformKeys = ['mac', 'windows', 'linux'] as const

const cloneShortcut = (shortcut: ShortcutUserConfig): ShortcutUserConfig => ({ ...shortcut })
const cloneRule = (rule: UserRuleConfig): UserRuleConfig => ({ ...rule })
const clonePreferences = (preferences: SettingsPreferencesSnapshot): SettingsPreferencesSnapshot => ({
  shortcuts: preferences.shortcuts.map(cloneShortcut),
  rules: preferences.rules.map(cloneRule)
})
const defaultPreferences = (): SettingsPreferencesSnapshot => ({
  shortcuts: defaultShortcuts.map(cloneShortcut),
  rules: runtimeConfig.useSeedData ? defaultRules().map(cloneRule) : []
})

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const normalizeText = (value: unknown) => String(value || '').trim()
const getShortcutParts = (shortcut: string) => shortcut.split('+').map((part) => part.trim()).filter(Boolean)
const platformKey = () => (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux')
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = stableValue(value[key])
      if (nextValue !== undefined) result[key] = nextValue
      return result
    }, {})
}
const stableJson = (value: unknown) => JSON.stringify(stableValue(value))

const isValidShortcutForAction = (actionId: string, shortcut: string) => {
  const parts = getShortcutParts(shortcut)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true

  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokens.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

const resolveShortcutSource = (source: unknown) => {
  if (!isRecord(source)) return source
  if (!platformKeys.some((key) => isRecord(source[key]))) return source
  return source[platformKey()] || source.linux || source.windows || source.mac
}

export const normalizeSettingsShortcuts = (source?: unknown): ShortcutUserConfig[] => {
  const resolved = resolveShortcutSource(source)
  const shortcutsById = new Map<string, string>()

  if (Array.isArray(resolved)) {
    resolved.forEach((item) => {
      if (!isRecord(item)) return
      const id = normalizeText(item.id)
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = normalizeText(item.shortcut)
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) return
      shortcutsById.set(id, shortcut)
    })
  } else if (isRecord(resolved)) {
    Object.entries(resolved).forEach(([id, value]) => {
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = normalizeText(value)
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) return
      shortcutsById.set(id, shortcut)
    })
  }

  return defaultShortcuts.map((defaultShortcut) => ({
    ...defaultShortcut,
    shortcut: shortcutsById.get(defaultShortcut.id) || defaultShortcut.shortcut
  }))
}

export const normalizeSettingsRules = (source?: unknown, customInstructions?: unknown): UserRuleConfig[] => {
  const rawRules = Array.isArray(source) ? source : runtimeConfig.useSeedData ? defaultRules() : []
  const seenIds = new Set<string>()
  const rules: UserRuleConfig[] = []

  rawRules.forEach((item, index) => {
    if (!isRecord(item)) return
    const content = normalizeText(item.content)
    if (!content) return
    let id = normalizeText(item.id) || `rule-${index + 1}`
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    rules.push({
      id,
      content,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true
    })
  })

  const migratedInstruction = normalizeText(customInstructions)
  if (migratedInstruction) {
    let id = 'rule-custom-instructions'
    let suffix = 1
    while (seenIds.has(id)) {
      suffix += 1
      id = `rule-custom-instructions-${suffix}`
    }
    rules.unshift({
      id,
      content: migratedInstruction,
      enabled: true
    })
  }

  return rules
}

const defaultRuleById = () => new Map(defaultRules().map((rule) => [rule.id, rule]))

const stripLegacySeedSettingsRules = (rules: UserRuleConfig[]) => {
  if (runtimeConfig.useSeedData) return rules
  const seedRules = defaultRuleById()
  return rules.filter((rule) => {
    const seed = seedRules.get(rule.id)
    return !seed || stableJson(rule) !== stableJson(seed)
  })
}

export const normalizeSettingsPreferences = (source?: SettingsPreferencesSeedInput): SettingsPreferencesSnapshot => ({
  shortcuts: normalizeSettingsShortcuts(source?.shortcuts),
  rules: stripLegacySeedSettingsRules(normalizeSettingsRules(source?.rules, source?.customInstructions))
})

class FallbackSettingsPreferencesStore {
  private store: Store<SettingsPreferencesStoreShape> | null = null
  private memory: SettingsPreferencesSnapshot | null = null

  constructor() {
    try {
      this.store = new Store<SettingsPreferencesStoreShape>({
        name: 'aiopsterm-settings-preferences'
      })
    } catch {
      this.store = null
    }
  }

  get(seed?: SettingsPreferencesSeedInput): SettingsPreferencesSnapshot {
    const stored = this.store ? this.store.get('preferences') : this.memory
    if (stored) return this.save(stored)
    return this.save(seed ? normalizeSettingsPreferences(seed) : defaultPreferences())
  }

  save(preferences: SettingsPreferencesSnapshot): SettingsPreferencesSnapshot {
    const normalized = normalizeSettingsPreferences(preferences)
    if (this.store) this.store.set('preferences', normalized)
    else this.memory = clonePreferences(normalized)
    return clonePreferences(normalized)
  }
}

class SqliteSettingsPreferencesStore {
  constructor(private db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings_preferences (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `)
  }

  get(seed?: SettingsPreferencesSeedInput): SettingsPreferencesSnapshot {
    const row = this.db.prepare('SELECT data FROM settings_preferences WHERE key = ?').get('preferences') as { data: string } | undefined
    if (row?.data) {
      return this.save(JSON.parse(row.data) as SettingsPreferencesSnapshot)
    }
    return this.save(seed ? normalizeSettingsPreferences(seed) : defaultPreferences())
  }

  save(preferences: SettingsPreferencesSnapshot): SettingsPreferencesSnapshot {
    const normalized = normalizeSettingsPreferences(preferences)
    this.db
      .prepare('INSERT OR REPLACE INTO settings_preferences (key, data) VALUES (?, ?)')
      .run('preferences', JSON.stringify(normalized))
    return clonePreferences(normalized)
  }
}

let settingsPreferencesStore: FallbackSettingsPreferencesStore | SqliteSettingsPreferencesStore | null = null

export const configureSettingsPreferencesBackendRuntime = (config: SettingsPreferencesRuntimeConfig = {}) => {
  runtimeConfig = {
    useSeedData: config.useSeedData ?? defaultSettingsPreferencesSeedMode()
  }
  settingsPreferencesStore = null
}

const createStore = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase
    return new SqliteSettingsPreferencesStore(new Database(join(app.getPath('userData'), 'aiopsterm-state.db')))
  } catch {
    return new FallbackSettingsPreferencesStore()
  }
}

const getStore = () => {
  if (!settingsPreferencesStore) settingsPreferencesStore = createStore()
  return settingsPreferencesStore
}

const asResult = <T>(fn: () => T, fallbackCode = 'SETTINGS_PREFERENCES_BACKEND_ERROR'): AiopsMutationResult<T> => {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    const errorCode = isRecord(error) && typeof error.code === 'string' ? error.code : fallbackCode
    return {
      ok: false,
      errorCode,
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

const loadPreferences = (seed?: SettingsPreferencesSeedInput) => getStore().get(seed)
const savePreferences = (preferences: SettingsPreferencesSnapshot) => getStore().save(preferences)

export const getSettingsPreferences = (seed?: SettingsPreferencesSeedInput): SettingsPreferencesResult =>
  asResult(() => loadPreferences(seed))

export const saveSettingsRule = (input: SettingsRuleSaveInput): SettingsPreferencesMutationResult => {
  const content = normalizeText(input.content)
  if (!content) {
    return {
      ok: false,
      errorCode: 'SETTINGS_RULE_REQUIRED',
      errorMessage: 'Rule content is required.'
    }
  }

  return asResult(() => {
    const preferences = loadPreferences()
    const existing = normalizeText(input.id)
      ? preferences.rules.find((rule) => rule.id === normalizeText(input.id))
      : undefined
    const id = existing?.id || `rule-${randomUUID()}`
    const nextRule: UserRuleConfig = {
      id,
      content,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing?.enabled !== undefined ? existing.enabled : true
    }
    const rules = [nextRule, ...preferences.rules.filter((rule) => rule.id !== id)]
    const next = savePreferences({ ...preferences, rules })
    return {
      ...next,
      message: '规则已保存'
    }
  })
}

export const deleteSettingsRule = (id: string): SettingsRuleDeleteResult => {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    return {
      ok: false,
      errorCode: 'SETTINGS_RULE_DELETE_TARGET_REQUIRED',
      errorMessage: 'Rule delete target is required.'
    }
  }

  return asResult(() => {
    const preferences = loadPreferences()
    const deleted = preferences.rules.find((rule) => rule.id === normalizedId)
    if (!deleted) throw Object.assign(new Error('Rule not found.'), { code: 'SETTINGS_RULE_NOT_FOUND' })
    const next = savePreferences({
      ...preferences,
      rules: preferences.rules.filter((rule) => rule.id !== normalizedId)
    })
    return {
      ...next,
      deleted: cloneRule(deleted)
    }
  })
}

export const saveSettingsShortcut = (input: SettingsShortcutSaveInput): SettingsPreferencesMutationResult => {
  const id = normalizeText(input.id)
  const shortcut = normalizeText(input.shortcut)
  const defaultShortcut = shortcutDefaultsById.get(id)
  if (!defaultShortcut || !shortcut || !isValidShortcutForAction(id, shortcut)) {
    return {
      ok: false,
      errorCode: 'SETTINGS_SHORTCUT_INVALID',
      errorMessage: 'Shortcut is invalid.'
    }
  }

  return asResult(() => {
    const preferences = loadPreferences()
    const duplicate = preferences.shortcuts.find((item) => item.id !== id && item.shortcut === shortcut)
    if (duplicate) throw Object.assign(new Error('Shortcut already exists.'), { code: 'SETTINGS_SHORTCUT_DUPLICATE' })
    const shortcuts = preferences.shortcuts.map((item) => (item.id === id ? { ...defaultShortcut, shortcut } : item))
    const next = savePreferences({ ...preferences, shortcuts })
    return {
      ...next,
      message: '快捷键已保存'
    }
  })
}

export const resetSettingsShortcuts = (): SettingsPreferencesMutationResult =>
  asResult(() => {
    const preferences = loadPreferences()
    const next = savePreferences({
      ...preferences,
      shortcuts: defaultShortcuts.map(cloneShortcut)
    })
    return {
      ...next,
      message: '快捷键已全部重置'
    }
  })
