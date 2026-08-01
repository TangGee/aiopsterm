import type { ExtensionUserConfig } from './extensions'
import type { KnowledgeBaseUserConfig } from './knowledgeBase'
import type { McpServerUserConfig, McpToolStatesUserConfig } from './mcp'
import type { QuickCommandsUserConfig } from './quickCommands'
import type { ShortcutUserConfig, UserRuleConfig } from './settingsPreferences'
import type { SkillUserConfig } from './skills'
import type {
  AiPreferencesUserConfig,
  EditorUserConfig,
  ExportMcpUserConfig,
  KeywordHighlightUserConfig,
  ModelSettingsUserConfig,
  NotificationUserConfig,
  PrivacyUserConfig,
  SecurityUserConfig,
  SshAgentKeyConfig,
  SshProxyConfig,
  TerminalUserConfig,
  WorkspaceUserConfig
} from './appRuntime'

export type UserConfig = {
  language: string
  theme: string
  defaultMode: 'terminal' | 'agents'
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  agentsLeftOpen: boolean
  leftPanelWidth?: number
  rightPanelWidth?: number
  agentsLeftWidth?: number
  modelProvider: 'local' | 'litellm' | 'openai-compatible' | 'ollama' | 'lmstudio' | 'bedrock' | 'deepseek' | 'anthropic'
  modelEndpoint: string
  modelName: string
  watermark: 'open' | 'close'
  background: {
    mode: 'none' | 'preset' | 'custom'
    image: string
    opacity: number
    brightness: number
    lastCustomImage?: string
  }
  terminal?: TerminalUserConfig
  workspacePreferences?: WorkspaceUserConfig
  workspaceIdleCleanup?: WorkspaceIdleCleanupUserConfig
  editorSettings?: EditorUserConfig
  sshProxyConfigs?: SshProxyConfig[]
  sshAgentKeys?: SshAgentKeyConfig[]
  extensionSettings?: ExtensionUserConfig
  keywordHighlight?: KeywordHighlightUserConfig
  securityConfig?: SecurityUserConfig
  privacy?: PrivacyUserConfig
  aiPreferences?: AiPreferencesUserConfig
  notifications?: NotificationUserConfig
  exportMcp?: ExportMcpUserConfig
  modelSettings?: ModelSettingsUserConfig
  shortcuts?: ShortcutUserConfig[]
  rules?: UserRuleConfig[]
  skills?: SkillUserConfig[]
  customInstructions?: string
  mcpServers?: McpServerUserConfig[]
  mcpToolStates?: McpToolStatesUserConfig
  quickCommands?: QuickCommandsUserConfig
  knowledgeBase?: KnowledgeBaseUserConfig
  onboarding?: {
    version: number
    guideTabAutoOpened: boolean
    completedModules: Record<string, boolean>
  }
}

export type WorkspaceIdleCleanupUserConfig = {
  enabled: boolean
  timeoutMinutes: number
}
