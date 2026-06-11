import type { AiChatExportMessage, AiChatExportInput, AiContentPart } from './preload'

export const sanitizeChatExportFileName = (value: string) => {
  const safeName = String(value || '')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .trim()
  return `${(safeName || 'aiopsterm-chat').slice(0, 30)}.md`
}

const escapeMarkdownFence = (value: string) => String(value || '').replace(/```/g, '``\\`')

const textForPart = (part: AiContentPart) => {
  if (part.type === 'text') return part.text
  if (part.type === 'image') return `[image: ${part.name || part.mediaType}]`
  if (part.chipType === 'doc') return `@${part.ref.name || part.ref.relPath || part.ref.absPath}`
  if (part.chipType === 'chat') return `@${part.ref.title || part.ref.taskId}`
  if (part.chipType === 'command') return part.ref.label || part.ref.command
  return `@skill:${part.ref.skillName}`
}

export const chatExportPlainText = (message: Pick<AiChatExportMessage, 'text' | 'contentParts'>) =>
  message.contentParts?.length ? message.contentParts.map(textForPart).join('') : message.text

const markdownTextForMessage = (message: Pick<AiChatExportMessage, 'text' | 'contentParts'>) =>
  message.contentParts?.length ? message.contentParts.map(textForPart).join('') : message.text

const markdownRoleLabelForMessage = (message: Pick<AiChatExportMessage, 'role'>) =>
  message.role === 'user' ? 'User' : message.role === 'assistant' ? 'aiopsterm' : 'System'

const markdownHostsForMessage = (message: Pick<AiChatExportMessage, 'hosts'>) =>
  message.hosts?.length ? `\n\nHosts: ${message.hosts.map((host) => host.label).join(', ')}` : ''

const contextTruncationExportText = (message: AiChatExportMessage) => {
  const text = chatExportPlainText(message)
  try {
    const parsed = JSON.parse(text) as { status?: string }
    if (parsed.status === 'compressing') return 'Context is being compressed.'
    if (parsed.status === 'completed') return 'Context has been truncated.'
  } catch {
    // Keep plain-text compatibility for locally generated truncation messages.
  }
  if (message.partial) return 'Context is being compressed.'
  return text.trim() || 'Context has been truncated.'
}

export const markdownForChatExportMessage = (message: AiChatExportMessage) => {
  const role = markdownRoleLabelForMessage(message)
  const roleHeader = `**${role}:**`
  const body = markdownTextForMessage(message)
  const plainText = chatExportPlainText(message)
  const hosts = markdownHostsForMessage(message)

  if (message.ask === 'command' || message.say === 'command') {
    const command = message.executedCommand || plainText
    return command.trim() ? `${roleHeader}\n\n\`\`\`bash\n${escapeMarkdownFence(command)}\n\`\`\`${hosts}\n` : ''
  }

  if (message.say === 'command_output') {
    if (!plainText.trim()) return ''
    if (plainText.startsWith('Terminal output:') && plainText.includes('```')) {
      return `**OUTPUT**\n\n${plainText}${hosts}\n`
    }
    return `**OUTPUT**\n\n\`\`\`\n${escapeMarkdownFence(plainText)}\n\`\`\`${hosts}\n`
  }

  if (message.ask === 'mcp_tool_call' && message.mcpToolCall) {
    const toolCall = {
      'MCP SERVER': message.mcpToolCall.serverName,
      TOOL: message.mcpToolCall.toolName,
      PARAMETERS: message.mcpToolCall.arguments || {}
    }
    return `${roleHeader}\n\n\`\`\`json\n${JSON.stringify(toolCall, null, 2)}\n\`\`\`${hosts}\n`
  }

  if (message.ask === 'mcp_resource_access' && message.mcpResourceAccess) {
    const resourceAccess = {
      'MCP SERVER': message.mcpResourceAccess.serverName,
      URI: message.mcpResourceAccess.uri
    }
    return `${roleHeader}\n\n\`\`\`json\n${JSON.stringify(resourceAccess, null, 2)}\n\`\`\`${hosts}\n`
  }

  if (message.ask === 'followup') {
    const options = message.followupOptions || []
    const optionList = options.length
      ? `\n\nOptions:\n\n${options.map((option) => `- ${message.selectedOption === option ? '[x]' : '[ ]'} ${option}`).join('\n\n')}`
      : ''
    return `${roleHeader}\n\n${escapeMarkdownFence(plainText)}${optionList}${hosts}\n`
  }

  if (message.say === 'search_result') {
    return plainText.trim() ? `${roleHeader}\n\n**Search Result**\n\`\`\`\n${escapeMarkdownFence(plainText)}\n\`\`\`${hosts}\n` : ''
  }

  if (message.say === 'context_truncated') {
    return `${roleHeader}\n\n${contextTruncationExportText(message)}${hosts}\n`
  }

  if (message.action === 'approved') return `${roleHeader}\n\n\u2705 Approved${hosts}\n`
  if (message.action === 'rejected') return `${roleHeader}\n\n\u274c Rejected${hosts}\n`

  if (message.role === 'system') return `${roleHeader}\n\n${body}${hosts}\n`
  if (message.contentParts?.some((part) => part.type === 'image')) return `${roleHeader}\n\n${body}${hosts}\n`
  return `${roleHeader}\n\n${escapeMarkdownFence(body)}${hosts}\n`
}

export const buildChatExportMarkdown = (input: AiChatExportInput, exportedAt: Date = new Date()) => {
  const title = String(input.title || 'Chat Export').trim() || 'Chat Export'
  const header = `# ${title}\n\n> Exported on: ${exportedAt.toLocaleString()} from aiopsterm\n\n---\n\n`
  return `${header}${(input.messages || []).map(markdownForChatExportMessage).filter(Boolean).join('\n---\n\n')}`
}
