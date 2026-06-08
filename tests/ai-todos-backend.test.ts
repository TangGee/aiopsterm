import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadBackend = async () => {
  vi.resetModules()
  const modulePath = '../src/main/backend/aiTodos'
  return import(modulePath)
}

describe('AI todo backend boundary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('lists backend-owned todo and focus-chain snapshot data', async () => {
    const backend = await loadBackend()
    const result = backend.listAiTodoSnapshot()

    expect(result.ok).toBe(true)
    expect(result.data).toBeDefined()
    const snapshot = result.data!
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

  it('returns cloned todo rows so callers cannot mutate the backend seed', async () => {
    const backend = await loadBackend()
    const first = backend.listAiTodoSnapshot()

    expect(first.data).toBeDefined()
    first.data!.todos[1].content = 'renderer mutated todo'
    first.data!.todos[1].subtasks![0].content = 'renderer mutated subtask'

    const second = backend.listAiTodoSnapshot()
    expect(second.data).toBeDefined()
    expect(second.data!.todos[1].content).toBe('生成命令建议')
    expect(second.data!.todos[1].subtasks![0].content).toBe('检查风险级别')
  })
})
