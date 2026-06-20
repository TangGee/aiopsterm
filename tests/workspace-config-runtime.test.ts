import { describe, expect, it } from 'vitest'
import {
  defaultAiPreferences,
  defaultKeywordHighlightSettings,
  defaultPrivacySettings,
  isKnowledgeSearchRuntimeSnapshotForRequest,
  isPrivacyRuntimeSnapshotForRequest,
  isVisibleModelSettingsOption,
  keywordHighlightEditorContentFromFile,
  keywordHighlightSettingsSnapshotsMatch,
  modelOptionProviderForSavedProvider,
  modelSettingsSnapshotsMatch,
  normalizeAiPreferencesConfig,
  normalizeEditorSettingsConfig,
  normalizeKeywordHighlightConfig,
  normalizeModelSettingsConfig,
  normalizePrivacyConfig,
  normalizeSecurityConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs,
  normalizeTerminalConfig,
  normalizeWorkspacePreferences,
  parseKeywordHighlightEditorContent,
  parseSecurityEditorContent,
  privacyRuntimeSettingsFromSnapshot,
  readSshAgentKeychainOptionsSnapshot,
  securityEditorContentFromFile,
  securitySettingsSnapshotsMatch,
  sshAgentKeySnapshotsMatch,
  sshProxyConfigSnapshotsMatch,
  type SecuritySettings
} from '@/services/workspaceConfigRuntime'
import type { PrivacyRuntimeSnapshot } from '@shared/contracts/appRuntime'

describe('workspaceConfigRuntime', () => {
  it('normalizes terminal, editor, and workspace preference snapshots', () => {
    const terminal = normalizeTerminalConfig({
      terminalType: 'bad',
      fontFamily: 'Monaco, "Courier New", Consolas, Courier, monospace',
      fontSize: 7,
      scrollBack: 0,
      cursorStyle: 'beam' as any,
      cursorBlink: false,
      lineHeight: 4,
      pinchZoomStatus: false,
      showCloseButton: false,
      sshAgentsStatus: true,
      middleMouseEvent: 'closeTab',
      rightMouseEvent: 'closeTab' as any
    })
    expect(terminal.changed).toBe(true)
    expect(terminal.normalized).toMatchObject({
      terminalType: 'xterm-256color',
      fontFamily: '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace',
      fontSize: 12,
      scrollBack: 1000,
      cursorStyle: 'block',
      cursorBlink: false,
      lineHeight: 1,
      pinchZoomStatus: false,
      showCloseButton: false,
      sshAgentsStatus: true,
      middleMouseEvent: 'closeTab',
      rightMouseEvent: 'contextMenu'
    })

    const editor = normalizeEditorSettingsConfig({
      fontSize: 100,
      lineHeight: 24,
      fontFamily: '  JetBrains Mono  ',
      tabSize: 0,
      wordWrap: 'bad' as any,
      minimap: false,
      mouseWheelZoom: false
    })
    expect(editor.changed).toBe(true)
    expect(editor.normalized).toEqual({
      fontSize: 14,
      lineHeight: 24,
      fontFamily: 'JetBrains Mono',
      tabSize: 4,
      wordWrap: 'off',
      minimap: false,
      mouseWheelZoom: false
    })

    const preferences = normalizeWorkspacePreferences({
      expandedGroups: ['recent_connections', 'recent_connections', '', 'local_connections'],
      showIpMode: true,
      recentAssetIds: ['a', 'b', 'a', '', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
    })
    expect(preferences.changed).toBe(true)
    expect(preferences.normalized).toEqual({
      expandedGroups: ['recent_connections', 'local_connections'],
      showIpMode: true,
      recentAssetIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    })
  })

  it('normalizes SSH proxy and agent snapshots and compares canonical forms', () => {
    const proxies = normalizeSshProxyConfigs([
      { name: ' prod ', type: 'HTTP', host: ' proxy.local ', port: 8080, enableProxyIdentity: true, username: 'u', password: 'p', extra: true },
      { name: 'prod', type: 'SOCKS5', host: 'ignored', port: 1080, enableProxyIdentity: false, username: '', password: '' },
      { name: '', type: 'TCP', host: 'missing-name', port: 22 }
    ])
    expect(proxies.changed).toBe(true)
    expect(proxies.normalized).toEqual([
      { name: 'prod', type: 'HTTP', host: 'proxy.local', port: 8080, enableProxyIdentity: true, username: 'u', password: 'p' }
    ])
    expect(sshProxyConfigSnapshotsMatch(proxies.normalized, [{ ...proxies.normalized[0], port: 8080 }])).toBe(true)

    const keys = normalizeSshAgentKeys([
      { id: ' key-1 ', fingerprint: ' SHA256:abc ', comment: ' prod ', keyType: 'ed25519', keyChainId: ' chain-1 ' },
      { id: 'key-1', fingerprint: 'SHA256:dup', comment: 'dup', keyType: 'RSA', keyChainId: 'chain-2' },
      { id: 'key-2', fingerprint: 'SHA256:def', comment: 'ops', keyType: '', key: 'chain-2' }
    ])
    expect(keys.changed).toBe(true)
    expect(keys.normalized).toEqual([
      { id: 'key-1', fingerprint: 'SHA256:abc', comment: 'prod', keyType: 'ED25519', keyChainId: 'chain-1' },
      { id: 'key-2', fingerprint: 'SHA256:def', comment: 'ops', keyType: 'UNKNOWN', keyChainId: 'chain-2' }
    ])
    expect(sshAgentKeySnapshotsMatch(keys.normalized, keys.normalized.map((key) => ({ ...key })))).toBe(true)
    expect(readSshAgentKeychainOptionsSnapshot([{ key: 'k', label: 'Key', fingerprint: 'fp', keyType: 'rsa' }])).toEqual([
      { key: 'k', label: 'Key', fingerprint: 'fp', keyType: 'RSA' }
    ])
    expect(readSshAgentKeychainOptionsSnapshot([{ key: '', label: 'bad', fingerprint: 'fp', keyType: 'rsa' }])).toBeNull()
  })

  it('normalizes keyword highlight and security editor content without store state', () => {
    const highlight = normalizeKeywordHighlightConfig({
      'keyword-highlight': {
        enabled: 1,
        applyTo: { output: true, input: 0 },
        rules: [
          {
            name: ' Errors ',
            enabled: true,
            scope: 'both',
            matchType: 'wildcard',
            pattern: [' error ', '', 'fatal'],
            style: { foreground: '#ff0000', fontStyle: 'normal' }
          },
          {
            name: 'Errors',
            enabled: true,
            scope: 'output',
            matchType: 'regex',
            pattern: 'ignored',
            style: { foreground: '#00FF00', fontStyle: 'bold' }
          }
        ]
      }
    })
    expect(highlight.changed).toBe(true)
    expect(highlight.normalized['keyword-highlight']).toEqual({
      enabled: true,
      applyTo: { output: true, input: false },
      rules: [
        {
          name: 'Errors',
          enabled: true,
          scope: 'both',
          matchType: 'wildcard',
          pattern: ['error', 'fatal'],
          style: { foreground: '#FF0000', fontStyle: 'normal' }
        }
      ]
    })
    expect(keywordHighlightEditorContentFromFile('')).toBe(JSON.stringify(defaultKeywordHighlightSettings, null, 2))
    expect(parseKeywordHighlightEditorContent(JSON.stringify(highlight.normalized))).toEqual(highlight.normalized)
    expect(keywordHighlightSettingsSnapshotsMatch(highlight.normalized, normalizeKeywordHighlightConfig(highlight.normalized).normalized)).toBe(true)

    const securityContent = `
      // user comment
      {
        "security": {
          "enableCommandSecurity": 1,
          "enableStrictMode": 0,
          "blacklistPatterns": [" rm -rf / ", ""],
          "whitelistPatterns": [" ls "],
          "dangerousCommands": [" shutdown "],
          "maxCommandLength": 1200,
          "securityPolicy": {
            "blockCritical": 1,
            "askForMedium": 0,
            "askForHigh": true,
            "askForBlacklist": false
          }
        }
      }
    `
    const parsed = parseSecurityEditorContent(securityContent)
    const security = normalizeSecurityConfig(parsed)
    expect(security.changed).toBe(true)
    expect(security.normalized.security).toMatchObject({
      enableCommandSecurity: true,
      enableStrictMode: false,
      blacklistPatterns: ['rm -rf /'],
      whitelistPatterns: ['ls'],
      dangerousCommands: ['shutdown'],
      maxCommandLength: 1200,
      securityPolicy: {
        blockCritical: true,
        askForMedium: false,
        askForHigh: true,
        askForBlacklist: false
      }
    })
    const cleanContent = securityEditorContentFromFile(securityContent)
    expect(cleanContent).not.toContain('// user comment')
    expect(securitySettingsSnapshotsMatch(security.normalized, normalizeSecurityConfig(security.normalized).normalized as SecuritySettings)).toBe(true)
  })

  it('normalizes privacy, AI preferences, and runtime snapshot guards', () => {
    expect(normalizePrivacyConfig({ telemetry: 'off' as any, secretRedaction: 'enabled', dataSync: 'enabled' }).normalized).toEqual({
      telemetry: defaultPrivacySettings.telemetry,
      secretRedaction: 'enabled',
      dataSync: 'enabled'
    })

    const privacySnapshot: PrivacyRuntimeSnapshot = {
      telemetry: 'enabled',
      dataSync: 'enabled',
      appliedAt: '2026-06-21T00:00:00.000Z',
      dataSyncRuntime: 'service',
      syncStatus: 'synced',
      syncRunId: 'run-1',
      syncedScopes: ['config', 'knowledge'],
      stateFilePath: '/tmp/state.json',
      lastSyncAt: '2026-06-21T00:00:01.000Z',
      message: 'applied'
    }
    expect(isPrivacyRuntimeSnapshotForRequest(privacySnapshot, { telemetry: 'enabled', secretRedaction: 'disabled', dataSync: 'enabled' })).toBe(true)
    expect(privacyRuntimeSettingsFromSnapshot(privacySnapshot)).toEqual({
      dataSyncRuntime: 'service',
      dataSyncStatus: 'synced',
      dataSyncRunId: 'run-1',
      dataSyncStateFilePath: '/tmp/state.json',
      dataSyncLastSyncAt: '2026-06-21T00:00:01.000Z',
      dataSyncSyncedScopes: ['config', 'knowledge'],
      dataSyncErrorMessage: ''
    })
    expect(isKnowledgeSearchRuntimeSnapshotForRequest({ enabled: false, source: 'settings', appliedAt: 'now', message: 'ok' }, false)).toBe(true)

    const aiPreferences = normalizeAiPreferencesConfig({
      ...defaultAiPreferences,
      enableExtendedThinking: true,
      thinkingBudgetTokens: 999999,
      reasoningEffort: 'extreme' as any,
      proxy: {
        type: 'TCP' as any,
        host: 'proxy.local',
        port: 0,
        enableProxyIdentity: true,
        username: 'user',
        password: 'pass'
      },
      shellIntegrationTimeout: 999
    })
    expect(aiPreferences.changed).toBe(true)
    expect(aiPreferences.normalized).toMatchObject({
      enableExtendedThinking: true,
      thinkingBudgetTokens: 6553,
      reasoningEffort: 'medium',
      shellIntegrationTimeout: 4,
      proxy: {
        type: 'HTTP',
        host: 'proxy.local',
        port: 7890,
        enableProxyIdentity: true,
        username: 'user',
        password: 'pass'
      }
    })
    expect(normalizeAiPreferencesConfig({ ...defaultAiPreferences, enableExtendedThinking: false, thinkingBudgetTokens: 4096 }).normalized.thinkingBudgetTokens).toBe(0)
  })

  it('normalizes model settings and hides legacy local model options', () => {
    const modelSettings = normalizeModelSettingsConfig({
      addModelSwitch: 'yes',
      providers: {
        openai: { baseUrl: ' https://api.example.com ', apiKey: 'secret', modelId: ' gpt-test ', apiFormat: 'bad' },
        bedrock: { awsRegion: ' us-west-2 ', awsUseCrossRegionInference: true, awsEndpointSelected: true, awsBedrockEndpoint: ' https://bedrock.example.com ' }
      },
      options: [
        { name: ' aiopsterm-local-agent ', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
        { name: 'custom-1', displayName: ' Custom One ', locked: false, checked: false, type: 'bad', apiProvider: ' openai ' },
        { name: 'custom-1', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }
      ]
    })
    expect(modelSettings.changed).toBe(true)
    expect(modelSettings.normalized.addModelSwitch).toBe(true)
    expect(modelSettings.normalized.providers.openai).toMatchObject({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      modelId: 'gpt-test',
      apiFormat: 'responses'
    })
    expect(modelSettings.normalized.providers.bedrock).toMatchObject({
      awsRegion: 'us-west-2',
      awsUseCrossRegionInference: true,
      awsEndpointSelected: true,
      awsBedrockEndpoint: 'https://bedrock.example.com'
    })
    expect(modelSettings.normalized.options).toEqual([
      {
        name: 'aiopsterm-local-agent',
        displayName: undefined,
        locked: true,
        checked: true,
        type: 'standard',
        apiProvider: 'default'
      },
      {
        name: 'custom-1',
        displayName: 'Custom One',
        locked: false,
        checked: false,
        type: 'custom',
        apiProvider: 'openai'
      }
    ])
    expect(modelSettings.normalized.options.filter(isVisibleModelSettingsOption)).toEqual([modelSettings.normalized.options[1]])
    expect(modelOptionProviderForSavedProvider('openai')).toBe('openai')
    expect(modelOptionProviderForSavedProvider('litellm')).toBe('litellm')
    expect(modelSettingsSnapshotsMatch(modelSettings.normalized, normalizeModelSettingsConfig(modelSettings.normalized).normalized)).toBe(true)
  })
})
