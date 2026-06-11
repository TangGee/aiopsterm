import { afterEach, describe, expect, it } from 'vitest'
import { defaultSettingsRuleSeedData, defaultSettingsRulesConfig, shouldUseSettingsPreferencesSeedData } from '@shared/settingsPreferencesSeed'

const originalSettingsPreferencesSeedEnv = process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED
const originalNodeEnv = process.env.NODE_ENV

describe('settings preferences seed config', () => {
  afterEach(() => {
    if (originalSettingsPreferencesSeedEnv === undefined) {
      delete process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED = originalSettingsPreferencesSeedEnv
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('does not infer settings rule seed config from NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test'
    delete process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED

    expect(shouldUseSettingsPreferencesSeedData()).toBe(false)
    expect(defaultSettingsRulesConfig()).toEqual([])
  })

  it('loads settings rule seed config only when explicitly enabled', () => {
    process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED = '1'

    const rules = defaultSettingsRulesConfig()

    expect(shouldUseSettingsPreferencesSeedData()).toBe(true)
    expect(rules).toEqual([
      { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
      { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
    ])
    expect(rules).toEqual(defaultSettingsRuleSeedData())
  })

  it('returns cloned seed rule rows', () => {
    process.env.AIOPSTERM_SETTINGS_PREFERENCES_ENABLE_SEED = '1'

    const first = defaultSettingsRulesConfig()
    const second = defaultSettingsRulesConfig()
    first[0].content = 'mutated'

    expect(second[0].content).toBe('执行生产变更前必须先给出只读检查命令和回滚点。')
  })
})
