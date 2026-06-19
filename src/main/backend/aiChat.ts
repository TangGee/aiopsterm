import { randomUUID } from 'crypto'
import type {
  AiChatCancelInput,
  AiChatCancelResult,
  AiChatCommandInput,
  AiChatContextInput,
  AiChatContextUsageSnapshot,
  AiChatExchangeRequestInput,
  AiChatExchangeRequestResult,
  AiChatHistoryHostContext,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiPreferencesUserConfig,
  AiChatResponseInput,
  AiChatResponseResult,
  AiChatSkillInput,
  McpResourceReadInput,
  McpResourceReadResult,
  McpToolCallInput,
  McpToolCallResult,
  ModelProviderCheckKey,
  SkillUserConfig,
  UserConfig
} from '@shared/preload'
import { shouldUseAiChatBackendDouble } from '@shared/runtimeSwitches'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider, type AiProviderTextMessage } from './modelProviderText'
import { recordAiTodoCancelResult, recordAiTodoExchangeRequest, recordAiTodoResponseResult } from './aiTodos'
import { createAiProviderProxyFetch } from './aiProviderProxyFetch'

const normalizeText = (value: unknown) => String(value || '').trim()
export const LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS = 600
const AI_CHAT_CANCELLED_TEXT = '已停止生成。'
const reasoningEffortValues = ['low', 'medium', 'high'] as const
const proxyTypeValues = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5'] as const

const defaultAiChatPreferences: AiPreferencesUserConfig = {
  enableExtendedThinking: true,
  thinkingBudgetTokens: 4096,
  autoExecuteReadOnlyCommands: false,
  commandOutputFilteringEnabled: true,
  kbSearchEnabled: true,
  experienceExtractionEnabled: true,
  managedAiAutoNamingEnabled: false,
  autoApproval: false,
  reasoningEffort: 'medium',
  needProxy: false,
  proxy: {
    type: 'HTTP',
    host: '127.0.0.1',
    port: 7890,
    enableProxyIdentity: false,
    username: '',
    password: ''
  },
  shellIntegrationTimeout: 4
}

type AiChatRuntimeConfig = {
  getConfig?: () => UserConfig
  listSkills?: () => SkillUserConfig[] | Promise<SkillUserConfig[]>
  callMcpTool?: (input: McpToolCallInput) => Promise<McpToolCallResult>
  localBackendDouble?: boolean
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

const isAiChatLocalDoubleEnabled = () => runtimeConfig.localBackendDouble === true || shouldUseAiChatBackendDouble()

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => {
  const text = normalizeText(value)
  return options.includes(text as T) ? (text as T) : fallback
}

const normalizeThinkingBudget = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value === 0) return 0
  return Math.min(6553, Math.max(1024, Math.round(value)))
}

const normalizeAiChatPreferences = (source?: Partial<AiPreferencesUserConfig>): AiPreferencesUserConfig => {
  const incoming = isRecord(source) ? source : {}
  const incomingProxy: Record<string, unknown> = isRecord(incoming.proxy) ? incoming.proxy : {}
  const normalized: AiPreferencesUserConfig = {
    enableExtendedThinking: typeof incoming.enableExtendedThinking === 'boolean' ? incoming.enableExtendedThinking : defaultAiChatPreferences.enableExtendedThinking,
    thinkingBudgetTokens: normalizeThinkingBudget(incoming.thinkingBudgetTokens, defaultAiChatPreferences.thinkingBudgetTokens),
    autoExecuteReadOnlyCommands:
      typeof incoming.autoExecuteReadOnlyCommands === 'boolean' ? incoming.autoExecuteReadOnlyCommands : defaultAiChatPreferences.autoExecuteReadOnlyCommands,
    commandOutputFilteringEnabled:
      typeof incoming.commandOutputFilteringEnabled === 'boolean'
        ? incoming.commandOutputFilteringEnabled
        : defaultAiChatPreferences.commandOutputFilteringEnabled,
    kbSearchEnabled: typeof incoming.kbSearchEnabled === 'boolean' ? incoming.kbSearchEnabled : defaultAiChatPreferences.kbSearchEnabled,
    experienceExtractionEnabled:
      typeof incoming.experienceExtractionEnabled === 'boolean' ? incoming.experienceExtractionEnabled : defaultAiChatPreferences.experienceExtractionEnabled,
    managedAiAutoNamingEnabled:
      typeof incoming.managedAiAutoNamingEnabled === 'boolean'
        ? incoming.managedAiAutoNamingEnabled
        : defaultAiChatPreferences.managedAiAutoNamingEnabled,
    autoApproval: typeof incoming.autoApproval === 'boolean' ? incoming.autoApproval : defaultAiChatPreferences.autoApproval,
    reasoningEffort: stringFromOptions(incoming.reasoningEffort, reasoningEffortValues, defaultAiChatPreferences.reasoningEffort),
    needProxy: typeof incoming.needProxy === 'boolean' ? incoming.needProxy : defaultAiChatPreferences.needProxy,
    proxy: {
      type: stringFromOptions(incomingProxy.type, proxyTypeValues, defaultAiChatPreferences.proxy.type),
      host: typeof incomingProxy.host === 'string' ? incomingProxy.host : defaultAiChatPreferences.proxy.host,
      port: numberInRange(incomingProxy.port, defaultAiChatPreferences.proxy.port, 1, 65535),
      enableProxyIdentity:
        typeof incomingProxy.enableProxyIdentity === 'boolean' ? incomingProxy.enableProxyIdentity : defaultAiChatPreferences.proxy.enableProxyIdentity,
      username: typeof incomingProxy.username === 'string' ? incomingProxy.username : defaultAiChatPreferences.proxy.username,
      password: typeof incomingProxy.password === 'string' ? incomingProxy.password : defaultAiChatPreferences.proxy.password
    },
    shellIntegrationTimeout: numberInRange(incoming.shellIntegrationTimeout, defaultAiChatPreferences.shellIntegrationTimeout, 1, 300)
  }
  if (!normalized.enableExtendedThinking) normalized.thinkingBudgetTokens = 0
  if (normalized.enableExtendedThinking && normalized.thinkingBudgetTokens === 0) normalized.thinkingBudgetTokens = 1024
  return normalized
}

const aiChatPreferencesFromConfig = (config?: UserConfig) => normalizeAiChatPreferences(config?.aiPreferences)

const providerMaxTokensForPreferences = (preferences: AiPreferencesUserConfig) =>
  preferences.enableExtendedThinking ? Math.min(8192, 1600 + preferences.thinkingBudgetTokens) : 1600

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

const contextUsageForResponse = (input: AiChatResponseInput, control: AiChatResponseControl, modelName: string, text = '') =>
  buildBackendContextUsageSnapshot({
    ...input,
    requestId: control.requestId || input.requestId,
    assistantMessageId: control.assistantMessageId || input.assistantMessageId,
    model: modelName,
    tokensOut: estimateTextTokens(text)
  })

const cancelledAiChatResponse = (input: AiChatResponseInput, control: AiChatResponseControl, modelName: string, startedAt: number): AiChatResponseResult => ({
  ok: true,
  data: {
    text: AI_CHAT_CANCELLED_TEXT,
    provider: 'aiopsterm-local',
    model: modelName,
    durationMs: Math.max(1, now() - startedAt),
    status: 'cancelled',
    requestId: control.requestId,
    assistantMessageId: control.assistantMessageId,
    contextUsage: contextUsageForResponse(input, control, modelName, AI_CHAT_CANCELLED_TEXT)
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

const estimateTextTokens = (value: string | undefined | null) => {
  const text = normalizeText(value).replace(/\s+/g, ' ')
  if (!text) return 0
  const cjkCount = text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  return Math.max(1, Math.ceil(cjkCount * 0.75 + (text.length - cjkCount) / 4))
}

const estimateContextWindow = (modelName: string) => {
  const normalized = normalizeText(modelName).toLowerCase()
  if (normalized.includes('mini') || normalized.includes('small')) return 64000
  if (normalized.includes('long')) return 200000
  if (normalized.includes('gpt-5') || normalized.includes('claude') || normalized.includes('qwen')) return 128000
  return 128000
}

const estimateContextTokens = (context: AiChatContextInput) =>
  estimateTextTokens(`${context.kind} ${context.label} ${context.detail || ''} ${context.relPath || ''} ${context.mediaType || ''}`)

const estimateSkillTokens = (skill: AiChatSkillInput) => estimateTextTokens(`${skill.name} ${skill.description || ''}\n${skill.content || ''}`)

const estimateCommandTokens = (command?: AiChatCommandInput | null) =>
  command ? estimateTextTokens(`${command.id || ''} ${command.label || ''} ${command.command || ''} ${command.path || ''}`) : 0

const buildBackendContextUsageSnapshot = (input: {
  requestId?: string
  assistantMessageId?: string
  model?: string
  prompt: string
  messages?: AiChatMessageInput[]
  contexts?: AiChatContextInput[]
  skills?: AiChatSkillInput[]
  command?: AiChatCommandInput | null
  tokensOut?: number
}): AiChatContextUsageSnapshot => {
  const tokensIn =
    estimateTextTokens(input.prompt) +
    (input.messages || []).reduce((sum, message) => sum + estimateTextTokens(message.text), 0) +
    (input.contexts || []).reduce((sum, context) => sum + estimateContextTokens(context), 0) +
    (input.skills || []).reduce((sum, skill) => sum + estimateSkillTokens(skill), 0) +
    estimateCommandTokens(input.command)
  const tokensOut = Math.max(0, Math.round(input.tokensOut || 0))
  const contextWindow = estimateContextWindow(input.model || normalizeText(runtimeConfig.getConfig?.().modelName) || 'aiopsterm-local-agent')
  const used = tokensIn + tokensOut
  return {
    used,
    contextWindow,
    percent: Math.min(100, Math.round((used / contextWindow) * 100)),
    tokensIn,
    tokensOut,
    cacheWrites: 0,
    cacheReads: 0,
    source: 'backend',
    requestId: normalizeText(input.requestId) || undefined,
    assistantMessageId: normalizeText(input.assistantMessageId) || undefined
  }
}

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
      return {
        role: message.role,
        text,
        ask: message.ask,
        say: message.say,
        action: message.action,
        commandExecution: message.commandExecution
      }
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
  const contextUsage = buildBackendContextUsageSnapshot({
    ...responseInput,
    requestId,
    assistantMessageId: assistantMessage.id,
    model: responseInput.model
  })
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
      responseInput,
      contextUsage
    }
  }
}

const summarizeContexts = (input: AiChatResponseInput) => {
  const contexts = (input.contexts || []).slice(0, 5).map((item) => `${item.kind}:${item.label}`)
  if (!contexts.length) return '未附加外部上下文'
  return contexts.join('、')
}

const createAiPreferencePrompt = (preferences: AiPreferencesUserConfig) =>
  [
    'AI preferences:',
    `- Reasoning effort target: ${preferences.reasoningEffort}.`,
    preferences.enableExtendedThinking
      ? `- Extended Thinking is enabled with a ${preferences.thinkingBudgetTokens} token budget. Use the extra budget for internal analysis, but do not reveal hidden reasoning.`
      : '- Extended Thinking is disabled. Keep analysis concise.',
    preferences.commandOutputFilteringEnabled
      ? '- Long command outputs may be compacted before they are sent to you; respect omission markers and ask for a narrower read-only command if missing lines matter.'
      : '- Command output filtering is disabled; full captured command output may be included.',
    preferences.kbSearchEnabled
      ? '- Knowledge base search is enabled; automatically attached docs are relevant retrieval results, not user-selected proof unless the context says so.'
      : '- Knowledge base search is disabled; use only explicitly selected contexts.',
    preferences.experienceExtractionEnabled
      ? '- When a reusable operational lesson is obvious, state it briefly as a durable practice.'
      : '- Do not add reusable experience extraction notes unless the operator asks.',
    preferences.autoApproval
      ? '- Auto approval may exist only for low-risk read-only actions, but you must still mark risky or state-changing commands as requiring approval.'
      : '- Auto approval is disabled; keep approval requirements explicit.'
  ].join('\n')

const createAiChatSystemPrompt = (input: AiChatResponseInput, preferences: AiPreferencesUserConfig = defaultAiChatPreferences) => {
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
    input.mode === 'command'
      ? [
          'Command mode output contract:',
          '- Return exactly one executable shell command as an <execute_command> block when the operator asks for a command.',
          '- Include <ip>, <command>, <requires_approval>, and <interactive> fields.',
          '- Use <requires_approval>false</requires_approval> only for read-only diagnostic/query commands.',
          '- Use <requires_approval>true</requires_approval> for destructive, state-changing, write, restart, install, delete, or uncertain commands.',
          '- Put plain shell text directly inside <command>; do not wrap it in CDATA, Markdown, or another XML tag.',
          '- If the command contains XML-sensitive characters, escape them as entities inside <command> (for example &amp;, &lt;, &gt;).',
          '- Do not wrap the command in Markdown when an <execute_command> block is suitable.'
        ].join('\n')
      : input.mode === 'agent'
        ? [
            'Agent mode tool contract:',
            '- When terminal observation is needed, request exactly one executable shell command as an <execute_command> block.',
            '- Include <ip>, <command>, <requires_approval>, and <interactive> fields.',
            '- Use <requires_approval>false</requires_approval> only for read-only diagnostic/query commands.',
            '- Use <requires_approval>true</requires_approval> for destructive, state-changing, write, restart, install, delete, or uncertain commands.',
            '- Put plain shell text directly inside <command>; do not wrap it in CDATA, Markdown, or another XML tag.',
            '- If the command contains XML-sensitive characters, escape them as entities inside <command> (for example &amp;, &lt;, &gt;).',
            '- After the conversation includes command_output from an approved command, analyze that output before deciding whether another <execute_command> block is needed.',
            '- If no more terminal step is needed, provide the final answer and do not request another command.',
            '- Do not claim that a command ran unless command_output is present in the conversation.'
          ].join('\n')
      : '',
    `Selected context: ${contextSummary}`,
    command ? `Selected command chip: ${command}` : '',
    skills ? `Activated skills:\n${skills}` : '',
    createAiPreferencePrompt(preferences)
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
      if (message.say === 'command_output') {
        const command = normalizeText(message.commandExecution?.command)
        const label = command ? `Command output for "${command}":` : 'Command output:'
        return { role: 'user', content: `${label}\n${content}` }
      }
      if (message.ask === 'command') {
        const command = normalizeText(message.commandExecution?.command || content)
        return { role: 'assistant', content: command ? `Requested command:\n${command}` : content }
      }
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

const cloneJsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
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

const isReadOnlyCommand = (command: string) => {
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

const parseCommandModeSuggestion = (input: AiChatResponseInput, text: string): AiCommandExecutionInput | null => {
  if (input.mode !== 'command') return null
  const command =
    extractFencedCommandCandidate(text) ||
    extractLabeledCommandCandidate(text) ||
    extractPlainCommandCandidate(text)
  if (!command) return null
  const readOnly = isReadOnlyCommand(command)
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

const parseMcpToolUseBlock = (text: string): McpToolCallInput | null => {
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

const parseExecuteCommandBlock = (text: string): AiCommandExecutionInput | InvalidAiCommandExecutionBlock | null => {
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

const parseMcpResourceAccessBlock = (text: string): McpResourceReadInput | null => {
  const block = text.match(/<access_mcp_resource>\s*([\s\S]*?)\s*<\/access_mcp_resource>/i)
  if (!block) return null
  const serverName = readMcpTag(block[1], 'server_name')
  const uri = readMcpTag(block[1], 'uri')
  if (!serverName || !uri) return null
  return { serverName, uri }
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
const createMcpResourceAccessSummary = (resourceAccess: McpResourceReadInput) => `MCP Resource ${resourceAccess.serverName}:${resourceAccess.uri}`

const createCommandExecutionSummary = (commandExecution: AiCommandExecutionInput) => `Command ${commandExecution.ip}: ${commandExecution.command}`

const createCommandExecutionAskMessage = (commandExecution: AiCommandExecutionInput, control: AiChatResponseControl): AiChatHistoryMessage => ({
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

const createMcpResourceAccessAskMessage = (resourceAccess: McpResourceReadInput, control: AiChatResponseControl): AiChatHistoryMessage => ({
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
  control: AiChatResponseControl
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

const resolveMcpToolResponse = async (
  input: AiChatResponseInput,
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
      message,
      contextUsage: contextUsageForResponse(input, control, modelName, message.text)
    }
  }
}

const resolveCommandExecutionResponse = (
  input: AiChatResponseInput,
  text: string,
  modelName: string,
  startedAt: number,
  control: AiChatResponseControl
): AiChatResponseResult | null => {
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

const resolveMcpResourceAccessResponse = async (
  input: AiChatResponseInput,
  text: string,
  config: UserConfig | undefined,
  modelName: string,
  startedAt: number,
  control: AiChatResponseControl
): Promise<AiChatResponseResult | null> => {
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
  const preferences = aiChatPreferencesFromConfig(config)
  const request = createProviderTextRequest(
    providerConfig,
    createAiChatSystemPrompt(input, preferences),
    mapConversationForProvider(input.messages, prompt),
    providerMaxTokensForPreferences(preferences),
    { preferences }
  )
  if (!request) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
      errorMessage: 'AI chat provider is unavailable'
    }
  }
  const proxyFetch = createAiProviderProxyFetch(preferences)
  const response = await fetchProviderText(request, {
    fetch: proxyFetch || runtimeConfig.fetch,
    timeoutMs: runtimeConfig.timeoutMs || 30_000,
    errorCodePrefix: 'AI_CHAT_PROVIDER',
    signal: control.controller.signal,
    maxRetries: 5
  })
  if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(input, control, modelName, startedAt)
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage
    }
  }
  const commandResponse = resolveCommandExecutionResponse(input, response.text, modelName, startedAt, control)
  if (commandResponse) return commandResponse
  const mcpResponse = await resolveMcpToolResponse(input, response.text, config, modelName, startedAt, control)
  if (mcpResponse) return mcpResponse
  const mcpResourceResponse = await resolveMcpResourceAccessResponse(input, response.text, config, modelName, startedAt, control)
  if (mcpResourceResponse) return mcpResourceResponse
  return {
    ok: true,
    data: {
      text: response.text,
      provider: providerConfig.provider as ModelProviderCheckKey,
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId,
      contextUsage: contextUsageForResponse(input, control, modelName, response.text)
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
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(input, control, modelName, startedAt))
    const config = runtimeConfig.getConfig?.()
    if (config) {
      const providerResponse = await generateProviderAiChatResponse(input, config, modelName, startedAt, control)
      if (providerResponse) return complete(providerResponse)
    }
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(input, control, modelName, startedAt))
    if (modelName !== 'aiopsterm-local-agent' || !isAiChatLocalDoubleEnabled()) {
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
    if (isAiChatResponseCancelled(control)) return complete(cancelledAiChatResponse(input, control, modelName, startedAt))

    return complete({
      ok: true,
      data: {
        text: lines.join('\n'),
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId,
        contextUsage: contextUsageForResponse(input, control, modelName, lines.join('\n'))
      }
    })
  } finally {
    unregisterAiChatResponseControl(control)
  }
}
