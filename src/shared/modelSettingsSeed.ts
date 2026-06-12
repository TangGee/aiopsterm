import type { ModelOptionUserConfig } from './preload'
import { defaultModelSettingsData } from './modelSettingsDefaults'

const developmentSeedModelOptions: ModelOptionUserConfig[] = [
  { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
  { name: 'custom-maintenance', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
]

const cloneModelOptions = (options: ModelOptionUserConfig[]) => options.map((option) => ({ ...option }))

const isExplicitModelSettingsSeedEnabled = () => {
  try {
    return typeof process !== 'undefined' && String(process.env?.AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED || '').trim() === '1'
  } catch {
    return false
  }
}

export const shouldUseModelSettingsSeedData = () => isExplicitModelSettingsSeedEnabled()

export { defaultModelSettingsData } from './modelSettingsDefaults'

export const defaultModelSettingsSeedData = () => ({
  ...defaultModelSettingsData(),
  options: cloneModelOptions(developmentSeedModelOptions)
})

export const defaultModelSettingsConfig = () => (shouldUseModelSettingsSeedData() ? defaultModelSettingsSeedData() : defaultModelSettingsData())
