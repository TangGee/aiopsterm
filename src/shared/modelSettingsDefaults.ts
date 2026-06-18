import type { ModelOptionUserConfig, ModelSettingsUserConfig } from './preload'

const defaultModelOptions: ModelOptionUserConfig[] = []

const cloneModelOptions = (options: ModelOptionUserConfig[]) => options.map((option) => ({ ...option }))

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
    },
    lmstudio: {
      baseUrl: 'http://localhost:1234',
      apiKey: '',
      modelId: 'openai/gpt-oss-20b'
    }
  },
  options: cloneModelOptions(defaultModelOptions)
})
