import { aiPanelMessagePlainText } from '@/services/ai/aiPanelMessageRuntime'
import type { AiContentPart } from '@shared/contracts/aiChat'

export type AiPanelMessageActionMessage = {
  id: string
  text: string
  favorite?: boolean
  feedback?: 'up' | 'down'
  contentParts?: AiContentPart[]
  mcpToolCall?: {
    arguments?: Record<string, unknown>
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
    const result = await options.approveMcpToolCall(id, { autoApprove })
    options.notify(result === 'approved' ? labels.mcpToolApproved() : labels.mcpToolApproveFailed())
    return result
  }

  const rejectMcpToolCall = async (id: string) => {
    const result = await options.rejectMcpToolCall(id)
    options.notify(result === 'rejected' ? labels.mcpToolRejected() : labels.mcpToolRejectFailed())
    return result
  }

  const approveMcpResourceAccess = async (id: string) => {
    const result = await options.approveMcpResourceAccess(id)
    options.notify(result === 'approved' ? labels.mcpResourceApproved() : labels.mcpResourceApproveFailed())
    return result
  }

  const rejectMcpResourceAccess = async (id: string) => {
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
