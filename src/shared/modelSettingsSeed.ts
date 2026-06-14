import type { ModelOptionUserConfig } from './preload'
import { defaultModelSettingsData } from './modelSettingsDefaults'
import { shouldUseModelSettingsSeedData as runtimeShouldUseModelSettingsSeedData } from './runtimeSwitches'

const developmentSeedModelOptions: ModelOptionUserConfig[] = [
  { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'custom-maintenance', displayName: 'Maintenance Gateway', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
]

const cloneModelOptions = (options: ModelOptionUserConfig[]) => options.map((option) => ({ ...option }))

export { defaultModelSettingsData } from './modelSettingsDefaults'

export const shouldUseModelSettingsSeedData = runtimeShouldUseModelSettingsSeedData

export const defaultModelSettingsSeedData = () => ({
  ...defaultModelSettingsData(),
  options: cloneModelOptions(developmentSeedModelOptions)
})

export const defaultModelSettingsConfig = () => (shouldUseModelSettingsSeedData() ? defaultModelSettingsSeedData() : defaultModelSettingsData())
