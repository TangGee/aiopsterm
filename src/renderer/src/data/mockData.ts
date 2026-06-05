import type { Component } from 'vue'
import {
  Boxes,
  Bot,
  BookOpen,
  Box,
  Cloud,
  Code2,
  CreditCard,
  Database,
  FileText,
  FolderGit2,
  Globe2,
  Info,
  KeyRound,
  Keyboard,
  Lock,
  Monitor,
  Plug,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
  Zap,
  UserCircle
} from 'lucide-vue-next'

export type ModuleKey =
  | 'workspace'
  | 'assets'
  | 'files'
  | 'snippets'
  | 'knowledge'
  | 'extensions'
  | 'kubernetes'
  | 'database'
  | 'settings'
  | 'user'

export type MenuItem = {
  key: ModuleKey
  label: string
  icon: Component
  position: 'main' | 'bottom'
}

export const menuItems: MenuItem[] = [
  { key: 'workspace', label: '工作区', icon: Server, position: 'main' },
  { key: 'assets', label: '资产', icon: Cloud, position: 'main' },
  { key: 'files', label: '文件', icon: FolderGit2, position: 'main' },
  { key: 'snippets', label: '片段', icon: Code2, position: 'main' },
  { key: 'knowledge', label: '知识库', icon: FileText, position: 'main' },
  { key: 'extensions', label: '扩展', icon: Plug, position: 'main' },
  { key: 'kubernetes', label: 'Kubernetes', icon: Boxes, position: 'main' },
  { key: 'database', label: '数据库', icon: Database, position: 'main' },
  { key: 'settings', label: '设置', icon: Settings, position: 'bottom' },
  { key: 'user', label: '用户', icon: UserCircle, position: 'bottom' }
]

export type SettingSectionKey =
  | 'general'
  | 'terminal'
  | 'extensions'
  | 'models'
  | 'billing'
  | 'ai'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'shortcuts'
  | 'trustedDevices'
  | 'privacy'
  | 'about'
  | 'docs'

export type SettingsNavItem = {
  key: SettingSectionKey
  label: string
  icon: Component
  external?: boolean
}

export type OnboardingModuleId = 'interfaceGuide' | 'systemSettings' | 'addAndConnectHost' | 'aiChat'

export type OnboardingStep = {
  id: string
  targetId: string
  title: string
  description: string
  hideCard?: boolean
  highlightTargetIds?: string[]
  advanceOnTargetClick?: boolean
  advanceOnTargetIds?: string[]
  advanceOnEvent?: 'onboarding:autoApprovalEnabled'
  requiresTargetClick?: boolean
  allowNextWithoutTargetClick?: boolean
}

export type OnboardingModule = {
  id: OnboardingModuleId
  title: string
  description: string
  icon: Component
}

export const onboardingModules: OnboardingModule[] = [
  {
    id: 'interfaceGuide',
    title: '界面导览',
    description: '认识左侧模块栏、功能面板、主工作区、顶部布局控制和 AI 侧栏。',
    icon: Monitor
  },
  {
    id: 'systemSettings',
    title: '系统设置',
    description: '浏览通用设置、背景、终端配置和 AI 偏好设置。',
    icon: Settings
  },
  {
    id: 'addAndConnectHost',
    title: '添加并连接主机',
    description: '从资产入口进入主机管理，创建主机并使用资产卡片连接。',
    icon: Cloud
  },
  {
    id: 'aiChat',
    title: 'AI 会话',
    description: '打开 AI 侧栏，添加上下文，选择命令并发送运维目标。',
    icon: Bot
  }
]

export const onboardingTourSteps: Record<OnboardingModuleId, OnboardingStep[]> = {
  interfaceGuide: [
    { id: 'module-switcher', targetId: 'left-module-switcher', title: '模块切换栏', description: '这里切换工作区、资产、文件、知识库、插件、Kubernetes、数据库等入口。' },
    { id: 'function-panel', targetId: 'left-function-panel', title: '左侧功能面板', description: '当前模块的资源树、搜索、分组和快捷操作集中在这里。' },
    { id: 'workspace', targetId: 'main-workspace-tabs', title: '主工作区', description: '终端标签、中央页面和主要操作结果显示在主工作区。' },
    { id: 'top-controls', targetId: 'top-layout-controls', title: '顶部布局控制', description: '这里切换 Terminal/Agents 模式、折叠侧栏、控制 AI 面板和窗口。' },
    { id: 'ai-toggle', targetId: 'right-ai-toggle', title: 'AI 面板开关', description: '点击可展开或收起右侧 AI 助手。', advanceOnTargetClick: true },
    { id: 'ai-sidebar', targetId: 'right-ai-sidebar', title: 'AI 侧栏', description: 'AI 侧栏用于上下文、命令、任务进度和运维对话。' }
  ],
  systemSettings: [
    { id: 'setting-entry', targetId: 'setting-entry', title: '设置入口', description: '底部设置入口会打开中央设置工作区。' },
    { id: 'settings-side-nav', targetId: 'settings-side-nav', title: '设置导航', description: '左侧导航切换通用、终端、模型、AI 偏好、MCP、Skills 等设置页。' },
    { id: 'general-settings', targetId: 'settings-general-content', title: '通用设置', description: '通用页包含主题、背景、默认布局、语言、水印和入门引导。' },
    { id: 'background-settings', targetId: 'settings-background-section', title: '背景设置', description: '背景区域可选择默认、预设或自定义背景，并调整透明度和亮度。' },
    { id: 'background-preset', targetId: 'settings-background-preset', title: '背景预设', description: '选择预设后会显示调节滑杆。', hideCard: true, advanceOnTargetClick: true },
    { id: 'terminal-tab', targetId: 'settings-terminal-tab', title: '终端设置标签', description: '终端页提供终端类型、字体、光标、鼠标事件和 SSH Agent 入口。' },
    { id: 'terminal-options', targetId: 'settings-terminal-options', title: '终端选项', description: '这里调整字体大小、ScrollBack、光标样式和代理等终端参数。' },
    { id: 'ai-preferences-tab', targetId: 'settings-ai-preferences-tab', title: 'AI 偏好设置标签', description: 'AI 偏好设置集中控制推理预算、代理、自动审批和安全项。', advanceOnTargetClick: true },
    { id: 'ai-preferences-content', targetId: 'settings-ai-preferences-content', title: 'AI 偏好设置内容', description: '这里展示 Extended Thinking、Reasoning Effort、代理设置和终端超时。' },
    {
      id: 'ai-auto-approval',
      targetId: 'settings-ai-auto-approval',
      title: '自动批准',
      description: '启用自动批准后，系统设置引导会通过本地事件推进。',
      advanceOnEvent: 'onboarding:autoApprovalEnabled'
    }
  ],
  addAndConnectHost: [
    { id: 'assets-entry', targetId: 'assets-entry', title: '资产入口', description: '左侧资产入口进入主机和密钥管理。' },
    { id: 'host-management', targetId: 'host-management-entry', title: '主机管理', description: '主机管理入口展示资产分组、搜索、导入、导出和编辑表单。' },
    { id: 'new-host', targetId: 'asset-new-host-button', title: '新建主机', description: '点击新建主机打开右侧表单。', advanceOnTargetClick: true },
    { id: 'form-fields', targetId: 'asset-form-fields', title: '主机表单', description: '表单收集主机名、地址、用户名、分组和端口。' },
    { id: 'form-submit', targetId: 'asset-form-submit', title: '保存主机', description: '保存后新主机会出现在资产列表中。' },
    { id: 'connect-asset', targetId: 'asset-card', title: '连接资产', description: '双击资产卡片会创建终端连接占位。' }
  ],
  aiChat: [
    { id: 'ai-sidebar-entry', targetId: 'right-ai-toggle', title: '打开 AI 侧栏', description: '从顶部右侧按钮打开 AI 助手。', highlightTargetIds: ['left-ai-toggle'], advanceOnTargetClick: true },
    { id: 'ai-sidebar-overview', targetId: 'right-ai-sidebar', title: 'AI 侧栏概览', description: '侧栏包含消息、任务进度、模型信息和输入区。' },
    { id: 'ai-input', targetId: 'ai-input', title: '输入区', description: '在这里描述运维目标，或通过 @ 添加上下文、通过 / 选择命令。' },
    {
      id: 'ai-mode-agent',
      targetId: 'ai-mode-select',
      title: 'AI 模式',
      description: '模式选择用于在命令/Agent 类型之间切换，引导会展开下拉并定位 Agent 选项。',
      advanceOnTargetClick: true,
      advanceOnTargetIds: ['ai-mode-agent-option'],
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    {
      id: 'ai-model-open',
      targetId: 'ai-model-select',
      title: '模型选择',
      description: '模型控件展示当前模型，并可展开可用模型列表。',
      advanceOnTargetClick: true,
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    {
      id: 'ai-model-option',
      targetId: 'ai-model-option',
      title: '模型选项',
      description: '模型下拉中的首个选项会作为引导目标，选择后更新本地模型配置。',
      advanceOnTargetClick: true,
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    {
      id: 'ai-context-open',
      targetId: 'ai-context-trigger',
      title: '上下文入口',
      description: '点击 @ 可选择主机、文档、Skills 或历史会话上下文。',
      advanceOnTargetClick: true,
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    {
      id: 'ai-context-hosts',
      targetId: 'ai-context-hosts-menu',
      title: '主机上下文分类',
      description: '上下文弹层中的主机分类会进入可选主机列表。',
      advanceOnTargetClick: true,
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    {
      id: 'ai-localhost-option',
      targetId: 'ai-localhost-option',
      title: '本地主机上下文',
      description: '已打开的本地 shell 可作为 AI 上下文。',
      advanceOnTargetClick: true,
      requiresTargetClick: true,
      allowNextWithoutTargetClick: true
    },
    { id: 'ai-send', targetId: 'ai-send-button', title: '发送目标', description: '发送后 AI 面板会产生本地 mock 响应，占位保留真实 LLM 接入点。', advanceOnTargetClick: true, requiresTargetClick: true }
  ]
}

export const createDefaultOnboardingCompleted = () =>
  onboardingModules.reduce(
    (acc, module) => {
      acc[module.id] = false
      return acc
    },
    {} as Record<OnboardingModuleId, boolean>
  )

export const settingsNavItems: SettingsNavItem[] = [
  { key: 'general', label: '通用', icon: Settings },
  { key: 'terminal', label: '终端', icon: SquareTerminal },
  { key: 'extensions', label: '扩展', icon: Box },
  { key: 'models', label: '模型', icon: Bot },
  { key: 'billing', label: '计费概览', icon: CreditCard },
  { key: 'ai', label: 'AI 偏好设置', icon: SlidersHorizontal },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'skills', label: 'Skills', icon: Zap },
  { key: 'rules', label: '规则', icon: ShieldCheck },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard },
  { key: 'trustedDevices', label: '可信设备', icon: Smartphone },
  { key: 'privacy', label: '隐私', icon: Lock },
  { key: 'about', label: '关于', icon: Info },
  { key: 'docs', label: '文档', icon: BookOpen, external: true }
]

export type ThemeOption = {
  value: string
  label: string
  group: 'system' | 'default' | 'official'
  background: string
  surface: string
  accent: string
}

export const settingsThemeOptions: ThemeOption[] = [
  { value: 'auto', label: '自动', group: 'system', background: 'linear-gradient(135deg, #111827 0 49%, #f7fafc 51% 100%)', surface: '#2c2f36', accent: '#4ea7ff' },
  { value: 'dark', label: '深色', group: 'default', background: '#111827', surface: '#1f2937', accent: '#4ea7ff' },
  { value: 'light', label: '浅色', group: 'default', background: '#f7fafc', surface: '#e8edf4', accent: '#1677ff' },
  { value: 'termius-dark', label: 'Termius Dark', group: 'official', background: '#101318', surface: '#222831', accent: '#00b894' },
  { value: 'flexoki-dark', label: 'Flexoki Dark', group: 'official', background: '#100f0f', surface: '#1c1b1a', accent: '#da702c' },
  { value: 'kanagawa-wave', label: 'Kanagawa Wave', group: 'official', background: '#1f1f28', surface: '#2a2a37', accent: '#7e9cd8' },
  { value: 'dracula-night', label: 'Dracula Night', group: 'official', background: '#282a36', surface: '#343746', accent: '#bd93f9' },
  { value: 'nord-frost', label: 'Nord Frost', group: 'official', background: '#2e3440', surface: '#3b4252', accent: '#88c0d0' }
]

export type BackgroundPreset = {
  id: string
  label: string
  css: string
}

export const settingsBackgroundPresets: BackgroundPreset[] = [
  {
    id: 'mist-lake',
    label: 'mist lake',
    css: 'linear-gradient(150deg, #d7e7ea 0%, #8fb1bc 42%, #24313d 100%)'
  },
  {
    id: 'snow-peak',
    label: 'snow peak',
    css: 'linear-gradient(145deg, #e8f6ff 0%, #9ac6d5 48%, #344b63 100%)'
  },
  {
    id: 'sunset-ridge',
    label: 'sunset ridge',
    css: 'linear-gradient(145deg, #f7c36b 0%, #596f42 42%, #1c2530 100%)'
  },
  {
    id: 'coast-dusk',
    label: 'coast dusk',
    css: 'linear-gradient(145deg, #f0a36b 0%, #7aa097 46%, #26313d 100%)'
  },
  {
    id: 'star-field',
    label: 'star field',
    css: 'radial-gradient(circle at 30% 30%, #f7fafc 0 1px, transparent 2px), radial-gradient(circle at 70% 55%, #cfd8e3 0 1px, transparent 2px), linear-gradient(145deg, #020617, #111827 55%, #1e293b)'
  }
]

export const settingsLanguageOptions = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'pt-PT', label: 'Português' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'ar-AR', label: 'العربية' }
]

export const settingsModelOptions = [
  { name: 'gpt-5', locked: true, checked: true },
  { name: 'gpt-5-Thinking', locked: true, checked: true },
  { name: 'ops-local-agent', locked: false, checked: true },
  { name: 'custom-maintenance', locked: false, checked: false }
]

export type SettingsMcpTool = {
  name: string
  description: string
  enabled: boolean
  parameters: Array<{ name: string; description: string; required?: boolean }>
}

export type SettingsMcpResource = {
  name: string
  description: string
  uri: string
}

export type SettingsMcpServer = {
  name: string
  status: 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error'
  disabled: boolean
  error?: string
  tools: SettingsMcpTool[]
  resources: SettingsMcpResource[]
}

export const mockSettingsMcpServers: SettingsMcpServer[] = [
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

export type SettingsSkill = {
  name: string
  description: string
  enabled: boolean
  editable: boolean
  content: string
  path?: string
}

export const mockSettingsSkills: SettingsSkill[] = [
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

export type SettingsRule = {
  id: string
  content: string
  enabled: boolean
  isEditing?: boolean
}

export const mockSettingsRules: SettingsRule[] = [
  {
    id: 'rule-1',
    content: '执行生产变更前必须先给出只读检查命令和回滚点。',
    enabled: true
  },
  {
    id: 'rule-2',
    content: '不要自动执行删除、重启、扩容、写文件或修改配置类命令。',
    enabled: true
  }
]

export type SettingsShortcut = {
  id: string
  action: string
  shortcut: string
  suffix?: string
}

export const mockSettingsShortcuts: SettingsShortcut[] = [
  { id: 'newTerminal', action: '新建终端', shortcut: 'Ctrl+Shift+T' },
  { id: 'toggleAi', action: '显示/隐藏 AI 侧边栏', shortcut: 'Ctrl+Shift+A' },
  { id: 'switchToSpecificTab', action: '切换到指定标签', shortcut: 'Alt', suffix: '1-9' },
  { id: 'quickCommand', action: '打开快捷命令', shortcut: 'Ctrl+Shift+P' }
]

export type SettingsTrustedDevice = {
  id: number
  deviceName: string
  macAddress: string
  lastLoginIp: string
  location: string
  lastLoginUserAgent: string
  current: boolean
}

export const mockSettingsTrustedDevices: SettingsTrustedDevice[] = [
  {
    id: 1,
    deviceName: 'Linux Workstation',
    macAddress: 'aa:bb:cc:dd:ee:ff',
    lastLoginIp: '10.24.8.12',
    location: 'Shanghai',
    lastLoginUserAgent: 'Chrome/125 Linux',
    current: true
  },
  {
    id: 2,
    deviceName: 'MacBook',
    macAddress: '11:22:33:44:55:66',
    lastLoginIp: '10.18.3.42',
    location: 'Hangzhou',
    lastLoginUserAgent: 'Safari/17 macOS',
    current: false
  }
]

export type MockUserProfile = {
  uid: number
  name: string
  username: string
  avatarInitials: string
  avatarImageUrl: string
  registrationType: 'enterprise' | 'personal'
  authProvider: 'local' | 'sso' | 'oauth'
  subscription: 'free' | 'pro' | 'ultra'
  subscriptionExpiresAt: string
  email: string
  mobile: string
  localIp: string
  macAddress: string
  isOfficeDevice: boolean
  needDeviceVerification: boolean
  skippedLogin: boolean
}

export const mockUserProfile: MockUserProfile = {
  uid: 2001007,
  name: 'Local Operator',
  username: 'local_ops',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  authProvider: 'local',
  subscription: 'pro',
  subscriptionExpiresAt: '2026-12-31',
  email: 'operator@example.local',
  mobile: '13800000000',
  localIp: '127.0.0.1',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  isOfficeDevice: true,
  needDeviceVerification: false,
  skippedLogin: false
}

export const settingsSecretPatterns = [
  { name: 'IPv4 Address', regex: '\\b((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.?\\b){4}\\b' },
  { name: 'AWS Access ID', regex: '\\b(AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{12,}\\b' },
  { name: 'GitHub Classic Personal Access Token', regex: '\\bghp_[A-Za-z0-9_]{36}\\b' },
  { name: 'Google API Key', regex: '\\bAIza[0-9A-Za-z-_]{35}\\b' }
]

export type MockAsset = {
  id: string
  uuid: string
  name: string
  title: string
  host: string
  ip: string
  group: string
  group_name: string
  status: 'online' | 'idle' | 'offline'
  tags: string[]
  username: string
  port: number
  asset_type: 'person' | 'organization' | 'switch'
  auth_type: 'password' | 'keyBased'
  comment?: string
  data_source: 'manual' | 'refresh'
}

export type MockAssetGroup = {
  key: string
  title: string
  children: MockAsset[]
}

export const mockAssets: MockAsset[] = [
  {
    id: 'asset-1',
    uuid: 'asset-1',
    name: 'prod-bastion',
    title: 'prod-bastion',
    host: '10.24.8.12',
    ip: '10.24.8.12',
    group: '生产',
    group_name: '生产',
    status: 'online',
    tags: ['ssh', 'linux'],
    username: 'root',
    port: 22,
    asset_type: 'person',
    auth_type: 'password',
    comment: '生产入口',
    data_source: 'manual'
  },
  {
    id: 'asset-2',
    uuid: 'asset-2',
    name: 'staging-api',
    title: 'staging-api',
    host: '10.18.3.42',
    ip: '10.18.3.42',
    group: '预发',
    group_name: '预发',
    status: 'online',
    tags: ['deploy'],
    username: 'deploy',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '预发 API',
    data_source: 'manual'
  },
  {
    id: 'asset-3',
    uuid: 'asset-3',
    name: 'mysql-primary',
    title: 'mysql-primary',
    host: '10.32.6.9',
    ip: '10.32.6.9',
    group: '数据库',
    group_name: '数据库',
    status: 'idle',
    tags: ['mysql'],
    username: 'dba',
    port: 22,
    asset_type: 'person',
    auth_type: 'keyBased',
    comment: '主库',
    data_source: 'manual'
  },
  {
    id: 'asset-4',
    uuid: 'asset-4',
    name: 'legacy-node',
    title: 'legacy-node',
    host: '10.11.7.21',
    ip: '10.11.7.21',
    group: '维护',
    group_name: '维护',
    status: 'offline',
    tags: ['audit'],
    username: 'ops',
    port: 2222,
    asset_type: 'person',
    auth_type: 'password',
    comment: '待迁移',
    data_source: 'manual'
  },
  {
    id: 'asset-5',
    uuid: 'org-1',
    name: 'jumpserver-org',
    title: 'jumpserver-org',
    host: 'bastion.internal',
    ip: 'bastion.internal',
    group: '企业',
    group_name: '企业',
    status: 'online',
    tags: ['jumpserver'],
    username: 'sync',
    port: 22,
    asset_type: 'organization',
    auth_type: 'keyBased',
    comment: '同步资产',
    data_source: 'refresh'
  }
]

export const mockAssetGroups: MockAssetGroup[] = ['生产', '预发', '数据库', '维护', '企业'].map((group) => ({
  key: `group-${group}`,
  title: group,
  children: mockAssets.filter((asset) => asset.group === group)
}))

export const assetManagementEntries = [
  {
    key: 'assetConfig',
    name: '主机管理',
    description: '管理 SSH 主机、分组、导入导出和连接动作。',
    icon: Server
  },
  {
    key: 'assetManagement',
    name: '组织资产管理',
    description: '按表格管理堡垒机同步资产，支持分页、搜索和批量删除。',
    icon: Database
  },
  {
    key: 'keyManagement',
    name: '密钥管理',
    description: '管理本地密钥链和主机认证方式。',
    icon: KeyRound
  }
]

export type FileSessionKind = 'local' | 'remote'

export type FileSessionInfo = {
  id: string
  label: string
  host: string
  group: string
  kind: FileSessionKind
  rootPath: string
  status: 'active' | 'idle' | 'error'
  favorite?: boolean
  assetType?: 'local' | 'person' | 'organization' | 'custom_folder'
  folderUuid?: string
  comment?: string
  errorMsg?: string
}

export type MockFileEntry = {
  name: string
  path: string
  type: 'directory' | 'file' | 'link'
  mode: string
  size: number
  modifiedAt: string
}

export type FileTransferTask = {
  id: string
  type: 'download' | 'upload' | 'r2r'
  name: string
  source: string
  target: string
  progress: number
  speed: string
  status: 'running' | 'success' | 'failed' | 'error'
  stage?: 'scanning' | 'pending'
  isGroup?: boolean
  fromHost?: string
  toHost?: string
  totalFiles?: number
  finishedFiles?: number
  children?: FileTransferTask[]
}

export type SnippetGroup = {
  id: number
  uuid: string
  group_name: string
}

export type QuickCommandSnippet = {
  id: number
  uuid: string
  snippet_name: string
  snippet_content: string
  group_uuid?: string | null
  create_at?: string
  update_at?: string
}

export type KnowledgeNodeType = 'file' | 'dir'

export type KnowledgeNode = {
  id: string
  key: string
  title: string
  type: KnowledgeNodeType
  relPath: string
  size?: number
  children?: KnowledgeNode[]
}

export type ExtensionSource = 'preinstalled' | 'store' | 'local'

export type ExtensionIconKey = 'jumpserver' | 'alias' | 'runbook' | 'cloud' | 'private' | 'local'

export type ExtensionFunction = {
  title: string
  desc: string
}

export type ExtensionInstallStage = 'downloading' | 'verifying' | 'installing' | 'done' | 'error' | 'cancelled' | ''

export type ExtensionPlugin = {
  pluginId: string
  name: string
  description: string
  iconKey: ExtensionIconKey
  tabName: string
  show: boolean
  isPlugin: boolean
  installed: boolean
  hasUpdate: boolean
  installedVersion?: string
  latestVersion?: string
  installable?: boolean
  required?: boolean
  isDraggedOnly?: boolean
  source?: ExtensionSource
  isPrivate?: boolean
  lastUpdated?: string
  size?: number
  readme?: string
  categories?: string[]
  functions?: ExtensionFunction[]
}

export type AliasCommand = {
  id: string
  alias: string
  command: string
  edit?: boolean
  createdAt?: number
}

export type K8sConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

export type K8sClusterSource = 'local' | 'jumpserver'

export type K8sContextInfo = {
  name: string
  cluster: string
  namespace: string
  server: string
  isActive: boolean
}

export type MockK8sCluster = {
  id: string
  name: string
  kubeconfig_path: string | null
  kubeconfig_content: string | null
  context_name: string
  server_url: string
  auth_type: string
  is_active: number
  connection_status: K8sConnectionStatus
  auto_connect: number
  default_namespace: string
  created_at: string
  updated_at: string
  source_type: K8sClusterSource
  bastion_uuid: string | null
  bastion_asset_address: string | null
  bastion_asset_name: string | null
  bastion_asset_id_last: number | null
}

export type K8sImportContextInfo = {
  name: string
  cluster: string
  server: string
  namespace: string
}

export type K8sBastionGroup = {
  uuid: string
  label: string
  ip: string
}

export type K8sProxyConfig = {
  enabled: boolean
  type: 'HTTP' | 'HTTPS' | 'SOCKS4' | 'SOCKS5'
  host: string
  port: number
  enableProxyIdentity: boolean
  username: string
  password: string
}

export type K8sTerminalTab = {
  id: string
  clusterId: string
  name: string
  namespace: string
  isActive: boolean
  output: string
}

export type K8sResourceKind = 'pods' | 'deployments' | 'services' | 'nodes'

export type K8sNamespaceInfo = {
  id: string
  clusterId: string
  name: string
  status: string
  age: string
}

export type MockK8sResource = {
  id: string
  clusterId: string
  kind: K8sResourceKind
  name: string
  namespace: string
  status: string
  ready: string
  age: string
  detail: string
  node?: string
  image?: string
  ports?: string
  restarts?: number
  selector?: string
}

export const initialFileSessions: FileSessionInfo[] = [
  {
    id: 'local',
    label: 'Local',
    host: '127.0.0.1',
    group: '本地连接',
    kind: 'local',
    rootPath: '/',
    status: 'active',
    assetType: 'local'
  },
  {
    id: 'asset-1',
    label: 'prod-bastion',
    host: '10.24.8.12',
    group: '最近连接',
    kind: 'remote',
    rootPath: '/home/deploy',
    status: 'active',
    favorite: false,
    assetType: 'person',
    comment: '生产入口'
  },
  {
    id: 'folder_asset-2',
    label: 'staging-files',
    host: '10.24.9.20',
    group: '主机',
    kind: 'remote',
    rootPath: '/home/staging',
    status: 'idle',
    favorite: false,
    assetType: 'person',
    folderUuid: 'files-folder-a',
    comment: '预发文件'
  }
]

export const mockRemoteFileTree: Record<string, MockFileEntry[]> = {
  '/home/deploy': [
    { name: '..', path: '/home', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-30 18:12' },
    { name: '.env.production', path: '/home/deploy/.env.production', type: 'file', mode: '-rw-------', size: 2048, modifiedAt: '2026-06-01 08:35' },
    { name: 'apps', path: '/home/deploy/apps', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-28 14:20' },
    { name: 'logs', path: '/home/deploy/logs', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-06-03 09:42' },
    { name: 'release-note.md', path: '/home/deploy/release-note.md', type: 'file', mode: '-rw-r--r--', size: 18432, modifiedAt: '2026-06-02 16:05' },
    { name: 'current', path: '/home/deploy/current', type: 'link', mode: 'lrwxrwxrwx', size: 0, modifiedAt: '2026-06-01 22:10' }
  ],
  '/home/deploy/apps': [
    { name: '..', path: '/home/deploy', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-28 14:20' },
    { name: 'api', path: '/home/deploy/apps/api', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-06-01 11:12' },
    { name: 'worker', path: '/home/deploy/apps/worker', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-29 17:36' },
    { name: 'deploy.sh', path: '/home/deploy/apps/deploy.sh', type: 'file', mode: '-rwxr-xr-x', size: 9216, modifiedAt: '2026-05-27 10:19' }
  ],
  '/home/deploy/logs': [
    { name: '..', path: '/home/deploy', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-06-03 09:42' },
    { name: '.rotate-state', path: '/home/deploy/logs/.rotate-state', type: 'file', mode: '-rw-r--r--', size: 512, modifiedAt: '2026-06-03 03:00' },
    { name: 'api.log', path: '/home/deploy/logs/api.log', type: 'file', mode: '-rw-r--r--', size: 493568, modifiedAt: '2026-06-03 10:31' },
    { name: 'worker.log', path: '/home/deploy/logs/worker.log', type: 'file', mode: '-rw-r--r--', size: 278528, modifiedAt: '2026-06-03 10:25' }
  ],
  '/home/ops': [
    { name: '..', path: '/home', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-20 12:00' },
    { name: 'scripts', path: '/home/ops/scripts', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-29 09:12' },
    { name: 'readme.txt', path: '/home/ops/readme.txt', type: 'file', mode: '-rw-r--r--', size: 4096, modifiedAt: '2026-05-21 18:04' }
  ],
  '/home/staging': [
    { name: '..', path: '/home', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-22 10:00' },
    { name: 'boot', path: '/home/staging/boot', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-30 12:18' },
    { name: 'release-note.md', path: '/home/staging/release-note.md', type: 'file', mode: '-rw-r--r--', size: 2048, modifiedAt: '2026-05-30 12:20' }
  ],
  '/home/staging/boot': [
    { name: '..', path: '/home/staging', type: 'directory', mode: 'drwxr-xr-x', size: 0, modifiedAt: '2026-05-30 12:18' },
    { name: 'app.ini', path: '/home/staging/boot/app.ini', type: 'file', mode: '-rw-r--r--', size: 1024, modifiedAt: '2026-05-30 12:22' }
  ]
}

export const mockInitialTransferTasks: FileTransferTask[] = [
  {
    id: 'download-parent-1',
    type: 'download',
    name: 'logs',
    source: '/home/deploy/logs',
    target: '~/Downloads/logs',
    progress: 72,
    speed: '3/4',
    status: 'running',
    isGroup: true,
    totalFiles: 4,
    finishedFiles: 3,
    children: [
      {
        id: 'download-child-1',
        type: 'download',
        name: 'api.log',
        source: '/home/deploy/logs/api.log',
        target: '~/Downloads/logs/api.log',
        progress: 100,
        speed: '完成',
        status: 'success'
      },
      {
        id: 'download-child-2',
        type: 'download',
        name: 'worker.log',
        source: '/home/deploy/logs/worker.log',
        target: '~/Downloads/logs/worker.log',
        progress: 68,
        speed: '840 KB/s',
        status: 'running'
      }
    ]
  },
  {
    id: 'upload-parent-1',
    type: 'upload',
    name: 'release-note.md',
    source: '~/Desktop/release-note.md',
    target: '/home/deploy/release-note.md',
    progress: 100,
    speed: '完成',
    status: 'success'
  },
  {
    id: 'r2r-parent-1',
    type: 'r2r',
    name: 'deploy.sh',
    source: '/home/deploy/apps/deploy.sh',
    target: '/home/ops/scripts/deploy.sh',
    progress: 36,
    speed: '520 KB/s',
    status: 'running',
    fromHost: '10.24.8.12',
    toHost: '127.0.0.1'
  }
]

export const mockSnippetGroups: SnippetGroup[] = [
  { id: 1, uuid: 'group-monitor', group_name: '巡检命令' },
  { id: 2, uuid: 'group-service', group_name: '服务运维' }
]

export const mockQuickCommandSnippets: QuickCommandSnippet[] = [
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

export const mockKnowledgeTree: KnowledgeNode[] = [
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
        size: 16 * 1024
      },
      {
        id: 'kb-file-diagnose',
        key: 'commands/diagnose.md',
        relPath: 'commands/diagnose.md',
        title: 'diagnose.md',
        type: 'file',
        size: 12 * 1024
      },
      {
        id: 'kb-file-summary',
        key: 'commands/Summary to Doc.md',
        relPath: 'commands/Summary to Doc.md',
        title: 'Summary to Doc.md',
        type: 'file',
        size: 24 * 1024
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
        size: 296 * 1024
      }
    ]
  },
  {
    id: 'kb-file-markdown',
    key: 'Markdown语法指南.md',
    relPath: 'Markdown语法指南.md',
    title: 'Markdown语法指南.md',
    type: 'file',
    size: 18 * 1024
  }
]

export const mockKnowledge = [
  { id: 'kb-1', title: 'Linux 巡检手册', type: 'Markdown', size: '32 KB', updatedAt: '今天 10:18' },
  { id: 'kb-2', title: 'Kubernetes 故障处理 SOP', type: 'PDF', size: '1.2 MB', updatedAt: '昨天 18:42' },
  { id: 'kb-3', title: '数据库慢查询排障', type: 'Markdown', size: '18 KB', updatedAt: '5 月 29 日' }
]

export const mockPlugins = [
  { id: 'jumpserver', name: 'JumpServer Support', status: '未安装', description: '统一登录、授权和堡垒机跳转占位。' },
  { id: 'cloud-assets', name: 'Cloud Assets', status: '占位', description: '云资产发现和同步能力占位。' },
  { id: 'ops-runbook', name: 'Ops Runbook', status: '启用', description: '本地维护流程和技能模板。' }
]

export const mockExtensionPlugins: ExtensionPlugin[] = [
  {
    pluginId: 'jumpserverSupport',
    name: 'Jumpserver Support',
    description: '支持资产同步与资产直连',
    iconKey: 'jumpserver',
    tabName: 'jumpserverSupport',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['SSH', 'Tools'],
    functions: [
      { title: '资产同步', desc: '从堡垒机同步组织、主机和账号信息。' },
      { title: '资产直连', desc: '在终端中选择同步资产后直接建立 SSH 会话。' },
      { title: '认证联动', desc: '保留 Jumpserver 会话认证、审计和代理链路状态。' },
      { title: '连接日志', desc: '展示堡垒机、目标主机、认证阶段的连接进度。' }
    ]
  },
  {
    pluginId: 'Alias',
    name: 'Alias',
    description: '全局Alias配置',
    iconKey: 'alias',
    tabName: 'aliasConfig',
    show: true,
    isPlugin: false,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '',
    source: 'preinstalled',
    categories: ['Tools']
  },
  {
    pluginId: 'ops-runbook',
    name: 'Ops Runbook',
    description: '本地维护流程和技能模板。',
    iconKey: 'runbook',
    tabName: 'Ops Runbook',
    show: true,
    isPlugin: true,
    installed: true,
    hasUpdate: true,
    installedVersion: '1.2.0',
    latestVersion: '1.3.0',
    installable: true,
    source: 'store',
    lastUpdated: '2026-06-01',
    size: 1843200,
    readme: 'Ops Runbook 提供常用巡检、发布前检查和故障复盘模板，可在终端工作区中作为辅助流程打开。',
    categories: ['Tools', 'Runbook'],
    functions: [
      { title: '巡检模板', desc: '生成磁盘、负载、服务状态的检查清单。' },
      { title: '发布守卫', desc: '把发布前后验证步骤整理为可复用流程。' }
    ]
  },
  {
    pluginId: 'local-shell-tools',
    name: 'Local Shell Tools',
    description: '本地 shell 辅助工具集合。',
    iconKey: 'local',
    tabName: 'Local Shell Tools',
    show: true,
    isPlugin: true,
    installed: true,
    hasUpdate: false,
    installedVersion: '0.5.2',
    latestVersion: '',
    installable: true,
    source: 'local',
    lastUpdated: '2026-05-30',
    size: 702464,
    readme: '从本地 .external-reference 包安装的工具插件，当前不在插件商店内。',
    categories: ['Tools', 'Local'],
    functions: [{ title: '本地工具', desc: '提供路径检查、环境变量快照和日志定位入口。' }]
  },
  {
    pluginId: 'cloud-assets',
    name: 'Cloud Assets',
    description: '云资产发现和同步能力占位。',
    iconKey: 'cloud',
    tabName: 'Cloud Assets',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '0.9.1',
    installable: true,
    source: 'store',
    lastUpdated: '2026-05-28',
    size: 2310144,
    readme: 'Cloud Assets 用于同步云主机、标签和连接入口，安装后可在资产管理中启用。',
    categories: ['Cloud', 'Assets'],
    functions: [
      { title: '云资产同步', desc: '按账号和地域拉取云主机列表。' },
      { title: '标签映射', desc: '把云标签映射到本地资产分组。' }
    ]
  },
  {
    pluginId: 'private-automation-pack',
    name: 'Private Automation Pack',
    description: '私有自动化插件，需要订阅后安装。',
    iconKey: 'private',
    tabName: 'Private Automation Pack',
    show: true,
    isPlugin: true,
    installed: false,
    hasUpdate: false,
    installedVersion: '',
    latestVersion: '2.0.0',
    installable: false,
    isPrivate: true,
    source: 'store',
    lastUpdated: '2026-05-20',
    size: 4194304,
    readme: '私有插件展示订阅入口；未订阅时不可直接安装。',
    categories: ['Private', 'Automation'],
    functions: [{ title: '订阅能力', desc: '开通后启用私有自动化任务模板。' }]
  }
]

export const mockAliasCommands: AliasCommand[] = [
  { id: 'alias-ll', alias: 'll', command: 'ls -alF', createdAt: 1717200000000 },
  { id: 'alias-gst', alias: 'gst', command: 'git status', createdAt: 1717286400000 },
  { id: 'alias-kctx', alias: 'kctx', command: 'kubectl config current-context', createdAt: 1717372800000 }
]

export const mockK8sContexts: K8sContextInfo[] = [
  {
    name: 'prod/admin',
    cluster: 'prod-cluster',
    namespace: 'default',
    server: 'https://prod.k8s.local:6443',
    isActive: true
  },
  {
    name: 'staging/devops',
    cluster: 'staging-cluster',
    namespace: 'staging',
    server: 'https://staging.k8s.local:6443',
    isActive: false
  }
]

export const mockK8sBastions: K8sBastionGroup[] = [
  { uuid: 'org-1', label: 'jumpserver-org', ip: 'bastion.internal' },
  { uuid: 'org-prod', label: 'prod-bastion', ip: '10.24.8.12' }
]

export const mockK8sClusters: MockK8sCluster[] = [
  {
    id: 'k8s-1',
    name: 'prod-cluster',
    kubeconfig_path: '~/.kube/config',
    kubeconfig_content: null,
    context_name: 'prod/admin',
    server_url: 'https://prod.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 1,
    connection_status: 'connected',
    auto_connect: 1,
    default_namespace: 'default',
    created_at: '2026-05-28 10:20',
    updated_at: '2026-06-03 09:30',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-2',
    name: 'staging-cluster',
    kubeconfig_path: '~/.kube/staging',
    kubeconfig_content: null,
    context_name: 'staging/devops',
    server_url: 'https://staging.k8s.local:6443',
    auth_type: 'kubeconfig',
    is_active: 0,
    connection_status: 'disconnected',
    auto_connect: 0,
    default_namespace: 'staging',
    created_at: '2026-05-28 11:20',
    updated_at: '2026-06-01 12:10',
    source_type: 'local',
    bastion_uuid: null,
    bastion_asset_address: null,
    bastion_asset_name: null,
    bastion_asset_id_last: null
  },
  {
    id: 'k8s-3',
    name: 'jumpserver-prod',
    kubeconfig_path: null,
    kubeconfig_content: null,
    context_name: 'jumpserver/prod',
    server_url: '172.16.20.14:6443',
    auth_type: 'jumpserver',
    is_active: 0,
    connection_status: 'error',
    auto_connect: 0,
    default_namespace: 'ops',
    created_at: '2026-05-30 15:00',
    updated_at: '2026-06-02 18:10',
    source_type: 'jumpserver',
    bastion_uuid: 'org-1',
    bastion_asset_address: '172.16.20.14',
    bastion_asset_name: 'jumpserver-prod',
    bastion_asset_id_last: 1014
  }
]

export const mockK8sNamespaces: K8sNamespaceInfo[] = [
  { id: 'k8s-ns-prod-default', clusterId: 'k8s-1', name: 'default', status: 'Active', age: '92d' },
  { id: 'k8s-ns-prod-ops', clusterId: 'k8s-1', name: 'ops', status: 'Active', age: '77d' },
  { id: 'k8s-ns-prod-ingress', clusterId: 'k8s-1', name: 'ingress-nginx', status: 'Active', age: '64d' },
  { id: 'k8s-ns-staging', clusterId: 'k8s-2', name: 'staging', status: 'Active', age: '48d' },
  { id: 'k8s-ns-staging-ci', clusterId: 'k8s-2', name: 'ci', status: 'Active', age: '48d' },
  { id: 'k8s-ns-jump-ops', clusterId: 'k8s-3', name: 'ops', status: 'Active', age: '31d' }
]

export const mockK8sResources: MockK8sResource[] = [
  {
    id: 'k8s-pod-api-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'api-gateway-6d8c9bb7f6-l6j2m',
    namespace: 'default',
    status: 'Running',
    ready: '2/2',
    age: '3d',
    detail: 'REST ingress workload serving public API traffic.',
    node: 'prod-node-01',
    image: 'registry.internal/api-gateway:2.8.4',
    restarts: 0
  },
  {
    id: 'k8s-pod-worker-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'billing-worker-7f9d6f9dd9-rx8mm',
    namespace: 'ops',
    status: 'CrashLoopBackOff',
    ready: '0/1',
    age: '18h',
    detail: 'Background billing worker with repeated startup failures.',
    node: 'prod-node-03',
    image: 'registry.internal/billing-worker:1.15.2',
    restarts: 12
  },
  {
    id: 'k8s-pod-ingress-1',
    clusterId: 'k8s-1',
    kind: 'pods',
    name: 'ingress-nginx-controller-66d8f7dbf6-vf9jg',
    namespace: 'ingress-nginx',
    status: 'Running',
    ready: '1/1',
    age: '21d',
    detail: 'Cluster ingress controller.',
    node: 'prod-node-02',
    image: 'registry.k8s.io/ingress-nginx/controller:v1.11.1',
    restarts: 1
  },
  {
    id: 'k8s-deploy-api',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'api-gateway',
    namespace: 'default',
    status: 'Available',
    ready: '4/4',
    age: '38d',
    detail: 'RollingUpdate deployment for the public API gateway.',
    image: 'registry.internal/api-gateway:2.8.4',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-deploy-worker',
    clusterId: 'k8s-1',
    kind: 'deployments',
    name: 'billing-worker',
    namespace: 'ops',
    status: 'Progressing',
    ready: '2/3',
    age: '24d',
    detail: 'Worker deployment processing billing queue events.',
    image: 'registry.internal/billing-worker:1.15.2',
    selector: 'app=billing-worker'
  },
  {
    id: 'k8s-svc-api',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'api-gateway',
    namespace: 'default',
    status: 'ClusterIP',
    ready: '10.96.12.40',
    age: '38d',
    detail: 'Internal service for api-gateway pods.',
    ports: '80/TCP, 443/TCP',
    selector: 'app=api-gateway'
  },
  {
    id: 'k8s-svc-ingress',
    clusterId: 'k8s-1',
    kind: 'services',
    name: 'ingress-nginx-controller',
    namespace: 'ingress-nginx',
    status: 'LoadBalancer',
    ready: '10.96.32.10',
    age: '64d',
    detail: 'Ingress controller service exposing HTTP and HTTPS.',
    ports: '80:32080/TCP, 443:32443/TCP',
    selector: 'app.kubernetes.io/name=ingress-nginx'
  },
  {
    id: 'k8s-node-prod-1',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '92d',
    detail: 'Control-plane capable production worker node.',
    node: '10.24.1.11'
  },
  {
    id: 'k8s-node-prod-2',
    clusterId: 'k8s-1',
    kind: 'nodes',
    name: 'prod-node-02',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.29.3',
    age: '91d',
    detail: 'Production worker node running ingress and API workloads.',
    node: '10.24.1.12'
  },
  {
    id: 'k8s-pod-staging-api',
    clusterId: 'k8s-2',
    kind: 'pods',
    name: 'staging-api-76f7d9cbf7-8l4xf',
    namespace: 'staging',
    status: 'Running',
    ready: '1/1',
    age: '9h',
    detail: 'Staging API pod for pre-release validation.',
    node: 'staging-node-01',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    restarts: 0
  },
  {
    id: 'k8s-deploy-staging-api',
    clusterId: 'k8s-2',
    kind: 'deployments',
    name: 'staging-api',
    namespace: 'staging',
    status: 'Available',
    ready: '2/2',
    age: '12d',
    detail: 'Staging API deployment.',
    image: 'registry.internal/api-gateway:2.9.0-rc1',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-svc-staging-api',
    clusterId: 'k8s-2',
    kind: 'services',
    name: 'staging-api',
    namespace: 'staging',
    status: 'ClusterIP',
    ready: '10.100.8.42',
    age: '12d',
    detail: 'Internal staging API service.',
    ports: '8080/TCP',
    selector: 'app=staging-api'
  },
  {
    id: 'k8s-node-staging-1',
    clusterId: 'k8s-2',
    kind: 'nodes',
    name: 'staging-node-01',
    namespace: 'cluster',
    status: 'Ready',
    ready: 'v1.28.8',
    age: '48d',
    detail: 'Staging worker node.',
    node: '10.28.1.11'
  },
  {
    id: 'k8s-pod-jump-ops',
    clusterId: 'k8s-3',
    kind: 'pods',
    name: 'ops-shell-0',
    namespace: 'ops',
    status: 'Pending',
    ready: '0/1',
    age: '42m',
    detail: 'JumpServer imported cluster workload waiting for scheduling.',
    node: '-',
    image: 'registry.internal/ops-shell:latest',
    restarts: 0
  }
]

export type MockDatabaseEngineCode = 'mysql' | 'postgresql' | 'sqlite' | 'oracle'
export type MockDatabaseEngineOptionCode =
  | MockDatabaseEngineCode
  | 'h2'
  | 'sqlserver'
  | 'mariadb'
  | 'clickhouse'
  | 'dm'
  | 'presto'
  | 'db2'
  | 'oceanbase'
  | 'hive'
  | 'kingbase'
  | 'mongodb'
  | 'timeplus'

export type MockDatabaseEngine = {
  code: MockDatabaseEngineOptionCode
  connectionCode?: MockDatabaseEngineCode
  name: string
  enabled: boolean
  accent: string
}

export type MockDatabaseColumn = {
  name: string
  type: string
  nullable: boolean
  key?: 'PK' | 'FK'
}

export type MockDatabaseTable = {
  id: string
  name: string
  columns: MockDatabaseColumn[]
  primaryKey: string[]
  rows: Array<Record<string, string | number | boolean | null>>
  ddl: string
  ddlError?: { code: 'permission' | 'other'; message: string }
}

export type MockDatabaseSchema = {
  name: string
  tables: MockDatabaseTable[]
  views?: MockDatabaseTable[]
  functions?: string[]
  procedures?: string[]
}

export type MockDatabaseCatalog = {
  name: string
  schemas?: MockDatabaseSchema[]
  tables?: MockDatabaseTable[]
}

export type MockDatabaseConnection = {
  id: string
  name: string
  dbType: MockDatabaseEngineCode
  env: 'Development' | 'TEST' | 'Staging' | 'Production'
  groupId: string
  host: string
  port: number | null
  authentication: 'UserAndPassword'
  user: string
  hasPassword?: boolean
  database: string
  filePath?: string
  readonly?: boolean
  sslMode?: '' | 'disable' | 'require' | 'verify-ca' | 'verify-full'
  url?: string
  status: 'idle' | 'testing' | 'connected' | 'failed'
  catalogs: MockDatabaseCatalog[]
}

export type MockDatabaseGroup = {
  id: string
  name: string
}

export const mockDatabaseEngines: MockDatabaseEngine[] = [
  { code: 'mysql', connectionCode: 'mysql', name: 'MySQL', enabled: true, accent: '#00758f' },
  { code: 'h2', name: 'H2', enabled: false, accent: '#7c3aed' },
  { code: 'oracle', connectionCode: 'oracle', name: 'Oracle', enabled: true, accent: '#c74634' },
  { code: 'postgresql', connectionCode: 'postgresql', name: 'PostgreSQL', enabled: true, accent: '#336791' },
  { code: 'sqlserver', name: 'SQLServer', enabled: false, accent: '#a91d22' },
  { code: 'sqlite', connectionCode: 'sqlite', name: 'SQLite', enabled: true, accent: '#00a1e0' },
  { code: 'mariadb', name: 'MariaDB', enabled: false, accent: '#c0765c' },
  { code: 'clickhouse', name: 'ClickHouse', enabled: false, accent: '#fdd835' },
  { code: 'dm', name: 'DM', enabled: false, accent: '#d946ef' },
  { code: 'presto', name: 'Presto', enabled: false, accent: '#7c2d12' },
  { code: 'db2', name: 'DB2', enabled: false, accent: '#2563eb' },
  { code: 'oceanbase', name: 'OceanBase', enabled: false, accent: '#0ea5e9' },
  { code: 'hive', name: 'Hive', enabled: false, accent: '#f59e0b' },
  { code: 'kingbase', name: 'KingBase', enabled: false, accent: '#dc2626' },
  { code: 'mongodb', name: 'MongoDB', enabled: false, accent: '#4db33d' },
  { code: 'timeplus', name: 'Timeplus', enabled: false, accent: '#14b8a6' }
]

export const mockDatabaseGroups: MockDatabaseGroup[] = [
  { id: 'group-default', name: 'Default Group' },
  { id: 'group-prod', name: 'Production' },
  { id: 'group-local', name: 'Local Lab' }
]

const ordersColumns: MockDatabaseColumn[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'owner', type: 'varchar(64)', nullable: true },
  { name: 'updated_at', type: 'timestamp', nullable: false }
]

const incidentsColumns: MockDatabaseColumn[] = [
  { name: 'id', type: 'bigint', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'status', type: 'varchar(32)', nullable: false },
  { name: 'updated_at', type: 'datetime', nullable: false }
]

const serviceHealthColumns: MockDatabaseColumn[] = [
  { name: 'id', type: 'int', nullable: false, key: 'PK' },
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'region', type: 'varchar(32)', nullable: false },
  { name: 'latency_ms', type: 'int', nullable: false },
  { name: 'healthy', type: 'tinyint', nullable: false }
]

const metricEventsColumns: MockDatabaseColumn[] = [
  { name: 'service', type: 'varchar(80)', nullable: false },
  { name: 'event_type', type: 'varchar(32)', nullable: false },
  { name: 'severity', type: 'varchar(16)', nullable: false },
  { name: 'created_at', type: 'datetime', nullable: false }
]

const cacheColumns: MockDatabaseColumn[] = [
  { name: 'key', type: 'text', nullable: false, key: 'PK' },
  { name: 'value', type: 'text', nullable: true },
  { name: 'ttl_seconds', type: 'integer', nullable: true },
  { name: 'updated_at', type: 'text', nullable: false }
]

const oracleAuditColumns: MockDatabaseColumn[] = [
  { name: 'event_id', type: 'NUMBER', nullable: false },
  { name: 'actor', type: 'VARCHAR2(64)', nullable: false },
  { name: 'action', type: 'VARCHAR2(64)', nullable: false },
  { name: 'created_at', type: 'TIMESTAMP', nullable: false }
]

export const mockDatabaseConnections: MockDatabaseConnection[] = [
  {
    id: 'conn-prod-pg',
    name: 'orders-postgres',
    dbType: 'postgresql',
    env: 'Production',
    groupId: 'group-prod',
    host: '10.32.6.9',
    port: 5432,
    authentication: 'UserAndPassword',
    user: 'readonly',
    hasPassword: true,
    database: 'orders',
    sslMode: 'require',
    url: 'jdbc:postgresql://10.32.6.9:5432/orders',
    status: 'connected',
    catalogs: [
      {
        name: 'orders',
        schemas: [
          {
            name: 'public',
            tables: [
              {
                id: 'tbl-orders',
                name: 'orders',
                columns: ordersColumns,
                primaryKey: ['id'],
                rows: [
                  { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' },
                  { id: 1002, service: 'orders-worker', status: 'mitigated', owner: 'bob', updated_at: '2026-06-03 09:44:00' },
                  { id: 1003, service: 'k8s-ingress', status: 'watching', owner: null, updated_at: '2026-06-02 22:01:00' },
                  { id: 1004, service: 'billing-sync', status: 'closed', owner: 'carol', updated_at: '2026-06-02 18:22:00' }
                ],
                ddl:
                  'CREATE TABLE public.orders (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  owner VARCHAR(64),\n  updated_at TIMESTAMP NOT NULL\n);'
              }
            ],
            views: [
              {
                id: 'view-public-open-orders',
                name: 'open_orders_v',
                columns: ordersColumns,
                primaryKey: ['id'],
                rows: [
                  { id: 1001, service: 'payment-api', status: 'investigating', owner: 'alice', updated_at: '2026-06-03 10:12:00' }
                ],
                ddlError: { code: 'permission', message: 'DDL requires elevated catalog permission.' },
                ddl:
                  'CREATE VIEW public.open_orders_v AS\nSELECT id, service, status, owner, updated_at\nFROM public.orders\nWHERE status <> \'closed\';'
              }
            ],
            functions: ['notify_order_owner(order_id bigint)', 'calculate_order_age(order_id bigint)'],
            procedures: ['archive_closed_orders(cutoff timestamp)']
          },
          {
            name: 'ops',
            tables: [
              {
                id: 'tbl-pg-incidents',
                name: 'ops_incidents',
                columns: incidentsColumns,
                primaryKey: ['id'],
                rows: [
                  { id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' },
                  { id: 9002, service: 'search', severity: 'P2', status: 'triaged', updated_at: '2026-06-03 08:04:00' }
                ],
                ddl:
                  'CREATE TABLE ops.ops_incidents (\n  id BIGINT PRIMARY KEY,\n  service VARCHAR(80) NOT NULL,\n  severity VARCHAR(16) NOT NULL,\n  status VARCHAR(32) NOT NULL,\n  updated_at TIMESTAMP NOT NULL\n);'
              }
            ],
            views: [
              {
                id: 'view-ops-active-incidents',
                name: 'active_incidents_v',
                columns: incidentsColumns,
                primaryKey: ['id'],
                rows: [{ id: 9001, service: 'checkout', severity: 'P1', status: 'open', updated_at: '2026-06-03 11:18:00' }],
                ddl:
                  'CREATE VIEW ops.active_incidents_v AS\nSELECT id, service, severity, status, updated_at\nFROM ops.ops_incidents\nWHERE status <> \'closed\';'
              }
            ],
            functions: ['incident_priority(severity text)'],
            procedures: ['rotate_incident_partitions()']
          }
        ]
      }
    ]
  },
  {
    id: 'conn-metrics-mysql',
    name: 'metrics-mysql',
    dbType: 'mysql',
    env: 'Staging',
    groupId: 'group-default',
    host: '10.32.6.18',
    port: 3306,
    authentication: 'UserAndPassword',
    user: 'ops',
    hasPassword: true,
    database: 'metrics',
    url: 'jdbc:mysql://10.32.6.18:3306/metrics',
    status: 'idle',
    catalogs: [
      {
        name: 'metrics',
        tables: [
          {
            id: 'tbl-service-health',
            name: 'service_health',
            columns: serviceHealthColumns,
            primaryKey: ['id'],
            rows: [
              { id: 1, service: 'api-gateway', region: 'shanghai', latency_ms: 28, healthy: true },
              { id: 2, service: 'worker', region: 'hangzhou', latency_ms: 73, healthy: true },
              { id: 3, service: 'queue', region: 'shenzhen', latency_ms: 211, healthy: false }
            ],
            ddl:
              'CREATE TABLE `service_health` (\n  `id` INT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `region` VARCHAR(32) NOT NULL,\n  `latency_ms` INT NOT NULL,\n  `healthy` TINYINT NOT NULL,\n  PRIMARY KEY (`id`)\n);'
          },
          {
            id: 'tbl-mysql-incidents',
            name: 'ops_incidents',
            columns: incidentsColumns,
            primaryKey: ['id'],
            rows: [
              { id: 7001, service: 'metrics-api', severity: 'P2', status: 'watching', updated_at: '2026-06-03 07:52:00' },
              { id: 7002, service: 'prometheus', severity: 'P3', status: 'closed', updated_at: '2026-06-02 16:31:00' }
            ],
            ddl:
              'CREATE TABLE `ops_incidents` (\n  `id` BIGINT NOT NULL,\n  `service` VARCHAR(80) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `status` VARCHAR(32) NOT NULL,\n  `updated_at` DATETIME NOT NULL,\n  PRIMARY KEY (`id`)\n);'
          },
          {
            id: 'tbl-metric-events',
            name: 'metric_events',
            columns: metricEventsColumns,
            primaryKey: [],
            rows: [
              { service: 'api-gateway', event_type: 'deploy', severity: 'info', created_at: '2026-06-03 10:42:00' },
              { service: 'queue', event_type: 'lag', severity: 'warning', created_at: '2026-06-03 10:58:00' }
            ],
            ddl:
              'CREATE TABLE `metric_events` (\n  `service` VARCHAR(80) NOT NULL,\n  `event_type` VARCHAR(32) NOT NULL,\n  `severity` VARCHAR(16) NOT NULL,\n  `created_at` DATETIME NOT NULL\n);'
          }
        ]
      }
    ]
  },
  {
    id: 'conn-oracle-audit',
    name: 'audit-oracle',
    dbType: 'oracle',
    env: 'TEST',
    groupId: 'group-default',
    host: '10.32.6.28',
    port: 1521,
    authentication: 'UserAndPassword',
    user: 'audit',
    hasPassword: true,
    database: 'ORCLPDB1',
    url: '10.32.6.28:1521/ORCLPDB1',
    status: 'connected',
    catalogs: [
      {
        name: 'ORCLPDB1',
        schemas: [
          {
            name: 'OPS',
            tables: [
              {
                id: 'tbl-oracle-audit-log',
                name: 'AUDIT_LOG',
                columns: oracleAuditColumns,
                primaryKey: [],
                rows: [
                  { event_id: 501, actor: 'deploy-bot', action: 'RELEASE_START', created_at: '2026-06-03 08:10:00' },
                  { event_id: 502, actor: 'ops-user', action: 'MANUAL_APPROVE', created_at: '2026-06-03 08:16:00' }
                ],
                ddl:
                  'CREATE TABLE OPS.AUDIT_LOG (\n  event_id NUMBER NOT NULL,\n  actor VARCHAR2(64) NOT NULL,\n  action VARCHAR2(64) NOT NULL,\n  created_at TIMESTAMP NOT NULL\n);'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'conn-local-cache',
    name: 'local-cache',
    dbType: 'sqlite',
    env: 'Development',
    groupId: 'group-local',
    host: 'local',
    port: null,
    authentication: 'UserAndPassword',
    user: '',
    database: 'cache.db',
    filePath: '/tmp/aiopsterm/cache.db',
    readonly: true,
    url: 'sqlite:///tmp/aiopsterm/cache.db',
    status: 'idle',
    catalogs: [
      {
        name: 'cache.db',
        tables: [
          {
            id: 'tbl-cache-entries',
            name: 'cache_entries',
            columns: cacheColumns,
            primaryKey: ['key'],
            rows: [
              { key: 'session:1001', value: 'payment-api', ttl_seconds: 3600, updated_at: '2026-06-03 09:00:00' },
              { key: 'feature:rollout', value: 'enabled', ttl_seconds: null, updated_at: '2026-06-02 23:20:00' }
            ],
            ddl:
              'CREATE TABLE cache_entries (\n  key TEXT PRIMARY KEY,\n  value TEXT,\n  ttl_seconds INTEGER,\n  updated_at TEXT NOT NULL\n);'
          }
        ]
      }
    ]
  }
]

export const mockDatabases = mockDatabaseConnections.map((connection) => ({
  id: connection.id,
  name: connection.database,
  type: mockDatabaseEngines.find((engine) => engine.connectionCode === connection.dbType)?.name ?? connection.dbType,
  host: connection.host,
  tables: connection.catalogs.reduce((total, catalog) => {
    const direct = catalog.tables?.length ?? 0
    const schemaTables = catalog.schemas?.reduce((sum, schema) => sum + schema.tables.length, 0) ?? 0
    return total + direct + schemaTables
  }, 0)
}))

export const commandSuggestions = [
  'df -h',
  'systemctl status nginx',
  'kubectl get pods -A',
  'journalctl -u docker --since "30 minutes ago"',
  'top -o %CPU'
]

export const aiCommandPresets = [
  { id: 'diagnose', label: '/diagnose', name: 'diagnose', prompt: '请根据当前终端和资产上下文生成只读诊断计划。', path: 'commands/diagnose.md' },
  { id: 'deploy', label: '/deploy-check', name: 'deploy-check', prompt: '请生成发布前检查清单，并列出需要确认的风险点。', path: 'commands/deploy-check.md' },
  { id: 'rollback', label: '/rollback-plan', name: 'rollback-plan', prompt: '请为当前服务生成回滚预案和验证步骤。', path: 'commands/rollback-plan.md' },
  { id: 'explain', label: '/explain-output', name: 'explain-output', prompt: '请解释当前终端输出并指出异常信号。', path: 'commands/explain-output.md' }
]

export type AiChatMode = 'agent' | 'cmd'

export const aiChatModeOptions: Array<{ id: AiChatMode; label: string; detail: string }> = [
  { id: 'agent', label: 'Agent', detail: '自动规划并等待确认' },
  { id: 'cmd', label: 'Command', detail: '生成命令与解释' }
]

export const aiModelOptions = [
  { id: 'mock-ops-agent', label: 'mock-ops-agent', detail: '本地 mock 默认模型' },
  { id: 'gpt-5-Thinking', label: 'gpt-5-Thinking', detail: 'Extended Thinking 占位模型' },
  { id: 'ops-model', label: 'ops-model', detail: 'OpenAI Compatible 占位' },
  { id: 'qwen2.5-coder', label: 'qwen2.5-coder', detail: 'Ollama 占位' }
]

export const lockedAiModelOptions = [
  { id: 'gpt-5-pro', label: 'gpt-5-pro', tier: 'VIP', detail: '订阅后可用' },
  { id: 'ops-large-context', label: 'ops-large-context', tier: 'VIP', detail: '高级上下文窗口' }
]

export type AiContextKind = 'hosts' | 'docs' | 'images' | 'skills' | 'chats'

export type AiContextOption = {
  id: string
  kind: AiContextKind
  label: string
  detail?: string
  relPath?: string
  contextType?: KnowledgeNodeType
  content?: string
  mediaType?: string
  data?: string
}

export type AiContextCategory = {
  id: AiContextKind
  label: string
  icon: Component
  options: AiContextOption[]
}

export const aiContextCategories: AiContextCategory[] = [
  {
    id: 'hosts',
    label: '主机',
    icon: Server,
    options: [
      { id: 'opened-local', kind: 'hosts' as const, label: '127.0.0.1', detail: 'local shell' },
      ...mockAssets.map((asset) => ({
        id: asset.id,
        kind: 'hosts' as const,
        label: asset.host,
        detail: asset.name
      }))
    ]
  },
  {
    id: 'docs',
    label: '文档',
    icon: FileText,
    options: []
  },
  {
    id: 'skills',
    label: '技能',
    icon: Bot,
    options: [
      { id: 'skill-audit', kind: 'skills', label: '巡检技能', detail: '生成只读检查步骤' },
      { id: 'skill-incident', kind: 'skills', label: '故障复盘', detail: '整理现象、假设和证据' },
      { id: 'skill-release', kind: 'skills', label: '发布守卫', detail: '发布前后检查清单' }
    ]
  },
  {
    id: 'chats',
    label: '历史会话',
    icon: Search,
    options: [
      { id: 'chat-prod', kind: 'chats', label: '生产巡检', detail: '最近一次磁盘与负载检查' },
      { id: 'chat-k8s', kind: 'chats', label: 'K8s 发布失败', detail: 'Pod 事件和镜像拉取' },
      { id: 'chat-db', kind: 'chats', label: '数据库慢查询', detail: '慢日志和索引建议' }
    ]
  }
]

export const aiOpenedHosts = [
  { id: 'opened-local', kind: 'hosts' as const, label: '127.0.0.1', detail: 'local shell' },
  { id: 'opened-prod', kind: 'hosts' as const, label: '10.24.8.12', detail: 'prod-bastion' },
  { id: 'opened-mysql', kind: 'hosts' as const, label: '10.32.6.9', detail: 'mysql-primary' },
  { id: 'opened-api', kind: 'hosts' as const, label: '10.18.3.42', detail: 'staging-api' }
]
