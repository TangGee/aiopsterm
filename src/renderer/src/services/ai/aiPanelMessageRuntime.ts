import { marked } from 'marked'
import hljs from 'highlight.js'
import { sanitizeMarkdownHtml } from '@/services/common/markdownRuntime'
import { plainTextForAiContentPart } from '@/services/ai/aiPanelInputRuntime'
import type {
  AiChatExportMessage,
  AiChatHistoryHostContext,
  AiChatHistoryMessage,
  AiCommandChipContentPart,
  AiContentPart
} from '@shared/contracts/aiChat'

export type AiPanelRenderedMarkdownPart =
  | {
      type: 'html'
      html: string
    }
  | {
      type: 'code'
      language: string
      code: string
      html: string
      lineCount: number
    }

export type AiPanelCommandSuggestionMessage = {
  id: string
  role: string
  contentParts?: AiContentPart[]
  text: string
  state?: string
  ask?: string
  action?: AiChatHistoryMessage['action']
  commandExecution?: {
    ip?: string
    command: string
    requiresApproval?: boolean
    interactive?: boolean
  }
  executedCommand?: string
  commandExecutionStatus?: AiChatHistoryMessage['commandExecutionStatus']
  commandExecutionMessage?: string
}

type AiPanelExportHostInput = {
  id: string
  kind?: string
  label: string
  detail?: string
}

export const aiPanelChatExportHosts = (message: { hosts?: AiPanelExportHostInput[] }): AiChatHistoryHostContext[] | undefined => {
  const hosts = message.hosts
    ?.filter((host) => host.kind === 'hosts' && host.label.trim())
    .map((host) => ({
      id: host.id,
      kind: 'hosts' as const,
      label: host.label,
      detail: host.detail
    }))
  return hosts?.length ? hosts : undefined
}

export const aiPanelChatExportMessage = (
  message: Omit<AiChatHistoryMessage, 'hosts'> & { hosts?: AiPanelExportHostInput[] }
): AiChatExportMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  contentParts: message.contentParts,
  hosts: aiPanelChatExportHosts(message),
  state: message.state,
  favorite: message.favorite,
  feedback: message.feedback,
  executedCommand: message.executedCommand,
  commandExecutionStatus: message.commandExecutionStatus,
  commandExecutionMessage: message.commandExecutionMessage,
  ask: message.ask,
  say: message.say,
  action: message.action,
  commandExecution: message.commandExecution,
  mcpToolCall: message.mcpToolCall,
  mcpResourceAccess: message.mcpResourceAccess,
  followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
  selectedOption: message.selectedOption,
  partial: message.partial
})

export const aiPanelMessagePlainText = (message: { text: string; contentParts?: AiContentPart[] }) =>
  message.contentParts?.length ? message.contentParts.map((part) => plainTextForAiContentPart(part)).join('') : message.text

const markdownFencePattern = /```([^\n`]*)\n([\s\S]*?)```/g
const renderedMarkdownCache = new Map<string, AiPanelRenderedMarkdownPart[]>()
const renderedMarkdownCacheLimit = 80

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const normalizeAiPanelCodeLanguage = (value: string) => {
  const raw = value.trim().replace(/^\{?\.?/, '').replace(/\}?$/, '')
  const language = raw.split(/\s+/)[0]?.toLowerCase() || ''
  if (language === 'sh' || language === 'shell' || language === 'zsh') return 'bash'
  if (language === 'plaintext' || language === 'plain') return 'text'
  return language
}

export const countAiPanelTextLines = (value: string) => (value ? value.replace(/\r\n/g, '\n').split('\n').length : 0)

export const formatAiPanelLineCount = (count: number) => `${Math.max(1, count)} line${Math.max(1, count) === 1 ? '' : 's'}`

const renderMarkdownHtml = (text: string) => {
  if (!text.trim()) return ''
  const html = marked.parse(text, { async: false, gfm: true, breaks: false }) as string
  return sanitizeMarkdownHtml(html)
}

const highlightCodeHtml = (code: string, language: string) => {
  const normalizedLanguage = normalizeAiPanelCodeLanguage(language)
  if (!code) return ''
  try {
    if (normalizedLanguage && normalizedLanguage !== 'text' && hljs.getLanguage(normalizedLanguage)) {
      return sanitizeMarkdownHtml(hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value)
    }
    if (!normalizedLanguage) {
      return sanitizeMarkdownHtml(hljs.highlightAuto(code).value)
    }
  } catch {
    return escapeHtml(code)
  }
  return escapeHtml(code)
}

const setRenderedMarkdownCache = (key: string, parts: AiPanelRenderedMarkdownPart[]) => {
  if (renderedMarkdownCache.size >= renderedMarkdownCacheLimit) {
    const firstKey = renderedMarkdownCache.keys().next().value
    if (firstKey) renderedMarkdownCache.delete(firstKey)
  }
  renderedMarkdownCache.set(key, parts)
}

export const clearAiPanelRenderedMarkdownCache = () => {
  renderedMarkdownCache.clear()
}

export const renderAiPanelMarkdownParts = (text: string): AiPanelRenderedMarkdownPart[] => {
  const cached = renderedMarkdownCache.get(text)
  if (cached) return cached
  const parts: AiPanelRenderedMarkdownPart[] = []
  let lastIndex = 0
  markdownFencePattern.lastIndex = 0
  for (const match of text.matchAll(markdownFencePattern)) {
    const matchIndex = match.index ?? 0
    const markdownText = text.slice(lastIndex, matchIndex)
    const html = renderMarkdownHtml(markdownText)
    if (html) parts.push({ type: 'html', html })
    const language = normalizeAiPanelCodeLanguage(match[1] || '')
    const code = (match[2] || '').replace(/\n$/, '')
    parts.push({
      type: 'code',
      language,
      code,
      html: highlightCodeHtml(code, language),
      lineCount: countAiPanelTextLines(code)
    })
    lastIndex = matchIndex + match[0].length
  }

  const tailHtml = renderMarkdownHtml(text.slice(lastIndex))
  if (tailHtml) parts.push({ type: 'html', html: tailHtml })
  if (!parts.length && text) parts.push({ type: 'html', html: sanitizeMarkdownHtml(`<p>${escapeHtml(text)}</p>`) })
  setRenderedMarkdownCache(text, parts)
  return parts
}

export const normalizedCommandOutputText = (text: string) => {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```[^\n`]*\n([\s\S]*?)\n?```$/)
  if (fenced) return fenced[1].replace(/\n$/, '')
  return text
}

export const commandOutputLineCount = (text: string) => countAiPanelTextLines(normalizedCommandOutputText(text))

export const isAiPanelCommandSuggestionMessage = (message: AiPanelCommandSuggestionMessage) => {
  if (message.role !== 'assistant' || message.state === 'streaming') return false
  if (message.ask === 'command' && message.commandExecution?.command.trim()) return true
  return Boolean(message.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command') || message.text.trim().startsWith('/'))
}

export const commandChipTextForMessage = (message: { contentParts?: AiContentPart[] }) => {
  const commandPart = message.contentParts?.find((part): part is AiCommandChipContentPart => part.type === 'chip' && part.chipType === 'command')
  return commandPart?.ref.command.trim() || ''
}

export const commandTextForMessage = (message: { text: string; contentParts?: AiContentPart[]; commandExecution?: { command: string } }) =>
  message.commandExecution?.command.trim() || commandChipTextForMessage(message) || aiPanelMessagePlainText(message).trim()

export const commandLineCountForText = (text: string) => text.split(/\r?\n/).filter((line) => line.trim()).length || 1

export const commandLineCountForMessage = (message: AiPanelCommandSuggestionMessage) => commandLineCountForText(commandTextForMessage(message))

export const isReadOnlyCommandMessage = (message: AiPanelCommandSuggestionMessage) =>
  message.commandExecution?.requiresApproval === false && message.commandExecution.interactive !== true

export const isCommandTerminalActionDisabled = (message: AiPanelCommandSuggestionMessage) =>
  message.commandExecutionStatus === 'running' || message.commandExecutionStatus === 'succeeded' || message.action === 'rejected'

export const canEditCommandMessage = (message: AiPanelCommandSuggestionMessage | null) => Boolean(message && message.commandExecutionStatus !== 'running')

export const commandHostForMessage = (message: { commandExecution?: { ip?: string } }) => {
  const ip = message.commandExecution?.ip?.trim()
  return ip ? `Host ${ip}` : ''
}

export const commandHostTooltipForMessage = (message: { commandExecution?: { ip?: string } }) => {
  const ip = message.commandExecution?.ip?.trim()
  return ip ? `目标主机：${ip}` : ''
}

export const updateCommandChipParts = (parts: AiContentPart[] | undefined, command: string) => {
  let updated = false
  const nextParts = parts?.map((part) => {
    if (part.type === 'chip' && part.chipType === 'command') {
      updated = true
      return {
        ...part,
        ref: {
          ...part.ref,
          command,
          label: part.ref.label === part.ref.command ? command : part.ref.label
        }
      }
    }
    return part
  })
  return updated ? nextParts : parts
}

export const applyCommandTextToMessage = (message: AiPanelCommandSuggestionMessage, command: string) => {
  const trimmed = command.trim()
  if (!trimmed) return false
  if (message.commandExecution) {
    message.commandExecution.command = trimmed
  } else if (message.contentParts?.some((part) => part.type === 'chip' && part.chipType === 'command')) {
    message.contentParts = updateCommandChipParts(message.contentParts, trimmed)
    message.text = trimmed
  } else {
    message.text = trimmed
  }
  const wasRejected = message.action === 'rejected'
  if (wasRejected) {
    message.action = undefined
  }
  if ((message.commandExecutionStatus && message.commandExecutionStatus !== 'running') || wasRejected) {
    message.commandExecutionStatus = undefined
    message.commandExecutionMessage = undefined
    message.executedCommand = undefined
  }
  return true
}

export const setAiPanelCommandExecutionState = (
  message: AiPanelCommandSuggestionMessage,
  status: NonNullable<AiChatHistoryMessage['commandExecutionStatus']>,
  text: string,
  executedCommand?: string
) => {
  message.commandExecutionStatus = status
  message.commandExecutionMessage = text
  if (executedCommand) message.executedCommand = executedCommand
}
