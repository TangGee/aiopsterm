import { randomUUID } from 'crypto'
import type {
  AiChatCancelInput,
  AiChatCancelResult,
  AiChatCommandInput,
  AiChatContextInput,
  AiChatExchangeRequestInput,
  AiChatExchangeRequestResult,
  AiChatHistoryHostContext,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatResponseInput,
  AiChatResponseResult,
  AiChatSkillInput,
  McpToolCallInput,
  McpToolCallResult,
  ModelProviderCheckKey,
  SkillUserConfig,
  UserConfig
} from '@shared/preload'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider, type AiProviderTextMessage } from './modelProviderText'
import { recordAiTodoCancelResult, recordAiTodoExchangeRequest, recordAiTodoResponseResult } from './aiTodos'

const normalizeText = (value: unknown) => String(value || '').trim()
export const LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS = 600
const AI_CHAT_CANCELLED_TEXT = '已停止生成。'

type AiChatRuntimeConfig = {
  getConfig?: () => UserConfig
  listSkills?: () => SkillUserConfig[] | Promise<SkillUserConfig[]>
  callMcpTool?: (input: McpToolCallInput) => Promise<McpToolCallResult>
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}

let runtimeConfig: AiChatRuntimeConfig = {}

type AiChatResponseControl = {
  requestId?: string
  assistantMessageId?: string
  controller: AbortController
  cancelled: boolean
}

const activeAiChatResponses = new Map<string, AiChatResponseControl>()
const pendingCancelledAiChatResponses = new Set<string>()

const wait = (durationMs: number) => {
  if (runtimeConfig.wait) return runtimeConfig.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const now = () => (runtimeConfig.now ? runtimeConfig.now() : Date.now())

export const configureAiChatRuntime = (config?: AiChatRuntimeConfig) => {
  runtimeConfig = config ? { ...config } : {}
  activeAiChatResponses.forEach((control) => control.controller.abort())
  activeAiChatResponses.clear()
  pendingCancelledAiChatResponses.clear()
}

const requestIdFromAssistantMessageId = (assistantMessageId?: string) => {
  const normalized = normalizeText(assistantMessageId)
  return normalized.endsWith('-assistant') ? normalized.slice(0, -'-assistant'.length) : ''
}

const normalizeAiChatResponseIds = (input: AiChatCancelInput | AiChatResponseInput) => {
  const assistantMessageId = normalizeText(input.assistantMessageId)
  const requestId = normalizeText(input.requestId) || requestIdFromAssistantMessageId(assistantMessageId)
  return {
    requestId: requestId || undefined,
    assistantMessageId: assistantMessageId || (requestId ? `${requestId}-assistant` : undefined)
  }
}

const aiChatResponseKeys = (input: AiChatCancelInput | AiChatResponseInput | AiChatResponseControl) => {
  const requestId = normalizeText(input.requestId)
  const assistantMessageId = normalizeText(input.assistantMessageId)
  return [
    requestId ? `request:${requestId}` : '',
    assistantMessageId ? `assistant:${assistantMessageId}` : ''
  ].filter(Boolean)
}

const registerAiChatResponseControl = (input: AiChatResponseInput) => {
  const ids = normalizeAiChatResponseIds(input)
  const control: AiChatResponseControl = {
    requestId: ids.requestId,
    assistantMessageId: ids.assistantMessageId,
    controller: new AbortController(),
    cancelled: false
  }
  const keys = aiChatResponseKeys(control)
  control.cancelled = keys.some((key) => pendingCancelledAiChatResponses.has(key))
  if (control.cancelled) control.controller.abort()
  keys.forEach((key) => activeAiChatResponses.set(key, control))
  return control
}

const unregisterAiChatResponseControl = (control: AiChatResponseControl) => {
  aiChatResponseKeys(control).forEach((key) => {
    if (activeAiChatResponses.get(key) === control) activeAiChatResponses.delete(key)
    pendingCancelledAiChatResponses.delete(key)
  })
}

const isAiChatResponseCancelled = (control: AiChatResponseControl) => control.cancelled || control.controller.signal.aborted

const cancelledAiChatResponse = (control: AiChatResponseControl, modelName: string, startedAt: number): AiChatResponseResult => ({
  ok: true,
  data: {
    text: AI_CHAT_CANCELLED_TEXT,
    provider: 'aiopsterm-local',
    model: modelName,
    durationMs: Math.max(1, now() - startedAt),
    status: 'cancelled',
    requestId: control.requestId,
    assistantMessageId: control.assistantMessageId
  }
})

export const cancelAiChatResponse = (input: AiChatCancelInput): AiChatCancelResult => {
  const ids = normalizeAiChatResponseIds(input)
  const keys = aiChatResponseKeys(ids)
  if (!keys.length) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_CANCEL_TARGET_REQUIRED',
      errorMessage: 'AI chat response cancellation requires a request or assistant message id'
    }
  }

  let active = false
  let control: AiChatResponseControl | undefined
  for (const key of keys) {
    const existing = activeAiChatResponses.get(key)
    if (existing) {
      control = existing
      break
    }
  }
  if (control) {
    active = true
    control.cancelled = true
    control.controller.abort()
  }
  keys.forEach((key) => pendingCancelledAiChatResponses.add(key))

  const result: AiChatCancelResult = {
    ok: true,
    data: {
      status: 'cancelled',
      requestId: control?.requestId || ids.requestId,
      assistantMessageId: control?.assistantMessageId || ids.assistantMessageId,
      text: AI_CHAT_CANCELLED_TEXT,
      active
    }
  }
  recordAiTodoCancelResult(input, result)
  return result
}

const normalizeHostContexts = (hosts?: AiChatExchangeRequestInput['hosts']): AiChatHistoryHostContext[] | undefined => {
  const normalized = (hosts || [])
    .map((host): AiChatHistoryHostContext | null => {
      const label = normalizeText(host.label)
      if (!label) return null
      return {
        id: normalizeText(host.id) || `host-${randomUUID()}`,
        kind: 'hosts',
        label,
        detail: normalizeText(host.detail) || undefined
      }
    })
    .filter(Boolean) as AiChatHistoryHostContext[]
  return normalized.length ? normalized : undefined
}

const normalizeMode = (mode: unknown): AiChatResponseInput['mode'] | undefined => (mode === 'agent' || mode === 'command' || mode === 'chat' ? mode : undefined)

const normalizeChatContexts = (contexts?: AiChatExchangeRequestInput['contexts']): AiChatContextInput[] =>
  (contexts || [])
    .map((context): AiChatContextInput | null => {
      const label = normalizeText(context.label)
      const kind = normalizeText(context.kind)
      if (!label || !kind) return null
      return {
        id: normalizeText(context.id) || `${kind}-${randomUUID()}`,
        kind,
        label,
        detail: normalizeText(context.detail) || undefined,
        relPath: normalizeText(context.relPath) || undefined,
        mediaType: normalizeText(context.mediaType) || undefined
      }
    })
    .filter(Boolean) as AiChatContextInput[]

const normalizeCommand = (command?: AiChatCommandInput | null): AiChatCommandInput | null => {
  if (!command) return null
  const normalized: AiChatCommandInput = {
    id: normalizeText(command.id) || undefined,
    label: normalizeText(command.label) || undefined,
    command: normalizeText(command.command) || undefined,
    path: normalizeText(command.path) || undefined
  }
  return normalized.id || normalized.label || normalized.command ? normalized : null
}

const skillNameFromContext = (context: AiChatContextInput) => {
  const id = normalizeText(context.id)
  if (id.startsWith('skill:')) return id.slice('skill:'.length)
  return normalizeText(context.label) || id
}

const resolveSelectedSkills = async (contexts: AiChatContextInput[]): Promise<AiChatSkillInput[]> => {
  const selectedNames = new Set(contexts.filter((context) => context.kind === 'skills').map(skillNameFromContext).filter(Boolean))
  if (!selectedNames.size || !runtimeConfig.listSkills) return []
  try {
    const skills = await runtimeConfig.listSkills()
    return skills
      .filter((skill) => skill.enabled && selectedNames.has(skill.name))
      .map((skill) => ({
        name: skill.name,
        description: normalizeText(skill.description) || undefined,
        content: normalizeText(skill.content) || undefined
      }))
  } catch {
    return []
  }
}

const commandDisplay = (command?: AiChatCommandInput | null) => normalizeText(command?.label || command?.command || command?.id)

const buildExchangePrompt = (text: string, contexts: AiChatContextInput[], skills: AiChatSkillInput[], command: AiChatCommandInput | null) => {
  const contextLabel = contexts.length ? `\n\n上下文：${contexts.map((item) => `${item.kind}:${item.label}`).join('、')}` : ''
  const commandLabel = commandDisplay(command) ? `\n命令：${commandDisplay(command)}` : ''
  const selectedKnowledgeDocs = contexts.filter((item) => item.kind === 'docs' && item.relPath)
  const selectedKnowledgeImages = contexts.filter((item) => item.kind === 'images' && item.relPath)
  const knowledgeContext =
    selectedKnowledgeDocs.length || selectedKnowledgeImages.length
      ? `\n\nKnowledge Context:\n${[
          ...selectedKnowledgeDocs.map((doc) => `- doc: ${doc.label} (${doc.relPath})`),
          ...selectedKnowledgeImages.map((image) => `- image: ${image.label} (${image.relPath}, ${image.mediaType || 'image'})`)
        ].join('\n')}`
      : ''
  const skillContext = skills.length
    ? `\n\nSkill Instructions:\n${skills
        .map((skill) => `# Skill Activated: ${skill.name}\nDescription: ${skill.description || ''}\n\n${skill.content || ''}`.trimEnd())
        .join('\n\n')}`
    : ''
  return `${text}${contextLabel}${commandLabel}${knowledgeContext}${skillContext}`.trim()
}

const buildResponseMessages = (messages: AiChatMessageInput[] | undefined, prompt: string): AiChatMessageInput[] => {
  const history = (messages || [])
    .slice(-12)
    .map((message): AiChatMessageInput | null => {
      const text = normalizeText(message.text)
      if (!text) return null
      return { role: message.role, text }
    })
    .filter(Boolean) as AiChatMessageInput[]
  const last = history[history.length - 1]
  return last?.role === 'user' && last.text === prompt ? history : [...history, { role: 'user', text: prompt }]
}

export const createAiChatExchangeRequest = async (input: AiChatExchangeRequestInput): Promise<AiChatExchangeRequestResult> => {
  const text = normalizeText(input.text)
  const contexts = normalizeChatContexts(input.contexts)
  const command = normalizeCommand(input.command)
  const skills = await resolveSelectedSkills(contexts)
  const prompt = buildExchangePrompt(text, contexts, skills, command)
  if (!prompt) return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
  const requestId = `aichat-request-${randomUUID()}`
  const assistantMessage = {
    id: `${requestId}-assistant`,
    role: 'assistant' as const,
    text: '正在请求 aiopsterm AI 后端...',
    state: 'streaming' as const
  }
  const responseInput: AiChatResponseInput = {
    requestId,
    assistantMessageId: assistantMessage.id,
    prompt,
    messages: buildResponseMessages(input.messages, prompt),
    contexts,
    skills,
    command,
    model: normalizeText(input.model) || undefined,
    mode: normalizeMode(input.mode)
  }
  recordAiTodoExchangeRequest({ ...input, text: prompt, contexts, command, model: responseInput.model, mode: responseInput.mode }, requestId, assistantMessage.id)
  return {
    ok: true,
    data: {
      requestId,
      userMessage: {
        id: `${requestId}-user`,
        role: 'user',
        text: prompt,
        hosts: normalizeHostContexts(input.hosts)
      },
      assistantMessage,
      responseInput
    }
  }
}

const summarizeContexts = (input: AiChatResponseInput) => {
  const contexts = (input.contexts || []).slice(0, 5).map((item) => `${item.kind}:${item.label}`)
  if (!contexts.length) return '未附加外部上下文'
  return contexts.join('、')
}

const createAiChatSystemPrompt = (input: AiChatResponseInput) => {
  const modeLabel = input.mode === 'agent' ? 'Agent mode' : input.mode === 'command' ? 'Command mode' : 'Chat mode'
  const contextSummary = summarizeContexts(input)
  const skills = (input.skills || [])
    .slice(0, 5)
    .map((skill) =>
      [`Skill: ${normalizeText(skill.name)}`, normalizeText(skill.description) ? `Description: ${normalizeText(skill.description)}` : '', normalizeText(skill.content)]
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n')
  const command = normalizeText(input.command?.command || input.command?.label || input.command?.id)

  return [
    'You are aiopsterm, an AI operations assistant for terminal, SSH, Kubernetes, files, and database workflows.',
    'Respond in the same language as the operator when possible.',
    'Use the provided conversation, selected contexts, skills, and command chip as the source of truth.',
    'Prefer read-only diagnostics before proposing destructive or state-changing actions.',
    'Do not claim that you executed commands, changed files, connected to hosts, or queried databases unless the user-provided context explicitly includes that output.',
    'When an action is risky, explain the risk and ask for confirmation before providing an executable command.',
    '',
    `Mode: ${modeLabel}`,
    `Selected context: ${contextSummary}`,
    command ? `Selected command chip: ${command}` : '',
    skills ? `Activated skills:\n${skills}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const mapConversationForProvider = (messages: AiChatMessageInput[] | undefined, prompt: string): AiProviderTextMessage[] => {
  const normalized = (messages || [])
    .slice(-16)
    .map((message): AiProviderTextMessage | null => {
      const content = normalizeText(message.text)
      if (!content) return null
      if (message.role === 'assistant') return { role: 'assistant', content }
      if (message.role === 'system') return { role: 'user', content: `System note: ${content}` }
      return { role: 'user', content }
    })
    .filter(Boolean) as AiProviderTextMessage[]
  const last = normalized[normalized.length - 1]
  if (!last || last.role !== 'user' || last.content !== prompt) {
    normalized.push({ role: 'user', content: prompt })
  }
  return normalized
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

const decodeMcpToolTagValue = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

const readMcpToolTag = (body: string, tagName: string) => {
  const match = body.match(new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, 'i'))
  return match ? decodeMcpToolTagValue(match[1]) : ''
}

const parseMcpToolUseBlock = (text: string): McpToolCallInput | null => {
  const block = text.match(/<use_mcp_tool>\s*([\s\S]*?)\s*<\/use_mcp_tool>/i)
  if (!block) return null
  const serverName = readMcpToolTag(block[1], 'server_name')
  const toolName = readMcpToolTag(block[1], 'tool_name')
  const argumentsText = readMcpToolTag(block[1], 'arguments')
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

const formatMcpToolCallContent = (content: NonNullable<McpToolCallResult['data']>['content']) => {
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

const createMcpToolAskMessage = (toolCall: McpToolCallInput, control: AiChatResponseControl): AiChatHistoryMessage => ({
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
  control: AiChatResponseControl
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

const resolveMcpToolResponse = async (
  text: string,
  config: UserConfig | undefined,
  modelName: string,
  startedAt: number,
  control: AiChatResponseControl
): Promise<AiChatResponseResult | null> => {
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
        message
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
        message
      }
    }
  }
  if (!runtimeConfig.callMcpTool) {
    return {
      ok: false,
      errorCode: 'AI_MCP_TOOL_CALL_UNAVAILABLE',
      errorMessage: 'MCP tool call service is unavailable.'
    }
  }
  const result = await runtimeConfig.callMcpTool(toolCall)
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
      message
    }
  }
}

async function generateProviderAiChatResponse(
  input: AiChatResponseInput,
  config: UserConfig,
  modelName: string,
  startedAt: number,
  control: AiChatResponseControl
): Promise<AiChatResponseResult | null> {
  const providerConfig = resolveModelProvider(config, modelName)
  if (!providerConfig) return null
  const prompt = normalizeText(input.prompt)
  const request = createProviderTextRequest(providerConfig, createAiChatSystemPrompt(input), mapConversationForProvider(input.messages, prompt), 1600)
  if (!request) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
      errorMessage: 'AI chat provider is unavailable'
    }
  }
  const response = await fetchProviderText(request, {
    fetch: runtimeConfig.fetch,
    timeoutMs: runtimeConfig.timeoutMs || 30_000,
    errorCodePrefix: 'AI_CHAT_PROVIDER',
    signal: control.controller.signal
  })
  if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(control, modelName, startedAt)
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage
    }
  }
  const mcpResponse = await resolveMcpToolResponse(response.text, config, modelName, startedAt, control)
  if (mcpResponse) return mcpResponse
  return {
    ok: true,
    data: {
      text: response.text,
      provider: providerConfig.provider as ModelProviderCheckKey,
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId
    }
  }
}

export const generateAiChatResponse = async (input: AiChatResponseInput): Promise<AiChatResponseResult> => {
  const startedAt = now()
  const control = registerAiChatResponseControl(input)
  const prompt = normalizeText(input.prompt)
  const complete = (result: AiChatResponseResult) => {
    recordAiTodoResponseResult(input, result)
    return result
  }
  try {
    if (!prompt && !(input.skills || []).length && !input.command) {
      return complete({ ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' })
    }

    const modelName = normalizeText(input.model) || normalizeText(runtimeConfig.getConfig?.().modelName) || 'aiopsterm-local-agent'
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(control, modelName, startedAt))
    const config = runtimeConfig.getConfig?.()
    if (config) {
      const providerResponse = await generateProviderAiChatResponse(input, config, modelName, startedAt, control)
      if (providerResponse) return complete(providerResponse)
    }
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(control, modelName, startedAt))
    if (modelName !== 'aiopsterm-local-agent') {
      return complete({
        ok: false,
        errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
        errorMessage: 'AI chat provider is unavailable'
      })
    }

    const skillLines = (input.skills || [])
      .slice(0, 3)
      .map((skill) => `Activated Skill: ${skill.name}`)
    const commandLabel = normalizeText(input.command?.label || input.command?.command || input.command?.id)
    const recentUserTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-3).length
    const lines = [
      ...skillLines,
      skillLines.length ? '' : '',
      '正在读取当前终端、资产和知识库上下文...',
      '',
      '计划：',
      `1. 确认目标环境：${summarizeContexts(input)}。`,
      `2. 根据请求生成只读检查步骤${commandLabel ? `，优先参考命令 ${commandLabel}` : ''}。`,
      `3. 等待用户确认后执行，当前会话已纳入 ${recentUserTurns} 条用户输入。`,
      '',
      '当前响应由 aiopsterm 本地后端生成，未连接远端 AI 服务。'
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '')
    const elapsedMs = now() - startedAt
    if (elapsedMs < LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS) {
      await wait(LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS - elapsedMs)
    }
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(control, modelName, startedAt))

    return complete({
      ok: true,
      data: {
        text: lines.join('\n'),
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId
      }
    })
  } finally {
    unregisterAiChatResponseControl(control)
  }
}
