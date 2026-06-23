import { ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceSettingsPreferencesController,
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut
} from '@/services/workspaceSettingsPreferencesController'
import { malformedSettingsBackendResultMessage } from '@/services/settingsBackendGuards'
import type { UserConfig } from '@shared/contracts/userConfig'

const originalAiops = window.aiops

const shortcuts: WorkspaceSettingsShortcut[] = [
  { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
  { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' },
  { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' }
]

const rules: WorkspaceSettingsRule[] = [
  { id: 'rule-1', content: 'Ask before restart', enabled: true },
  { id: 'rule-2', content: 'Check disk pressure', enabled: false }
]

const createConfig = (): UserConfig => ({
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.68,
    brightness: 0.92
  },
  shortcuts: shortcuts.map((shortcut) => ({ ...shortcut })),
  rules: rules.map((rule) => ({ ...rule })),
  customInstructions: 'legacy instructions'
})

type PreferencesHarness = {
  config: Ref<UserConfig>
  settingsRules: Ref<WorkspaceSettingsRule[]>
  settingsShortcuts: Ref<WorkspaceSettingsShortcut[]>
  shortcutRecording: Ref<{ actionId: string | null; tempShortcut: string }>
  notices: string[]
  runtime: {
    destroy: ReturnType<typeof vi.fn>
    install: ReturnType<typeof vi.fn>
    setRecording: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  controller: ReturnType<typeof createWorkspaceSettingsPreferencesController>
}

const createHarness = (overrides: Partial<UserConfig> = {}): PreferencesHarness => {
  const config = ref({ ...createConfig(), ...overrides }) as Ref<UserConfig>
  const settingsRules = ref(rules.map((rule) => ({ ...rule, isEditing: false })))
  const settingsShortcuts = ref(shortcuts.map((shortcut) => ({ ...shortcut })))
  const shortcutRecording = ref({ actionId: null, tempShortcut: '' })
  const notices: string[] = []
  const runtime = {
    destroy: vi.fn(),
    install: vi.fn(),
    setRecording: vi.fn(),
    update: vi.fn()
  }
  const controller = createWorkspaceSettingsPreferencesController(
    {
      config,
      settingsRules,
      settingsShortcuts,
      shortcutRecording
    },
    {
      runtime,
      setSettingsNotice: (message) => notices.push(message),
      shortcutHandlers: {
        newTerminal: vi.fn(),
        quickCommand: vi.fn(),
        switchToSpecificTab: vi.fn()
      }
    }
  )
  return {
    config,
    settingsRules,
    settingsShortcuts,
    shortcutRecording,
    notices,
    runtime,
    controller
  }
}

beforeEach(() => {
  window.aiops = {
    ...originalAiops,
    getSettingsPreferences: vi.fn(),
    saveSettingsRule: vi.fn(),
    deleteSettingsRule: vi.fn(),
    saveSettingsShortcut: vi.fn(),
    resetSettingsShortcuts: vi.fn()
  }
})

afterEach(() => {
  window.aiops = originalAiops
  vi.restoreAllMocks()
})

describe('createWorkspaceSettingsPreferencesController', () => {
  it('hydrates and applies Settings Preferences snapshots through the injected shortcut runtime', async () => {
    const bridgeSnapshot = {
      shortcuts: [
        { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Alt+N' },
        { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Alt+P' }
      ],
      rules: [{ id: 'rule-bridge', content: 'Bridge rule', enabled: true }]
    }
    vi.mocked(window.aiops.getSettingsPreferences!).mockResolvedValueOnce({
      ok: true,
      data: bridgeSnapshot
    })
    const harness = createHarness()

    await expect(harness.controller.hydrateSettingsPreferences(harness.config.value)).resolves.toEqual({
      normalizedShortcuts: bridgeSnapshot.shortcuts,
      normalizedRules: bridgeSnapshot.rules
    })
    expect(harness.settingsShortcuts.value).toEqual(bridgeSnapshot.shortcuts)
    expect(harness.settingsRules.value).toEqual([{ ...bridgeSnapshot.rules[0], isEditing: false }])
    expect(harness.runtime.update).not.toHaveBeenCalled()

    const applied = harness.controller.applySettingsPreferencesSnapshot({
      shortcuts: [{ id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+K' }],
      rules: [{ id: 'rule-applied', content: 'Applied rule', enabled: false }]
    })

    expect(applied.shortcuts).toEqual([{ id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+K' }])
    expect(applied.rules).toEqual([{ id: 'rule-applied', content: 'Applied rule', enabled: false }])
    expect(harness.config.value.shortcuts).toEqual(applied.shortcuts)
    expect(harness.config.value.rules).toEqual(applied.rules)
    expect(harness.config.value.customInstructions).toBe('')
    expect(harness.runtime.update).toHaveBeenCalledWith(applied.shortcuts, expect.objectContaining({ newTerminal: expect.any(Function) }))

    harness.controller.installShortcutRuntime()
    harness.controller.refreshShortcutRuntime()
    harness.controller.uninstallShortcutRuntime()
    expect(harness.runtime.install).toHaveBeenCalledWith(applied.shortcuts, expect.objectContaining({ quickCommand: expect.any(Function) }))
    expect(harness.runtime.update).toHaveBeenLastCalledWith(applied.shortcuts, expect.objectContaining({ switchToSpecificTab: expect.any(Function) }))
    expect(harness.runtime.destroy).toHaveBeenCalledTimes(1)
  })

  it('owns rule draft, save, edit cancel, toggle, and delete flows', async () => {
    const harness = createHarness()

    harness.controller.addSettingsRule()
    harness.controller.addSettingsRule()
    expect(harness.settingsRules.value.filter((rule) => rule.id === 'rule-draft-new')).toHaveLength(1)

    harness.controller.updateSettingsRuleDraft('rule-draft-new', '  New deployment rule  ')
    vi.mocked(window.aiops.saveSettingsRule!).mockResolvedValueOnce({
      ok: true,
      data: {
        shortcuts,
        rules: [{ id: 'rule-new', content: 'New deployment rule', enabled: true }, ...rules],
        message: '规则已保存'
      }
    })
    await expect(harness.controller.saveSettingsRule('rule-draft-new')).resolves.toBe(true)
    expect(window.aiops.saveSettingsRule).toHaveBeenCalledWith({ content: '  New deployment rule  ', enabled: true })
    expect(harness.settingsRules.value[0]).toEqual({ id: 'rule-new', content: 'New deployment rule', enabled: true, isEditing: false })
    expect(harness.notices.at(-1)).toBe('规则已保存')

    harness.controller.editSettingsRule('rule-new')
    harness.controller.updateSettingsRuleDraft('rule-new', 'Discarded edit')
    harness.controller.cancelSettingsRuleEdit('rule-new')
    expect(harness.settingsRules.value.find((rule) => rule.id === 'rule-new')).toEqual({
      id: 'rule-new',
      content: 'New deployment rule',
      enabled: true,
      isEditing: false,
      isDraft: false
    })

    vi.mocked(window.aiops.saveSettingsRule!).mockResolvedValueOnce({
      ok: true,
      data: {
        shortcuts,
        rules: [{ id: 'rule-new', content: 'New deployment rule', enabled: false }, ...rules],
        message: '规则已保存'
      }
    })
    await expect(harness.controller.toggleSettingsRule('rule-new')).resolves.toBe(true)
    expect(window.aiops.saveSettingsRule).toHaveBeenLastCalledWith({ id: 'rule-new', content: 'New deployment rule', enabled: false })
    expect(harness.notices.at(-1)).toBe('规则已禁用')

    vi.mocked(window.aiops.deleteSettingsRule!).mockResolvedValueOnce({
      ok: true,
      data: {
        shortcuts,
        rules,
        deleted: { id: 'rule-new', content: 'New deployment rule', enabled: false }
      }
    })
    await expect(harness.controller.deleteSettingsRule('rule-new')).resolves.toBe(true)
    expect(window.aiops.deleteSettingsRule).toHaveBeenCalledWith('rule-new')
    expect(harness.settingsRules.value.some((rule) => rule.id === 'rule-new')).toBe(false)
    expect(harness.notices.at(-1)).toBe('规则已删除')

    harness.controller.addSettingsRule()
    await expect(harness.controller.saveSettingsRule('rule-draft-new')).resolves.toBe(false)
    expect(harness.settingsRules.value.some((rule) => rule.id === 'rule-draft-new')).toBe(false)
  })

  it('owns shortcut recording save, duplicate/invalid guards, cancel, and reset flows', async () => {
    const harness = createHarness()

    harness.controller.startShortcutRecording('newTerminal')
    harness.controller.updateShortcutRecording('Ctrl+Shift+N')
    vi.mocked(window.aiops.saveSettingsShortcut!).mockResolvedValueOnce({
      ok: true,
      data: {
        shortcuts: [{ ...shortcuts[0], shortcut: 'Ctrl+Shift+N' }, shortcuts[1], shortcuts[2]],
        rules,
        message: '快捷键已保存'
      }
    })

    await expect(harness.controller.saveShortcutRecording()).resolves.toBe(true)
    expect(window.aiops.saveSettingsShortcut).toHaveBeenCalledWith({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })
    expect(harness.shortcutRecording.value).toEqual({ actionId: null, tempShortcut: '' })
    expect(harness.runtime.setRecording).toHaveBeenLastCalledWith(false)
    expect(harness.settingsShortcuts.value.find((shortcut) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Shift+N')

    harness.controller.startShortcutRecording('quickCommand')
    harness.controller.updateShortcutRecording('Ctrl+Shift+N')
    await expect(harness.controller.saveShortcutRecording()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('快捷键已被占用')

    harness.controller.startShortcutRecording('switchToSpecificTab')
    harness.controller.updateShortcutRecording('Alt+1')
    await expect(harness.controller.saveShortcutRecording()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('快捷键格式无效')

    harness.controller.cancelShortcutRecording()
    expect(harness.shortcutRecording.value).toEqual({ actionId: null, tempShortcut: '' })
    expect(harness.runtime.setRecording).toHaveBeenLastCalledWith(false)

    vi.mocked(window.aiops.resetSettingsShortcuts!).mockResolvedValueOnce({
      ok: true,
      data: {
        shortcuts,
        rules,
        message: '快捷键已全部重置'
      }
    })
    await expect(harness.controller.resetAllShortcuts()).resolves.toBe(true)
    expect(window.aiops.resetSettingsShortcuts).toHaveBeenCalledTimes(1)
    expect(harness.settingsShortcuts.value).toEqual(shortcuts)
    expect(harness.notices.at(-1)).toBe('快捷键已全部重置')
  })

  it('fails closed when preference bridges are unavailable, fail, or return malformed payloads', async () => {
    const harness = createHarness()

    window.aiops = {
      ...window.aiops,
      getSettingsPreferences: undefined as any,
      saveSettingsRule: undefined as any,
      deleteSettingsRule: undefined as any,
      saveSettingsShortcut: undefined as any,
      resetSettingsShortcuts: undefined as any
    }

    await expect(harness.controller.hydrateSettingsPreferences(harness.config.value)).resolves.toEqual({
      normalizedShortcuts: shortcuts,
      normalizedRules: [
        { id: 'rule-custom-instructions', content: 'legacy instructions', enabled: true },
        ...rules
      ]
    })

    harness.controller.editSettingsRule('rule-1')
    harness.controller.updateSettingsRuleDraft('rule-1', 'Unsaved rule')
    await expect(harness.controller.saveSettingsRule('rule-1')).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('规则保存服务不可用')
    await expect(harness.controller.toggleSettingsRule('rule-1')).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('规则更新服务不可用')
    await expect(harness.controller.deleteSettingsRule('rule-1')).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('规则删除服务不可用')

    harness.controller.startShortcutRecording('newTerminal')
    harness.controller.updateShortcutRecording('Ctrl+Shift+N')
    await expect(harness.controller.saveShortcutRecording()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('快捷键保存服务不可用')
    await expect(harness.controller.resetAllShortcuts()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe('快捷键重置服务不可用')

    window.aiops = {
      ...originalAiops,
      getSettingsPreferences: vi.fn(async () => ({ ok: true, data: { shortcuts: [{ id: 'newTerminal', shortcut: 'Ctrl+Shift+T' }], rules } } as any)),
      saveSettingsRule: vi.fn(async () => ({ ok: true, data: { shortcuts, rules: [{ id: 'bad-rule', content: 'Bad rule' }], message: '规则已保存' } } as any)),
      deleteSettingsRule: vi.fn(async () => ({ ok: true, data: { shortcuts, rules, deleted: { id: 'rule-1', content: '', enabled: true } } })),
      saveSettingsShortcut: vi.fn(async () => ({ ok: true, data: { shortcuts: [{ id: 'newTerminal', action: '新建终端', shortcut: '' }], rules, message: '快捷键已保存' } })),
      resetSettingsShortcuts: vi.fn(async () => ({ ok: true, data: { shortcuts, rules, message: '' } }))
    }

    await harness.controller.hydrateSettingsPreferences(harness.config.value)
    expect(harness.notices.at(-1)).toBe(malformedSettingsBackendResultMessage)

    harness.controller.editSettingsRule('rule-1')
    harness.controller.updateSettingsRuleDraft('rule-1', 'Malformed save result')
    const rulesBeforeMalformedSave = JSON.stringify(harness.settingsRules.value)
    await expect(harness.controller.saveSettingsRule('rule-1')).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe(malformedSettingsBackendResultMessage)
    expect(JSON.stringify(harness.settingsRules.value)).toBe(rulesBeforeMalformedSave)

    await expect(harness.controller.deleteSettingsRule('rule-1')).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe(malformedSettingsBackendResultMessage)

    harness.controller.startShortcutRecording('newTerminal')
    harness.controller.updateShortcutRecording('Ctrl+Shift+N')
    const recordingBeforeMalformedSave = { ...harness.shortcutRecording.value }
    await expect(harness.controller.saveShortcutRecording()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe(malformedSettingsBackendResultMessage)
    expect(harness.shortcutRecording.value).toEqual(recordingBeforeMalformedSave)

    await expect(harness.controller.resetAllShortcuts()).resolves.toBe(false)
    expect(harness.notices.at(-1)).toBe(malformedSettingsBackendResultMessage)
  })
})
