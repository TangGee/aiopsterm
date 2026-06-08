import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'

const defaultAiPreferences = {
  enableExtendedThinking: true,
  thinkingBudgetTokens: 4096,
  autoExecuteReadOnlyCommands: false,
  commandOutputFilteringEnabled: true,
  kbSearchEnabled: true,
  experienceExtractionEnabled: true,
  autoApproval: false,
  reasoningEffort: 'medium' as const,
  needProxy: false,
  proxy: {
    type: 'HTTP' as const,
    host: '127.0.0.1',
    port: 7890,
    enableProxyIdentity: false,
    username: '',
    password: ''
  },
  shellIntegrationTimeout: 4
}

const defaultTerminalSettings = {
  terminalType: 'xterm-256color',
  fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
  fontSize: 12,
  scrollBack: 1000,
  cursorStyle: 'block' as const,
  cursorBlink: true,
  lineHeight: 1,
  pinchZoomStatus: true,
  showCloseButton: true,
  sshAgentsStatus: false,
  middleMouseEvent: 'paste' as const,
  rightMouseEvent: 'contextMenu' as const
}

const defaultEditorSettings = {
  fontSize: 14,
  lineHeight: 0,
  fontFamily: 'cascadia-mono',
  tabSize: 4,
  wordWrap: 'off' as const,
  minimap: true,
  mouseWheelZoom: true
}

const defaultSshProxyConfigs: any[] = []

const defaultSshAgentKeys: any[] = []
const prodKeychainSshAgentFingerprint = 'SHA256:KW/btgUSM+Gu9ht4gyd2CMSZB/1setTDE0+Uik88xGE'

const defaultKeywordHighlight = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const defaultSecurityConfig = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: [],
    whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
    dangerousCommands: ['rm', 'format', 'shutdown'],
    maxCommandLength: 10000,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: false
    }
  }
}

const defaultModelSettings = {
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
      apiFormat: 'responses' as const
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
  options: [
    { name: 'gpt-5', locked: true, checked: true, type: 'standard' as const, apiProvider: 'default' },
    { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard' as const, apiProvider: 'default' },
    { name: 'aiopsterm-local-agent', locked: false, checked: true, type: 'standard' as const, apiProvider: 'default' },
    { name: 'custom-maintenance', locked: false, checked: false, type: 'custom' as const, apiProvider: 'openai' }
  ]
}

const defaultShortcuts = [
  { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
  { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
  { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
  { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
]

const defaultRules = [
  { id: 'rule-1', content: '执行生产变更前必须先给出只读检查命令和回滚点。', enabled: true },
  { id: 'rule-2', content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。', enabled: true }
]

const defaultSkills = [
  {
    name: 'incident-triage',
    description: 'Collect symptoms, recent changes, and affected services.',
    enabled: true,
    editable: true,
    content: 'When incident triage is requested, collect scope, blast radius, and recent deployments first.',
    path: '/tmp/aiopsterm/skills/incident-triage/SKILL.md'
  },
  {
    name: 'k8s-rollout',
    description: 'Guide Kubernetes rollout inspection and rollback planning.',
    enabled: true,
    editable: true,
    content: 'Prefer kubectl describe, events, image pull checks, and rollback safety checks.',
    path: '/tmp/aiopsterm/skills/k8s-rollout/SKILL.md'
  }
]

const defaultMcpServers = [
  {
    name: 'filesystem',
    status: 'connected' as const,
    disabled: false,
    tools: [
      {
        name: 'read_file',
        description: 'Read a workspace file for agent context.',
        enabled: true,
        parameters: [
          { name: 'path', description: 'Absolute file path.', required: true },
          { name: 'encoding', description: 'Optional text encoding.' }
        ]
      },
      {
        name: 'list_directory',
        description: 'List files under a directory.',
        enabled: true,
        parameters: [{ name: 'path', description: 'Directory path.', required: true }]
      }
    ],
    resources: [{ name: 'workspace-root', description: 'Current aiopsterm workspace.', uri: 'file:///workspace' }]
  },
  {
    name: 'ops-inventory',
    status: 'error' as const,
    disabled: false,
    error: 'Token expired',
    tools: [
      {
        name: 'lookup_asset',
        description: 'Find a host by name, tag, or IP.',
        enabled: false,
        parameters: [{ name: 'query', description: 'Asset search query.', required: true }]
      }
    ],
    resources: []
  }
]

const defaultMcpToolStates = {
  'filesystem:read_file': true,
  'filesystem:list_directory': true,
  'ops-inventory:lookup_asset': false
}

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(globalThis as any).__resetKnowledgeTreeMock?.()
    ;(globalThis as any).__resetAssetStoreMock?.()
    ;(globalThis as any).__resetKubernetesCatalogMock?.()
    ;(globalThis as any).__resetFileSessionCatalogMock?.()
    ;(globalThis as any).__resetChatHistoryStoreMock?.()
    ;(globalThis as any).__resetAiTodoSnapshotMock?.()
    ;(globalThis as any).__resetExtensionPluginStoreMock?.()
    ;(globalThis as any).__resetUserAccountStoreMock?.()
    ;(globalThis as any).__resetMcpStoreMock?.()
    vi.useFakeTimers()
  })

  it('creates, renames, splits, and closes terminal panels', () => {
    const store = useWorkspaceStore()

    expect(store.panels).toHaveLength(1)
    expect(store.activePanel.output).toBe('')
    expect(store.activePanel.outputSegments).toEqual([])
    store.createPanel('right')
    expect(store.panels).toHaveLength(2)
    expect(store.activePanel.split).toBe('right')
    expect(store.activePanel.output).toBe('')
    expect(store.activePanel.outputSegments).toEqual([])

    store.renamePanel(store.activePanelId, 'prod shell')
    expect(store.activePanel.title).toBe('prod shell')

    store.closeOthers()
    expect(store.panels).toHaveLength(1)
    expect(store.panels[0].title).toBe('prod shell')

    store.createPanel('below')
    store.createPanel()
    expect(store.panels).toHaveLength(3)
    store.closePanels('others', store.activePanelId)
    expect(store.panels).toHaveLength(1)

    store.createPanel()
    store.closePanels('all')
    expect(store.panels).toHaveLength(1)
    expect(store.panels[0].id).toBe('panel-main')
    expect(store.panels[0].output).toBe('')
    expect(store.panels[0].outputSegments).toEqual([])
  })

  it('applies keyword highlight to terminal display without mutating raw output', () => {
    const store = useWorkspaceStore()
    store.keywordHighlightSettings = {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: true
        },
        rules: [
          {
            name: 'error',
            enabled: true,
            scope: 'output',
            matchType: 'regex',
            pattern: '(?i)error',
            style: {
              foreground: '#FF0000',
              fontStyle: 'bold'
            }
          },
          {
            name: 'sudo',
            enabled: true,
            scope: 'input',
            matchType: 'regex',
            pattern: 'sudo',
            style: {
              foreground: '#E6B450',
              fontStyle: 'bold'
            }
          }
        ]
      }
    }

    store.appendTerminalOutput(store.activePanelId, 'ERROR in service\n')
    store.appendTerminalInput(store.activePanelId, 'sudo journalctl -u nginx\n')

    expect(store.activePanel.output).toContain('ERROR in service')
    expect(store.activePanel.output).toContain('sudo journalctl')
    expect(store.activePanel.output).not.toContain('\x1b[')
    expect(store.getHighlightedTerminalOutput(store.activePanelId)).toContain('\x1b[1;38;5;')
  })

  it('switches modes and requests backend ai responses', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    vi.mocked(window.aiops.saveConfig).mockClear()

    await store.toggleMode()
    expect(store.mode).toBe('agents')
    expect(store.config.defaultMode).toBe('agents')
    expect(store.topNotice).toContain('Agents')
    store.toggleLeft()
    expect(store.agentsLeftOpen).toBe(false)
    await store.toggleMode()
    expect(store.mode).toBe('terminal')
    store.toggleRight()
    expect(store.rightPanelOpen).toBe(false)
    store.setActiveModule('database')
    store.toggleRight()
    expect(store.rightPanelOpen).toBe(false)
    await store.checkTopUpdate()
    expect(store.topUpdateState).toBe('local')
    vi.mocked(window.aiops.checkUpdate).mockResolvedValueOnce({
      available: true,
      channel: 'manual',
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.2', channel: 'manual' }
    })
    await store.checkTopUpdate()
    expect(store.topUpdateState).toBe('available')
    expect(store.aboutSettings.newVersion).toBe('0.1.2')
    await store.handleTopUpdateClick()
    expect(window.aiops.downloadAppUpdate).toHaveBeenCalledWith('0.1.2')
    expect(window.aiops.installAppUpdate).toHaveBeenCalledWith('0.1.2')
    expect(store.topUpdateState).toBe('local')
    expect(store.topNotice).toBe('更新安装请求已提交')

    store.toggleContext({ id: 'skill:incident-triage', kind: 'skills', label: 'incident-triage', detail: 'Collect symptoms' })
    expect(store.aiSkillContextOptions.some((option) => option.id === 'skill:incident-triage')).toBe(true)
    await store.sendChat('检查生产磁盘')
    expect(store.chatMessages.some((message) => message.role === 'user')).toBe(true)
    expect(store.chatMessages.at(-2)?.id).toBe('aichat-request-test-1-user')
    expect(store.chatMessages.at(-1)?.id).toBe('aichat-request-test-1-assistant')
    expect(store.chatMessages.at(-2)?.text).toContain('Skill Instructions')
    expect(store.chatMessages.at(-2)?.text).toContain('# Skill Activated: incident-triage')
    expect(store.chatMessages.at(-2)?.contentParts).toBeUndefined()
    expect(store.chatMessages.at(-1)?.text).toContain('正在请求 aiopsterm AI 后端')
    expect(store.chatMessages.at(-1)?.state).toBe('streaming')
    expect(window.aiops.createAiChatExchangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('检查生产磁盘')
      })
    )
    expect(window.aiops.generateAiChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('检查生产磁盘'),
        skills: [expect.objectContaining({ name: 'incident-triage' })]
      })
    )

    await vi.runAllTimersAsync()
    expect(store.chatMessages.at(-1)?.state).toBe('done')
    expect(store.chatMessages.at(-1)?.text).toContain('Activated Skill: incident-triage')
    expect(store.chatMessages.at(-1)?.text).toContain('aiopsterm 本地后端生成')
  })

  it('keeps configuration changes in local state before bridge persistence', async () => {
    const store = useWorkspaceStore()

    await store.saveConfig({ theme: 'light', modelProvider: 'ollama', modelEndpoint: 'http://localhost:11434' })

    expect(store.config.theme).toBe('light')
    expect(store.config.modelProvider).toBe('ollama')
    expect(store.config.modelEndpoint).toBe('http://localhost:11434')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themeId).toBe('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#eef1f6')

    await store.saveConfig({ theme: 'kanagawa-wave' })
    expect(store.config.theme).toBe('kanagawa-wave')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeId).toBe('kanagawa-wave')
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#7e9cd8')

    await store.saveConfig({ theme: 'auto' })
    expect(store.config.theme).toBe('auto')
    expect(document.documentElement.dataset.themeId).toBe('light')
    ;(globalThis as any).__setSystemThemeMock('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeId).toBe('dark')
    ;(globalThis as any).__setSystemThemeMock('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themeId).toBe('light')

    await store.saveConfig({ theme: 'not-a-theme' as any })
    expect(store.config.theme).toBe('dark')
    expect(document.documentElement.dataset.themeId).toBe('dark')
  })

  it('normalizes legacy mock AI model configuration to the local backend provider', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      }
    } as any)

    await store.hydrateConfig()

    expect(store.config.modelProvider).toBe('local')
    expect(store.config.modelName).toBe('aiopsterm-local-agent')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProvider: 'local',
        modelName: 'aiopsterm-local-agent'
      })
    )
  })

  it('hydrates and migrates persisted External reference-style onboarding completion state', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'vt220',
        fontFamily: 'Fira Code, monospace',
        fontSize: 16,
        scrollBack: 5000,
        cursorStyle: 'bar',
        cursorBlink: false,
        lineHeight: 1.4,
        pinchZoomStatus: false,
        showCloseButton: false,
        sshAgentsStatus: true,
        middleMouseEvent: 'closeTab',
        rightMouseEvent: 'paste'
      },
      workspacePreferences: {
        expandedGroups: ['org-1', 'custom-folder-a'],
        showIpMode: true
      },
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      onboarding: {
        version: 1,
        guideTabAutoOpened: true,
        completedModules: {
          interfaceGuide: true
        }
      }
    })
    await store.hydrateConfig()

    expect(store.onboardingCompleted.interfaceGuide).toBe(true)
    expect(store.onboardingCompleted.systemSettings).toBe(false)
    expect(store.terminalSettings.terminalType).toBe('vt220')
    expect(store.terminalSettings.fontSize).toBe(16)
    expect(store.terminalSettings.middleMouseEvent).toBe('closeTab')
    expect(store.terminalSettings.rightMouseEvent).toBe('paste')
    expect(store.workspacePreferences.expandedGroups).toEqual(['org-1', 'custom-folder-a'])
    expect(store.workspacePreferences.showIpMode).toBe(true)
    expect(store.config.onboarding?.version).toBe(2)
    expect(store.config.onboarding?.guideTabAutoOpened).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: {
          terminalType: 'vt220',
          fontFamily: 'Fira Code, monospace',
          fontSize: 16,
          scrollBack: 5000,
          cursorStyle: 'bar',
          cursorBlink: false,
          lineHeight: 1.4,
          pinchZoomStatus: false,
          showCloseButton: false,
          sshAgentsStatus: true,
          middleMouseEvent: 'closeTab',
          rightMouseEvent: 'paste'
        },
        workspacePreferences: {
          expandedGroups: ['org-1', 'custom-folder-a'],
          showIpMode: true
        },
        editorSettings: defaultEditorSettings,
        sshProxyConfigs: defaultSshProxyConfigs,
        sshAgentKeys: defaultSshAgentKeys,
        extensionSettings: {
          autoCompleteStatus: true,
          quickVimStatus: true,
          aliasStatus: true,
          highlightStatus: true
        },
        keywordHighlight: defaultKeywordHighlight,
        privacy: {
          telemetry: 'enabled',
          secretRedaction: 'disabled',
          dataSync: 'disabled'
        },
        aiPreferences: defaultAiPreferences,
        modelSettings: defaultModelSettings,
        quickCommands: expect.objectContaining({
          groups: expect.arrayContaining([expect.objectContaining({ uuid: 'group-monitor', group_name: '巡检命令' })]),
          snippets: expect.arrayContaining([expect.objectContaining({ uuid: 'snippet-root', snippet_name: '当前目录' })])
        }),
        knowledgeBase: expect.objectContaining({
          tree: expect.arrayContaining([expect.objectContaining({ relPath: 'commands', type: 'dir' })]),
          usedBytes: 374784,
          totalBytes: 1073741824
        }),
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'll', command: 'ls -alF' })]),
        skills: defaultSkills,
        onboarding: {
          version: 2,
          guideTabAutoOpened: true,
          completedModules: {
            interfaceGuide: true,
            systemSettings: false,
            addAndConnectHost: false,
            aiChat: false
          }
        }
      })
    )
    expect(window.aiops.getSettingsPreferences).toHaveBeenCalledWith({
      shortcuts: undefined,
      rules: undefined,
      customInstructions: undefined
    })
  })

  it('migrates missing persisted terminal and workspace preferences to aiopsterm defaults', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })
    await store.hydrateConfig()

    expect(store.terminalSettings.middleMouseEvent).toBe('paste')
    expect(store.terminalSettings.rightMouseEvent).toBe('contextMenu')
    expect(store.config.terminal?.terminalType).toBe('xterm-256color')
    expect(store.workspacePreferences.expandedGroups).toContain('recent_connections')
    expect(store.workspacePreferences.showIpMode).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          terminalType: 'xterm-256color',
          middleMouseEvent: 'paste',
          rightMouseEvent: 'contextMenu'
        }),
        workspacePreferences: expect.objectContaining({
          expandedGroups: expect.arrayContaining(['recent_connections', 'local_connections']),
          showIpMode: false
        }),
        editorSettings: defaultEditorSettings,
        sshProxyConfigs: defaultSshProxyConfigs,
        sshAgentKeys: defaultSshAgentKeys,
        extensionSettings: {
          autoCompleteStatus: true,
          quickVimStatus: true,
          aliasStatus: true,
          highlightStatus: true
        },
        keywordHighlight: defaultKeywordHighlight,
        privacy: {
          telemetry: 'enabled',
          secretRedaction: 'disabled',
          dataSync: 'disabled'
        },
        aiPreferences: defaultAiPreferences,
        modelSettings: defaultModelSettings,
        quickCommands: expect.objectContaining({
          groups: expect.arrayContaining([expect.objectContaining({ uuid: 'group-monitor' })]),
          snippets: expect.arrayContaining([expect.objectContaining({ uuid: 'snippet-root' })])
        }),
        knowledgeBase: expect.objectContaining({
          tree: expect.arrayContaining([expect.objectContaining({ relPath: 'commands' })]),
          usedBytes: 374784,
          totalBytes: 1073741824
        }),
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'll' })]),
        skills: defaultSkills
      })
    )
    expect(window.aiops.getSettingsPreferences).toHaveBeenCalledWith({
      shortcuts: undefined,
      rules: undefined,
      customInstructions: undefined
    })
  })

  it('hydrates and migrates External reference-style editor settings', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: {
        fontSize: 99,
        lineHeight: -1,
        fontFamily: ' jetbrains-mono ',
        tabSize: 99,
        wordWrap: 'bad-value',
        minimap: 1,
        mouseWheelZoom: false,
        extra: true
      } as any,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })
    await store.hydrateConfig()

    expect(store.editorSettings).toEqual({
      fontSize: 14,
      lineHeight: 0,
      fontFamily: 'jetbrains-mono',
      tabSize: 4,
      wordWrap: 'off',
      minimap: true,
      mouseWheelZoom: false
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        editorSettings: {
          fontSize: 14,
          lineHeight: 0,
          fontFamily: 'jetbrains-mono',
          tabSize: 4,
          wordWrap: 'off',
          minimap: true,
          mouseWheelZoom: false
        }
      })
    )
  })

  it('hydrates and migrates External reference-style SSH proxy configs', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: [
        {
          name: ' release-proxy ',
          type: 'bad',
          host: ' 127.0.0.1 ',
          port: 70000,
          enableProxyIdentity: 1,
          username: 42,
          password: null,
          extra: true
        } as any,
        {
          name: 'release-proxy',
          type: 'HTTP',
          host: '10.0.0.1',
          port: 8080,
          enableProxyIdentity: true,
          username: 'ops',
          password: 'secret'
        },
        {
          name: '',
          type: 'SOCKS5',
          host: '127.0.0.1',
          port: 22
        } as any
      ],
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.sshProxyConfigs).toEqual([
      {
        name: 'release-proxy',
        type: 'SOCKS5',
        host: '127.0.0.1',
        port: 22,
        enableProxyIdentity: false,
        username: '',
        password: ''
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshProxyConfigs: [
          {
            name: 'release-proxy',
            type: 'SOCKS5',
            host: '127.0.0.1',
            port: 22,
            enableProxyIdentity: false,
            username: '',
            password: ''
          }
        ]
      })
    )
  })

  it('hydrates and migrates External reference-style SSH Agent key rows', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: true,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: [
        {
          id: ' key-1 ',
          fingerprint: ' SHA256:prod ',
          comment: ' prod-ed25519 ',
          keyType: ' ed25519 ',
          keyChainId: ' key-1 ',
          extra: true
        } as any,
        {
          id: 'key-1',
          fingerprint: 'SHA256:duplicate',
          comment: 'duplicate',
          keyType: 'RSA',
          keyChainId: 'key-1'
        },
        {
          id: '',
          fingerprint: 'SHA256:missing',
          comment: 'missing'
        } as any
      ],
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.sshAgentKeys).toEqual([
      {
        id: 'key-1',
        fingerprint: 'SHA256:prod',
        comment: 'prod-ed25519',
        keyType: 'ED25519',
        keyChainId: 'key-1'
      }
    ])
    expect(window.aiops.listSshAgentKeychainOptions).toHaveBeenCalled()
    expect(store.sshAgentKeyChainOptions).toEqual([
      {
        key: 'key-1',
        label: 'prod-ed25519',
        fingerprint: prodKeychainSshAgentFingerprint,
        keyType: 'ED25519'
      },
      {
        key: 'key-2',
        label: 'staging-rsa',
        fingerprint: 'SHA256:/+3Ox/lagG69520s5FqjN11505yiwGiXccCtpZYvucc',
        keyType: 'RSA'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-1',
            fingerprint: 'SHA256:prod',
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-1'
          }
        ]
      })
    )
  })

  it('does not fall back to renderer SSH Agent keychain fixtures when the bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    const originalListSshAgentKeychainOptions = window.aiops.listSshAgentKeychainOptions
    try {
      ;(window.aiops as any).listSshAgentKeychainOptions = undefined
      expect(await store.refreshSshAgentKeychainOptions()).toBe(false)
      expect(store.sshAgentKeyChainOptions).toEqual([])
    } finally {
      ;(window.aiops as any).listSshAgentKeychainOptions = originalListSshAgentKeychainOptions
    }
  })

  it('does not fabricate SSH Agent key writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    await store.refreshSshAgentKeychainOptions()
    const originalSaveConfig = window.aiops.saveConfig
    const agentKeySnapshot = () => JSON.stringify(store.sshAgentKeys)
    const initialSnapshot = agentKeySnapshot()

    try {
      store.openSshAgentConfig()
      store.setSshAgentSelectedKey('key-1')
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.addSshAgentKey()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH Agent 密钥保存服务不可用')
      expect(store.sshAgentSelectedKey).toBe('key-1')
      expect(agentKeySnapshot()).toBe(initialSnapshot)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.addSshAgentKey()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH Agent 密钥保存失败')
      expect(store.sshAgentSelectedKey).toBe('key-1')
      expect(agentKeySnapshot()).toBe(initialSnapshot)

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('ssh agent save offline'))
      await expect(store.addSshAgentKey()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('ssh agent save offline')
      expect(store.sshAgentSelectedKey).toBe('key-1')
      expect(agentKeySnapshot()).toBe(initialSnapshot)

      await expect(store.addSshAgentKey()).resolves.toBe(true)
      const savedSnapshot = agentKeySnapshot()
      expect(store.sshAgentSelectedKey).toBe('')
      expect(store.sshAgentKeys).toEqual([
        {
          id: 'key-1',
          fingerprint: prodKeychainSshAgentFingerprint,
          comment: 'prod-ed25519',
          keyType: 'ED25519',
          keyChainId: 'key-1'
        }
      ])

      ;(window.aiops as any).saveConfig = undefined
      await expect(store.removeSshAgentKey('key-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH Agent 密钥移除服务不可用')
      expect(agentKeySnapshot()).toBe(savedSnapshot)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.removeSshAgentKey('key-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH Agent 密钥移除失败')
      expect(agentKeySnapshot()).toBe(savedSnapshot)

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('ssh agent remove offline'))
      await expect(store.removeSshAgentKey('key-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('ssh agent remove offline')
      expect(agentKeySnapshot()).toBe(savedSnapshot)
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('hydrates and migrates External reference-style user rules and legacy custom instructions', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: [
        { id: 'rule-a', content: '  release must include rollback  ', enabled: false, isEditing: true } as any,
        { id: 'rule-a', content: 'inspect logs first' } as any,
        { id: '', content: '   ' } as any
      ],
      customInstructions: '  legacy global instruction  ',
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.settingsRules).toEqual([
      { id: 'rule-custom-instructions', content: 'legacy global instruction', enabled: true, isEditing: false },
      { id: 'rule-a', content: 'release must include rollback', enabled: false, isEditing: false },
      { id: 'rule-a-2', content: 'inspect logs first', enabled: true, isEditing: false }
    ])
    expect(window.aiops.getSettingsPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: '  legacy global instruction  ',
        rules: [
          { id: 'rule-a', content: '  release must include rollback  ', enabled: false, isEditing: true },
          { id: 'rule-a', content: 'inspect logs first' },
          { id: '', content: '   ' }
        ]
      })
    )
  })

  it('hydrates and migrates External reference-style MCP server list and tool states', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      mcpServers: [
        {
          name: '  release-tools  ',
          status: 'connecting',
          disabled: false,
          tools: [
            {
              name: ' deploy ',
              description: 'Deploy release',
              enabled: false,
              parameters: [{ name: ' version ', description: 'Version tag', required: 1 }]
            },
            { name: 'deploy', description: 'duplicate', enabled: true, parameters: [] }
          ],
          resources: [
            { name: '', description: 'release docs', uri: ' file:///release ' },
            { name: 'duplicate', description: '', uri: 'file:///release' }
          ],
          extra: true
        } as any,
        { name: '', status: 'bad', disabled: false, tools: [], resources: [] } as any
      ],
      mcpToolStates: {
        'release-tools:deploy': true,
        bad: false
      },
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.mcpServers).toEqual([
      {
        name: 'release-tools',
        status: 'connecting',
        disabled: false,
        tools: [
          {
            name: 'deploy',
            description: 'Deploy release',
            enabled: true,
            parameters: [{ name: 'version', description: 'Version tag', required: true }]
          }
        ],
        resources: [{ name: 'file:///release', description: 'release docs', uri: 'file:///release' }]
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [
          {
            name: 'release-tools',
            status: 'connecting',
            disabled: false,
            tools: [
              {
                name: 'deploy',
                description: 'Deploy release',
                enabled: true,
                parameters: [{ name: 'version', description: 'Version tag', required: true }]
              }
            ],
            resources: [{ name: 'file:///release', description: 'release docs', uri: 'file:///release' }]
          }
        ],
        mcpToolStates: {
          'release-tools:deploy': true
        }
      })
    )
  })

  it('hydrates and migrates External reference-style Skills rows', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      skills: [
        {
          name: ' release-check ',
          description: ' Check release state ',
          enabled: 0,
          editable: false,
          content: ' Inspect rollout health. ',
          path: ' /user/skills/release-check/SKILL.md ',
          extra: true
        } as any,
        {
          name: 'release-check',
          description: 'duplicate',
          enabled: true,
          editable: true,
          content: 'duplicate'
        },
        {
          name: '',
          description: 'missing name',
          enabled: true,
          editable: true,
          content: 'ignored'
        }
      ],
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([
      {
        name: 'release-check',
        description: 'Check release state',
        enabled: false,
        editable: false,
        content: 'Inspect rollout health.',
        path: '/user/skills/release-check/SKILL.md'
      }
    ])
    await store.hydrateConfig()

    expect(store.settingsSkills).toEqual([
      {
        name: 'release-check',
        description: 'Check release state',
        enabled: false,
        editable: false,
        content: 'Inspect rollout health.',
        path: '/user/skills/release-check/SKILL.md'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [
          {
            name: 'release-check',
            description: 'Check release state',
            enabled: false,
            editable: false,
            content: 'Inspect rollout health.',
            path: '/user/skills/release-check/SKILL.md'
          }
        ]
      })
    )
  })

  it('hydrates and migrates External reference-style flat shortcut config to aiopsterm shortcut rows', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      shortcuts: {
        newTerminal: 'Ctrl+Alt+T',
        toggleAi: ' Ctrl+Alt+A ',
        switchToSpecificTab: 'Alt+1',
        unknownAction: 'Ctrl+Alt+X'
      } as any,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.settingsShortcuts).toEqual([
      { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Alt+T' },
      { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Alt+A' },
      { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
      { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
    ])
    expect(window.aiops.getSettingsPreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.objectContaining({
          newTerminal: 'Ctrl+Alt+T',
          toggleAi: ' Ctrl+Alt+A ',
          switchToSpecificTab: 'Alt+1',
          unknownAction: 'Ctrl+Alt+X'
        })
      })
    )
  })

  it('hydrates and migrates External reference-style model settings', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: {
        addModelSwitch: 'yes',
        providers: {
          litellm: {
            baseUrl: ' http://litellm.saved ',
            apiKey: 'lite-secret',
            modelId: ' saved-lite '
          },
          openai: {
            baseUrl: '',
            apiKey: 'open-secret',
            modelId: '',
            apiFormat: 'bad-format'
          },
          extra: true
        },
        options: [
          { name: ' custom-a ', locked: false, checked: 1, type: 'custom', apiProvider: ' openai ', extra: true },
          { name: 'custom-a', locked: false, checked: true, type: 'custom', apiProvider: 'openai' },
          { name: '', locked: false, checked: true }
        ]
      } as any,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.addModelSwitch).toBe(true)
    expect(store.modelProviders.litellm).toEqual({
      baseUrl: 'http://litellm.saved',
      apiKey: 'lite-secret',
      modelId: 'saved-lite'
    })
    expect(store.modelProviders.openai).toEqual({
      baseUrl: '',
      apiKey: 'open-secret',
      modelId: 'gpt-5',
      apiFormat: 'responses'
    })
    expect(store.modelProviders.bedrock).toEqual(defaultModelSettings.providers.bedrock)
    expect(store.modelProviders.deepseek).toEqual(defaultModelSettings.providers.deepseek)
    expect(store.modelProviders.anthropic).toEqual(defaultModelSettings.providers.anthropic)
    expect(store.modelProviders.ollama).toEqual(defaultModelSettings.providers.ollama)
    expect(store.settingModelOptions).toEqual([
      { name: 'custom-a', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: {
          addModelSwitch: true,
          providers: {
            litellm: {
              baseUrl: 'http://litellm.saved',
              apiKey: 'lite-secret',
              modelId: 'saved-lite'
            },
            openai: {
              baseUrl: '',
              apiKey: 'open-secret',
              modelId: 'gpt-5',
              apiFormat: 'responses'
            },
            bedrock: defaultModelSettings.providers.bedrock,
            deepseek: defaultModelSettings.providers.deepseek,
            anthropic: defaultModelSettings.providers.anthropic,
            ollama: defaultModelSettings.providers.ollama
          },
          options: [{ name: 'custom-a', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
        }
      })
    )
  })

  it('hydrates persisted External reference-style quick command groups and snippets', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getQuickCommands).mockResolvedValueOnce({
      groups: [{ id: 11, uuid: 'group-release', group_name: '发布命令' }],
      snippets: [
        {
          id: 21,
          uuid: 'snippet-release',
          snippet_name: '发布检查',
          snippet_content: 'git status\nsleep==500\nreturn',
          group_uuid: 'group-release',
          create_at: '2026-06-03 12:00',
          update_at: '2026-06-03 12:00'
        }
      ]
    })
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: { groups: [], snippets: [] },
      knowledgeBase: {
        tree: [
          {
            id: 'kb-dir-commands',
            key: 'commands',
            relPath: 'commands',
            title: 'commands',
            type: 'dir',
            children: []
          }
        ],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.snippetGroups).toEqual([{ id: 11, uuid: 'group-release', group_name: '发布命令' }])
    expect(store.quickCommands).toEqual([
      expect.objectContaining({
        id: 21,
        uuid: 'snippet-release',
        snippet_name: '发布检查',
        group_uuid: 'group-release'
      })
    ])
    expect(window.aiops.getQuickCommands).toHaveBeenCalled()
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('does not hydrate quick commands from renderer config when the backend bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    const originalGetQuickCommands = window.aiops.getQuickCommands

    try {
      ;(window.aiops as any).getQuickCommands = undefined

      await store.hydrateConfig()

      expect(store.snippetGroups).toEqual([])
      expect(store.quickCommands).toEqual([])
      expect(store.topNotice).toBe('快捷命令加载服务不可用')
      const saveConfigPatches = vi.mocked(window.aiops.saveConfig).mock.calls.map(([patch]) => patch)
      expect(saveConfigPatches.every((patch) => !Object.prototype.hasOwnProperty.call(patch, 'quickCommands'))).toBe(true)
    } finally {
      ;(window.aiops as any).getQuickCommands = originalGetQuickCommands
    }
  })

  it('hydrates file transfer task snapshots from the backend boundary', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.listFileTransferTasks).mockResolvedValueOnce([
      {
        id: 'backend-transfer-1',
        type: 'download',
        name: 'backend.log',
        source: '/home/deploy/backend.log',
        target: '/tmp/backend.log',
        progress: 160,
        speed: '1 MB/s',
        status: 'running',
        children: [
          {
            id: 'backend-transfer-child',
            type: 'download',
            name: 'backend-child.log',
            source: '/home/deploy/backend-child.log',
            target: '/tmp/backend-child.log',
            progress: 40,
            speed: '512 KB/s',
            status: 'running'
          }
        ]
      },
      {
        id: 'invalid-transfer',
        type: 'download',
        name: '',
        source: '',
        target: '',
        progress: 20,
        speed: 'pending',
        status: 'running'
      } as any
    ])

    await store.hydrateConfig()

    expect(window.aiops.listFileTransferTasks).toHaveBeenCalled()
    expect(store.fileTransferTasks).toEqual([
      expect.objectContaining({
        id: 'backend-transfer-1',
        type: 'download',
        name: 'backend.log',
        source: '/home/deploy/backend.log',
        target: '/tmp/backend.log',
        progress: 100,
        status: 'running',
        children: [expect.objectContaining({ id: 'backend-transfer-child', progress: 40 })]
      })
    ])
  })

  it('cancels file transfer tasks through the backend boundary', async () => {
    const store = useWorkspaceStore()
    store.pushFileTransferTask({
      id: 'backend-transfer-1',
      type: 'download',
      name: 'backend.log',
      source: '/home/deploy/backend.log',
      target: '/tmp/backend.log',
      progress: 60,
      speed: '1 MB/s',
      status: 'running',
      children: [
        {
          id: 'backend-transfer-child',
          type: 'download',
          name: 'backend-child.log',
          source: '/home/deploy/backend-child.log',
          target: '/tmp/backend-child.log',
          progress: 40,
          speed: '512 KB/s',
          status: 'running'
        }
      ]
    })
    vi.mocked(window.aiops.cancelFileTransferTask).mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'backend-transfer-child',
        taskIds: ['backend-transfer-1', 'backend-transfer-child'],
        status: 'aborted'
      }
    })

    await expect(store.cancelFileTransferTask('backend-transfer-child')).resolves.toBe(true)

    expect(window.aiops.cancelFileTransferTask).toHaveBeenCalledWith({ id: 'backend-transfer-child' })
    expect(store.fileTransferTasks.find((task) => task.id === 'backend-transfer-1')).toEqual(
      expect.objectContaining({
        status: 'failed',
        speed: '已取消',
        progress: 60,
        children: [expect.objectContaining({ id: 'backend-transfer-child', status: 'failed', speed: '已取消', progress: 40 })]
      })
    )
    await vi.advanceTimersByTimeAsync(800)
    expect(store.fileTransferTasks.some((task) => task.id === 'backend-transfer-1')).toBe(false)
  })

  it('hydrates persisted External reference-style alias commands', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-stale', alias: 'stale', command: 'echo stale config alias', createdAt: 1780487300000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    vi.mocked(window.aiops.listAliasCommands).mockResolvedValueOnce({
      ok: true,
      data: [
        { id: 'alias-hosts', alias: 'hosts', command: 'cat /etc/hosts', createdAt: 1780487400000 },
        { id: 'alias-df', alias: 'dfh', command: 'df -h', createdAt: 1780487401000 }
      ]
    })

    await store.hydrateConfig()

    expect(store.aliasCommands).toEqual([
      expect.objectContaining({ id: 'alias-hosts', alias: 'hosts', command: 'cat /etc/hosts', edit: false }),
      expect.objectContaining({ id: 'alias-df', alias: 'dfh', command: 'df -h', edit: false })
    ])
    expect(store.aliasCommands.some((alias) => alias.alias === 'stale')).toBe(false)
    expect(window.aiops.listAliasCommands).toHaveBeenCalled()
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('does not hydrate aliases from renderer config when the backend bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    const originalListAliasCommands = window.aiops.listAliasCommands

    try {
      ;(window.aiops as any).listAliasCommands = undefined

      await store.hydrateConfig()

      expect(store.aliasCommands).toEqual([])
      expect(store.extensionNotice).toBe('Alias 服务不可用')
      const saveConfigPatches = vi.mocked(window.aiops.saveConfig).mock.calls.map(([patch]) => patch)
      expect(saveConfigPatches.every((patch) => !Object.prototype.hasOwnProperty.call(patch, 'aliasCommands'))).toBe(true)
    } finally {
      ;(window.aiops as any).listAliasCommands = originalListAliasCommands
    }
  })

  it('hydrates External reference-referenced extension switches and hides Alias when disabled', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: false,
        quickVimStatus: false,
        aliasStatus: false,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.extensionSettings).toEqual({
      autoCompleteStatus: false,
      quickVimStatus: false,
      aliasStatus: false,
      highlightStatus: true
    })
    expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(false)
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('hydrates and migrates External reference-style keyword highlight config', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: {
        'keyword-highlight': {
          enabled: 1,
          applyTo: {
            output: 1,
            input: 0
          },
          rules: [
            {
              name: ' Error Rule ',
              enabled: 1,
              scope: 'bad',
              matchType: 'regex',
              pattern: ' (?i)\\berror\\b ',
              style: {
                foreground: '#ff0000',
                fontStyle: 'bold',
                extra: true
              },
              extra: true
            } as any,
            {
              name: 'Error Rule',
              enabled: true,
              scope: 'output',
              matchType: 'regex',
              pattern: 'duplicate',
              style: {
                foreground: '#00FF00',
                fontStyle: 'normal'
              }
            },
            {
              name: 'missing-pattern',
              enabled: true,
              scope: 'output',
              matchType: 'regex',
              pattern: ''
            } as any
          ]
        }
      } as any,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.keywordHighlightSettings).toEqual({
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: false
        },
        rules: [
          {
            name: 'Error Rule',
            enabled: true,
            scope: 'output',
            matchType: 'regex',
            pattern: '(?i)\\berror\\b',
            style: {
              foreground: '#FF0000',
              fontStyle: 'bold'
            }
          }
        ]
      }
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordHighlight: {
          'keyword-highlight': {
            enabled: true,
            applyTo: {
              output: true,
              input: false
            },
            rules: [
              {
                name: 'Error Rule',
                enabled: true,
                scope: 'output',
                matchType: 'regex',
                pattern: '(?i)\\berror\\b',
                style: {
                  foreground: '#FF0000',
                  fontStyle: 'bold'
                }
              }
            ]
          }
        }
      })
    )
  })

  it('hydrates and migrates External reference-style security configuration', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: {
        security: {
          enableCommandSecurity: 1,
          enableStrictMode: 0,
          blacklistPatterns: [' rm -rf / ', '', 42],
          whitelistPatterns: [' ls ', 'pwd'],
          dangerousCommands: [' reboot ', 'shutdown', null],
          maxCommandLength: 200000,
          securityPolicy: {
            blockCritical: 1,
            askForMedium: 0,
            askForHigh: true,
            askForBlacklist: 'yes',
            extra: true
          },
          extra: true
        },
        extraRoot: true
      } as any,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.securitySettings).toEqual({
      security: {
        enableCommandSecurity: true,
        enableStrictMode: false,
        blacklistPatterns: ['rm -rf /'],
        whitelistPatterns: ['ls', 'pwd'],
        dangerousCommands: ['reboot', 'shutdown'],
        maxCommandLength: 10000,
        securityPolicy: {
          blockCritical: true,
          askForMedium: false,
          askForHigh: true,
          askForBlacklist: true
        }
      }
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        securityConfig: {
          security: {
            enableCommandSecurity: true,
            enableStrictMode: false,
            blacklistPatterns: ['rm -rf /'],
            whitelistPatterns: ['ls', 'pwd'],
            dangerousCommands: ['reboot', 'shutdown'],
            maxCommandLength: 10000,
            securityPolicy: {
              blockCritical: true,
              askForMedium: false,
              askForHigh: true,
              askForBlacklist: true
            }
          }
        }
      })
    )
  })

  it('hydrates and migrates External reference-style privacy settings', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      privacy: {
        telemetry: 'disabled',
        secretRedaction: 'enabled',
        dataSync: 'bad-value' as any
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.privacySettings).toEqual({
      telemetry: 'disabled',
      secretRedaction: 'enabled',
      dataSync: 'disabled',
      deactivateModalOpen: false,
      deactivateConfirmationInput: ''
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        privacy: {
          telemetry: 'disabled',
          secretRedaction: 'enabled',
          dataSync: 'disabled'
        }
      })
    )
  })

  it('hydrates and migrates External reference-style AI preference settings', async () => {
    const store = useWorkspaceStore()
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: {
        enableExtendedThinking: true,
        thinkingBudgetTokens: 9999,
        autoExecuteReadOnlyCommands: true,
        commandOutputFilteringEnabled: false,
        kbSearchEnabled: false,
        experienceExtractionEnabled: false,
        autoApproval: true,
        reasoningEffort: 'extreme' as any,
        needProxy: true,
        proxy: {
          type: 'BAD' as any,
          host: 'proxy.internal',
          port: 70000,
          enableProxyIdentity: true,
          username: 'ops',
          password: 'secret'
        },
        shellIntegrationTimeout: 0
      },
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [],
        usedBytes: 0,
        totalBytes: 1073741824
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.aiPreferences).toEqual({
      enableExtendedThinking: true,
      thinkingBudgetTokens: 6553,
      autoExecuteReadOnlyCommands: true,
      commandOutputFilteringEnabled: false,
      kbSearchEnabled: false,
      experienceExtractionEnabled: false,
      autoApproval: true,
      reasoningEffort: 'medium',
      needProxy: true,
      proxy: {
        type: 'HTTP',
        host: 'proxy.internal',
        port: 7890,
        enableProxyIdentity: true,
        username: 'ops',
        password: 'secret'
      },
      shellIntegrationTimeout: 4
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          thinkingBudgetTokens: 6553,
          autoApproval: true,
          reasoningEffort: 'medium',
          shellIntegrationTimeout: 4,
          proxy: expect.objectContaining({
            type: 'HTTP',
            port: 7890
          })
        })
      })
    )
  })

  it('hydrates persisted External reference-style knowledge base tree and capacity state', async () => {
    const store = useWorkspaceStore()
    ;(globalThis as any).__setKnowledgeTreeMock?.([
      {
        id: 'kb-runbooks',
        key: 'Runbooks',
        relPath: 'Runbooks',
        title: 'Runbooks',
        type: 'dir',
        children: [
          {
            id: 'kb-runbook-deploy',
            key: 'Runbooks/Deploy.md',
            relPath: 'Runbooks/Deploy.md',
            title: 'Deploy.md',
            type: 'file',
            size: 4096
          }
        ]
      }
    ])
    vi.mocked(window.aiops.getConfig).mockResolvedValueOnce({
      language: 'zh-CN',
      theme: 'dark',
      defaultMode: 'terminal',
      leftPanelOpen: true,
      rightPanelOpen: true,
      modelProvider: 'local',
      modelEndpoint: '',
      modelName: 'aiopsterm-local-agent',
      watermark: 'open',
      background: {
        mode: 'none',
        image: '',
        opacity: 0.15,
        brightness: 0.45
      },
      terminal: {
        terminalType: 'xterm-256color',
        fontFamily: 'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
        fontSize: 12,
        scrollBack: 1000,
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1,
        pinchZoomStatus: true,
        showCloseButton: true,
        sshAgentsStatus: false,
        middleMouseEvent: 'paste',
        rightMouseEvent: 'contextMenu'
      },
      workspacePreferences: {
        expandedGroups: ['recent_connections'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: {
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: true,
        highlightStatus: true
      },
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: {
        telemetry: 'enabled',
        secretRedaction: 'disabled',
        dataSync: 'disabled'
      },
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: {
        groups: [],
        snippets: []
      },
      knowledgeBase: {
        tree: [
          {
            id: 'kb-runbooks',
            key: 'Runbooks',
            relPath: 'Runbooks',
            title: 'Runbooks',
            type: 'dir',
            children: [
              {
                id: 'kb-runbook-deploy',
                key: 'Runbooks/Deploy.md',
                relPath: 'Runbooks/Deploy.md',
                title: 'Deploy.md',
                type: 'file',
                size: 4096
              }
            ]
          }
        ],
        usedBytes: 4096,
        totalBytes: 53687091200
      },
      aliasCommands: [
        { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 }
      ],
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      }
    })

    await store.hydrateConfig()

    expect(store.findKnowledgeNode('Runbooks/Deploy.md')).toEqual(expect.objectContaining({ title: 'Deploy.md', size: 4096 }))
    expect(store.kbUsedBytes).toBe(4096)
    expect(store.kbTotalBytes).toBe(53687091200)
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('keeps agent conversations sorted and updates active conversation metadata on send', async () => {
    const store = useWorkspaceStore()
    await store.loadChatConversationsFromBackend({ restoreIfEmpty: false })

    expect(store.sortedConversations[0].id).toBe('conv-1')
    store.selectConversation('conv-3')
    await store.sendChat('排查慢查询')

    expect(store.sortedConversations[0].id).toBe('conv-3')
    expect(store.sortedConversations[0].summary).toBe('排查慢查询')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conv-3',
        summary: '排查慢查询',
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user', text: expect.stringContaining('排查慢查询') })])
      })
    )

    await vi.runAllTimersAsync()
  })

  it('does not fabricate conversation metadata after chat sends when the history write bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.loadChatConversationsFromBackend({ restoreIfEmpty: false })

    const originalUpdate = window.aiops.updateChatConversation
    const originalOrder = store.sortedConversations.map((conversation) => conversation.id)
    const originalConversation = store.conversations.find((conversation) => conversation.id === 'conv-3')
    expect(originalConversation).toBeTruthy()
    const originalSummary = originalConversation!.summary
    const originalUpdatedAt = originalConversation!.updatedAt
    const originalTs = originalConversation!.ts

    try {
      ;(window.aiops as any).updateChatConversation = undefined

      store.selectConversation('conv-3')
      await expect(store.sendChat('客户端不应伪造会话摘要')).resolves.toBe(true)

      expect(store.chatMessages.some((message) => message.role === 'user' && message.text.includes('客户端不应伪造会话摘要'))).toBe(true)
      expect(store.sortedConversations.map((conversation) => conversation.id)).toEqual(originalOrder)
      expect(store.conversations.find((conversation) => conversation.id === 'conv-3')).toEqual(
        expect.objectContaining({
          summary: originalSummary,
          updatedAt: originalUpdatedAt,
          ts: originalTs
        })
      )
      expect(store.topNotice).toBe('会话历史写入服务不可用')

      await vi.runAllTimersAsync()
      expect(store.conversations.find((conversation) => conversation.id === 'conv-3')).toEqual(
        expect.objectContaining({
          summary: originalSummary,
          updatedAt: originalUpdatedAt,
          ts: originalTs
        })
      )
    } finally {
      ;(window.aiops as any).updateChatConversation = originalUpdate
    }
  })

  it('opens terminal-scoped file sessions and generates External reference-style terminal commands', async () => {
    const store = useWorkspaceStore()
    await store.refreshAiModelCatalog()

    const localPanel = store.applyLocalTerminalSession(store.activePanelId, {
      id: 'terminal-local-unit',
      shell: '/bin/zsh',
      cwd: '/home/unit',
      kind: 'local'
    })
    expect(localPanel).toEqual(expect.objectContaining({ sessionId: 'terminal-local-unit', title: 'zsh', cwd: '/home/unit', status: 'running' }))
    expect(store.activePanel.sshSession).toBeUndefined()
    expect(store.activePanel.output).not.toContain('[aiopsterm] shell started')

    expect(store.terminalCommandModelOptions).toContain('aiopsterm-local-agent')
    expect(store.terminalCommandModelOptions).not.toContain('gpt-5-Thinking')
    vi.mocked(window.aiops.saveFileSession).mockClear()
    vi.mocked(window.aiops.saveFileSessionFromTerminalContext).mockClear()
    const localSession = await store.ensureFileSessionForTerminalPanel(store.activePanelId, 'left')
    expect(localSession).toEqual(expect.objectContaining({ id: 'local', kind: 'local' }))
    expect(window.aiops.saveFileSessionFromTerminalContext).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local',
        panelId: store.activePanelId,
        sessionId: 'terminal-local-unit',
        cwd: '/home/unit'
      })
    )
    expect(window.aiops.saveFileSession).not.toHaveBeenCalled()
    expect(store.activeModule).toBe('files')
    expect(store.selectedLeftFileSessionId).toBe('local')
    expect(store.activePanel.output).toContain('[file manager] opened Local on left transfer pane')

    store.setActiveModule('workspace')
    store.registerSshSession(store.activePanelId, {
      id: 'asset-terminal-file',
      name: 'terminal-file-host',
      host: '10.8.0.9',
      port: 22,
      username: 'deploy',
      group_name: '生产',
      asset_type: 'person'
    })
    expect(store.activePanel.sshSession?.connectionId).toBeUndefined()
    const appliedSshSession = store.applySshTerminalSession(store.activePanelId, {
      id: 'test-session-asset-terminal-file',
      shell: 'ssh',
      cwd: '/home/deploy',
      kind: 'ssh',
      connection: {
        connectionId: 'ssh-test-session-asset-terminal-file',
        host: '10.8.0.9',
        port: 22,
        username: 'deploy',
        assetId: 'asset-terminal-file',
        assetName: 'terminal-file-host',
        assetType: 'person',
        organizationId: '生产',
        title: 'terminal-file-host',
        createdAt: 1717200001000
      }
    })
    expect(appliedSshSession).toEqual(expect.objectContaining({ connectionId: 'ssh-test-session-asset-terminal-file', createdAt: 1717200001000 }))
    vi.mocked(window.aiops.saveFileSessionFromTerminalContext).mockClear()
    const remoteSession = await store.ensureFileSessionForTerminalPanel(store.activePanelId, 'right')
    expect(remoteSession).toEqual(
      expect.objectContaining({
        id: 'asset-terminal-file',
        label: 'terminal-file-host',
        host: '10.8.0.9',
        rootPath: '/home/deploy'
      })
    )
    expect(window.aiops.saveFileSessionFromTerminalContext).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ssh',
        panelId: store.activePanelId,
        sessionId: 'test-session-asset-terminal-file',
        cwd: '/home/deploy',
        ssh: expect.objectContaining({
          connectionId: 'ssh-test-session-asset-terminal-file',
          assetId: 'asset-terminal-file',
          host: '10.8.0.9',
          username: 'deploy'
        })
      })
    )
    expect(store.selectedRightFileSessionId).toBe('asset-terminal-file')

    vi.mocked(window.aiops.generateTerminalCommand).mockClear()
    const record = await store.generateTerminalCommand(store.activePanelId, '检查磁盘空间', 'aiopsterm-local-agent')
    expect(window.aiops.generateTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: store.activePanelId,
        instruction: '检查磁盘空间',
        modelName: 'aiopsterm-local-agent',
        context: expect.objectContaining({ host: '10.8.0.9', username: 'deploy', connectionType: 'ssh' })
      })
    )
    expect(record).toEqual(expect.objectContaining({ command: 'df -h', modelName: 'aiopsterm-local-agent' }))
    expect(record?.context).toEqual(expect.objectContaining({ host: '10.8.0.9', username: 'deploy', connectionType: 'ssh' }))
    expect(store.terminalCommandGenerationRecords[0]).toEqual(record)

    const decision = store.injectGeneratedTerminalCommand(store.activePanelId, record!.command)
    expect(decision?.status).toBe('allow')
    expect(store.activePanel.output).toContain('df -h')
    expect(store.activePanel.outputSegments.at(-1)).toEqual({ text: 'df -h', scope: 'input' })
  })

  it('does not fabricate Files SFTP sessions or file-session updates when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.refreshFileSessionCatalog()

    const originalSaveFromPayload = window.aiops.saveFileSessionFromSftpPayload
    const originalSaveFromTerminalContext = window.aiops.saveFileSessionFromTerminalContext
    const originalUpdateFileSession = window.aiops.updateFileSession
    const originalAsset = store.fileSessions.find((session) => session.id === 'asset-1')
    expect(originalAsset).toBeTruthy()
    const originalComment = originalAsset!.comment
    const originalSessionCount = store.fileSessions.length

    try {
      ;(window.aiops as any).saveFileSessionFromSftpPayload = undefined
      await expect(
        store.addRemoteFileSessionFromSftpPayload(
          {
            uuid: 'asset-client-fake',
            host: '10.77.0.4',
            title: 'client-fake',
            username: 'ops'
          },
          'right'
        )
      ).resolves.toBeNull()
      expect(store.fileSessions).toHaveLength(originalSessionCount)
      expect(store.fileSessions.some((session) => session.id === 'asset-client-fake')).toBe(false)
      expect(store.selectedRightFileSessionId).not.toBe('asset-client-fake')
      expect(store.topNotice).toBe('文件会话写入服务不可用')

      store.applyLocalTerminalSession(store.activePanelId, {
        id: 'terminal-no-files-bridge',
        shell: '/bin/bash',
        cwd: '/home/no-bridge',
        kind: 'local'
      })
      ;(window.aiops as any).saveFileSessionFromTerminalContext = undefined
      await expect(store.ensureFileSessionForTerminalPanel(store.activePanelId, 'left')).resolves.toBeNull()
      expect(store.fileSessions).toHaveLength(originalSessionCount)
      expect(store.fileSessions.find((session) => session.id === 'local')?.rootPath).toBe('/')
      expect(store.selectedLeftFileSessionId).not.toBe('local')
      expect(store.topNotice).toBe('文件会话写入服务不可用')

      await expect(store.addRemoteFileSession('asset-client-fake', 'left')).resolves.toBeNull()
      expect(store.fileSessions).toHaveLength(originalSessionCount)
      expect(store.fileSessions.some((session) => session.id === 'asset-client-fake')).toBe(false)
      expect(store.selectedLeftFileSessionId).not.toBe('asset-client-fake')
      expect(store.topNotice).toBe('文件会话写入服务不可用')

      ;(window.aiops as any).updateFileSession = undefined
      await expect(store.updateFileSession('asset-1', { comment: '客户端伪造备注' })).resolves.toBeNull()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.comment).toBe(originalComment)
      expect(store.topNotice).toBe('文件会话写入服务不可用')
    } finally {
      ;(window.aiops as any).saveFileSessionFromSftpPayload = originalSaveFromPayload
      ;(window.aiops as any).saveFileSessionFromTerminalContext = originalSaveFromTerminalContext
      ;(window.aiops as any).updateFileSession = originalUpdateFileSession
    }
  })

  it('does not fabricate Files folders or transfer-task state when bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshFileSessionCatalog()
    store.pushFileTransferTask({
      id: 'files-bridge-transfer-1',
      type: 'upload',
      name: 'release.tar.gz',
      source: '/tmp/release.tar.gz',
      target: '/home/deploy/release.tar.gz',
      progress: 35,
      speed: '700 KB/s',
      status: 'running',
      children: [
        {
          id: 'files-bridge-transfer-child',
          type: 'upload',
          name: 'release.part',
          source: '/tmp/release.part',
          target: '/home/deploy/release.part',
          progress: 20,
          speed: '300 KB/s',
          status: 'running'
        }
      ]
    })

    const originalAiops = {
      listFileSessionCatalog: window.aiops.listFileSessionCatalog,
      saveFileSession: window.aiops.saveFileSession,
      updateFileSession: window.aiops.updateFileSession,
      saveFileSessionFolder: window.aiops.saveFileSessionFolder,
      deleteFileSessionFolder: window.aiops.deleteFileSessionFolder,
      listFileTransferTasks: window.aiops.listFileTransferTasks,
      recordFileTransferTask: window.aiops.recordFileTransferTask,
      cancelFileTransferTask: window.aiops.cancelFileTransferTask
    }
    const foldersBefore = JSON.stringify(store.fileSessionFolders)
    const sessionsBefore = JSON.stringify(store.fileSessions)
    const transfersBefore = JSON.stringify(store.fileTransferTasks)
    const originalComment = store.fileSessions.find((session) => session.id === 'asset-1')?.comment

    try {
      ;(window.aiops as any).listFileSessionCatalog = undefined
      await expect(store.refreshFileSessionCatalog()).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话加载服务不可用')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      expect(JSON.stringify(store.fileSessions)).toBe(sessionsBefore)

      ;(window.aiops as any).listFileSessionCatalog = originalAiops.listFileSessionCatalog
      vi.mocked(window.aiops.listFileSessionCatalog!).mockRejectedValueOnce(new Error('catalog offline'))
      await expect(store.refreshFileSessionCatalog()).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话加载失败')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      expect(JSON.stringify(store.fileSessions)).toBe(sessionsBefore)

      ;(window.aiops as any).saveFileSession = undefined
      await expect(
        store.persistFileSession({
          id: 'client-fake-session',
          label: 'client fake',
          host: '10.10.10.10',
          group: '主机',
          kind: 'remote',
          rootPath: '/home/fake',
          status: 'active'
        })
      ).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话写入服务不可用')
      expect(store.fileSessions.some((session) => session.id === 'client-fake-session')).toBe(false)

      ;(window.aiops as any).saveFileSession = originalAiops.saveFileSession
      vi.mocked(window.aiops.saveFileSession!).mockRejectedValueOnce(new Error('save session offline'))
      await expect(
        store.persistFileSession({
          id: 'client-fake-session',
          label: 'client fake',
          host: '10.10.10.10',
          group: '主机',
          kind: 'remote',
          rootPath: '/home/fake',
          status: 'active'
        })
      ).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话写入失败')
      expect(store.fileSessions.some((session) => session.id === 'client-fake-session')).toBe(false)

      ;(window.aiops as any).updateFileSession = originalAiops.updateFileSession
      vi.mocked(window.aiops.updateFileSession!).mockRejectedValueOnce(new Error('update session offline'))
      await expect(store.updateFileSession('asset-1', { comment: '客户端伪造更新' })).resolves.toBeNull()
      expect(store.fileSessions.find((session) => session.id === 'asset-1')?.comment).toBe(originalComment)
      expect(store.topNotice).toBe('文件会话写入失败')

      ;(window.aiops as any).saveFileSessionFolder = undefined
      await expect(store.saveFileSessionFolder({ name: '客户端伪造文件夹', description: 'fake' })).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话文件夹写入服务不可用')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)

      ;(window.aiops as any).saveFileSessionFolder = originalAiops.saveFileSessionFolder
      vi.mocked(window.aiops.saveFileSessionFolder!).mockRejectedValueOnce(new Error('folder save offline'))
      await expect(store.saveFileSessionFolder({ name: '客户端伪造文件夹', description: 'fake' })).resolves.toBeNull()
      expect(store.topNotice).toBe('文件会话文件夹写入失败')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      vi.mocked(window.aiops.saveFileSessionFolder!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'FILES_FOLDER_BACKEND_DOWN',
        errorMessage: '文件夹后端写入失败'
      })
      await expect(store.saveFileSessionFolder({ name: '客户端伪造文件夹', description: 'fake' })).resolves.toBeNull()
      expect(store.topNotice).toBe('文件夹后端写入失败')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)

      ;(window.aiops as any).deleteFileSessionFolder = undefined
      await expect(store.deleteFileSessionFolder('files-folder-a')).resolves.toBe(false)
      expect(store.topNotice).toBe('文件会话文件夹删除服务不可用')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      expect(JSON.stringify(store.fileSessions)).toBe(sessionsBefore)

      ;(window.aiops as any).deleteFileSessionFolder = originalAiops.deleteFileSessionFolder
      vi.mocked(window.aiops.deleteFileSessionFolder!).mockRejectedValueOnce(new Error('folder delete offline'))
      await expect(store.deleteFileSessionFolder('files-folder-a')).resolves.toBe(false)
      expect(store.topNotice).toBe('文件会话文件夹删除失败')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      expect(JSON.stringify(store.fileSessions)).toBe(sessionsBefore)
      vi.mocked(window.aiops.deleteFileSessionFolder!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'FILES_FOLDER_DELETE_DOWN',
        errorMessage: '文件夹后端删除失败'
      })
      await expect(store.deleteFileSessionFolder('files-folder-a')).resolves.toBe(false)
      expect(store.topNotice).toBe('文件夹后端删除失败')
      expect(JSON.stringify(store.fileSessionFolders)).toBe(foldersBefore)
      expect(JSON.stringify(store.fileSessions)).toBe(sessionsBefore)

      ;(window.aiops as any).listFileTransferTasks = undefined
      await expect(store.refreshFileTransferTasks()).resolves.toBe(false)
      expect(store.topNotice).toBe('文件传输任务加载服务不可用')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)

      ;(window.aiops as any).listFileTransferTasks = originalAiops.listFileTransferTasks
      vi.mocked(window.aiops.listFileTransferTasks!).mockRejectedValueOnce(new Error('transfer snapshot offline'))
      await expect(store.refreshFileTransferTasks()).resolves.toBe(false)
      expect(store.topNotice).toBe('文件传输任务加载失败')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)

      ;(window.aiops as any).recordFileTransferTask = undefined
      await expect(
        store.recordFileTransferTask({
          type: 'download',
          name: 'client-fake.log',
          source: '/home/deploy/client-fake.log',
          target: '/tmp/client-fake.log',
          status: 'success'
        })
      ).resolves.toBeNull()
      expect(store.topNotice).toBe('文件传输任务记录服务不可用')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)

      ;(window.aiops as any).recordFileTransferTask = originalAiops.recordFileTransferTask
      vi.mocked(window.aiops.recordFileTransferTask!).mockRejectedValueOnce(new Error('record transfer offline'))
      await expect(
        store.recordFileTransferTask({
          type: 'download',
          name: 'client-fake.log',
          source: '/home/deploy/client-fake.log',
          target: '/tmp/client-fake.log',
          status: 'success'
        })
      ).resolves.toBeNull()
      expect(store.topNotice).toBe('文件传输任务记录失败')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)
      vi.mocked(window.aiops.recordFileTransferTask!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'FILES_TRANSFER_RECORD_DOWN',
        errorMessage: '传输任务后端记录失败'
      })
      await expect(
        store.recordFileTransferTask({
          type: 'download',
          name: 'client-fake.log',
          source: '/home/deploy/client-fake.log',
          target: '/tmp/client-fake.log',
          status: 'success'
        })
      ).resolves.toBeNull()
      expect(store.topNotice).toBe('传输任务后端记录失败')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)

      ;(window.aiops as any).cancelFileTransferTask = undefined
      await expect(store.cancelFileTransferTask('files-bridge-transfer-child')).resolves.toBe(false)
      expect(store.topNotice).toBe('取消传输任务服务不可用')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)

      ;(window.aiops as any).cancelFileTransferTask = originalAiops.cancelFileTransferTask
      vi.mocked(window.aiops.cancelFileTransferTask!).mockRejectedValueOnce(new Error('cancel transfer offline'))
      await expect(store.cancelFileTransferTask('files-bridge-transfer-child')).resolves.toBe(false)
      expect(store.topNotice).toBe('取消传输任务失败')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)
      vi.mocked(window.aiops.cancelFileTransferTask!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'FILES_TRANSFER_CANCEL_DOWN',
        errorMessage: '传输任务后端取消失败'
      })
      await expect(store.cancelFileTransferTask('files-bridge-transfer-child')).resolves.toBe(false)
      expect(store.topNotice).toBe('传输任务后端取消失败')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)
      vi.mocked(window.aiops.cancelFileTransferTask!).mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'files-bridge-transfer-child',
          taskIds: [],
          status: 'not_found'
        }
      })
      await expect(store.cancelFileTransferTask('files-bridge-transfer-child')).resolves.toBe(false)
      expect(store.topNotice).toBe('传输任务已结束或不存在')
      expect(JSON.stringify(store.fileTransferTasks)).toBe(transfersBefore)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('manages External reference-style AI history conversation actions through backend snapshots', async () => {
    const store = useWorkspaceStore()
    await store.loadChatConversationsFromBackend({ restoreIfEmpty: false })

    expect(await store.renameConversation('conv-2', 'K8s 发布复盘')).toBe(true)
    expect(store.conversations.find((conversation) => conversation.id === 'conv-2')?.title).toBe('K8s 发布复盘')
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-2', title: 'K8s 发布复盘' }))
    expect(await store.renameConversation('conv-2', '   ')).toBe(false)

    expect(await store.toggleConversationFavorite('conv-2')).toBe(true)
    expect(store.conversations.find((conversation) => conversation.id === 'conv-2')?.favorite).toBe(true)
    expect(window.aiops.updateChatConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'conv-2', favorite: true }))
    expect(await store.toggleConversationFavorite('missing')).toBe(false)

    expect(await store.restoreConversation('conv-2')).toBe(true)
    expect(store.selectedConversationId).toBe('conv-2')
    expect(window.aiops.restoreChatConversation).toHaveBeenCalledWith('conv-2')
    expect(store.chatMessages[0].text).toContain('历史会话已从 aiopsterm 后端恢复')
    expect(store.chatMessages.at(-1)?.text).toContain('K8s 发布失败历史包含 Pod 事件')
    expect(store.chatMessages.at(-1)?.text).not.toContain('本地历史摘要')
    expect(store.chatMessages.find((message) => message.role === 'user')?.hosts?.[0].label).toBe('prod-cluster')

    const created = await store.createConversation()
    expect(window.aiops.createChatConversation).toHaveBeenCalled()
    expect(created?.title).toBe('新会话')
    expect(store.selectedConversationId).toBe(created?.id)
    expect(store.chatMessages.at(-1)?.text).toContain('请输入本次运维目标')
  })

  it('does not fabricate AI history title or favorite writes when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.loadChatConversationsFromBackend({ restoreIfEmpty: false })

    const originalUpdate = window.aiops.updateChatConversation
    const originalConversation = store.conversations.find((conversation) => conversation.id === 'conv-2')
    expect(originalConversation).toBeTruthy()
    const originalTitle = originalConversation!.title
    const originalFavorite = originalConversation!.favorite

    try {
      ;(window.aiops as any).updateChatConversation = undefined

      await expect(store.renameConversation('conv-2', '客户端伪造标题')).resolves.toBe(false)
      expect(store.conversations.find((conversation) => conversation.id === 'conv-2')?.title).toBe(originalTitle)
      expect(store.topNotice).toBe('会话历史写入服务不可用')

      await expect(store.toggleConversationFavorite('conv-2')).resolves.toBe(false)
      expect(store.conversations.find((conversation) => conversation.id === 'conv-2')?.favorite).toBe(originalFavorite)
      expect(store.topNotice).toBe('会话历史写入服务不可用')
    } finally {
      ;(window.aiops as any).updateChatConversation = originalUpdate
    }
  })

  it('does not optimistically fabricate AI history metadata when backend title or favorite writes fail', async () => {
    const store = useWorkspaceStore()
    await store.loadChatConversationsFromBackend({ restoreIfEmpty: false })

    const originalOrder = store.sortedConversations.map((conversation) => conversation.id)
    const originalConversation = store.conversations.find((conversation) => conversation.id === 'conv-2')
    expect(originalConversation).toBeTruthy()
    const originalTitle = originalConversation!.title
    const originalFavorite = originalConversation!.favorite
    const originalUpdatedAt = originalConversation!.updatedAt
    const originalTs = originalConversation!.ts

    vi.mocked(window.aiops.updateChatConversation).mockResolvedValueOnce({
      ok: false,
      errorCode: 'CHAT_HISTORY_SAVE_FAILED',
      errorMessage: 'Save failed.'
    })
    await expect(store.renameConversation('conv-2', '客户端乐观标题')).resolves.toBe(false)
    expect(store.conversations.find((conversation) => conversation.id === 'conv-2')).toEqual(
      expect.objectContaining({
        title: originalTitle,
        favorite: originalFavorite,
        updatedAt: originalUpdatedAt,
        ts: originalTs
      })
    )
    expect(store.sortedConversations.map((conversation) => conversation.id)).toEqual(originalOrder)

    vi.mocked(window.aiops.updateChatConversation).mockResolvedValueOnce({
      ok: false,
      errorCode: 'CHAT_HISTORY_SAVE_FAILED',
      errorMessage: 'Save failed.'
    })
    await expect(store.toggleConversationFavorite('conv-2')).resolves.toBe(false)
    expect(store.conversations.find((conversation) => conversation.id === 'conv-2')).toEqual(
      expect.objectContaining({
        title: originalTitle,
        favorite: originalFavorite,
        updatedAt: originalUpdatedAt,
        ts: originalTs
      })
    )
    expect(store.sortedConversations.map((conversation) => conversation.id)).toEqual(originalOrder)
  })

  it('does not fabricate AI message favorite or feedback writes when the preload bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.restoreConversation('conv-2')
    const assistant = store.chatMessages.find((message) => message.id === 'hist-conv-2-assistant')
    expect(assistant).toBeTruthy()

    const originalSave = window.aiops.saveChatMessageMetadata
    try {
      ;(window.aiops as any).saveChatMessageMetadata = undefined
      await expect(store.toggleMessageFavorite(assistant!.id)).resolves.toBe(false)
      expect(assistant!.favorite).toBeUndefined()
      expect(store.topNotice).toBe('AI 消息写入服务不可用')

      await expect(store.setMessageFeedback(assistant!.id, 'up')).resolves.toBe(false)
      expect(assistant!.feedback).toBeUndefined()
      expect(store.topNotice).toBe('AI 消息写入服务不可用')
    } finally {
      ;(window.aiops as any).saveChatMessageMetadata = originalSave
    }

    vi.mocked(window.aiops.saveChatMessageMetadata).mockResolvedValueOnce({
      ok: false,
      errorCode: 'CHAT_HISTORY_MESSAGE_SAVE_FAILED',
      errorMessage: 'Message metadata save failed.'
    })
    await expect(store.toggleMessageFavorite(assistant!.id)).resolves.toBe(false)
    expect(assistant!.favorite).toBeUndefined()

    vi.mocked(window.aiops.saveChatMessageMetadata).mockResolvedValueOnce({
      ok: false,
      errorCode: 'CHAT_HISTORY_MESSAGE_SAVE_FAILED',
      errorMessage: 'Message metadata save failed.'
    })
    await expect(store.setMessageFeedback(assistant!.id, 'down')).resolves.toBe(false)
    expect(assistant!.feedback).toBeUndefined()
  })

  it('manages External reference-style context chips, command presets, message actions, and todos', async () => {
    const store = useWorkspaceStore()

    store.toggleContext({ id: 'doc-linux', kind: 'docs', label: 'Linux 巡检手册' })
    expect(store.selectedContexts.some((context) => context.id === 'doc-linux')).toBe(true)

    store.removeContext('doc-linux')
    expect(store.selectedContexts.some((context) => context.id === 'doc-linux')).toBe(false)

    store.applyCommandPreset('diagnose', '生成诊断计划')
    await vi.runAllTimersAsync()
    expect(store.selectedCommandId).toBe('diagnose')
    expect(store.chatMessages.at(-2)?.text).toContain('生成诊断计划')

    const assistant = store.chatMessages.find((message) => message.role === 'assistant')
    expect(assistant).toBeTruthy()
    await expect(store.toggleMessageFavorite(assistant!.id)).resolves.toBe(true)
    await expect(store.setMessageFeedback(assistant!.id, 'up')).resolves.toBe(true)
    expect(assistant!.favorite).toBe(true)
    expect(assistant!.feedback).toBe('up')
    expect(window.aiops.saveChatMessageMetadata).toHaveBeenCalledWith({
      conversationId: store.selectedConversationId,
      messageId: assistant!.id,
      favorite: true
    })
    expect(window.aiops.saveChatMessageMetadata).toHaveBeenCalledWith({
      conversationId: store.selectedConversationId,
      messageId: assistant!.id,
      feedback: 'up'
    })
    await expect(store.setMessageFeedback(assistant!.id, 'up')).resolves.toBe(true)
    expect(assistant!.feedback).toBeUndefined()
    await store.restoreConversation(store.selectedConversationId)
    const restoredAssistant = store.chatMessages.find((message) => message.id === assistant!.id)
    expect(restoredAssistant).toEqual(expect.objectContaining({ favorite: true, feedback: undefined }))

    await store.sendChat('重新执行发布检查')
    await vi.runAllTimersAsync()
    const retryTarget = store.chatMessages.at(-1)!
    expect(retryTarget.role).toBe('assistant')
    expect(store.retryAssistantMessage(retryTarget.id)).toBe(true)
    expect(store.chatMessages.at(-2)?.text).toContain('重新执行发布检查')

    const knowledgeSummary = await store.summarizeMessageToKnowledge(retryTarget.id)
    expect(knowledgeSummary?.relPath).toMatch(/^summary\/ai-message-.+\.md$/)
    expect(store.findKnowledgeNode(knowledgeSummary!.relPath)).toEqual(expect.objectContaining({ type: 'file' }))
    expect(store.activePanel.kind).toBe('knowledge')

    const skillSummary = await store.summarizeMessageToSkill(retryTarget.id)
    expect(skillSummary?.name).toMatch(/skill$/)
    expect(store.settingsSkills[0].name).toBe(skillSummary?.name)

    store.activePanelId = 'panel-main'
    const unavailableTerminalDecision = await store.runActiveTerminalCommand('echo ai-message')
    expect(unavailableTerminalDecision?.status).toBe('unavailable')
    expect(store.activePanel.output).not.toContain('[aiopsterm] no live terminal session for: echo ai-message')
    expect(store.activePanel.output).not.toContain('echo ai-message')
    expect(store.topNotice).toBe('终端会话不可用，请先打开本地 shell 或连接 SSH')

    store.activePanel.sessionId = 'terminal-ai-message'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const terminalDecision = await store.runActiveTerminalCommand('echo ai-message')
    expect(terminalDecision?.status).toBe('allow')
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('terminal-ai-message', 'echo ai-message\n')
    expect(store.activePanel.outputSegments.at(-1)).toEqual({ text: 'echo ai-message\n', scope: 'input' })

    expect(store.todoProgress.total).toBe(0)
    await expect(store.refreshAiTodoSnapshot()).resolves.toBe(true)
    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalled()
    expect(store.todoItems.map((todo) => todo.content)).toEqual(['收集上下文', '生成命令建议', '等待确认'])
    expect(store.todoItems.find((todo) => todo.id === 'todo-2')?.subtasks?.[0]).toMatchObject({
      content: '检查风险级别',
      description: '危险命令需要二次确认'
    })
    expect(store.todoProgress.total).toBe(3)
    expect(store.todoProgress.completed).toBe(1)
    expect(store.todoProgress.percent).toBe(33)
  })

  it('manages External reference-style quick command scripts and macro snippets', async () => {
    const store = useWorkspaceStore()
    await store.refreshQuickCommands()

    expect(store.filteredQuickCommands.some((command) => command.snippet_name === '当前目录')).toBe(true)
    store.selectedSnippetGroupUuid = 'group-monitor'
    expect(store.filteredQuickCommands.every((command) => command.group_uuid === 'group-monitor')).toBe(true)

    store.activePanel.sessionId = 'quick-command-session'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const quickCommandDecision = await store.runQuickCommand(1, false)
    expect(quickCommandDecision?.status).toBe('allow')
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('quick-command-session', 'df -h\ndu -sh * | sort -h')
    expect(store.activePanel.output).toContain('df -h')
    expect(store.activePanel.output).toContain('du -sh * | sort -h')
    expect(store.activePanel.output).not.toContain('[snippet]')

    store.activePanel.sessionId = undefined
    const outputBeforeUnavailableSnippet = store.activePanel.output
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const unavailableSnippetDecision = await store.runQuickCommand(1, false)
    expect(unavailableSnippetDecision?.status).toBe('unavailable')
    expect(window.aiops.writeTerminal).not.toHaveBeenCalled()
    expect(store.activePanel.output).toBe(outputBeforeUnavailableSnippet)

    const dangerousSnippet = await store.createQuickCommand({ snippet_name: '危险删除', snippet_content: 'rm /tmp/file', group_uuid: null })
    expect(dangerousSnippet).toBeTruthy()
    expect(dangerousSnippet?.uuid).toMatch(/^quick-snippet-test-/)
    vi.mocked(window.aiops.saveQuickCommandSnippet).mockClear()
    store.activePanel.sessionId = 'quick-command-session'
    vi.mocked(window.aiops.writeTerminal).mockClear()
    const decision = await store.runQuickCommand(dangerousSnippet!.id, true)
    expect(decision?.status).toBe('needs-approval')
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    expect(store.activePanel.output).not.toContain('[snippet] 危险删除')
    const approvedSnippetExecution = store.approveTerminalSecurityPrompt()
    expect(approvedSnippetExecution?.writeToShell).toBe(true)
    const approvedSnippetDecision = await store.writeTerminalExecution(approvedSnippetExecution!)
    expect(approvedSnippetDecision?.status).toBe('allow')
    expect(window.aiops.writeTerminal).toHaveBeenCalledWith('quick-command-session', 'rm /tmp/file\n')
    expect(store.activePanel.output).toContain('rm /tmp/file')
    expect(store.activePanel.output).not.toContain('[snippet] 危险删除')

    await store.createSnippetGroup('发布命令')
    const group = store.snippetGroups.find((item) => item.group_name === '发布命令')
    expect(group).toBeTruthy()
    expect(group!.uuid).toMatch(/^quick-group-test-/)
    expect(window.aiops.saveQuickCommandGroup).toHaveBeenCalledWith({ group_name: '发布命令' })

    await store.createQuickCommand({ snippet_name: '回滚确认', snippet_content: 'echo rollback\nctrl+c', group_uuid: group!.uuid })
    expect(store.quickCommands.some((command) => command.snippet_name === '回滚确认')).toBe(true)
    expect(window.aiops.saveQuickCommandSnippet).toHaveBeenCalledWith(
      expect.objectContaining({
        snippet_name: '回滚确认',
        snippet_content: 'echo rollback\nctrl+c',
        group_uuid: group!.uuid
      })
    )

    const rollback = store.quickCommands.find((command) => command.snippet_name === '回滚确认')!
    await store.updateQuickCommand(rollback.id, { snippet_name: '回滚确认更新', snippet_content: 'echo updated', group_uuid: null })
    expect(store.quickCommands.some((command) => command.snippet_name === '回滚确认更新' && command.group_uuid === null)).toBe(true)

    await store.renameSnippetGroup(group!.uuid, '发布命令更新')
    expect(store.snippetGroups.find((item) => item.uuid === group!.uuid)?.group_name).toBe('发布命令更新')

    store.startMacroRecording()
    store.recordMacroCommand('uptime')
    await store.stopMacroRecording()
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('uptime'))).toBe(true)
    expect(window.aiops.saveQuickCommandSnippet).toHaveBeenCalledWith(
      expect.objectContaining({
        snippet_content: 'uptime'
      })
    )

    const countBeforeEmptyMacro = store.quickCommands.length
    store.startMacroRecording()
    await store.stopMacroRecording()
    expect(store.quickCommands).toHaveLength(countBeforeEmptyMacro)

    store.setMacroSleepThreshold(400)
    store.startMacroRecording('panel-main')
    store.recordMacroTerminalInput('panel-main', 'date', 1000)
    expect(store.macroCurrentLineBuffer).toBe('date')
    store.recordMacroTerminalInput('panel-main', '\b', 1100)
    store.recordMacroTerminalInput('panel-main', 'e\n', 1200)
    store.recordMacroTerminalInput('panel-main', '\x1b[A', 1700)
    store.recordMacroTerminalInput('other-panel', 'ignored\n', 1800)
    const savedMacro = await store.stopMacroRecording()
    expect(savedMacro?.snippet_content).toBe('date\nsleep==500\nup')

    store.startMacroRecording('panel-main')
    for (let index = 0; index < 50; index += 1) {
      store.recordMacroCommand(`limit-${index}`, 2000 + index)
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(store.isMacroRecording).toBe(false)
    expect(store.macroLimitReason).toBe('count')
  })

  it('does not mutate quick commands when required backend operations are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshQuickCommands()

    const originalAiops = {
      getQuickCommands: window.aiops.getQuickCommands,
      saveQuickCommandGroup: window.aiops.saveQuickCommandGroup,
      deleteQuickCommandGroup: window.aiops.deleteQuickCommandGroup,
      saveQuickCommandSnippet: window.aiops.saveQuickCommandSnippet,
      deleteQuickCommandSnippet: window.aiops.deleteQuickCommandSnippet,
      reorderQuickCommands: window.aiops.reorderQuickCommands
    }
    const quickCommandsSnapshot = () =>
      JSON.stringify({
        groups: store.snippetGroups,
        snippets: store.quickCommands
      })

    try {
      const initialSnapshot = quickCommandsSnapshot()
      ;(window.aiops as any).getQuickCommands = undefined
      await expect(store.refreshQuickCommands()).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令加载服务不可用')
      expect(quickCommandsSnapshot()).toBe(initialSnapshot)

      ;(window.aiops as any).getQuickCommands = originalAiops.getQuickCommands
      vi.mocked(window.aiops.getQuickCommands!).mockRejectedValueOnce(new Error('quick commands offline'))
      await expect(store.refreshQuickCommands()).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令加载失败')
      expect(quickCommandsSnapshot()).toBe(initialSnapshot)

      ;(window.aiops as any).saveQuickCommandGroup = undefined
      await expect(store.createSnippetGroup('No Bridge Group')).resolves.toBeNull()
      expect(store.topNotice).toBe('快捷命令分组写入服务不可用')
      expect(quickCommandsSnapshot()).toBe(initialSnapshot)

      ;(window.aiops as any).saveQuickCommandGroup = originalAiops.saveQuickCommandGroup
      const group = await store.createSnippetGroup('Bridge Group')
      expect(group).toBeTruthy()
      const afterGroupSnapshot = quickCommandsSnapshot()

      ;(window.aiops as any).saveQuickCommandGroup = undefined
      await expect(store.renameSnippetGroup(group!.uuid, 'Fake Rename')).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令分组写入服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterGroupSnapshot)

      ;(window.aiops as any).saveQuickCommandGroup = originalAiops.saveQuickCommandGroup
      vi.mocked(window.aiops.saveQuickCommandGroup!).mockRejectedValueOnce(new Error('group write failed'))
      await expect(store.renameSnippetGroup(group!.uuid, 'Fake Rename')).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令分组写入失败')
      expect(quickCommandsSnapshot()).toBe(afterGroupSnapshot)

      ;(window.aiops as any).deleteQuickCommandGroup = undefined
      await expect(store.deleteSnippetGroup(group!.uuid)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令分组删除服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterGroupSnapshot)

      ;(window.aiops as any).deleteQuickCommandGroup = originalAiops.deleteQuickCommandGroup
      vi.mocked(window.aiops.deleteQuickCommandGroup!).mockRejectedValueOnce(new Error('group delete failed'))
      await expect(store.deleteSnippetGroup(group!.uuid)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令分组删除失败')
      expect(quickCommandsSnapshot()).toBe(afterGroupSnapshot)

      ;(window.aiops as any).saveQuickCommandSnippet = undefined
      await expect(store.createQuickCommand({ snippet_name: 'No Bridge Command', snippet_content: 'echo no', group_uuid: null })).resolves.toBeNull()
      expect(store.topNotice).toBe('快捷命令写入服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterGroupSnapshot)

      ;(window.aiops as any).saveQuickCommandSnippet = originalAiops.saveQuickCommandSnippet
      const command = await store.createQuickCommand({ snippet_name: 'Bridge Command', snippet_content: 'echo bridge', group_uuid: group!.uuid })
      expect(command).toBeTruthy()
      const afterCommandSnapshot = quickCommandsSnapshot()

      ;(window.aiops as any).saveQuickCommandSnippet = undefined
      await expect(store.updateQuickCommand(command!.id, { snippet_name: 'Fake Update', snippet_content: 'echo fake', group_uuid: null })).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令写入服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)

      ;(window.aiops as any).saveQuickCommandSnippet = originalAiops.saveQuickCommandSnippet
      vi.mocked(window.aiops.saveQuickCommandSnippet!).mockRejectedValueOnce(new Error('snippet write failed'))
      await expect(store.updateQuickCommand(command!.id, { snippet_name: 'Fake Update', snippet_content: 'echo fake', group_uuid: null })).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令写入失败')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)

      ;(window.aiops as any).deleteQuickCommandSnippet = undefined
      await expect(store.deleteQuickCommand(command!.id)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令删除服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)

      ;(window.aiops as any).deleteQuickCommandSnippet = originalAiops.deleteQuickCommandSnippet
      vi.mocked(window.aiops.deleteQuickCommandSnippet!).mockRejectedValueOnce(new Error('snippet delete failed'))
      await expect(store.deleteQuickCommand(command!.id)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令删除失败')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)

      store.selectedSnippetGroupUuid = 'group-monitor'
      ;(window.aiops as any).reorderQuickCommands = undefined
      await expect(store.reorderQuickCommand(1, 2)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令排序服务不可用')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)

      ;(window.aiops as any).reorderQuickCommands = originalAiops.reorderQuickCommands
      vi.mocked(window.aiops.reorderQuickCommands!).mockRejectedValueOnce(new Error('reorder failed'))
      await expect(store.reorderQuickCommand(1, 2)).resolves.toBe(false)
      expect(store.topNotice).toBe('快捷命令排序失败')
      expect(quickCommandsSnapshot()).toBe(afterCommandSnapshot)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('loads knowledge tree from the backend bridge instead of renderer mock defaults', async () => {
    const store = useWorkspaceStore()

    expect(store.knowledgeTree).toEqual([])
    expect(store.kbUsedBytes).toBe(0)

    await store.refreshKnowledgeTree({ persist: false })

    expect(window.aiops.kbEnsureRoot).toHaveBeenCalled()
    expect(window.aiops.kbListDir).toHaveBeenCalledWith('')
    expect(store.findKnowledgeNode('Markdown语法指南.md')).toEqual(expect.objectContaining({ type: 'file' }))
    expect(store.findKnowledgeNode('commands/rollback-plan.md')).toEqual(expect.objectContaining({ type: 'file' }))
    expect(store.kbUsedBytes).toBe(374784)
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('does not fabricate knowledge search status or reindex results when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()

    expect(store.kbSearchStatus).toBeNull()
    await expect(store.refreshKnowledgeSearchStatus()).resolves.toBe(true)
    expect(store.kbSearchStatus).toEqual({
      totalFiles: 3,
      totalChunks: 3,
      provider: 'aiopsterm-local',
      model: 'lexical',
      updatedAt: 1717200000000
    })

    const backendStatus = store.kbSearchStatus
    vi.mocked(window.aiops.kbSearchStatus).mockRejectedValueOnce(new Error('search status offline'))
    await expect(store.refreshKnowledgeSearchStatus()).resolves.toBe(false)
    expect(store.kbSearchStatus).toEqual(backendStatus)

    const originalAiops = {
      kbSearch: window.aiops.kbSearch,
      kbSearchStatus: window.aiops.kbSearchStatus,
      kbReindex: window.aiops.kbReindex
    }

    try {
      ;(window.aiops as any).kbSearchStatus = undefined
      await expect(store.refreshKnowledgeSearchStatus()).resolves.toBe(false)
      expect(store.kbSearchStatus).toEqual(backendStatus)

      ;(window.aiops as any).kbSearch = undefined
      await expect(store.searchKnowledgeContent('deploy')).resolves.toEqual([])
      expect(store.kbContentSearchResults).toEqual([])
      expect(store.kbSearchError).toBe('知识库搜索服务不可用')

      ;(window.aiops as any).kbReindex = undefined
      await expect(store.reindexKnowledgeContent()).resolves.toBeNull()
      expect(store.topNotice).toBe('知识库索引服务不可用')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('loads AI model options from the backend bridge instead of renderer mock defaults', async () => {
    const store = useWorkspaceStore()

    expect(store.aiModelOptions).toEqual([])
    expect(store.lockedAiModelOptions).toEqual([])
    expect(store.settingModelOptions).toEqual([])
    expect(store.terminalCommandModelOptions).toEqual([])

    await store.refreshAiModelCatalog()

    expect(window.aiops.listAiModels).toHaveBeenCalled()
    expect(store.aiModelOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'aiopsterm-local-agent', label: 'aiopsterm-local-agent' }),
        expect.objectContaining({ id: 'ops-model', apiProvider: 'openai' })
      ])
    )
    expect(store.lockedAiModelOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gpt-5-pro', locked: true, tier: 'VIP' })])
    )
    expect(store.settingModelOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'aiopsterm-local-agent', locked: false, checked: true }),
        expect.objectContaining({ name: 'custom-maintenance', type: 'custom', apiProvider: 'openai' })
      ])
    )
    expect(store.terminalCommandModelOptions).toContain('aiopsterm-local-agent')
    expect(store.terminalCommandModelOptions).not.toContain('gpt-5-Thinking')
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('loads AI @ context candidates from the backend bridge instead of renderer mock defaults', async () => {
    const store = useWorkspaceStore()

    expect(store.aiContextCatalog.categories).toEqual([])
    expect(store.selectedContexts).toEqual([])

    await store.refreshAiContextCatalog()

    expect(window.aiops.listAiContextCatalog).toHaveBeenCalled()
    expect(store.aiContextCatalog.openedHosts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'opened-local', label: '127.0.0.1' }),
        expect.objectContaining({ id: 'asset-1', label: '10.24.8.12' })
      ])
    )
    expect(store.aiContextCatalog.categories.find((category) => category.id === 'hosts')?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'asset-3', label: '10.32.6.9' })])
    )
    expect(store.aiContextCatalog.categories.find((category) => category.id === 'chats')?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'chat:conv-2', label: 'K8s 发布失败' })])
    )
    expect(store.selectedContexts.map((context) => context.id)).toEqual(['opened-local', 'asset-1'])

    store.selectedContexts = [{ id: 'manual-host', kind: 'hosts', label: '10.0.0.9', detail: 'manual selection' }]
    await store.refreshAiContextCatalog()
    expect(store.selectedContexts.map((context) => context.id)).toEqual(['manual-host'])
  })

  it('loads AI todos from the backend bridge instead of renderer mock defaults', async () => {
    const store = useWorkspaceStore()

    expect(store.todoItems).toEqual([])
    expect(store.todoProgress).toEqual({ total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 })

    await expect(store.refreshAiTodoSnapshot()).resolves.toBe(true)

    expect(window.aiops.listAiTodoSnapshot).toHaveBeenCalled()
    expect(store.todoItems.map((todo) => todo.content)).toEqual(['收集上下文', '生成命令建议', '等待确认'])
    expect(store.todoItems.find((todo) => todo.isFocused)).toMatchObject({
      id: 'todo-2',
      status: 'in_progress',
      description: '只生成需要确认的只读命令'
    })
    expect(store.todoProgress).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1, percent: 33 })
  })

  it('does not fabricate AI todos when the backend bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    const originalListAiTodoSnapshot = window.aiops.listAiTodoSnapshot

    try {
      ;(window.aiops as any).listAiTodoSnapshot = undefined
      await expect(store.refreshAiTodoSnapshot()).resolves.toBe(false)
      expect(store.todoItems).toEqual([])
      expect(store.todoProgress).toEqual({ total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 })

      ;(window.aiops as any).listAiTodoSnapshot = vi.fn(async () => ({
        ok: false,
        errorCode: 'AI_TODO_SNAPSHOT_ERROR',
        errorMessage: 'Todo backend unavailable.'
      }))
      await expect(store.refreshAiTodoSnapshot()).resolves.toBe(false)
      expect(store.todoItems).toEqual([])
      expect(store.todoProgress).toEqual({ total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 })
    } finally {
      ;(window.aiops as any).listAiTodoSnapshot = originalListAiTodoSnapshot
    }
  })

  it('persists External reference-style knowledge base create, rename, paste, delete, and import completion state', async () => {
    const store = useWorkspaceStore()

    const folder = await store.createKnowledgeNode('dir', '', 'Runbooks')
    expect(folder?.relPath).toBe('Runbooks')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBase: expect.objectContaining({
          tree: expect.arrayContaining([expect.objectContaining({ relPath: 'Runbooks', type: 'dir' })])
        })
      })
    )
    const knowledgeBytesAfterFolder = store.kbUsedBytes

    const file = (await store.createKnowledgeNode('file', 'Runbooks', 'Deploy.md'))!
    expect(store.findKnowledgeNode('Runbooks/Deploy.md')).toBeTruthy()
    expect(store.kbUsedBytes).toBeGreaterThan(knowledgeBytesAfterFolder)

    await store.renameKnowledgeNode(file.relPath, 'Deploy-v2.md')
    expect(store.findKnowledgeNode('Runbooks/Deploy.md')).toBeNull()
    expect(store.findKnowledgeNode('Runbooks/Deploy-v2.md')).toBeTruthy()
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBase: expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({
              relPath: 'Runbooks',
              children: expect.arrayContaining([expect.objectContaining({ relPath: 'Runbooks/Deploy-v2.md' })])
            })
          ])
        })
      })
    )

    store.copyKnowledgeNodes(['Runbooks/Deploy-v2.md'], 'copy')
    await store.pasteKnowledgeNodes('commands')
    expect(store.findKnowledgeNode('commands/Deploy-v2.md')).toBeTruthy()

    store.copyKnowledgeNodes(['commands/Deploy-v2.md'], 'cut')
    await store.pasteKnowledgeNodes('')
    expect(store.findKnowledgeNode('commands/Deploy-v2.md')).toBeNull()
    expect(store.findKnowledgeNode('Deploy-v2.md')).toBeTruthy()

    await store.deleteKnowledgeNodes(['Deploy-v2.md'])
    expect(store.findKnowledgeNode('Deploy-v2.md')).toBeNull()

    await expect(store.addKnowledgeImportJob('Runbooks/fake-import.md')).resolves.toBe(false)
    expect(store.findKnowledgeNode('Runbooks/fake-import.md')).toBeNull()
    expect(store.kbImportJobs).toEqual([])
    expect(store.topNotice).toBe('知识库导入需要真实本地路径')

    await expect(store.addKnowledgeImportJob('Runbooks/imported-note.md', '/tmp/imported-note.md', 'file')).resolves.toBe(true)
    expect(window.aiops.kbImportFile).toHaveBeenCalledWith('/tmp/imported-note.md', 'Runbooks')
    expect(store.findKnowledgeNode('Runbooks/imported-note.md')).toBeTruthy()
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBase: expect.objectContaining({
          tree: expect.arrayContaining([
            expect.objectContaining({
              relPath: 'Runbooks',
              children: expect.arrayContaining([expect.objectContaining({ relPath: 'Runbooks/imported-note.md' })])
            })
          ])
        })
      })
    )
  })

  it('opens External reference-style knowledge editor panels and synchronizes rename, delete, and cut moves', async () => {
    const store = useWorkspaceStore()
    await store.refreshKnowledgeTree({ persist: false })

    const opened = store.openKnowledgeFile('Markdown语法指南.md')
    expect(opened).toEqual(
      expect.objectContaining({
        id: 'kb:Markdown语法指南.md',
        title: 'Markdown语法指南.md',
        kind: 'knowledge',
        knowledge: { relPath: 'Markdown语法指南.md', isImage: false }
      })
    )
    expect(store.activePanelId).toBe('kb:Markdown语法指南.md')
    expect(store.kbSelectedKeys).toEqual(['Markdown语法指南.md'])

    const reopened = store.openKnowledgeFile('Markdown语法指南.md')
    expect(reopened?.id).toBe(opened?.id)
    expect(store.panels.filter((panel) => panel.kind === 'knowledge')).toHaveLength(1)

    const imagePanel = store.openKnowledgeFile('images/interface.png')
    expect(imagePanel?.knowledge).toEqual({ relPath: 'images/interface.png', isImage: true })

    await store.renameKnowledgeNode('Markdown语法指南.md', 'Markdown-v2.md')
    expect(store.panels.some((panel) => panel.id === 'kb:Markdown语法指南.md')).toBe(false)
    expect(store.panels.find((panel) => panel.id === 'kb:Markdown-v2.md')).toEqual(
      expect.objectContaining({
        title: 'Markdown-v2.md',
        cwd: '@knowledgebase',
        knowledge: { relPath: 'Markdown-v2.md', isImage: false }
      })
    )

    await store.deleteKnowledgeNodes(['images'])
    expect(store.panels.some((panel) => panel.knowledge?.relPath === 'images/interface.png')).toBe(false)

    store.openKnowledgeFile('commands/Summary to Doc.md')
    store.copyKnowledgeNodes(['commands/Summary to Doc.md'], 'cut')
    await store.pasteKnowledgeNodes('')
    expect(store.panels.some((panel) => panel.knowledge?.relPath === 'commands/Summary to Doc.md')).toBe(false)
    expect(store.findKnowledgeNode('Summary to Doc.md')).toBeTruthy()
  })

  it('does not fabricate knowledge CRUD or message-summary results when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.refreshKnowledgeTree({ persist: false })
    store.openKnowledgeFile('Markdown语法指南.md')
    store.copyKnowledgeNodes(['commands/Summary to Doc.md'], 'copy')
    store.chatMessages.push({
      id: 'assistant-no-kb-bridge',
      role: 'assistant',
      text: 'Persist this only through the knowledge bridge.',
      state: 'done'
    })

    const originalTree = JSON.stringify(store.knowledgeTree)
    const originalPanels = store.panels.map((panel) => panel.id)
    const originalAiops = {
      kbCreateFile: window.aiops.kbCreateFile,
      kbMkdir: window.aiops.kbMkdir,
      kbRename: window.aiops.kbRename,
      kbDelete: window.aiops.kbDelete,
      kbCopy: window.aiops.kbCopy,
      kbMove: window.aiops.kbMove,
      kbWriteFile: window.aiops.kbWriteFile
    }

    try {
      ;(window.aiops as any).kbCreateFile = undefined
      ;(window.aiops as any).kbMkdir = undefined
      expect(await store.createKnowledgeNode('file', '', 'NoBridge.md')).toBeNull()
      expect(store.findKnowledgeNode('NoBridge.md')).toBeNull()
      expect(store.topNotice).toBe('知识库写入服务不可用')

      ;(window.aiops as any).kbRename = undefined
      await store.renameKnowledgeNode('Markdown语法指南.md', 'Markdown-local-fake.md')
      expect(store.findKnowledgeNode('Markdown语法指南.md')).toBeTruthy()
      expect(store.findKnowledgeNode('Markdown-local-fake.md')).toBeNull()
      expect(store.panels.map((panel) => panel.id)).toEqual(originalPanels)
      expect(store.topNotice).toBe('知识库重命名服务不可用')

      ;(window.aiops as any).kbDelete = undefined
      await store.deleteKnowledgeNodes(['Markdown语法指南.md'])
      expect(store.findKnowledgeNode('Markdown语法指南.md')).toBeTruthy()
      expect(store.panels.map((panel) => panel.id)).toEqual(originalPanels)
      expect(store.topNotice).toBe('知识库删除服务不可用')

      ;(window.aiops as any).kbCopy = undefined
      ;(window.aiops as any).kbMove = undefined
      await store.pasteKnowledgeNodes('')
      expect(store.findKnowledgeNode('Summary to Doc.md')).toBeNull()
      expect(store.findKnowledgeNode('commands/Summary to Doc.md')).toBeTruthy()
      expect(store.topNotice).toBe('知识库复制移动服务不可用')

      ;(window.aiops as any).kbWriteFile = undefined
      expect(await store.summarizeMessageToKnowledge('assistant-no-kb-bridge')).toBeNull()
      expect(store.findKnowledgeNode('summary')).toBeNull()
      expect(store.findKnowledgeNode('summary/ai-message-assistant-no-kb-bridge.md')).toBeNull()
      expect(store.panels.map((panel) => panel.id)).toEqual(originalPanels)
      expect(store.topNotice).toBe('知识库写入服务不可用')
      expect(JSON.stringify(store.knowledgeTree)).toBe(originalTree)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('requires backend-returned Knowledge relPath before applying create or rename results', async () => {
    const store = useWorkspaceStore()
    await store.refreshKnowledgeTree({ persist: false })
    store.openKnowledgeFile('Markdown语法指南.md')
    const originalKbCreateFile = window.aiops.kbCreateFile
    const originalKbRename = window.aiops.kbRename
    const originalSelectedKeys = [...store.kbSelectedKeys]
    const originalPanelIds = store.panels.map((panel) => panel.id)

    try {
      vi.mocked(window.aiops.kbCreateFile).mockResolvedValueOnce({} as Awaited<ReturnType<typeof window.aiops.kbCreateFile>>)
      const created = await store.createKnowledgeNode('file', '', 'NoRelPath.md')
      expect(created).toBeNull()
      expect(store.topNotice).toBe('知识库写入服务不可用')
      expect(store.kbSelectedKeys).toEqual(originalSelectedKeys)
      expect(store.findKnowledgeNode('NoRelPath.md')).toBeNull()

      vi.mocked(window.aiops.kbRename).mockResolvedValueOnce({} as Awaited<ReturnType<typeof window.aiops.kbRename>>)
      await store.renameKnowledgeNode('Markdown语法指南.md', 'Markdown-no-relpath.md')
      expect(store.topNotice).toBe('知识库重命名服务不可用')
      expect(store.kbSelectedKeys).toEqual(originalSelectedKeys)
      expect(store.findKnowledgeNode('Markdown语法指南.md')).toBeTruthy()
      expect(store.findKnowledgeNode('Markdown-no-relpath.md')).toBeNull()
      expect(store.panels.map((panel) => panel.id)).toEqual(originalPanelIds)
    } finally {
      window.aiops.kbCreateFile = originalKbCreateFile
      window.aiops.kbRename = originalKbRename
    }
  })

  it('requires a backend-returned Knowledge relPath before writing AI message summaries', async () => {
    const store = useWorkspaceStore()
    await store.refreshKnowledgeTree({ persist: false })
    store.chatMessages.push({
      id: 'assistant-empty-kb-relpath',
      role: 'assistant',
      text: 'Persist this only if the backend returns the created file path.',
      state: 'done'
    })
    const originalKbCreateFile = window.aiops.kbCreateFile

    try {
      vi.mocked(window.aiops.kbCreateFile).mockResolvedValueOnce({} as Awaited<ReturnType<typeof window.aiops.kbCreateFile>>)
      vi.mocked(window.aiops.kbWriteFile).mockClear()
      const result = await store.summarizeMessageToKnowledge('assistant-empty-kb-relpath')

      expect(result).toBeNull()
      expect(store.topNotice).toBe('知识库写入服务不可用')
      expect(window.aiops.kbWriteFile).not.toHaveBeenCalled()
      expect(store.findKnowledgeNode('summary/ai-message-assistant-empty-kb-relpath.md')).toBeNull()
      expect(store.activePanel.kind).not.toBe('knowledge')
    } finally {
      window.aiops.kbCreateFile = originalKbCreateFile
    }
  })

  it('adds External reference-style knowledge docs and images to AI context and includes them in chat payloads', async () => {
    const store = useWorkspaceStore()
    await store.refreshKnowledgeTree({ persist: false })

    await store.addKnowledgeFilesToChat(['Markdown语法指南.md', 'images/interface.png'])

    const docContext = store.selectedContexts.find((context) => context.id === 'kb-doc:Markdown语法指南.md')
    expect(docContext).toEqual(
      expect.objectContaining({
        kind: 'docs',
        label: 'Markdown语法指南.md',
        relPath: 'Markdown语法指南.md'
      })
    )
    const imageContext = store.selectedContexts.find((context) => context.id === 'kb-image:images/interface.png')
    expect(imageContext).toEqual(
      expect.objectContaining({
        kind: 'images',
        label: 'interface.png',
        relPath: 'images/interface.png',
        mediaType: 'application/octet-stream',
        data: Buffer.from('images/interface.png').toString('base64')
      })
    )
    expect(window.aiops.kbReadFile).toHaveBeenCalledWith('images/interface.png', 'base64')
    expect(store.rightPanelOpen).toBe(true)

    await store.addKnowledgeFilesToChat(['Markdown语法指南.md', 'images/interface.png'])
    expect(store.selectedContexts.filter((context) => context.id === 'kb-doc:Markdown语法指南.md')).toHaveLength(1)
    expect(store.selectedContexts.filter((context) => context.id === 'kb-image:images/interface.png')).toHaveLength(1)

    await store.sendChat('生成知识库摘要')
    const userMessage = store.chatMessages.at(-2)
    expect(userMessage?.role).toBe('user')
    expect(userMessage?.text).toContain('Knowledge Context:')
    expect(userMessage?.text).toContain('- doc: Markdown语法指南.md (Markdown语法指南.md)')
    expect(userMessage?.text).toContain('- image: interface.png (images/interface.png, application/octet-stream)')
  })

  it('preserves ai rich input parts on user messages', async () => {
    const store = useWorkspaceStore()
    const docContext = { id: 'doc-linux', kind: 'docs' as const, label: 'Linux 巡检手册', relPath: 'Runbooks/Linux.md' }
    store.toggleContext(docContext)
    store.selectCommandPreset('rollback')
    const imagePart = {
      type: 'image' as const,
      mediaType: 'image/png' as const,
      data: Buffer.from('png').toString('base64'),
      name: 'screenshot.png'
    }

    await store.sendChat('检查回滚计划', [
      {
        type: 'chip',
        chipType: 'doc',
        ref: { absPath: 'Runbooks/Linux.md', relPath: 'Runbooks/Linux.md', name: 'Linux 巡检手册', type: 'file' }
      },
      { type: 'text', text: '检查回滚计划' },
      imagePart,
      { type: 'chip', chipType: 'command', ref: { command: '/rollback-plan', label: '/rollback-plan' } }
    ])

    const userMessage = store.chatMessages.at(-2)
    expect(userMessage?.role).toBe('user')
    expect(userMessage?.contentParts).toEqual([
      {
        type: 'chip',
        chipType: 'doc',
        ref: { absPath: 'Runbooks/Linux.md', relPath: 'Runbooks/Linux.md', name: 'Linux 巡检手册', type: 'file' }
      },
      { type: 'text', text: '检查回滚计划' },
      imagePart,
      { type: 'chip', chipType: 'command', ref: { command: '/rollback-plan', label: '/rollback-plan' } }
    ])
    expect(userMessage?.text).toContain('检查回滚计划')
    expect(userMessage?.text).toContain('上下文：')
    expect(userMessage?.text).toContain('命令：rollback')

    store.selectCommandPreset('commands/rollback-plan.md', {
      command: '/rollback-plan',
      label: '/rollback-plan',
      path: 'commands/rollback-plan.md'
    })
    await store.sendChat('按知识库命令执行')
    expect(store.chatMessages.at(-2)?.text).toContain('命令：/rollback-plan')
  })

  it('truncates a user message and resends edited ai content parts', async () => {
    const store = useWorkspaceStore()
    await store.sendChat('旧消息', [{ type: 'text', text: '旧消息' }])
    const originalUserId = store.chatMessages.at(-2)?.id
    expect(originalUserId).toBeTruthy()
    expect(store.chatMessages.at(-1)?.role).toBe('assistant')

    const editedParts = [
      { type: 'text' as const, text: '新消息' },
      { type: 'chip' as const, chipType: 'command' as const, ref: { command: '/rollback-plan', label: '/rollback-plan' } }
    ]
    const sent = await store.resendUserMessageFromParts(originalUserId!, editedParts)

    expect(sent).toBe(true)
    expect(store.chatMessages).toHaveLength(2)
    expect(store.chatMessages.find((message) => message.id === originalUserId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.role).toBe('user')
    expect(store.chatMessages.at(-2)?.contentParts).toEqual(editedParts)
    expect(store.chatMessages.at(-2)?.text).toContain('新消息/rollback-plan')
    expect(store.chatMessages.at(-1)?.role).toBe('assistant')
  })

  it('truncates and resends with edited host context without mutating selected contexts', async () => {
    const store = useWorkspaceStore()
    const originalSelectedContextIds = store.selectedContexts.map((context) => context.id)
    await store.sendChat('旧主机检查', [{ type: 'text', text: '旧主机检查' }])
    const originalUserId = store.chatMessages.at(-2)?.id
    expect(store.chatMessages.at(-2)?.hosts?.map((context) => context.id)).toEqual(originalSelectedContextIds)

    const editedHosts = [{ id: 'asset-3', kind: 'hosts' as const, label: '10.32.6.9', detail: 'mysql-primary' }]
    const sent = await store.resendUserMessageFromParts(originalUserId!, [{ type: 'text', text: '改查 MySQL 主机' }], editedHosts)

    expect(sent).toBe(true)
    expect(store.selectedContexts.map((context) => context.id)).toEqual(originalSelectedContextIds)
    expect(store.chatMessages.find((message) => message.id === originalUserId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.hosts).toEqual(editedHosts)
    expect(store.chatMessages.at(-2)?.text).toContain('hosts:10.32.6.9')
  })

  it('manages External reference-style extension plugin state and alias validation', async () => {
    const store = useWorkspaceStore()

    await store.refreshExtensionPlugins()

    const jumpserver = store.extensionPlugins.find((plugin) => plugin.pluginId === 'jumpserverSupport')
    expect(jumpserver?.detailSummary).toContain('资产同步')
    expect(jumpserver?.guideSteps).toEqual(expect.arrayContaining(['同步资产并确认主机分组。']))
    expect(jumpserver?.connectionLog).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'success', message: 'connected to bastion host' })])
    )

    expect(store.filteredExtensionPlugins[0].name).toBe('Alias')
    await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(true)
    expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(false)
    await expect(store.updateExtensionSettings({ aliasStatus: true })).resolves.toBe(true)
    expect(store.filteredExtensionPlugins[0].name).toBe('Alias')

    const installPromise = store.installExtensionPlugin('cloud-assets')
    expect(store.extensionInstallLoadingMap['cloud-assets']).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    await installPromise
    expect(window.aiops.installExtensionPlugin).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ pluginId: 'cloud-assets', installed: false, latestVersion: '0.9.1' })
    })
    expect(store.extensionPlugins.find((plugin) => plugin.pluginId === 'cloud-assets')?.installed).toBe(true)

    const updatePromise = store.updateExtensionPlugin('ops-runbook')
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    await updatePromise
    expect(window.aiops.updateExtensionPlugin).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ pluginId: 'ops-runbook', installed: true, hasUpdate: true })
    })
    expect(store.extensionPlugins.find((plugin) => plugin.pluginId === 'ops-runbook')?.hasUpdate).toBe(false)

    await store.subscribeExtensionPlugin('private-automation-pack')
    expect(window.aiops.openExtensionSubscription).toHaveBeenCalledWith({
      plugin: expect.objectContaining({
        pluginId: 'private-automation-pack',
        installed: false,
        installable: false,
        isPrivate: true
      })
    })
    expect(store.extensionNotice).toContain('订阅')

    await expect(store.dropExtensionPackage('bad.zip')).resolves.toBe(false)
    expect(store.extensionNotice).toContain('.external-reference')
    const dropPromise = store.dropExtensionPackage('local-pack.external-reference')
    expect(store.extensionInstallingPackageName).toBe('local pack')
    await vi.runOnlyPendingTimersAsync()
    await expect(dropPromise).resolves.toBe(true)
    expect(window.aiops.installExtensionPackage).toHaveBeenCalledWith({
      fileName: 'local-pack.external-reference',
      filePath: '',
      size: undefined,
      existingPluginIds: expect.arrayContaining(['cloud-assets', 'ops-runbook'])
    })
    expect(store.selectedExtensionId).toContain('local-local-pack')

    store.createAliasCommand()
    store.updateAliasDraft('new', { alias: 'll', command: 'ls' })
    expect((await store.saveAliasCommand('new')).reason).toBe('duplicate')
    store.updateAliasDraft('new', { alias: 'hosts', command: 'cat /etc/hosts' })
    expect((await store.saveAliasCommand('new')).ok).toBe(true)
    expect(window.aiops.saveAliasCommand).toHaveBeenCalledWith({
      id: undefined,
      previousAlias: undefined,
      alias: 'hosts',
      command: 'cat /etc/hosts',
      createdAt: undefined
    })
    expect(store.aliasCommands.some((alias) => alias.alias === 'hosts')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'hosts', command: 'cat /etc/hosts' })])
      })
    )

    const hosts = store.aliasCommands.find((alias) => alias.alias === 'hosts')!
    store.startAliasEdit(hosts.id)
    store.updateAliasDraft(hosts.id, { alias: 'hostsfile', command: 'cat /etc/hosts | head' })
    expect((await store.saveAliasCommand(hosts.id)).ok).toBe(true)
    expect(window.aiops.saveAliasCommand).toHaveBeenCalledWith({
      id: hosts.id,
      previousAlias: 'hosts',
      alias: 'hostsfile',
      command: 'cat /etc/hosts | head',
      createdAt: expect.any(Number)
    })
    expect(store.aliasCommands.some((alias) => alias.alias === 'hostsfile' && alias.command === 'cat /etc/hosts | head')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'hostsfile', command: 'cat /etc/hosts | head' })])
      })
    )

    expect((await store.deleteAliasCommand(hosts.id)).ok).toBe(true)
    expect(window.aiops.deleteAliasCommand).toHaveBeenCalledWith({ id: hosts.id, alias: 'hostsfile' })
    expect(store.aliasCommands.some((alias) => alias.alias === 'hostsfile')).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.not.arrayContaining([expect.objectContaining({ alias: 'hostsfile' })])
      })
    )
  })

  it('does not fabricate extension plugin writes when bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshExtensionPlugins()

    const originalAiops = {
      listExtensionPlugins: window.aiops.listExtensionPlugins,
      installExtensionPlugin: window.aiops.installExtensionPlugin,
      updateExtensionPlugin: window.aiops.updateExtensionPlugin,
      installExtensionPackage: window.aiops.installExtensionPackage,
      uninstallExtensionPlugin: window.aiops.uninstallExtensionPlugin,
      openExtensionSubscription: window.aiops.openExtensionSubscription,
      cancelExtensionInstall: window.aiops.cancelExtensionInstall
    }
    const catalogSnapshot = () => JSON.stringify(store.extensionPlugins)
    const initialCatalogSnapshot = catalogSnapshot()
    const plugin = (pluginId: string) => store.extensionPlugins.find((item) => item.pluginId === pluginId)
    const expectCatalogUnchanged = () => expect(catalogSnapshot()).toBe(initialCatalogSnapshot)

    const cancelPendingUpdate = async (pendingUpdate: Promise<void>) => {
      ;(window.aiops as any).cancelExtensionInstall = originalAiops.cancelExtensionInstall
      await store.cancelExtensionInstall('ops-runbook')
      await vi.runOnlyPendingTimersAsync()
      await pendingUpdate
      expect(plugin('ops-runbook')?.hasUpdate).toBe(true)
      expect(store.extensionInstallLoadingMap['ops-runbook']).toBeUndefined()
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
      expectCatalogUnchanged()
    }

    try {
      ;(window.aiops as any).listExtensionPlugins = undefined
      await expect(store.refreshExtensionPlugins()).resolves.toBe(false)
      expect(store.extensionNotice).toBe('插件列表加载服务不可用')
      expectCatalogUnchanged()

      ;(window.aiops as any).listExtensionPlugins = originalAiops.listExtensionPlugins
      vi.mocked(window.aiops.listExtensionPlugins!).mockRejectedValueOnce(new Error('extension list offline'))
      await expect(store.refreshExtensionPlugins()).resolves.toBe(false)
      expect(store.extensionNotice).toBe('extension list offline')
      expectCatalogUnchanged()

      vi.mocked(window.aiops.listExtensionPlugins!).mockResolvedValueOnce({ ok: false, errorMessage: 'extension list rejected' } as any)
      await expect(store.refreshExtensionPlugins()).resolves.toBe(false)
      expect(store.extensionNotice).toBe('extension list rejected')
      expectCatalogUnchanged()

      ;(window.aiops as any).installExtensionPlugin = undefined
      await store.installExtensionPlugin('cloud-assets')
      expect(store.extensionNotice).toBe('Cloud Assets 安装服务不可用')
      expect(plugin('cloud-assets')?.installed).toBe(false)
      expect(store.extensionInstallLoadingMap['cloud-assets']).toBeUndefined()
      expect(store.extensionInstallProgressMap['cloud-assets']).toBeUndefined()
      expectCatalogUnchanged()

      ;(window.aiops as any).installExtensionPlugin = originalAiops.installExtensionPlugin
      vi.mocked(window.aiops.installExtensionPlugin!).mockRejectedValueOnce(new Error('install offline'))
      await store.installExtensionPlugin('cloud-assets')
      expect(store.extensionNotice).toBe('install offline')
      expect(plugin('cloud-assets')?.installed).toBe(false)
      expect(store.extensionInstallLoadingMap['cloud-assets']).toBeUndefined()
      expect(store.extensionInstallProgressMap['cloud-assets']?.stage).toBe('error')
      expectCatalogUnchanged()

      vi.mocked(window.aiops.installExtensionPlugin!).mockResolvedValueOnce({ ok: false, errorMessage: 'install rejected by backend' } as any)
      await store.installExtensionPlugin('cloud-assets')
      expect(store.extensionNotice).toBe('install rejected by backend')
      expect(plugin('cloud-assets')?.installed).toBe(false)
      expect(store.extensionInstallLoadingMap['cloud-assets']).toBeUndefined()
      expect(store.extensionInstallProgressMap['cloud-assets']?.stage).toBe('error')
      expectCatalogUnchanged()

      ;(window.aiops as any).updateExtensionPlugin = undefined
      await store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionNotice).toBe('Ops Runbook 更新服务不可用')
      expect(plugin('ops-runbook')?.hasUpdate).toBe(true)
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
      expect(store.extensionInstallProgressMap['ops-runbook']).toBeUndefined()
      expectCatalogUnchanged()

      ;(window.aiops as any).updateExtensionPlugin = originalAiops.updateExtensionPlugin
      vi.mocked(window.aiops.updateExtensionPlugin!).mockRejectedValueOnce(new Error('update offline'))
      await store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionNotice).toBe('update offline')
      expect(plugin('ops-runbook')?.hasUpdate).toBe(true)
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
      expect(store.extensionInstallProgressMap['ops-runbook']?.stage).toBe('error')
      expectCatalogUnchanged()

      vi.mocked(window.aiops.updateExtensionPlugin!).mockResolvedValueOnce({ ok: false, errorMessage: 'update rejected by backend' } as any)
      await store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionNotice).toBe('update rejected by backend')
      expect(plugin('ops-runbook')?.hasUpdate).toBe(true)
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBeUndefined()
      expect(store.extensionInstallProgressMap['ops-runbook']?.stage).toBe('error')
      expectCatalogUnchanged()

      ;(window.aiops as any).uninstallExtensionPlugin = undefined
      await store.uninstallExtensionPlugin('local-shell-tools')
      expect(store.extensionNotice).toBe('Local Shell Tools 卸载服务不可用')
      expect(plugin('local-shell-tools')?.installed).toBe(true)
      expectCatalogUnchanged()

      ;(window.aiops as any).uninstallExtensionPlugin = originalAiops.uninstallExtensionPlugin
      vi.mocked(window.aiops.uninstallExtensionPlugin!).mockRejectedValueOnce(new Error('uninstall offline'))
      await store.uninstallExtensionPlugin('local-shell-tools')
      expect(store.extensionNotice).toBe('uninstall offline')
      expect(plugin('local-shell-tools')?.installed).toBe(true)
      expectCatalogUnchanged()

      vi.mocked(window.aiops.uninstallExtensionPlugin!).mockResolvedValueOnce({ ok: false, errorMessage: 'uninstall rejected by backend' } as any)
      await store.uninstallExtensionPlugin('local-shell-tools')
      expect(store.extensionNotice).toBe('uninstall rejected by backend')
      expect(plugin('local-shell-tools')?.installed).toBe(true)
      expectCatalogUnchanged()

      ;(window.aiops as any).openExtensionSubscription = undefined
      await store.subscribeExtensionPlugin('private-automation-pack')
      expect(store.extensionNotice).toBe('Private Automation Pack 订阅服务不可用')
      expectCatalogUnchanged()

      ;(window.aiops as any).openExtensionSubscription = originalAiops.openExtensionSubscription
      vi.mocked(window.aiops.openExtensionSubscription!).mockRejectedValueOnce(new Error('subscribe offline'))
      await store.subscribeExtensionPlugin('private-automation-pack')
      expect(store.extensionNotice).toBe('subscribe offline')
      expectCatalogUnchanged()

      vi.mocked(window.aiops.openExtensionSubscription!).mockResolvedValueOnce({ ok: false, errorMessage: 'subscribe rejected by backend' } as any)
      await store.subscribeExtensionPlugin('private-automation-pack')
      expect(store.extensionNotice).toBe('subscribe rejected by backend')
      expectCatalogUnchanged()

      const missingCancelUpdate = store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      ;(window.aiops as any).cancelExtensionInstall = undefined
      await store.cancelExtensionInstall('ops-runbook')
      expect(store.extensionNotice).toBe('Ops Runbook 取消服务不可用')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      await cancelPendingUpdate(missingCancelUpdate)

      const rejectedCancelUpdate = store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      vi.mocked(window.aiops.cancelExtensionInstall!).mockRejectedValueOnce(new Error('cancel offline'))
      await store.cancelExtensionInstall('ops-runbook')
      expect(store.extensionNotice).toBe('cancel offline')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      await cancelPendingUpdate(rejectedCancelUpdate)

      const backendRejectedCancelUpdate = store.updateExtensionPlugin('ops-runbook')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      vi.mocked(window.aiops.cancelExtensionInstall!).mockResolvedValueOnce({ ok: false, errorMessage: 'cancel rejected by backend' } as any)
      await store.cancelExtensionInstall('ops-runbook')
      expect(store.extensionNotice).toBe('cancel rejected by backend')
      expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
      await cancelPendingUpdate(backendRejectedCancelUpdate)

      const selectedBeforePackage = store.selectedExtensionId
      ;(window.aiops as any).installExtensionPackage = undefined
      await expect(store.dropExtensionPackage('client-local.external-reference')).resolves.toBe(false)
      expect(store.extensionNotice).toBe('client local 安装服务不可用')
      expect(store.extensionInstallingPackageName).toBe('')
      expect(store.selectedExtensionId).toBe(selectedBeforePackage)
      expect(plugin('local-client-local')).toBeUndefined()
      expectCatalogUnchanged()

      ;(window.aiops as any).installExtensionPackage = originalAiops.installExtensionPackage
      vi.mocked(window.aiops.installExtensionPackage!).mockRejectedValueOnce(new Error('package offline'))
      await expect(store.dropExtensionPackage('client-local.external-reference')).resolves.toBe(false)
      expect(store.extensionNotice).toBe('package offline')
      expect(store.extensionInstallingPackageName).toBe('')
      expect(store.selectedExtensionId).toBe(selectedBeforePackage)
      expect(plugin('local-client-local')).toBeUndefined()
      expectCatalogUnchanged()

      vi.mocked(window.aiops.installExtensionPackage!).mockResolvedValueOnce({ ok: false, errorMessage: 'package rejected by backend' } as any)
      await expect(store.dropExtensionPackage('client-local.external-reference')).resolves.toBe(false)
      expect(store.extensionNotice).toBe('package rejected by backend')
      expect(store.extensionInstallingPackageName).toBe('')
      expect(store.selectedExtensionId).toBe(selectedBeforePackage)
      expect(plugin('local-client-local')).toBeUndefined()
      expectCatalogUnchanged()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not mutate persisted aliases when required backend operations are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshAliasCommands()
    vi.mocked(window.aiops.saveConfig).mockClear()

    const originalAiops = {
      listAliasCommands: window.aiops.listAliasCommands,
      saveAliasCommand: window.aiops.saveAliasCommand,
      deleteAliasCommand: window.aiops.deleteAliasCommand
    }
    const persistedAliasSnapshot = () => JSON.stringify(store.aliasCommands.filter((alias) => alias.id !== 'new').map(({ edit, ...alias }) => alias))
    const initialSnapshot = persistedAliasSnapshot()

    try {
      ;(window.aiops as any).listAliasCommands = undefined
      await expect(store.refreshAliasCommands()).resolves.toBe(false)
      expect(store.extensionNotice).toBe('Alias 服务不可用')
      expect(persistedAliasSnapshot()).toBe(initialSnapshot)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).listAliasCommands = originalAiops.listAliasCommands
      vi.mocked(window.aiops.listAliasCommands!).mockRejectedValueOnce(new Error('aliases offline'))
      await expect(store.refreshAliasCommands()).resolves.toBe(false)
      expect(store.extensionNotice).toBe('aliases offline')
      expect(persistedAliasSnapshot()).toBe(initialSnapshot)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      store.createAliasCommand()
      store.updateAliasDraft('new', { alias: 'no-bridge-alias', command: 'echo no bridge' })

      ;(window.aiops as any).saveAliasCommand = undefined
      await expect(store.saveAliasCommand('new')).resolves.toEqual({ ok: false, reason: 'backend' })
      expect(store.extensionNotice).toBe('Alias 保存服务不可用')
      expect(persistedAliasSnapshot()).toBe(initialSnapshot)
      expect(store.aliasCommands.some((alias) => alias.id !== 'new' && alias.alias === 'no-bridge-alias')).toBe(false)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).saveAliasCommand = originalAiops.saveAliasCommand
      vi.mocked(window.aiops.saveAliasCommand!).mockRejectedValueOnce(new Error('alias write failed'))
      await expect(store.saveAliasCommand('new')).resolves.toEqual({ ok: false, reason: 'backend' })
      expect(store.extensionNotice).toBe('alias write failed')
      expect(persistedAliasSnapshot()).toBe(initialSnapshot)
      expect(store.aliasCommands.some((alias) => alias.id !== 'new' && alias.alias === 'no-bridge-alias')).toBe(false)

      store.updateAliasDraft('new', { alias: 'bridge-alias', command: 'echo bridge' })
      await expect(store.saveAliasCommand('new')).resolves.toEqual({ ok: true, reason: 'saved' })
      const bridgeAlias = store.aliasCommands.find((alias) => alias.alias === 'bridge-alias')!
      expect(bridgeAlias).toBeTruthy()
      const afterSavedSnapshot = persistedAliasSnapshot()
      vi.mocked(window.aiops.saveConfig).mockClear()

      ;(window.aiops as any).deleteAliasCommand = undefined
      await expect(store.deleteAliasCommand(bridgeAlias.id)).resolves.toEqual({ ok: false, reason: 'backend' })
      expect(store.extensionNotice).toBe('Alias 删除服务不可用')
      expect(persistedAliasSnapshot()).toBe(afterSavedSnapshot)
      expect(store.aliasCommands.some((alias) => alias.alias === 'bridge-alias')).toBe(true)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).deleteAliasCommand = originalAiops.deleteAliasCommand
      vi.mocked(window.aiops.deleteAliasCommand!).mockRejectedValueOnce(new Error('alias delete failed'))
      await expect(store.deleteAliasCommand(bridgeAlias.id)).resolves.toEqual({ ok: false, reason: 'backend' })
      expect(store.extensionNotice).toBe('alias delete failed')
      expect(persistedAliasSnapshot()).toBe(afterSavedSnapshot)
      expect(store.aliasCommands.some((alias) => alias.alias === 'bridge-alias')).toBe(true)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('manages External reference-style Kubernetes contexts, clusters, terminals, and bastion sync', async () => {
    vi.useFakeTimers()
    const store = useWorkspaceStore()
    try {

    await store.refreshKubernetesCatalog()
    await store.switchK8sContext('staging/devops')
    expect(store.k8sContexts.find((context) => context.name === 'staging/devops')?.isActive).toBe(true)

    store.k8sSearchQuery = 'prod'
    store.setK8sActionMenu('k8s-1')
    store.clearK8sSearch()
    expect(store.k8sSearchQuery).toBe('')
    expect(store.k8sClusterActionMenuId).toBeNull()

    store.openK8sProxyConfig()
    expect(store.k8sProxyConfigOpen).toBe(true)
    store.updateK8sProxyConfig({ enabled: true, type: 'HTTPS', host: 'proxy.internal', port: 8443, enableProxyIdentity: true, username: 'ops', password: 'secret' })
    expect(store.k8sProxyConfig).toMatchObject({ enabled: true, type: 'HTTPS', host: 'proxy.internal', port: 8443, username: 'ops' })
    expect(store.saveK8sProxyConfig()).toBe(true)
    expect(store.k8sProxyConfigOpen).toBe(false)

    store.connectK8sCluster('k8s-2')
    expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(280)
    expect(store.k8sActiveClusterId).toBe('k8s-2')
    expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connected')
    expect(store.k8sClusterNotice).toContain('proxy.internal:8443')

    vi.mocked(window.aiops.createKubernetesTerminal).mockClear()
    await store.openK8sTerminal('k8s-2')
    expect(store.k8sActiveTerminal?.clusterId).toBe('k8s-2')
    expect(store.k8sActiveTerminal?.sessionId).toBe('k8s-session-test-1')
    expect(store.k8sActiveTerminal?.status).toBe('connected')
    expect(store.k8sActiveTerminal?.cols).toBe(80)
    expect(store.k8sActiveTerminal?.output).toContain('Connecting to cluster staging-cluster...')
    expect(store.k8sActiveTerminal?.output).toContain('kubectl context: staging/devops')
    expect(store.k8sActiveTerminal?.output).not.toContain(`[session ${store.k8sActiveTerminal?.sessionId}] connected`)
    expect(window.aiops.createKubernetesTerminal).toHaveBeenCalledWith({ clusterId: 'k8s-2', namespace: undefined, cols: undefined, rows: undefined })
    await store.sendK8sTerminalCommand('kubectl get ns')
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl get ns')
    expect(store.k8sActiveTerminal?.output).not.toContain(`[session ${store.k8sActiveTerminal?.sessionId}] connected`)
    expect((store.k8sActiveTerminal?.output.match(/\[staging\]\$ /g) || [])).toHaveLength(1)
    expect(store.k8sActiveTerminal?.commandHistory[0]).toBe('kubectl get ns')
    expect(store.k8sActiveTerminal?.lastCommandOutput).toContain('staging')
    vi.mocked(window.aiops.executeKubernetesCommand).mockResolvedValueOnce({
      ok: true,
      data: {
        runId: 'k8s-run-terminal-output-boundary',
        command: 'kubectl get pods -A',
        output: 'renderer must not format this output',
        terminalOutput: 'BACKEND TERMINAL TEXT\nkubectl output owned by preload/main',
        success: true,
        error: '',
        durationMs: 1,
        startedAt: '刚刚',
        clusterId: 'k8s-2',
        contextName: 'staging/devops',
        namespace: 'staging',
        source: 'terminal'
      }
    })
    await store.sendK8sTerminalCommand('kubectl get pods -A')
    expect(store.k8sActiveTerminal?.output).toContain('BACKEND TERMINAL TEXT\nkubectl output owned by preload/main')
    expect(store.k8sActiveTerminal?.output).not.toContain('[aiopsterm kubectl] kubectl get pods -A\nrenderer must not format this output')
    expect(store.k8sActiveTerminal?.lastCommandOutput).toBe('BACKEND TERMINAL TEXT\nkubectl output owned by preload/main')

    const reusedTerminalId = store.k8sActiveTerminal!.id
    await store.openK8sTerminal('k8s-2')
    expect(store.k8sActiveTerminal?.id).toBe(reusedTerminalId)
    const newTerminal = (await store.createNewK8sTerminalTab('k8s-2'))!
    expect(newTerminal.id).not.toBe(reusedTerminalId)
    expect(newTerminal.name).toContain('staging-cluster-2')
    await expect(store.resizeK8sTerminal(newTerminal.sessionId, 132, 36)).resolves.toBe(true)
    expect(store.k8sActiveTerminal?.cols).toBe(132)
    expect(store.k8sActiveTerminal?.rows).toBe(36)
    expect(window.aiops.resizeKubernetesTerminal).toHaveBeenCalledWith(newTerminal.sessionId, 132, 36)
    await expect(store.executeK8sTerminalAiCommand('kubectl get pods -n staging', newTerminal.id)).resolves.toBe(true)
    expect(store.k8sActiveTerminal?.collectingAiOutput).toBe(false)
    expect(store.chatMessages.at(-2)?.text).toContain('Terminal output')
    expect(store.chatMessages.at(-2)?.hosts?.[0].label).toBe('staging-cluster')
    await expect(store.endK8sTerminalSession(newTerminal.id)).resolves.toBe(true)
    expect(window.aiops.closeKubernetesTerminal).toHaveBeenCalledWith(newTerminal.sessionId, 0)
    expect(store.k8sActiveTerminal?.status).toBe('ended')
    expect(store.k8sActiveTerminal?.output).toContain('[Terminal session ended]')

    store.k8sActiveClusterId = 'k8s-1'
    await store.describeK8sResource('k8s-pod-worker-1')
    expect(store.copyK8sResourceOutput()).toContain('kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    const sentOutputCommand = await store.sendK8sCurrentOutputToTerminal()
    expect(sentOutputCommand).toBe('kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    expect(store.k8sActiveTerminal?.output).toContain('[aiopsterm kubectl] kubectl describe pod billing-worker-7f9d6f9dd9-rx8mm -n ops')
    await expect(store.sendK8sCurrentOutputToAi()).resolves.toBe(true)
    expect(store.chatMessages.at(-2)?.text).toContain('Kubernetes 输出')
    expect(store.chatMessages.at(-2)?.hosts?.[0].label).toBe('prod-cluster')
    store.clearK8sResourceOutput()
    expect(store.k8sResourceOutputTitle).toBe('资源输出')
    expect(store.k8sCopiedCommand).toBe('')

    expect(store.setK8sAgentCluster('k8s-1')).toBe(true)
    expect(store.k8sAgentCurrentCluster).toMatchObject({ clusterId: 'k8s-1', contextName: 'prod/admin' })
    const agentTest = await store.testK8sAgentConnection()
    if (!agentTest) throw new Error('Expected Kubernetes Agent connection test to return a backend run record.')
    expect(agentTest.status).toBe('success')
    expect(agentTest.output).toContain('Server Version')
    await vi.advanceTimersByTimeAsync(160)
    expect(store.k8sAgentTesting).toBe(false)
    const namespaceRun = await store.refreshK8sAgentNamespaces()
    expect(namespaceRun?.command).toBe('kubectl get namespaces')
    expect(store.k8sResourceOutput).toContain('ingress-nginx')
    store.k8sAgentCommandDraft = 'kubectl get services -A'
    const agentRun = await store.runK8sAgentKubectl()
    if (!agentRun) throw new Error('Expected Kubernetes Agent kubectl run to return a backend run record.')
    expect(agentRun.status).toBe('success')
    expect(agentRun.id).toMatch(/^k8s-run-test-/)
    expect(agentRun.id).not.toMatch(/^k8s-agent-run-/)
    expect(agentRun.output).toContain('api-gateway')
    expect(store.k8sAgentCommandHistory[0]).toBe('kubectl get services -A')
    expect(store.k8sAgentRuns[0].contextName).toBe('prod/admin')
    expect(store.k8sAgentRuns[0].durationMs).toBe(1)
    await expect(store.cleanupK8sAgent()).resolves.toBe(true)
    expect(window.aiops.cleanupKubernetesAgent).toHaveBeenCalled()
    expect(store.k8sAgentStatus).toBe('idle')
    expect(store.k8sAgentCurrentCluster.clusterId).toBeNull()
    vi.mocked(window.aiops.executeKubernetesCommand).mockClear()
    const validationRun = await store.testK8sAgentConnection()
    expect(window.aiops.executeKubernetesCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'kubectl version --request-timeout=10s',
        clusterId: '',
        namespace: 'all',
        source: 'agent'
      })
    )
    expect(validationRun).toEqual(
      expect.objectContaining({
        command: 'kubectl version --request-timeout=10s',
        status: 'error',
        error: 'No cluster selected. Please select a cluster first.',
        contextName: 'unknown-context',
        namespace: 'all',
        durationMs: 1
      })
    )
    expect(validationRun?.id).toMatch(/^k8s-run-test-validation-/)
    expect(validationRun?.id).not.toBe('k8s-run-local-validation')
    expect(store.k8sAgentRuns[0].id).not.toBe('k8s-run-local-validation')

    const qaKubeconfigContent = [
      'apiVersion: v1',
      'kind: Config',
      'current-context: qa/dev',
      'clusters:',
      '- name: qa-cluster',
      '  cluster:',
      '    server: https://qa.k8s.local:6443',
      'contexts:',
      '- name: qa/dev',
      '  context:',
      '    cluster: qa-cluster',
      '    namespace: qa'
    ].join('\n')
    const importResult = store.importK8sKubeconfigContent(qaKubeconfigContent)
    expect(importResult.success).toBe(true)
    expect(importResult.currentContext).toBe('qa/dev')
    expect(store.k8sImportContexts).toEqual([
      { name: 'qa/dev', cluster: 'qa-cluster', server: 'https://qa.k8s.local:6443', namespace: 'qa' }
    ])
    expect(await store.testK8sClusterConnection({ contextName: 'qa/dev', serverUrl: 'https://qa.k8s.local:6443', kubeconfigContent: qaKubeconfigContent })).toBe(true)
    expect(window.aiops.testKubernetesClusterConnection).toHaveBeenLastCalledWith({
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      kubeconfigPath: undefined,
      kubeconfigContent: qaKubeconfigContent
    })
    expect(await store.testK8sClusterConnection({ contextName: 'missing/dev', kubeconfigContent: qaKubeconfigContent })).toBe(false)
    vi.mocked(window.aiops.readLocalFile).mockResolvedValueOnce({
      content: [
        'apiVersion: v1',
        'kind: Config',
        'clusters:',
        '- name: imported-cluster',
        '  cluster:',
        '    server: https://imported.k8s.local:6443',
        'contexts:',
        '- name: imported/admin',
        '  context:',
        '    cluster: imported-cluster',
        '    namespace: imported'
      ].join('\n'),
      mtimeMs: 1717200000000,
      size: 512
    })
    const fileImport = await store.importK8sKubeconfigFile('/tmp/imported-kubeconfig.yaml')
    expect(fileImport.success).toBe(true)
    expect(window.aiops.readLocalFile).toHaveBeenCalledWith('/tmp/imported-kubeconfig.yaml')
    expect(store.k8sImportContexts[0]).toMatchObject({ name: 'imported/admin', server: 'https://imported.k8s.local:6443' })

    const added = await store.addK8sCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa'
    })
    expect(added?.id).toMatch(/^k8s-/)
    expect(store.k8sSelectedClusterId).toBe(added?.id)

    await store.updateK8sCluster(added!.id, { name: 'qa-renamed', autoConnect: true })
    expect(store.k8sClusters.find((cluster) => cluster.id === added!.id)?.name).toBe('qa-renamed')
    expect(store.k8sClusters.find((cluster) => cluster.id === added!.id)?.auto_connect).toBe(1)

    const beforeSync = store.k8sClusters.length
    store.syncK8sBastion('org-prod')
    expect(store.k8sSyncingBastionIds).toContain('org-prod')
    await vi.advanceTimersByTimeAsync(320)
    expect(store.k8sClusters.length).toBeGreaterThan(beforeSync)

    await store.deleteK8sCluster(added!.id)
    expect(store.k8sClusters.some((cluster) => cluster.id === added!.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fabricate Kubernetes Agent refresh or cleanup success when backend operations fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshKubernetesCatalog()
    expect(store.setK8sAgentCluster('k8s-1')).toBe(true)
    expect(store.k8sAgentCurrentCluster).toMatchObject({ clusterId: 'k8s-1', contextName: 'prod/admin' })

    vi.mocked(window.aiops.executeKubernetesCommand).mockResolvedValueOnce({
      ok: true,
      data: {
        runId: 'k8s-run-failed-namespaces',
        command: 'kubectl get namespaces',
        output: '',
        terminalOutput: '',
        success: false,
        error: 'apiserver unavailable',
        durationMs: 1,
        startedAt: '刚刚',
        clusterId: 'k8s-1',
        contextName: 'prod/admin',
        namespace: 'default',
        source: 'agent'
      }
    })
    const namespaceRun = await store.refreshK8sAgentNamespaces()
    expect(namespaceRun).toEqual(expect.objectContaining({ id: 'k8s-run-failed-namespaces', status: 'error', error: 'apiserver unavailable' }))
    expect(store.k8sClusterNotice).toBe('apiserver unavailable')
    expect(store.k8sClusterNotice).not.toBe('Kubernetes namespaces 已刷新')

    vi.mocked(window.aiops.executeKubernetesCommand).mockResolvedValueOnce({
      ok: true,
      data: {
        runId: 'k8s-run-failed-resources',
        command: 'kubectl get pods --all-namespaces',
        output: '',
        terminalOutput: '',
        success: false,
        error: 'resource list denied',
        durationMs: 1,
        startedAt: '刚刚',
        clusterId: 'k8s-1',
        contextName: 'prod/admin',
        namespace: 'default',
        source: 'resource'
      }
    })
    const resourceRun = await store.refreshK8sResources()
    expect(resourceRun).toEqual(expect.objectContaining({ id: 'k8s-run-failed-resources', status: 'error', error: 'resource list denied' }))
    expect(store.k8sResourceLoading).toBe(false)
    expect(store.k8sResourceOutput).toContain('resource list denied')
    expect(store.k8sResourceOutput).not.toContain('已刷新')
    expect(store.k8sClusterNotice).toBe('resource list denied')
    expect(store.k8sClusterNotice).not.toBe('Kubernetes 资源已刷新')

    const originalCleanup = window.aiops.cleanupKubernetesAgent
    try {
      ;(window.aiops as any).cleanupKubernetesAgent = undefined
      await expect(store.cleanupK8sAgent()).resolves.toBe(false)
      expect(store.k8sClusterNotice).toBe('Kubernetes Agent cleanup API 不可用')
      expect(store.k8sAgentCurrentCluster.clusterId).toBe('k8s-1')
      expect(store.k8sAgentStatus).toBe('ready')

      ;(window.aiops as any).cleanupKubernetesAgent = originalCleanup
      vi.mocked(window.aiops.cleanupKubernetesAgent!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'K8S_AGENT_CLEANUP_FAILED',
        errorMessage: 'cleanup refused by backend'
      })
      await expect(store.cleanupK8sAgent()).resolves.toBe(false)
      expect(store.k8sClusterNotice).toBe('cleanup refused by backend')
      expect(store.k8sAgentCurrentCluster.clusterId).toBe('k8s-1')
      expect(store.k8sAgentStatus).toBe('ready')

      vi.mocked(window.aiops.cleanupKubernetesAgent!).mockRejectedValueOnce(new Error('cleanup bridge offline'))
      await expect(store.cleanupK8sAgent()).resolves.toBe(false)
      expect(store.k8sClusterNotice).toBe('cleanup bridge offline')
      expect(store.k8sAgentCurrentCluster.clusterId).toBe('k8s-1')
      expect(store.k8sAgentStatus).toBe('ready')
    } finally {
      ;(window.aiops as any).cleanupKubernetesAgent = originalCleanup
    }
  })

  it('does not fabricate custom background uploads when dialog or save bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    const originalShowOpenDialog = window.aiops.showOpenDialog
    const originalSaveCustomBackground = window.aiops.saveCustomBackground
    const originalSaveConfig = window.aiops.saveConfig
    const originalBackground = { ...store.config.background }

    try {
      ;(window.aiops as any).showOpenDialog = undefined
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('自定义背景选择服务不可用')
      expect(window.aiops.saveCustomBackground).not.toHaveBeenCalled()
      expect(store.config.background).toEqual(originalBackground)

      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      vi.mocked(window.aiops.showOpenDialog!).mockClear()
      ;(window.aiops as any).saveCustomBackground = undefined
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('自定义背景保存服务不可用')
      expect(window.aiops.showOpenDialog).not.toHaveBeenCalled()
      expect(store.config.background).toEqual(originalBackground)

      ;(window.aiops as any).saveCustomBackground = originalSaveCustomBackground
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/missing-bg.png'] })
      vi.mocked(window.aiops.saveCustomBackground!).mockRejectedValueOnce(new Error('background save offline'))
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(window.aiops.saveCustomBackground).toHaveBeenCalledWith('/tmp/missing-bg.png')
      expect(store.settingsNotice).toBe('自定义背景保存失败：background save offline')
      expect(store.config.background).toEqual(originalBackground)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/empty-bg.png'] })
      vi.mocked(window.aiops.saveCustomBackground!).mockResolvedValueOnce({
        filePath: '/tmp/aiopsterm/backgrounds/empty-bg.png',
        url: '',
        name: 'empty-bg.png',
        size: 128
      })
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('自定义背景保存失败')
      expect(store.config.background).toEqual(originalBackground)

      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/offline-config-bg.png'] })
      vi.mocked(window.aiops.saveCustomBackground!).mockResolvedValueOnce({
        filePath: '/tmp/aiopsterm/backgrounds/offline-config-bg.png',
        url: 'file:///tmp/aiopsterm/backgrounds/offline-config-bg.png',
        name: 'offline-config-bg.png',
        size: 128
      })
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('背景设置保存服务不可用')
      expect(store.config.background).toEqual(originalBackground)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/malformed-config-bg.png'] })
      vi.mocked(window.aiops.saveCustomBackground!).mockResolvedValueOnce({
        filePath: '/tmp/aiopsterm/backgrounds/malformed-config-bg.png',
        url: 'file:///tmp/aiopsterm/backgrounds/malformed-config-bg.png',
        name: 'malformed-config-bg.png',
        size: 128
      })
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.uploadCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('背景设置保存失败')
      expect(store.config.background).toEqual(originalBackground)
    } finally {
      ;(window.aiops as any).showOpenDialog = originalShowOpenDialog
      ;(window.aiops as any).saveCustomBackground = originalSaveCustomBackground
      ;(window.aiops as any).saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate background setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    const originalSaveConfig = window.aiops.saveConfig
    const originalBackground = { ...store.config.background }
    const assertBackgroundUnchanged = () => {
      expect(store.config.background).toEqual(originalBackground)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.selectBackground('preset', 'star-field')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('背景设置保存服务不可用')
      assertBackgroundUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.selectBackground('preset', 'star-field')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('背景设置保存失败')
      assertBackgroundUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        ...store.config,
        background: originalBackground
      })
      await expect(store.updateBackgroundTuning({ opacity: 0.35 })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('背景设置保存失败')
      assertBackgroundUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('background config offline'))
      await expect(store.selectBackground('preset', 'star-field')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('background config offline')
      assertBackgroundUnchanged()

      await expect(store.selectCustomBackground()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('请先上传自定义背景')
      assertBackgroundUnchanged()

      await expect(store.selectBackground('preset', 'star-field')).resolves.toBe(true)
      expect(store.settingsNotice).toBe('背景设置已保存')
      expect(store.config.background.mode).toBe('preset')
      expect(store.config.background.image).toBe('star-field')
    } finally {
      ;(window.aiops as any).saveConfig = originalSaveConfig
    }
  })

  it('manages External reference-style settings state for general, terminal, model, and AI preferences', async () => {
    const store = useWorkspaceStore()

    store.setActiveSettingsSection('terminal')
    expect(store.activeSettingsSection).toBe('terminal')

    await expect(store.selectBackground('preset', 'star-field')).resolves.toBe(true)
    expect(store.config.background.mode).toBe('preset')
    expect(store.config.background.image).toBe('star-field')
    await expect(store.updateBackgroundTuning({ opacity: 0.35, brightness: 0.8 })).resolves.toBe(true)
    expect(store.config.background.opacity).toBe(0.35)
    expect(store.config.background.brightness).toBe(0.8)
    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/settings-bg.png'] })
    vi.mocked(window.aiops.saveCustomBackground).mockResolvedValueOnce({
      filePath: '/tmp/aiopsterm/backgrounds/settings-bg.png',
      url: 'file:///tmp/aiopsterm/backgrounds/settings-bg.png',
      name: 'settings-bg.png',
      size: 512
    })
    expect(await store.uploadCustomBackground()).toBe(true)
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    expect(window.aiops.saveCustomBackground).toHaveBeenCalledWith('/tmp/settings-bg.png')
    expect(store.config.background).toEqual(
      expect.objectContaining({
        mode: 'custom',
        image: 'file:///tmp/aiopsterm/backgrounds/settings-bg.png',
        lastCustomImage: 'file:///tmp/aiopsterm/backgrounds/settings-bg.png'
      })
    )
    await expect(store.selectBackground('preset', 'dark-grid')).resolves.toBe(true)
    await expect(store.selectCustomBackground()).resolves.toBe(true)
    expect(store.config.background.mode).toBe('custom')
    await expect(store.clearCustomBackground()).resolves.toBe(true)
    expect(store.config.background.lastCustomImage).toBe('')
    expect(store.config.background.mode).toBe('none')

    await expect(store.updateTerminalSettings({ terminalType: 'vt220', cursorStyle: 'underline', showCloseButton: false })).resolves.toBe(true)
    expect(store.terminalSettings.terminalType).toBe('vt220')
    expect(store.terminalSettings.cursorStyle).toBe('underline')
    expect(store.terminalSettings.showCloseButton).toBe(false)
    expect(store.config.terminal?.terminalType).toBe('vt220')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          terminalType: 'vt220',
          cursorStyle: 'underline',
          showCloseButton: false,
          middleMouseEvent: 'paste',
          rightMouseEvent: 'contextMenu'
        })
      })
    )

    store.updateWorkspacePreferences({ showIpMode: true, expandedGroups: ['recent_connections', 'group-生产', 'group-生产'] })
    expect(store.workspacePreferences.showIpMode).toBe(true)
    expect(store.workspacePreferences.expandedGroups).toEqual(['recent_connections', 'group-生产'])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePreferences: {
          showIpMode: true,
          expandedGroups: ['recent_connections', 'group-生产']
        }
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.updateEditorSettings({ fontSize: 18, lineHeight: 24, wordWrap: 'on', minimap: false, mouseWheelZoom: false })).resolves.toBe(true)
    expect(store.editorSettings).toEqual({
      fontSize: 18,
      lineHeight: 24,
      fontFamily: 'cascadia-mono',
      tabSize: 4,
      wordWrap: 'on',
      minimap: false,
      mouseWheelZoom: false
    })
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--editor-line-height')).toBe('24px')
    expect(document.documentElement.style.getPropertyValue('--editor-tab-size')).toBe('4')
    expect(document.documentElement.dataset.editorWordWrap).toBe('on')
    expect(document.documentElement.dataset.editorMinimap).toBe('off')
    expect(document.documentElement.dataset.editorMouseWheelZoom).toBe('off')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        editorSettings: {
          fontSize: 18,
          lineHeight: 24,
          fontFamily: 'cascadia-mono',
          tabSize: 4,
          wordWrap: 'on',
          minimap: false,
          mouseWheelZoom: false
        }
      })
    )
    await expect(store.updateEditorSettings({ tabSize: 6 })).resolves.toBe(true)
    expect(store.editorSettings.tabSize).toBe(6)
    expect(document.documentElement.style.getPropertyValue('--editor-tab-size')).toBe('6')

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.openSshProxyConfig()
    expect(store.sshProxyConfigModalOpen).toBe(true)
    store.openAddSshProxyConfig()
    expect(store.sshProxyAddModalOpen).toBe(true)
    store.updateSshProxyForm({
      name: 'release-proxy',
      type: 'SOCKS5',
      host: '10.0.0.8',
      port: 1080,
      enableProxyIdentity: true,
      username: 'ops',
      password: 'secret'
    })
    await expect(store.saveSshProxyForm()).resolves.toBe(true)
    expect(store.sshProxyAddModalOpen).toBe(false)
    expect(store.sshProxyConfigs).toEqual([
      {
        name: 'release-proxy',
        type: 'SOCKS5',
        host: '10.0.0.8',
        port: 1080,
        enableProxyIdentity: true,
        username: 'ops',
        password: 'secret'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshProxyConfigs: [
          {
            name: 'release-proxy',
            type: 'SOCKS5',
            host: '10.0.0.8',
            port: 1080,
            enableProxyIdentity: true,
            username: 'ops',
            password: 'secret'
          }
        ]
      })
    )
    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.saveSshProxyForm()).resolves.toBe(false)
    expect(store.settingsNotice).toContain('请输入代理配置名称')
    await expect(store.removeSshProxyConfig('release-proxy')).resolves.toBe(true)
    expect(store.sshProxyConfigs).toEqual([])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshProxyConfigs: []
      })
    )
    store.closeSshProxyConfig()
    expect(store.sshProxyConfigModalOpen).toBe(false)

    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.updateTerminalSettings({ sshAgentsStatus: true })).resolves.toBe(true)
    expect(store.terminalSettings.sshAgentsStatus).toBe(true)
    expect(await store.refreshSshAgentKeychainOptions()).toBe(true)
    expect(window.aiops.listSshAgentKeychainOptions).toHaveBeenCalled()
    store.openSshAgentConfig()
    expect(store.sshAgentConfigModalOpen).toBe(true)
    store.setSshAgentSelectedKey('key-1')
    await expect(store.addSshAgentKey()).resolves.toBe(true)
    expect(store.sshAgentKeys).toEqual([
      {
        id: 'key-1',
        fingerprint: prodKeychainSshAgentFingerprint,
        comment: 'prod-ed25519',
        keyType: 'ED25519',
        keyChainId: 'key-1'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-1',
            fingerprint: prodKeychainSshAgentFingerprint,
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-1'
          }
        ]
      })
    )
    await expect(store.addSshAgentKey()).resolves.toBe(false)
    expect(store.settingsNotice).toContain('请选择密钥')
    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.removeSshAgentKey('key-1')).resolves.toBe(true)
    expect(store.sshAgentKeys).toEqual([])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: []
      })
    )
    store.closeSshAgentConfig()
    expect(store.sshAgentConfigModalOpen).toBe(false)

    await store.refreshAiModelCatalog()
    store.updateModelProviderConfig('openai', { baseUrl: 'https://gateway.local', modelId: 'ops-model', apiFormat: 'chat-completions' })
    expect(store.modelProviders.openai.baseUrl).toBe('https://gateway.local')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          providers: expect.objectContaining({
            openai: expect.objectContaining({
              baseUrl: 'https://gateway.local',
              modelId: 'ops-model',
              apiFormat: 'chat-completions'
            })
          })
        })
      })
    )
    await expect(store.saveModelProvider('openai')).resolves.toBe(true)
    expect(store.config.modelProvider).toBe('openai-compatible')
    expect(store.config.modelName).toBe('ops-model')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProvider: 'openai-compatible',
        modelEndpoint: 'https://gateway.local',
        modelName: 'ops-model',
        modelSettings: expect.objectContaining({
          providers: expect.objectContaining({
            openai: expect.objectContaining({ modelId: 'ops-model' })
          })
        })
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.updateModelProviderConfig('bedrock', {
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      awsAccessKey: 'AKIA-LOCAL',
      awsSecretKey: 'secret',
      awsSessionToken: 'token',
      awsRegion: 'eu-west-1',
      awsEndpointSelected: true,
      awsBedrockEndpoint: 'https://bedrock-runtime.eu-west-1.amazonaws.com',
      awsUseCrossRegionInference: true
    })
    expect(store.modelProviders.bedrock.awsRegion).toBe('eu-west-1')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          providers: expect.objectContaining({
            bedrock: expect.objectContaining({
              modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
              awsAccessKey: 'AKIA-LOCAL',
              awsRegion: 'eu-west-1',
              awsEndpointSelected: true,
              awsBedrockEndpoint: 'https://bedrock-runtime.eu-west-1.amazonaws.com',
              awsUseCrossRegionInference: true
            })
          })
        })
      })
    )
    await expect(store.saveModelProvider('bedrock')).resolves.toBe(true)
    expect(store.config.modelProvider).toBe('bedrock')
    expect(store.config.modelName).toBe('anthropic.claude-3-haiku-20240307-v1:0')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProvider: 'bedrock',
        modelName: 'anthropic.claude-3-haiku-20240307-v1:0'
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.updateModelOption('aiopsterm-local-agent', false)
    expect(store.settingModelOptions.find((model) => model.name === 'aiopsterm-local-agent')?.checked).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          options: expect.arrayContaining([expect.objectContaining({ name: 'aiopsterm-local-agent', checked: false })])
        })
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.removeModelOption('custom-maintenance')
    expect(store.settingModelOptions.some((model) => model.name === 'custom-maintenance')).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          options: expect.not.arrayContaining([expect.objectContaining({ name: 'custom-maintenance' })])
        })
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.toggleAddModelSwitch(false)
    expect(store.addModelSwitch).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          addModelSwitch: false
        })
      })
    )

    store.checkModelProvider('litellm')
    expect(store.modelCheckState.litellm).toBe('checking')
    await vi.runOnlyPendingTimersAsync()
    expect(store.modelCheckState.litellm).toBe('success')

    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.updateAiPreferences({ needProxy: true, proxy: { host: '10.0.0.2', port: 8080 } })).resolves.toBe(true)
    expect(store.aiPreferences.needProxy).toBe(true)
    expect(store.aiPreferences.proxy.host).toBe('10.0.0.2')
    expect(store.aiPreferences.proxy.port).toBe(8080)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          needProxy: true,
          proxy: expect.objectContaining({
            host: '10.0.0.2',
            port: 8080
          })
        })
      })
    )

    await expect(store.updateAiPreferences({ thinkingBudgetTokens: 5000, reasoningEffort: 'high', shellIntegrationTimeout: 120 })).resolves.toBe(true)
    expect(store.aiPreferences.thinkingBudgetTokens).toBe(5000)
    expect(store.aiPreferences.reasoningEffort).toBe('high')
    expect(store.aiPreferences.shellIntegrationTimeout).toBe(120)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          thinkingBudgetTokens: 5000,
          reasoningEffort: 'high',
          shellIntegrationTimeout: 120
        })
      })
    )

    expect(store.onboardingAutoApprovalEvent).toBe(0)
    await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(true)
    expect(store.aiPreferences.autoApproval).toBe(true)
    expect(store.onboardingAutoApprovalEvent).toBe(1)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          autoApproval: true
        })
      })
    )
    await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(true)
    expect(store.onboardingAutoApprovalEvent).toBe(1)
  })

  it('does not fabricate SSH proxy config writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const proxyConfigSnapshot = () => JSON.stringify(store.sshProxyConfigs)
    const initialSnapshot = proxyConfigSnapshot()
    const draftProxy = {
      name: 'release-proxy',
      type: 'SOCKS5' as const,
      host: '10.0.0.8',
      port: 1080,
      enableProxyIdentity: true,
      username: 'ops',
      password: 'secret'
    }

    const openDraft = () => {
      store.openAddSshProxyConfig()
      store.updateSshProxyForm(draftProxy)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      openDraft()
      await expect(store.saveSshProxyForm()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH 代理配置保存服务不可用')
      expect(store.sshProxyAddModalOpen).toBe(true)
      expect(proxyConfigSnapshot()).toBe(initialSnapshot)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.saveSshProxyForm()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH 代理配置保存失败')
      expect(store.sshProxyAddModalOpen).toBe(true)
      expect(proxyConfigSnapshot()).toBe(initialSnapshot)

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('ssh proxy save offline'))
      await expect(store.saveSshProxyForm()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('ssh proxy save offline')
      expect(store.sshProxyAddModalOpen).toBe(true)
      expect(proxyConfigSnapshot()).toBe(initialSnapshot)

      await expect(store.saveSshProxyForm()).resolves.toBe(true)
      const savedSnapshot = proxyConfigSnapshot()
      expect(store.sshProxyAddModalOpen).toBe(false)
      expect(store.sshProxyConfigs).toEqual([draftProxy])

      ;(window.aiops as any).saveConfig = undefined
      await expect(store.removeSshProxyConfig('release-proxy')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH 代理配置删除服务不可用')
      expect(proxyConfigSnapshot()).toBe(savedSnapshot)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.removeSshProxyConfig('release-proxy')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('SSH 代理配置删除失败')
      expect(proxyConfigSnapshot()).toBe(savedSnapshot)

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('ssh proxy delete offline'))
      await expect(store.removeSshProxyConfig('release-proxy')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('ssh proxy delete offline')
      expect(proxyConfigSnapshot()).toBe(savedSnapshot)
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate model provider Save success when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialProvider = store.config.modelProvider
    const initialEndpoint = store.config.modelEndpoint
    const initialModelName = store.config.modelName

    store.updateModelProviderConfig('openai', { baseUrl: 'https://gateway.local', modelId: 'ops-model', apiFormat: 'chat-completions' })
    await Promise.resolve()
    const editedSettings = JSON.stringify(store.config.modelSettings)
    vi.mocked(window.aiops.saveConfig).mockClear()

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.saveModelProvider('openai')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('模型 Provider 保存服务不可用')
      expect(store.config.modelProvider).toBe(initialProvider)
      expect(store.config.modelEndpoint).toBe(initialEndpoint)
      expect(store.config.modelName).toBe(initialModelName)
      expect(JSON.stringify(store.config.modelSettings)).toBe(editedSettings)

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.saveModelProvider('openai')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('模型 Provider 保存失败')
      expect(store.config.modelProvider).toBe(initialProvider)
      expect(store.config.modelEndpoint).toBe(initialEndpoint)
      expect(store.config.modelName).toBe(initialModelName)
      expect(JSON.stringify(store.config.modelSettings)).toBe(editedSettings)

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        modelProvider: 'litellm',
        modelEndpoint: 'https://gateway.local',
        modelName: 'ops-model',
        modelSettings: {
          ...store.config.modelSettings,
          providers: {
            ...store.config.modelSettings?.providers,
            openai: {
              ...store.modelProviders.openai
            }
          }
        }
      } as any)
      await expect(store.saveModelProvider('openai')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('模型 Provider 保存失败')
      expect(store.config.modelProvider).toBe(initialProvider)
      expect(store.config.modelEndpoint).toBe(initialEndpoint)
      expect(store.config.modelName).toBe(initialModelName)
      expect(JSON.stringify(store.config.modelSettings)).toBe(editedSettings)

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('model provider save offline'))
      await expect(store.saveModelProvider('openai')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('model provider save offline')
      expect(store.config.modelProvider).toBe(initialProvider)
      expect(store.config.modelEndpoint).toBe(initialEndpoint)
      expect(store.config.modelName).toBe(initialModelName)
      expect(JSON.stringify(store.config.modelSettings)).toBe(editedSettings)

      await expect(store.saveModelProvider('openai')).resolves.toBe(true)
      expect(store.settingsNotice).toBe('OpenAI Compatible Save 成功')
      expect(store.config.modelProvider).toBe('openai-compatible')
      expect(store.config.modelEndpoint).toBe('https://gateway.local')
      expect(store.config.modelName).toBe('ops-model')
      expect(store.config.modelSettings?.providers.openai).toEqual(expect.objectContaining({ modelId: 'ops-model' }))
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate privacy setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialSnapshot = JSON.stringify({
      privacy: store.config.privacy,
      settings: {
        telemetry: store.privacySettings.telemetry,
        secretRedaction: store.privacySettings.secretRedaction,
        dataSync: store.privacySettings.dataSync
      }
    })
    const assertPrivacyUnchanged = () => {
      expect(
        JSON.stringify({
          privacy: store.config.privacy,
          settings: {
            telemetry: store.privacySettings.telemetry,
            secretRedaction: store.privacySettings.secretRedaction,
            dataSync: store.privacySettings.dataSync
          }
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updatePrivacySettings({ telemetry: 'disabled' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('隐私设置保存服务不可用')
      assertPrivacyUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updatePrivacySettings({ telemetry: 'disabled' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('隐私设置保存失败')
      assertPrivacyUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        privacy: {
          telemetry: 'enabled',
          secretRedaction: 'disabled',
          dataSync: 'disabled'
        }
      } as any)
      await expect(store.updatePrivacySettings({ telemetry: 'disabled' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('隐私设置保存失败')
      assertPrivacyUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('privacy save offline'))
      await expect(store.updatePrivacySettings({ telemetry: 'disabled' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('privacy save offline')
      assertPrivacyUnchanged()

      await expect(store.updatePrivacySettings({ telemetry: 'disabled', secretRedaction: 'enabled', dataSync: 'enabled' })).resolves.toBe(true)
      expect(store.settingsNotice).toBe('隐私设置已保存')
      expect(store.privacySettings.telemetry).toBe('disabled')
      expect(store.privacySettings.secretRedaction).toBe('enabled')
      expect(store.privacySettings.dataSync).toBe('enabled')
      expect(store.config.privacy).toEqual({
        telemetry: 'disabled',
        secretRedaction: 'enabled',
        dataSync: 'enabled'
      })
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate editor setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialSnapshot = JSON.stringify({
      config: store.config.editorSettings,
      settings: store.editorSettings,
      runtime: {
        fontSize: document.documentElement.style.getPropertyValue('--editor-font-size'),
        lineHeight: document.documentElement.style.getPropertyValue('--editor-line-height'),
        tabSize: document.documentElement.style.getPropertyValue('--editor-tab-size'),
        wordWrap: document.documentElement.dataset.editorWordWrap,
        minimap: document.documentElement.dataset.editorMinimap,
        mouseWheelZoom: document.documentElement.dataset.editorMouseWheelZoom
      }
    })
    const assertEditorSettingsUnchanged = () => {
      expect(
        JSON.stringify({
          config: store.config.editorSettings,
          settings: store.editorSettings,
          runtime: {
            fontSize: document.documentElement.style.getPropertyValue('--editor-font-size'),
            lineHeight: document.documentElement.style.getPropertyValue('--editor-line-height'),
            tabSize: document.documentElement.style.getPropertyValue('--editor-tab-size'),
            wordWrap: document.documentElement.dataset.editorWordWrap,
            minimap: document.documentElement.dataset.editorMinimap,
            mouseWheelZoom: document.documentElement.dataset.editorMouseWheelZoom
          }
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updateEditorSettings({ fontSize: 18 })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('编辑器设置保存服务不可用')
      assertEditorSettingsUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updateEditorSettings({ fontSize: 18 })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('编辑器设置保存失败')
      assertEditorSettingsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        editorSettings: {
          ...defaultEditorSettings,
          fontSize: 14
        }
      } as any)
      await expect(store.updateEditorSettings({ fontSize: 18 })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('编辑器设置保存失败')
      assertEditorSettingsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('editor settings save offline'))
      await expect(store.updateEditorSettings({ fontSize: 18 })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('editor settings save offline')
      assertEditorSettingsUnchanged()

      await expect(store.updateEditorSettings({ fontSize: 18, lineHeight: 24, wordWrap: 'on', minimap: false, mouseWheelZoom: false })).resolves.toBe(true)
      expect(store.settingsNotice).toBe('编辑器设置已保存')
      expect(store.editorSettings.fontSize).toBe(18)
      expect(store.editorSettings.lineHeight).toBe(24)
      expect(store.editorSettings.wordWrap).toBe('on')
      expect(store.editorSettings.minimap).toBe(false)
      expect(store.editorSettings.mouseWheelZoom).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
      expect(document.documentElement.style.getPropertyValue('--editor-line-height')).toBe('24px')
      expect(document.documentElement.dataset.editorWordWrap).toBe('on')
      expect(document.documentElement.dataset.editorMinimap).toBe('off')
      expect(document.documentElement.dataset.editorMouseWheelZoom).toBe('off')
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate General base setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialSnapshot = JSON.stringify({
      config: {
        defaultMode: store.config.defaultMode,
        language: store.config.language,
        watermark: store.config.watermark
      },
      mode: store.mode
    })
    const assertGeneralBaseUnchanged = () => {
      expect(
        JSON.stringify({
          config: {
            defaultMode: store.config.defaultMode,
            language: store.config.language,
            watermark: store.config.watermark
          },
          mode: store.mode
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updateDefaultLayout('agents')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('基础设置保存服务不可用')
      assertGeneralBaseUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updateLanguage('en-US')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('基础设置保存失败')
      assertGeneralBaseUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        ...store.config,
        watermark: 'open'
      })
      await expect(store.updateWatermark('close')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('基础设置保存失败')
      assertGeneralBaseUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('general base save offline'))
      await expect(store.updateDefaultLayout('agents')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('general base save offline')
      assertGeneralBaseUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        ...store.config,
        defaultMode: 'terminal'
      })
      await store.toggleMode()
      expect(store.mode).toBe('agents')
      expect(store.config.defaultMode).toBe('terminal')
      expect(store.topNotice).toContain('默认布局保存失败')
      expect(store.settingsNotice).toBe('基础设置保存失败')

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        ...store.config,
        language: 'en-US'
      })
      await expect(store.updateLanguage('en-US')).resolves.toBe(true)
      expect(store.settingsNotice).toBe('基础设置已保存')
      expect(store.config.language).toBe('en-US')
      expect(store.config.defaultMode).toBe('terminal')
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate terminal setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialSnapshot = JSON.stringify({
      config: store.config.terminal,
      settings: store.terminalSettings
    })
    const assertTerminalSettingsUnchanged = () => {
      expect(
        JSON.stringify({
          config: store.config.terminal,
          settings: store.terminalSettings
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updateTerminalSettings({ terminalType: 'vt220' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('终端设置保存服务不可用')
      assertTerminalSettingsUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updateTerminalSettings({ terminalType: 'vt220' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('终端设置保存失败')
      assertTerminalSettingsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        terminal: {
          ...defaultTerminalSettings,
          terminalType: 'xterm-256color'
        }
      } as any)
      await expect(store.updateTerminalSettings({ terminalType: 'vt220' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('终端设置保存失败')
      assertTerminalSettingsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('terminal save offline'))
      await expect(store.updateTerminalSettings({ terminalType: 'vt220' })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('terminal save offline')
      assertTerminalSettingsUnchanged()

      await expect(
        store.updateTerminalSettings({
          terminalType: 'vt220',
          cursorStyle: 'underline',
          showCloseButton: false,
          middleMouseEvent: 'closeTab'
        })
      ).resolves.toBe(true)
      expect(store.settingsNotice).toBe('终端设置已保存')
      expect(store.terminalSettings.terminalType).toBe('vt220')
      expect(store.terminalSettings.cursorStyle).toBe('underline')
      expect(store.terminalSettings.showCloseButton).toBe(false)
      expect(store.terminalSettings.middleMouseEvent).toBe('closeTab')
      expect(store.config.terminal).toEqual(
        expect.objectContaining({
          terminalType: 'vt220',
          cursorStyle: 'underline',
          showCloseButton: false,
          middleMouseEvent: 'closeTab'
        })
      )
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate AI preference writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    const originalSaveConfig = window.aiops.saveConfig
    const initialSnapshot = JSON.stringify({
      config: store.config.aiPreferences,
      settings: store.aiPreferences,
      onboardingAutoApprovalEvent: store.onboardingAutoApprovalEvent
    })
    const assertAiPreferencesUnchanged = () => {
      expect(
        JSON.stringify({
          config: store.config.aiPreferences,
          settings: store.aiPreferences,
          onboardingAutoApprovalEvent: store.onboardingAutoApprovalEvent
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('AI 偏好设置保存服务不可用')
      assertAiPreferencesUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('AI 偏好设置保存失败')
      assertAiPreferencesUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        aiPreferences: {
          ...defaultAiPreferences,
          proxy: { ...defaultAiPreferences.proxy },
          autoApproval: false
        }
      } as any)
      await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('AI 偏好设置保存失败')
      assertAiPreferencesUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('ai preferences save offline'))
      await expect(store.updateAiPreferences({ autoApproval: true })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('ai preferences save offline')
      assertAiPreferencesUnchanged()

      await expect(store.updateAiPreferences({ autoApproval: true, needProxy: true, proxy: { host: '10.0.0.3', port: 18080 } })).resolves.toBe(true)
      expect(store.settingsNotice).toBe('AI 偏好设置已保存')
      expect(store.aiPreferences.autoApproval).toBe(true)
      expect(store.aiPreferences.needProxy).toBe(true)
      expect(store.aiPreferences.proxy.host).toBe('10.0.0.3')
      expect(store.aiPreferences.proxy.port).toBe(18080)
      expect(store.onboardingAutoApprovalEvent).toBe(1)
      expect(store.config.aiPreferences).toEqual(
        expect.objectContaining({
          autoApproval: true,
          needProxy: true,
          proxy: expect.objectContaining({
            host: '10.0.0.3',
            port: 18080
          })
        })
      )
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('does not fabricate extension setting writes when the config bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()
    await store.refreshExtensionPlugins()
    const originalSaveConfig = window.aiops.saveConfig
    store.selectExtension('Alias')
    const initialSnapshot = JSON.stringify({
      config: store.config.extensionSettings,
      settings: store.extensionSettings,
      aliasVisible: store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias'),
      selectedExtensionId: store.selectedExtensionId
    })
    const assertExtensionsUnchanged = () => {
      expect(
        JSON.stringify({
          config: store.config.extensionSettings,
          settings: store.extensionSettings,
          aliasVisible: store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias'),
          selectedExtensionId: store.selectedExtensionId
        })
      ).toBe(initialSnapshot)
    }

    try {
      ;(window.aiops as any).saveConfig = undefined
      await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('扩展设置保存服务不可用')
      assertExtensionsUnchanged()

      ;(window.aiops as any).saveConfig = originalSaveConfig
      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({} as any)
      await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('扩展设置保存失败')
      assertExtensionsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockResolvedValueOnce({
        extensionSettings: {
          autoCompleteStatus: true,
          quickVimStatus: true,
          aliasStatus: true,
          highlightStatus: true
        }
      } as any)
      await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('扩展设置保存失败')
      assertExtensionsUnchanged()

      vi.mocked(window.aiops.saveConfig!).mockRejectedValueOnce(new Error('extension save offline'))
      await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(false)
      expect(store.settingsNotice).toBe('extension save offline')
      assertExtensionsUnchanged()

      await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(true)
      expect(store.settingsNotice).toBe('扩展设置已保存')
      expect(store.extensionSettings.aliasStatus).toBe(false)
      expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(false)
      expect(store.selectedExtensionId).toBe('jumpserverSupport')
      expect(store.config.extensionSettings).toEqual({
        autoCompleteStatus: true,
        quickVimStatus: true,
        aliasStatus: false,
        highlightStatus: true
      })
    } finally {
      window.aiops.saveConfig = originalSaveConfig
    }
  })

  it('manages remaining External reference-style settings lists and toggles', async () => {
    const store = useWorkspaceStore()

    await store.refreshUserAccount()
    await store.refreshExtensionPlugins()

    store.selectExtension('Alias')
    expect(store.selectedExtensionId).toBe('Alias')
    await expect(store.updateExtensionSettings({ aliasStatus: false })).resolves.toBe(true)
    expect(store.extensionSettings.aliasStatus).toBe(false)
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionSettings: {
          autoCompleteStatus: true,
          quickVimStatus: true,
          aliasStatus: false,
          highlightStatus: true
        }
      })
    )
    store.selectExtension('Alias')
    expect(store.selectedExtensionId).toBe('jumpserverSupport')
    await expect(store.updateExtensionSettings({ aliasStatus: true })).resolves.toBe(true)
    expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(true)

    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.readKeywordHighlightConfig).mockResolvedValueOnce(JSON.stringify(defaultKeywordHighlight, null, 2))
    const keywordHighlightFileListeners: Array<(content: string) => void> = []
    const removeKeywordHighlightFileListener = vi.fn()
    vi.mocked(window.aiops.onKeywordHighlightConfigFileChanged).mockImplementationOnce((listener) => {
      keywordHighlightFileListeners.push(listener)
      return removeKeywordHighlightFileListener
    })
    await store.openKeywordHighlightEditor()
    expect(store.keywordHighlightEditorOpen).toBe(true)
    expect(window.aiops.getKeywordHighlightConfigPath).toHaveBeenCalled()
    expect(window.aiops.readKeywordHighlightConfig).toHaveBeenCalled()
    expect(store.keywordHighlightConfigPath).toBe('/tmp/aiopsterm/keyword-highlight.json')
    expect(store.keywordHighlightEditorContent).toContain('keyword-highlight')
    store.updateKeywordHighlightEditorContent('{invalid json')
    expect(store.keywordHighlightEditorError).toContain('Invalid JSON')
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
    expect(window.aiops.writeKeywordHighlightConfig).not.toHaveBeenCalled()
    const keywordConfig = {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: true
        },
        rules: [
          {
            name: 'sudo',
            enabled: true,
            scope: 'input',
            matchType: 'regex',
            pattern: 'sudo',
            style: {
              foreground: '#E6B450',
              fontStyle: 'bold'
            }
          }
        ]
      }
    }
    store.updateKeywordHighlightEditorContent(JSON.stringify(keywordConfig, null, 2))
    expect(store.keywordHighlightEditorError).toBe('')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.keywordHighlightSettings).toEqual(keywordConfig)
    expect(store.keywordHighlightEditorLastSaved).toBe(true)
    expect(window.aiops.writeKeywordHighlightConfig).toHaveBeenCalledWith(JSON.stringify(keywordConfig, null, 2))
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordHighlight: keywordConfig
      })
    )
    const externalKeywordConfig = {
      'keyword-highlight': {
        enabled: true,
        applyTo: {
          output: true,
          input: false
        },
        rules: [
          {
            name: 'error',
            enabled: true,
            scope: 'output' as const,
            matchType: 'wildcard' as const,
            pattern: '*error*',
            style: {
              foreground: '#F87171',
              fontStyle: 'normal' as const
            }
          }
        ]
      }
    }
    keywordHighlightFileListeners[0](JSON.stringify(externalKeywordConfig, null, 2))
    expect(store.keywordHighlightSettings).toEqual(externalKeywordConfig)
    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.writeKeywordHighlightConfig).mockClear()
    await store.resetKeywordHighlightEditor()
    expect(store.keywordHighlightSettings).toEqual(defaultKeywordHighlight)
    expect(window.aiops.writeKeywordHighlightConfig).toHaveBeenCalledWith(JSON.stringify(defaultKeywordHighlight, null, 2))
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordHighlight: defaultKeywordHighlight
      })
    )
    store.closeKeywordHighlightEditor()
    expect(store.keywordHighlightEditorOpen).toBe(false)
    expect(removeKeywordHighlightFileListener).toHaveBeenCalled()

    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.readSecurityConfig).mockResolvedValueOnce(`// aiopsterm security config
${JSON.stringify(defaultSecurityConfig, null, 2)}`)
    const securityConfigFileListeners: Array<(content: string) => void> = []
    const removeSecurityConfigFileListener = vi.fn()
    vi.mocked(window.aiops.onSecurityConfigFileChanged).mockImplementationOnce((listener) => {
      securityConfigFileListeners.push(listener)
      return removeSecurityConfigFileListener
    })
    await store.openSecurityConfigEditor()
    expect(store.securityConfigEditorOpen).toBe(true)
    expect(window.aiops.getSecurityConfigPath).toHaveBeenCalled()
    expect(window.aiops.readSecurityConfig).toHaveBeenCalled()
    expect(store.securityConfigPath).toBe('/tmp/aiopsterm/security-config.json')
    expect(store.securityConfigEditorContent).toContain('"security"')
    expect(store.securityConfigEditorContent).not.toContain('aiopsterm security config')
    store.updateSecurityConfigEditorContent('{invalid json')
    expect(store.securityConfigEditorError).toContain('Invalid JSON')
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
    expect(window.aiops.writeSecurityConfig).not.toHaveBeenCalled()
    const securityConfig = {
      security: {
        enableCommandSecurity: true,
        enableStrictMode: true,
        blacklistPatterns: ['rm -rf /'],
        whitelistPatterns: ['ls', 'pwd'],
        dangerousCommands: ['reboot'],
        maxCommandLength: 4096,
        securityPolicy: {
          blockCritical: true,
          askForMedium: false,
          askForHigh: true,
          askForBlacklist: true
        }
      }
    }
    store.updateSecurityConfigEditorContent(JSON.stringify(securityConfig, null, 2))
    expect(store.securityConfigEditorError).toBe('')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.securitySettings).toEqual(securityConfig)
    expect(store.securityConfigEditorLastSaved).toBe(true)
    expect(window.aiops.writeSecurityConfig).toHaveBeenCalledWith(JSON.stringify(securityConfig, null, 2))
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        securityConfig
      })
    )
    const externalSecurityConfig = {
      security: {
        enableCommandSecurity: false,
        enableStrictMode: false,
        blacklistPatterns: ['shutdown now'],
        whitelistPatterns: ['uptime'],
        dangerousCommands: ['mkfs'],
        maxCommandLength: 2048,
        securityPolicy: {
          blockCritical: false,
          askForMedium: true,
          askForHigh: false,
          askForBlacklist: true
        }
      }
    }
    securityConfigFileListeners[0](`/* external update */
${JSON.stringify(externalSecurityConfig, null, 2)}`)
    expect(store.securitySettings).toEqual(externalSecurityConfig)
    expect(store.securityConfigEditorContent).not.toContain('external update')
    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.writeSecurityConfig).mockClear()
    await store.resetSecurityConfigEditor()
    expect(store.securitySettings).toEqual(defaultSecurityConfig)
    expect(window.aiops.writeSecurityConfig).toHaveBeenCalledWith(JSON.stringify(defaultSecurityConfig, null, 2))
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        securityConfig: defaultSecurityConfig
      })
    )
    store.closeSecurityConfigEditor()
    expect(store.securityConfigEditorOpen).toBe(false)
    expect(removeSecurityConfigFileListener).toHaveBeenCalled()

    const mcpConfig = {
      mcpServers: {
        filesystem: {
          type: 'stdio' as const,
          disabled: false,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
          timeout: 60
        }
      }
    }
    vi.mocked(window.aiops.readMcpConfig).mockResolvedValueOnce(JSON.stringify(mcpConfig, null, 2))
    const mcpConfigFileListeners: Array<(content: string) => void> = []
    const removeMcpConfigFileListener = vi.fn()
    vi.mocked(window.aiops.onMcpConfigFileChanged).mockImplementationOnce((listener) => {
      mcpConfigFileListeners.push(listener)
      return removeMcpConfigFileListener
    })
    await store.openMcpConfigEditor()
    expect(store.mcpConfigEditorOpen).toBe(true)
    expect(window.aiops.getMcpConfigPath).toHaveBeenCalled()
    expect(window.aiops.readMcpConfig).toHaveBeenCalled()
    expect(store.mcpConfigPath).toBe('/tmp/aiopsterm/setting/mcp_settings.json')
    expect(store.mcpConfigEditorContent).toContain('"mcpServers"')
    store.updateMcpConfigEditorContent('{invalid json')
    expect(store.mcpConfigEditorError).toContain('Invalid JSON')
    expect(window.aiops.writeMcpConfig).not.toHaveBeenCalled()
    const nextMcpConfig = {
      mcpServers: {
        filesystem: {
          type: 'stdio' as const,
          disabled: true,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          timeout: 90
        }
      }
    }
    store.updateMcpConfigEditorContent(JSON.stringify(nextMcpConfig, null, 2))
    await vi.advanceTimersByTimeAsync(2000)
    expect(window.aiops.writeMcpConfig).toHaveBeenCalledWith(JSON.stringify(nextMcpConfig, null, 2))
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.disabled).toBe(true)
    const externalMcpConfig = {
      mcpServers: {
        filesystem: {
          type: 'stdio' as const,
          disabled: false,
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/var/log'],
          timeout: 60
        }
      }
    }
    mcpConfigFileListeners[0](JSON.stringify(externalMcpConfig, null, 2))
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.disabled).toBe(false)
    store.closeMcpConfigEditor()
    expect(removeMcpConfigFileListener).toHaveBeenCalled()

    vi.mocked(window.aiops.toggleMcpServer).mockClear()
    await expect(store.toggleMcpServerDisabled('filesystem')).resolves.toBe(true)
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.disabled).toBe(true)
    expect(window.aiops.toggleMcpServer).toHaveBeenCalledWith('filesystem', true)
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.status).toBe('disabled')

    vi.mocked(window.aiops.setMcpToolState).mockClear()
    await expect(store.toggleMcpTool('filesystem', 'read_file')).resolves.toBe(true)
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.tools.find((tool) => tool.name === 'read_file')?.enabled).toBe(false)
    expect(window.aiops.setMcpToolState).toHaveBeenCalledWith('filesystem', 'read_file', false)

    vi.mocked(window.aiops.deleteMcpServer).mockClear()
    await expect(store.deleteMcpServer('ops-inventory')).resolves.toBe(true)
    expect(store.mcpServers.some((server) => server.name === 'ops-inventory')).toBe(false)
    expect(window.aiops.deleteMcpServer).toHaveBeenCalledWith('ops-inventory')

    const createdSkill = {
      name: 'new-skill',
      description: 'new skill description',
      enabled: true,
      editable: true,
      content: 'new skill content',
      path: '/tmp/aiopsterm/skills/new-skill/SKILL.md'
    }
    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([createdSkill])
    vi.mocked(window.aiops.createSkill).mockClear()
    await store.openSkillModal('create')
    store.skillModal.name = 'new-skill'
    store.skillModal.description = 'new skill description'
    store.skillModal.content = 'new skill content'
    await expect(store.saveSkillModal()).resolves.toBe(true)
    expect(store.settingsSkills.some((skill) => skill.name === 'new-skill')).toBe(true)
    expect(window.aiops.createSkill).toHaveBeenCalledWith({ name: 'new-skill', description: 'new skill description' }, 'new skill content')

    vi.mocked(window.aiops.createSkill).mockClear()
    await store.openSkillModal('create')
    store.skillModal.name = 'Invalid_Name'
    store.skillModal.description = 'invalid'
    store.skillModal.content = 'invalid'
    await expect(store.saveSkillModal()).resolves.toBe(false)
    expect(store.settingsNotice).toBe('Skill 名称只能包含小写字母和连字符')
    expect(window.aiops.createSkill).not.toHaveBeenCalled()

    vi.mocked(window.aiops.readSkillContent).mockResolvedValueOnce({
      metadata: { name: 'new-skill', description: 'new skill description' },
      content: 'new skill content'
    })
    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([{ ...createdSkill, description: 'updated skill description', content: 'updated skill content' }])
    vi.mocked(window.aiops.updateSkill).mockClear()
    await store.openSkillModal('edit', 'new-skill')
    store.skillModal.description = 'updated skill description'
    store.skillModal.content = 'updated skill content'
    await expect(store.saveSkillModal()).resolves.toBe(true)
    expect(store.settingsSkills.find((skill) => skill.name === 'new-skill')?.content).toBe('updated skill content')
    expect(window.aiops.updateSkill).toHaveBeenCalledWith('new-skill', { name: 'new-skill', description: 'updated skill description' }, 'updated skill content')

    vi.mocked(window.aiops.setSkillEnabled).mockClear()
    await store.toggleSkillEnabled('new-skill')
    expect(store.settingsSkills.find((skill) => skill.name === 'new-skill')?.enabled).toBe(false)
    expect(window.aiops.setSkillEnabled).toHaveBeenCalledWith('new-skill', false)

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/release-check.zip'] })
    vi.mocked(window.aiops.importSkillZip).mockResolvedValueOnce({ success: true, skillName: 'imported-skill' })
    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([
      {
        name: 'imported-skill',
        description: 'Imported skill',
        enabled: true,
        editable: true,
        content: 'Imported content',
        path: '/tmp/aiopsterm/skills/imported-skill/SKILL.md'
      },
      { ...createdSkill, enabled: false }
    ])
    await store.importSkillZip()
    expect(window.aiops.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    expect(window.aiops.importSkillZip).toHaveBeenCalledWith('/tmp/release-check.zip')
    expect(store.settingsSkills.some((skill) => skill.name === 'imported-skill')).toBe(true)

    vi.mocked(window.aiops.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/imported-skill.zip'] })
    vi.mocked(window.aiops.importSkillZip).mockResolvedValueOnce({ success: false, skillName: 'imported-skill', errorCode: 'DIR_EXISTS' })
    await store.importSkillZip()
    expect(store.settingsNotice).toBe('Skill 已存在，再次点击 Import 覆盖')
    vi.mocked(window.aiops.importSkillZip).mockResolvedValueOnce({ success: true, skillName: 'imported-skill' })
    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([
      { ...createdSkill, name: 'imported-skill' },
      { ...createdSkill, enabled: false, description: 'updated skill description', content: 'updated skill content' }
    ])
    await store.importSkillZip()
    expect(window.aiops.importSkillZip).toHaveBeenLastCalledWith('/tmp/imported-skill.zip', true)

    vi.mocked(window.aiops.exportSkillZip).mockClear()
    await store.exportSkillZip('imported-skill')
    expect(window.aiops.exportSkillZip).toHaveBeenCalledWith('imported-skill')
    expect(store.settingsNotice).toBe('imported-skill 已导出为 ZIP')

    vi.mocked(window.aiops.getSkills).mockResolvedValueOnce([])
    vi.mocked(window.aiops.deleteSkill).mockClear()
    await store.deleteSkill('new-skill')
    expect(store.settingsSkills.some((skill) => skill.name === 'new-skill')).toBe(false)
    expect(window.aiops.deleteSkill).toHaveBeenCalledWith('new-skill')

    store.addSettingsRule()
    const rule = store.settingsRules[0]
    expect(rule.id).toBe('rule-draft-new')
    expect(rule.isDraft).toBe(true)
    store.updateSettingsRuleDraft(rule.id, 'must ask before restart')
    expect(await store.saveSettingsRule(rule.id)).toBe(true)
    const savedRule = store.settingsRules.find((item) => item.content === 'must ask before restart')!
    expect(savedRule.id).toMatch(/^rule-test-/)
    expect(savedRule.isDraft).toBeUndefined()
    expect(window.aiops.saveSettingsRule).toHaveBeenCalledWith({ content: 'must ask before restart', enabled: true })

    store.editSettingsRule(savedRule.id)
    store.updateSettingsRuleDraft(savedRule.id, 'discard this draft')
    store.cancelSettingsRuleEdit(savedRule.id)
    expect(store.settingsRules.find((item) => item.id === savedRule.id)?.content).toBe('must ask before restart')

    vi.mocked(window.aiops.saveSettingsRule).mockClear()
    await store.toggleSettingsRule(savedRule.id)
    expect(store.settingsRules.find((item) => item.id === savedRule.id)?.enabled).toBe(false)
    expect(window.aiops.saveSettingsRule).toHaveBeenCalledWith({ id: savedRule.id, content: 'must ask before restart', enabled: false })

    vi.mocked(window.aiops.deleteSettingsRule).mockClear()
    await store.deleteSettingsRule(savedRule.id)
    expect(store.settingsRules.some((item) => item.id === savedRule.id)).toBe(false)
    expect(window.aiops.deleteSettingsRule).toHaveBeenCalledWith(savedRule.id)

    store.startShortcutRecording('newTerminal')
    store.updateShortcutRecording('Ctrl+Shift+N')
    expect(await store.saveShortcutRecording()).toBe(true)
    expect(store.settingsShortcuts.find((shortcut) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Shift+N')
    expect(window.aiops.saveSettingsShortcut).toHaveBeenCalledWith({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })

    store.startShortcutRecording('quickCommand')
    store.updateShortcutRecording('Ctrl+Shift+N')
    expect(await store.saveShortcutRecording()).toBe(false)
    expect(store.settingsNotice).toBe('快捷键已被占用')

    store.startShortcutRecording('switchToSpecificTab')
    store.updateShortcutRecording('Alt+1')
    expect(await store.saveShortcutRecording()).toBe(false)
    expect(store.settingsNotice).toBe('快捷键格式无效')

    vi.mocked(window.aiops.resetSettingsShortcuts).mockClear()
    await store.resetAllShortcuts()
    expect(store.settingsShortcuts).toEqual(defaultShortcuts)
    expect(window.aiops.resetSettingsShortcuts).toHaveBeenCalled()

    store.openTrustedDeviceRevoke(2)
    expect(store.trustedDeviceModal.open).toBe(true)
    vi.mocked(window.aiops.revokeTrustedDevice).mockClear()
    await store.confirmTrustedDeviceRevoke()
    expect(window.aiops.revokeTrustedDevice).toHaveBeenCalledWith(2)
    expect(store.trustedDevices.some((device) => device.id === 2)).toBe(false)
    expect(store.userNotice).toBe('可信设备已移除')

    store.openAccountCenter()
    expect(store.userAccountCenterOpen).toBe(true)
    store.closeAccountCenter()
    expect(store.userAccountCenterOpen).toBe(false)

    await store.openUserLogin()
    expect(store.activeModule).toBe('user')
    expect(store.userProfile.skippedLogin).toBe(true)
    expect(store.userLoginTab).toBe('account')
    store.setUserLoginTab('email')
    expect(store.userLoginTab).toBe('email')
    vi.mocked(window.aiops.loginUserAccount).mockClear()
    expect(await store.loginUser()).toBe(false)
    expect(window.aiops.loginUserAccount).toHaveBeenCalledWith({ method: 'account', username: '', password: '' })
    expect(store.userNotice).toBe('请输入用户名和密码')
    expect(await store.loginWithAccount('', '')).toBe(false)
    expect(store.userNotice).toBe('请输入用户名和密码')
    expect(await store.loginWithAccount('verify-device', 'secret')).toBe(false)
    expect(store.userProfile.needDeviceVerification).toBe(true)
    expect(store.userNotice).toBe('当前设备需要验证后才能登录')
    expect(await store.loginWithAccount('ops_login', 'secret')).toBe(true)
    expect(store.userProfile.skippedLogin).toBe(false)
    expect(store.userProfile.username).toBe('ops_login')
    expect(store.userProfile.registrationCode).toBe(9)
    expect(store.userProfile.lastLoginMethod).toBe('account')
    expect(store.userProfile.localDatabaseReady).toBe(true)
    await store.logoutUser()
    expect(store.userProfile.localDatabaseReady).toBe(false)
    expect(await store.sendUserLoginCode('email', 'bad')).toBe(false)
    expect(store.userNotice).toBe('邮箱格式不正确')
    expect(await store.sendUserLoginCode('email', 'login@example.local')).toBe(true)
    await vi.advanceTimersByTimeAsync(120)
    expect(store.userLoginCodeCountdown.email).toBe(300)
    expect(await store.loginWithEmail('login@example.local', '246810')).toBe(true)
    expect(store.userProfile.email).toBe('login@example.local')
    expect(store.userProfile.registrationCode).toBe(2)
    expect(store.userProfile.lastLoginMethod).toBe('email')
    expect(store.userLoginCodeCountdown.email).toBe(0)
    expect(store.canEditUserEmail).toBe(false)
    expect(await store.sendUserContactCode('email', 'ops@example.local')).toBe(false)
    expect(store.userNotice).toBe('当前登录方式不允许修改邮箱')
    expect(store.canEditUserMobile).toBe(true)
    await store.logoutUser()
    expect(await store.sendUserLoginCode('mobile', '13800000001')).toBe(true)
    await vi.advanceTimersByTimeAsync(120)
    expect(store.userLoginCodeCountdown.mobile).toBe(300)
    expect(await store.loginWithMobile('13800000001', '135790')).toBe(true)
    expect(store.userProfile.mobile).toBe('13800000001')
    expect(store.userProfile.registrationCode).toBe(7)
    expect(store.userProfile.lastLoginMethod).toBe('mobile')
    expect(store.canEditUserMobile).toBe(false)
    expect(await store.sendUserContactCode('mobile', '13800000002')).toBe(false)
    expect(store.userNotice).toBe('当前登录方式不允许修改手机号')
    await store.logoutUser()
    expect(await store.skipUserLogin()).toBe(true)
    expect(store.userProfile.username).toBe('guest')
    expect(store.userProfile.uid).toBe(999999999)
    expect(store.userProfile.lastLoginMethod).toBe('skip')
    expect(store.billingSettings.skippedLogin).toBe(true)

    expect(await store.updateUserProfile({ username: 'bad-name!' })).toBe(false)
    expect(store.userNotice).toBe('用户名仅支持字母、数字和下划线')
    expect(await store.updateUserProfile({ name: 'Ops Lead', username: 'ops_lead' })).toBe(true)
    expect(store.userProfile.name).toBe('Ops Lead')

    expect(await store.sendUserContactCode('email', 'broken-email')).toBe(false)
    expect(store.userNotice).toBe('邮箱格式不正确')
    expect(await store.sendUserContactCode('email', 'ops@example.local')).toBe(true)
    await vi.advanceTimersByTimeAsync(120)
    expect(store.userContactCodeCountdown.email).toBe(300)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.userContactCodeCountdown.email).toBe(299)
    expect(await store.bindUserContact('email', 'ops@example.local', '')).toBe(false)
    expect(store.userNotice).toBe('请输入邮箱验证码')
    expect(await store.bindUserContact('email', 'ops@example.local', '123456')).toBe(true)
    expect(store.userProfile.email).toBe('ops@example.local')
    expect(store.userContactCodeCountdown.email).toBe(0)

    ;(globalThis as any).__setUserAccountProfileMock?.({ authProvider: 'sso' })
    await store.refreshUserAccount()
    expect(store.canResetUserPassword).toBe(false)
    expect(await store.resetUserPassword('Aa123456!')).toBe(false)
    expect(store.userNotice).toBe('SSO 用户不能修改密码')
    ;(globalThis as any).__setUserAccountProfileMock?.({ authProvider: 'local' })
    await store.refreshUserAccount()
    expect(await store.resetUserPassword('Aa123456!')).toBe(true)
    expect(store.userNotice).toBe('密码重置成功')
    expect(store.userProfile.passwordUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.updatePrivacySettings({ telemetry: 'disabled', secretRedaction: 'enabled' })).resolves.toBe(true)
    expect(store.privacySettings.telemetry).toBe('disabled')
    expect(store.privacySettings.secretRedaction).toBe('enabled')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        privacy: {
          telemetry: 'disabled',
          secretRedaction: 'enabled',
          dataSync: 'disabled'
        }
      })
    )
    vi.mocked(window.aiops.saveConfig).mockClear()
    await expect(store.updatePrivacySettings({ deactivateModalOpen: true })).resolves.toBe(true)
    expect(store.privacySettings.deactivateModalOpen).toBe(true)
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()

    const latestCheck = store.checkAboutUpdate()
    expect(store.aboutSettings.updateStatus).toBe('checking')
    await latestCheck
    expect(store.aboutSettings.updateStatus).toBe('latest')
    expect(window.aiops.checkUpdate).toHaveBeenCalled()
    expect(window.aiops.openExternalUrl).not.toHaveBeenCalledWith('https://aiopsterm.local/docs')

    store.setActiveSettingsSection('docs')
    await Promise.resolve()
    expect(store.activeSettingsSection).toBe('general')
    expect(window.aiops.openExternalUrl).toHaveBeenCalledWith('https://aiopsterm.local/docs')

    await store.openSettingsExternalAction('日志目录')
    expect(window.aiops.openLogDir).toHaveBeenCalled()
    expect(store.settingsNotice).toBe('日志目录已打开')
    await store.openSettingsExternalAction('反馈页面')
    expect(window.aiops.openExternalUrl).toHaveBeenCalledWith('https://aiopsterm.local/feedback')
    expect(store.settingsNotice).toBe('反馈页面已打开')
    await expect(store.openSettingsExternalAction('账户中心')).resolves.toBe(true)
    expect(window.aiops.getUserAccount).toHaveBeenCalled()
    expect(store.activeModule).toBe('user')
    expect(store.userAccountCenterOpen).toBe(true)
    expect(store.settingsNotice).toBe('账号中心已打开')
    store.closeAccountCenter()

    vi.mocked(window.aiops.checkUpdate).mockResolvedValueOnce({
      available: true,
      channel: 'manual',
      isUpdateAvailable: true,
      updateInfo: { version: '0.1.1', channel: 'manual' }
    })
    await store.checkAboutUpdate()
    expect(store.aboutSettings.updateStatus).toBe('available')
    expect(store.aboutSettings.newVersion).toBe('0.1.1')
    await store.checkAboutUpdate()
    expect(store.aboutSettings.updateStatus).toBe('downloaded')
    expect(store.aboutSettings.progress).toBe(100)
    expect(window.aiops.downloadAppUpdate).toHaveBeenCalledWith('0.1.1')
    await store.checkAboutUpdate()
    expect(window.aiops.installAppUpdate).toHaveBeenCalledWith('0.1.1')
    expect(store.aboutSettings.updateStatus).toBe('latest')
    expect(store.aboutSettings.version).toBe('0.1.1')
  })

  it('does not fabricate Settings external action success when the preload bridge is unavailable or fails', async () => {
    const store = useWorkspaceStore()
    store.setActiveModule('settings')
    const originalAiops = {
      openExternalUrl: window.aiops.openExternalUrl,
      openLogDir: window.aiops.openLogDir,
      getUserAccount: window.aiops.getUserAccount
    }

    try {
      ;(window.aiops as any).openExternalUrl = undefined
      store.setActiveSettingsSection('docs')
      expect(store.activeSettingsSection).toBe('general')
      expect(store.settingsNotice).toBe('文档入口服务不可用')
      await expect(store.openSettingsExternalAction('反馈页面')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('反馈页面服务不可用')

      ;(window.aiops as any).openExternalUrl = originalAiops.openExternalUrl
      vi.mocked(window.aiops.openExternalUrl).mockRejectedValueOnce(new Error('external offline'))
      store.setActiveSettingsSection('docs')
      await Promise.resolve()
      expect(store.settingsNotice).toBe('文档入口打开失败')
      vi.mocked(window.aiops.openExternalUrl).mockRejectedValueOnce(new Error('feedback offline'))
      await expect(store.openSettingsExternalAction('反馈页面')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('反馈页面 打开失败')

      ;(window.aiops as any).openLogDir = undefined
      await expect(store.openSettingsExternalAction('日志目录')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('日志目录服务不可用')

      ;(window.aiops as any).openLogDir = originalAiops.openLogDir
      vi.mocked(window.aiops.openLogDir).mockRejectedValueOnce(new Error('log dir offline'))
      await expect(store.openSettingsExternalAction('日志目录')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('日志目录 打开失败')

      ;(window.aiops as any).getUserAccount = undefined
      await expect(store.openSettingsExternalAction('账户中心')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('账户中心服务不可用')
      expect(store.userAccountCenterOpen).toBe(false)
      expect(store.activeModule).toBe('settings')

      ;(window.aiops as any).getUserAccount = originalAiops.getUserAccount
      vi.mocked(window.aiops.getUserAccount).mockRejectedValueOnce(new Error('account offline'))
      await expect(store.openSettingsExternalAction('账户中心')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('账户中心打开失败')
      expect(store.userAccountCenterOpen).toBe(false)
      expect(store.activeModule).toBe('settings')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate app update checks, downloads, or installs when bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    const originalAiops = {
      checkUpdate: window.aiops.checkUpdate,
      downloadAppUpdate: window.aiops.downloadAppUpdate,
      installAppUpdate: window.aiops.installAppUpdate
    }

    try {
      ;(window.aiops as any).checkUpdate = undefined
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.settingsNotice).toBe('更新检查服务不可用')
      await expect(store.checkTopUpdate()).resolves.toBe(false)
      expect(store.topUpdateState).toBe('local')
      expect(store.topNotice).toBe('更新检查服务不可用')

      ;(window.aiops as any).checkUpdate = originalAiops.checkUpdate
      vi.mocked(window.aiops.checkUpdate!).mockResolvedValueOnce({
        available: true,
        channel: 'manual',
        isUpdateAvailable: true,
        updateInfo: { version: '0.2.0', channel: 'manual' }
      })
      await expect(store.checkAboutUpdate()).resolves.toBe(true)
      expect(store.aboutSettings.updateStatus).toBe('available')
      expect(store.aboutSettings.newVersion).toBe('0.2.0')

      ;(window.aiops as any).downloadAppUpdate = undefined
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.progress).toBe(0)
      expect(store.settingsNotice).toBe('更新下载服务不可用')
      expect(window.aiops.installAppUpdate).not.toHaveBeenCalled()

      ;(window.aiops as any).downloadAppUpdate = originalAiops.downloadAppUpdate
      store.aboutSettings.updateStatus = 'available'
      vi.mocked(window.aiops.downloadAppUpdate!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'APP_UPDATE_DOWNLOAD_OFFLINE',
        errorMessage: '下载后端离线'
      })
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.progress).toBe(0)
      expect(store.settingsNotice).toBe('下载后端离线')

      store.aboutSettings.updateStatus = 'available'
      vi.mocked(window.aiops.downloadAppUpdate!).mockRejectedValueOnce(new Error('download bridge offline'))
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.progress).toBe(0)
      expect(store.settingsNotice).toBe('download bridge offline')

      store.aboutSettings.updateStatus = 'downloaded'
      store.aboutSettings.newVersion = '0.2.0'
      ;(window.aiops as any).installAppUpdate = undefined
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.version).toBe('0.1.0')
      expect(store.aboutSettings.newVersion).toBe('0.2.0')
      expect(store.settingsNotice).toBe('更新安装服务不可用')

      ;(window.aiops as any).installAppUpdate = originalAiops.installAppUpdate
      store.aboutSettings.updateStatus = 'downloaded'
      vi.mocked(window.aiops.installAppUpdate!).mockResolvedValueOnce({
        ok: false,
        errorCode: 'APP_UPDATE_INSTALL_OFFLINE',
        errorMessage: '安装后端离线'
      })
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.version).toBe('0.1.0')
      expect(store.aboutSettings.newVersion).toBe('0.2.0')
      expect(store.settingsNotice).toBe('安装后端离线')

      store.aboutSettings.updateStatus = 'downloaded'
      vi.mocked(window.aiops.installAppUpdate!).mockRejectedValueOnce(new Error('install bridge offline'))
      await expect(store.checkAboutUpdate()).resolves.toBe(false)
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.aboutSettings.version).toBe('0.1.0')
      expect(store.aboutSettings.newVersion).toBe('0.2.0')
      expect(store.settingsNotice).toBe('install bridge offline')

      store.topUpdateState = 'available'
      store.aboutSettings.updateStatus = 'available'
      store.aboutSettings.newVersion = '0.2.0'
      ;(window.aiops as any).downloadAppUpdate = undefined
      vi.mocked(window.aiops.installAppUpdate!).mockClear()
      await store.handleTopUpdateClick()
      expect(store.topUpdateState).toBe('available')
      expect(store.aboutSettings.updateStatus).toBe('error')
      expect(store.topNotice).toBe('更新下载服务不可用')
      expect(window.aiops.installAppUpdate).not.toHaveBeenCalled()

      ;(window.aiops as any).downloadAppUpdate = originalAiops.downloadAppUpdate
      ;(window.aiops as any).installAppUpdate = undefined
      vi.mocked(window.aiops.downloadAppUpdate!).mockClear()
      store.topUpdateState = 'available'
      store.aboutSettings.updateStatus = 'available'
      await store.handleTopUpdateClick()
      expect(window.aiops.downloadAppUpdate).toHaveBeenCalledWith('0.2.0')
      expect(store.topUpdateState).toBe('available')
      expect(store.aboutSettings.updateStatus).toBe('downloaded')
      expect(store.aboutSettings.version).toBe('0.1.0')
      expect(store.topNotice).toBe('更新安装服务不可用')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate user login or logout state when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.refreshUserAccount()
    const profileBefore = { ...store.userProfile }
    const billingBefore = { ...store.billingSettings }
    const trustedDevicesBefore = store.trustedDevices.map((device) => ({ ...device }))
    const originalOpenLogin = window.aiops.openUserLogin
    const originalLogout = window.aiops.logoutUserAccount
    const originalRevokeTrustedDevice = window.aiops.revokeTrustedDevice

    try {
      ;(window.aiops as any).openUserLogin = undefined
      await expect(store.openUserLogin()).resolves.toBe(false)
      expect(store.activeModule).toBe('user')
      expect(store.userLoginTab).toBe('account')
      expect(store.userNotice).toBe('登录服务不可用')
      expect(store.userProfile).toEqual(profileBefore)
      expect(store.billingSettings).toEqual(billingBefore)

      ;(window.aiops as any).logoutUserAccount = undefined
      await expect(store.logoutUser()).resolves.toBe(false)
      expect(store.userNotice).toBe('登出服务不可用')
      expect(store.userProfile).toEqual(profileBefore)
      expect(store.billingSettings).toEqual(billingBefore)

      store.openTrustedDeviceRevoke(2)
      ;(window.aiops as any).revokeTrustedDevice = undefined
      await expect(store.confirmTrustedDeviceRevoke()).resolves.toBe(false)
      expect(store.userNotice).toBe('可信设备移除服务不可用')
      expect(store.trustedDevices).toEqual(trustedDevicesBefore)

      ;(window.aiops as any).revokeTrustedDevice = originalRevokeTrustedDevice
      vi.mocked(window.aiops.revokeTrustedDevice).mockRejectedValueOnce(new Error('trusted device offline'))
      await expect(store.confirmTrustedDeviceRevoke()).resolves.toBe(false)
      expect(store.userNotice).toBe('可信设备移除失败')
      expect(store.trustedDevices).toEqual(trustedDevicesBefore)
    } finally {
      ;(window.aiops as any).openUserLogin = originalOpenLogin
      ;(window.aiops as any).logoutUserAccount = originalLogout
      ;(window.aiops as any).revokeTrustedDevice = originalRevokeTrustedDevice
    }
  })

  it('does not fabricate user account writes when bridge operations are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshUserAccount()

    const originalAiops = {
      openUserLogin: window.aiops.openUserLogin,
      loginUserAccount: window.aiops.loginUserAccount,
      logoutUserAccount: window.aiops.logoutUserAccount,
      skipUserLogin: window.aiops.skipUserLogin,
      sendUserLoginCode: window.aiops.sendUserLoginCode,
      updateUserProfile: window.aiops.updateUserProfile,
      resetUserPassword: window.aiops.resetUserPassword,
      sendUserContactCode: window.aiops.sendUserContactCode,
      bindUserContact: window.aiops.bindUserContact
    }
    const profileBefore = JSON.stringify(store.userProfile)
    const billingBefore = JSON.stringify(store.billingSettings)

    try {
      ;(window.aiops as any).openUserLogin = originalAiops.openUserLogin
      vi.mocked(window.aiops.openUserLogin!).mockRejectedValueOnce(new Error('login window offline'))
      await expect(store.openUserLogin()).resolves.toBe(false)
      expect(store.userNotice).toBe('登录服务打开失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      expect(JSON.stringify(store.billingSettings)).toBe(billingBefore)

      ;(window.aiops as any).loginUserAccount = undefined
      await expect(store.loginUser()).resolves.toBe(false)
      expect(store.userNotice).toBe('账号登录服务不可用')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      await expect(store.loginWithAccount('ops_login', 'secret')).resolves.toBe(false)
      expect(store.userNotice).toBe('账号登录服务不可用')
      expect(store.userLoginLoading).toBe(false)
      await expect(store.loginWithEmail('login@example.local', '246810')).resolves.toBe(false)
      expect(store.userNotice).toBe('邮箱登录服务不可用')
      expect(store.userLoginLoading).toBe(false)
      await expect(store.loginWithMobile('13800000001', '135790')).resolves.toBe(false)
      expect(store.userNotice).toBe('手机号登录服务不可用')
      expect(store.userLoginLoading).toBe(false)
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)

      ;(window.aiops as any).loginUserAccount = originalAiops.loginUserAccount
      vi.mocked(window.aiops.loginUserAccount!).mockRejectedValueOnce(new Error('account auth offline'))
      await expect(store.loginWithAccount('ops_login', 'secret')).resolves.toBe(false)
      expect(store.userNotice).toBe('账号登录失败')
      expect(store.userLoginLoading).toBe(false)
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)

      ;(window.aiops as any).logoutUserAccount = originalAiops.logoutUserAccount
      vi.mocked(window.aiops.logoutUserAccount!).mockRejectedValueOnce(new Error('logout offline'))
      await expect(store.logoutUser()).resolves.toBe(false)
      expect(store.userNotice).toBe('登出失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      expect(JSON.stringify(store.billingSettings)).toBe(billingBefore)

      ;(window.aiops as any).skipUserLogin = undefined
      await expect(store.skipUserLogin()).resolves.toBe(false)
      expect(store.userNotice).toBe('跳过登录服务不可用')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      ;(window.aiops as any).skipUserLogin = originalAiops.skipUserLogin
      vi.mocked(window.aiops.skipUserLogin!).mockRejectedValueOnce(new Error('skip login offline'))
      await expect(store.skipUserLogin()).resolves.toBe(false)
      expect(store.userNotice).toBe('跳过登录失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)

      ;(window.aiops as any).sendUserLoginCode = undefined
      await expect(store.sendUserLoginCode('email', 'login@example.local')).resolves.toBe(false)
      expect(store.userNotice).toBe('登录验证码发送服务不可用')
      expect(store.userLoginCodeSending.email).toBe(false)
      expect(store.userLoginCodeCountdown.email).toBe(0)
      ;(window.aiops as any).sendUserLoginCode = originalAiops.sendUserLoginCode
      vi.mocked(window.aiops.sendUserLoginCode!).mockRejectedValueOnce(new Error('login code offline'))
      await expect(store.sendUserLoginCode('email', 'login@example.local')).resolves.toBe(false)
      expect(store.userNotice).toBe('登录验证码发送失败')
      expect(store.userLoginCodeSending.email).toBe(false)
      expect(store.userLoginCodeCountdown.email).toBe(0)

      ;(window.aiops as any).updateUserProfile = undefined
      await expect(store.updateUserProfile({ name: 'Local Fake', username: 'local_fake' })).resolves.toBe(false)
      expect(store.userNotice).toBe('用户资料保存服务不可用')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      ;(window.aiops as any).updateUserProfile = originalAiops.updateUserProfile
      vi.mocked(window.aiops.updateUserProfile!).mockRejectedValueOnce(new Error('profile offline'))
      await expect(store.updateUserProfile({ name: 'Local Fake', username: 'local_fake' })).resolves.toBe(false)
      expect(store.userNotice).toBe('用户资料保存失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)

      ;(window.aiops as any).resetUserPassword = undefined
      await expect(store.resetUserPassword('Aa123456!')).resolves.toBe(false)
      expect(store.userNotice).toBe('密码重置服务不可用')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      ;(window.aiops as any).resetUserPassword = originalAiops.resetUserPassword
      vi.mocked(window.aiops.resetUserPassword!).mockRejectedValueOnce(new Error('password offline'))
      await expect(store.resetUserPassword('Aa123456!')).resolves.toBe(false)
      expect(store.userNotice).toBe('密码重置失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)

      ;(window.aiops as any).sendUserContactCode = undefined
      await expect(store.sendUserContactCode('email', 'ops@example.local')).resolves.toBe(false)
      expect(store.userNotice).toBe('联系方式验证码发送服务不可用')
      expect(store.userContactCodeSending.email).toBe(false)
      expect(store.userContactCodeCountdown.email).toBe(0)
      ;(window.aiops as any).sendUserContactCode = originalAiops.sendUserContactCode
      vi.mocked(window.aiops.sendUserContactCode!).mockRejectedValueOnce(new Error('contact code offline'))
      await expect(store.sendUserContactCode('email', 'ops@example.local')).resolves.toBe(false)
      expect(store.userNotice).toBe('联系方式验证码发送失败')
      expect(store.userContactCodeSending.email).toBe(false)
      expect(store.userContactCodeCountdown.email).toBe(0)

      ;(window.aiops as any).bindUserContact = undefined
      await expect(store.bindUserContact('email', 'ops@example.local', '123456')).resolves.toBe(false)
      expect(store.userNotice).toBe('联系方式绑定服务不可用')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
      ;(window.aiops as any).bindUserContact = originalAiops.bindUserContact
      vi.mocked(window.aiops.bindUserContact!).mockRejectedValueOnce(new Error('bind contact offline'))
      await expect(store.bindUserContact('email', 'ops@example.local', '123456')).resolves.toBe(false)
      expect(store.userNotice).toBe('联系方式绑定失败')
      expect(JSON.stringify(store.userProfile)).toBe(profileBefore)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Settings rules, shortcuts, or trusted-device writes when bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.hydrateConfig()

    const originalAiops = {
      saveSettingsRule: window.aiops.saveSettingsRule,
      deleteSettingsRule: window.aiops.deleteSettingsRule,
      saveSettingsShortcut: window.aiops.saveSettingsShortcut,
      resetSettingsShortcuts: window.aiops.resetSettingsShortcuts,
      revokeTrustedDevice: window.aiops.revokeTrustedDevice
    }

    try {
      const originalPersistedRules = JSON.stringify(store.config.rules)
      const originalShortcuts = JSON.stringify(store.settingsShortcuts)

      store.editSettingsRule('rule-1')
      store.updateSettingsRuleDraft('rule-1', 'local fake saved rule')
      ;(window.aiops as any).saveSettingsRule = undefined
      await expect(store.saveSettingsRule('rule-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则保存服务不可用')
      expect(JSON.stringify(store.config.rules)).toBe(originalPersistedRules)

      await store.hydrateConfig()
      ;(window.aiops as any).saveSettingsRule = originalAiops.saveSettingsRule
      vi.mocked(window.aiops.saveSettingsRule!).mockRejectedValueOnce(new Error('rules offline'))
      store.editSettingsRule('rule-1')
      store.updateSettingsRuleDraft('rule-1', 'backend rejected rule')
      await expect(store.saveSettingsRule('rule-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则保存失败')
      expect(JSON.stringify(store.config.rules)).toBe(originalPersistedRules)

      await store.hydrateConfig()
      ;(window.aiops as any).saveSettingsRule = undefined
      await expect(store.toggleSettingsRule('rule-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则更新服务不可用')
      expect(store.settingsRules.find((rule) => rule.id === 'rule-1')?.enabled).toBe(true)

      await store.hydrateConfig()
      ;(window.aiops as any).saveSettingsRule = originalAiops.saveSettingsRule
      ;(window.aiops as any).deleteSettingsRule = undefined
      store.editSettingsRule('rule-1')
      store.updateSettingsRuleDraft('rule-1', '')
      await expect(store.saveSettingsRule('rule-1')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则删除服务不可用')
      expect(store.config.rules?.some((rule) => rule.id === 'rule-1')).toBe(true)

      await store.hydrateConfig()
      await expect(store.deleteSettingsRule('rule-2')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则删除服务不可用')
      expect(store.settingsRules.some((rule) => rule.id === 'rule-2')).toBe(true)

      ;(window.aiops as any).deleteSettingsRule = originalAiops.deleteSettingsRule
      vi.mocked(window.aiops.deleteSettingsRule!).mockRejectedValueOnce(new Error('delete rule offline'))
      await expect(store.deleteSettingsRule('rule-2')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('规则删除失败')
      expect(store.settingsRules.some((rule) => rule.id === 'rule-2')).toBe(true)

      ;(window.aiops as any).saveSettingsShortcut = undefined
      store.startShortcutRecording('newTerminal')
      store.updateShortcutRecording('Ctrl+Shift+N')
      await expect(store.saveShortcutRecording()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('快捷键保存服务不可用')
      expect(JSON.stringify(store.settingsShortcuts)).toBe(originalShortcuts)
      store.cancelShortcutRecording()

      ;(window.aiops as any).saveSettingsShortcut = originalAiops.saveSettingsShortcut
      vi.mocked(window.aiops.saveSettingsShortcut!).mockRejectedValueOnce(new Error('shortcut offline'))
      store.startShortcutRecording('newTerminal')
      store.updateShortcutRecording('Ctrl+Shift+N')
      await expect(store.saveShortcutRecording()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('快捷键保存失败')
      expect(JSON.stringify(store.settingsShortcuts)).toBe(originalShortcuts)
      store.cancelShortcutRecording()

      store.startShortcutRecording('newTerminal')
      store.updateShortcutRecording('Ctrl+Shift+N')
      await expect(store.saveShortcutRecording()).resolves.toBe(true)
      const changedShortcuts = JSON.stringify(store.settingsShortcuts)

      ;(window.aiops as any).resetSettingsShortcuts = undefined
      await expect(store.resetAllShortcuts()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('快捷键重置服务不可用')
      expect(JSON.stringify(store.settingsShortcuts)).toBe(changedShortcuts)

      ;(window.aiops as any).resetSettingsShortcuts = originalAiops.resetSettingsShortcuts
      vi.mocked(window.aiops.resetSettingsShortcuts!).mockRejectedValueOnce(new Error('shortcut reset offline'))
      await expect(store.resetAllShortcuts()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('快捷键重置失败')
      expect(JSON.stringify(store.settingsShortcuts)).toBe(changedShortcuts)

      await store.refreshUserAccount()
      const trustedDevicesBefore = store.trustedDevices.map((device) => ({ ...device }))
      store.openTrustedDeviceRevoke(2)
      ;(window.aiops as any).revokeTrustedDevice = undefined
      await expect(store.confirmTrustedDeviceRevoke()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('可信设备移除服务不可用')
      expect(store.userNotice).toBe('可信设备移除服务不可用')
      expect(store.trustedDevices).toEqual(trustedDevicesBefore)

      ;(window.aiops as any).revokeTrustedDevice = originalAiops.revokeTrustedDevice
      vi.mocked(window.aiops.revokeTrustedDevice!).mockRejectedValueOnce(new Error('trusted device offline'))
      await expect(store.confirmTrustedDeviceRevoke()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('可信设备移除失败')
      expect(store.trustedDevices).toEqual(trustedDevicesBefore)
    } finally {
      Object.assign(window.aiops, originalAiops)
      store.cancelShortcutRecording()
    }
  })

  it('does not fabricate Skill operations when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.refreshSkillsFromBridge()

    const originalSkills = JSON.stringify(store.settingsSkills)
    const originalIncident = store.settingsSkills.find((skill) => skill.name === 'incident-triage')
    expect(originalIncident).toBeTruthy()

    const originalAiops = {
      createSkill: window.aiops.createSkill,
      updateSkill: window.aiops.updateSkill,
      setSkillEnabled: window.aiops.setSkillEnabled,
      deleteSkill: window.aiops.deleteSkill,
      readSkillContent: window.aiops.readSkillContent,
      reloadSkills: window.aiops.reloadSkills,
      openSkillsFolder: window.aiops.openSkillsFolder
    }

    try {
      ;(window.aiops as any).reloadSkills = undefined
      await expect(store.reloadSkills()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skills 重新加载服务不可用')
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      ;(window.aiops as any).openSkillsFolder = undefined
      await expect(store.openSkillsFolder()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skills 文件夹打开服务不可用')

      ;(window.aiops as any).readSkillContent = undefined
      await store.openSkillModal('edit', 'incident-triage')
      expect(store.skillModal.mode).toBeNull()
      expect(store.settingsNotice).toBe('Skill 内容读取服务不可用')
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      ;(window.aiops as any).createSkill = undefined
      await store.openSkillModal('create')
      store.skillModal.name = 'no-bridge-skill'
      store.skillModal.description = 'no bridge skill'
      store.skillModal.content = 'no bridge skill content'
      await expect(store.saveSkillModal()).resolves.toBe(false)
      expect(store.settingsSkills.some((skill) => skill.name === 'no-bridge-skill')).toBe(false)
      expect(store.settingsNotice).toBe('Skill 创建服务不可用')

      store.chatMessages.push({
        id: 'assistant-skill-no-bridge',
        role: 'assistant',
        text: 'Bridge missing reusable workflow',
        state: 'done'
      })
      await expect(store.summarizeMessageToSkill('assistant-skill-no-bridge')).resolves.toBeNull()
      expect(store.settingsSkills.some((skill) => skill.name.includes('bridge-missing-reusable'))).toBe(false)
      expect(store.settingsNotice).toBe('Skill 创建服务不可用')

      ;(window.aiops as any).updateSkill = undefined
      ;(window.aiops as any).readSkillContent = originalAiops.readSkillContent
      await store.openSkillModal('edit', 'incident-triage')
      store.skillModal.description = 'local fake edit'
      store.skillModal.content = 'local fake content'
      await expect(store.saveSkillModal()).resolves.toBe(false)
      expect(store.settingsSkills.find((skill) => skill.name === 'incident-triage')?.content).toBe(originalIncident?.content)
      expect(store.settingsNotice).toBe('Skill 保存服务不可用')

      ;(window.aiops as any).setSkillEnabled = undefined
      await store.toggleSkillEnabled('incident-triage')
      expect(store.settingsSkills.find((skill) => skill.name === 'incident-triage')?.enabled).toBe(originalIncident?.enabled)
      expect(store.settingsNotice).toBe('Skill 状态服务不可用')

      ;(window.aiops as any).deleteSkill = undefined
      await store.deleteSkill('incident-triage')
      expect(store.settingsSkills.some((skill) => skill.name === 'incident-triage')).toBe(true)
      expect(store.settingsNotice).toBe('Skill 删除服务不可用')
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate Skill ZIP import or export when bridge operations are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.refreshSkillsFromBridge()
    const originalSkills = JSON.stringify(store.settingsSkills)

    const originalAiops = {
      showOpenDialog: window.aiops.showOpenDialog,
      importSkillZip: window.aiops.importSkillZip,
      exportSkillZip: window.aiops.exportSkillZip,
      getSkills: window.aiops.getSkills
    }

    try {
      vi.mocked(window.aiops.showOpenDialog).mockClear()
      vi.mocked(window.aiops.importSkillZip).mockClear()
      vi.mocked(window.aiops.getSkills).mockClear()
      ;(window.aiops as any).showOpenDialog = undefined
      await expect(store.importSkillZip()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skill ZIP 选择服务不可用')
      expect(window.aiops.importSkillZip).not.toHaveBeenCalled()
      expect(window.aiops.getSkills).not.toHaveBeenCalled()
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      ;(window.aiops as any).showOpenDialog = originalAiops.showOpenDialog
      vi.mocked(window.aiops.showOpenDialog!).mockClear()
      ;(window.aiops as any).importSkillZip = undefined
      await expect(store.importSkillZip()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skill ZIP 导入服务不可用')
      expect(window.aiops.showOpenDialog).not.toHaveBeenCalled()
      expect(window.aiops.getSkills).not.toHaveBeenCalled()
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      ;(window.aiops as any).importSkillZip = originalAiops.importSkillZip
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/bad-skill.zip'] })
      vi.mocked(window.aiops.importSkillZip!).mockRejectedValueOnce(new Error('skill import offline'))
      await expect(store.importSkillZip()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skill ZIP 导入失败')
      expect(window.aiops.getSkills).not.toHaveBeenCalled()
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      vi.mocked(window.aiops.showOpenDialog!).mockClear()
      vi.mocked(window.aiops.importSkillZip!).mockClear()
      vi.mocked(window.aiops.showOpenDialog!).mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/existing-skill.zip'] })
      vi.mocked(window.aiops.importSkillZip!).mockResolvedValueOnce({
        success: false,
        errorCode: 'DIR_EXISTS',
        skillName: 'existing-skill'
      })
      await expect(store.importSkillZip()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skill 已存在，再次点击 Import 覆盖')
      ;(window.aiops as any).importSkillZip = undefined
      await expect(store.importSkillZip()).resolves.toBe(false)
      expect(store.settingsNotice).toBe('Skill ZIP 导入服务不可用')
      expect(JSON.stringify(store.settingsSkills)).toBe(originalSkills)

      ;(window.aiops as any).importSkillZip = originalAiops.importSkillZip
      vi.mocked(window.aiops.showOpenDialog!).mockClear()
      vi.mocked(window.aiops.importSkillZip!).mockClear()
      vi.mocked(window.aiops.importSkillZip!).mockResolvedValueOnce({ success: true, skillName: 'existing-skill' })
      vi.mocked(window.aiops.getSkills!).mockResolvedValueOnce([
        {
          name: 'existing-skill',
          description: 'Existing skill',
          enabled: true,
          editable: true,
          content: 'Existing content',
          path: '/tmp/aiopsterm/skills/existing-skill/SKILL.md'
        }
      ])
      await expect(store.importSkillZip()).resolves.toBe(true)
      expect(window.aiops.showOpenDialog).not.toHaveBeenCalled()
      expect(window.aiops.importSkillZip).toHaveBeenCalledWith('/tmp/existing-skill.zip', true)
      expect(store.settingsSkills.some((skill) => skill.name === 'existing-skill')).toBe(true)

      ;(window.aiops as any).exportSkillZip = undefined
      await expect(store.exportSkillZip('incident-triage')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('incident-triage ZIP 导出服务不可用')

      ;(window.aiops as any).exportSkillZip = originalAiops.exportSkillZip
      vi.mocked(window.aiops.exportSkillZip!).mockRejectedValueOnce(new Error('skill export offline'))
      await expect(store.exportSkillZip('incident-triage')).resolves.toBe(false)
      expect(store.settingsNotice).toBe('incident-triage ZIP 导出失败')
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not fabricate MCP writes when the preload bridge is unavailable', async () => {
    const store = useWorkspaceStore()
    await store.refreshMcpServersFromBridge()

    const originalServers = JSON.stringify(store.mcpServers)
    const originalFilesystem = store.mcpServers.find((server) => server.name === 'filesystem')
    expect(originalFilesystem).toBeTruthy()

    const originalAiops = {
      writeMcpConfig: window.aiops.writeMcpConfig,
      toggleMcpServer: window.aiops.toggleMcpServer,
      setMcpToolState: window.aiops.setMcpToolState,
      deleteMcpServer: window.aiops.deleteMcpServer
    }

    try {
      ;(window.aiops as any).writeMcpConfig = undefined
      await store.openMcpConfigEditor()
      store.updateMcpConfigEditorContent(
        JSON.stringify(
          {
            mcpServers: {
              filesystem: {
                type: 'stdio',
                disabled: true,
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
                timeout: 60
              }
            }
          },
          null,
          2
        )
      )
      await expect(store.saveMcpConfigEditor(true)).resolves.toBe(false)
      expect(store.settingsNotice).toBe('MCP 配置保存服务不可用')
      expect(JSON.stringify(store.mcpServers)).toBe(originalServers)
      store.closeMcpConfigEditor()

      ;(window.aiops as any).toggleMcpServer = undefined
      await expect(store.toggleMcpServerDisabled('filesystem')).resolves.toBe(false)
      expect(store.mcpServers.find((server) => server.name === 'filesystem')?.disabled).toBe(originalFilesystem?.disabled)
      expect(store.settingsNotice).toBe('MCP 状态服务不可用')

      ;(window.aiops as any).setMcpToolState = undefined
      await expect(store.toggleMcpTool('filesystem', 'read_file')).resolves.toBe(false)
      expect(store.mcpServers.find((server) => server.name === 'filesystem')?.tools.find((tool) => tool.name === 'read_file')?.enabled).toBe(true)
      expect(store.settingsNotice).toBe('MCP Tool 状态服务不可用')

      ;(window.aiops as any).deleteMcpServer = undefined
      await expect(store.deleteMcpServer('ops-inventory')).resolves.toBe(false)
      expect(store.mcpServers.some((server) => server.name === 'ops-inventory')).toBe(true)
      expect(store.settingsNotice).toBe('MCP 删除服务不可用')
      expect(JSON.stringify(store.mcpServers)).toBe(originalServers)
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('does not persist Settings JSON editor state when config file write bridges are unavailable or fail', async () => {
    const store = useWorkspaceStore()
    await store.openKeywordHighlightEditor()
    vi.mocked(window.aiops.saveConfig).mockClear()

    const originalAiops = {
      writeKeywordHighlightConfig: window.aiops.writeKeywordHighlightConfig,
      writeSecurityConfig: window.aiops.writeSecurityConfig
    }
    const originalKeywordSettings = JSON.stringify(store.keywordHighlightSettings)
    const keywordConfig = {
      'keyword-highlight': {
        enabled: true,
        applyTo: { output: false, input: true },
        rules: [
          {
            name: 'fatal',
            enabled: true,
            scope: 'output' as const,
            matchType: 'wildcard' as const,
            pattern: '*fatal*',
            style: { foreground: '#F87171', fontStyle: 'bold' as const }
          }
        ]
      }
    }
    const securityConfig = {
      security: {
        enableCommandSecurity: true,
        enableStrictMode: true,
        blacklistPatterns: ['curl metadata-service'],
        whitelistPatterns: ['ls'],
        dangerousCommands: ['shutdown'],
        maxCommandLength: 2048,
        securityPolicy: {
          blockCritical: true,
          askForMedium: false,
          askForHigh: true,
          askForBlacklist: false
        }
      }
    }

    try {
      store.updateKeywordHighlightEditorContent(JSON.stringify(keywordConfig, null, 2))
      ;(window.aiops as any).writeKeywordHighlightConfig = undefined
      await expect(store.saveKeywordHighlightEditor()).resolves.toBe(false)
      expect(store.keywordHighlightEditorError).toBe('Save failed: keyword highlight config service unavailable')
      expect(store.keywordHighlightEditorLastSaved).toBe(false)
      expect(JSON.stringify(store.keywordHighlightSettings)).toBe(originalKeywordSettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeKeywordHighlightConfig = originalAiops.writeKeywordHighlightConfig
      vi.mocked(window.aiops.writeKeywordHighlightConfig!).mockRejectedValueOnce(new Error('keyword file offline'))
      await expect(store.saveKeywordHighlightEditor()).resolves.toBe(false)
      expect(store.keywordHighlightEditorError).toBe('Save failed: keyword file offline')
      expect(JSON.stringify(store.keywordHighlightSettings)).toBe(originalKeywordSettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeKeywordHighlightConfig = undefined
      await expect(store.resetKeywordHighlightEditor()).resolves.toBe(false)
      expect(store.keywordHighlightEditorError).toBe('Reset failed: keyword highlight config service unavailable')
      expect(JSON.stringify(store.keywordHighlightSettings)).toBe(originalKeywordSettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeKeywordHighlightConfig = originalAiops.writeKeywordHighlightConfig
      vi.mocked(window.aiops.writeKeywordHighlightConfig!).mockRejectedValueOnce(new Error('keyword reset offline'))
      await expect(store.resetKeywordHighlightEditor()).resolves.toBe(false)
      expect(store.keywordHighlightEditorError).toBe('Reset failed: keyword reset offline')
      expect(JSON.stringify(store.keywordHighlightSettings)).toBe(originalKeywordSettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      await store.openSecurityConfigEditor()
      const originalSecuritySettings = JSON.stringify(store.securitySettings)
      store.updateSecurityConfigEditorContent(JSON.stringify(securityConfig, null, 2))
      ;(window.aiops as any).writeSecurityConfig = undefined
      await expect(store.saveSecurityConfigEditor()).resolves.toBe(false)
      expect(store.securityConfigEditorError).toBe('Save failed: security config service unavailable')
      expect(store.securityConfigEditorLastSaved).toBe(false)
      expect(JSON.stringify(store.securitySettings)).toBe(originalSecuritySettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeSecurityConfig = originalAiops.writeSecurityConfig
      vi.mocked(window.aiops.writeSecurityConfig!).mockRejectedValueOnce(new Error('security file offline'))
      await expect(store.saveSecurityConfigEditor()).resolves.toBe(false)
      expect(store.securityConfigEditorError).toBe('Save failed: security file offline')
      expect(JSON.stringify(store.securitySettings)).toBe(originalSecuritySettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeSecurityConfig = undefined
      await expect(store.resetSecurityConfigEditor()).resolves.toBe(false)
      expect(store.securityConfigEditorError).toBe('Reset failed: security config service unavailable')
      expect(JSON.stringify(store.securitySettings)).toBe(originalSecuritySettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()

      ;(window.aiops as any).writeSecurityConfig = originalAiops.writeSecurityConfig
      vi.mocked(window.aiops.writeSecurityConfig!).mockRejectedValueOnce(new Error('security reset offline'))
      await expect(store.resetSecurityConfigEditor()).resolves.toBe(false)
      expect(store.securityConfigEditorError).toBe('Reset failed: security reset offline')
      expect(JSON.stringify(store.securitySettings)).toBe(originalSecuritySettings)
      expect(window.aiops.saveConfig).not.toHaveBeenCalled()
    } finally {
      Object.assign(window.aiops, originalAiops)
    }
  })

  it('manages External reference-style onboarding guide, tour preparation, and completion state', () => {
    const store = useWorkspaceStore()

    store.openOnboardingGuide()
    expect(store.onboardingGuideOpen).toBe(true)
    expect(store.activeModule).toBe('settings')

    store.startOnboardingTour('systemSettings')
    expect(store.onboardingGuideOpen).toBe(false)
    expect(store.onboardingActiveTour).toBe('systemSettings')
    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('general')

    store.nextOnboardingStep()
    expect(store.onboardingActiveStepIndex).toBe(1)

    store.startOnboardingTour('addAndConnectHost')
    expect(store.activeModule).toBe('assets')
    expect(store.onboardingAssetRequest.action).toBe('none')
    store.nextOnboardingStep()
    expect(store.onboardingAssetRequest.action).toBe('open-host-management')
    store.nextOnboardingStep()
    expect(store.onboardingAssetRequest.action).toBe('open-host-management')
    store.nextOnboardingStep()
    expect(store.onboardingAssetRequest.action).toBe('open-create-form')
    store.jumpOnboardingStep('connect-asset')
    expect(store.onboardingActiveStep?.id).toBe('connect-asset')

    store.startOnboardingTour('aiChat')
    expect(store.rightPanelOpen).toBe(true)
    expect(store.activeModule).toBe('workspace')
    expect(store.onboardingActiveStep?.id).toBe('ai-sidebar-entry')

    while (store.onboardingActiveStep?.id !== 'ai-mode-agent') {
      store.nextOnboardingStep()
    }
    expect(store.onboardingAiRequest.action).toBe('open-mode')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('none')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('open-model')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('none')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('open-context-main')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('open-context-hosts')
    store.nextOnboardingStep()
    expect(store.onboardingAiRequest.action).toBe('prepare-send')

    while (store.onboardingActiveTour) {
      store.nextOnboardingStep()
    }
    expect(store.onboardingCompleted.aiChat).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        onboarding: expect.objectContaining({
          version: 2,
          completedModules: expect.objectContaining({ aiChat: true })
        })
      })
    )

    store.resetOnboarding()
    expect(store.onboardingCompleted.aiChat).toBe(false)
    expect(store.onboardingActiveTour).toBeNull()
    expect(store.config.onboarding?.guideTabAutoOpened).toBe(false)
  })

  it('routes self-owned aiopsterm protocol links into product shell state', () => {
    const store = useWorkspaceStore()

    store.handleDeepLink({
      url: 'aiopsterm://open/settings?section=mcp',
      action: 'open',
      target: 'settings',
      module: 'settings',
      settingsSection: 'mcp',
      acceptedAt: 1780490000000
    })
    expect(store.mode).toBe('terminal')
    expect(store.activeModule).toBe('settings')
    expect(store.activeSettingsSection).toBe('mcp')
    expect(store.rightPanelOpen).toBe(false)
    expect(store.topNotice).toContain('aiopsterm://')

    store.handleDeepLink({
      url: 'aiopsterm://open/files',
      action: 'open',
      target: 'files',
      module: 'files',
      acceptedAt: 1780490000100
    })
    expect(store.mode).toBe('terminal')
    expect(store.activeModule).toBe('files')
    expect(store.leftPanelOpen).toBe(true)
    expect(store.rightPanelOpen).toBe(true)

    store.handleDeepLink({
      url: 'aiopsterm://open?target=agents',
      action: 'open',
      target: 'agents',
      acceptedAt: 1780490000200
    })
    expect(store.mode).toBe('agents')
    expect(store.agentsLeftOpen).toBe(true)
  })
})
