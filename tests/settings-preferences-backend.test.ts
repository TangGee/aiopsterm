import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettingsShortcuts, SETTINGS_SHORTCUT_DEFAULTS_VERSION } from '../src/shared/settingsShortcutDefaults'

const { storeState } = vi.hoisted(() => ({
  storeState: new Map<string, Record<string, unknown>>()
}))

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/aiopsterm-settings-preferences-test'
  }
}))

vi.mock('better-sqlite3', () => ({
  default: class BrokenSqlite {
    constructor() {
      throw new Error('sqlite unavailable in unit test')
    }
  }
}))

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private name: string

    constructor(options?: { name?: string; defaults?: T }) {
      this.name = options?.name || 'default'
      if (!storeState.has(this.name)) {
        storeState.set(this.name, clone(options?.defaults || {}))
      }
    }

    get(key: keyof T) {
      return clone(storeState.get(this.name)?.[key as string])
    }

    set(key: keyof T, value: T[keyof T]) {
      const next = storeState.get(this.name) || {}
      next[key as string] = clone(value)
      storeState.set(this.name, next)
    }
  }

  return { default: MockStore }
})

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/settings/settingsPreferences'
  return import(modulePath)
}

const originalSettingsPreferencesSeedEnv = process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED

const restoreSettingsPreferencesSeedEnv = () => {
  if (originalSettingsPreferencesSeedEnv === undefined) {
    delete process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED
  } else {
    process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED = originalSettingsPreferencesSeedEnv
  }
}

describe('settings preferences backend boundary', () => {
  beforeEach(() => {
    storeState.clear()
    delete process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED
  })

  afterEach(() => {
    restoreSettingsPreferencesSeedEnv()
  })

  it('loads backend-owned default shortcuts without development seed rules', async () => {
    const backend = await loadBackend()
    const result = backend.getSettingsPreferences()

    expect(result.ok).toBe(true)
    if (!result.data) throw new Error('settings preferences snapshot missing')
    expect(result.data.shortcuts).toEqual(defaultSettingsShortcuts(process.platform))
    expect(result.data.shortcutDefaultsVersion).toBe(SETTINGS_SHORTCUT_DEFAULTS_VERSION)
    expect(result.data.rules).toEqual([])
  })

  it('uses platform-specific history shortcuts without changing recent or ordered navigation', () => {
    const mac = defaultSettingsShortcuts('darwin')
    const windows = defaultSettingsShortcuts('win32')
    const linux = defaultSettingsShortcuts('linux')
    const shortcut = (items: typeof mac, id: string) => items.find((item) => item.id === id)?.shortcut

    expect(shortcut(mac, 'navigatePanelBack')).toBe('Cmd+[')
    expect(shortcut(mac, 'navigatePanelForward')).toBe('Cmd+]')
    expect(shortcut(windows, 'navigatePanelBack')).toBe('Ctrl+Left')
    expect(shortcut(windows, 'navigatePanelForward')).toBe('Ctrl+Right')
    expect(shortcut(linux, 'navigatePanelBack')).toBe('Ctrl+Left')
    expect(shortcut(linux, 'navigatePanelForward')).toBe('Ctrl+Right')

    for (const items of [mac, windows, linux]) {
      expect(shortcut(items, 'recentPanels')).toBe('Ctrl+Tab')
      expect(shortcut(items, 'navigatePanelByOrderBack')).toBe('Ctrl+Shift+Left')
      expect(shortcut(items, 'navigatePanelByOrderForward')).toBe('Ctrl+Shift+Right')
    }
  })

  it('migrates legacy macOS history defaults once and preserves later custom shortcuts', async () => {
    const backend = await loadBackend()
    const legacy = [
      { id: 'navigatePanelBack', action: '导航到上一个面板', shortcut: 'Ctrl+Left' },
      { id: 'navigatePanelForward', action: '导航到下一个面板', shortcut: 'Ctrl+Right' }
    ]
    const migrated = backend.normalizeSettingsShortcuts(legacy, { platform: 'darwin', migrateLegacyDefaults: true })
    const preserved = backend.normalizeSettingsShortcuts(legacy, { platform: 'darwin', migrateLegacyDefaults: false })

    expect(migrated.find((item: { id: string }) => item.id === 'navigatePanelBack')?.shortcut).toBe('Cmd+[')
    expect(migrated.find((item: { id: string }) => item.id === 'navigatePanelForward')?.shortcut).toBe('Cmd+]')
    expect(preserved.find((item: { id: string }) => item.id === 'navigatePanelBack')?.shortcut).toBe('Ctrl+Left')
    expect(preserved.find((item: { id: string }) => item.id === 'navigatePanelForward')?.shortcut).toBe('Ctrl+Right')
  })

  it('never migrates Windows or Linux history defaults', async () => {
    const backend = await loadBackend()
    for (const platform of ['win32', 'linux']) {
      const normalized = backend.normalizeSettingsShortcuts(
        [
          { id: 'navigatePanelBack', action: '导航到上一个面板', shortcut: 'Ctrl+Left' },
          { id: 'navigatePanelForward', action: '导航到下一个面板', shortcut: 'Ctrl+Right' }
        ],
        { platform, migrateLegacyDefaults: true }
      )
      expect(normalized.find((item: { id: string }) => item.id === 'navigatePanelBack')?.shortcut).toBe('Ctrl+Left')
      expect(normalized.find((item: { id: string }) => item.id === 'navigatePanelForward')?.shortcut).toBe('Ctrl+Right')
    }
  })

  it('does not infer settings preference seed rules from NODE_ENV test', async () => {
    const backend = await loadBackend()
    backend.configureSettingsPreferencesBackendRuntime()

    const result = backend.getSettingsPreferences()

    expect(process.env.NODE_ENV).toBe('test')
    expect(result.ok).toBe(true)
    expect(result.data?.rules).toEqual([])
  })

  it('loads settings preference seed rules only when the seed environment switch is enabled', async () => {
    process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED = '1'
    const backend = await loadBackend()
    backend.configureSettingsPreferencesBackendRuntime()

    const result = backend.getSettingsPreferences()

    expect(result.ok).toBe(true)
    expect(result.data?.rules).toEqual([
      { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
      { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
    ])
  })

  it('does not expose development seed rules in non-seed runtime defaults', async () => {
    const backend = await loadBackend()
    backend.configureSettingsPreferencesBackendRuntime({ useSeedData: false })

    const result = backend.getSettingsPreferences()

    expect(result.ok).toBe(true)
    expect(result.data?.shortcuts).toEqual(defaultSettingsShortcuts(process.platform))
    expect(result.data?.rules).toEqual([])
  })

  it('migrates the old recent panels default while preserving an existing Ctrl+Tab binding', async () => {
    storeState.set('aiopsterm-settings-preferences', {
      preferences: {
        shortcuts: [
          { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Tab' },
          { id: 'recentPanels', action: '打开最近面板', shortcut: 'Ctrl+E' }
        ],
        rules: []
      }
    })
    const backend = await loadBackend()
    const result = backend.getSettingsPreferences()

    expect(result.ok).toBe(true)
    expect(result.data?.shortcuts.find((shortcut: { id: string }) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Tab')
    expect(result.data?.shortcuts.find((shortcut: { id: string }) => shortcut.id === 'recentPanels')?.shortcut).toBe('Ctrl+Shift+E')
    expect(result.data?.shortcuts.find((shortcut: { id: string }) => shortcut.id === 'closeCurrentPanel')?.shortcut).toBe('Ctrl+Shift+W')
  })

  it('strips unchanged legacy seed rules in non-seed runtime while preserving user edits', async () => {
    const backend = await loadBackend()
    backend.configureSettingsPreferencesBackendRuntime({ useSeedData: true })
    expect(backend.getSettingsPreferences().data?.rules.map((rule: { id: string }) => rule.id)).toEqual(['rule-1', 'rule-2'])

    backend.configureSettingsPreferencesBackendRuntime({ useSeedData: false })
    let restored = backend.getSettingsPreferences()

    expect(restored.ok).toBe(true)
    expect(restored.data?.rules).toEqual([])
    expect(storeState.get('aiopsterm-settings-preferences')?.preferences).toMatchObject({
      rules: []
    })

    storeState.set('aiopsterm-settings-preferences', {
      preferences: {
        shortcuts: [
          { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
          { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
          { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
          { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
        ],
        rules: [
          { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令、影响面和回滚点。', enabled: true },
          { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
        ]
      }
    })

    backend.configureSettingsPreferencesBackendRuntime({ useSeedData: false })
    restored = backend.getSettingsPreferences()

    expect(restored.ok).toBe(true)
    expect(restored.data?.rules).toEqual([
      {
        id: 'rule-1',
        content: '执行生产变更前必须先给出只读检查命令、影响面和回滚点。',
        enabled: true
      }
    ])
    expect(storeState.get('aiopsterm-settings-preferences')?.preferences).toMatchObject({
      rules: [
        {
          id: 'rule-1',
          content: '执行生产变更前必须先给出只读检查命令、影响面和回滚点。',
          enabled: true
        }
      ]
    })
  })

  it('migrates flat shortcuts and legacy custom instructions behind the backend boundary', async () => {
    const backend = await loadBackend()
    const result = backend.getSettingsPreferences({
      shortcuts: {
        newTerminal: 'Ctrl+Alt+T',
        toggleAi: ' Ctrl+Alt+A ',
        switchToSpecificTab: 'Alt+1',
        unknownAction: 'Ctrl+Alt+X'
      },
      rules: [
        { id: 'rule-a', content: '  release must include rollback  ', enabled: false, isEditing: true },
        { id: 'rule-a', content: 'inspect logs first' },
        { id: '', content: '   ' }
      ],
      customInstructions: '  legacy global instruction  '
    })

    expect(result.ok).toBe(true)
    if (!result.data) throw new Error('settings preferences snapshot missing')
    expect(result.data.shortcuts).toEqual(defaultSettingsShortcuts(process.platform).map((shortcut) => {
      if (shortcut.id === 'newTerminal') return { ...shortcut, shortcut: 'Ctrl+Alt+T' }
      if (shortcut.id === 'toggleAi') return { ...shortcut, shortcut: 'Ctrl+Alt+A' }
      return shortcut
    }))
    expect(result.data.rules).toEqual([
      { id: 'rule-custom-instructions', content: 'legacy global instruction', enabled: true },
      { id: 'rule-a', content: 'release must include rollback', enabled: false },
      { id: 'rule-a-2', content: 'inspect logs first', enabled: true }
    ])
  })

  it('saves, toggles, and deletes rules with backend-returned snapshots', async () => {
    const backend = await loadBackend()
    backend.getSettingsPreferences()

    const created = backend.saveSettingsRule({ content: '  must ask before restart  ', enabled: true })
    expect(created.ok).toBe(true)
    if (!created.data) throw new Error('created rule snapshot missing')
    const createdRule = created.data.rules[0]
    expect(createdRule).toEqual({ id: expect.stringMatching(/^rule-/), content: 'must ask before restart', enabled: true })

    const ignoredClientId = backend.saveSettingsRule({ id: 'client-created-rule', content: 'client id should be ignored', enabled: true })
    expect(ignoredClientId.ok).toBe(true)
    expect(ignoredClientId.data?.rules[0]).toEqual({
      id: expect.stringMatching(/^rule-/),
      content: 'client id should be ignored',
      enabled: true
    })
    expect(ignoredClientId.data?.rules[0].id).not.toBe('client-created-rule')

    const disabled = backend.saveSettingsRule({ id: createdRule.id, content: 'must ask before restart', enabled: false })
    expect(disabled.ok).toBe(true)
    if (!disabled.data) throw new Error('disabled rule snapshot missing')
    expect(disabled.data.rules[0]).toEqual({ id: createdRule.id, content: 'must ask before restart', enabled: false })

    const deleted = backend.deleteSettingsRule(createdRule.id)
    expect(deleted.ok).toBe(true)
    if (!deleted.data) throw new Error('deleted rule snapshot missing')
    expect(deleted.data.deleted).toEqual({ id: createdRule.id, content: 'must ask before restart', enabled: false })
    expect(deleted.data.rules.some((rule: { id: string }) => rule.id === createdRule.id)).toBe(false)
  })

  it('validates shortcut saves and resets shortcuts through the backend store', async () => {
    const backend = await loadBackend()
    backend.getSettingsPreferences()

    expect(backend.saveSettingsShortcut({ id: 'switchToSpecificTab', shortcut: 'Alt+1' })).toEqual({
      ok: false,
      errorCode: 'SETTINGS_SHORTCUT_INVALID',
      errorMessage: 'Shortcut is invalid.'
    })
    expect(backend.saveSettingsShortcut({ id: 'newTerminal', shortcut: 'Ctrl+Shift+P' })).toEqual({
      ok: false,
      errorCode: 'SETTINGS_SHORTCUT_DUPLICATE',
      errorMessage: 'Shortcut already exists.'
    })

    const saved = backend.saveSettingsShortcut({ id: 'newTerminal', shortcut: 'Ctrl+Alt+N' })
    expect(saved.ok).toBe(true)
    if (!saved.data) throw new Error('saved shortcut snapshot missing')
    expect(saved.data.shortcuts.find((shortcut: { id: string }) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Alt+N')

    const reset = backend.resetSettingsShortcuts()
    expect(reset.ok).toBe(true)
    if (!reset.data) throw new Error('reset shortcut snapshot missing')
    expect(reset.data.shortcuts.find((shortcut: { id: string }) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Shift+T')
  })
})
