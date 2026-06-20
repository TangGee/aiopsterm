import { afterEach, describe, expect, it, vi } from 'vitest'
import { settingsConfigClient } from '@/services/settingsConfigClient'

const originalAiops = window.aiops

const keywordHighlightConfig = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const securityConfig = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: ['rm -rf /'],
    whitelistPatterns: ['ls'],
    dangerousCommands: ['shutdown'],
    maxCommandLength: 4096,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: true
    }
  }
}

afterEach(() => {
  window.aiops = originalAiops
})

describe('settingsConfigClient', () => {
  it('returns undefined for unavailable bridge methods and binds Settings config file bridge methods', async () => {
    const removeSecurityListener = vi.fn()
    const removeKeywordListener = vi.fn()
    window.aiops = {
      ...originalAiops,
      getSecurityConfigPath: vi.fn(async () => '/tmp/aiopsterm/security-config.json'),
      readSecurityConfig: vi.fn(async () => JSON.stringify(securityConfig, null, 2)),
      writeSecurityConfig: vi.fn(async () => ({
        ok: true,
        data: {
          securityConfig
        }
      })),
      onSecurityConfigFileChanged: vi.fn(() => removeSecurityListener),
      getKeywordHighlightConfigPath: vi.fn(async () => '/tmp/aiopsterm/keyword-highlight.json'),
      readKeywordHighlightConfig: vi.fn(async () => JSON.stringify(keywordHighlightConfig, null, 2)),
      writeKeywordHighlightConfig: vi.fn(async () => ({
        ok: true,
        data: {
          keywordHighlight: keywordHighlightConfig
        }
      })),
      onKeywordHighlightConfigFileChanged: vi.fn(() => removeKeywordListener)
    }

    await expect(settingsConfigClient.getSecurityConfigPath()?.()).resolves.toBe('/tmp/aiopsterm/security-config.json')
    await expect(settingsConfigClient.readSecurityConfig()?.()).resolves.toBe(JSON.stringify(securityConfig, null, 2))
    await expect(settingsConfigClient.writeSecurityConfig()?.('{"security":{}}')).resolves.toEqual({
      ok: true,
      data: {
        securityConfig
      }
    })

    const securityListener = vi.fn()
    expect(settingsConfigClient.onSecurityConfigFileChanged()?.(securityListener)).toBe(removeSecurityListener)

    await expect(settingsConfigClient.getKeywordHighlightConfigPath()?.()).resolves.toBe('/tmp/aiopsterm/keyword-highlight.json')
    await expect(settingsConfigClient.readKeywordHighlightConfig()?.()).resolves.toBe(JSON.stringify(keywordHighlightConfig, null, 2))
    await expect(settingsConfigClient.writeKeywordHighlightConfig()?.('{"keyword-highlight":{}}')).resolves.toEqual({
      ok: true,
      data: {
        keywordHighlight: keywordHighlightConfig
      }
    })

    const keywordListener = vi.fn()
    expect(settingsConfigClient.onKeywordHighlightConfigFileChanged()?.(keywordListener)).toBe(removeKeywordListener)
    expect(window.aiops.writeSecurityConfig).toHaveBeenCalledWith('{"security":{}}')
    expect(window.aiops.onSecurityConfigFileChanged).toHaveBeenCalledWith(securityListener)
    expect(window.aiops.writeKeywordHighlightConfig).toHaveBeenCalledWith('{"keyword-highlight":{}}')
    expect(window.aiops.onKeywordHighlightConfigFileChanged).toHaveBeenCalledWith(keywordListener)

    window.aiops = {
      ...originalAiops,
      getSecurityConfigPath: undefined as any,
      readSecurityConfig: undefined as any,
      writeSecurityConfig: undefined as any,
      onSecurityConfigFileChanged: undefined as any,
      getKeywordHighlightConfigPath: undefined as any,
      readKeywordHighlightConfig: undefined as any,
      writeKeywordHighlightConfig: undefined as any,
      onKeywordHighlightConfigFileChanged: undefined as any
    }
    expect(settingsConfigClient.getSecurityConfigPath()).toBeUndefined()
    expect(settingsConfigClient.readSecurityConfig()).toBeUndefined()
    expect(settingsConfigClient.writeSecurityConfig()).toBeUndefined()
    expect(settingsConfigClient.onSecurityConfigFileChanged()).toBeUndefined()
    expect(settingsConfigClient.getKeywordHighlightConfigPath()).toBeUndefined()
    expect(settingsConfigClient.readKeywordHighlightConfig()).toBeUndefined()
    expect(settingsConfigClient.writeKeywordHighlightConfig()).toBeUndefined()
    expect(settingsConfigClient.onKeywordHighlightConfigFileChanged()).toBeUndefined()
  })
})
