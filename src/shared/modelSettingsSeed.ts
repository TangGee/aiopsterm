import type { ModelOptionUserConfig, ModelSettingsUserConfig } from './preload'

const defaultModelOptions: ModelOptionUserConfig[] = [
  { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' }
]

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

export const defaultModelSettingsData = (): ModelSettingsUserConfig => ({
  addModelSwitch: true,
  providers: {
    litellm: {
      baseUrl: 'http://localhost:4000',
      apiKey: '',
      modelId: 'gpt-5'
    },
    openai: {
      baseUrl: 'https://api.openai.com',
      apiKey: '',
      modelId: 'gpt-5',
      apiFormat: 'responses'
    },
    bedrock: {
      baseUrl: '',
      apiKey: '',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      awsAccessKey: '',
      awsSecretKey: '',
      awsSessionToken: '',
      awsRegion: 'us-east-1',
      awsUseCrossRegionInference: false,
      awsEndpointSelected: false,
      awsBedrockEndpoint: ''
    },
    deepseek: {
      baseUrl: '',
      apiKey: '',
      modelId: 'deepseek-chat'
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      modelId: 'claude-3-5-sonnet-latest'
    },
    ollama: {
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      modelId: 'llama3.1'
    }
  },
  options: cloneModelOptions(defaultModelOptions)
})

export const defaultModelSettingsSeedData = (): ModelSettingsUserConfig => ({
  ...defaultModelSettingsData(),
  options: cloneModelOptions(developmentSeedModelOptions)
})

export const defaultModelSettingsConfig = () => (shouldUseModelSettingsSeedData() ? defaultModelSettingsSeedData() : defaultModelSettingsData())
