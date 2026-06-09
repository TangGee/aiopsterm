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

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/aiTodos'
  backend = (await import(modulePath)) as AiTodosBackend
}

const expectOkSnapshot = (result: any) => {
  expect(result.ok).toBe(true)
  expect(result.data).toBeDefined()
  return result.data as Record<string, any>
}

describe('AI todo backend boundary', () => {
  beforeEach(async () => {
    await loadBackend()
    const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-todos-'))
    tempDirs.push(dir)
    backend.configureAiTodoBackendRuntime({ stateFilePath: join(dir, 'ai-todos.json'), useSeedData: true })
    backend.resetAiTodosForTests()
  })

  afterEach(async () => {
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
