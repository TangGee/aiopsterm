import type { AiChatCancelInput, AiChatCancelResult, AiChatExchangeRequestInput, AiChatResponseInput, AiChatResponseResult, AiTodoItem, AiTodoSnapshot, AiTodoSnapshotResult } from '@shared/preload'
import { shouldUseAiTodoSeedData } from '@shared/runtimeSwitches'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, resolve } from 'path'

type AiTodoBackendRuntimeConfig = {
  stateFilePath?: string
  useSeedData?: boolean
}

type AiTodoPersistedState = {
  version: 1
  todos: AiTodoItem[]
  requestId?: string
  assistantMessageId?: string
  prompt?: string
  updatedAt: string
}

const nowLabel = () => '刚刚'

const defaultTodos: AiTodoItem[] = [
  { id: 'todo-1', content: '收集上下文', description: '读取终端输出、资产和知识库引用', status: 'completed' },
  {
    id: 'todo-2',
    content: '生成命令建议',
    description: '只生成需要确认的只读命令',
    status: 'in_progress',
    isFocused: true,
    subtasks: [
      { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
      { id: 'todo-2-2', content: '生成回滚步骤' }
    ]
  },
  { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
]

const defaultAiTodoStateFilePath = () => {
  const envPath = String(process.env.AIOPSTERM_AI_TODO_STATE_FILE || '').trim()
  return envPath ? (isAbsolute(envPath) ? envPath : resolve(envPath)) : resolve(process.cwd(), '.aiopsterm-ai-todos.json')
}

const defaultAiTodoSeedMode = shouldUseAiTodoSeedData

let runtimeConfig: Required<AiTodoBackendRuntimeConfig> = {
  stateFilePath: defaultAiTodoStateFilePath(),
  useSeedData: defaultAiTodoSeedMode()
}

let todoStateLoaded = false
let loadedStateFilePath = ''
let todoState: AiTodoPersistedState = {
  version: 1,
  todos: runtimeConfig.useSeedData ? defaultTodos.map((todo) => ({ ...todo, subtasks: todo.subtasks?.map((subtask) => ({ ...subtask })) })) : [],
  updatedAt: nowLabel()
}

const cloneTodo = (todo: AiTodoItem): AiTodoItem => ({
  ...todo,
  subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
})

const cloneTodos = (todos: AiTodoItem[]) => todos.map(cloneTodo)

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizeText = (value: unknown) => String(value || '').trim()

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = stableValue(value[key])
      if (nextValue !== undefined) result[key] = nextValue
      return result
    }, {})
}

const stableJson = (value: unknown) => JSON.stringify(stableValue(value))

const normalizeTodoStatus = (value: unknown): AiTodoItem['status'] =>
  value === 'completed' || value === 'in_progress' || value === 'pending' ? value : 'pending'

const normalizeTodoRows = (value: unknown, fallback: AiTodoItem[] = runtimeConfig.useSeedData ? cloneTodos(defaultTodos) : []): AiTodoItem[] => {
  if (!Array.isArray(value)) return fallback
  const seenIds = new Set<string>()
  const todos: AiTodoItem[] = []
  value.forEach((item, index) => {
    if (!isRecord(item)) return
    const content = normalizeText(item.content)
    if (!content) return
    let id = normalizeText(item.id) || `todo-${index + 1}`
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    const subtasks = Array.isArray(item.subtasks)
      ? item.subtasks
          .map((subtask, subtaskIndex) => {
            if (!isRecord(subtask)) return null
            const subtaskContent = normalizeText(subtask.content)
            if (!subtaskContent) return null
            return {
              id: normalizeText(subtask.id) || `${id}-${subtaskIndex + 1}`,
              content: subtaskContent,
              ...(normalizeText(subtask.description) ? { description: normalizeText(subtask.description) } : {})
            }
          })
          .filter(Boolean)
      : []
    todos.push({
      id,
      content,
      ...(normalizeText(item.description) ? { description: normalizeText(item.description) } : {}),
      status: normalizeTodoStatus(item.status),
      ...(item.isFocused === true ? { isFocused: true } : {}),
      ...(subtasks.length ? { subtasks: subtasks as NonNullable<AiTodoItem['subtasks']> } : {})
    })
  })
  const focusedIndex = todos.findIndex((todo) => todo.isFocused)
  return todos.map((todo, index) => ({ ...todo, isFocused: focusedIndex === -1 ? todo.isFocused : index === focusedIndex || undefined }))
}

const normalizedSeedTodos = () => normalizeTodoRows(defaultTodos, cloneTodos(defaultTodos))

const stripLegacySeedTodos = (todos: AiTodoItem[]) => {
  if (runtimeConfig.useSeedData) return todos
  const seedTodos = new Map(normalizedSeedTodos().map((todo) => [todo.id, todo]))
  const strippedTodos = todos.filter((todo) => {
    const seedTodo = seedTodos.get(todo.id)
    return !seedTodo || stableJson(todo) !== stableJson(seedTodo)
  })
  const focusedIndex = strippedTodos.findIndex((todo) => todo.isFocused)
  return strippedTodos.map((todo, index) => ({ ...todo, isFocused: focusedIndex === -1 ? todo.isFocused : index === focusedIndex || undefined }))
}

const normalizeTodos = (value: unknown): AiTodoItem[] => stripLegacySeedTodos(normalizeTodoRows(value))

const normalizePersistedState = (value: unknown): AiTodoPersistedState | null => {
  if (!isRecord(value)) return null
  return {
    version: 1,
    todos: normalizeTodos(value.todos),
    requestId: normalizeText(value.requestId) || undefined,
    assistantMessageId: normalizeText(value.assistantMessageId) || undefined,
    prompt: normalizeText(value.prompt) || undefined,
    updatedAt: normalizeText(value.updatedAt) || nowLabel()
  }
}

const applyInitialState = () => {
  todoState = {
    version: 1,
    todos: runtimeConfig.useSeedData ? cloneTodos(defaultTodos) : [],
    updatedAt: nowLabel()
  }
}

const ensureTodoStateLoaded = () => {
  if (todoStateLoaded && loadedStateFilePath === runtimeConfig.stateFilePath) return
  todoStateLoaded = true
  loadedStateFilePath = runtimeConfig.stateFilePath
  applyInitialState()
  if (!existsSync(runtimeConfig.stateFilePath)) return
  try {
    const parsed = JSON.parse(readFileSync(runtimeConfig.stateFilePath, 'utf-8')) as unknown
    const restored = normalizePersistedState(parsed)
    if (restored) {
      todoState = restored
      if (!runtimeConfig.useSeedData) persistTodoState()
    }
  } catch {
    /* Keep the backend-owned default when the persisted todo state is corrupt. */
  }
}

const persistTodoState = () => {
  ensureTodoStateLoaded()
  try {
    mkdirSync(dirname(runtimeConfig.stateFilePath), { recursive: true })
    const tempPath = `${runtimeConfig.stateFilePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(todoState, null, 2), 'utf-8')
    renameSync(tempPath, runtimeConfig.stateFilePath)
  } catch {
    /* Todo persistence should not fail an AI chat response. */
  }
}

const buildSnapshot = (todos: AiTodoItem[], updatedAt = nowLabel()): AiTodoSnapshot => {
  const focusedTodo = todos.find((todo) => todo.isFocused) || todos.find((todo) => todo.status === 'in_progress') || null
  return {
    todos: todos.map(cloneTodo),
    focusedTodoId: focusedTodo?.id || null,
    totalTodos: todos.length,
    completedTodos: todos.filter((todo) => todo.status === 'completed').length,
    source: 'backend',
    updatedAt
  }
}

const promptSummary = (value: unknown) => {
  const text = normalizeText(value)
  if (!text) return '根据当前请求生成运维步骤'
  return text.length > 48 ? `${text.slice(0, 48)}...` : text
}

const requestTodos = (input: AiChatExchangeRequestInput, requestId: string, assistantMessageId?: string): AiTodoItem[] => [
  {
    id: 'todo-1',
    content: '收集上下文',
    description: input.hosts?.length ? `已绑定 ${input.hosts.length} 个主机上下文` : '已接收本次对话输入',
    status: 'completed'
  },
  {
    id: 'todo-2',
    content: '生成命令建议',
    description: `正在为「${promptSummary(input.text)}」生成只读诊断步骤`,
    status: 'in_progress',
    isFocused: true,
    subtasks: [
      { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
      { id: 'todo-2-2', content: assistantMessageId ? `关联响应 ${assistantMessageId}` : `关联请求 ${requestId}` }
    ]
  },
  { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
]

const responseTodos = (input: AiChatResponseInput, result: AiChatResponseResult): AiTodoItem[] => {
  const cancelled = result.ok && result.data?.status === 'cancelled'
  const failed = !result.ok
  return [
    {
      id: 'todo-1',
      content: '收集上下文',
      description: input.contexts?.length ? `已整理 ${input.contexts.length} 个上下文` : '已整理会话输入',
      status: 'completed'
    },
    {
      id: 'todo-2',
      content: '生成命令建议',
      description: cancelled ? '生成已停止，可调整上下文后重试' : failed ? result.errorMessage || 'AI 响应生成失败' : '只读诊断步骤已生成',
      status: failed || cancelled ? 'in_progress' : 'completed',
      isFocused: failed || cancelled ? true : undefined,
      subtasks: [
        { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
        { id: 'todo-2-2', content: input.command?.label || input.command?.command ? `参考命令 ${input.command.label || input.command.command}` : '生成回滚步骤' }
      ]
    },
    {
      id: 'todo-3',
      content: '等待确认',
      description: cancelled ? '当前响应已取消' : failed ? '修复模型或网络问题后重试' : '等待用户确认是否执行后续命令',
      status: failed || cancelled ? 'pending' : 'in_progress',
      isFocused: failed || cancelled ? undefined : true
    }
  ]
}

export const configureAiTodoBackendRuntime = (config: AiTodoBackendRuntimeConfig = {}) => {
  runtimeConfig = {
    stateFilePath: config.stateFilePath ? (isAbsolute(config.stateFilePath) ? config.stateFilePath : resolve(config.stateFilePath)) : defaultAiTodoStateFilePath(),
    useSeedData: config.useSeedData ?? defaultAiTodoSeedMode()
  }
  todoStateLoaded = false
  loadedStateFilePath = ''
  applyInitialState()
}

export const resetAiTodosForTests = () => {
  applyInitialState()
  todoStateLoaded = true
  loadedStateFilePath = runtimeConfig.stateFilePath
}

export const listAiTodoSnapshot = (): AiTodoSnapshotResult => {
  try {
    ensureTodoStateLoaded()
    return {
      ok: true,
      data: buildSnapshot(todoState.todos, todoState.updatedAt)
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_TODO_SNAPSHOT_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}

export const recordAiTodoExchangeRequest = (input: AiChatExchangeRequestInput, requestId: string, assistantMessageId?: string) => {
  ensureTodoStateLoaded()
  todoState = {
    version: 1,
    requestId,
    assistantMessageId,
    prompt: normalizeText(input.text) || undefined,
    updatedAt: nowLabel(),
    todos: requestTodos(input, requestId, assistantMessageId)
  }
  persistTodoState()
}

export const recordAiTodoResponseResult = (input: AiChatResponseInput, result: AiChatResponseResult) => {
  ensureTodoStateLoaded()
  const requestId = normalizeText(input.requestId) || todoState.requestId
  const assistantMessageId = normalizeText(input.assistantMessageId) || todoState.assistantMessageId
  todoState = {
    version: 1,
    requestId,
    assistantMessageId,
    prompt: normalizeText(input.prompt) || todoState.prompt,
    updatedAt: nowLabel(),
    todos: responseTodos(input, result)
  }
  persistTodoState()
}

export const recordAiTodoCancelResult = (input: AiChatCancelInput, result: AiChatCancelResult) => {
  const data = result.data
  if (!result.ok || !data) return
  const requestId = normalizeText(data.requestId) || normalizeText(input.requestId)
  const assistantMessageId = normalizeText(data.assistantMessageId) || normalizeText(input.assistantMessageId)
  recordAiTodoResponseResult(
    {
      requestId,
      assistantMessageId,
      prompt: todoState.prompt || '取消当前 AI 生成'
    },
    {
      ok: true,
      data: {
        text: data.text,
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        durationMs: 1,
        status: 'cancelled',
        requestId,
        assistantMessageId
      }
    }
  )
}
