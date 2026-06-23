import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsPreferencesClient } from '@/services/settings/settingsPreferencesClient'

const originalAiops = window.aiops

const snapshot = {
  shortcuts: [
    {
      id: 'newTerminal',
      action: '新建终端',
      shortcut: 'Ctrl+Alt+N'
    }
  ],
  rules: [
    {
      id: 'rule-1',
      content: 'Ask before restart',
      enabled: true
    }
  ]
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('settingsPreferencesClient', () => {
  it('returns undefined for unavailable bridge methods and binds Settings Preferences bridge methods', async () => {
    window.aiops = {
      ...originalAiops,
      getSettingsPreferences: vi.fn(async () => ({
        ok: true,
        data: snapshot
      })),
      saveSettingsRule: vi.fn(async (input) => ({
        ok: true,
        data: {
          ...snapshot,
          rules: [{ id: input.id || 'rule-2', content: input.content, enabled: input.enabled ?? true }],
          message: '规则已保存'
        }
      })),
      deleteSettingsRule: vi.fn(async (id) => ({
        ok: true,
        data: {
          shortcuts: snapshot.shortcuts,
          rules: [],
          deleted: { ...snapshot.rules[0], id }
        }
      })),
      saveSettingsShortcut: vi.fn(async (input) => ({
        ok: true,
        data: {
          ...snapshot,
          shortcuts: [{ ...snapshot.shortcuts[0], id: input.id, shortcut: input.shortcut }],
          message: '快捷键已保存'
        }
      })),
      resetSettingsShortcuts: vi.fn(async () => ({
        ok: true,
        data: {
          ...snapshot,
          message: '快捷键已全部重置'
        }
      }))
    }

    await expect(settingsPreferencesClient.getSettingsPreferences()?.()).resolves.toEqual({ ok: true, data: snapshot })
    await expect(settingsPreferencesClient.saveSettingsRule()?.({ content: 'Check rollout', enabled: true })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          rules: [expect.objectContaining({ content: 'Check rollout', enabled: true })],
          message: '规则已保存'
        })
      })
    )
    await expect(settingsPreferencesClient.deleteSettingsRule()?.('rule-1')).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ deleted: expect.objectContaining({ id: 'rule-1' }) })
      })
    )
    await expect(settingsPreferencesClient.saveSettingsShortcut()?.({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          shortcuts: [expect.objectContaining({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })],
          message: '快捷键已保存'
        })
      })
    )
    await expect(settingsPreferencesClient.resetSettingsShortcuts()?.()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ message: '快捷键已全部重置' })
      })
    )

    expect(window.aiops.getSettingsPreferences).toHaveBeenCalledTimes(1)
    expect(window.aiops.saveSettingsRule).toHaveBeenCalledWith({ content: 'Check rollout', enabled: true })
    expect(window.aiops.deleteSettingsRule).toHaveBeenCalledWith('rule-1')
    expect(window.aiops.saveSettingsShortcut).toHaveBeenCalledWith({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })
    expect(window.aiops.resetSettingsShortcuts).toHaveBeenCalledTimes(1)

    window.aiops = {
      ...originalAiops,
      getSettingsPreferences: undefined as any,
      saveSettingsRule: undefined as any,
      deleteSettingsRule: undefined as any,
      saveSettingsShortcut: undefined as any,
      resetSettingsShortcuts: undefined as any
    }
    expect(settingsPreferencesClient.getSettingsPreferences()).toBeUndefined()
    expect(settingsPreferencesClient.saveSettingsRule()).toBeUndefined()
    expect(settingsPreferencesClient.deleteSettingsRule()).toBeUndefined()
    expect(settingsPreferencesClient.saveSettingsShortcut()).toBeUndefined()
    expect(settingsPreferencesClient.resetSettingsShortcuts()).toBeUndefined()
  })
})
