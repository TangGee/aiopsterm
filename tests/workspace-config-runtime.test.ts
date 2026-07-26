import { describe, expect, it } from 'vitest'
import {
  backgroundSnapshotsMatch,
  cloneBackgroundSnapshot,
  createKbRelPath,
  defaultAiPreferences,
  defaultConfig,
  defaultKeywordHighlightSettings,
  defaultMcpConfigFile,
  defaultPrivacySettings,
  generalBaseSettingsPatchMatches,
  isBackgroundSnapshot,
  isCustomBackgroundSaveResult,
  isGeneralBaseSettingsSnapshot,
  isKnowledgeSearchRuntimeSnapshotForRequest,
  isLayoutPreferencesSnapshot,
  isPrivacyRuntimeSnapshotForRequest,
  isValidShortcutForAction,
  isVisibleModelSettingsOption,
  knowledgeTreeSize,
  keywordHighlightEditorContentFromFile,
  keywordHighlightSettingsSnapshotsMatch,
  layoutPreferencesPatchMatches,
  layoutWidthFromConfig,
  mcpConfigFilesMatch,
  mergeGenericSavedConfig,
  mergeUserConfig,
  modelOptionProviderForSavedProvider,
  modelSettingsSnapshotsMatch,
  normalizeAiPreferencesConfig,
  normalizeBackgroundConfig,
  normalizeCatalogModelProvider,
  normalizeEditorSettingsConfig,
  normalizeExportMcpConfig,
  normalizeGeneralBaseSettingsPatch,
  normalizeKeywordHighlightConfig,
  normalizeKnowledgeBaseConfig,
  normalizeLayoutPreferencesPatch,
  normalizeMcpConfigFile,
  normalizeMcpServersConfig,
  normalizeMcpToolStatesConfig,
  normalizeModelSettingsConfig,
  normalizeOnboardingConfig,
  normalizePrivacyConfig,
  normalizeQuickCommandsConfig,
  normalizeRulesConfig,
  normalizeSecurityConfig,
  normalizeShortcutsConfig,
  normalizeSkillsConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs,
  normalizeTerminalConfig,
  normalizeUserModelName,
  normalizeUserModelProvider,
  normalizeWorkspacePreferences,
  parseKeywordHighlightEditorContent,
  parseSecurityEditorContent,
  privacyRuntimeSettingsFromSnapshot,
  readSshAgentKeychainOptionsSnapshot,
  securityEditorContentFromFile,
  securitySettingsSnapshotsMatch,
  stripBusinessDataConfig,
  visibleBackgroundTuning,
  sshAgentKeySnapshotsMatch,
  sshProxyConfigSnapshotsMatch,
  type SecuritySettings
} from '@/services/settings/workspaceConfigRuntime'
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

  it('normalizes sensitive Export MCP capabilities as disabled by default', () => {
    expect(normalizeExportMcpConfig(undefined).normalized).toEqual({ allowAgentSshAuthSubmit: false, allowDatabaseRead: false })
    expect(normalizeExportMcpConfig({ allowAgentSshAuthSubmit: true, allowDatabaseRead: true }).normalized).toEqual({
      allowAgentSshAuthSubmit: true,
      allowDatabaseRead: true
    })
    expect(mergeUserConfig(defaultConfig, { exportMcp: { allowAgentSshAuthSubmit: true, allowDatabaseRead: false } }).exportMcp).toEqual({
      allowAgentSshAuthSubmit: true,
      allowDatabaseRead: false
    })
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

  it('normalizes base, layout, background, onboarding, and model selection runtime patches', () => {
    const generalPatch = normalizeGeneralBaseSettingsPatch({
      defaultMode: 'agents',
      language: 'system',
      watermark: 'close'
    })
    expect(generalPatch).toEqual({ defaultMode: 'agents', language: 'system', watermark: 'close' })
    expect(normalizeGeneralBaseSettingsPatch({ language: 'xx-XX' as any })).toBeNull()
    expect(generalBaseSettingsPatchMatches(generalPatch!, { defaultMode: 'agents', language: 'system', watermark: 'close' })).toBe(true)
    expect(isGeneralBaseSettingsSnapshot({ defaultMode: 'terminal', language: 'zh-CN', watermark: 'open' })).toBe(true)

    const layoutPatch = normalizeLayoutPreferencesPatch({
      defaultMode: 'terminal',
      leftPanelOpen: false,
      rightPanelOpen: true,
      agentsLeftOpen: false,
      leftPanelWidth: 321.6,
      rightPanelWidth: 640,
      agentsLeftWidth: 220
    })
    expect(layoutPatch).toEqual({
      defaultMode: 'terminal',
      leftPanelOpen: false,
      rightPanelOpen: true,
      agentsLeftOpen: false,
      leftPanelWidth: 322,
      rightPanelWidth: 640,
      agentsLeftWidth: 220
    })
    expect(normalizeLayoutPreferencesPatch({ leftPanelWidth: 100 })).toBeNull()
    expect(layoutPreferencesPatchMatches(layoutPatch!, layoutPatch!)).toBe(true)
    expect(isLayoutPreferencesSnapshot(layoutPatch)).toBe(true)
    expect(layoutWidthFromConfig(9999, 286)).toBe(286)

    const background = normalizeBackgroundConfig({
      mode: 'custom',
      image: 'aiopsterm://bg/custom.png',
      opacity: 0.4,
      brightness: 0.8,
      lastCustomImage: 'aiopsterm://bg/custom.png'
    }).normalized
    expect(isBackgroundSnapshot(background)).toBe(true)
    expect(visibleBackgroundTuning(background)).toMatchObject({ opacity: defaultConfig.background.opacity, brightness: defaultConfig.background.brightness })
    expect(normalizeBackgroundConfig({ ...background, mode: 'none' }).normalized.image).toBe('')
    expect(backgroundSnapshotsMatch(background, cloneBackgroundSnapshot(background))).toBe(true)
    expect(isCustomBackgroundSaveResult({ filePath: '/tmp/a.png', url: 'aiopsterm://bg/a.png', name: 'a.png', size: 10, bytes: 10, mtimeMs: 1 })).toBe(true)
    expect(isCustomBackgroundSaveResult({ filePath: '/tmp/a.png', url: 'aiopsterm://bg/a.png', name: 'a.png', size: 10, bytes: 9, mtimeMs: 1 })).toBe(false)

    const onboarding = normalizeOnboardingConfig({
      version: 1,
      guideTabAutoOpened: true,
      completedModules: { interfaceGuide: true, legacy: true }
    })
    expect(onboarding.changed).toBe(true)
    expect(onboarding.normalized).toEqual({
      version: 2,
      guideTabAutoOpened: true,
      completedModules: {
        interfaceGuide: true,
        systemSettings: false,
        addAndConnectHost: false,
        aiChat: false
      }
    })

    expect(normalizeUserModelProvider(' openai-compatible ')).toBe('openai-compatible')
    expect(normalizeUserModelProvider('bad-provider')).toBe(defaultConfig.modelProvider)
    expect(normalizeUserModelName('  gpt-test  ')).toBe('gpt-test')
    expect(normalizeUserModelName('')).toBe(defaultConfig.modelName)
    expect(normalizeCatalogModelProvider('openai')).toBe('openai-compatible')
  })

  it('normalizes persisted quick commands, knowledge, aliases, shortcuts, rules, and skills', () => {
    const quickCommands = normalizeQuickCommandsConfig({
      groups: [
        { id: 0, uuid: ' group-1 ', group_name: ' Ops ' },
        { id: 2, uuid: 'group-1', group_name: 'Duplicate' },
        { id: 3, uuid: '', group_name: 'bad' }
      ] as any,
      snippets: [
        {
          id: 0,
          uuid: 'snip-1',
          snippet_name: ' Restart ',
          snippet_content: 'systemctl restart app',
          group_uuid: ' group-1 ',
          create_at: '2026-06-21T00:00:00.000Z'
        },
        { id: 1, uuid: 'snip-1', snippet_name: 'dup', snippet_content: 'echo dup', group_uuid: 'group-1' },
        { id: 2, uuid: 'snip-2', snippet_name: '', snippet_content: 'echo bad' }
      ] as any
    })
    expect(quickCommands.changed).toBe(true)
    expect(quickCommands.normalized).toEqual({
      groups: [{ id: 1, uuid: 'group-1', group_name: 'Ops' }],
      snippets: [
        {
          id: 1,
          uuid: 'snip-1',
          snippet_name: 'Restart',
          snippet_content: 'systemctl restart app',
          group_uuid: null,
          create_at: '2026-06-21T00:00:00.000Z'
        }
      ]
    })

    const knowledge = normalizeKnowledgeBaseConfig({
      tree: [
        {
          id: '',
          key: '',
          relPath: '',
          title: ' Runbook ',
          type: 'dir',
          children: [
            { id: '', key: '', relPath: '', title: ' app.md ', type: 'file', size: 12 },
            { id: 'dup', key: 'Runbook/app.md', relPath: 'Runbook/app.md', title: 'dup.md', type: 'file', size: 99 }
          ]
        }
      ] as any,
      totalBytes: 100
    })
    expect(knowledge.changed).toBe(true)
    expect(knowledge.normalized.tree[0]).toMatchObject({
      relPath: 'Runbook',
      title: 'Runbook',
      type: 'dir',
      children: [{ relPath: 'Runbook/app.md', title: 'app.md', size: 12 }]
    })
    expect(knowledge.normalized.usedBytes).toBe(12)
    expect(knowledgeTreeSize(knowledge.normalized.tree)).toBe(12)
    expect(createKbRelPath('Runbook', 'next.md')).toBe('Runbook/next.md')

    const shortcuts = normalizeShortcutsConfig([
      { id: 'openSettings', action: ' openSettings ', shortcut: ' Ctrl+, ', extra: true },
      { id: 'switchToSpecificTab', action: 'switchToSpecificTab', shortcut: 'Ctrl+1' },
      { id: 'switchToSpecificTab', action: 'switchToSpecificTab', shortcut: 'Ctrl+Shift+T' }
    ])
    expect(shortcuts.changed).toBe(true)
    expect(shortcuts.normalized).toEqual([
      { id: 'openSettings', action: 'openSettings', shortcut: 'Ctrl+,' },
      { id: 'switchToSpecificTab', action: 'switchToSpecificTab', shortcut: 'Ctrl+Shift+T' }
    ])
    expect(isValidShortcutForAction('switchToSpecificTab', 'Ctrl+1')).toBe(false)
    expect(isValidShortcutForAction('switchToSpecificTab', 'Ctrl+Shift+T')).toBe(true)

    const rules = normalizeRulesConfig([{ id: ' rule-1 ', content: ' Always check cwd ', enabled: 1, extra: true }], ' Legacy instruction ')
    expect(rules.changed).toBe(true)
    expect(rules.normalized).toEqual([
      { id: 'rule-custom-instructions', content: 'Legacy instruction', enabled: true },
      { id: 'rule-1', content: 'Always check cwd', enabled: true }
    ])

    const skills = normalizeSkillsConfig([
      { name: ' Deploy ', description: ' Deploy app ', content: 'Use deploy script', enabled: 1, editable: 0, path: ' /skills/deploy/SKILL.md ' },
      { name: 'Deploy', description: 'dup', content: 'dup', enabled: true, editable: true }
    ])
    expect(skills.normalized).toEqual([
      {
        name: 'Deploy',
        description: 'Deploy app',
        enabled: true,
        editable: false,
        content: 'Use deploy script',
        path: '/skills/deploy/SKILL.md'
      }
    ])
  })

  it('normalizes MCP config files, server snapshots, and aggregate user config merges', () => {
    expect(defaultMcpConfigFile()).toEqual({ mcpServers: {} })
    const mcpConfig = normalizeMcpConfigFile({
      mcpServers: {
        ' fs ': {
          type: 'bad',
          disabled: true,
          autoApprove: [' read ', '', 1],
          timeout: 30,
          command: ' npx ',
          args: [' -y ', '', 2],
          cwd: ' /tmp ',
          env: { A: '1', B: 2 },
          headers: { Authorization: 'token', Skip: false }
        },
        codexStyleRemote: {
          url: ' https://mcp.example.com/mcp ',
          headers: { Authorization: 'token' }
        },
        httpAlias: {
          type: 'http',
          url: ' https://http.example.com/mcp '
        },
        snakeAlias: {
          type: 'streamable_http',
          url: ' https://snake.example.com/mcp '
        },
        kebabAlias: {
          type: 'streamable-http',
          url: ' https://kebab.example.com/mcp '
        },
        legacySse: {
          type: 'sse',
          url: ' https://sse.example.com/events '
        },
        empty: null
      }
    })
    expect(mcpConfig).toEqual({
      mcpServers: {
        fs: {
          type: 'stdio',
          disabled: true,
          autoApprove: ['read'],
          timeout: 30,
          command: 'npx',
          args: ['-y'],
          cwd: '/tmp',
          env: { A: '1' },
          headers: { Authorization: 'token' }
        },
        codexStyleRemote: {
          type: 'streamableHttp',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'token' }
        },
        httpAlias: {
          type: 'streamableHttp',
          url: 'https://http.example.com/mcp'
        },
        snakeAlias: {
          type: 'streamableHttp',
          url: 'https://snake.example.com/mcp'
        },
        kebabAlias: {
          type: 'streamableHttp',
          url: 'https://kebab.example.com/mcp'
        },
        legacySse: {
          type: 'sse',
          url: 'https://sse.example.com/events'
        }
      }
    })
    expect(mcpConfigFilesMatch(mcpConfig, normalizeMcpConfigFile(mcpConfig))).toBe(true)

    const toolStates = normalizeMcpToolStatesConfig({ 'fs:read': false, invalid: true, 'fs:bad': 'yes' })
    expect(toolStates).toEqual({ 'fs:read': false })
    const mcpServers = normalizeMcpServersConfig(
      [
        {
          name: ' fs ',
          status: 'connected',
          disabled: false,
          tools: [
            {
              name: ' read ',
              description: 'Read file',
              enabled: true,
              autoApprove: true,
              parameters: [{ name: ' path ', description: 'Path', required: 1 }]
            },
            { name: 'read', description: 'dup', enabled: true, parameters: [] }
          ],
          resources: [{ uri: ' file:///tmp ', name: '', description: 'Tmp' }],
          extra: true
        }
      ],
      toolStates
    )
    expect(mcpServers.changed).toBe(true)
    expect(mcpServers.normalized).toEqual([
      {
        name: 'fs',
        status: 'connected',
        disabled: false,
        tools: [
          {
            name: 'read',
            description: 'Read file',
            enabled: false,
            autoApprove: true,
            parameters: [{ name: 'path', description: 'Path', required: true }]
          }
        ],
        resources: [{ name: 'file:///tmp', description: 'Tmp', uri: 'file:///tmp' }]
      }
    ])
    expect(mcpServers.toolStates).toEqual({ 'fs:read': false })

    const merged = mergeUserConfig(defaultConfig, {
      defaultMode: 'bad' as any,
      leftPanelWidth: 100,
      modelProvider: 'openai-compatible',
      modelName: ' gpt-ops ',
      background: { mode: 'none', image: 'should-clear', opacity: 0.7, brightness: 0.9 },
      knowledgeBase: { tree: [{ id: '', key: '', relPath: '', title: 'kb.md', type: 'file', size: 5 }], usedBytes: 0, totalBytes: 100 },
      shortcuts: [{ id: 'openSettings', action: 'openSettings', shortcut: 'Ctrl+,' }],
      rules: [{ id: 'r1', content: 'Check status', enabled: true }],
      skills: [{ name: 'Ops', description: 'Ops skill', enabled: true, editable: true, content: 'Run checks' }],
      mcpServers: mcpServers.normalized,
      mcpToolStates: { 'fs:read': true },
      onboarding: { version: 2, guideTabAutoOpened: true, completedModules: { interfaceGuide: true } }
    })
    expect(merged.defaultMode).toBe(defaultConfig.defaultMode)
    expect(merged.leftPanelWidth).toBe(defaultConfig.leftPanelWidth)
    expect(merged.modelName).toBe('gpt-ops')
    expect(merged.background.image).toBe('')
    expect(merged.knowledgeBase?.usedBytes).toBe(0)
    expect(merged.mcpToolStates).toEqual({ 'fs:read': true })
    expect(merged.onboarding?.completedModules.interfaceGuide).toBe(true)

    const generic = mergeGenericSavedConfig(
      defaultConfig,
      {
        quickCommands: { groups: [{ id: 1, uuid: 'g', group_name: 'G' }], snippets: [] },
        knowledgeBase: { tree: [], usedBytes: 1, totalBytes: 2 },
        watermark: 'close'
      },
      { language: 'system' }
    )
    expect(generic.quickCommands).toEqual(defaultConfig.quickCommands)
    expect(generic.knowledgeBase).toEqual(defaultConfig.knowledgeBase)
    expect(generic.watermark).toBe('close')
    expect(generic.language).toBe('system')
    expect(stripBusinessDataConfig({ quickCommands: { groups: [], snippets: [] }, knowledgeBase: { tree: [], usedBytes: 0, totalBytes: 1 }, theme: 'dark' })).toEqual({
      theme: 'dark'
    })
  })
})
