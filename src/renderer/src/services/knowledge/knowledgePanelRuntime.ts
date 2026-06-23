import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { knowledgeClient } from '@/services/knowledge/knowledgeClient'
import { getKnowledgeParent } from '@/services/knowledge/knowledgeRuntime'
import { localFilesClient } from '@/services/app/localFilesClient'
import { isKnowledgePathCheckResultData, malformedKnowledgeBackendResultMessage } from '@/services/knowledge/knowledgeBackendGuards'
import { useWorkspaceStore } from '@/stores/workspace'
import type { KnowledgeBaseSearchResult, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { KnowledgePanelBlankMenu, KnowledgePanelNodeMenu } from '@/services/knowledge/knowledgePanelTypes'

type KnowledgePanelRuntimeProps = {
  query?: string
}

export const useKnowledgePanelRuntime = (props: KnowledgePanelRuntimeProps) => {
  const workspace = useWorkspaceStore()
  const addMenuOpen = ref(false)
  const showCapacityDetail = ref(false)
  const editingKey = ref('')
  const editingName = ref('')
  const kbDragSource = ref('')
  const kbDragOverRelPath = ref('')
  const kbDragOverRoot = ref(false)
  const nodeMenu = reactive<KnowledgePanelNodeMenu>({ visible: false, x: 0, y: 0, relPath: '', type: 'file' })
  const blankMenu = reactive<KnowledgePanelBlankMenu>({ visible: false, x: 0, y: 0 })

  const modifierKey = computed(() => (navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl+'))
  const clipboardAvailable = computed(() => Boolean(workspace.kbClipboard))

  onMounted(() => {
    void workspace.refreshKnowledgeTree({ persist: false })
    document.addEventListener('pointerdown', onDocumentPointerDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
  })

  watch(
    () => props.query,
    (query) => {
      if (query !== undefined) workspace.kbSearchQuery = query
    },
    { immediate: true }
  )

  watch(
    () => workspace.kbSearchQuery,
    () => {
      void workspace.searchKnowledgeContent()
    },
    { immediate: true }
  )

  const selectedTargetDir = () => {
    const selected = workspace.kbSelectedKeys[0]
    if (!selected) return ''
    const node = workspace.findKnowledgeNode(selected)
    return node?.type === 'dir' ? selected : getKnowledgeParent(selected)
  }

  const selectNode = (relPath: string, multi: boolean) => {
    workspace.selectKnowledgeNode(relPath, multi)
    if (!multi && workspace.findKnowledgeNode(relPath)?.type === 'file') {
      workspace.openKnowledgeFile(relPath)
    }
  }

  const openSearchResult = (result: KnowledgeBaseSearchResult) => {
    workspace.openKnowledgeFile(result.path, {
      startLine: result.startLine,
      endLine: result.endLine
    })
  }

  const toggleExpanded = (relPath: string) => {
    workspace.kbExpandedKeys = workspace.kbExpandedKeys.includes(relPath)
      ? workspace.kbExpandedKeys.filter((key) => key !== relPath)
      : [...workspace.kbExpandedKeys, relPath]
  }

  const openNodeMenu = (event: MouseEvent, node: KnowledgeNode) => {
    addMenuOpen.value = false
    blankMenu.visible = false
    workspace.selectKnowledgeNode(node.relPath, false)
    nodeMenu.visible = true
    nodeMenu.x = event.clientX
    nodeMenu.y = event.clientY
    nodeMenu.relPath = node.relPath
    nodeMenu.type = node.type
  }

  const openBlankMenu = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('.kb-tree-node')) return
    addMenuOpen.value = false
    nodeMenu.visible = false
    blankMenu.visible = true
    blankMenu.x = event.clientX
    blankMenu.y = event.clientY
  }

  const clearBlankSelection = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('.kb-tree-node') || (event.target as HTMLElement).closest('.kb-capacity-bar')) return
    workspace.kbSelectedKeys = []
  }

  const closeFloatingMenus = () => {
    addMenuOpen.value = false
    nodeMenu.visible = false
    blankMenu.visible = false
  }

  function onDocumentPointerDown(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('.kb-add-wrapper, .kb-context-menu')) return
    closeFloatingMenus()
  }

  const createInline = async (kind: 'file' | 'dir', parentRelDir = selectedTargetDir()) => {
    closeFloatingMenus()
    const node = await workspace.createKnowledgeNode(kind, parentRelDir, kind === 'dir' ? 'New Folder' : 'New Document.md')
    if (node) startRename(node.relPath)
  }

  const startRename = (relPath: string) => {
    const node = workspace.findKnowledgeNode(relPath)
    if (!node) return
    editingKey.value = relPath
    editingName.value = node.title
    nodeMenu.visible = false
    nextTick(() => document.querySelector<HTMLInputElement>('.kb-rename-input')?.focus())
  }

  const confirmRename = async () => {
    await workspace.renameKnowledgeNode(editingKey.value, editingName.value)
    editingKey.value = ''
    editingName.value = ''
  }

  const cancelRename = () => {
    editingKey.value = ''
    editingName.value = ''
  }

  const deleteSelection = async () => {
    const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
    await workspace.deleteKnowledgeNodes(targets)
    nodeMenu.visible = false
  }

  const copySelection = (mode: 'copy' | 'cut') => {
    const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
    workspace.copyKnowledgeNodes(targets, mode)
    nodeMenu.visible = false
  }

  const pasteInto = async (relPath: string) => {
    await workspace.pasteKnowledgeNodes(relPath)
    nodeMenu.visible = false
    blankMenu.visible = false
  }

  const isKnowledgeDragMime = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('application/x-aiopsterm-kb-node')

  const isInvalidKnowledgeMove = (source: string, targetDir: string) => {
    if (!source) return true
    const sourceNode = workspace.findKnowledgeNode(source)
    if (!sourceNode) return true
    if (source === targetDir) return true
    return sourceNode.type === 'dir' && Boolean(targetDir) && targetDir.startsWith(`${source}/`)
  }

  const moveKnowledgeNodeTo = async (source: string, targetDir: string) => {
    const destination = workspace.findKnowledgeNode(targetDir)
    const dstRelDir = destination?.type === 'file' ? getKnowledgeParent(destination.relPath) : targetDir
    if (isInvalidKnowledgeMove(source, dstRelDir)) {
      workspace.setTopNotice('不能移动到自身或子目录')
      return
    }
    workspace.copyKnowledgeNodes([source], 'cut')
    await workspace.pasteKnowledgeNodes(dstRelDir)
  }

  const clearKnowledgeDragState = () => {
    kbDragSource.value = ''
    kbDragOverRelPath.value = ''
    kbDragOverRoot.value = false
  }

  const handleKnowledgeDragStart = (event: DragEvent, node: KnowledgeNode) => {
    kbDragSource.value = node.relPath
    workspace.selectKnowledgeNode(node.relPath, false)
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-aiopsterm-kb-node', node.relPath)
    event.dataTransfer.setData('text/plain', node.relPath)
  }

  const handleKnowledgeNodeDragOver = (event: DragEvent, node: KnowledgeNode) => {
    if (!isKnowledgeDragMime(event)) return
    event.preventDefault()
    event.stopPropagation()
    const targetDir = node.type === 'dir' ? node.relPath : getKnowledgeParent(node.relPath)
    kbDragOverRelPath.value = targetDir
    kbDragOverRoot.value = false
    if (event.dataTransfer) event.dataTransfer.dropEffect = isInvalidKnowledgeMove(kbDragSource.value, targetDir) ? 'none' : 'move'
  }

  const handleKnowledgeNodeDragLeave = (node: KnowledgeNode) => {
    if (kbDragOverRelPath.value === node.relPath || kbDragOverRelPath.value === getKnowledgeParent(node.relPath)) kbDragOverRelPath.value = ''
  }

  const handleKnowledgeNodeDrop = async (event: DragEvent, node: KnowledgeNode) => {
    if (!isKnowledgeDragMime(event)) return
    event.preventDefault()
    event.stopPropagation()
    const source = event.dataTransfer?.getData('application/x-aiopsterm-kb-node') || kbDragSource.value
    const targetDir = node.type === 'dir' ? node.relPath : getKnowledgeParent(node.relPath)
    clearKnowledgeDragState()
    await moveKnowledgeNodeTo(source, targetDir)
  }

  const handleRootDragOver = (event: DragEvent) => {
    if (!isKnowledgeDragMime(event)) return
    event.preventDefault()
    kbDragOverRoot.value = true
    kbDragOverRelPath.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = isInvalidKnowledgeMove(kbDragSource.value, '') ? 'none' : 'move'
  }

  const handleRootDragLeave = (event: DragEvent) => {
    const current = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    if (!current || !related || !current.contains(related)) kbDragOverRoot.value = false
  }

  const handleRootDrop = async (event: DragEvent) => {
    event.stopPropagation()
    if (!isKnowledgeDragMime(event)) {
      await handleDropImport(event)
      return
    }
    event.preventDefault()
    const source = event.dataTransfer?.getData('application/x-aiopsterm-kb-node') || kbDragSource.value
    clearKnowledgeDragState()
    await moveKnowledgeNodeTo(source, '')
  }

  const copyPath = async () => {
    const copied = await copyTextToClipboard(workspace.kbSelectedKeys.join('\n') || nodeMenu.relPath)
    workspace.setTopNotice(copied ? '知识库路径已复制' : '知识库路径复制失败')
    nodeMenu.visible = false
  }

  const addToChat = async () => {
    const targets = workspace.kbSelectedKeys.length ? [...workspace.kbSelectedKeys] : [nodeMenu.relPath]
    await workspace.addKnowledgeFilesToChat(targets)
    nodeMenu.visible = false
  }

  const importKnowledgePath = async (filePath: string, targetDir: string, fallbackName: string) => {
    const kbCheckPath = knowledgeClient.kbCheckPath()
    if (!kbCheckPath) {
      workspace.setTopNotice('知识库导入需要路径检查服务')
      return
    }
    let info: unknown
    try {
      info = await kbCheckPath(filePath)
    } catch {
      workspace.setTopNotice('知识库导入路径检查失败')
      return
    }
    if (!isKnowledgePathCheckResultData(info)) {
      workspace.setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (!info.exists) {
      workspace.setTopNotice('知识库导入路径不存在')
      return
    }
    if (info.isDirectory === info.isFile) {
      workspace.setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    const fileName = filePath.split(/[\\/]/).pop() || fallbackName
    if (info.isDirectory) {
      await workspace.addKnowledgeImportJob(`${targetDir}/${fileName}`.replace(/^\/+/, ''), filePath, 'folder')
      return
    }
    if (info.isFile) {
      await workspace.addKnowledgeImportJob(`${targetDir}/${fileName}`.replace(/^\/+/, ''), filePath, 'file')
      return
    }
    workspace.setTopNotice('知识库导入路径类型不支持')
  }

  const uploadFile = async (targetDirOverride?: string) => {
    closeFloatingMenus()
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      workspace.setTopNotice('知识库导入需要文件选择服务')
      return
    }
    const result = await showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    if (result?.canceled || !result?.filePaths.length) return
    const targetDir = targetDirOverride ?? selectedTargetDir()
    for (const filePath of result.filePaths) {
      await importKnowledgePath(filePath, targetDir, 'imported-note.md')
    }
  }

  const handleDropImport = async (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files || [])
    const localPaths = files.map((file) => String((file as File & { path?: string }).path || '').trim()).filter(Boolean)
    if (!localPaths.length) {
      workspace.setTopNotice('知识库拖拽导入需要真实本地路径')
      return
    }
    const targetDir = selectedTargetDir()
    for (const filePath of localPaths) {
      await importKnowledgePath(filePath, targetDir, 'dropped-file.md')
    }
  }

  const refreshTree = async () => {
    addMenuOpen.value = false
    blankMenu.visible = false
    await workspace.refreshKnowledgeTree()
  }

  return {
    workspace,
    addMenuOpen,
    showCapacityDetail,
    editingKey,
    editingName,
    kbDragOverRelPath,
    kbDragOverRoot,
    nodeMenu,
    blankMenu,
    modifierKey,
    clipboardAvailable,
    selectNode,
    openSearchResult,
    toggleExpanded,
    openNodeMenu,
    openBlankMenu,
    clearBlankSelection,
    createInline,
    startRename,
    confirmRename,
    cancelRename,
    deleteSelection,
    copySelection,
    pasteInto,
    clearKnowledgeDragState,
    handleKnowledgeDragStart,
    handleKnowledgeNodeDragOver,
    handleKnowledgeNodeDragLeave,
    handleKnowledgeNodeDrop,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
    copyPath,
    addToChat,
    uploadFile,
    refreshTree
  }
}
