import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultModelSettingsConfig,
  defaultModelSettingsData,
  defaultModelSettingsSeedData,
  shouldUseModelSettingsSeedData
} from '@shared/modelSettingsSeed'

const originalModelSettingsSeedEnv = process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('model settings seed config', () => {
  afterEach(() => {
    if (originalModelSettingsSeedEnv === undefined) {
      delete process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED = originalModelSettingsSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer model settings seed config from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED

    const settings = defaultModelSettingsConfig()

    expect(shouldUseModelSettingsSeedData()).toBe(false)
    expect(settings.options.map((option) => option.name)).toEqual([])
    expect(settings.options.some((option) => option.name === 'custom-maintenance')).toBe(false)
    expect(settings).toEqual(defaultModelSettingsData())
  })

  it('loads development model rows only when explicitly enabled', () => {
    process.env.NODE_ENV = 'production'
    process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED = '1'

    const settings = defaultModelSettingsConfig()

    expect(shouldUseModelSettingsSeedData()).toBe(true)
    expect(settings.options.map((option) => option.name)).toEqual(['gpt-5', 'gpt-5-Thinking', 'aiopsterm-local-agent', 'custom-maintenance'])
    expect(settings).toEqual(defaultModelSettingsSeedData())
  })

  it('returns cloned model option rows', () => {
    process.env.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED = '1'

    const first = defaultModelSettingsConfig()
    const second = defaultModelSettingsConfig()
    first.options[0].name = 'mutated'

    expect(second.options[0].name).toBe('gpt-5')
  })
})
