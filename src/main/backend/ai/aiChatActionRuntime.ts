import { randomUUID } from 'crypto'
import type {
  AiChatContextUsageSnapshot,
  AiChatHistoryMessage,
  AiChatResponseInput,
  AiChatResponseResult
} from '@shared/contracts/aiChat'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { McpResourceReadInput, McpResourceReadResult, McpToolCallInput, McpToolCallResult } from '@shared/contracts/mcp'

type AiChatActionResponseControl = {
  requestId?: string
  assistantMessageId?: string
}

type AiChatActionRuntimeRequest = {
  input: AiChatResponseInput
  text: string
  config?: UserConfig
  modelName: string
  startedAt: number
  control: AiChatActionResponseControl
  now: () => number
  contextUsageForResponse: (
    input: AiChatResponseInput,
    control: AiChatActionResponseControl,
    modelName: string,
    text?: string
  ) => AiChatContextUsageSnapshot
  callMcpTool?: (input: McpToolCallInput) => Promise<McpToolCallResult>
}

type AiCommandExecutionInput = {
  ip: string
  command: string
  requiresApproval: boolean
  interactive: boolean
}

type InvalidAiCommandExecutionBlock = {
  invalid: true
  errorCode: string
  errorMessage: string
}

const normalizeText = (value: unknown) => String(value || '').trim()

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

const commandFenceLanguages = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'terminal', 'cmd', 'powershell', 'ps1'])

const readOnlyCommandExecutables = new Set([
  'awk',
  'cat',
  'column',
  'crictl',
  'cut',
  'date',
  'df',
  'dig',
  'dmesg',
  'docker',
  'du',
  'env',
  'egrep',
  'fgrep',
  'file',
  'find',
  'free',
  'grep',
  'head',
  'host',
  'hostname',
  'id',
  'ifconfig',
  'ip',
  'iostat',
  'journalctl',
  'jq',
  'kubectl',
  'last',
  'less',
  'll',
  'ls',
  'lsblk',
  'lscpu',
  'lsof',
  'more',
  'mpstat',
  'netstat',
  'nslookup',
  'pgrep',
  'pidof',
  'podman',
  'printenv',
  'ps',
  'pwd',
  'route',
  'sed',
  'service',
  'sort',
  'ss',
  'stat',
  'systemctl',
  'tail',
  'top',
  'traceroute',
  'uname',
  'uniq',
  'uptime',
  'vmstat',
  'w',
  'watch',
  'wc',
  'who',
  'whoami',
  'yq'
])

const writeOrRiskyCommandPattern =
  /(^|\s)(rm|rmdir|mv|cp|touch|mkdir|chmod|chown|chgrp|dd|mkfs|fdisk|parted|reboot|shutdown|halt|poweroff|kill|killall|pkill|sudo|su|tee|truncate|mount|umount|apt|apt-get|yum|dnf|rpm|dpkg|pip|npm|pnpm|yarn|systemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|daemon-reload)|service\s+\S+\s+(start|stop|restart|reload)|docker\s+(rm|rmi|run|restart|stop|start|kill|exec|compose|volume|network|system)|podman\s+(rm|rmi|run|restart|stop|start|kill|exec|compose|volume|network|system)|kubectl\s+(apply|delete|replace|patch|edit|scale|rollout|cordon|uncordon|drain|taint|exec|attach|cp|create|set|annotate|label))(\s|$)/i

const commandWritesOutputPattern = /(^|[^<])>>?|<<|(\s|^)(curl|wget)\s+[\s\S]*\s(-o|--output|-O|--post|--request\s+(POST|PUT|PATCH|DELETE)|-X\s*(POST|PUT|PATCH|DELETE)|--data|-d)(\s|$)/i
const interactiveCommandPattern = /(^|\s)(top|htop|less|more|watch|vim|vi|nano|ssh|mysql|psql|redis-cli)(\s|$)|\b(kubectl|docker|podman)\s+exec\s+(-it|-ti|--interactive|--tty)/i

const stripShellPrompt = (line: string) =>
  line
    .replace(/^\s*(?:[$>]\s+|#\s+(?=\S))/, '')
    .replace(/^\s*[\w.-]+@[\w.-]+:[^#$\n]*[#$]\s+/, '')

const cleanupCommandCandidate = (value: string) => {
  const lines = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => stripShellPrompt(line).trimEnd())
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.join('\n').trim()
}

const commandHasCjkText = (value: string) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(value)
const commandHasMarkdownOrXml = (value: string) => /```|<\/?[a-z][\w:-]*>/i.test(value)

const commandLooksExecutable = (value: string) => {
  const command = cleanupCommandCandidate(value)
  if (!command || command.length > 4000 || commandHasMarkdownOrXml(command)) return false
  const firstLine = command.split('\n').find((line) => line.trim())?.trim() || ''
  if (!firstLine || commandHasCjkText(firstLine)) return false
  return /^[A-Za-z0-9_./:-]+(?:\s|$)/.test(firstLine)
}

const extractFencedCommandCandidate = (text: string) => {
  const fences = [...text.matchAll(/```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g)]
  const commandFences = fences
    .map((match) => ({
      language: normalizeText(match[1]).toLowerCase(),
      body: cleanupCommandCandidate(match[2])
    }))
    .filter((item) => commandFenceLanguages.has(item.language) && commandLooksExecutable(item.body))
  return commandFences.length === 1 ? commandFences[0].body : ''
}

const extractLabeledCommandCandidate = (text: string) => {
  const labelMatch = text.match(/(?:^|\n)\s*(?:command|cmd|命令|执行命令)\s*[:：]\s*(?:`([^`\n]+)`|([^\n]+)|\n([\s\S]+))$/i)
  if (!labelMatch) return ''
  const candidate = cleanupCommandCandidate(labelMatch[1] || labelMatch[2] || labelMatch[3] || '')
  return commandLooksExecutable(candidate) ? candidate : ''
}

const extractPlainCommandCandidate = (text: string) => {
  const candidate = cleanupCommandCandidate(text)
  const nonEmptyLines = candidate.split('\n').filter((line) => line.trim())
  if (nonEmptyLines.length > 3) return ''
  return commandLooksExecutable(candidate) ? candidate : ''
}

const splitShellSegments = (command: string) => {
  const segments: string[] = []
  let current = ''
  let quote = ''
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]
    if ((char === '"' || char === "'") && command[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char
      current += char
      continue
    }
    if (!quote && (char === ';' || char === '|' || (char === '&' && next === '&') || (char === '|' && next === '|'))) {
      if (current.trim()) segments.push(current.trim())
      current = ''
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) index += 1
      continue
    }
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

const executableName = (segment: string) => {
  const trimmed = segment.trim().replace(/^(?:env\s+|command\s+|builtin\s+|time\s+)/, '')
  const token = trimmed.match(/^([A-Za-z0-9_./:-]+)/)?.[1] || ''
  const parts = token.split('/')
  return (parts[parts.length - 1] || token).toLowerCase()
}

export const isReadOnlyAiChatCommand = (command: string) => {
  if (!command || writeOrRiskyCommandPattern.test(command) || commandWritesOutputPattern.test(command)) return false
  const segments = splitShellSegments(command)
  if (!segments.length) return false
  return segments.every((segment) => {
    const executable = executableName(segment)
    if (!readOnlyCommandExecutables.has(executable)) return false
    if (executable === 'systemctl' && !/^\s*(?:env\s+|command\s+|builtin\s+|time\s+)*systemctl\s+(status|is-active|is-enabled|list-|show|cat)\b/i.test(segment)) return false
    if (executable === 'service' && !/^\s*(?:env\s+|command\s+|builtin\s+|time\s+)*service\s+\S+\s+status\b/i.test(segment)) return false
    if ((executable === 'docker' || executable === 'podman') && !/^\s*(?:env\s+|command\s+|builtin\s+|time\s+)*(?:docker|podman)\s+(ps|logs|inspect|stats|images|version|info)\b/i.test(segment)) {
      return false
    }
    if (executable === 'kubectl' && !/^\s*(?:env\s+|command\s+|builtin\s+|time\s+)*kubectl\s+(get|describe|logs|top|version|cluster-info|config\s+(view|get-contexts|current-context))\b/i.test(segment)) {
      return false
    }
    if (executable === 'sed' && /\s-i(\s|$)/.test(segment)) return false
    return true
  })
}

const inferCommandHost = (input: AiChatResponseInput) => {
  const hostContext = (input.contexts || []).find((context) => normalizeText(context.kind) === 'hosts' && normalizeText(context.label))
  return normalizeText(hostContext?.label || hostContext?.detail || input.command?.path || input.command?.label) || 'local'
}

export const parseCommandModeSuggestion = (input: AiChatResponseInput, text: string): AiCommandExecutionInput | null => {
  if (input.mode !== 'command') return null
  const command =
    extractFencedCommandCandidate(text) ||
    extractLabeledCommandCandidate(text) ||
    extractPlainCommandCandidate(text)
  if (!command) return null
  const readOnly = isReadOnlyAiChatCommand(command)
  return {
    ip: inferCommandHost(input),
    command,
    requiresApproval: !readOnly,
    interactive: interactiveCommandPattern.test(command)
  }
}

const decodeMcpTagValue = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

const readRawMcpTag = (body: string, tagName: string) => {
  const match = body.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i'))
  return match ? match[1].trim() : ''
}

const readMcpTag = (body: string, tagName: string) => {
  const raw = readRawMcpTag(body, tagName)
  return raw ? decodeMcpTagValue(raw) : ''
}

export const parseMcpToolUseBlock = (text: string): McpToolCallInput | null => {
  const block = text.match(/<use_mcp_tool>\s*([\s\S]*?)\s*<\/use_mcp_tool>/i)
  if (!block) return null
  const serverName = readMcpTag(block[1], 'server_name')
  const toolName = readMcpTag(block[1], 'tool_name')
  const argumentsText = readMcpTag(block[1], 'arguments')
  if (!serverName || !toolName) return null
  let parsedArguments: Record<string, unknown> = {}
  if (argumentsText) {
    const parsed = JSON.parse(argumentsText) as unknown
    if (!isRecord(parsed)) {
      throw new Error('MCP tool arguments must be a JSON object.')
    }
    parsedArguments = cloneJsonRecord(parsed) || {}
  }
  return {
    serverName,
    toolName,
    arguments: parsedArguments
  }
}

const parseBooleanTagValue = (value: string) => value.trim().toLowerCase() === 'true'

export const parseExecuteCommandBlock = (text: string): AiCommandExecutionInput | InvalidAiCommandExecutionBlock | null => {
  const block = text.match(/<execute_command>\s*([\s\S]*?)\s*<\/execute_command>/i)
  if (!block) return null
  const ip = readMcpTag(block[1], 'ip')
  const rawCommand = readRawMcpTag(block[1], 'command')
  if (/<!\[CDATA\[/i.test(rawCommand)) {
    return {
      invalid: true,
      errorCode: 'AI_COMMAND_CONTRACT_INVALID',
      errorMessage:
        'AI provider returned an invalid execute_command block: <command> must contain plain shell text and must not use CDATA.'
    }
  }
  const command = rawCommand ? decodeMcpTagValue(rawCommand) : ''
  const requiresApprovalText = readMcpTag(block[1], 'requires_approval')
  const interactiveText = readMcpTag(block[1], 'interactive')
  if (!ip || !command || !requiresApprovalText || !interactiveText) return null
  return {
    ip,
    command,
    requiresApproval: parseBooleanTagValue(requiresApprovalText),
    interactive: parseBooleanTagValue(interactiveText)
  }
}

export const parseMcpResourceAccessBlock = (text: string): McpResourceReadInput | null => {
  const block = text.match(/<access_mcp_resource>\s*([\s\S]*?)\s*<\/access_mcp_resource>/i)
  if (!block) return null
  const serverName = readMcpTag(block[1], 'server_name')
  const uri = readMcpTag(block[1], 'uri')
  if (!serverName || !uri) return null
  return { serverName, uri }
}

export const formatMcpToolCallContent = (content: NonNullable<McpToolCallResult['data']>['content']) => {
  if (!content.length) return '[]'
  return content
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.data === 'string') return item.data
      return JSON.stringify(item, null, 2)
    })
    .join('\n\n')
}

const createMcpToolCallSummary = (toolCall: McpToolCallInput) => `MCP Tool ${toolCall.serverName}/${toolCall.toolName}`
const createMcpResourceAccessSummary = (resourceAccess: McpResourceReadInput) => `MCP Resource ${resourceAccess.serverName}:${resourceAccess.uri}`

const createCommandExecutionSummary = (commandExecution: AiCommandExecutionInput) => `Command ${commandExecution.ip}: ${commandExecution.command}`

const createCommandExecutionAskMessage = (commandExecution: AiCommandExecutionInput, control: AiChatActionResponseControl): AiChatHistoryMessage => ({
  id: control.assistantMessageId || `aichat-command-${randomUUID()}`,
  role: 'assistant',
  text: commandExecution.command,
  state: 'done',
  ask: 'command',
  commandExecution: {
    ip: commandExecution.ip,
    command: commandExecution.command,
    requiresApproval: commandExecution.requiresApproval,
    interactive: commandExecution.interactive
  }
})

const createMcpToolAskMessage = (toolCall: McpToolCallInput, control: AiChatActionResponseControl): AiChatHistoryMessage => ({
  id: control.assistantMessageId || `aichat-mcp-${randomUUID()}`,
  role: 'assistant',
  text: `请求执行 ${createMcpToolCallSummary(toolCall)}。`,
  state: 'done',
  ask: 'mcp_tool_call',
  mcpToolCall: {
    serverName: toolCall.serverName,
    toolName: toolCall.toolName,
    arguments: cloneJsonRecord(toolCall.arguments)
  }
})

const createMcpToolOutputMessage = (
  toolCall: McpToolCallInput,
  text: string,
  state: Extract<AiChatHistoryMessage['state'], 'done' | 'error'>,
  control: AiChatActionResponseControl
): AiChatHistoryMessage => ({
  id: control.assistantMessageId || `aichat-mcp-${randomUUID()}`,
  role: 'assistant',
  text,
  state,
  say: 'command_output',
  action: 'approved',
  mcpToolCall: {
    serverName: toolCall.serverName,
    toolName: toolCall.toolName,
    arguments: cloneJsonRecord(toolCall.arguments)
  }
})

const createMcpResourceAccessAskMessage = (resourceAccess: McpResourceReadInput, control: AiChatActionResponseControl): AiChatHistoryMessage => ({
  id: control.assistantMessageId || `aichat-mcp-resource-${randomUUID()}`,
  role: 'assistant',
  text: `请求访问 ${createMcpResourceAccessSummary(resourceAccess)}。`,
  state: 'done',
  ask: 'mcp_resource_access',
  mcpResourceAccess: {
    serverName: resourceAccess.serverName,
    uri: resourceAccess.uri
  }
})

const createMcpResourceAccessOutputMessage = (
  resourceAccess: McpResourceReadInput,
  text: string,
  state: Extract<AiChatHistoryMessage['state'], 'done' | 'error'>,
  control: AiChatActionResponseControl
): AiChatHistoryMessage => ({
  id: control.assistantMessageId || `aichat-mcp-resource-${randomUUID()}`,
  role: 'assistant',
  text,
  state,
  say: 'command_output',
  action: 'approved',
  mcpResourceAccess: {
    serverName: resourceAccess.serverName,
    uri: resourceAccess.uri
  }
})

const resolveConfiguredMcpTool = (config: UserConfig, toolCall: McpToolCallInput) => {
  const server = (config.mcpServers || []).find((item) => item.name === toolCall.serverName)
  if (!server) return { ok: false as const, reason: `MCP server not found: ${toolCall.serverName}` }
  if (server.disabled || server.status === 'disabled') return { ok: false as const, reason: `MCP server "${server.name}" is disabled.` }
  if (server.status !== 'connected') return { ok: false as const, reason: `MCP server "${server.name}" is not connected.` }
  const tool = server.tools.find((item) => item.name === toolCall.toolName)
  if (!tool) return { ok: false as const, reason: `MCP tool not found: ${server.name}:${toolCall.toolName}` }
  const stateKey = `${server.name}:${tool.name}`
  const enabled = typeof config.mcpToolStates?.[stateKey] === 'boolean' ? config.mcpToolStates[stateKey] : tool.enabled
  if (!enabled) return { ok: false as const, reason: `MCP tool "${stateKey}" is disabled.` }
  return { ok: true as const, server, tool }
}

const resolveConfiguredMcpResourceServer = (config: UserConfig, resourceAccess: McpResourceReadInput) => {
  const server = (config.mcpServers || []).find((item) => item.name === resourceAccess.serverName)
  if (!server) return { ok: false as const, reason: `MCP server not found: ${resourceAccess.serverName}` }
  if (server.disabled || server.status === 'disabled') return { ok: false as const, reason: `MCP server "${server.name}" is disabled.` }
  if (server.status !== 'connected') return { ok: false as const, reason: `MCP server "${server.name}" is not connected.` }
  return { ok: true as const, server }
}

export const formatMcpResourceReadContent = (contents: NonNullable<McpResourceReadResult['data']>['contents']) => {
  if (!contents.length) return '(No content)'
  return (
    contents
      .map((item) => {
        if (typeof item.text === 'string') return item.text
        if (typeof item.blob === 'string') return `[Binary data: ${item.mimeType || 'unknown'}]`
        return JSON.stringify(item, null, 2)
      })
      .filter(Boolean)
      .join('\n\n') || '(No content)'
  )
}

export const resolveMcpToolResponse = async ({
  input,
  text,
  config,
  modelName,
  startedAt,
  control,
  now,
  contextUsageForResponse,
  callMcpTool
}: AiChatActionRuntimeRequest): Promise<AiChatResponseResult | null> => {
  let toolCall: McpToolCallInput | null = null
  try {
    toolCall = parseMcpToolUseBlock(text)
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_ARGUMENTS_INVALID',
      errorMessage: error instanceof Error ? error.message : 'MCP tool arguments are invalid.'
    }
  }
  if (!toolCall) return null
  if (!config) {
    return {
      ok: false,
      errorCode: 'AI_MCP_CONFIG_UNAVAILABLE',
      errorMessage: 'MCP config is unavailable.'
    }
  }
  const configured = resolveConfiguredMcpTool(config, toolCall)
  if (!configured.ok) {
    const message = createMcpToolOutputMessage(toolCall, configured.reason, 'error', control)
    return {
      ok: true,
      data: {
        text: message.text,
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId,
        message,
        contextUsage: contextUsageForResponse(input, control, modelName, message.text)
      }
    }
  }
  if (!configured.tool.autoApprove) {
    const message = createMcpToolAskMessage(toolCall, control)
    return {
      ok: true,
      data: {
        text: message.text,
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId,
        message,
        contextUsage: contextUsageForResponse(input, control, modelName, message.text)
      }
    }
  }
  if (!callMcpTool) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_UNAVAILABLE',
      errorMessage: 'MCP tool call service is unavailable.'
    }
  }
  const result = await callMcpTool(toolCall)
  const output = result.ok && result.data ? formatMcpToolCallContent(result.data.content) : result.errorMessage || `${createMcpToolCallSummary(toolCall)} 调用失败。`
  const message = createMcpToolOutputMessage(toolCall, output, result.ok && result.data && !result.data.isError ? 'done' : 'error', control)
  return {
    ok: true,
    data: {
      text: message.text,
      provider: 'aiopsterm-local',
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId,
      message,
      contextUsage: contextUsageForResponse(input, control, modelName, message.text)
    }
  }
}

export const resolveCommandExecutionResponse = ({
  input,
  text,
  modelName,
  startedAt,
  control,
  now,
  contextUsageForResponse
}: AiChatActionRuntimeRequest): AiChatResponseResult | null => {
  const parsedCommandBlock = parseExecuteCommandBlock(text)
  if (parsedCommandBlock && 'invalid' in parsedCommandBlock) {
    return {
      ok: false,
      errorCode: parsedCommandBlock.errorCode,
      errorMessage: parsedCommandBlock.errorMessage
    }
  }
  const commandExecution = parsedCommandBlock || parseCommandModeSuggestion(input, text)
  if (!commandExecution) return null
  const message = createCommandExecutionAskMessage(commandExecution, control)
  return {
    ok: true,
    data: {
      text: `请求执行 ${createCommandExecutionSummary(commandExecution)}。`,
      provider: 'aiopsterm-local',
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId,
      message,
      contextUsage: contextUsageForResponse(input, control, modelName, message.text)
    }
  }
}

export const resolveMcpResourceAccessResponse = async ({
  input,
  text,
  config,
  modelName,
  startedAt,
  control,
  now,
  contextUsageForResponse
}: AiChatActionRuntimeRequest): Promise<AiChatResponseResult | null> => {
  const resourceAccess = parseMcpResourceAccessBlock(text)
  if (!resourceAccess) return null
  if (!config) {
    return {
      ok: false,
      errorCode: 'AI_MCP_CONFIG_UNAVAILABLE',
      errorMessage: 'MCP config is unavailable.'
    }
  }
  const configured = resolveConfiguredMcpResourceServer(config, resourceAccess)
  if (!configured.ok) {
    const message = createMcpResourceAccessOutputMessage(resourceAccess, configured.reason, 'error', control)
    return {
      ok: true,
      data: {
        text: message.text,
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId,
        message,
        contextUsage: contextUsageForResponse(input, control, modelName, message.text)
      }
    }
  }
  const message = createMcpResourceAccessAskMessage(resourceAccess, control)
  return {
    ok: true,
    data: {
      text: message.text,
      provider: 'aiopsterm-local',
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId,
      message,
      contextUsage: contextUsageForResponse(input, control, modelName, message.text)
    }
  }
}
