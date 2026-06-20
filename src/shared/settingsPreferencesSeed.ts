import type { UserRuleConfig } from './contracts/settingsPreferences'
import { shouldUseSettingsPreferencesSeedData as runtimeShouldUseSettingsPreferencesSeedData } from './runtimeSwitches'

const defaultSettingsRuleSeeds: UserRuleConfig[] = [
  { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
  { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
]

const cloneRule = (rule: UserRuleConfig): UserRuleConfig => ({ ...rule })

export const defaultSettingsRuleSeedData = () => defaultSettingsRuleSeeds.map(cloneRule)

export const shouldUseSettingsPreferencesSeedData = runtimeShouldUseSettingsPreferencesSeedData

export const defaultSettingsRulesConfig = () => (shouldUseSettingsPreferencesSeedData() ? defaultSettingsRuleSeedData() : [])
