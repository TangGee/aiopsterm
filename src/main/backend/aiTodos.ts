import type { AiTodoItem, AiTodoSnapshot, AiTodoSnapshotResult } from '@shared/preload'

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

const cloneTodo = (todo: AiTodoItem): AiTodoItem => ({
  ...todo,
  subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
})

const buildSnapshot = (todos: AiTodoItem[]): AiTodoSnapshot => {
  const focusedTodo = todos.find((todo) => todo.isFocused) || todos.find((todo) => todo.status === 'in_progress') || null
  return {
    todos: todos.map(cloneTodo),
    focusedTodoId: focusedTodo?.id || null,
    totalTodos: todos.length,
    completedTodos: todos.filter((todo) => todo.status === 'completed').length,
    source: 'backend',
    updatedAt: nowLabel()
  }
}

export const listAiTodoSnapshot = (): AiTodoSnapshotResult => {
  try {
    return {
      ok: true,
      data: buildSnapshot(defaultTodos)
    }
  } catch (error) {
    return {
      ok: false,
      errorCode: 'AI_TODO_SNAPSHOT_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  }
}
