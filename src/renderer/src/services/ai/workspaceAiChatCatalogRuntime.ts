import {
  isAiCommandCatalogData,
  isAiContextCatalogData,
  isAiTodoSnapshotData,
  malformedAiBackendResultMessage
} from '@/services/ai/aiBackendGuards'
import { aiCatalogClient } from '@/services/ai/aiCatalogClient'
import type { WorkspaceAiChatControllerState } from '@/services/ai/workspaceAiChatTypes'
import type { AiContextOption } from '@shared/contracts/aiChat'

export const createWorkspaceAiChatCatalogRuntime = (input: {
  state: Pick<WorkspaceAiChatControllerState, 'aiContextCatalog' | 'aiCommandOptions' | 'selectedContexts' | 'todoItems'>
  setTopNotice: (message: string) => void
  loadChatConversationsFromBackend: (options?: { restoreIfEmpty?: boolean; restoreSelection?: boolean }) => Promise<boolean>
  openedHostContexts: () => AiContextOption[]
}) => {
  const { state, setTopNotice, loadChatConversationsFromBackend, openedHostContexts } = input
  const { aiContextCatalog, aiCommandOptions, selectedContexts, todoItems } = state
  let classicChatHydrationPromise: Promise<boolean> | null = null

  const syncOpenedHostContexts = () => {
    aiContextCatalog.value = {
      ...aiContextCatalog.value,
      openedHosts: openedHostContexts().map((host) => ({ ...host }))
    }
  }

  const refreshAiContextCatalog = async (options: { hydrateSelection?: boolean } = { hydrateSelection: false }) => {
    const listAiContextCatalog = aiCatalogClient.listAiContextCatalog()
    if (!listAiContextCatalog) {
      setTopNotice('AI 上下文加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiContextCatalog()
    } catch {
      setTopNotice('AI 上下文加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 上下文加载失败')
      return false
    }
    if (!isAiContextCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiContextCatalog.value = {
      categories: result.data.categories.map((category) => ({
        ...category,
        options: category.options.map((option) => ({ ...option }))
      })),
      openedHosts: openedHostContexts().map((host) => ({ ...host })),
      selectedDefaults: result.data.selectedDefaults.map((context) => ({ ...context }))
    }
    if (options.hydrateSelection === true && selectedContexts.value.length === 0) {
      selectedContexts.value = aiContextCatalog.value.selectedDefaults.map((context) => ({ ...context }))
    }
    return true
  }

  const refreshAiCommandCatalog = async () => {
    const listAiCommandCatalog = aiCatalogClient.listAiCommandCatalog()
    if (!listAiCommandCatalog) {
      setTopNotice('AI 命令加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiCommandCatalog()
    } catch {
      setTopNotice('AI 命令加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 命令加载失败')
      return false
    }
    if (!isAiCommandCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiCommandOptions.value = result.data.commands.map((command) => ({ ...command }))
    return true
  }

  const refreshAiTodoSnapshot = async () => {
    const listAiTodoSnapshot = aiCatalogClient.listAiTodoSnapshot()
    if (!listAiTodoSnapshot) return false
    let result
    try {
      result = await listAiTodoSnapshot()
    } catch {
      return false
    }
    if (!result?.ok) return false
    if (!isAiTodoSnapshotData(result.data)) return false
    todoItems.value = result.data.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
    }))
    return true
  }

  const hydrateClassicChatData = async (options: { restoreIfEmpty?: boolean; restoreSelection?: boolean } = {}) => {
    if (classicChatHydrationPromise) return classicChatHydrationPromise
    classicChatHydrationPromise = Promise.all([
      loadChatConversationsFromBackend({
        restoreIfEmpty: options.restoreIfEmpty !== false,
        restoreSelection: options.restoreSelection !== false
      }),
      refreshAiTodoSnapshot(),
      refreshAiContextCatalog({ hydrateSelection: false }),
      refreshAiCommandCatalog()
    ])
      .then((results) => results.every(Boolean))
      .finally(() => {
        classicChatHydrationPromise = null
      })
    return classicChatHydrationPromise
  }

  return {
    refreshAiContextCatalog,
    syncOpenedHostContexts,
    refreshAiCommandCatalog,
    refreshAiTodoSnapshot,
    hydrateClassicChatData
  }
}
