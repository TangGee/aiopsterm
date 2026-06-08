import type { Component } from 'vue'
import { Bot, Cloud, Monitor, Settings } from 'lucide-vue-next'

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
    { id: 'ai-send', targetId: 'ai-send-button', title: '发送目标', description: '发送后 AI 面板会请求 aiopsterm 本地后端响应，占位保留真实 LLM 接入点。', advanceOnTargetClick: true, requiresTargetClick: true }
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
