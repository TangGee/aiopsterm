import { computed, reactive, type Ref } from 'vue'
import type { FileSessionFolderRecord, FileSessionInfo } from '@shared/contracts/files'
import {
  buildFilesPanelFolderContextOptions,
  buildFilesPanelSessionContextOptions,
  countFilesPanelContextOptions,
  emptyFilesPanelContextOptions,
  type FilesPanelGroup,
  type FilesPanelTab
} from '@/services/filesPanelTreeRuntime'

export type FilesPanelContextMenuTarget = 'session' | 'folder' | ''

export type FilesPanelContextMenuState = {
  visible: boolean
  x: number
  y: number
  target: FilesPanelContextMenuTarget
  sessionId: string
  folderUuid: string
}

export type FilesPanelContextRuntimeDeps = {
  activeTab: Ref<FilesPanelTab>
  selectedId: Ref<string>
  getFileSessions: () => FileSessionInfo[]
  groupByKey: (key: string) => FilesPanelGroup | null
  folderByGroup: (group: FilesPanelGroup | null) => FileSessionFolderRecord | null
  clearSessionClickTimer: () => void
  getViewport?: () => { width: number; height: number }
}

const viewport = (deps: FilesPanelContextRuntimeDeps) =>
  deps.getViewport?.() || {
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight
  }

export const createFilesPanelContextRuntime = (deps: FilesPanelContextRuntimeDeps) => {
  const contextMenu = reactive<FilesPanelContextMenuState>({ visible: false, x: 0, y: 0, target: '', sessionId: '', folderUuid: '' })

  const contextSession = computed(() => (contextMenu.target === 'session' ? deps.getFileSessions().find((item) => item.id === contextMenu.sessionId) || null : null))
  const contextGroup = computed(() => (contextMenu.target === 'folder' ? deps.groupByKey(contextMenu.folderUuid) : null))
  const contextFolder = computed(() => deps.folderByGroup(contextGroup.value))

  const contextMenuOptions = computed(() => {
    if (contextMenu.target === 'session') return buildFilesPanelSessionContextOptions(contextSession.value, deps.activeTab.value)
    if (contextMenu.target === 'folder') return buildFilesPanelFolderContextOptions(contextFolder.value, contextGroup.value, deps.activeTab.value)
    return emptyFilesPanelContextOptions
  })

  const closeContextMenu = () => {
    contextMenu.visible = false
    contextMenu.target = ''
    contextMenu.sessionId = ''
    contextMenu.folderUuid = ''
  }

  const positionContextMenu = (event: MouseEvent, menuItemCount: number) => {
    const menuWidth = 160
    const estimatedMenuHeight = 4 + 2 + menuItemCount * 25
    const { width, height } = viewport(deps)
    let left = event.clientX
    let top = event.clientY
    if (left + menuWidth > width) {
      left = width - menuWidth - 5
    }
    if (top + estimatedMenuHeight > height) {
      top = event.clientY - estimatedMenuHeight
      if (top < 0) top = 5
    }
    contextMenu.x = left
    contextMenu.y = top
  }

  const openContextMenu = (event: MouseEvent, sessionId: string) => {
    deps.clearSessionClickTimer()
    const session = deps.getFileSessions().find((item) => item.id === sessionId)
    if (!session) return
    const menuItemCount = countFilesPanelContextOptions(buildFilesPanelSessionContextOptions(session, deps.activeTab.value))
    if (!menuItemCount) {
      closeContextMenu()
      return
    }
    positionContextMenu(event, menuItemCount)
    deps.selectedId.value = sessionId
    contextMenu.visible = true
    contextMenu.target = 'session'
    contextMenu.sessionId = sessionId
    contextMenu.folderUuid = ''
  }

  const openFolderContextMenu = (event: MouseEvent, groupKey: string) => {
    const group = deps.groupByKey(groupKey)
    const folder = deps.folderByGroup(group)
    if (!folder) return
    event.preventDefault()
    event.stopPropagation()
    deps.clearSessionClickTimer()
    const menuItemCount = countFilesPanelContextOptions(buildFilesPanelFolderContextOptions(folder, group, deps.activeTab.value))
    if (!menuItemCount) {
      closeContextMenu()
      return
    }
    positionContextMenu(event, menuItemCount)
    deps.selectedId.value = ''
    contextMenu.visible = true
    contextMenu.target = 'folder'
    contextMenu.sessionId = ''
    contextMenu.folderUuid = group?.key || folder.uuid
  }

  return {
    contextMenu,
    contextSession,
    contextGroup,
    contextFolder,
    contextMenuOptions,
    closeContextMenu,
    openContextMenu,
    openFolderContextMenu
  }
}

export type FilesPanelContextRuntime = ReturnType<typeof createFilesPanelContextRuntime>
