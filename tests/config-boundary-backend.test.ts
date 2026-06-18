import { beforeAll, describe, expect, it } from 'vitest'

const defaults = {
  modelProvider: 'local' as const,
  modelName: 'aiopsterm-local-agent'
}

type TestConfigDefaults = {
  modelProvider: 'local'
  modelName: string
}

let normalizeConfigModelProvider: (value: unknown, defaults: TestConfigDefaults) => 'local' | 'litellm' | 'openai-compatible' | 'ollama' | 'lmstudio' | 'bedrock' | 'deepseek' | 'anthropic'
let normalizeConfigModelName: (value: unknown, defaults: TestConfigDefaults) => string
let isLegacyLocalModelProvider: (value: unknown) => boolean
let isLegacyLocalModelName: (value: unknown) => boolean

beforeAll(async () => {
  const modulePath = '../src/main/backend/configBoundary'
  const backend = await import(modulePath)
  normalizeConfigModelProvider = backend.normalizeConfigModelProvider as typeof normalizeConfigModelProvider
  normalizeConfigModelName = backend.normalizeConfigModelName as typeof normalizeConfigModelName
  const shared = await import('../src/shared/modelConfigBoundary')
  isLegacyLocalModelProvider = shared.isLegacyLocalModelProvider as typeof isLegacyLocalModelProvider
  isLegacyLocalModelName = shared.isLegacyLocalModelName as typeof isLegacyLocalModelName
})

describe('main config boundary model normalization', () => {
  it('normalizes legacy mock model config at the main-process boundary', () => {
    expect(isLegacyLocalModelProvider('mock')).toBe(true)
    expect(isLegacyLocalModelProvider('local')).toBe(false)
    expect(isLegacyLocalModelName('mock-ops-agent')).toBe(true)
    expect(isLegacyLocalModelName('ops-local-agent')).toBe(true)
    expect(isLegacyLocalModelName('aiopsterm-local-agent')).toBe(false)
    expect(normalizeConfigModelProvider('mock', defaults)).toBe('local')
    expect(normalizeConfigModelName('mock-ops-agent', defaults)).toBe('aiopsterm-local-agent')
    expect(normalizeConfigModelName('ops-local-agent', defaults)).toBe('aiopsterm-local-agent')
  })

  it('keeps valid provider model choices and rejects malformed providers', () => {
    expect(normalizeConfigModelProvider('ollama', defaults)).toBe('ollama')
    expect(normalizeConfigModelProvider('lmstudio', defaults)).toBe('lmstudio')
    expect(normalizeConfigModelName('qwen2.5-coder', defaults)).toBe('qwen2.5-coder')
    expect(normalizeConfigModelProvider('unsupported-provider', defaults)).toBe('local')
    expect(normalizeConfigModelName('', defaults)).toBe('aiopsterm-local-agent')
  })
})
