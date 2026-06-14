import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type AiTodosBackend = {
  configureAiTodoBackendRuntime: (config?: { stateFilePath?: string; useSeedData?: boolean }) => void
  resetAiTodosForTests: () => void
  listAiTodoSnapshot: () => any
  recordAiTodoExchangeRequest: (input: any, requestId: string, assistantMessageId?: string) => void
  recordAiTodoResponseResult: (input: any, result: any) => void
  recordAiTodoCancelResult: (input: any, result: any) => void
}

let backend: AiTodosBackend
const tempDirs: string[] = []
const originalAiTodoSeedEnv = process.env.AIOPSTERM_AI_TODO_ENABLE_SEED

const loadBackend = async () => {
  delete process.env.AIOPSTERM_AI_TODO_ENABLE_SEED
  vi.resetModules()
  const modulePath = '../src/main/backend/aiTodos'
  backend = (await import(modulePath)) as AiTodosBackend
}

const expectOkSnapshot = (result: any) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as Record<string, any>
}

const useTempRuntime = async (options: { useSeedData: boolean; prefix?: string }) => {
  const dir = await mkdtemp(join(tmpdir(), options.prefix || 'aiopsterm-ai-todos-'))
  tempDirs.push(dir)
  const stateFilePath = join(dir, 'ai-todos.json')
  backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: options.useSeedData })
  backend.resetAiTodosForTests()
  return stateFilePath
}

describe('AI todo backend boundary', () => {
  beforeEach(async () => {
    await loadBackend()
    await useTempRuntime({ useSeedData: true })
  })

  afterEach(async () => {
    if (originalAiTodoSeedEnv === undefined) {
      delete process.env.AIOPSTERM_AI_TODO_ENABLE_SEED
    } else {
      process.env.AIOPSTERM_AI_TODO_ENABLE_SEED = originalAiTodoSeedEnv
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('lists backend-owned seed todo and focus-chain snapshot data for tests', async () => {
    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot).toMatchObject({
      focusedTodoId: 'todo-2',
      totalTodos: 3,
      completedTodos: 1,
      source: 'backend',
      updatedAt: '刚刚'
    })
    expect(snapshot.todos.map((todo: { content: string }) => todo.content)).toEqual(['收集上下文', '生成命令建议', '等待确认'])
    expect(snapshot.todos.find((todo: { id: string }) => todo.id === 'todo-2')).toMatchObject({
      status: 'in_progress',
      isFocused: true,
      description: '只生成需要确认的只读命令',
      subtasks: expect.arrayContaining([
        expect.objectContaining({
          id: 'todo-2-1',
          content: '检查风险级别',
          description: '危险命令需要二次确认'
        })
      ])
    })
  })

  it('does not expose development seed todos in non-seed runtime defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-nonseed-'))
    tempDirs.push(dir)
    backend.configureAiTodoBackendRuntime({ stateFilePath: join(dir, 'ai-todos.json'), useSeedData: false })
    backend.resetAiTodosForTests()

    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot).toMatchObject({
      focusedTodoId: null,
      totalTodos: 0,
      completedTodos: 0,
      source: 'backend'
    })
    expect(snapshot.todos).toEqual([])
  })

  it('does not infer todo seed mode from NODE_ENV test', async () => {
    backend.configureAiTodoBackendRuntime()
    backend.resetAiTodosForTests()

    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(process.env.NODE_ENV).toBe('test')
    expect(snapshot.focusedTodoId).toBeNull()
    expect(snapshot.totalTodos).toBe(0)
    expect(snapshot.todos).toEqual([])
  })

  it('loads todo development seeds only when the seed environment switch is enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-env-seed-'))
    tempDirs.push(dir)
    process.env.AIOPSTERM_AI_TODO_ENABLE_SEED = '1'
    backend.configureAiTodoBackendRuntime({ stateFilePath: join(dir, 'ai-todos.json') })
    backend.resetAiTodosForTests()

    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.focusedTodoId).toBe('todo-2')
    expect(snapshot.totalTodos).toBe(3)
    expect(snapshot.todos.map((todo: { content: string }) => todo.content)).toEqual(['收集上下文', '生成命令建议', '等待确认'])
  })

  it('strips unmodified legacy seed todos from non-seed runtime state', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: true, prefix: 'aiopsterm-ai-todos-legacy-seed-empty-' })
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        todos: [
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
        ],
        updatedAt: 'legacy-seed'
      }),
      'utf-8'
    )

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.focusedTodoId).toBeNull()
    expect(snapshot.totalTodos).toBe(0)
    expect(snapshot.todos).toEqual([])
  })

  it('strips legacy provider-unavailable todo state from non-seed runtime state', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-ai-todos-provider-unavailable-legacy-' })
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        requestId: 'legacy-provider-request',
        assistantMessageId: 'legacy-provider-request-assistant',
        prompt: '检查生产磁盘',
        todos: [
          { id: 'todo-1', content: '收集上下文', description: '已整理会话输入', status: 'completed' },
          {
            id: 'todo-2',
            content: '生成命令建议',
            description: 'AI chat provider is unavailable',
            status: 'in_progress',
            isFocused: true,
            subtasks: [
              { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
              { id: 'todo-2-2', content: '生成回滚步骤' }
            ]
          },
          { id: 'todo-3', content: '等待确认', description: '修复模型或网络问题后重试', status: 'pending' }
        ],
        updatedAt: 'legacy-provider-unavailable'
      }),
      'utf-8'
    )

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.focusedTodoId).toBeNull()
    expect(snapshot.totalTodos).toBe(0)
    expect(snapshot.todos).toEqual([])
    expect(JSON.parse(await readFile(stateFilePath, 'utf-8')).todos).toEqual([])
  })

  it('preserves user-edited seed-derived todos while stripping unchanged seeds', async () => {
    const stateFilePath = await useTempRuntime({ useSeedData: false, prefix: 'aiopsterm-ai-todos-legacy-seed-edited-' })
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        todos: [
          { id: 'todo-1', content: '收集上下文', description: '读取终端输出、资产和知识库引用', status: 'completed' },
          {
            id: 'todo-2',
            content: '生成用户确认命令',
            description: '用户已经改过的执行计划',
            status: 'in_progress',
            isFocused: true,
            subtasks: [
              { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
              { id: 'todo-2-2', content: '保留用户补充的回滚步骤' }
            ]
          },
          { id: 'todo-3', content: '等待确认', description: '用户确认后才进入执行阶段', status: 'pending' }
        ],
        requestId: 'legacy-request',
        assistantMessageId: 'legacy-assistant',
        prompt: 'legacy prompt',
        updatedAt: 'legacy-edited'
      }),
      'utf-8'
    )

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.focusedTodoId).toBe('todo-2')
    expect(snapshot.totalTodos).toBe(1)
    expect(snapshot.completedTodos).toBe(0)
    expect(snapshot.updatedAt).toBe('legacy-edited')
    expect(snapshot.todos).toEqual([
      expect.objectContaining({
        id: 'todo-2',
        content: '生成用户确认命令',
        description: '用户已经改过的执行计划',
        status: 'in_progress',
        isFocused: true,
        subtasks: [
          { id: 'todo-2-1', content: '检查风险级别', description: '危险命令需要二次确认' },
          { id: 'todo-2-2', content: '保留用户补充的回滚步骤' }
        ]
      })
    ])
  })

  it('returns cloned todo rows so callers cannot mutate the backend snapshot', async () => {
    const first = expectOkSnapshot(backend.listAiTodoSnapshot())

    first.todos[1].content = 'renderer mutated todo'
    first.todos[1].subtasks[0].content = 'renderer mutated subtask'

    const second = expectOkSnapshot(backend.listAiTodoSnapshot())
    expect(second.todos[1].content).toBe('生成命令建议')
    expect(second.todos[1].subtasks[0].content).toBe('检查风险级别')
  })

  it('persists chat request todo state and restores it through the backend store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-request-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'ai-todos.json')
    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    backend.resetAiTodosForTests()

    backend.recordAiTodoExchangeRequest(
      {
        text: '检查生产磁盘',
        hosts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1', detail: 'production' }]
      },
      'aichat-request-1',
      'aichat-request-1-assistant'
    )

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as { requestId: string; assistantMessageId: string; todos: Array<{ content: string; status: string; isFocused?: boolean }> }
    expect(persisted).toMatchObject({
      requestId: 'aichat-request-1',
      assistantMessageId: 'aichat-request-1-assistant'
    })
    expect(persisted.todos).toEqual([
      expect.objectContaining({ content: '收集上下文', status: 'completed' }),
      expect.objectContaining({ content: '生成命令建议', status: 'in_progress', isFocused: true }),
      expect.objectContaining({ content: '等待确认', status: 'pending' })
    ])

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    const restored = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(restored.focusedTodoId).toBe('todo-2')
    expect(restored.todos[1]).toMatchObject({
      content: '生成命令建议',
      status: 'in_progress',
      description: expect.stringContaining('检查生产磁盘')
    })
    expect(restored.todos[1].subtasks[1].content).toContain('aichat-request-1-assistant')
  })

  it('persists completed and cancelled response todo states', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-response-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'ai-todos.json')
    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    backend.resetAiTodosForTests()

    backend.recordAiTodoResponseResult(
      {
        requestId: 'aichat-request-2',
        assistantMessageId: 'aichat-request-2-assistant',
        prompt: '检查生产磁盘',
        contexts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1' }],
        command: { label: '/rollback-plan', command: '/rollback-plan' }
      },
      {
        ok: true,
        data: {
          text: 'done',
          provider: 'aiopsterm-local',
          model: 'aiopsterm-local-agent',
          durationMs: 1,
          status: 'done',
          requestId: 'aichat-request-2',
          assistantMessageId: 'aichat-request-2-assistant'
        }
      }
    )

    let snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())
    expect(snapshot.completedTodos).toBe(2)
    expect(snapshot.focusedTodoId).toBe('todo-3')
    expect(snapshot.todos[1]).toMatchObject({ content: '生成命令建议', status: 'completed' })
    expect(snapshot.todos[2]).toMatchObject({ content: '等待确认', status: 'in_progress', isFocused: true })
    expect(snapshot.todos[1].subtasks[1].content).toBe('参考命令 /rollback-plan')

    backend.recordAiTodoCancelResult(
      { requestId: 'aichat-request-2', assistantMessageId: 'aichat-request-2-assistant' },
      {
        ok: true,
        data: {
          status: 'cancelled',
          requestId: 'aichat-request-2',
          assistantMessageId: 'aichat-request-2-assistant',
          text: '已停止生成。',
          active: true
        }
      }
    )
    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.focusedTodoId).toBe('todo-2')
    expect(snapshot.todos[1]).toMatchObject({
      content: '生成命令建议',
      status: 'in_progress',
      isFocused: true,
      description: '生成已停止，可调整上下文后重试'
    })
    expect(snapshot.todos[2]).toMatchObject({ content: '等待确认', status: 'pending', description: '当前响应已取消' })
  })

  it('clears request todo state when the AI provider is unavailable before any real response', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-provider-unavailable-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'ai-todos.json')
    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    backend.resetAiTodosForTests()

    backend.recordAiTodoExchangeRequest({ text: '检查生产磁盘' }, 'aichat-request-provider-missing', 'aichat-request-provider-missing-assistant')
    expect(expectOkSnapshot(backend.listAiTodoSnapshot()).totalTodos).toBe(3)

    backend.recordAiTodoResponseResult(
      {
        requestId: 'aichat-request-provider-missing',
        assistantMessageId: 'aichat-request-provider-missing-assistant',
        prompt: '检查生产磁盘'
      },
      {
        ok: false,
        errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
        errorMessage: 'AI chat provider is unavailable'
      }
    )

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    const snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())
    const persisted = JSON.parse(await readFile(stateFilePath, 'utf-8')) as { todos: unknown[]; requestId: string; assistantMessageId: string }

    expect(snapshot).toMatchObject({
      focusedTodoId: null,
      totalTodos: 0,
      completedTodos: 0
    })
    expect(snapshot.todos).toEqual([])
    expect(persisted.todos).toEqual([])
    expect(persisted.requestId).toBe('aichat-request-provider-missing')
    expect(persisted.assistantMessageId).toBe('aichat-request-provider-missing-assistant')
  })

  it('normalizes malformed persisted todo state and falls back on corrupt files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-malformed-'))
    tempDirs.push(dir)
    const stateFilePath = join(dir, 'ai-todos.json')
    await writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        todos: [
          { id: 'todo-x', content: '  Valid Task  ', status: 'bad', isFocused: true, subtasks: [{ id: '', content: '  Subtask  ' }] },
          { id: 'todo-x', content: '', status: 'completed' },
          { id: 'todo-x', content: 'Duplicate Id', status: 'completed', isFocused: true }
        ],
        updatedAt: 'restored'
      }),
      'utf-8'
    )

    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    let snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.updatedAt).toBe('restored')
    expect(snapshot.todos).toEqual([
      expect.objectContaining({ id: 'todo-x', content: 'Valid Task', status: 'pending', isFocused: true }),
      expect.objectContaining({ id: 'todo-x-3', content: 'Duplicate Id', status: 'completed' })
    ])
    expect(snapshot.todos[1].isFocused).toBeUndefined()
    expect(snapshot.todos[0].subtasks).toEqual([{ id: 'todo-x-1', content: 'Subtask' }])

    await writeFile(stateFilePath, '{bad json', 'utf-8')
    backend.configureAiTodoBackendRuntime({ stateFilePath, useSeedData: false })
    snapshot = expectOkSnapshot(backend.listAiTodoSnapshot())

    expect(snapshot.todos).toEqual([])
    expect(snapshot.totalTodos).toBe(0)
  })
})
