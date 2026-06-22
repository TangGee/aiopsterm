import type { Ref } from 'vue'
import type { I18nKey } from '@/i18n/messages'
import type { TerminalCommandSource, TerminalSecurityDecision } from '@/services/terminalExecutionRuntime'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'
import type { AiPreferenceSettings, normalizeMcpServersConfig } from '@/services/workspaceConfigRuntime'
import type {
  AiChatContextUsageSnapshot,
  AiChatResponseInput,
  AiCommandCatalogOption,
  AiCommandChipRef,
  AiContentPart,
  AiContextCatalog,
  AiContextOption,
  AiTodoItem,
  AiChatMessageState
} from '@shared/contracts/aiChat'
import type { KnowledgeBaseCreateResult, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { UserConfig } from '@shared/contracts/userConfig'

export type SendChatOptions = {
  mode?: NonNullable<AiChatResponseInput['mode']>
  skipKnowledgeSearch?: boolean
}

export type AiContextUsage = AiChatContextUsageSnapshot

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiContextOption[]
  state?: AiChatMessageState
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
  commandExecutionStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
  commandExecutionMessage?: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
}

export type TodoItem = AiTodoItem

export type ConversationItem = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

export type WorkspaceAiChatControllerState = {
  mode: Ref<'terminal' | 'agents'>
  config: Ref<UserConfig>
  aiPreferences: Ref<AiPreferenceSettings>
  conversations: Ref<ConversationItem[]>
  selectedConversationId: Ref<string>
  aiContextCatalog: Ref<AiContextCatalog>
  aiCommandOptions: Ref<AiCommandCatalogOption[]>
  selectedContexts: Ref<AiContextOption[]>
  selectedCommandId: Ref<string | null>
  selectedCommandRef: Ref<AiCommandChipRef | null>
  todoItems: Ref<TodoItem[]>
  chatMessages: Ref<ChatMessage[]>
  aiContextUsage: Ref<AiContextUsage | null>
  mcpConfigEditorContent: Ref<string>
  kbSelectedKeys: Ref<string[]>
  settingsSkills: Ref<Array<{ name: string }>>
}

export type WorkspaceAiChatControllerDeps = {
  setTopNotice: (message: string) => void
  i18nText: (key: I18nKey, params?: Record<string, string | number>) => string
  createRendererLocalId: (prefix: 'aichat-agent-loop') => string
  resolveAiKnowledgeSearchContexts: (prompt: string, contexts: AiContextOption[]) => Promise<AiContextOption[]>
  applyMcpServersSnapshot: (snapshot: ReturnType<typeof normalizeMcpServersConfig>) => void
  resolveActiveWritableTerminalPanel: () => Pick<TerminalPanel, 'id' | 'output'> | null | undefined
  runActiveTerminalCommand: (command: string, source?: TerminalCommandSource) => Promise<TerminalSecurityDecision | null>
  waitForTerminalOutputAfter: (panelId: string, startLength: number, timeoutMs?: number) => Promise<string>
  findKnowledgeNode: (relPath: string) => KnowledgeNode | null
  backendKnowledgeEntryOrNotice: (result: unknown, notice: string) => KnowledgeBaseCreateResult | null
  uniqueKnowledgeFileName: (parentRelDir: string, name: string) => string
  refreshKnowledgeTree: () => Promise<boolean>
  openKnowledgeFile: (relPath: string) => void
  createSkill: (
    skill: { name: string; description: string; content: string },
    options?: { closeModal?: boolean; duplicateNotice?: boolean; successNotice?: string | false }
  ) => Promise<{ name: string } | null>
}
