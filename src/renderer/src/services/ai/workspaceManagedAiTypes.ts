import type { Ref } from 'vue'
import type { ModuleKey } from '@/config/navigation'
import type { I18nKey } from '@/i18n/messages'
import type { TerminalCommandExecutionOptions, TerminalSecurityDecision } from '@/services/terminal/terminalExecutionRuntime'
import type { TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import type { NotificationUserConfig } from '@shared/contracts/appRuntime'
import type { AgentHookInstallerSource, AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { ControlNotificationRecord } from '@shared/contracts/control'
import type {
  AiAgentSessionSource,
  AgentHibernationConfig,
  ManagedAiSessionRecord
} from '@shared/contracts/managedAiSessions'

export type AiAttentionKind = 'approval' | 'question' | 'plan' | 'error' | 'done'
export type AiAttentionSource = AiAgentSessionSource | 'classic-chat' | 'control-notification'
export type AiAttentionItem = {
  id: string
  source: AiAttentionSource
  kind: AiAttentionKind
  title: string
  summary: string
  priority: number
  createdAt: number
  conversationId?: string
  sessionId?: string
  surfaceId?: string
  notificationId?: string
  handledAt?: number
}
export type AiAttentionInput = Omit<AiAttentionItem, 'createdAt' | 'priority'> & {
  createdAt?: number
  priority?: number
}
export type AiAttentionFocusRequest = {
  sequence: number
  item: AiAttentionItem | null
}
export type ManagedAiSessionState = ManagedAiSessionRecord['state']
export type ManagedAiSession = ManagedAiSessionRecord
export type ManagedAiLocalTerminalOpenOptions = { title?: string; cwd?: string; preserveActiveModule?: boolean }

export const defaultAgentHibernationConfig: AgentHibernationConfig = {
  enabled: false,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}

export type WorkspaceManagedAiControllerState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  activePanelId: Ref<string>
  panels: Ref<TerminalPanel[]>
  notificationSettings: Ref<NotificationUserConfig>
  aiAttentionItems: Ref<AiAttentionItem[]>
  controlNotifications: Ref<ControlNotificationRecord[]>
  aiAttentionFocusRequest: Ref<AiAttentionFocusRequest>
  managedAiSessions: Ref<ManagedAiSession[]>
  agentHibernationConfig: Ref<AgentHibernationConfig>
  managedAiSessionsLoading: Ref<boolean>
  managedAiSessionsError: Ref<string>
  managedAiSessionFocusRequest: Ref<{ sequence: number; session: ManagedAiSession | null }>
  selectedManagedAiSessionKey: Ref<string>
  agentHookInstallers: Ref<AgentHookInstallerStatus[]>
  agentHookInstallersLoading: Ref<boolean>
  agentHookInstallerBusySource: Ref<AgentHookInstallerSource | ''>
  agentHookInstallerError: Ref<string>
}

export type WorkspaceManagedAiControllerDeps = {
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
  runTerminalCommand: (
    panelId: string,
    command: string,
    options?: TerminalCommandExecutionOptions
  ) => Promise<TerminalSecurityDecision>
  openLocalTerminalPanel?: (options?: ManagedAiLocalTerminalOpenOptions) => Promise<TerminalPanel | null | undefined>
}
