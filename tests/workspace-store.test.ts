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
  shellIntegrationTimeout: 3000
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
    }
  },
  options: [
    { name: 'gpt-5', locked: true, checked: true, type: 'standard' as const, apiProvider: 'default' },
    { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard' as const, apiProvider: 'default' },
    { name: 'ops-local-agent', locked: false, checked: true, type: 'standard' as const, apiProvider: 'default' },
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
    content: 'When incident triage is requested, collect scope, blast radius, and recent deployments first.'
  },
  {
    name: 'k8s-rollout',
    description: 'Guide Kubernetes rollout inspection and rollback planning.',
    enabled: true,
    editable: true,
    content: 'Prefer kubectl describe, events, image pull checks, and rollback safety checks.'
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
    vi.useFakeTimers()
  })

  it('creates, renames, splits, and closes terminal panels', () => {
    const store = useWorkspaceStore()

    expect(store.panels).toHaveLength(1)
    store.createPanel('right')
    expect(store.panels).toHaveLength(2)
    expect(store.activePanel.split).toBe('right')

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

  it('switches modes and creates mock ai responses', async () => {
    const store = useWorkspaceStore()

    store.toggleMode()
    expect(store.mode).toBe('agents')
    expect(store.config.defaultMode).toBe('agents')
    expect(store.topNotice).toContain('Agents')
    store.toggleLeft()
    expect(store.agentsLeftOpen).toBe(false)
    store.toggleMode()
    expect(store.mode).toBe('terminal')
    store.toggleRight()
    expect(store.rightPanelOpen).toBe(false)
    store.setActiveModule('database')
    store.toggleRight()
    expect(store.rightPanelOpen).toBe(false)
    await store.checkTopUpdate()
    expect(store.topUpdateState).toBe('local')

    store.toggleContext({ id: 'skill:incident-triage', kind: 'skills', label: 'incident-triage', detail: 'Collect symptoms' })
    expect(store.aiSkillContextOptions.some((option) => option.id === 'skill:incident-triage')).toBe(true)
    store.sendChat('检查生产磁盘')
    expect(store.chatMessages.some((message) => message.role === 'user')).toBe(true)
    expect(store.chatMessages.at(-2)?.text).toContain('Skill Instructions')
    expect(store.chatMessages.at(-2)?.text).toContain('# Skill Activated: incident-triage')
    expect(store.chatMessages.at(-2)?.contentParts).toBeUndefined()
    expect(store.chatMessages.at(-1)?.text).toContain('Activated Skill: incident-triage')
    expect(store.chatMessages.at(-1)?.state).toBe('streaming')

    await vi.runAllTimersAsync()
    expect(store.chatMessages.at(-1)?.state).toBe('done')
  })

  it('keeps configuration changes in local state before bridge persistence', async () => {
    const store = useWorkspaceStore()

    await store.saveConfig({ theme: 'light', modelProvider: 'ollama', modelEndpoint: 'http://localhost:11434' })

    expect(store.config.theme).toBe('light')
    expect(store.config.modelProvider).toBe('ollama')
    expect(store.config.modelEndpoint).toBe('http://localhost:11434')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('hydrates and migrates persisted External reference-style onboarding completion state', async () => {
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
          usedBytes: 350208,
          totalBytes: 1073741824
        }),
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'll', command: 'ls -alF' })]),
        shortcuts: defaultShortcuts,
        rules: defaultRules,
        skills: defaultSkills,
        mcpServers: defaultMcpServers,
        mcpToolStates: defaultMcpToolStates,
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
  })

  it('migrates missing persisted terminal and workspace preferences to aiopsterm defaults', async () => {
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
          usedBytes: 350208,
          totalBytes: 1073741824
        }),
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'll' })]),
        shortcuts: defaultShortcuts,
        rules: defaultRules,
        skills: defaultSkills,
        mcpServers: defaultMcpServers,
        mcpToolStates: defaultMcpToolStates
      })
    )
  })

  it('hydrates and migrates External reference-style editor settings', async () => {
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
          id: ' key-prod-ed25519 ',
          fingerprint: ' SHA256:prod ',
          comment: ' prod-ed25519 ',
          keyType: ' ed25519 ',
          keyChainId: ' key-prod-ed25519 ',
          extra: true
        } as any,
        {
          id: 'key-prod-ed25519',
          fingerprint: 'SHA256:duplicate',
          comment: 'duplicate',
          keyType: 'RSA',
          keyChainId: 'key-prod-ed25519'
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
        id: 'key-prod-ed25519',
        fingerprint: 'SHA256:prod',
        comment: 'prod-ed25519',
        keyType: 'ED25519',
        keyChainId: 'key-prod-ed25519'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-prod-ed25519',
            fingerprint: 'SHA256:prod',
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-prod-ed25519'
          }
        ]
      })
    )
  })

  it('hydrates and migrates External reference-style user rules and legacy custom instructions', async () => {
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
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: '',
        rules: [
          { id: 'rule-custom-instructions', content: 'legacy global instruction', enabled: true },
          { id: 'rule-a', content: 'release must include rollback', enabled: false },
          { id: 'rule-a-2', content: 'inspect logs first', enabled: true }
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: [
          { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Alt+T' },
          { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Alt+A' },
          { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
          { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
        ]
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
            }
          },
          options: [{ name: 'custom-a', locked: false, checked: true, type: 'custom', apiProvider: 'openai' }]
        }
      })
    )
  })

  it('hydrates persisted External reference-style quick command groups and snippets', async () => {
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
      },
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
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('hydrates persisted External reference-style alias commands', async () => {
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
        { id: 'alias-hosts', alias: 'hosts', command: 'cat /etc/hosts', createdAt: 1780487400000 },
        { id: 'alias-df', alias: 'dfh', command: 'df -h', createdAt: 1780487401000 }
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

    expect(store.aliasCommands).toEqual([
      expect.objectContaining({ id: 'alias-hosts', alias: 'hosts', command: 'cat /etc/hosts', edit: false }),
      expect.objectContaining({ id: 'alias-df', alias: 'dfh', command: 'df -h', edit: false })
    ])
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()
  })

  it('hydrates External reference-referenced extension switches and hides Alias when disabled', async () => {
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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
      shellIntegrationTimeout: 3000
    })
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          thinkingBudgetTokens: 6553,
          autoApproval: true,
          reasoningEffort: 'medium',
          shellIntegrationTimeout: 3000,
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
      modelProvider: 'mock',
      modelEndpoint: '',
      modelName: 'mock-ops-agent',
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

    expect(store.sortedConversations[0].id).toBe('conv-1')
    store.selectConversation('conv-3')
    store.sendChat('排查慢查询')

    expect(store.sortedConversations[0].id).toBe('conv-3')
    expect(store.sortedConversations[0].summary).toBe('排查慢查询')

    await vi.runAllTimersAsync()
  })

  it('manages External reference-style context chips, command presets, message actions, and todos', async () => {
    const store = useWorkspaceStore()

    store.toggleContext({ id: 'doc-linux', kind: 'docs', label: 'Linux 巡检手册' })
    expect(store.selectedContexts.some((context) => context.id === 'doc-linux')).toBe(true)

    store.removeContext('doc-linux')
    expect(store.selectedContexts.some((context) => context.id === 'doc-linux')).toBe(false)

    store.applyCommandPreset('diagnose', '生成诊断计划')
    expect(store.selectedCommandId).toBe('diagnose')
    expect(store.chatMessages.at(-2)?.text).toContain('生成诊断计划')

    const assistant = store.chatMessages.find((message) => message.role === 'assistant')
    expect(assistant).toBeTruthy()
    store.toggleMessageFavorite(assistant!.id)
    store.setMessageFeedback(assistant!.id, 'up')
    expect(assistant!.favorite).toBe(true)
    expect(assistant!.feedback).toBe('up')

    expect(store.todoProgress.total).toBe(3)
    expect(store.todoProgress.completed).toBe(1)
    expect(store.todoProgress.percent).toBe(33)

    await vi.runAllTimersAsync()
  })

  it('manages External reference-style quick command scripts and macro snippets', () => {
    const store = useWorkspaceStore()

    expect(store.filteredQuickCommands.some((command) => command.snippet_name === '当前目录')).toBe(true)
    store.selectedSnippetGroupUuid = 'group-monitor'
    expect(store.filteredQuickCommands.every((command) => command.group_uuid === 'group-monitor')).toBe(true)

    store.runQuickCommand(1, false)
    expect(store.activePanel.output).toContain('df -h')
    expect(store.activePanel.output).toContain('du -sh * | sort -h')

    store.createQuickCommand({ snippet_name: '危险删除', snippet_content: 'rm /tmp/file', group_uuid: null })
    const dangerousSnippet = store.quickCommands.find((command) => command.snippet_name === '危险删除')!
    vi.mocked(window.aiops.saveConfig).mockClear()
    const decision = store.runQuickCommand(dangerousSnippet.id, true)
    expect(decision?.status).toBe('needs-approval')
    expect(store.terminalSecurityPrompt?.command).toBe('rm /tmp/file')
    expect(store.activePanel.output).not.toContain('[snippet] 危险删除')
    store.approveTerminalSecurityPrompt()
    expect(store.activePanel.output).toContain('[snippet] 危险删除')

    store.createSnippetGroup('发布命令')
    const group = store.snippetGroups.find((item) => item.group_name === '发布命令')
    expect(group).toBeTruthy()
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        quickCommands: expect.objectContaining({
          groups: expect.arrayContaining([expect.objectContaining({ uuid: group!.uuid, group_name: '发布命令' })])
        })
      })
    )

    store.createQuickCommand({ snippet_name: '回滚确认', snippet_content: 'echo rollback\nctrl+c', group_uuid: group!.uuid })
    expect(store.quickCommands.some((command) => command.snippet_name === '回滚确认')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        quickCommands: expect.objectContaining({
          snippets: expect.arrayContaining([expect.objectContaining({ snippet_name: '回滚确认', group_uuid: group!.uuid })])
        })
      })
    )

    const rollback = store.quickCommands.find((command) => command.snippet_name === '回滚确认')!
    store.updateQuickCommand(rollback.id, { snippet_name: '回滚确认更新', snippet_content: 'echo updated', group_uuid: null })
    expect(store.quickCommands.some((command) => command.snippet_name === '回滚确认更新' && command.group_uuid === null)).toBe(true)

    store.renameSnippetGroup(group!.uuid, '发布命令更新')
    expect(store.snippetGroups.find((item) => item.uuid === group!.uuid)?.group_name).toBe('发布命令更新')

    store.startMacroRecording()
    store.recordMacroCommand('uptime')
    store.stopMacroRecording()
    expect(store.quickCommands.some((command) => command.snippet_name.startsWith('macro-') && command.snippet_content.includes('uptime'))).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        quickCommands: expect.objectContaining({
          snippets: expect.arrayContaining([expect.objectContaining({ snippet_content: 'uptime' })])
        })
      })
    )

    const countBeforeEmptyMacro = store.quickCommands.length
    store.startMacroRecording()
    store.stopMacroRecording()
    expect(store.quickCommands).toHaveLength(countBeforeEmptyMacro)

    store.setMacroSleepThreshold(400)
    store.startMacroRecording('panel-main')
    store.recordMacroTerminalInput('panel-main', 'date', 1000)
    expect(store.macroCurrentLineBuffer).toBe('date')
    store.recordMacroTerminalInput('panel-main', '\b', 1100)
    store.recordMacroTerminalInput('panel-main', 'e\n', 1200)
    store.recordMacroTerminalInput('panel-main', '\x1b[A', 1700)
    store.recordMacroTerminalInput('other-panel', 'ignored\n', 1800)
    const savedMacro = store.stopMacroRecording()
    expect(savedMacro?.snippet_content).toBe('date\nsleep==500\nup')

    store.startMacroRecording('panel-main')
    for (let index = 0; index < 50; index += 1) {
      store.recordMacroCommand(`limit-${index}`, 2000 + index)
    }
    expect(store.isMacroRecording).toBe(false)
    expect(store.macroLimitReason).toBe('count')
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

    await store.addKnowledgeImportJob('Runbooks/imported-note.md', '/tmp/imported-note.md', 'file')
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

  it('adds External reference-style knowledge docs and images to AI context and includes them in chat payloads', async () => {
    const store = useWorkspaceStore()

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

    store.sendChat('生成知识库摘要')
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

    store.sendChat('检查回滚计划', [
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
    store.sendChat('按知识库命令执行')
    expect(store.chatMessages.at(-2)?.text).toContain('命令：/rollback-plan')
  })

  it('truncates a user message and resends edited ai content parts', async () => {
    const store = useWorkspaceStore()
    store.sendChat('旧消息', [{ type: 'text', text: '旧消息' }])
    const originalUserId = store.chatMessages.at(-2)?.id
    expect(originalUserId).toBeTruthy()
    expect(store.chatMessages.at(-1)?.role).toBe('assistant')

    const editedParts = [
      { type: 'text' as const, text: '新消息' },
      { type: 'chip' as const, chipType: 'command' as const, ref: { command: '/rollback-plan', label: '/rollback-plan' } }
    ]
    const sent = store.resendUserMessageFromParts(originalUserId!, editedParts)

    expect(sent).toBe(true)
    expect(store.chatMessages).toHaveLength(4)
    expect(store.chatMessages.find((message) => message.id === originalUserId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.role).toBe('user')
    expect(store.chatMessages.at(-2)?.contentParts).toEqual(editedParts)
    expect(store.chatMessages.at(-2)?.text).toContain('新消息/rollback-plan')
    expect(store.chatMessages.at(-1)?.role).toBe('assistant')
  })

  it('truncates and resends with edited host context without mutating selected contexts', async () => {
    const store = useWorkspaceStore()
    const originalSelectedContextIds = store.selectedContexts.map((context) => context.id)
    store.sendChat('旧主机检查', [{ type: 'text', text: '旧主机检查' }])
    const originalUserId = store.chatMessages.at(-2)?.id
    expect(store.chatMessages.at(-2)?.hosts?.map((context) => context.id)).toEqual(originalSelectedContextIds)

    const editedHosts = [{ id: 'opened-mysql', kind: 'hosts' as const, label: '10.32.6.9', detail: 'mysql-primary' }]
    const sent = store.resendUserMessageFromParts(originalUserId!, [{ type: 'text', text: '改查 MySQL 主机' }], editedHosts)

    expect(sent).toBe(true)
    expect(store.selectedContexts.map((context) => context.id)).toEqual(originalSelectedContextIds)
    expect(store.chatMessages.find((message) => message.id === originalUserId)).toBeUndefined()
    expect(store.chatMessages.at(-2)?.hosts).toEqual(editedHosts)
    expect(store.chatMessages.at(-2)?.text).toContain('hosts:10.32.6.9')
  })

  it('manages External reference-style extension plugin state and alias validation', async () => {
    const store = useWorkspaceStore()

    expect(store.filteredExtensionPlugins[0].name).toBe('Alias')
    store.updateExtensionSettings({ aliasStatus: false })
    expect(store.filteredExtensionPlugins.some((plugin) => plugin.pluginId === 'Alias')).toBe(false)
    store.updateExtensionSettings({ aliasStatus: true })
    expect(store.filteredExtensionPlugins[0].name).toBe('Alias')

    store.installExtensionPlugin('cloud-assets')
    expect(store.extensionInstallLoadingMap['cloud-assets']).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    expect(store.extensionPlugins.find((plugin) => plugin.pluginId === 'cloud-assets')?.installed).toBe(true)

    store.updateExtensionPlugin('ops-runbook')
    expect(store.extensionUpdateLoadingMap['ops-runbook']).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    expect(store.extensionPlugins.find((plugin) => plugin.pluginId === 'ops-runbook')?.hasUpdate).toBe(false)

    store.subscribeExtensionPlugin('private-automation-pack')
    expect(store.extensionNotice).toContain('订阅')

    expect(store.dropExtensionPackage('bad.zip')).toBe(false)
    expect(store.extensionNotice).toContain('.external-reference')
    expect(store.dropExtensionPackage('local-pack.external-reference')).toBe(true)
    expect(store.selectedExtensionId).toContain('local-local-pack')

    store.createAliasCommand()
    store.updateAliasDraft('new', { alias: 'll', command: 'ls' })
    expect(store.saveAliasCommand('new').reason).toBe('duplicate')
    store.updateAliasDraft('new', { alias: 'hosts', command: 'cat /etc/hosts' })
    expect(store.saveAliasCommand('new').ok).toBe(true)
    expect(store.aliasCommands.some((alias) => alias.alias === 'hosts')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'hosts', command: 'cat /etc/hosts' })])
      })
    )

    const hosts = store.aliasCommands.find((alias) => alias.alias === 'hosts')!
    store.startAliasEdit(hosts.id)
    store.updateAliasDraft(hosts.id, { alias: 'hostsfile', command: 'cat /etc/hosts | head' })
    expect(store.saveAliasCommand(hosts.id).ok).toBe(true)
    expect(store.aliasCommands.some((alias) => alias.alias === 'hostsfile' && alias.command === 'cat /etc/hosts | head')).toBe(true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.arrayContaining([expect.objectContaining({ alias: 'hostsfile', command: 'cat /etc/hosts | head' })])
      })
    )

    store.deleteAliasCommand(hosts.id)
    expect(store.aliasCommands.some((alias) => alias.alias === 'hostsfile')).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasCommands: expect.not.arrayContaining([expect.objectContaining({ alias: 'hostsfile' })])
      })
    )
  })

  it('manages External reference-style Kubernetes contexts, clusters, terminals, and bastion sync', async () => {
    vi.useFakeTimers()
    const store = useWorkspaceStore()
    try {

    store.switchK8sContext('staging/devops')
    expect(store.k8sContexts.find((context) => context.name === 'staging/devops')?.isActive).toBe(true)

    store.connectK8sCluster('k8s-2')
    expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(280)
    expect(store.k8sActiveClusterId).toBe('k8s-2')
    expect(store.k8sClusters.find((cluster) => cluster.id === 'k8s-2')?.connection_status).toBe('connected')

    store.openK8sTerminal('k8s-2')
    expect(store.k8sActiveTerminal?.clusterId).toBe('k8s-2')
    store.sendK8sTerminalCommand('kubectl get ns')
    expect(store.k8sActiveTerminal?.output).toContain('[mock kubectl] kubectl get ns')

    const added = store.addK8sCluster({
      name: 'qa-cluster',
      contextName: 'qa/dev',
      serverUrl: 'https://qa.k8s.local:6443',
      defaultNamespace: 'qa'
    })
    expect(added?.id).toMatch(/^k8s-/)
    expect(store.k8sSelectedClusterId).toBe(added?.id)

    store.updateK8sCluster(added!.id, { name: 'qa-renamed', autoConnect: true })
    expect(store.k8sClusters.find((cluster) => cluster.id === added!.id)?.name).toBe('qa-renamed')
    expect(store.k8sClusters.find((cluster) => cluster.id === added!.id)?.auto_connect).toBe(1)

    const beforeSync = store.k8sClusters.length
    store.syncK8sBastion('org-prod')
    expect(store.k8sSyncingBastionIds).toContain('org-prod')
    await vi.advanceTimersByTimeAsync(320)
    expect(store.k8sClusters.length).toBeGreaterThan(beforeSync)

    store.deleteK8sCluster(added!.id)
    expect(store.k8sClusters.some((cluster) => cluster.id === added!.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('manages External reference-style settings state for general, terminal, model, and AI preferences', async () => {
    const store = useWorkspaceStore()

    store.setActiveSettingsSection('terminal')
    expect(store.activeSettingsSection).toBe('terminal')

    store.selectBackground('preset', 'star-field')
    expect(store.config.background.mode).toBe('preset')
    expect(store.config.background.image).toBe('star-field')
    store.updateBackgroundTuning({ opacity: 0.35, brightness: 0.8 })
    expect(store.config.background.opacity).toBe(0.35)
    expect(store.config.background.brightness).toBe(0.8)

    store.updateTerminalSettings({ terminalType: 'vt220', cursorStyle: 'underline', showCloseButton: false })
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
    store.updateEditorSettings({ fontSize: 18, lineHeight: 24, wordWrap: 'on', minimap: false, mouseWheelZoom: false })
    expect(store.editorSettings).toEqual({
      fontSize: 18,
      lineHeight: 24,
      fontFamily: 'cascadia-mono',
      tabSize: 4,
      wordWrap: 'on',
      minimap: false,
      mouseWheelZoom: false
    })
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
    expect(store.saveSshProxyForm()).toBe(true)
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
    expect(store.saveSshProxyForm()).toBe(false)
    expect(store.settingsNotice).toContain('请输入代理配置名称')
    expect(store.removeSshProxyConfig('release-proxy')).toBe(true)
    expect(store.sshProxyConfigs).toEqual([])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshProxyConfigs: []
      })
    )
    store.closeSshProxyConfig()
    expect(store.sshProxyConfigModalOpen).toBe(false)

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.updateTerminalSettings({ sshAgentsStatus: true })
    expect(store.terminalSettings.sshAgentsStatus).toBe(true)
    store.openSshAgentConfig()
    expect(store.sshAgentConfigModalOpen).toBe(true)
    store.setSshAgentSelectedKey('key-prod-ed25519')
    expect(store.addSshAgentKey()).toBe(true)
    expect(store.sshAgentKeys).toEqual([
      {
        id: 'key-prod-ed25519',
        fingerprint: 'SHA256:6qY8zR2aQ0prodEd25519',
        comment: 'prod-ed25519',
        keyType: 'ED25519',
        keyChainId: 'key-prod-ed25519'
      }
    ])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: [
          {
            id: 'key-prod-ed25519',
            fingerprint: 'SHA256:6qY8zR2aQ0prodEd25519',
            comment: 'prod-ed25519',
            keyType: 'ED25519',
            keyChainId: 'key-prod-ed25519'
          }
        ]
      })
    )
    expect(store.addSshAgentKey()).toBe(false)
    expect(store.settingsNotice).toContain('请选择密钥')
    vi.mocked(window.aiops.saveConfig).mockClear()
    expect(store.removeSshAgentKey('key-prod-ed25519')).toBe(true)
    expect(store.sshAgentKeys).toEqual([])
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        sshAgentKeys: []
      })
    )
    store.closeSshAgentConfig()
    expect(store.sshAgentConfigModalOpen).toBe(false)

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
    store.saveModelProvider('openai')
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
    store.updateModelOption('ops-local-agent', false)
    expect(store.settingModelOptions.find((model) => model.name === 'ops-local-agent')?.checked).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          options: expect.arrayContaining([expect.objectContaining({ name: 'ops-local-agent', checked: false })])
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
    store.updateAiPreferences({ needProxy: true, proxy: { host: '10.0.0.2', port: 8080 } })
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

    store.updateAiPreferences({ thinkingBudgetTokens: 5000, reasoningEffort: 'high', shellIntegrationTimeout: 120 })
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
    store.updateAiPreferences({ autoApproval: true })
    expect(store.aiPreferences.autoApproval).toBe(true)
    expect(store.onboardingAutoApprovalEvent).toBe(1)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        aiPreferences: expect.objectContaining({
          autoApproval: true
        })
      })
    )
    store.updateAiPreferences({ autoApproval: true })
    expect(store.onboardingAutoApprovalEvent).toBe(1)
  })

  it('manages remaining External reference-style settings lists and toggles', async () => {
    const store = useWorkspaceStore()

    store.selectExtension('Alias')
    expect(store.selectedExtensionId).toBe('Alias')
    store.updateExtensionSettings({ aliasStatus: false })
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
    store.updateExtensionSettings({ aliasStatus: true })
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

    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.toggleMcpServer).mockClear()
    await store.toggleMcpServerDisabled('filesystem')
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.disabled).toBe(true)
    expect(window.aiops.toggleMcpServer).toHaveBeenCalledWith('filesystem', true)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: expect.arrayContaining([expect.objectContaining({ name: 'filesystem', status: 'disabled', disabled: true })]),
        mcpToolStates: expect.objectContaining({
          'filesystem:read_file': true
        })
      })
    )
    vi.mocked(window.aiops.saveConfig).mockClear()
    store.toggleMcpTool('filesystem', 'read_file')
    expect(store.mcpServers.find((server) => server.name === 'filesystem')?.tools.find((tool) => tool.name === 'read_file')?.enabled).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpToolStates: expect.objectContaining({
          'filesystem:read_file': false
        })
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    vi.mocked(window.aiops.deleteMcpServer).mockClear()
    await store.deleteMcpServer('ops-inventory')
    expect(store.mcpServers.some((server) => server.name === 'ops-inventory')).toBe(false)
    expect(window.aiops.deleteMcpServer).toHaveBeenCalledWith('ops-inventory')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: expect.not.arrayContaining([expect.objectContaining({ name: 'ops-inventory' })]),
        mcpToolStates: expect.not.objectContaining({
          'ops-inventory:lookup_asset': expect.any(Boolean)
        })
      })
    )

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
    store.updateSettingsRuleDraft(rule.id, 'must ask before restart')
    expect(store.saveSettingsRule(rule.id)).toBe(true)
    expect(store.settingsRules[0].content).toBe('must ask before restart')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: '',
        rules: expect.arrayContaining([expect.objectContaining({ id: rule.id, content: 'must ask before restart', enabled: true })])
      })
    )

    store.editSettingsRule(rule.id)
    store.updateSettingsRuleDraft(rule.id, 'discard this draft')
    store.cancelSettingsRuleEdit(rule.id)
    expect(store.settingsRules.find((item) => item.id === rule.id)?.content).toBe('must ask before restart')

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.toggleSettingsRule(rule.id)
    expect(store.settingsRules.find((item) => item.id === rule.id)?.enabled).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: expect.arrayContaining([expect.objectContaining({ id: rule.id, content: 'must ask before restart', enabled: false })])
      })
    )

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.deleteSettingsRule(rule.id)
    expect(store.settingsRules.some((item) => item.id === rule.id)).toBe(false)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: expect.not.arrayContaining([expect.objectContaining({ id: rule.id })])
      })
    )

    store.startShortcutRecording('newTerminal')
    store.updateShortcutRecording('Ctrl+Shift+N')
    expect(store.saveShortcutRecording()).toBe(true)
    expect(store.settingsShortcuts.find((shortcut) => shortcut.id === 'newTerminal')?.shortcut).toBe('Ctrl+Shift+N')
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: expect.arrayContaining([expect.objectContaining({ id: 'newTerminal', shortcut: 'Ctrl+Shift+N' })])
      })
    )

    store.startShortcutRecording('quickCommand')
    store.updateShortcutRecording('Ctrl+Shift+N')
    expect(store.saveShortcutRecording()).toBe(false)
    expect(store.settingsNotice).toBe('快捷键已被占用')

    store.startShortcutRecording('switchToSpecificTab')
    store.updateShortcutRecording('Alt+1')
    expect(store.saveShortcutRecording()).toBe(false)
    expect(store.settingsNotice).toBe('快捷键格式无效')

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.resetAllShortcuts()
    expect(store.settingsShortcuts).toEqual(defaultShortcuts)
    expect(window.aiops.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcuts: defaultShortcuts
      })
    )

    store.openTrustedDeviceRevoke(2)
    expect(store.trustedDeviceModal.open).toBe(true)
    store.confirmTrustedDeviceRevoke()
    expect(store.trustedDevices.some((device) => device.id === 2)).toBe(false)

    vi.mocked(window.aiops.saveConfig).mockClear()
    store.updatePrivacySettings({ telemetry: 'disabled', secretRedaction: 'enabled' })
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
    store.updatePrivacySettings({ deactivateModalOpen: true })
    expect(store.privacySettings.deactivateModalOpen).toBe(true)
    expect(window.aiops.saveConfig).not.toHaveBeenCalled()

    store.checkAboutUpdate()
    expect(store.aboutSettings.updateStatus).toBe('checking')
    await vi.runOnlyPendingTimersAsync()
    expect(store.aboutSettings.updateStatus).toBe('latest')
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
})
