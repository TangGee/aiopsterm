import { computed, type Ref } from 'vue'
import {
  expectedKnowledgeRelPath,
  isKnowledgeDeleteResultData,
  isKnowledgeEnsureRootResultData,
  isKnowledgeEntryListData,
  isKnowledgeImportResultForRequest,
  isKnowledgeMutationEntryData,
  isKnowledgeReadResultData,
  isKnowledgeReindexResultData,
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeSearchResultListData,
  isKnowledgeSearchStatusData,
  isKnowledgeTransferProgressData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledgeClient'
import {
  addCompletedKnowledgeImportJob,
  cloneKnowledgeNodes,
  filterKnowledgeTree,
  findKnowledgeNode as findKnowledgeNodeInTree,
  getKnowledgeParent,
  isKnowledgeImagePath,
  knowledgeCapacityPercent,
  knowledgeContentSearchVisible,
  knowledgeEntryToNode,
  knowledgeRelPathParentMatches,
  mediaTypeFromKnowledgePath,
  missingKnowledgeRelPaths,
  pruneKnowledgeUiState,
  removeKnowledgeImportJob,
  resolveKnowledgePasteTarget,
  selectKnowledgeNodeKeys,
  uniqueKnowledgeFileName as uniqueKnowledgeFileNameInTree,
  upsertKnowledgeImportJob,
  type KbClipboard,
  type KnowledgeImportJob
} from '@/services/knowledgeRuntime'
import { knowledgeTreeSize, mergeUserConfig } from '@/services/workspaceConfigRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import type {
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeNode,
  KnowledgeNodeType
} from '@shared/contracts/knowledgeBase'
import type { AiContextOption } from '@shared/contracts/aiChat'
import type { AiPreferencesUserConfig } from '@shared/contracts/appRuntime'
import type { TerminalPanel } from '@/services/terminalPanelRuntime'

type WorkspaceKnowledgeControllerState = {
  config: Ref<UserConfig>
  knowledgeTree: Ref<KnowledgeNode[]>
  kbExpandedKeys: Ref<string[]>
  kbSelectedKeys: Ref<string[]>
  kbSearchQuery: Ref<string>
  kbContentSearchResults: Ref<KnowledgeBaseSearchResult[]>
  kbSearchStatus: Ref<KnowledgeBaseSearchStatus | null>
  kbSearchLoading: Ref<boolean>
  kbSearchError: Ref<string>
  kbClipboard: Ref<KbClipboard>
  kbImportJobs: Ref<KnowledgeImportJob[]>
  kbUsedBytes: Ref<number>
  kbTotalBytes: Ref<number>
  selectedContexts: Ref<AiContextOption[]>
  rightPanelOpen: Ref<boolean>
  aiPreferences: Ref<AiPreferencesUserConfig>
}

type WorkspaceKnowledgeControllerDeps = {
  setTopNotice: (message: string) => void
  openKnowledgeFile: (relPath: string, range?: { startLine?: number; endLine?: number }) => TerminalPanel | null
  syncKnowledgePanelsAfterRename: (oldRelPath: string, newRelPath: string) => void
  closeKnowledgePanelsForRemoved: (relPaths: string[]) => void
}

export const createWorkspaceKnowledgeController = (state: WorkspaceKnowledgeControllerState, deps: WorkspaceKnowledgeControllerDeps) => {
  const {
    config,
    knowledgeTree,
    kbExpandedKeys,
    kbSelectedKeys,
    kbSearchQuery,
    kbContentSearchResults,
    kbSearchStatus,
    kbSearchLoading,
    kbSearchError,
    kbClipboard,
    kbImportJobs,
    kbUsedBytes,
    kbTotalBytes,
    selectedContexts,
    rightPanelOpen,
    aiPreferences
  } = state
  const { setTopNotice, openKnowledgeFile, syncKnowledgePanelsAfterRename, closeKnowledgePanelsForRemoved } = deps

  let kbSearchRequest = 0
  let removeKnowledgeProgressListener: (() => void) | null = null

  const filteredKnowledgeTree = computed(() => filterKnowledgeTree(knowledgeTree.value, kbSearchQuery.value))
  const kbContentSearchVisible = computed(() => knowledgeContentSearchVisible(kbSearchQuery.value))
  const kbCapacityPercent = computed(() => knowledgeCapacityPercent(kbUsedBytes.value, kbTotalBytes.value))

  const loadKnowledgeTreeFromBridge = async (relDir = ''): Promise<KnowledgeNode[]> => {
    const kbListDir = knowledgeClient.kbListDir()
    if (!kbListDir) throw new Error('KNOWLEDGE_BRIDGE_UNAVAILABLE')
    const entries = await kbListDir(relDir)
    if (!isKnowledgeEntryListData(entries)) throw new Error(malformedKnowledgeBackendResultMessage)
    const nodes: KnowledgeNode[] = []
    for (const entry of entries) {
      const node = knowledgeEntryToNode(entry)
      if (entry.type === 'dir') {
        node.children = await loadKnowledgeTreeFromBridge(entry.relPath)
      }
      nodes.push(node)
    }
    return nodes
  }

  const refreshKnowledgeTree = async (options: { persist?: boolean } = {}) => {
    void options
    const kbEnsureRoot = knowledgeClient.kbEnsureRoot()
    if (!kbEnsureRoot || !knowledgeClient.kbListDir()) {
      setTopNotice('知识库加载服务不可用')
      return false
    }
    try {
      const rootResult = await kbEnsureRoot()
      if (!isKnowledgeEnsureRootResultData(rootResult)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return false
      }
      const nextTree = await loadKnowledgeTreeFromBridge('')
      const nextSnapshot = {
        tree: cloneKnowledgeNodes(nextTree),
        usedBytes: knowledgeTreeSize(nextTree),
        totalBytes: kbTotalBytes.value
      }
      knowledgeTree.value = nextTree
      kbUsedBytes.value = nextSnapshot.usedBytes
      config.value = mergeUserConfig(config.value, { knowledgeBase: nextSnapshot })
      return true
    } catch (error) {
      setTopNotice(error instanceof Error && error.message === malformedKnowledgeBackendResultMessage ? malformedKnowledgeBackendResultMessage : '知识库加载失败')
      return false
    }
  }

  const handleKnowledgeTransferProgress = (event: KnowledgeBaseTransferProgress) => {
    if (!isKnowledgeTransferProgressData(event)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    const { jobs, percent } = upsertKnowledgeImportJob(kbImportJobs.value, event)
    kbImportJobs.value = jobs
    if (percent >= 100) {
      window.setTimeout(() => {
        kbImportJobs.value = removeKnowledgeImportJob(kbImportJobs.value, event.jobId)
      }, 500)
    }
  }

  const setupKnowledgeBridgeListeners = () => {
    const onKbTransferProgress = knowledgeClient.onKbTransferProgress()
    if (removeKnowledgeProgressListener || !onKbTransferProgress) return
    removeKnowledgeProgressListener = onKbTransferProgress(handleKnowledgeTransferProgress)
  }

  const findKnowledgeNode = (relPath: string, nodes = knowledgeTree.value): KnowledgeNode | null => findKnowledgeNodeInTree(nodes, relPath)

  const selectKnowledgeNode = (relPath: string, multi = false) => {
    kbSelectedKeys.value = selectKnowledgeNodeKeys(kbSelectedKeys.value, relPath, multi)
  }

  const refreshKnowledgeSearchStatus = async () => {
    const kbSearchStatusBridge = knowledgeClient.kbSearchStatus()
    if (!kbSearchStatusBridge) return false
    try {
      const status = await kbSearchStatusBridge()
      if (!isKnowledgeSearchStatusData(status)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return false
      }
      kbSearchStatus.value = status
      return true
    } catch {
      return false
    }
  }

  const searchKnowledgeContent = async (query = kbSearchQuery.value) => {
    const normalizedQuery = query.trim()
    const request = ++kbSearchRequest
    if (normalizedQuery.length <= 1) {
      kbContentSearchResults.value = []
      kbSearchLoading.value = false
      kbSearchError.value = ''
      return []
    }
    const kbSearch = knowledgeClient.kbSearch()
    if (!kbSearch) {
      kbSearchLoading.value = false
      kbSearchError.value = '知识库搜索服务不可用'
      return kbContentSearchResults.value
    }
    kbSearchLoading.value = true
    kbSearchError.value = ''
    try {
      const results = await kbSearch(normalizedQuery, { maxResults: 12, minScore: 0.15 })
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      if (!isKnowledgeSearchResultListData(results)) {
        kbSearchError.value = malformedKnowledgeBackendResultMessage
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return kbContentSearchResults.value
      }
      kbContentSearchResults.value = results
      await refreshKnowledgeSearchStatus()
      return results
    } catch (searchError) {
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      kbSearchError.value = searchError instanceof Error ? searchError.message : String(searchError)
      return kbContentSearchResults.value
    } finally {
      if (request === kbSearchRequest) kbSearchLoading.value = false
    }
  }

  const knowledgeSearchResultToAiContext = (result: KnowledgeBaseSearchResult): AiContextOption | null => {
    const relPath = result.path.trim()
    if (!relPath) return null
    const label = relPath.split('/').filter(Boolean).pop() || relPath
    return {
      id: `kb-doc:${relPath}`,
      kind: 'docs',
      label,
      relPath,
      detail: `Auto search match lines ${result.startLine}-${result.endLine}, score ${result.score.toFixed(2)}: ${result.snippet.trim()}`
    }
  }

  const resolveAiKnowledgeSearchContexts = async (query: string, existingContexts: AiContextOption[]) => {
    const normalizedQuery = query.trim()
    const kbSearch = knowledgeClient.kbSearch()
    if (!aiPreferences.value.kbSearchEnabled || normalizedQuery.length <= 1 || !kbSearch) return []
    try {
      const results = await kbSearch(normalizedQuery, { maxResults: 3, minScore: 0.25 })
      if (!isKnowledgeSearchResultListData(results)) return []
      const existingIds = new Set(existingContexts.map((context) => context.id))
      return results
        .map(knowledgeSearchResultToAiContext)
        .filter((context): context is AiContextOption => Boolean(context && !existingIds.has(context.id)))
    } catch {
      return []
    }
  }

  const reindexKnowledgeContent = async () => {
    const kbReindex = knowledgeClient.kbReindex()
    if (!kbReindex) {
      setTopNotice('知识库索引服务不可用')
      return null
    }
    try {
      const result = await kbReindex()
      if (!isKnowledgeReindexResultData(result)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return null
      }
      await refreshKnowledgeSearchStatus()
      if (kbSearchQuery.value.trim().length > 1) void searchKnowledgeContent()
      return result
    } catch (indexError) {
      const message = indexError instanceof Error ? indexError.message : String(indexError)
      setTopNotice(message ? `知识库索引服务不可用：${message}` : '知识库索引服务不可用')
      return null
    }
  }

  const backendKnowledgeEntryOrNotice = (result: unknown, notice: string) => {
    if (!isKnowledgeMutationEntryData(result)) {
      setTopNotice(notice)
      return null
    }
    return result
  }

  const pruneMissingKnowledgeUiState = (candidateRelPaths: string[]) => {
    const missingRelPaths = missingKnowledgeRelPaths(knowledgeTree.value, candidateRelPaths)
    if (!missingRelPaths.length) return
    const pruned = pruneKnowledgeUiState(kbSelectedKeys.value, kbExpandedKeys.value, missingRelPaths)
    kbSelectedKeys.value = pruned.selectedKeys
    kbExpandedKeys.value = pruned.expandedKeys
    closeKnowledgePanelsForRemoved(missingRelPaths)
  }

  const refreshKnowledgeTreeAfterMutationFailure = async (notice: string, candidateRemovedRelPaths: string[] = []) => {
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return false
    pruneMissingKnowledgeUiState(candidateRemovedRelPaths)
    setTopNotice(notice)
    return true
  }

  const createKnowledgeNode = async (kind: KnowledgeNodeType, parentRelDir: string, title: string) => {
    const name = title.trim()
    if (!name) return null
    const kbCreateFile = knowledgeClient.kbCreateFile()
    const kbMkdir = knowledgeClient.kbMkdir()
    if (!kbCreateFile || !kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result =
      kind === 'dir'
        ? await kbMkdir(parentRelDir, name)
        : await kbCreateFile(parentRelDir, name, '')
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    const pathMatchesRequest =
      kind === 'dir'
        ? relPath === expectedKnowledgeRelPath(parentRelDir, name)
        : isKnowledgeRelPathInParentWithRequestedName(relPath, parentRelDir, name)
    if (!pathMatchesRequest) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    if (entry.type !== kind) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    if (!created || created.type !== kind) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    kbSelectedKeys.value = [relPath]
    if (kind === 'dir' && !kbExpandedKeys.value.includes(relPath)) {
      kbExpandedKeys.value.push(relPath)
    }
    if (kind === 'file') {
      openKnowledgeFile(relPath)
    }
    return created
  }

  const renameKnowledgeNode = async (relPath: string, title: string) => {
    const node = findKnowledgeNode(relPath)
    const name = title.trim()
    if (!node || !name) return
    const kbRename = knowledgeClient.kbRename()
    if (!kbRename) {
      setTopNotice('知识库重命名服务不可用')
      return
    }
    const result = await kbRename(relPath, name)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return
    const nextRelPath = entry.relPath.trim()
    if (nextRelPath !== expectedKnowledgeRelPath(getKnowledgeParent(relPath), name)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (entry.type !== node.type) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (!findKnowledgeNode(nextRelPath)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    kbSelectedKeys.value = [nextRelPath]
    kbExpandedKeys.value = kbExpandedKeys.value.map((key) => (key === relPath || key.startsWith(`${relPath}/`) ? key.replace(relPath, nextRelPath) : key))
    syncKnowledgePanelsAfterRename(relPath, nextRelPath)
  }

  const deleteKnowledgeNodes = async (relPaths: string[]) => {
    const kbDelete = knowledgeClient.kbDelete()
    if (!kbDelete) {
      setTopNotice('知识库删除服务不可用')
      return
    }
    const candidateRemovedRelPaths: string[] = []
    for (const relPath of relPaths) {
      const node = findKnowledgeNode(relPath)
      if (!node) continue
      let result: unknown
      try {
        result = await kbDelete(relPath, node.type === 'dir')
      } catch {
        await refreshKnowledgeTreeAfterMutationFailure('知识库删除服务不可用', [...candidateRemovedRelPaths, relPath])
        return
      }
      if (!isKnowledgeDeleteResultData(result)) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, [...candidateRemovedRelPaths, relPath])
        return
      }
      if (result.relPath.trim() !== relPath || result.type !== node.type || result.deleted !== true) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, [...candidateRemovedRelPaths, relPath])
        return
      }
      candidateRemovedRelPaths.push(relPath)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (relPaths.some((relPath) => findKnowledgeNode(relPath))) {
      pruneMissingKnowledgeUiState(relPaths)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    pruneMissingKnowledgeUiState(relPaths)
  }

  const copyKnowledgeNodes = (relPaths: string[], mode: 'copy' | 'cut') => {
    if (!relPaths.length) return
    kbClipboard.value = { mode, sources: relPaths }
  }

  const pasteKnowledgeNodes = async (targetRelDir: string) => {
    if (!kbClipboard.value) return
    const destination = findKnowledgeNode(targetRelDir)
    const dstRelDir = resolveKnowledgePasteTarget(targetRelDir, destination)
    const kbCopy = knowledgeClient.kbCopy()
    const kbMove = knowledgeClient.kbMove()
    if (!kbCopy || !kbMove) {
      setTopNotice('知识库复制移动服务不可用')
      return
    }
    const sources = [...kbClipboard.value.sources]
    const mode = kbClipboard.value.mode
    const resultRelPaths: string[] = []
    const candidateRemovedSources: string[] = []
    for (const source of sources) {
      const sourceNode = findKnowledgeNode(source)
      if (!sourceNode) continue
      let result: unknown
      try {
        if (mode === 'copy') {
          result = await kbCopy(source, dstRelDir)
        } else {
          result = await kbMove(source, dstRelDir)
        }
      } catch {
        await refreshKnowledgeTreeAfterMutationFailure('知识库复制移动服务不可用', mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
      if (!entry) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      const resultRelPath = entry.relPath.trim()
      if (!knowledgeRelPathParentMatches(resultRelPath, dstRelDir) || entry.type !== sourceNode.type) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      resultRelPaths.push(resultRelPath)
      if (mode === 'cut') candidateRemovedSources.push(source)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (resultRelPaths.some((relPath) => !findKnowledgeNode(relPath))) {
      if (mode === 'cut') pruneMissingKnowledgeUiState(sources)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (mode === 'cut' && sources.some((source) => findKnowledgeNode(source))) {
      pruneMissingKnowledgeUiState(sources)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (mode === 'cut') kbClipboard.value = null
    if (mode === 'cut') pruneMissingKnowledgeUiState(sources)
  }

  const addKnowledgeImportJob = async (destRelPath: string, srcAbsPath?: string, sourceType: 'file' | 'folder' = 'file') => {
    if (!srcAbsPath) {
      setTopNotice('知识库导入需要真实本地路径')
      return false
    }
    const kbImportFile = knowledgeClient.kbImportFile()
    const kbImportFolder = knowledgeClient.kbImportFolder()
    if (!kbImportFile || !kbImportFolder) {
      setTopNotice('知识库导入服务不可用')
      return false
    }
    const dstRelDir = getKnowledgeParent(destRelPath)
    const result = sourceType === 'folder' ? await kbImportFolder(srcAbsPath, dstRelDir) : await kbImportFile(srcAbsPath, dstRelDir)
    if (!isKnowledgeImportResultForRequest(result, dstRelDir, sourceType)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return false
    }
    if (!kbImportJobs.value.some((job) => job.id === result.jobId)) {
      kbImportJobs.value = addCompletedKnowledgeImportJob(kbImportJobs.value, result.jobId, result.relPath)
      window.setTimeout(() => {
        kbImportJobs.value = removeKnowledgeImportJob(kbImportJobs.value, result.jobId)
      }, 500)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return false
    const imported = findKnowledgeNode(result.relPath)
    if (!imported || imported.type !== sourceType) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return false
    }
    return true
  }

  const addKnowledgeFilesToChat = async (relPaths: string[]) => {
    const filePaths = relPaths.filter((relPath) => findKnowledgeNode(relPath)?.type === 'file')
    for (const relPath of filePaths) {
      const node = findKnowledgeNode(relPath)
      const label = node?.title || relPath.split('/').pop() || relPath
      if (isKnowledgeImagePath(relPath)) {
        const kbReadFile = knowledgeClient.kbReadFile()
        let imageContext: AiContextOption = {
          id: `kb-image:${relPath}`,
          kind: 'images',
          label,
          detail: relPath,
          relPath,
          mediaType: mediaTypeFromKnowledgePath(relPath)
        }
        if (kbReadFile) {
          try {
            const result = await kbReadFile(relPath, 'base64')
            if (isKnowledgeReadResultData(result, 'base64')) {
              imageContext = {
                ...imageContext,
                mediaType: result.mimeType || imageContext.mediaType,
                data: result.content
              }
            } else {
              setTopNotice(malformedKnowledgeBackendResultMessage)
              continue
            }
          } catch {
            setTopNotice('知识库文件读取失败')
            continue
          }
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === imageContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, imageContext]
      } else {
        const docContext: AiContextOption = {
          id: `kb-doc:${relPath}`,
          kind: 'docs',
          label,
          detail: relPath,
          relPath
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === docContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, docContext]
      }
    }
    rightPanelOpen.value = true
  }

  const uniqueKnowledgeFileName = (parentRelDir: string, name: string) =>
    uniqueKnowledgeFileNameInTree(knowledgeTree.value, parentRelDir, name)

  return {
    filteredKnowledgeTree,
    kbContentSearchVisible,
    kbCapacityPercent,
    setupKnowledgeBridgeListeners,
    refreshKnowledgeTree,
    searchKnowledgeContent,
    reindexKnowledgeContent,
    refreshKnowledgeSearchStatus,
    resolveAiKnowledgeSearchContexts,
    findKnowledgeNode,
    selectKnowledgeNode,
    createKnowledgeNode,
    renameKnowledgeNode,
    deleteKnowledgeNodes,
    copyKnowledgeNodes,
    pasteKnowledgeNodes,
    addKnowledgeImportJob,
    addKnowledgeFilesToChat,
    backendKnowledgeEntryOrNotice,
    uniqueKnowledgeFileName
  }
}
