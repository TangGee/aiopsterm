import { vi } from 'vitest'

const defaultQuickCommands = {
  groups: [
    { id: 1, uuid: 'group-monitor', group_name: '巡检命令' },
    { id: 2, uuid: 'group-service', group_name: '服务运维' }
  ],
  snippets: [
    {
      id: 1,
      uuid: 'snippet-disk',
      snippet_name: '磁盘巡检',
      snippet_content: 'df -h\nsleep==1000\ndu -sh * | sort -h',
      group_uuid: 'group-monitor',
      create_at: '2026-06-01 10:00',
      update_at: '2026-06-02 09:20'
    },
    {
      id: 2,
      uuid: 'snippet-load',
      snippet_name: '负载快照',
      snippet_content: "uptime\nprintf '\\n=== cpu ===\\n'\ntop -b -n 1 | head -n 20",
      group_uuid: 'group-monitor',
      create_at: '2026-06-01 10:10',
      update_at: '2026-06-02 09:25'
    },
    {
      id: 3,
      uuid: 'snippet-nginx',
      snippet_name: 'Nginx 状态',
      snippet_content: 'systemctl status nginx\njournalctl -u nginx --since "30 minutes ago" | tail -n 80',
      group_uuid: 'group-service',
      create_at: '2026-06-01 10:20',
      update_at: '2026-06-02 09:30'
    },
    {
      id: 4,
      uuid: 'snippet-root',
      snippet_name: '当前目录',
      snippet_content: 'pwd\nls -la',
      group_uuid: null,
      create_at: '2026-06-01 10:30',
      update_at: '2026-06-02 09:35'
    }
  ]
}

type TestKnowledgeNode = {
  id: string
  key: string
  relPath: string
  title: string
  type: 'file' | 'dir'
  size?: number
  children?: TestKnowledgeNode[]
}

const defaultKnowledgeBase: { tree: TestKnowledgeNode[]; usedBytes: number; totalBytes: number } = {
  tree: [
    {
      id: 'kb-dir-commands',
      key: 'commands',
      relPath: 'commands',
      title: 'commands',
      type: 'dir',
      children: [
        {
          id: 'kb-file-rollback-plan',
          key: 'commands/rollback-plan.md',
          relPath: 'commands/rollback-plan.md',
          title: 'rollback-plan.md',
          type: 'file',
          size: 16384
        },
        {
          id: 'kb-file-diagnose',
          key: 'commands/diagnose.md',
          relPath: 'commands/diagnose.md',
          title: 'diagnose.md',
          type: 'file',
          size: 12288
        },
        {
          id: 'kb-file-summary',
          key: 'commands/Summary to Doc.md',
          relPath: 'commands/Summary to Doc.md',
          title: 'Summary to Doc.md',
          type: 'file',
          size: 24576
        }
      ]
    },
    {
      id: 'kb-dir-images',
      key: 'images',
      relPath: 'images',
      title: 'images',
      type: 'dir',
      children: [
        {
          id: 'kb-file-interface',
          key: 'images/interface.png',
          relPath: 'images/interface.png',
          title: 'interface.png',
          type: 'file',
          size: 303104
        }
      ]
    },
    {
      id: 'kb-file-markdown',
      key: 'Markdown语法指南.md',
      relPath: 'Markdown语法指南.md',
      title: 'Markdown语法指南.md',
      type: 'file',
      size: 18432
    }
  ],
  usedBytes: 350208,
  totalBytes: 1073741824
}

const cloneKnowledgeTree = (nodes: TestKnowledgeNode[] = defaultKnowledgeBase.tree): TestKnowledgeNode[] =>
  nodes.map((node) => ({ ...node, children: node.children ? cloneKnowledgeTree(node.children as TestKnowledgeNode[]) : undefined }))

let knowledgeTreeMock = cloneKnowledgeTree()

Object.assign(globalThis, {
  __resetKnowledgeTreeMock: () => {
    knowledgeTreeMock = cloneKnowledgeTree()
  },
  __setKnowledgeTreeMock: (nodes: TestKnowledgeNode[]) => {
    knowledgeTreeMock = cloneKnowledgeTree(nodes)
  }
})

const getKnowledgeParent = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

const getKnowledgeName = (relPath: string) => relPath.split('/').filter(Boolean).at(-1) || relPath

const createKnowledgeRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

const findKnowledgeNodeMock = (relPath: string, nodes: TestKnowledgeNode[] = knowledgeTreeMock): TestKnowledgeNode | null => {
  for (const node of nodes) {
    if (node.relPath === relPath) return node
    if (node.children) {
      const hit = findKnowledgeNodeMock(relPath, node.children as TestKnowledgeNode[])
      if (hit) return hit
    }
  }
  return null
}

const removeKnowledgeNodeMock = (relPath: string, nodes: TestKnowledgeNode[] = knowledgeTreeMock): TestKnowledgeNode | null => {
  const index = nodes.findIndex((node) => node.relPath === relPath)
  if (index >= 0) {
    const [removed] = nodes.splice(index, 1)
    return removed
  }
  for (const node of nodes) {
    if (node.children) {
      const removed = removeKnowledgeNodeMock(relPath, node.children as TestKnowledgeNode[])
      if (removed) return removed
    }
  }
  return null
}

const insertKnowledgeNodeMock = (parentRelDir: string, node: TestKnowledgeNode) => {
  if (!parentRelDir) {
    knowledgeTreeMock.unshift(node)
    return
  }
  const parent = findKnowledgeNodeMock(parentRelDir)
  if (!parent || parent.type !== 'dir') return
  parent.children = (parent.children || []) as TestKnowledgeNode[]
  ;(parent.children as TestKnowledgeNode[]).unshift(node)
}

const updateKnowledgeNodePathsMock = (node: TestKnowledgeNode, oldPrefix: string, newPrefix: string) => {
  node.relPath = node.relPath.replace(oldPrefix, newPrefix)
  node.key = node.relPath
  node.title = getKnowledgeName(node.relPath)
  node.children?.forEach((child) => updateKnowledgeNodePathsMock(child, oldPrefix, newPrefix))
}

const listKnowledgeDirMock = (relDir: string) => {
  const source = relDir ? ((findKnowledgeNodeMock(relDir)?.children || []) as TestKnowledgeNode[]) : knowledgeTreeMock
  return source.map((node) => ({
    name: node.title,
    relPath: node.relPath,
    type: node.type,
    size: node.size,
    mtimeMs: 1717200000000
  }))
}

const createKnowledgeNodeMock = (kind: 'file' | 'dir', parentRelDir: string, name: string): TestKnowledgeNode => {
  const relPath = createKnowledgeRelPath(parentRelDir, name)
  const node: TestKnowledgeNode = {
    id: `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    key: relPath,
    relPath,
    title: name,
    type: kind,
    ...(kind === 'file' ? { size: 1024 } : { children: [] })
  }
  insertKnowledgeNodeMock(parentRelDir, node)
  return node
}

const cloneKnowledgeNodeWithPaths = (node: TestKnowledgeNode, dstRelDir: string): TestKnowledgeNode => {
  const cloned = cloneKnowledgeTree([node])[0]
  const nextRelPath = createKnowledgeRelPath(dstRelDir, cloned.title)
  updateKnowledgeNodePathsMock(cloned, cloned.relPath, nextRelPath)
  return cloned
}

const defaultAliasCommands = [
  { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 },
  { id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 1717286400000 },
  { id: 'alias-kctx', alias: 'kctx', command: 'kubectl config current-context', createdAt: 1717372800000 }
]

const defaultExtensionSettings = {
  autoCompleteStatus: true,
  quickVimStatus: true,
  aliasStatus: true,
  highlightStatus: true
}

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

const defaultKeywordHighlightContent = JSON.stringify(defaultKeywordHighlight, null, 2)

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

const defaultSecurityConfigContent = JSON.stringify(defaultSecurityConfig, null, 2)

const defaultPrivacy = {
  telemetry: 'enabled',
  secretRedaction: 'disabled',
  dataSync: 'disabled'
}

const defaultAiPreferences = {
  enableExtendedThinking: true,
  thinkingBudgetTokens: 4096,
  autoExecuteReadOnlyCommands: false,
  commandOutputFilteringEnabled: true,
  kbSearchEnabled: true,
  experienceExtractionEnabled: true,
  autoApproval: false,
  reasoningEffort: 'medium',
  needProxy: false,
  proxy: {
    type: 'HTTP',
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
  wordWrap: 'off',
  minimap: true,
  mouseWheelZoom: true
}

const defaultSshProxyConfigs: any[] = []

const defaultSshAgentKeys: any[] = []

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
      apiFormat: 'responses'
    }
  },
  options: [
    { name: 'gpt-5', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'gpt-5-Thinking', locked: true, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'ops-local-agent', locked: false, checked: true, type: 'standard', apiProvider: 'default' },
    { name: 'custom-maintenance', locked: false, checked: false, type: 'custom', apiProvider: 'openai' }
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

const cloneSkills = () => defaultSkills.map((skill) => ({ ...skill }))

const defaultMcpServers = [
  {
    name: 'filesystem',
    status: 'connected',
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
    status: 'error',
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

const defaultMcpConfigContent = JSON.stringify(
  {
    mcpServers: {
      filesystem: {
        type: 'stdio',
        disabled: false,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '~'],
        timeout: 60
      },
      'ops-inventory': {
        type: 'stdio',
        disabled: false,
        command: 'ops-inventory',
        args: [],
        timeout: 60
      }
    }
  },
  null,
  2
)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn(() => ({
    measureText: () => ({ width: 8 }),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: [] })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => []),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn()
  }))
})

Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    readText: vi.fn(async () => 'clipboard-command'),
    writeText: vi.fn(async () => undefined)
  }
})

Object.defineProperty(window, 'aiops', {
  writable: true,
  value: {
    platform: vi.fn(async () => 'linux'),
    shell: vi.fn(async () => '/bin/bash'),
    checkUpdate: vi.fn(async () => ({ available: false, channel: 'local' })),
    minimizeWindow: vi.fn(async () => undefined),
    maximizeWindow: vi.fn(async () => undefined),
    unmaximizeWindow: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => false),
    closeWindow: vi.fn(async () => undefined),
    onMaximized: vi.fn(() => () => undefined),
    onUnmaximized: vi.fn(() => () => undefined),
    getConfig: vi.fn(async () => ({
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
        expandedGroups: ['recent_connections', 'group-生产', 'group-预发', 'local_connections', 'org-1', 'custom-folder-a'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: defaultExtensionSettings,
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: defaultPrivacy,
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: defaultQuickCommands,
      knowledgeBase: defaultKnowledgeBase,
      aliasCommands: defaultAliasCommands,
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
    })),
    saveConfig: vi.fn(async (patch) => ({
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
        expandedGroups: ['recent_connections', 'group-生产', 'group-预发', 'local_connections', 'org-1', 'custom-folder-a'],
        showIpMode: false
      },
      editorSettings: defaultEditorSettings,
      sshProxyConfigs: defaultSshProxyConfigs,
      sshAgentKeys: defaultSshAgentKeys,
      extensionSettings: defaultExtensionSettings,
      keywordHighlight: defaultKeywordHighlight,
      securityConfig: defaultSecurityConfig,
      privacy: defaultPrivacy,
      aiPreferences: defaultAiPreferences,
      modelSettings: defaultModelSettings,
      shortcuts: defaultShortcuts,
      rules: defaultRules,
      skills: defaultSkills,
      mcpServers: defaultMcpServers,
      mcpToolStates: defaultMcpToolStates,
      quickCommands: defaultQuickCommands,
      knowledgeBase: defaultKnowledgeBase,
      aliasCommands: defaultAliasCommands,
      onboarding: {
        version: 2,
        guideTabAutoOpened: false,
        completedModules: {
          interfaceGuide: false,
          systemSettings: false,
          addAndConnectHost: false,
          aiChat: false
        }
      },
      ...patch
    })),
    getSecurityConfigPath: vi.fn(async () => '/tmp/aiopsterm/security-config.json'),
    readSecurityConfig: vi.fn(async () => defaultSecurityConfigContent),
    writeSecurityConfig: vi.fn(async () => undefined),
    onSecurityConfigFileChanged: vi.fn(() => () => undefined),
    getKeywordHighlightConfigPath: vi.fn(async () => '/tmp/aiopsterm/keyword-highlight.json'),
    readKeywordHighlightConfig: vi.fn(async () => defaultKeywordHighlightContent),
    writeKeywordHighlightConfig: vi.fn(async () => undefined),
    onKeywordHighlightConfigFileChanged: vi.fn(() => () => undefined),
    getMcpConfigPath: vi.fn(async () => '/tmp/aiopsterm/setting/mcp_settings.json'),
    readMcpConfig: vi.fn(async () => defaultMcpConfigContent),
    writeMcpConfig: vi.fn(async () => undefined),
    toggleMcpServer: vi.fn(async () => undefined),
    deleteMcpServer: vi.fn(async () => undefined),
    onMcpConfigFileChanged: vi.fn(() => () => undefined),
    getSkills: vi.fn(async () => cloneSkills()),
    getEnabledSkills: vi.fn(async () => cloneSkills().filter((skill) => skill.enabled)),
    setSkillEnabled: vi.fn(async () => undefined),
    getSkillsUserPath: vi.fn(async () => '/tmp/aiopsterm/skills'),
    reloadSkills: vi.fn(async () => cloneSkills()),
    createSkill: vi.fn(async (metadata, content) => ({
      name: metadata.name,
      description: metadata.description,
      enabled: true,
      editable: true,
      content,
      path: `/tmp/aiopsterm/skills/${metadata.name}/SKILL.md`
    })),
    deleteSkill: vi.fn(async () => undefined),
    openSkillsFolder: vi.fn(async () => undefined),
    importSkillZip: vi.fn(async () => ({ success: true, skillName: 'imported-skill' })),
    readSkillContent: vi.fn(async (skillName: string) => {
      const skill = defaultSkills.find((item) => item.name === skillName)
      return {
        metadata: {
          name: skillName,
          description: skill?.description || ''
        },
        content: skill?.content || ''
      }
    }),
    updateSkill: vi.fn(async () => undefined),
    exportSkillZip: vi.fn(async (skillName: string) => ({ success: true, filePath: `/tmp/${skillName}.zip` })),
    onSkillsUpdate: vi.fn(() => () => undefined),
    showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/imported-note.md'] })),
    showSaveDialog: vi.fn(async (options?: { defaultPath?: string }) => ({ canceled: false, filePath: `/tmp/${options?.defaultPath || 'downloaded-file'}` })),
    writeLocalFile: vi.fn(async () => undefined),
    stageChatAttachment: vi.fn(async ({ taskId, srcAbsPath }: { taskId: string; srcAbsPath: string }) => {
      const name = srcAbsPath.split(/[/\\]/).pop() || 'attachment.txt'
      return {
        mode: 'local' as const,
        refPath: `aiopsterm://chat-attachment/${encodeURIComponent(taskId)}/${encodeURIComponent(name)}`,
        name,
        size: 128,
        stagedPath: `/tmp/aiopsterm/chat-attachments/${taskId}/${name}`
      }
    }),
    kbCheckPath: vi.fn(async (absPath: string) => ({ exists: true, isDirectory: absPath.endsWith('/folder'), isFile: !absPath.endsWith('/folder') })),
    kbEnsureRoot: vi.fn(async () => ({ success: true })),
    kbGetRoot: vi.fn(async () => ({ root: '/tmp/aiopsterm/knowledgebase' })),
    kbListDir: vi.fn(async (relDir: string) => listKnowledgeDirMock(relDir)),
    kbReadFile: vi.fn(async (relPath: string, encoding?: 'utf-8' | 'base64') => ({
      content: encoding === 'base64' ? Buffer.from(relPath).toString('base64') : `content:${relPath}`,
      mtimeMs: 1717200000000,
      ...(encoding === 'base64' ? { mimeType: 'application/octet-stream', isImage: relPath.endsWith('.png') } : {})
    })),
    kbWriteFile: vi.fn(async () => ({ mtimeMs: 1717200000000 })),
    kbMkdir: vi.fn(async (relDir: string, name: string) => {
      const node = createKnowledgeNodeMock('dir', relDir, name)
      return { success: true, relPath: node.relPath }
    }),
    kbCreateFile: vi.fn(async (relDir: string, name: string) => {
      const node = createKnowledgeNodeMock('file', relDir, name)
      return { relPath: node.relPath }
    }),
    kbRename: vi.fn(async (relPath: string, newName: string) => {
      const node = findKnowledgeNodeMock(relPath)
      if (!node) throw new Error(`Missing node: ${relPath}`)
      const nextRelPath = createKnowledgeRelPath(getKnowledgeParent(relPath), newName)
      updateKnowledgeNodePathsMock(node, relPath, nextRelPath)
      return { relPath: nextRelPath }
    }),
    kbDelete: vi.fn(async (relPath: string) => {
      removeKnowledgeNodeMock(relPath)
      return { success: true }
    }),
    kbMove: vi.fn(async (srcRelPath: string, dstRelDir: string) => {
      const node = removeKnowledgeNodeMock(srcRelPath)
      if (!node) throw new Error(`Missing node: ${srcRelPath}`)
      updateKnowledgeNodePathsMock(node, srcRelPath, createKnowledgeRelPath(dstRelDir, node.title))
      insertKnowledgeNodeMock(dstRelDir, node)
      return { relPath: node.relPath }
    }),
    kbCopy: vi.fn(async (srcRelPath: string, dstRelDir: string) => {
      const node = findKnowledgeNodeMock(srcRelPath)
      if (!node) throw new Error(`Missing node: ${srcRelPath}`)
      const cloned = cloneKnowledgeNodeWithPaths(node, dstRelDir)
      insertKnowledgeNodeMock(dstRelDir, cloned)
      return { relPath: cloned.relPath }
    }),
    kbImportFile: vi.fn(async (srcAbsPath: string, dstRelDir: string) => {
      const name = getKnowledgeName(srcAbsPath)
      const node = createKnowledgeNodeMock('file', dstRelDir, name)
      return { jobId: 'kb-import-file', relPath: node.relPath }
    }),
    kbImportFolder: vi.fn(async (srcAbsPath: string, dstRelDir: string) => {
      const name = getKnowledgeName(srcAbsPath)
      const node = createKnowledgeNodeMock('dir', dstRelDir, name)
      return { jobId: 'kb-import-folder', relPath: node.relPath }
    }),
    onKbTransferProgress: vi.fn(() => () => undefined),
    createTerminal: vi.fn(async () => ({ id: 'test-session', shell: '/bin/bash', cwd: '/' })),
    writeTerminal: vi.fn(async () => undefined),
    resizeTerminal: vi.fn(async () => undefined),
    killTerminal: vi.fn(async () => undefined),
    listFiles: vi.fn(async (directory: string) => [
      { name: 'boot', path: `${directory.replace(/\/$/, '')}/boot`, type: 'directory', size: 0, modifiedAt: Date.now() },
      { name: '.hidden', path: `${directory.replace(/\/$/, '')}/.hidden`, type: 'file', size: 128, modifiedAt: Date.now() },
      { name: 'release-note.md', path: `${directory.replace(/\/$/, '')}/release-note.md`, type: 'file', size: 2048, modifiedAt: Date.now() }
    ]),
    onTerminalData: vi.fn(() => () => undefined),
    onTerminalExit: vi.fn(() => () => undefined)
  }
})
