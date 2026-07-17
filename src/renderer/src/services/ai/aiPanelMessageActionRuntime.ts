import { aiPanelMessagePlainText } from '@/services/ai/aiPanelMessageRuntime'
import { aiChatStaleClineTaskMessage, type AiChatAgentTaskRef, type AiContentPart } from '@shared/contracts/aiChat'
import type { ClineAgentApprovalInput, ClineAgentApprovalResult } from '@shared/contracts/clineAgent'

export type AiPanelMessageActionMessage = {
  id: string
  text: string
  favorite?: boolean
  feedback?: 'up' | 'down'
  contentParts?: AiContentPart[]
  ask?: string
  action?: 'approved' | 'rejected'
  commandExecutionMessage?: string
  agentTask?: AiChatAgentTaskRef
  mcpToolCall?: {
    serverName?: string
    toolName?: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
}

export type AiPanelMessageActionRuntimeOptions<TMessage extends AiPanelMessageActionMessage> = {
  messages: () => TMessage[]
  copyText: (text: string) => Promise<boolean>
  notify: (message: string) => void
  approveMcpToolCall: (id: string, options: { autoApprove?: boolean }) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  rejectMcpToolCall: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  approveMcpResourceAccess: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  rejectMcpResourceAccess: (id: string) => Promise<'approved' | 'rejected' | 'failed' | false | string>
  toggleMessageFavorite: (id: string) => Promise<boolean>
  setMessageFeedback: (id: string, feedback: 'up' | 'down') => Promise<boolean>
  retryAssistantMessage: (id: string) => boolean
  summarizeMessageToKnowledge: (id: string) => Promise<{ relPath: string } | null>
  summarizeMessageToSkill: (id: string) => Promise<{ name: string } | null>
  respondClineAgentApproval?: (input: ClineAgentApprovalInput) => Promise<ClineAgentApprovalResult>
  syncCurrentConversationSnapshot?: (options: { notifyFailure?: boolean; notifyUnavailable?: boolean }) => void | Promise<unknown>
  labels?: Partial<AiPanelMessageActionLabels>
}

export type AiPanelMessageActionLabels = {
  renderedEmpty: (label: string) => string
  renderedCopied: (label: string) => string
  renderedCopyFailed: () => string
  messageEmpty: () => string
  messageCopied: () => string
  messageCopyFailed: () => string
  mcpToolApproved: () => string
  mcpToolApproveFailed: () => string
  mcpToolRejected: () => string
  mcpToolRejectFailed: () => string
  mcpResourceApproved: () => string
  mcpResourceApproveFailed: () => string
  mcpResourceRejected: () => string
  mcpResourceRejectFailed: () => string
  sensitiveToolApproved: () => string
  sensitiveToolApproveFailed: () => string
  sensitiveToolRejected: () => string
  sensitiveToolRejectFailed: () => string
  messageFavorited: () => string
  messageUnfavorited: () => string
  feedbackHelpful: () => string
  feedbackUnhelpful: () => string
  feedbackCleared: () => string
  retrySent: () => string
  retryUnavailable: () => string
  knowledgeSaved: (relPath: string) => string
  knowledgeSaveFailed: () => string
  skillSaved: (name: string) => string
  skillSaveFailed: () => string
}

const defaultLabels: AiPanelMessageActionLabels = {
  renderedEmpty: (label) => `${label}为空，无法复制。`,
  renderedCopied: (label) => `${label}已复制。`,
  renderedCopyFailed: () => '复制失败。',
  messageEmpty: () => '消息为空，无法复制。',
  messageCopied: () => '消息已复制。',
  messageCopyFailed: () => '复制失败。',
  mcpToolApproved: () => 'MCP 工具已执行。',
  mcpToolApproveFailed: () => 'MCP 工具审批失败。',
  mcpToolRejected: () => 'MCP 工具调用已拒绝。',
  mcpToolRejectFailed: () => 'MCP 工具拒绝失败。',
  mcpResourceApproved: () => 'MCP 资源已读取。',
  mcpResourceApproveFailed: () => 'MCP 资源审批失败。',
  mcpResourceRejected: () => 'MCP 资源访问已拒绝。',
  mcpResourceRejectFailed: () => 'MCP 资源拒绝失败。',
  sensitiveToolApproved: () => '敏感读取已批准，Cline Agent 正在继续分析。',
  sensitiveToolApproveFailed: () => '敏感读取审批失败。',
  sensitiveToolRejected: () => '敏感读取已拒绝。',
  sensitiveToolRejectFailed: () => '敏感读取拒绝失败。',
  messageFavorited: () => '已收藏消息。',
  messageUnfavorited: () => '已取消收藏。',
  feedbackHelpful: () => '已标记有帮助。',
  feedbackUnhelpful: () => '已标记无帮助。',
  feedbackCleared: () => '已取消反馈。',
  retrySent: () => '已重新发送上一条用户消息。',
  retryUnavailable: () => '没有可重试的用户消息。',
  knowledgeSaved: (relPath) => `已沉淀到知识：${relPath}`,
  knowledgeSaveFailed: () => '沉淀到知识失败。',
  skillSaved: (name) => `已创建技能：${name}`,
  skillSaveFailed: () => '沉淀到技能失败。'
}

export const formatAiPanelMcpToolArguments = (message: { mcpToolCall?: { arguments?: Record<string, unknown> } }) => {
  try {
    return JSON.stringify(message.mcpToolCall?.arguments || {}, null, 2)
  } catch {
    return String(message.mcpToolCall?.arguments || '')
  }
}

export const createAiPanelMessageActionRuntime = <TMessage extends AiPanelMessageActionMessage>(
  options: AiPanelMessageActionRuntimeOptions<TMessage>
) => {
  const labels = { ...defaultLabels, ...options.labels }
  const messageById = (id: string) => options.messages().find((message) => message.id === id)
  const pendingSensitiveApprovalIds = new Set<string>()

  const sensitiveApprovalInput = (message: TMessage): ClineAgentApprovalInput | null => {
    const task = message.agentTask
    const toolName = task?.toolName?.trim() || ''
    if (
      task?.status !== 'waiting-approval' ||
      task.restored === true ||
      !task.taskId.trim() ||
      !task.turnId.trim() ||
      !task.toolCallId?.trim() ||
      !toolName
    ) return null
    if (toolName === 'read_host_file' || toolName === 'search_host_files') {
      if (!task.targetId?.trim() || !task.targetLabel?.trim() || !task.terminalSessionId?.trim()) return null
      return {
        taskId: task.taskId,
        turnId: task.turnId,
        toolCallId: task.toolCallId,
        toolName,
        targetId: task.targetId,
        targetLabel: task.targetLabel,
        terminalSessionId: task.terminalSessionId,
        approved: false
      }
    }
    if (toolName === 'access_mcp_resource') {
      const serverName = message.mcpResourceAccess?.serverName.trim() || ''
      const resourceUri = message.mcpResourceAccess?.uri.trim() || ''
      if (!serverName || !resourceUri) return null
      return {
        taskId: task.taskId,
        turnId: task.turnId,
        toolCallId: task.toolCallId,
        toolName,
        serverName,
        resourceUri,
        approved: false
      }
    }
    return null
  }

  const respondSensitiveApproval = async (message: TMessage, approved: boolean) => {
    const approval = sensitiveApprovalInput(message)
    if (!approval || !options.respondClineAgentApproval || pendingSensitiveApprovalIds.has(message.id)) return 'failed' as const
    pendingSensitiveApprovalIds.add(message.id)
    let result: ClineAgentApprovalResult
    try {
      result = await options.respondClineAgentApproval({
        ...approval,
        approved,
        reason: approved ? undefined : 'The operator rejected the sensitive read.'
      })
    } catch {
      result = { ok: false, errorCode: 'CLINE_AGENT_APPROVAL_FAILED', errorMessage: 'Cline Agent 审批服务不可用。' }
    } finally {
      pendingSensitiveApprovalIds.delete(message.id)
    }
    const current = messageById(message.id)
    if (!result.ok) {
      if (result.errorCode === 'CLINE_AGENT_APPROVAL_NOT_FOUND' && current?.agentTask) {
        current.action = 'rejected'
        current.agentTask = { ...current.agentTask, status: 'cancelled', restored: true }
        void options.syncCurrentConversationSnapshot?.({ notifyFailure: true, notifyUnavailable: true })
        options.notify(aiChatStaleClineTaskMessage)
      }
      return 'failed' as const
    }
    if (current?.agentTask) {
      current.action = approved ? 'approved' : 'rejected'
      current.commandExecutionMessage = approved ? '已批准，正在读取...' : '已拒绝读取。'
      current.agentTask = { ...current.agentTask, status: 'running' }
      void options.syncCurrentConversationSnapshot?.({ notifyFailure: true, notifyUnavailable: true })
    }
    return approved ? 'approved' as const : 'rejected' as const
  }

  const copyRenderedTextToClipboard = async (text: string, label: string) => {
    if (!text) {
      options.notify(labels.renderedEmpty(label))
      return false
    }
    const copied = await options.copyText(text)
    options.notify(copied ? labels.renderedCopied(label) : labels.renderedCopyFailed())
    return copied
  }

  const copyMessageToClipboard = async (message: { text: string; contentParts?: AiContentPart[] }) => {
    const text = aiPanelMessagePlainText(message).trim()
    if (!text) {
      options.notify(labels.messageEmpty())
      return false
    }
    const copied = await options.copyText(text)
    options.notify(copied ? labels.messageCopied() : labels.messageCopyFailed())
    return copied
  }

  const approveMcpToolCall = async (id: string, autoApprove = false) => {
    const message = messageById(id)
    if (message && sensitiveApprovalInput(message)) {
      const result = await respondSensitiveApproval(message, true)
      options.notify(result === 'approved' ? labels.sensitiveToolApproved() : labels.sensitiveToolApproveFailed())
      return result
    }
    const result = await options.approveMcpToolCall(id, { autoApprove })
    options.notify(result === 'approved' ? labels.mcpToolApproved() : labels.mcpToolApproveFailed())
    return result
  }

  const rejectMcpToolCall = async (id: string) => {
    const message = messageById(id)
    if (message && sensitiveApprovalInput(message)) {
      const result = await respondSensitiveApproval(message, false)
      options.notify(result === 'rejected' ? labels.sensitiveToolRejected() : labels.sensitiveToolRejectFailed())
      return result
    }
    const result = await options.rejectMcpToolCall(id)
    options.notify(result === 'rejected' ? labels.mcpToolRejected() : labels.mcpToolRejectFailed())
    return result
  }

  const approveMcpResourceAccess = async (id: string) => {
    const message = messageById(id)
    if (message && sensitiveApprovalInput(message)) {
      const result = await respondSensitiveApproval(message, true)
      options.notify(result === 'approved' ? labels.mcpResourceApproved() : labels.mcpResourceApproveFailed())
      return result
    }
    const result = await options.approveMcpResourceAccess(id)
    options.notify(result === 'approved' ? labels.mcpResourceApproved() : labels.mcpResourceApproveFailed())
    return result
  }

  const rejectMcpResourceAccess = async (id: string) => {
    const message = messageById(id)
    if (message && sensitiveApprovalInput(message)) {
      const result = await respondSensitiveApproval(message, false)
      options.notify(result === 'rejected' ? labels.mcpResourceRejected() : labels.mcpResourceRejectFailed())
      return result
    }
    const result = await options.rejectMcpResourceAccess(id)
    options.notify(result === 'rejected' ? labels.mcpResourceRejected() : labels.mcpResourceRejectFailed())
    return result
  }

  const toggleMessageFavorite = async (id: string) => {
    const saved = await options.toggleMessageFavorite(id)
    if (!saved) return false
    const message = messageById(id)
    options.notify(message?.favorite ? labels.messageFavorited() : labels.messageUnfavorited())
    return true
  }

  const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
    const saved = await options.setMessageFeedback(id, feedback)
    if (!saved) return false
    const current = messageById(id)?.feedback
    options.notify(current ? (current === 'up' ? labels.feedbackHelpful() : labels.feedbackUnhelpful()) : labels.feedbackCleared())
    return true
  }

  const retryAssistantMessage = (id: string) => {
    const retried = options.retryAssistantMessage(id)
    options.notify(retried ? labels.retrySent() : labels.retryUnavailable())
    return retried
  }

  const summarizeMessageToKnowledge = async (id: string) => {
    const result = await options.summarizeMessageToKnowledge(id)
    options.notify(result ? labels.knowledgeSaved(result.relPath) : labels.knowledgeSaveFailed())
    return result
  }

  const summarizeMessageToSkill = async (id: string) => {
    const result = await options.summarizeMessageToSkill(id)
    options.notify(result ? labels.skillSaved(result.name) : labels.skillSaveFailed())
    return result
  }

  return {
    approveMcpResourceAccess,
    approveMcpToolCall,
    copyMessageToClipboard,
    copyRenderedTextToClipboard,
    formatMcpToolArguments: formatAiPanelMcpToolArguments,
    rejectMcpResourceAccess,
    rejectMcpToolCall,
    retryAssistantMessage,
    setMessageFeedback,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill,
    toggleMessageFavorite
  }
}
